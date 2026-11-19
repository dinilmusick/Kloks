import {describe,expect,it} from 'vitest';
import {FodFlowStore} from './flowStore.js';
import {FodRuntime} from './runtime.js';
import {createSqlFodPublicationSink,type FodPublicationDescriptor} from './publicationSync.js';

function workspaceMemory() {
  const documents=new Map<string,string>();
  const key=(workspaceId:string,path:string)=>workspaceId+':'+path;
  return {
    documents,
    listFiles:async(workspaceId:string,folder:string)=>[...documents.keys()]
      .filter(k=>k.startsWith(workspaceId+':'+folder+'/'))
      .map(k=>{const path=k.slice(workspaceId.length+1);return {name:path.split('/').at(-1)!,path,isFolder:false};}),
    readFile:async(workspaceId:string,path:string)=>{
      const value=documents.get(key(workspaceId,path));
      if(value===undefined) throw Object.assign(new Error('Missing file'),{code:'ENOENT'});
      return value;
    },
    writeFile:async(workspaceId:string,path:string,value:string)=>{
      documents.set(key(workspaceId,path),value);
      return {success:true};
    },
    deleteFile:async(workspaceId:string,path:string)=>({success:documents.delete(key(workspaceId,path))}),
  };
}

function flow(id:string) {
  return {id,name:id,version:1,nodes:[],edges:[],createdAt:'2026-11-18T00:00:00Z',updatedAt:'2026-11-18T00:00:00Z'};
}

