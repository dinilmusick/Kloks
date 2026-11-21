import {describe,expect,it} from 'vitest';
import {FodRuntime} from './runtime.js';
import {
  createSqlFodPublishedWorkflowAuthorizer,
  createSqlFodWorkflowGrantStore,
  type FodWorkflowGrantDescriptor,
  type FodWorkflowGrantScope,
  type FodVerifiedWorkflowCaller,
} from './workflowGrants.js';

function memoryWorkspace() {
  const files=new Map<string,string>();
  const key=(workspaceId:string,path:string)=>workspaceId+':'+path;
  return {
    listFiles:async(workspaceId:string,folder:string)=>[...files.keys()]
      .filter(k=>k.startsWith(workspaceId+':'+folder+'/'))
      .map(k=>{const path=k.slice(workspaceId.length+1);return {path,name:path.split('/').at(-1),isFolder:false};}),
    readFile:async(workspaceId:string,path:string)=>{
      const value=files.get(key(workspaceId,path));
      if (value===undefined) throw Object.assign(new Error('missing'),{code:'ENOENT'});
      return value;
    },
    writeFile:async(workspaceId:string,path:string,content:string)=>{
      files.set(key(workspaceId,path),content);return {success:true,path};
    },
    deleteFile:async(workspaceId:string,path:string)=>({success:files.delete(key(workspaceId,path))}),
  };
}

function flow(id:string) {
  return {id,name:id,version:1,createdAt:'2026-11-18T00:00:00.000Z',updatedAt:'2026-11-18T00:00:00.000Z',nodes:[],edges:[]};
}

const descriptor:FodWorkflowGrantDescriptor={
  appId:'kone',ownerUserId:'luth-owner',targetWorkspaceId:'kone-workspace',
  workflowId:'report',version:3,callerAppId:'aiko',sourceWorkspaceId:'aiko-workspace',
};
const scope:FodWorkflowGrantScope={
  appId:'kone',ownerUserId:'luth-owner',targetWorkspaceId:'kone-workspace',
  workflowId:'report',callerAppId:'aiko',sourceWorkspaceId:'aiko-workspace',
};
const verifiedCaller:FodVerifiedWorkflowCaller={
  userId:'luth-owner',appId:'aiko',workspaceId:'aiko-workspace',
  appOwnerUserId:'luth-owner',workspaceOwnerUserId:'luth-owner',
};

