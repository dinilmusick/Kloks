import {describe,it,expect,vi} from 'vitest';
import {BackendRegistry,InProcessExecutor} from '@ultrst-armada/kloks/backend';
import {registerFodPublishedWorkflowBackendCommand} from './publishedWorkflowBackend.js';
import type {FodVerifiedPublishedInvocation} from './publishedWorkflowBackend.js';

const verified:FodVerifiedPublishedInvocation={
  caller:{userId:'owner',appId:'aiko',workspaceId:'source',appOwnerUserId:'owner',workspaceOwnerUserId:'owner'},
  targetAppId:'kone',targetWorkspaceId:'owner-ws',
  targetAppOwnerUserId:'owner',targetWorkspaceOwnerUserId:'owner',chain:[],
};
const request={
  targetAppId:'kone',targetWorkspaceId:'owner-ws',
  workflowId:'saved-flow',version:3,input:{question:'pin'},
};

describe('owning-application workflow executor compatibility',()=>{
  it('invokes an existing app-owned pinned engine instead of building a duplicate FOD graph store',async()=>{
    const registry=new BackendRegistry();
    const ownerExec=vi.fn(async(id:string,version:number,input:unknown)=>{
      expect(id).toBe('saved-flow');
      expect(version).toBe(3);
      return {
        success:true,flowId:id,output:input,outputs:{result:input},
        errors:[],events:[],
      };
    });
    const grant=vi.fn(async(_scope:unknown)=>true);
    const grantStore={
      grant:async()=>{},revoke:async()=>false,isGranted:grant,
    };
    registerFodPublishedWorkflowBackendCommand(registry,{
      targetAppId:'kone',grantStore,
      verifyInvocation:async()=>verified,
      // The target's existing Aiko/FOD engine can satisfy this contract
      // structurally. W5 must not force a parallel FodFlowStore.
      buildRuntime:async()=>({
        executePublishedFlow:async(id,version,input)=>{
          const active=await grantStore.isGranted({
            appId:'kone',ownerUserId:'owner',
            targetWorkspaceId:'owner-ws',workflowId:id,version,
            callerAppId:'aiko',sourceWorkspaceId:'source',callerUserId:'owner',
          });
          if(!active) throw new Error('Owning-application grant revoked');
          return ownerExec(id,version,input);
        },
      }),
      withExecutionScope:async(_verified,_chain,_signal,run)=>run(),
    });
    const executor=new InProcessExecutor(registry);
    const result=await executor.execute({
      id:'request-one',type:'COMMAND',timestamp:Date.now(),
      sessionId:'untrusted',operation:'fod.executePublishedWorkflow',payload:request,
    });
    expect(result).toMatchObject({success:true,flowId:'saved-flow',output:{question:'pin'}});
    expect(ownerExec).toHaveBeenCalledOnce();
    expect(grant).toHaveBeenCalledTimes(2);
  });
});
