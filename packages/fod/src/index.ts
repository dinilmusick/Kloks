export * from './smallScript.js';
export * from './quickJsAdapter.js';
export * from './types.js';
export * from './endpointNodeProvider.js';
export * from './flowStore.js';
export * from './publicationSync.js';
export * from './workflowGrants.js';
export * from './publishedWorkflowBackend.js';
export * from './publicationReconciler.js';
export * from './executor.js';
export * from './runtime.js';

import {createService,type IService,type ServiceDefinition} from '@ultrst-armada/krnl';

import {FodRuntime} from './runtime.js';

export function createFodServiceFacade(runtime:FodRuntime){
  const definition:ServiceDefinition={
    id:'kloks.fod',name:'FodService',version:'1.0.0',
    operations:{
      listFlows:{id:'FodService.listFlows',name:'listFlows',inputSchema:{type:'object',properties:{}},outputSchema:{type:'array'},handler:async()=>runtime.listFlows()},
      getFlow:{id:'FodService.getFlow',name:'getFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'},version:{type:'integer',minimum:1}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.getFlow(String(input.flowId),input.version===undefined?undefined:Number(input.version))},
      saveFlow:{id:'FodService.saveFlow',name:'saveFlow',inputSchema:{type:'object'},outputSchema:{type:'object'},handler:async(input:any)=>runtime.saveFlow(input.flow)},
      deleteFlow:{id:'FodService.deleteFlow',name:'deleteFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await runtime.deleteFlow(String(input.flowId))})},
      publishFlow:{id:'FodService.publishFlow',name:'publishFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.publishFlow(String(input.flowId))},
      unpublishFlow:{id:'FodService.unpublishFlow',name:'unpublishFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await runtime.unpublishFlow(String(input.flowId))})},
      grantFlow:{id:'FodService.grantFlow',name:'grantFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'},callerAppId:{type:'string'},sourceWorkspaceId:{type:'string'}},required:['flowId','callerAppId','sourceWorkspaceId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.grantFlow(String(input.flowId),String(input.callerAppId),String(input.sourceWorkspaceId))},
      revokeFlow:{id:'FodService.revokeFlow',name:'revokeFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'},callerAppId:{type:'string'},sourceWorkspaceId:{type:'string'}},required:['flowId','callerAppId','sourceWorkspaceId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await runtime.revokeFlow(String(input.flowId),String(input.callerAppId),String(input.sourceWorkspaceId))})},
      executeFlow:{id:'FodService.executeFlow',name:'executeFlow',inputSchema:{type:'object',properties:{flowId:{type:'string'},version:{type:'integer',minimum:1},input:{type:'object'}},required:['flowId']},outputSchema:{type:'object'},handler:async(input:any)=>runtime.executeFlow(String(input.flowId),input.input,{version:input.version===undefined?undefined:Number(input.version)})}
    }
  };
  const service:IService=createService(definition);
  return {id:definition.id,name:definition.name,version:definition.version,runtime:'server' as const,deployment:'local' as const,definition,createInstance:()=>createService(definition),execute:async<TIn=unknown,TOut=unknown>(op:string,input?:TIn)=>{await service.start();return service.call<TIn,TOut>(op,input)}};
}

export function createFodServiceFacadeForWorkspace(buildRuntime:(workspaceId:string)=>FodRuntime){
  const definition:ServiceDefinition={
    id:'kloks.fod',name:'FodService',version:'1.0.0',
    operations:{
      listFlows:{id:'FodService.listFlows',name:'listFlows',inputSchema:{type:'object',properties:{workspaceId:{type:'string'}},required:['workspaceId']},outputSchema:{type:'array'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).listFlows()},
      getFlow:{id:'FodService.getFlow',name:'getFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'},version:{type:'integer',minimum:1}},required:['workspaceId','flowId']},outputSchema:{type:'object'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).getFlow(String(input.flowId),input.version===undefined?undefined:Number(input.version))},
      saveFlow:{id:'FodService.saveFlow',name:'saveFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flow:{type:'object'}},required:['workspaceId','flow']},outputSchema:{type:'object'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).saveFlow(input.flow)},
      deleteFlow:{id:'FodService.deleteFlow',name:'deleteFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'}},required:['workspaceId','flowId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await buildRuntime(String(input.workspaceId)).deleteFlow(String(input.flowId))})},
      publishFlow:{id:'FodService.publishFlow',name:'publishFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'}},required:['workspaceId','flowId']},outputSchema:{type:'object'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).publishFlow(String(input.flowId))},
      unpublishFlow:{id:'FodService.unpublishFlow',name:'unpublishFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'}},required:['workspaceId','flowId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await buildRuntime(String(input.workspaceId)).unpublishFlow(String(input.flowId))})},
      grantFlow:{id:'FodService.grantFlow',name:'grantFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'},callerAppId:{type:'string'},sourceWorkspaceId:{type:'string'}},required:['workspaceId','flowId','callerAppId','sourceWorkspaceId']},outputSchema:{type:'object'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).grantFlow(String(input.flowId),String(input.callerAppId),String(input.sourceWorkspaceId))},
      revokeFlow:{id:'FodService.revokeFlow',name:'revokeFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'},callerAppId:{type:'string'},sourceWorkspaceId:{type:'string'}},required:['workspaceId','flowId','callerAppId','sourceWorkspaceId']},outputSchema:{type:'object'},handler:async(input:any)=>({success:await buildRuntime(String(input.workspaceId)).revokeFlow(String(input.flowId),String(input.callerAppId),String(input.sourceWorkspaceId))})},
      executeFlow:{id:'FodService.executeFlow',name:'executeFlow',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},flowId:{type:'string'},version:{type:'integer',minimum:1},input:{type:'object'}},required:['workspaceId','flowId']},outputSchema:{type:'object'},handler:async(input:any)=>buildRuntime(String(input.workspaceId)).executeFlow(String(input.flowId),input.input,{version:input.version===undefined?undefined:Number(input.version)})}
    }
  };
  const service:IService=createService(definition);
  return {id:definition.id,name:definition.name,version:definition.version,runtime:'server' as const,deployment:'local' as const,definition,createInstance:()=>createService(definition),execute:async<TIn=unknown,TOut=unknown>(op:string,input?:TIn)=>{await service.start();return service.call<TIn,TOut>(op,input)}};
}

export const FodServiceFacade = createFodServiceFacade(new FodRuntime({ workspaceId: 'default', workspaceService: null as any }));
