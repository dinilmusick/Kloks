/**
 * Server-owned immediate-caller routing for Aiko agent chat.
 * Caller identity is obtained from an authenticated adapter, never from a
 * model reply or a client-supplied reply-to field.
 */
export interface VerifiedChatCaller {
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
  readonly agentId?: string;
}

export interface ChatTarget {
  readonly appId: string;
  readonly agentId: string;
}

export type ChatResult =
  | { readonly status: 'completed'; readonly output: unknown }
  | { readonly status: 'needs_input'; readonly question: string; readonly issues?: readonly string[] };

export interface ChatCallContext {
  readonly callId: string;
  readonly traceId: string;
  readonly caller: VerifiedChatCaller;
  readonly target: ChatTarget;
  readonly depth: number;
  readonly ancestry: readonly string[];
  readonly deadlineAt: number;
}
export interface RoutedChatReply {
  readonly callId: string;
  readonly traceId: string;
  readonly replyTo: VerifiedChatCaller;
  readonly result: ChatResult;
}
export interface ImmediateCallerRouterOptions {
  /** Resolve and validate the Luth session and selected workspace server-side. */
  verifyCaller: (session: unknown) => Promise<VerifiedChatCaller | null> | VerifiedChatCaller | null;
  /** Recheck target access on every hop, including nested agent invocations. */
  authorize: (caller: VerifiedChatCaller, target: ChatTarget, context: ChatCallContext) => Promise<boolean> | boolean;
  /** Execute through the authorized facade, honoring the deadline signal. */
  dispatch: (target: ChatTarget, input: unknown, context: ChatCallContext, signal: AbortSignal) => Promise<ChatResult>;
  maxDepth?: number;
  maxCalls?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Canonical durable/transactional deduplication adapter; must reject key reuse with changed input. */
  runOnce?: (scope: { userId: string; callerAppId: string; callerAgentId?: string;
    workspaceId: string; targetAppId: string; agentId: string; requestKey: string }, input: unknown,
    execute: () => Promise<RoutedChatReply>) => Promise<RoutedChatReply>;
}
interface TraceBudget {
  traceId: string;
  deadlineAt: number;
  calls: number;
}
/** A router instance belongs to one trusted application runtime. */
export class ImmediateCallerRouter {
  private readonly active = new WeakSet<ChatCallContext>();
  private readonly budgets = new WeakMap<ChatCallContext, TraceBudget>();
  private readonly now: () => number;
  private readonly maxDepth: number;
  private readonly maxCalls: number;
  private readonly timeoutMs: number;
  constructor(private readonly options: ImmediateCallerRouterOptions) {
    this.now = options.now ?? Date.now;
    this.maxDepth = options.maxDepth ?? 8;
    this.maxCalls = options.maxCalls ?? 32;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (![this.maxDepth, this.maxCalls, this.timeoutMs].every(Number.isSafeInteger) ||
      this.maxDepth < 0 || this.maxCalls < 1 || this.timeoutMs < 1) {
      throw new Error('Invalid Aiko chat invocation limits.');
    }
  }
  async call(session: unknown, target: ChatTarget, input: unknown): Promise<RoutedChatReply> {
    const verified = await this.options.verifyCaller(session);
    if (!verified || !verified.userId || !verified.appId || !verified.workspaceId) {
      throw new Error('An authenticated caller and active workspace are required.');
    }
    // Never put a session token, cookie, or private verifier output into a
    // cross-app invocation context or its returned routing metadata.
    const caller: VerifiedChatCaller = Object.freeze({
      userId: verified.userId,
      appId: verified.appId,
      workspaceId: verified.workspaceId,
      ...(verified.agentId ? { agentId: verified.agentId } : {}),
    });
    const budget: TraceBudget = {
      traceId: crypto.randomUUID(),
      deadlineAt: this.now() + this.timeoutMs,
      calls: 0,
    };
    return this.invoke(caller, target, input, budget, [], 0);
  }
  /** Replay-safe root call, only when the host provides transactional deduplication. */
  async callIdempotent(session: unknown, target: ChatTarget, input: unknown,
    requestKey: string): Promise<RoutedChatReply> {
    if (!this.options.runOnce || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)) {
      throw new Error('A valid request key and trusted idempotency adapter are required.');
    }
    const caller = await this.options.verifyCaller(session);
    if (!caller?.userId || !caller.appId || !caller.workspaceId) {
      throw new Error('An authenticated caller and active workspace are required.');
    }
    if (!target.appId || !target.agentId) throw new Error('A target app and agent are required.');
    // Recheck the current grant even when the durable adapter returns a cached reply.
    const trusted = Object.freeze({ userId: caller.userId, appId: caller.appId,
      workspaceId: caller.workspaceId, ...(caller.agentId ? { agentId: caller.agentId } : {}) });
    const preflight: ChatCallContext = Object.freeze({
      callId: crypto.randomUUID(), traceId: crypto.randomUUID(), caller: trusted,
      target: Object.freeze({ ...target }), ancestry: Object.freeze([trusted.appId]),
      depth: 0, deadlineAt: this.now() + this.timeoutMs,
    });
    if (!await this.options.authorize(trusted, preflight.target, preflight)) {
      throw new Error('Agent invocation is not authorized for this caller and workspace.');
    }
    const scope = { userId: trusted.userId, callerAppId: trusted.appId,
      callerAgentId: trusted.agentId, workspaceId: trusted.workspaceId, targetAppId: target.appId,
      agentId: target.agentId, requestKey };
    return this.options.runOnce(scope, input, () => this.call(session, target, input));
  }
  /** Can only be called with an active, router-issued invocation context. */
  async callChild(parent: ChatCallContext, target: ChatTarget, input: unknown): Promise<RoutedChatReply> {
    const budget = this.budgets.get(parent);
    if (!budget || !this.active.has(parent)) {
      throw new Error('An active trusted parent invocation is required.');
    }
    const caller = Object.freeze({
      ...parent.caller,
      appId: parent.target.appId,
      agentId: parent.target.agentId,
    });
    return this.invoke(caller, target, input, budget, parent.ancestry, parent.depth + 1);
  }
  private async invoke(
    caller: VerifiedChatCaller, target: ChatTarget, input: unknown,
    budget: TraceBudget, ancestry: readonly string[], depth: number,
  ): Promise<RoutedChatReply> {
    if (!target.appId || !target.agentId) throw new Error('A target app and agent are required.');
    if (depth > this.maxDepth) throw new Error('Agent chat depth budget exceeded.');
    if (this.now() >= budget.deadlineAt) throw new Error('Agent chat deadline exceeded.');
    if (budget.calls >= this.maxCalls) throw new Error('Agent chat call budget exceeded.');
    // Same-app nesting is valid; a cross-app return to an earlier app is not.
    if (target.appId !== caller.appId && ancestry.includes(target.appId)) {
      throw new Error('Cyclic cross-app agent invocation denied.');
    }
    budget.calls += 1;
    const context: ChatCallContext = Object.freeze({
      callId: crypto.randomUUID(),
      traceId: budget.traceId,
      caller,
      target: Object.freeze({ ...target }),
      ancestry: Object.freeze([...ancestry, caller.appId]),
      depth,
      deadlineAt: budget.deadlineAt,
    });
    if (!await this.options.authorize(caller, context.target, context)) {
      throw new Error('Agent invocation is not authorized for this caller and workspace.');
    }
    this.budgets.set(context, budget);
    this.active.add(context);
    const controller = new AbortController();
    const remaining = Math.max(1, budget.deadlineAt - this.now());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error('Agent chat deadline exceeded.'));
        reject(new Error('Agent chat deadline exceeded.'));
      }, remaining);
    });
    try {
      const result = await Promise.race([
        this.options.dispatch(context.target, input, context, controller.signal),
        deadline,
      ]);
      if (controller.signal.aborted || this.now() > budget.deadlineAt) {
        throw new Error('Agent chat deadline exceeded.');
      }
      if (result?.status !== 'completed' && result?.status !== 'needs_input') {
        throw new Error('Agent returned an invalid chat result.');
      }
      if (result.status === 'needs_input' && (!result.question.trim() || result.question.length > 500)) {
        throw new Error('Agent returned an invalid clarification question.');
      }
      // Return through the awaiting invocation, not a user-selectable reply address.
      return Object.freeze({
        callId: context.callId,
        traceId: context.traceId,
        replyTo: caller,
        result,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.active.delete(context);
      this.budgets.delete(context);
    }
  }
}