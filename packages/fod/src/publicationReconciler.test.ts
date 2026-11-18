import {describe,expect,it} from 'vitest';
import {FodPublicationReconciler,type FodVerifiedReconciliationWorkspace} from './publicationReconciler.js';
import {FodRuntime} from './runtime.js';
import type {FodPublicationDescriptor} from './publicationSync.js';

const ownerScope:FodVerifiedReconciliationWorkspace={
  userId:'luth-owner',appId:'aiko',appOwnerUserId:'luth-owner',
  workspaceId:'owner-workspace',workspaceOwnerUserId:'luth-owner',
};
function workspaceMemory() {
  const records=new Map<string,string>();
  return {
    records,
    listFiles:async(workspaceId:string,folder:string)=>[...records.keys()]
      .filter(key=>key.startsWith(workspaceId+':'+folder+'/'))
      .map(key=>{const path=key.slice(workspaceId.length+1);return {path,name:path.split('/').at(-1)!,isFolder:false};}),
    readFile:async(workspaceId:string,path:string)=>{
      const value=records.get(workspaceId+':'+path);
      if(value===undefined) throw Object.assign(new Error('Missing'),{code:'ENOENT'});
      return value;
    },
    writeFile:async(workspaceId:string,path:string,content:string)=>{
      records.set(workspaceId+':'+path,content);return {success:true};
    },
    deleteFile:async(workspaceId:string,path:string)=>({success:records.delete(workspaceId+':'+path)}),
  };
}
function flow(id:string) {
  return {
    id,name:'Flow '+id,version:1,nodes:[],edges:[],
    createdAt:'2026-11-18T00:00:00Z',updatedAt:'2026-11-18T00:00:00Z',
    metadata:{privateToken:'DO-NOT-INDEX'},
  };
}
function reconciler(overrides:Partial<ConstructorParameters<typeof FodPublicationReconciler>[0]>={}) {
  return new FodPublicationReconciler({
    targetAppId:'aiko',
    resolveAuthenticatedWorkspaces:async()=>[ownerScope],
    verifyStillAuthorized:async()=>{},
    createRuntime:async()=>({reconcilePublications:async()=>1}),
    ...overrides,
  });
}

