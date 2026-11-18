import {describe,expect,it,vi} from 'vitest';
import {createSqlFodWorkflowDiscovery,type FodVerifiedWorkflowDiscovery} from './workflowDiscovery.js';
import {FodRuntime} from './runtime.js';
import type {FodWorkflowGrantStore} from './workflowGrants.js';

const alice:FodVerifiedWorkflowDiscovery={
  caller:{
    userId:'alice',appId:'aiko',workspaceId:'source-a',
    appOwnerUserId:'alice',workspaceOwnerUserId:'alice',
  },
  targetAppId:'kone',targetAppOwnerUserId:'alice',
  targetWorkspaces:[{id:'owner-ws',ownerUserId:'alice'}],
};
function indexRow(overrides:Record<string,unknown>={}) {
  return {
    app_id:'kone',owner_user_id:'alice',workspace_id:'owner-ws',
    workflow_id:'flow-1',version:1,display_name:'My workflow',
    description:'Approved metadata',
    graph:{nodes:[{credential:'secret!'}]},other_secret:'not-a-descriptor',
    ...overrides,
  };
}
function harness() {
  let principal=alice,grantActive=true,luthActive=true,currentVersion=1,publicationVisible=true;
  const query=vi.fn(async(_sql:string,_args:readonly unknown[])=>({rows:[indexRow()]}));
  const fresh=vi.fn(async()=>{
    if(!luthActive) throw new Error('Luth owner session no longer verified');
  });
  const grantStore:Pick<FodWorkflowGrantStore,'isGranted'>={
    isGranted:vi.fn(async()=>grantActive),
  };
  const source=vi.fn(async(_ws:string,id:string,version:number)=>{
    return publicationVisible && version===currentVersion ? {id,version} : null;
  });
  const discovery=createSqlFodWorkflowDiscovery({
    targetAppId:'kone',query,
    verifyDiscovery:async()=>principal,
    verifyStillAuthorized:fresh,
    grantStore,getCurrentPublishedRevision:source,
  });
  return {
    discovery,query,fresh,grantStore,source,
    setPrincipal:(value:FodVerifiedWorkflowDiscovery)=>{principal=value;},
    setGrant:(value:boolean)=>{grantActive=value;},
    setLuth:(value:boolean)=>{luthActive=value;},
    setVersion:(value:number)=>{currentVersion=value;},
    setPublished:(value:boolean)=>{publicationVisible=value;},
  };
}

