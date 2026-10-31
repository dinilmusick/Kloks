import type {AgentContext,Requirement} from './types.js';
import {CapabilityRegistry} from './registry.js';

export interface ResolutionResult { resolved:boolean; value?:unknown; source?:string; reason?:string; }

export interface RequirementSource {
  canResolve(requirement:Requirement,context:AgentContext):Promise<boolean>;
  resolve(requirement:Requirement,context:AgentContext):Promise<unknown>;
  name:string;
}

export class RequirementResolver {
  constructor(private readonly registry:CapabilityRegistry,private readonly sources:RequirementSource[]=[]){}
  async resolve(requirement:Requirement,context:AgentContext):Promise<ResolutionResult>{
    for(const source of this.sources){
      if(await source.canResolve(requirement,context))
        return {resolved:true,value:await source.resolve(requirement,context),source:source.name};
    }
    const candidates=this.registry.list().filter(c=>(c.inputSchema?.properties?.[requirement.sourceField??'']!==undefined));
    if(candidates.length===0)
      return {resolved:false,reason:'NO_INTERNAL_RESOLUTION'};
    return {resolved:false,reason:'CAPABILITY_REQUIRES_EXECUTION',source:candidates[0].id};
  }
}
