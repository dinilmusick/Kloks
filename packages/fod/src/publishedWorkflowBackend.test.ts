import {describe,expect,it,vi} from 'vitest';
import {BackendRegistry,InProcessExecutor} from '@ultrst-armada/kloks/backend';
import {FodRuntime} from './runtime.js';
import type {FodExecutionResult} from './types.js';
import {
  publishedWorkflowChainKey,registerFodPublishedWorkflowBackendCommand,
  type FodPublishedWorkflowCall,type FodVerifiedPublishedInvocation,
} from './publishedWorkflowBackend.js';
import {createSqlFodPublishedWorkflowAuthorizer,type FodWorkflowGrantStore} from './workflowGrants.js';

function workspaceStore() {
  const files=new Map<string,string>();
  const k=(workspace:string,path:string)=>JSON.stringify([workspace,path]);
  return {
    listFiles:async(workspace:string,folder:string)=>[...files.keys()].flatMap(encoded=>{
      const [w,path]=JSON.parse(encoded) as [string,string];
      return w===workspace && path.startsWith(folder+'/')
        ? [{path,name:path.split('/').at(-1),isFolder:false}] : [];
    }),
    readFile:async(workspace:string,path:string)=>{
      const value=files.get(k(workspace,path));
      if (value===undefined) throw Object.assign(new Error('missing'),{code:'ENOENT'});
      return value;
    },
    writeFile:async(workspace:string,path:string,content:string)=>{
      files.set(k(workspace,path),content);return {success:true};
    },
    deleteFile:async(workspace:string,path:string)=>({success:files.delete(k(workspace,path))}),
  };
}

const call:FodPublishedWorkflowCall={
  targetAppId:'kone',targetWorkspaceId:'target-workspace-1',workflowId:'same-name',version:1,
  input:{value:12},
};
const owner='alice';
function createHarness() {
  const files=workspaceStore();
  let granted=true;
  let grantedVersion=call.version;
  let verified:FodVerifiedPublishedInvocation={
    caller:{
      userId:owner,appId:'aiko',workspaceId:'source-workspace-1',
      appOwnerUserId:owner,workspaceOwnerUserId:owner,
    },
    targetAppId:'kone',targetWorkspaceId:'target-workspace-1',
    targetAppOwnerUserId:owner,targetWorkspaceOwnerUserId:owner,chain:[],
  };
  const grantChecks=vi.fn(async(d:{callerUserId:string;version:number})=>
    granted && d.callerUserId===owner && d.version===grantedVersion);
  const grantStore:FodWorkflowGrantStore={
    grant:async()=>{},revoke:async()=>{granted=false;return true;},
    isGranted:grantChecks,
  };
  const publication={appId:'kone',ownerUserId:owner,sink:{synchronize:async()=>{}}};
  const publisher=(workspaceId:string)=>new FodRuntime({
    workspaceId,workspaceService:files,publication,authorizePublication:async()=>{},
  });
  const registry=new BackendRegistry();
  const withScope=vi.fn(async<T>(_verified:FodVerifiedPublishedInvocation,_chain:readonly string[],_signal:AbortSignal,run:()=>Promise<T>)=>run());
  const buildRuntime=vi.fn(async(workspaceId:string,current:FodVerifiedPublishedInvocation)=>new FodRuntime({
    workspaceId,workspaceService:files,publication,
    authorizePublishedExecution:createSqlFodPublishedWorkflowAuthorizer({
      targetAppId:'kone',targetOwnerUserId:owner,grantStore,
      getVerifiedCaller:async()=>current.caller,
    }),
  }));
  const verifyInvocation=vi.fn(async()=>verified);
  registerFodPublishedWorkflowBackendCommand(registry,{
    targetAppId:'kone',grantStore,verifyInvocation,buildRuntime,
    withExecutionScope:withScope,maxDepth:4,timeoutMs:2000,
  });
  const executor=new InProcessExecutor(registry);
  const execute=(payload:unknown=call)=>executor.execute<unknown,FodExecutionResult>({
    id:'request-1',type:'COMMAND',operation:'fod.executePublishedWorkflow',
    timestamp:Date.now(),sessionId:'untrusted-session',payload,
  });
  const save=async(workspaceId='target-workspace-1',id='same-name',version=1)=>{
    const runtime=publisher(workspaceId);
    const result=await runtime.saveFlow({
      id,name:id,version,createdAt:'2026-11-18T00:00:00Z',
      updatedAt:'2026-11-18T00:00:00Z',nodes:[],edges:[],
    });
    return {runtime,result};
  };
  return {
    files,publisher,save,execute,grantChecks,buildRuntime,withScope,verifyInvocation,
    setGranted:(value:boolean)=>{granted=value;},
    setGrantedVersion:(value:number)=>{grantedVersion=value;},
    setVerified:(next:FodVerifiedPublishedInvocation)=>{verified=next;},
    getVerified:()=>verified,
  };
}

