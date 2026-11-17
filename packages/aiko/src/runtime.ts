import type { AikoAgentDefinition, AikoCapability, AikoRuntimeOptions, AikoTool } from './types.js';

export class AikoRuntime {
  private readonly customAgents = new Map<string, AikoAgentDefinition>();

  constructor(private readonly options: AikoRuntimeOptions) {
    for (const agent of options.customAgents ?? []) this.customAgents.set(agent.id, agent);
  }

  async listCapabilities(): Promise<AikoCapability[]> {
    const { capabilities } = this.options;
    return typeof capabilities === 'function' ? await capabilities() : capabilities;
  }

  async refreshAgents(): Promise<AikoAgentDefinition[]> {
    const agents = new Map(this.customAgents);
    for (const capability of await this.listCapabilities()) {
      const agent = await this.createCapabilityAgent(capability);
      if (agents.has(agent.id)) throw new Error('Duplicate Aiko agent ID: ' + agent.id);
      agents.set(agent.id, agent);
    }
    return [...agents.values()];
  }

  async listAgents(): Promise<AikoAgentDefinition[]> {
    return this.refreshAgents();
  }

  async executeAgent(agentId: string, input: unknown): Promise<unknown> {
    const agent = this.customAgents.get(agentId) ?? (await this.refreshAgents()).find(item => item.id === agentId);
    if (!agent) throw new Error('Aiko agent not found: ' + agentId);
    const resolvedInput = typeof input === 'string' && this.options.resolveNaturalLanguage
      ? await this.options.resolveNaturalLanguage(agent, input)
      : input;
    return agent.tool.execute(resolvedInput);
  }

  async createCustomAgent(name: string, capabilityIds: string[], specId?: string): Promise<AikoAgentDefinition> {
    const current = await this.listCapabilities();
    const grants = new Set(capabilityIds);
    if (!grants.size || [...grants].some(id => current.filter(capability => capability.id === id).length !== 1)) {
      throw new Error('A custom Aiko agent requires permitted capabilities for every requested tool.');
    }
    const allowed = current.filter(capability => grants.has(capability.id)).map(capability => this.guardCapability(capability));
    const resolved = await this.options.resolver.resolve(specId, {});
    const tool: AikoTool = {
      id: 'custom-' + name,
      name,
      description: 'Custom Aiko capability set',
      execute: async (input: unknown) => {
        const request = input as { toolId?: string; input?: unknown } | null;
        const capability = allowed.find(item => item.id === request?.toolId);
        if (!capability) throw new Error('Capability is not permitted for this custom agent.');
        return capability.execute(request?.input);
      },
      sourceKind: 'custom',
      sourceId: name,
    };
    const agent: AikoAgentDefinition = {
      schemaVersion: '1.0.0',
      id: 'aiko-custom-' + name.toLowerCase().replace(/\s+/g, '-'),
      name,
      description: 'Custom Aiko agent',
      agentType: 'AIKO',
      tool,
      intelligenceSpec: resolved.spec,
      intelligenceSpecId: resolved.specId,
      sourceKind: 'custom',
      sourceId: name,
      allowedToolIds: [...grants],
      custom: true,
    };
    this.customAgents.set(agent.id, agent);
    return agent;
  }

  private async createCapabilityAgent(capability: AikoCapability): Promise<AikoAgentDefinition> {
    const tool = this.guardCapability(capability);
    const resolved = await this.options.resolver.resolve(undefined, { tool });
    return {
      schemaVersion: '1.0.0',
      id: 'aiko-' + tool.sourceKind + '-' + tool.sourceId,
      name: tool.name + ' Agent',
      description: tool.description ?? ('Aiko agent for ' + tool.name),
      agentType: tool.sourceKind === 'endpoint' ? 'ENDPOINT' : 'TOOL',
      tool,
      intelligenceSpec: resolved.spec,
      intelligenceSpecId: resolved.specId,
      sourceKind: tool.sourceKind,
      sourceId: tool.sourceId,
    };
  }

  private guardCapability(capability: AikoCapability): AikoTool {
    const { id, sourceKind, sourceId } = capability;
    return {
      ...capability,
      execute: async input => {
        const matches = (await this.listCapabilities()).filter(item => item.id === id);
        const [current] = matches;
        if (matches.length !== 1 || current.sourceKind !== sourceKind || current.sourceId !== sourceId) {
          throw new Error('Aiko capability is no longer permitted.');
        }
        return current.execute(input);
      },
    };
  }

  listKeys() { return this.options.keys.listKeys(); }
  getActiveKey(providerId: string) { return this.options.keys.getActiveKey(providerId); }
  rotateKey(providerId: string) { return this.options.keys.rotateKey(providerId); }
  syncFromAikoEngine() { return this.options.keys.syncFromAikoEngine(); }
  addKey(input: { providerId: string; label: string; key: string; emailGroup?: string }) {
    if (!this.options.keys.addKey) throw new Error('Local Aiko key storage is unavailable.');
    return this.options.keys.addKey(input);
  }
}