describe('SQL workflow grant store',()=>{
  it('upserts only a currently published owner version into the exact approved app/workspace scope',async()=>{
    const calls:Array<{sql:string;args:readonly unknown[]}>= [];
    const store=createSqlFodWorkflowGrantStore(async(sql,args)=>{
      calls.push({sql,args});
      return {rows:[{affected:1}]};
    });
    await store.grant(descriptor);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('FROM skipo_ecosystem.workflow_publications');
    expect(calls[0]!.sql).toContain("publication_state='published'");
    expect(calls[0]!.sql).toContain('FOR SHARE');
    expect(calls[0]!.sql).toContain('INSERT INTO skipo_ecosystem.workflow_grants');
    expect(calls[0]!.sql).toContain('granted_by_user_id');
    expect(calls[0]!.sql).toContain('ON CONFLICT');
    expect(calls[0]!.sql).toContain("WHERE grant_state='active'");
    expect(calls[0]!.sql).toContain("DO UPDATE SET grant_state='active'");
    expect(calls[0]!.sql).not.toContain("revoked_at=NULL");
    expect(calls[0]!.args).toEqual([
      'kone','luth-owner','kone-workspace','report',3,'aiko','aiko-workspace',
    ]);
  });

  it('revokes all versions only within the exact caller/source/target/workflow scope',async()=>{
    const calls:Array<{sql:string;args:readonly unknown[]}>= [];
    const store=createSqlFodWorkflowGrantStore(async(sql,args)=>{
      calls.push({sql,args});
      return {rows:[{affected:2}]};
    });
    expect(await store.revoke(scope)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('UPDATE skipo_ecosystem.workflow_grants');
    expect(calls[0]!.sql).toContain('grant_state=\'revoked\'');
    expect(calls[0]!.sql).toContain('revoked_by_user_id=$2');
    expect(calls[0]!.sql).toContain('source_workspace_id=$6');
    expect(calls[0]!.sql).toContain('caller_app_id=$5');
    expect(calls[0]!.args).toEqual([
      'kone','luth-owner','kone-workspace','report','aiko','aiko-workspace',
    ]);
  });

  it('rejects inactive publications and malformed scope without issuing unsafe SQL',async()=>{
    let calls=0;
    const store=createSqlFodWorkflowGrantStore(async()=>{
      calls++;
      return {rows:[{affected:0}]};
    });
    await expect(store.grant(descriptor)).rejects.toThrow(/not currently published/);
    await expect(store.grant({...descriptor,callerAppId:'https://aiko'})).rejects.toThrow(/caller_app_id/);
    await expect(store.revoke({...scope,sourceWorkspaceId:' '})).rejects.toThrow(/source workspace/);
    expect(calls).toBe(1);
  });

  it('rechecks publication and grant state on every call; revocation blocks cached descriptors immediately',async()=>{
    let active=true;
    const calls:string[]=[];
    const store=createSqlFodWorkflowGrantStore(async(sql)=>{
      calls.push(sql);
      if(sql.includes('WITH target_publication AS (')) return {rows:[{affected:1}]};
      if(sql.includes('UPDATE skipo_ecosystem.workflow_grants')) {
        active=false;
        return {rows:[{affected:1}]};
      }
      if(sql.includes('SELECT EXISTS')) return {rows:[{authorized:active}]};
      throw new Error('Unexpected grant SQL');
    });
    const caller=async()=>verifiedCaller;
    const authorize=createSqlFodPublishedWorkflowAuthorizer({
      grantStore:store,targetAppId:'kone',targetOwnerUserId:'luth-owner',getVerifiedCaller:caller,
    });
    await store.grant(descriptor);
    await authorize('kone-workspace','report',3);
    expect(await store.revoke(scope)).toBe(true);
    await expect(authorize('kone-workspace','report',3)).rejects.toThrow(/active owner grant not found/);
    expect(calls.filter(sql=>sql.includes('SELECT EXISTS'))).toHaveLength(2);
  });

  it('denies another Luth principal or a workspace owned by another principal without querying grants',async()=>{
    let queries=0;
    const store=createSqlFodWorkflowGrantStore(async()=>{
      queries++;
      return {rows:[{authorized:true}]};
    });
    const otherUser={...verifiedCaller,userId:'another-user'};
    const wrongWorkspace={...verifiedCaller,workspaceOwnerUserId:'another-user'};
    const make=(caller:FodVerifiedWorkflowCaller)=>createSqlFodPublishedWorkflowAuthorizer({
      grantStore:store,targetAppId:'kone',targetOwnerUserId:'luth-owner',
      getVerifiedCaller:async()=>caller,
    });
    await expect(make(otherUser)('kone-workspace','report',3)).rejects.toThrow(/same verified Luth owner/);
    await expect(make(wrongWorkspace)('kone-workspace','report',3)).rejects.toThrow(/same verified Luth owner/);
    expect(queries).toBe(0);
  });
});

describe('FOD owner grant controls',()=>{
  it('creates and revokes the exact current-version cross-app workspace grant after owner authorization',async()=>{
    const grants:FodWorkflowGrantDescriptor[]=[];
    const revocations:FodWorkflowGrantScope[]=[];
    const approvals:string[]=[];
    const runtime=new FodRuntime({
      workspaceId:'kone-workspace',workspaceService:memoryWorkspace(),
      publication:{appId:'kone',ownerUserId:'luth-owner',sink:{synchronize:async()=>{}}},
      authorizePublication:async()=>{},
      workflowGrantStore:{
        grant:async(d)=>{grants.push(d);},
        revoke:async(s)=>{revocations.push(s);return true;},
        isGranted:async()=>true,
      },
      authorizeWorkflowGrant:async(request)=>{
        approvals.push(request.action);
        return {
          userId:'luth-owner',targetAppId:'kone',targetWorkspaceId:'kone-workspace',
          callerAppId:'aiko',sourceWorkspaceId:'aiko-workspace',
          targetAppOwnerUserId:'luth-owner',targetWorkspaceOwnerUserId:'luth-owner',
          callerAppOwnerUserId:'luth-owner',sourceWorkspaceOwnerUserId:'luth-owner',
        };
      },
    });
    await runtime.saveFlow(flow('report'));
    await runtime.publishFlow('report');
    // An expiry requested by the owner may not silently fall back to an
    // indefinitely active grant until the N5 schema has an expiry authority.
    await expect(runtime.grantFlow(
      'report','aiko','aiko-workspace','2026-12-01T00:00:00Z',
    )).rejects.toThrow(/verified durable expiry schema/);
    expect(grants).toHaveLength(0);
    expect(approvals).toHaveLength(0);
    const created=await runtime.grantFlow('report','aiko','aiko-workspace');
    expect(created).toEqual({
      workflowId:'report',version:1,callerAppId:'aiko',sourceWorkspaceId:'aiko-workspace',
      targetWorkspaceId:'kone-workspace',state:'active',
    });
    expect(grants).toEqual([{
      appId:'kone',ownerUserId:'luth-owner',targetWorkspaceId:'kone-workspace',
      workflowId:'report',version:1,callerAppId:'aiko',sourceWorkspaceId:'aiko-workspace',
    }]);
    expect(await runtime.revokeFlow('report','aiko','aiko-workspace')).toBe(true);
    expect(revocations).toEqual([scope]);
    expect(approvals).toEqual(['grant','revoke']);
  });

  it('denies cross-user grants and fails closed when the owner authority is absent',async()=>{
    let writes=0;
    const dependencies={
      workflowGrantStore:{
        grant:async()=>{writes++;},revoke:async()=>false,isGranted:async()=>false,
      },
      authorizeWorkflowGrant:async()=>({
        userId:'luth-owner',targetAppId:'kone',targetWorkspaceId:'kone-workspace',
        callerAppId:'aiko',sourceWorkspaceId:'other-workspace',
        targetAppOwnerUserId:'luth-owner',targetWorkspaceOwnerUserId:'luth-owner',
        callerAppOwnerUserId:'other-user',sourceWorkspaceOwnerUserId:'other-user',
      }),
    };
    const workspace=memoryWorkspace();
    const denied=new FodRuntime({
      workspaceId:'kone-workspace',workspaceService:workspace,
      publication:{appId:'kone',ownerUserId:'luth-owner',sink:{synchronize:async()=>{}}},
      authorizePublication:async()=>{},
      ...dependencies,
    });
    await denied.saveFlow(flow('report'));
    await denied.publishFlow('report');
    await expect(denied.grantFlow('report','aiko','other-workspace')).rejects.toThrow(/same verified Luth owner/);
    expect(writes).toBe(0);
    const closed=new FodRuntime({workspaceId:'kone-workspace',workspaceService:workspace});
    await expect(closed.grantFlow('report','aiko','aiko-workspace')).rejects.toThrow(/authority is not configured/);
    await expect(closed.revokeFlow('report','aiko','aiko-workspace')).rejects.toThrow(/authority is not configured/);
  });
});
