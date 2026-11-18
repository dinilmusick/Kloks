import { describe, expect, it } from 'vitest';
import { listAuthorizedAikoChatAgents } from './chatDirectory.js';
import type { AikoAgentDefinition, AikoSourceKind } from './types.js';

function agent(id: string, kind: AikoSourceKind, name: string, type: AikoAgentDefinition['agentType'] = 'TOOL'): AikoAgentDefinition {
  return {
    schemaVersion: '1.0.0', id, name: name + ' Agent', description: '',
    agentType: type, intelligenceSpec: {}, sourceKind: kind, sourceId: id,
    tool: { id, name, sourceKind: kind, sourceId: id, execute: async () => id },
  };
}

describe('caller-authorized Aiko chat directory', () => {
  it('lists app, endpoint and workflow agents with canonical fallback names and stable IDs', async () => {
    const source = { listAgents: async () => [
      agent('app-1', 'custom', 'Demo', 'AIKO'),
      agent('endpoint-1', 'endpoint', 'Inventory'),
      agent('workflow-1', 'fod-flow', 'Daily Report'),
      agent('utility', 'gutts-api', 'Helper'),
    ] };
    await expect(listAuthorizedAikoChatAgents(source, {
      appAgentId: 'app-1', appName: 'My Application',
      authorize: async () => true,
    })).resolves.toEqual([
      { id: 'app-1', kind: 'app', name: 'My Application' },
      { id: 'endpoint-1', kind: 'endpoint', name: 'Inventory' },
      { id: 'workflow-1', kind: 'workflow', name: 'Daily Report' },
    ]);
  });

  it('applies optional workspace-supplied aliases without changing canonical names or IDs', async () => {
    const source = { listAgents: async () => [agent('endpoint-1', 'endpoint', 'Inventory')] };
    const actual = await listAuthorizedAikoChatAgents(source, {
      aliases: { 'endpoint-1': '  Warehouse   Helper  ' },
      authorize: async () => true,
    });
    expect(actual).toEqual([{ id: 'endpoint-1', kind: 'endpoint', name: 'Inventory', alias: 'Warehouse Helper' }]);
  });

  it('rechecks permission on every list call and never reveals unauthorized metadata', async () => {
    let allowed = true;
    const source = { listAgents: async () => [agent('endpoint-1', 'endpoint', 'Secret Operation')] };
    const options = { authorize: async () => allowed };
    expect(await listAuthorizedAikoChatAgents(source, options)).toHaveLength(1);
    allowed = false;
    expect(await listAuthorizedAikoChatAgents(source, options)).toEqual([]);
  });

  it('fails closed without a caller authorization verifier or with duplicate agent IDs', async () => {
    const entry = agent('endpoint-1', 'endpoint', 'Inventory');
    const source = { listAgents: async () => [entry, entry] };
    await expect(listAuthorizedAikoChatAgents(source, { authorize: async () => true })).rejects.toThrow('Duplicate');
    await expect(listAuthorizedAikoChatAgents(source, {} as never)).rejects.toThrow('authorization is required');
  });

  it('retains distinct IDs when multiple agents share the same display alias', async () => {
    const source = { listAgents: async () => [
      agent('endpoint-1', 'endpoint', 'Inventory'),
      agent('endpoint-2', 'endpoint', 'Warehousing'),
    ] };
    const agents = await listAuthorizedAikoChatAgents(source, {
      aliases: { 'endpoint-1': 'Assistant', 'endpoint-2': 'Assistant' },
      authorize: async () => true,
    });
    expect(agents.map(item => item.id)).toEqual(['endpoint-1', 'endpoint-2']);
    expect(agents.map(item => item.name)).toEqual(['Inventory', 'Warehousing']);
  });
});