describe('durable FOD publication recovery',()=>{
  it('retains a hidden deletion tombstone after failed withdrawal and finishes it on reconnect',async()=>{
    const ws=workspaceMemory();
    const events:FodPublicationDescriptor[]=[];
    let offline=false;
    const publication={appId:'aiko',ownerUserId:'luth-owner',sink:{
      synchronize:async(d:FodPublicationDescriptor)=>{
        if (offline) throw new Error('registry offline');
        events.push({...d});
      },
    }};
    const store=new FodFlowStore(ws,publication);
    await store.save('ws',{...flow('to-delete'),metadata:{privateValue:'ERASE-ME'}});
    await store.publish('ws','to-delete');
    offline=true;
    await expect(store.delete('ws','to-delete')).rejects.toThrow('registry offline');
    const tombstone=JSON.parse(ws.documents.get('ws:FOD/to-delete.json')!);
    expect(tombstone.__publication).toEqual({visible:false,deletePending:true});
    expect(await store.get('ws','to-delete')).toBeNull();
    expect(await store.list('ws')).toEqual([]);
    expect(await store.getCurrentPublishedRevision('ws','to-delete',1)).toBeNull();
    await expect(store.publish('ws','to-delete')).rejects.toThrow(/deletion is pending/);
    await expect(store.save('ws',flow('to-delete'))).rejects.toThrow(/deletion is pending/);
    offline=false;
    const restarted=new FodFlowStore(ws,publication);
    expect(await restarted.reconcilePublications('ws')).toBe(1);
    expect(events.at(-1)).toMatchObject({workflowId:'to-delete',version:1,state:'withdrawn'});
    // Retain a redacted ID/version tombstone, not the source graph. Prevent
    // old caller grants from binding to a future workflow with the same ID.
    const retired=ws.documents.get('ws:FOD/to-delete.json');
    expect(retired).toBeDefined();
    expect(retired).not.toContain('ERASE-ME');
    const retiredRecord=JSON.parse(retired!);
    expect(retiredRecord.__publication).toEqual({visible:false,deleted:true});
    expect(retiredRecord.nodes).toEqual([]);
    expect(retiredRecord.edges).toEqual([]);
    expect(retiredRecord.__versions).toEqual([]);
    await expect(restarted.save('ws',flow('to-delete'))).rejects.toThrow(/permanently retired/);
    await expect(restarted.publish('ws','to-delete')).rejects.toThrow(/permanently retired/);
    expect(await restarted.reconcilePublications('ws')).toBe(0);
  });

  it('continues replaying healthy flows when a corrupt workspace record fails',async()=>{
    const ws=workspaceMemory();
    const events:FodPublicationDescriptor[]=[];
    const pub={appId:'aiko',ownerUserId:'luth-owner',sink:{synchronize:async(d:FodPublicationDescriptor)=>{events.push({...d});}}};
    const store=new FodFlowStore(ws,pub);
    await store.save('ws',flow('broken'));
    await store.publish('ws','broken');
    await store.save('ws',flow('healthy'));
    await store.publish('ws','healthy');
    ws.documents.set('ws:FOD/broken.json','{invalid JSON');
    events.length=0;
    await expect(new FodFlowStore(ws,pub).reconcilePublications('ws'))
      .rejects.toThrow('Publication reconciliation incomplete: 1 replayed, 1 failed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({workflowId:'healthy',state:'published'});
    expect(ws.documents.has('ws:FOD/broken.json')).toBe(true);
  });

  it('never treats a stale discovery index as permission to execute a withdrawn revision',async()=>{
    const ws=workspaceMemory();
    const pub={appId:'aiko',ownerUserId:'luth-owner',sink:{synchronize:async(_d:FodPublicationDescriptor)=>{}}};
    const local=new FodRuntime({workspaceId:'ws',workspaceService:ws,publication:pub,authorizePublication:async()=>{}});
    await local.saveFlow(flow('target'));
    await local.publishFlow('target');
    // Catalog visibility alone must never satisfy caller authorization.
    await expect(local.executePublishedFlow('target',1)).rejects.toThrow(/authorization not configured/);
    const authorized=new FodRuntime({workspaceId:'ws',workspaceService:ws,publication:pub,
      authorizePublishedExecution:async()=>{throw new Error('caller grant missing');}});
    await expect(authorized.executePublishedFlow('target',1)).rejects.toThrow('caller grant missing');
    const grantChecked=new FodRuntime({workspaceId:'ws',workspaceService:ws,publication:pub,
      authorizePublishedExecution:async()=>{}});
    await local.unpublishFlow('target');
    await expect(grantChecked.executePublishedFlow('target',1)).rejects.toThrow(/publication unavailable/);
    const v2=await local.publishFlow('target');
    expect(v2.version).toBe(2);
    await expect(grantChecked.executePublishedFlow('target',1)).rejects.toThrow(/publication unavailable/);
    await expect(grantChecked.executePublishedFlow('target',0)).rejects.toThrow(/Invalid requested/);
    // A withdrawal that occurs while the bound host checks caller grants also wins.
    const race=new FodRuntime({workspaceId:'ws',workspaceService:ws,publication:pub,
      authorizePublishedExecution:async()=>{await local.unpublishFlow('target');}});
    await expect(race.executePublishedFlow('target',2)).rejects.toThrow(/publication unavailable/);
  });

  it('inserts an equal-version withdrawal tombstone even when the publish never reached the registry',async()=>{
    const statements:Array<{sql:string;args:readonly unknown[]}>= [];
    const sink=createSqlFodPublicationSink(async(sql,args)=>{statements.push({sql,args});});
    await sink.synchronize({appId:'aiko',ownerUserId:'owner',workspaceId:'ws',
      workflowId:'f',version:2,displayName:'Flow',state:'withdrawn'});
    expect(statements).toHaveLength(1);
    const statement=statements[0]!;
    expect(statement.args.at(-1)).toBe('withdrawn');
    expect(statement.sql).toContain('withdrawal_marker AS');
    expect(statement.sql).toContain("WHERE $8::text='withdrawn'");
    expect(statement.sql).toContain("DO UPDATE SET publication_state='withdrawn'");
    expect(statement.sql).toContain('AND version<$5::integer');
    expect(statement.sql).not.toContain('version<=$5::integer');
    expect(statement.sql).toContain('ON CONFLICT (app_id,owner_user_id,workspace_id,workflow_id,version)');
    expect(statement.sql).toContain('DO NOTHING');
  });
});
