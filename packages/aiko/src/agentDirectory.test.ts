import { describe, expect, it, vi } from 'vitest';
import { createAikoAgentDirectory, type AikoDirectoryCaller } from './agentDirectory.js';
import type { AikoAgentDefinition, AikoSourceKind } from './types.js';

const caller: AikoDirectoryCaller = {
  userId: 'user-1',
  appId: 'skipo',
  workspaceId: 'workspace-1',
};

function agent(input: {
  id: string; sourceKind: AikoSourceKind; sourceId: string;
  name: string; agentType?: AikoAgentDefinition['agentType'];
}): AikoAgentDefinition {
  return {
    schemaVersion: '1.0.0',
    id: input.id,
    name: input.name,
    description: input.name + ' description',
    agentType: input.agentType ?? (input.sourceKind === 'endpoint' ? 'ENDPOINT' : 'TOOL'),
    tool: {
      id: 'tool-' + input.id,
      name: input.name,
      execute: async value => value,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    },
    intelligenceSpec: {},
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
  };
}

describe('caller-authorized Aiko agent directory', () => {
  it('projects app, endpoint and FOD workflow agents with stable canonical IDs', async () => {
    const agents = [
      agent({ id: 'aiko-gutts-api-depm', sourceKind: 'gutts-api', sourceId: 'depm', name: 'Depm Agent' }),
      agent({ id: 'aiko-endpoint-kone-api', sourceKind: 'endpoint', sourceId: 'kone-api', name: 'Kone API Agent' }),
      agent({ id: 'aiko-fod-flow-onboarding', sourceKind: 'fod-flow', sourceId: 'onboarding', name: 'Onboarding Flow Agent' }),
    ];
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => agents,
      authorize: () => true,
    });
    const entries = await directory.list();
    expect(entries.map(item => [item.id, item.kind, item.sourceId])).toEqual([
      ['aiko-gutts-api-depm', 'app', 'depm'],
      ['aiko-endpoint-kone-api', 'endpoint', 'kone-api'],
      ['aiko-fod-flow-onboarding', 'workflow', 'onboarding'],
    ]);
    expect(entries.map(item => item.name)).toEqual([
      'Depm Agent', 'Kone API Agent', 'Onboarding Flow Agent',
    ]);
  });

  it('rechecks authorization on every request and omits revoked agents', async () => {
    let revoked = false;
    const target = agent({ id: 'stable-agent-1', sourceKind: 'endpoint', sourceId: 'endpoint-1', name: 'Endpoint One' });
    const authorize = vi.fn(() => !revoked);
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => [target],
      authorize,
    });
    expect(await directory.list()).toHaveLength(1);
    revoked = true;
    expect(await directory.list()).toEqual([]);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('uses only workspace-scoped aliases and preserves stable identity', async () => {
    const target = agent({ id: 'stable-app-agent', sourceKind: 'custom', sourceId: 'custom-source', name: 'Canonical App Agent' });
    const getWorkspaceAlias = vi.fn((workspaceId: string, id: string) =>
      workspaceId === 'workspace-1' && id === target.id ? 'My helper' : null,
    );
    const authorize = vi.fn(() => true);
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => [target],
      authorize,
      getWorkspaceAlias,
    });
    const [entry] = await directory.list();
    expect(entry).toMatchObject({
      id: 'stable-app-agent',
      kind: 'app',
      sourceId: 'custom-source',
      name: 'My helper',
      canonicalName: 'Canonical App Agent',
      alias: 'My helper',
    });
    expect(getWorkspaceAlias).toHaveBeenCalledWith('workspace-1', 'stable-app-agent');
    expect(authorize).toHaveBeenCalledWith(caller, target);
  });

  it('falls back to canonical names for alias collisions without hiding agents', async () => {
    const app = agent({ id: 'app-1', sourceKind: 'gutts-api', sourceId: 'app-1', name: 'App One' });
    const endpoint = agent({ id: 'endpoint-1', sourceKind: 'endpoint', sourceId: 'endpoint-1', name: 'Endpoint One' });
    const flow = agent({ id: 'flow-1', sourceKind: 'fod-flow', sourceId: 'flow-1', name: 'Flow One' });
    const aliases: Record<string, string> = {
      'app-1': 'Shared name',
      'endpoint-1': 'Shared name',
      'flow-1': 'Flow alias',
    };
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => [app, endpoint, flow],
      authorize: () => true,
      getWorkspaceAlias: (_workspaceId, id) => aliases[id],
    });
    const entries = await directory.list();
    expect(entries.map(item => item.name)).toEqual(['App One', 'Endpoint One', 'Flow alias']);
    expect(entries[0]).not.toHaveProperty('alias');
    expect(entries[1]).not.toHaveProperty('alias');
    expect(entries[2]?.alias).toBe('Flow alias');
  });

  it('does not consult aliases for denied agents or let aliases authorize access', async () => {
    const denied = agent({ id: 'revoked', sourceKind: 'endpoint', sourceId: 'secret-endpoint', name: 'Revoked Agent' });
    const getWorkspaceAlias = vi.fn(() => 'Expose me');
    const authorize = vi.fn(() => false);
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => [denied],
      authorize,
      getWorkspaceAlias,
    });
    expect(await directory.list()).toEqual([]);
    expect(getWorkspaceAlias).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith(caller, denied);
  });

  it('uses stable fallback labels and ignores malformed aliases', async () => {
    const unnamed = agent({ id: 'unnamed-endpoint', sourceKind: 'endpoint', sourceId: 'endpoint-7', name: '' });
    const directory = createAikoAgentDirectory({
      resolveCaller: () => caller,
      listAgents: () => [unnamed],
      authorize: () => true,
      getWorkspaceAlias: () => '  \u0000invalid  ',
    });
    expect(await directory.list()).toMatchObject([
      { id: 'unnamed-endpoint', name: 'Endpoint endpoint-7', canonicalName: 'Endpoint endpoint-7' },
    ]);
  });

  it('rejects duplicate stable IDs from the canonical registry', async () => {
    const first = agent({ id: 'duplicate', sourceKind: 'endpoint', sourceId: 'one', name: 'One' });
    const second = agent({ id: 'duplicate', sourceKind: 'fod-flow', sourceId: 'two', name: 'Two' });
    const directory = createAikoAgentDirectory({ resolveCaller: () => caller, listAgents: () => [first, second], authorize: () => true });
    await expect(directory.list()).rejects.toThrow('duplicate agent ID');
  });
});
