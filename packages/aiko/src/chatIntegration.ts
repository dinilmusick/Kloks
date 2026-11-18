import { ImmediateCallerRouter, type ChatCallContext, type ChatResult,
  type ChatTarget, type RoutedChatReply, type VerifiedChatCaller,
  type ImmediateCallerRouterOptions } from './callerRouting.js';

/** Projection of the canonical, caller-authorized agent directory, not a second registry. */
export interface AuthorizedAgentAddress {
  readonly id: string;
  readonly appId: string;
  readonly kind: 'app' | 'endpoint' | 'workflow';
  readonly name: string;
  readonly canonicalName: string;
  readonly alias?: string;
}

export interface AikoChatIntegrationOptions {
  /** Resolve current identity and workspace from the server-side Luth session. */
  readonly verifyCaller: ImmediateCallerRouterOptions['verifyCaller'];
  /** Read the existing authorized Aiko directory for this caller on each access. */
  readonly listAuthorized: (caller: VerifiedChatCaller) =>
    Promise<readonly AuthorizedAgentAddress[]> | readonly AuthorizedAgentAddress[];
  /** Reauthorize the actual target operation, not only its catalogue entry. */
  readonly authorizeOperation: (caller: VerifiedChatCaller, entry: AuthorizedAgentAddress,
    context: ChatCallContext) => Promise<boolean> | boolean;
  /** The owning application executes its actual BackendFacade/FOD/Aiko operation. */
  readonly executeAuthorized: (entry: AuthorizedAgentAddress, input: unknown,
    context: ChatCallContext, signal: AbortSignal,
    callChild: (target: ChatTarget, input: unknown) => Promise<RoutedChatReply>) => Promise<ChatResult>;
  readonly validateInput?: (entry: AuthorizedAgentAddress, input: unknown,
    context: ChatCallContext) => Promise<readonly { name: string; question: string }[]> |
      readonly { name: string; question: string }[];
  readonly maxDepth?: number;
  readonly maxCalls?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Durable compare-and-swap key adapter; required when replay-safety is requested. */
  readonly runOnce?: ImmediateCallerRouterOptions['runOnce'];
}

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
function verified(caller: VerifiedChatCaller | null): asserts caller is VerifiedChatCaller {
  if (!caller?.userId?.trim() || !caller.appId?.trim() || !caller.workspaceId?.trim()) {
    throw new Error('An authenticated Luth caller and active workspace are required.');
  }
}
function sameTarget(entry: AuthorizedAgentAddress, target: ChatTarget): boolean {
  return entry.id === target.agentId && entry.appId === target.appId;
}
/** Only a leading, exact @alias or quoted @"Agent Name" is a direct mention. */
function mention(message: string): { name: string; input: string } | null {
  if (!message.trimStart().startsWith('@')) return null;
  const match = /^\s*@(?:"([^"\r\n]{1,80})"|([^\s@"\r\n]{1,80}))(?=\s|$)\s*/u.exec(message);
  if (!match) throw new Error('Invalid direct agent mention.');
  return { name: match[1] ?? match[2], input: message.slice(match[0].length).trim() };
}

/**
 * Connects ImmediateCallerRouter to the canonical Aiko agent directory and
 * owning-app execution adapters. This module does not create agents, persist a
 * second catalogue, accept client identities, or invent reply destinations.
 */
export function createAikoChatIntegration(options: AikoChatIntegrationOptions) {
  const directory = async (caller: VerifiedChatCaller): Promise<readonly AuthorizedAgentAddress[]> => {
    verified(caller);
    const entries = await options.listAuthorized(caller);
    if (!Array.isArray(entries)) throw new Error('Authorized agent directory is unavailable.');
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry.id?.trim() || !entry.appId?.trim() || !['app', 'endpoint', 'workflow'].includes(entry.kind)) {
        throw new Error('Authorized agent directory returned an invalid address.');
      }
      const key = entry.appId + '\u0000' + entry.id;
      if (seen.has(key)) throw new Error('Authorized agent directory returned a duplicate address.');
      seen.add(key);
    }
    return entries;
  };
  const resolve = async (caller: VerifiedChatCaller, target: ChatTarget) =>
    (await directory(caller)).find(entry => sameTarget(entry, target));

  let router!: ImmediateCallerRouter;
  router = new ImmediateCallerRouter({
    verifyCaller: options.verifyCaller,
    authorize: async (caller, target, context) => {
      const entry = await resolve(caller, target);
      return !!entry && await options.authorizeOperation(caller, entry, context);
    },
    dispatch: async (target, input, context, signal) => {
      const entry = await resolve(context.caller, target);
      if (!entry || !await options.authorizeOperation(context.caller, entry, context)) {
        throw new Error('Agent operation grant was revoked.');
      }
      if (typeof input === 'string' && !input.trim()) {
        return { status: 'needs_input', question: 'What should this agent do?' };
      }
      if (options.validateInput) {
        const missing = await options.validateInput(entry, input, context);
        if (missing.length) {
          const first = missing[0];
          if (!first || !first.name?.trim() || !first.question?.trim()) {
            throw new Error('Invalid typed clarification contract.');
          }
          return { status: 'needs_input', question: first.question, issues: missing.map(x => x.name) };
        }
      }
      return options.executeAuthorized(entry, input, context, signal,
        (child, childInput) => router.callChild(context, child, childInput));
    },
    maxDepth: options.maxDepth, maxCalls: options.maxCalls,
    timeoutMs: options.timeoutMs, now: options.now, runOnce: options.runOnce,
  });

  async function root(session: unknown, target: ChatTarget, input: unknown, requestKey?: string) {
    return requestKey === undefined
      ? router.call(session, target, input)
      : router.callIdempotent(session, target, input, requestKey);
  }

  return Object.freeze({
    async list(session: unknown) {
      const caller = await options.verifyCaller(session);
      verified(caller);
      return directory(caller);
    },
    /** Defaults to the app agent; an explicit @mention must resolve uniquely. */
    async chat(session: unknown, message: string, requestKey?: string): Promise<RoutedChatReply> {
      if (typeof message !== 'string' || !message.trim()) throw new Error('A chat message is required.');
      const caller = await options.verifyCaller(session);
      verified(caller);
      const agents = await directory(caller);
      const direct = mention(message);
      const matches = direct
        ? agents.filter(entry => [entry.alias, entry.name, entry.canonicalName]
            .some(value => value && normalize(value) === normalize(direct.name)))
        : agents.filter(entry => entry.kind === 'app' && entry.appId === caller.appId);
      if (matches.length !== 1) {
        throw new Error(direct ? 'Unknown or ambiguous authorized agent mention.' :
          'Exactly one authorized application agent is required.');
      }
      const selected = matches[0];
      const input = direct ? direct.input : message;
      // Even clarifications receive a router-issued invocation ID and verified caller.
      if (!input) return root(session, { appId: selected.appId, agentId: selected.id }, input, requestKey);
      return root(session, { appId: selected.appId, agentId: selected.id }, input, requestKey);
    },
    /** Graph, HTTP and natural-language callers use this same authorized execution path. */
    async invoke(session: unknown, target: ChatTarget, input: unknown, requestKey?: string) {
      return root(session, target, input, requestKey);
    },
  });
}
