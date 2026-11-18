import type { AikoAgentDefinition } from './types.js';

export type AikoDirectoryAgentKind = 'app' | 'endpoint' | 'workflow';

export interface AikoDirectoryCaller {
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
}

export interface AikoDirectoryEntry {
  /** Immutable ID from the canonical Aiko runtime; aliases never replace it. */
  readonly id: string;
  readonly kind: AikoDirectoryAgentKind;
  readonly sourceId: string;
  /** Workspace alias when unique, otherwise the canonical name. */
  readonly name: string;
  readonly canonicalName: string;
  readonly description: string;
  readonly alias?: string;
}

export interface AikoAgentDirectoryOptions {
  /** Resolve the current caller from the server-side Luth session; never accept request-body identity. */
  readonly resolveCaller: () => Promise<AikoDirectoryCaller | null> | AikoDirectoryCaller | null;
  /** The canonical request-time Aiko registry projection. No directory catalog is persisted. */
  readonly listAgents: () => Promise<readonly AikoAgentDefinition[]> | readonly AikoAgentDefinition[];
  /** Must authorize the current caller against each current agent on every list request. */
  readonly authorize: (caller: AikoDirectoryCaller, agent: AikoAgentDefinition) => Promise<boolean> | boolean;
  /** Workspace-scoped display metadata only. It must never grant or imply agent access. */
  readonly getWorkspaceAlias?: (workspaceId: string, stableAgentId: string) => Promise<string | null | undefined> | string | null | undefined;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Aiko directory agent ' + field + ' is required.');
  return value.trim();
}

function directoryKind(agent: AikoAgentDefinition): AikoDirectoryAgentKind {
  if (agent.agentType === 'ENDPOINT' || agent.sourceKind === 'endpoint') return 'endpoint';
  if (agent.sourceKind === 'fod-flow') return 'workflow';
  return 'app';
}

function canonicalAgentName(agent: AikoAgentDefinition, kind: AikoDirectoryAgentKind, sourceId: string): string {
  const name = typeof agent.name === 'string' ? agent.name.trim() : '';
  if (name) return name;
  const prefix = kind === 'endpoint' ? 'Endpoint' : kind === 'workflow' ? 'Workflow' : 'App';
  return prefix + ' ' + sourceId;
}

function safeAlias(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const alias = value.trim();
  if (!alias || alias.length > 80 || /[\u0000-\u001f\u007f]/.test(alias)) return undefined;
  return alias;
}

function collisionKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

/**
 * A caller-scoped projection over the canonical Aiko runtime.
 * Authorization is evaluated before aliases are read, and again on every list.
 * The projection never persists an agent catalog or turns a display alias into authority.
 */
export function createAikoAgentDirectory(options: AikoAgentDirectoryOptions) {
  return {
    async list(): Promise<readonly AikoDirectoryEntry[]> {
      const caller = await options.resolveCaller();
      if (!caller) throw new Error('A verified Luth caller and active workspace are required.');
      const trustedCaller = Object.freeze({
        userId: requiredText(caller.userId, 'caller user ID'),
        appId: requiredText(caller.appId, 'caller app ID'),
        workspaceId: requiredText(caller.workspaceId, 'caller workspace ID'),
      });
      const agents = await options.listAgents();
      if (!Array.isArray(agents)) throw new Error('The canonical Aiko registry returned an invalid agent collection.');

      const seen = new Set<string>();
      for (const agent of agents) {
        const id = requiredText(agent?.id, 'stable ID');
        if (seen.has(id)) throw new Error('The canonical Aiko registry returned a duplicate agent ID: ' + id);
        seen.add(id);
        requiredText(agent.sourceId, 'source ID');
      }

      // A failed authorization service rejects the request; a denied agent is omitted.
      const authorized = (await Promise.all(agents.map(async agent =>
        await options.authorize(trustedCaller, agent) ? agent : null,
      ))).filter((agent): agent is AikoAgentDefinition => agent !== null);

      const candidates = await Promise.all(authorized.map(async agent => {
        const kind = directoryKind(agent);
        const sourceId = requiredText(agent.sourceId, 'source ID');
        const canonicalName = canonicalAgentName(agent, kind, sourceId);
        let alias: string | undefined;
        if (options.getWorkspaceAlias) {
          try {
            alias = safeAlias(await options.getWorkspaceAlias(trustedCaller.workspaceId, agent.id));
          } catch {
            // Alias storage is non-authoritative display metadata; fall back to the canonical name.
            alias = undefined;
          }
        }
        return { id: agent.id, kind, sourceId, canonicalName,
          description: typeof agent.description === 'string' ? agent.description.trim() : '',
          alias };
      }));

      const names = candidates.map(candidate => candidate.alias ?? candidate.canonicalName);
      const counts = new Map<string, number>();
      for (const name of names) counts.set(collisionKey(name), (counts.get(collisionKey(name)) ?? 0) + 1);

      return Object.freeze(candidates.map(candidate => {
        const alias = candidate.alias &&
          counts.get(collisionKey(candidate.alias)) === 1 ? candidate.alias : undefined;
        return Object.freeze({
          id: candidate.id,
          kind: candidate.kind,
          sourceId: candidate.sourceId,
          canonicalName: candidate.canonicalName,
          name: alias ?? candidate.canonicalName,
          description: candidate.description,
          ...(alias ? { alias } : {}),
        });
      }));
    },
  };
}
