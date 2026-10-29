export * from './types.js';
export * from './endpointNodeProvider.js';
export * from './flowStore.js';
export * from './executor.js';
export * from './runtime.js';

import {createService,type IService,type ServiceDefinition} from '@ultrst-armada/krnl';
import {FodRuntime} from './runtime.js';

export function createFodServiceFacade(runtime:FodRuntime){
  const definition:ServiceDefinition={
    id:'kloks.fod',name:'FodService',version:'1.0.0',
    operations:{
      listFlows:{id:'FodService.listFlows',name:'listFlows',inputSchema:{type:'object',properties:{}},outputSchema:{type:'array'},handler:async()=>runtime.listFlows()},
      getFlow:{id:'FodService.getFlow',name:'getFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.getFlow(String(input.flowId))},
      saveFlow:{id:'FodService.saveFlow',name:'saveFlow',inputSchema:{type:'object'},outputSchema:{type:'object'},handler:async(input:any)=>runtime.saveFlow(input.flow)},
      deleteFlow:{id:'FodService.deleteFlow',name:'deleteFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await runtime.deleteFlow(String(input.flowId))})},
      executeFlow:{id:'FodService.executeFlow',name:'executeFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.executeFlow(String(input.flowId))}
    }
  };
  const service:IService=createService(definition);
  return {id:definition.id,name:definition.name,version:definition.version,runtime:'server' as const,deployment:'local' as const,definition,createInstance:()=>createService(definition),execute:async<TIn=unknown,TOut=unknown>(op:string,input?:TIn)=>{await service.start();return service.call<TIn,TOut>(op,input)}};
}
