import type {AikoAgentDefinition,AikoCapability,AikoRuntimeOptions} from './types.js';

export class AikoRuntime {
  private readonly options:AikoRuntimeOptions;
  private readonly agents=new Map<string,AikoAgentDefinition>();

  constructor(options:AikoRuntimeOptions){this.options=options;}

  async listCapabilities():Promise<AikoCapability[]>{return await this.options.capabilities();}

  async refreshAgents():Promise<AikoAgentDefinition[]>{
    const capabilities=await this.listCapabilities();
    const next=new Map<string,AikoAgentDefinition>();
    for(const capability of capabilities){
      const tool={id:capability.id,name:capability.name,description:capability.description,inputSchema:capability.inputSchema,execute:capability.execute,sourceKind:capability.sourceKind,sourceId:capability.sourceId};
      const resolved=await this.options.resolver.resolve(undefined,{tool});
      const agent:AikoAgentDefinition={
        schemaVersion:'1.0.0',
        id:'aiko-'+capability.sourceKind+'-'+capability.sourceId,
        name:capability.name+' Agent',
        description:capability.description??('Aiko agent for '+capability.name),
        agentType:'ENDPOINT',
        tool,
        intelligenceSpec:resolved.spec,
        intelligenceSpecId:resolved.specId,
        sourceKind:capability.sourceKind,
        sourceId:capability.sourceId
      };
      next.set(agent.id,agent);
    }
    this.agents.clear();
    for(const agent of next.values())this.agents.set(agent.id,agent);
    return [...this.agents.values()];
  }

  async listAgents():Promise<AikoAgentDefinition[]>{return this.agents.size?[...this.agents.values()]:this.refreshAgents();}

  async executeAgent(agentId:string,input:unknown):Promise<unknown>{
    const agent=this.agents.get(agentId)??(await this.refreshAgents()).find(item=>item.id===agentId);
    if(!agent)throw new Error('Aiko agent not found: '+agentId);
    return agent.tool.execute(input);
  }

  listKeys(){return this.options.keys.listKeys();}
  getActiveKey(providerId:string){return this.options.keys.getActiveKey(providerId);}
  rotateKey(providerId:string){return this.options.keys.rotateKey(providerId);}
  syncFromAikoEngine(){return this.options.keys.syncFromAikoEngine();}
}
