export * from './types.js';
export * from './endpointNodeProvider.js';
export * from './flowStore.js';
export * from './executor.js';
export * from './runtime.js';

import {createService,createServiceDefinition,type IService,type ServiceDefinition} from '@ultrst-armada/krnl';
import {FodRuntime} from './runtime.js';

export const FodServiceDefinition:ServiceDefinition={
  id:'kloks.fod',
  name:'FodService',
  version:'1.0.0',
  operations:{
    listFlows:{id:'FodService.listFlows',name:'listFlows',handler:async()=>({})},
    getFlow:{id:'FodService.getFlow',name:'getFlow',handler:async()=>null},
    saveFlow:{id:'FodService.saveFlow',name:'saveFlow',handler:async(input:any)=>input},
    deleteFlow:{id:'FodService.deleteFlow',name:'deleteFlow',handler:async(input:any)=>({success:Boolean(input)})},
    executeFlow:{id:'FodService.executeFlow',name:'executeFlow',handler:async(input:any)=>({success:false,flowId:String(input?.flowId ?? '')})}
  }
};

export function createFodServiceFacade(runtime:FodRuntime){
  const service:IService=createService(FodServiceDefinition);
  return {
    id:FodServiceDefinition.id,
    name:FodServiceDefinition.name,
    version:FodServiceDefinition.version,
    runtime:'server' as const,
    deployment:'local' as const,
    definition:FodServiceDefinition,
    createInstance:()=>createService(FodServiceDefinition),
    execute:async<TIn=unknown,TOut=unknown>(op:string,input?:TIn)=>service.call<TIn,TOut>(op,input)
  };
}
