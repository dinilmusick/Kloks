import type { AikoAgentDefinition } from './types.js';

/** Labels are presentation only. Neither labels nor aliases grant authority. */
export type AikoChatAgentKind = 'app' | 'endpoint' | 'workflow';
export interface AikoChatAgentTarget {
  readonly id: string;
  readonly kind: AikoChatAgentKind;
  readonly name: string;
  readonly alias?: string;
}

export interface AikoChatDirectoryOptions {
  readonly appAgentId?: string;
  readonly appName?: string;
  readonly aliases?: Readonly<Record<string, string>>;
  /** Required caller/workspace-scoped authorization, evaluated anew each request. */
  readonly authorize: (agent: AikoAgentDefinition) => Promise<boolean>;
}

export interface AikoAgentSource {
  listAgents(): Promise<AikoAgentDefinition[]>;
}

function kindOf(agent: AikoAgentDefinition, appAgentId?: string): AikoChatAgentKind | null {
  if (agent.id === appAgentId && agent.agentType === 'AIKO') return 'app';
  if (agent.sourceKind === 'endpoint') return 'endpoint';
  if (agent.sourceKind === 'fod-flow') return 'workflow';
  return null;
}

function normalized(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Project a live, explicitly authorized Aiko registry into Floks chat targets. */
export async function listAuthorizedAikoChatAgents(
  source: AikoAgentSource,
  options: AikoChatDirectoryOptions,
): Promise<AikoChatAgentTarget[]> {
  if (typeof options?.authorize !== 'function') {
    throw new Error('Caller-scoped Aiko chat authorization is required.');
  }
  const agents = await source.listAgents();
  const seen = new Set<string>();
  const result: AikoChatAgentTarget[] = [];
  for (const agent of agents) {
    const kind = kindOf(agent, options.appAgentId);
    if (!kind) continue;
    if (!agent.id || seen.has(agent.id)) throw new Error('Duplicate or missing Aiko agent ID.');
    seen.add(agent.id);
    if (!(await options.authorize(agent))) continue;
    const name = kind === 'app'
      ? normalized(options.appName) || normalized(agent.name) || agent.id
      : normalized(agent.tool.name) || normalized(agent.name) || agent.id;
    const alias = normalized(options.aliases?.[agent.id]);
    result.push({ id: agent.id, kind, name, ...(alias ? { alias } : {}) });
  }
  return result;
}