describe('grant-filtered FOD publication discovery',()=>{
  it('projects only pinned metadata and verifies the current owner grant twice',async()=>{
    const h=harness();
    const response=await h.discovery.discover({untrusted:'request'});
    expect(response).toEqual([{
      targetAppId:'kone',targetWorkspaceId:'owner-ws',workflowId:'flow-1',
      version:1,displayName:'My workflow',description:'Approved metadata',
    }]);
    expect(JSON.stringify(response)).not.toMatch(/secret|graph|credential|nodes|url/i);
    expect(h.fresh).toHaveBeenCalledTimes(2);
    expect(h.grantStore.isGranted).toHaveBeenCalledTimes(2);
    const {sql,args}=(()=>{const [sql,args]=h.query.mock.calls[0]!;return {sql,args};})();
    expect(args).toEqual(['kone','alice','aiko','source-a',['owner-ws']]);
    for (const keyword of [
      'workflow_publications','workflow_grants',
      "publication_state='published'","grant_state='active'",
      'grant_row.revoked_at IS NULL',
      'grant_row.caller_app_id=$3',
      'grant_row.source_workspace_id=$4',
      'publication.workspace_id=ANY($5::text[])',
    ]) expect(sql).toContain(keyword);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('denies forged caller, target app, cross-owner workspace and duplicate scope before SQL',async()=>{
    const h=harness();
    for(const bad of [
      {...alice,caller:{...alice.caller,appOwnerUserId:'bob'}},
      {...alice,targetAppId:'foreign-app'},
      {...alice,targetWorkspaces:[{id:'owner-ws',ownerUserId:'bob'}]},
      {...alice,targetWorkspaces:[{id:'owner-ws',ownerUserId:'alice'},{id:'owner-ws',ownerUserId:'alice'}]},
    ]) {
      h.setPrincipal(bad);
      await expect(h.discovery.discover({})).rejects.toThrow(/FOD discovery denied/);
    }
    expect(h.query).not.toHaveBeenCalled();
  });

  it('denies discovery after the current Luth session is revoked',async()=>{
    const h=harness();
    h.setLuth(false);
    await expect(h.discovery.discover({})).rejects.toThrow(/Luth owner session/);
  });

  it('returns no discovery data for no verified accessible target workspaces',async()=>{
    const h=harness();
    h.setPrincipal({...alice,targetWorkspaces:[]});
    expect(await h.discovery.discover({})).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('filters cached handles after revoke, unpublish, deleted source or version mismatch',async()=>{
    const h=harness();
    expect(await h.discovery.discover({})).toHaveLength(1);
    h.setGrant(false);
    // The SQL result may still be cached by the index. The target owns
    // the final authorization, and the revoked handle cannot survive it.
    expect(await h.discovery.discover({})).toEqual([]);
    h.setGrant(true);
    h.setPublished(false);
    expect(await h.discovery.discover({})).toEqual([]);
    h.setPublished(true);
    h.setVersion(2);
    expect(await h.discovery.discover({})).toEqual([]);
    expect(h.source).toHaveBeenCalled();
  });

  it('fails closed on foreign returned rows and malformed versions or source paths',async()=>{
    const h=harness();
    for (const bad of [
      {owner_user_id:'bob'},
      {app_id:'wrong'},
      {workspace_id:'another-ws'},
      {version:0},
      {workflow_id:'../secret'},
      {display_name:''},
    ]) {
      h.query.mockImplementationOnce(async()=>({rows:[indexRow(bad)]}));
      await expect(h.discovery.discover({})).rejects.toThrow(/malformed or unauthorized/);
    }
  });

  it('invalidates grants revoked during the owning-workspace lookup',async()=>{
    const h=harness();
    let checks=0;
    vi.mocked(h.grantStore.isGranted).mockImplementation(async()=>++checks===1);
    expect(await h.discovery.discover({})).toEqual([]);
    expect(checks).toBe(2);
  });

  it('deduplicates rows while retaining separate immutable versions when actually current',async()=>{
    const h=harness();
    h.query.mockResolvedValueOnce({rows:[indexRow(),indexRow(),indexRow({workflow_id:'another'})]});
    const found=await h.discovery.discover({});
    expect(found.map(item=>item.workflowId)).toEqual(['flow-1','another']);
  });

  it('uses the real owning FOD workspace record to reject unpublish and deletion',async()=>{
    const files=new Map<string,string>();
    const key=(ws:string,path:string)=>JSON.stringify([ws,path]);
    const workspace={
      listFiles:async()=>[],
      readFile:async(ws:string,path:string)=>{
        const content=files.get(key(ws,path));
        if(!content) throw Object.assign(new Error('missing'),{code:'ENOENT'});
        return content;
      },
      writeFile:async(ws:string,path:string,value:string)=>{files.set(key(ws,path),value);return {success:true};},
      deleteFile:async(ws:string,path:string)=>({success:files.delete(key(ws,path))}),
    };
    const runtime=new FodRuntime({
      workspaceId:'owner-ws',workspaceService:workspace,
      publication:{appId:'kone',ownerUserId:'alice',sink:{synchronize:async()=>{}}},
      authorizePublication:async()=>{},
    });
    await runtime.saveFlow({
      id:'flow-1',name:'My workflow',version:1,
      nodes:[],edges:[],createdAt:'2026-11-18T00:00:00Z',updatedAt:'2026-11-18T00:00:00Z',
    });
    await runtime.publishFlow('flow-1');
    const h=harness();
    h.source.mockImplementation((ws,id,version)=>runtime.flowStore.getCurrentPublishedRevision(ws,id,version));
    expect(await h.discovery.discover({})).toHaveLength(1);
    await runtime.unpublishFlow('flow-1');
    expect(await h.discovery.discover({})).toEqual([]);
    await runtime.deleteFlow('flow-1');
    expect(await h.discovery.discover({})).toEqual([]);
  });

  it('refuses to instantiate without trusted server-only Luth and grant providers',()=>{
    expect(()=>createSqlFodWorkflowDiscovery({
      targetAppId:'kone',query:async()=>[],
      verifyDiscovery:null as never,verifyStillAuthorized:async()=>{},
      grantStore:{isGranted:async()=>true},
      getCurrentPublishedRevision:async()=>null,
    })).toThrow(/requires trusted Luth/);
  });
});