describe('authenticated FOD publication replay',()=>{
  it('denies runtime replay by default without an authenticated workspace authorization hook',async()=>{
    const ws=workspaceMemory();
    const runtime=new FodRuntime({workspaceId:'owner-workspace',workspaceService:ws,
      publication:{appId:'aiko',ownerUserId:'luth-owner',sink:{synchronize:async()=>{throw new Error('unexpected sink');}}}});
    await expect(runtime.reconcilePublications()).rejects.toThrow(/authorization not configured/);
  });

  it('does not enumerate private workflows, access a sink or replay user metadata while logged out',async()=>{
    let runtimeBuilds=0;
    const coordinator=reconciler({
      resolveAuthenticatedWorkspaces:async()=>null,
      createRuntime:()=>{runtimeBuilds++;return {reconcilePublications:async()=>1};},
    });
    expect(await coordinator.reconcile()).toBe(0);
    expect(runtimeBuilds).toBe(0);
  });

  it('rejects a forged app/owner/workspace and duplicate scope before writing any metadata',async()=>{
    let calls=0;
    const candidate=reconciler({
      resolveAuthenticatedWorkspaces:async()=>[
        ownerScope,
        {...ownerScope,workspaceId:'another-workspace',workspaceOwnerUserId:'different-owner'},
      ],
      createRuntime:()=>{calls++;return {reconcilePublications:async()=>1};},
    });
    await expect(candidate.reconcile()).rejects.toThrow(/same-owner/);
    expect(calls).toBe(0);
    await expect(reconciler({resolveAuthenticatedWorkspaces:async()=>[
      ownerScope,{...ownerScope},
    ]}).reconcile()).rejects.toThrow(/Duplicate authenticated/);
    await expect(reconciler({resolveAuthenticatedWorkspaces:async()=>[
      {...ownerScope,appId:'forged-app'},
    ]}).reconcile()).rejects.toThrow(/same-owner/);
  });

  it('replays an interrupted publish and a deletion tombstone from the owning workspace after reconnect',async()=>{
    const ws=workspaceMemory();
    const events:FodPublicationDescriptor[]=[];
    let offline=false,loggedIn=true;
    const publication={appId:'aiko',ownerUserId:'luth-owner',sink:{
      synchronize:async(d:FodPublicationDescriptor)=>{
        if(offline) throw new Error('registry temporarily offline');
        events.push({...d});
      },
    }};
    const createRuntime=()=>new FodRuntime({
      workspaceId:ownerScope.workspaceId,workspaceService:ws,publication,
      authorizePublication:async()=>{},
      authorizePublicationReconciliation:async()=>{
        if(!loggedIn) throw new Error('Luth owner session revoked');
      },
    });
    const local=createRuntime();
    await local.saveFlow(flow('stable-id'));
    expect(events).toHaveLength(0); // No implicit publication.
    offline=true;
    await expect(local.publishFlow('stable-id')).rejects.toThrow(/offline/);
    offline=false;
    const coordinator=reconciler({
      resolveAuthenticatedWorkspaces:async()=>loggedIn?[ownerScope]:null,
      verifyStillAuthorized:async()=>{if(!loggedIn)throw new Error('Luth owner session revoked');},
      createRuntime:async()=>createRuntime(),
    });
    expect(await coordinator.reconcile()).toBe(1);
    expect(events.at(-1)).toMatchObject({
      appId:'aiko',ownerUserId:'luth-owner',workspaceId:'owner-workspace',
      workflowId:'stable-id',version:1,state:'published',
    });
    expect(JSON.stringify(events)).not.toContain('DO-NOT-INDEX');

    // A failed registry withdrawal cannot erase the owner's durable deletion intent.
    offline=true;
    await expect(local.deleteFlow('stable-id')).rejects.toThrow(/offline/);
    expect(await local.getFlow('stable-id')).toBeNull();
    expect(await local.flowStore.getCurrentPublishedRevision(ownerScope.workspaceId,'stable-id',1)).toBeNull();
    offline=false;
    const restarted=reconciler({
      resolveAuthenticatedWorkspaces:async()=>loggedIn?[ownerScope]:null,
      verifyStillAuthorized:async()=>{if(!loggedIn)throw new Error('unauthenticated');},
      createRuntime:async()=>createRuntime(),
    });
    expect(await restarted.reconcile()).toBe(1);
    expect(events.at(-1)).toMatchObject({workflowId:'stable-id',version:1,state:'withdrawn'});
    expect(await local.getFlow('stable-id')).toBeNull();
    expect(JSON.parse(ws.records.get('owner-workspace:FOD/stable-id.json')!).__publication)
      .toEqual({visible:false,deleted:true});
    loggedIn=false;
    expect(await restarted.reconcile()).toBe(0);
    expect(events).toHaveLength(2);
  });

  it('aborts after a session or workspace is revoked between two workspace replays',async()=>{
    let allowed=true,operations=0;
    const two={...ownerScope,workspaceId:'other-workspace'};
    const candidate=reconciler({
      resolveAuthenticatedWorkspaces:async()=>[ownerScope,two],
      verifyStillAuthorized:async()=>{
        if(!allowed) throw new Error('Luth workspace access revoked');
      },
      createRuntime:async()=>({reconcilePublications:async()=>{operations++;allowed=false;return 1;}}),
    });
    await expect(candidate.reconcile()).rejects.toThrow(/access revoked/);
    expect(operations).toBe(1);
  });

  it('checks Luth again for every flow before metadata replay, not only at startup',async()=>{
    const ws=workspaceMemory();
    let authorized=true,events=0;
    const publication={appId:'aiko',ownerUserId:'luth-owner',sink:{
      synchronize:async()=>{events++;if(events===3) authorized=false;},
    }};
    const local=new FodRuntime({workspaceId:'owner-workspace',workspaceService:ws,publication,authorizePublication:async()=>{}});
    await local.saveFlow(flow('first'));
    await local.publishFlow('first'); // event 1
    await local.saveFlow(flow('second'));
    await local.publishFlow('second'); // event 2
    const secured=new FodRuntime({
      workspaceId:'owner-workspace',workspaceService:ws,publication,
      authorizePublicationReconciliation:async()=>{
        if(!authorized) throw new Error('Luth session revoked during replay');
      },
    });
    await expect(secured.reconcilePublications()).rejects.toThrow(/incomplete: 1 replayed, 1 failed/);
    expect(events).toBe(3); // First replay allowed, second denied.
  });

  it('serializes overlapping reconnect signals and re-resolves authentication for the second call',async()=>{
    let authorized=true,resolveCalls=0,active=0,maximumActive=0;
    let release!:()=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    const candidate=reconciler({
      resolveAuthenticatedWorkspaces:async()=>{
        resolveCalls++;return authorized?[ownerScope]:null;
      },
      createRuntime:async()=>({reconcilePublications:async()=>{
        active++;maximumActive=Math.max(maximumActive,active);
        await hold;active--;return 1;
      }}),
    });
    const first=candidate.reconcile(),second=candidate.reconcile();
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    authorized=false;
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(0);
    expect(resolveCalls).toBe(2);
    expect(maximumActive).toBe(1);
  });
});