describe('Kloks BackendRegistry -> owning FOD published workflow command',()=>{
  it('invokes the existing target FOD engine with the exact published pinned version',async()=>{
    const h=createHarness();
    const {runtime}=await h.save();
    await runtime.publishFlow(call.workflowId);
    const result=await h.execute();
    expect(result).toMatchObject({success:true,flowId:'same-name',errors:[]});
    expect(h.verifyInvocation).toHaveBeenCalledOnce();
    // First check belongs to the BackendRegistry boundary; second is the
    // mandatory target-side Luth and publication/grant reauthorization.
    expect(h.grantChecks).toHaveBeenCalledTimes(2);
    expect(h.buildRuntime).toHaveBeenCalledWith(call.targetWorkspaceId,h.getVerified());
    expect(h.withScope.mock.calls[0]?.[1]).toEqual([publishedWorkflowChainKey(call)]);
  });

  it('denies private workflows and withdrawn workflows despite a cached descriptor',async()=>{
    const h=createHarness();
    const {runtime}=await h.save();
    await expect(h.execute()).rejects.toThrow(/publication unavailable/);
    await runtime.publishFlow(call.workflowId);
    expect((await h.execute()).success).toBe(true);
    await runtime.unpublishFlow(call.workflowId);
    await expect(h.execute()).rejects.toThrow(/publication unavailable/);
  });

  it('reloads the current workspace revision and denies a stale version',async()=>{
    const h=createHarness();
    const {runtime,result}=await h.save();
    await runtime.publishFlow(result.id);
    const version2=await runtime.saveFlow({...result,name:'version two'});
    expect(version2.version).toBe(2);
    await expect(h.execute()).rejects.toThrow(/publication unavailable/);
    h.setGrantedVersion(2);
    const updated={...call,version:2};
    // Grant now applies to v2; a v1 descriptor cannot execute v2.
    const out=await h.execute(updated);
    expect(out).toMatchObject({success:true,flowId:'same-name'});
  });

  it('denies after revoke and allows a subsequent re-grant without trusting cached metadata',async()=>{
    const h=createHarness();
    const {runtime}=await h.save();
    await runtime.publishFlow(call.workflowId);
    expect((await h.execute()).success).toBe(true);
    h.setGranted(false);
    await expect(h.execute()).rejects.toThrow(/no active owner grant/);
    h.setGranted(true);
    expect((await h.execute()).success).toBe(true);
  });

  it('isolates two users and same-named workspaces by immutable workspace ID',async()=>{
    const h=createHarness();
    const {runtime}=await h.save();
    await runtime.publishFlow(call.workflowId);
    h.setVerified({...h.getVerified(),caller:{...h.getVerified().caller,userId:'bob'}});
    await expect(h.execute()).rejects.toThrow(/same-owner/);
    h.setVerified({...h.getVerified(),caller:{...h.getVerified().caller,userId:owner}});
    await expect(h.execute({...call,targetWorkspaceId:'target-workspace-2'})).rejects.toThrow(/same-owner/);
    const {runtime:second}=await h.save('target-workspace-2',call.workflowId);
    await second.publishFlow(call.workflowId);
    // A same-named workflow in another workspace cannot be addressed by
    // changing the untrusted descriptor when verified target scope differs.
    await expect(h.execute({...call,targetWorkspaceId:'target-workspace-2'})).rejects.toThrow(/same-owner/);
    expect((await h.execute()).success).toBe(true);
  });

  it('rejects absent host authentication, spoofed target app, and mismatched workspace ownership',async()=>{
    const h=createHarness();
    h.setVerified({...h.getVerified(),targetWorkspaceOwnerUserId:'bob'});
    await expect(h.execute()).rejects.toThrow(/same-owner/);
    await expect(h.execute({...call,targetAppId:'srkl'})).rejects.toThrow(/target app mismatch/);
    await expect(h.execute({...call,workflowId:'../secrets'})).rejects.toThrow(/Invalid published workflow handle/);
    h.setVerified({...h.getVerified(),chain:null as unknown as string[]});
    await expect(h.execute()).rejects.toThrow(/call chain is required/);
  });

  it('blocks direct, indirect and version-skipping cycles before invoking the engine',async()=>{
    const h=createHarness();
    const key=publishedWorkflowChainKey(call);
    h.setVerified({...h.getVerified(),chain:[key]});
    await expect(h.execute({...call,version:2})).rejects.toThrow(/Cyclic/);
    h.setVerified({...h.getVerified(),chain:[key,JSON.stringify(['aiko','source-workspace-1','other'])]});
    await expect(h.execute()).rejects.toThrow(/Cyclic/);
    expect(h.buildRuntime).not.toHaveBeenCalled();
  });

  it('enforces depth, expired deadline and cancellation from the verified host context',async()=>{
    const h=createHarness();
    h.setVerified({...h.getVerified(),chain:['a','b','c','d']});
    await expect(h.execute()).rejects.toThrow(/depth limit/);
    h.setVerified({...h.getVerified(),chain:[],deadlineAt:Date.now()-1});
    await expect(h.execute()).rejects.toThrow(/deadline exceeded/);
    const aborted=new AbortController();aborted.abort();
    h.setVerified({...h.getVerified(),deadlineAt:undefined,signal:aborted.signal});
    await expect(h.execute()).rejects.toThrow(/cancelled/);
  });

  it('fails closed when the owning runtime lacks its independent target authorization',async()=>{
    const registry=new BackendRegistry();
    const files=workspaceStore();
    const ownerRuntime=new FodRuntime({
      workspaceId:call.targetWorkspaceId,workspaceService:files,
      publication:{appId:'kone',ownerUserId:owner,sink:{synchronize:async()=>{}}},
      authorizePublication:async()=>{},
    });
    await ownerRuntime.saveFlow({
      id:call.workflowId,name:'same-name',version:1,nodes:[],edges:[],
      createdAt:'2026-11-18T00:00:00Z',updatedAt:'2026-11-18T00:00:00Z',
    });
    await ownerRuntime.publishFlow(call.workflowId);
    registerFodPublishedWorkflowBackendCommand(registry,{
      targetAppId:'kone',
      grantStore:{grant:async()=>{},revoke:async()=>false,isGranted:async()=>true},
      verifyInvocation:async()=>createHarness().getVerified(),
      buildRuntime:async()=>ownerRuntime,
      withExecutionScope:async(_v,_chain,_signal,run)=>run(),
    });
    const executor=new InProcessExecutor(registry);
    await expect(executor.execute({
      id:'call',type:'COMMAND',operation:'fod.executePublishedWorkflow',
      payload:call,sessionId:'untrusted',timestamp:Date.now(),
    })).rejects.toThrow(/authorization not configured/);
  });

  it('requires all trusted host callbacks and never registers an unsafe command',()=>{
    const registry=new BackendRegistry();
    expect(()=>registerFodPublishedWorkflowBackendCommand(registry,{
      targetAppId:'kone',grantStore:null as unknown as FodWorkflowGrantStore,
      verifyInvocation:async()=>createHarness().getVerified(),
      buildRuntime:async()=>createHarness().publisher(call.targetWorkspaceId),
      withExecutionScope:async(_v,_chain,_signal,run)=>run(),
    })).toThrow(/mandatory/);
    expect(registry.getCommand('fod','executePublishedWorkflow')).toBeUndefined();
  });
});
