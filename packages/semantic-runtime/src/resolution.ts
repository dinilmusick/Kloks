import type {AgentContext,CapabilityDescriptor,Requirement} from './types.js';
import {CapabilityRegistry} from './registry.js';

export interface ResolutionResult {
  resolved:boolean;
  value?:unknown;
  source?:string;
  reason?:string;
  capabilityId?:string;
}

export interface RequirementSource {
  canResolve(requirement:Requirement,context:AgentContext):Promise<boolean>;
  resolve(requirement:Requirement,context:AgentContext):Promise<unknown>;
  name:string;
}

export interface RequirementCapabilityExecutor {
  execute(capability:CapabilityDescriptor,input:unknown,context:AgentContext):Promise<unknown>;
}

export class CapabilityRequirementSource implements RequirementSource {
  readonly name='capability-execution';

  constructor(
    private readonly registry:CapabilityRegistry,
    private readonly executor:RequirementCapabilityExecutor,
  ) {}

  async canResolve(requirement:Requirement):Promise<boolean> {
    return this.registry.findProviders(requirement.semanticType).length>0;
  }

  async resolve(requirement:Requirement,context:AgentContext):Promise<unknown> {
    const candidates=this.registry.findProviders(requirement.semanticType);
    if(candidates.length===0) throw new Error(`No capability provides ${requirement.semanticType}`);
    const capability=candidates[0];
    const input:Record<string,unknown>={};
    for(const template of capability.requirements??[]) {
      if(!template.required) continue;
      const existing=context.task.requirements.find(r=>r.semanticType===template.semanticType && r.value!==undefined);
      if(existing){ input[template.sourceField??template.id]=existing.value; continue; }
      throw new Error(`CAPABILITY_REQUIRES_EXECUTION:${capability.id}:${template.semanticType}`);
    }
    return this.executor.execute(capability,input,context);
  }
}

export class RequirementResolver {
  constructor(
    private readonly registry:CapabilityRegistry,
    private readonly sources:RequirementSource[]=[]
  ){}

  async resolve(requirement:Requirement,context:AgentContext):Promise<ResolutionResult>{
    if(requirement.value!==undefined)
      return {resolved:true,value:requirement.value,source:'task-context'};
    for(const source of this.sources){
      if(await source.canResolve(requirement,context))
        return {resolved:true,value:await source.resolve(requirement,context),source:source.name};
    }
    const providers=this.registry.findProviders(requirement.semanticType);
    if(providers.length) return {resolved:false,reason:'CAPABILITY_REQUIRES_EXECUTION',capabilityId:providers[0].id};
    const candidates=this.registry.list().filter(capability=>capability.inputSchema?.properties?.[requirement.sourceField??'']!==undefined);
    if(candidates.length) return {resolved:false,reason:'CAPABILITY_REQUIRES_EXECUTION',capabilityId:candidates[0].id};
    return {resolved:false,reason:'NO_INTERNAL_RESOLUTION'};
  }
}
