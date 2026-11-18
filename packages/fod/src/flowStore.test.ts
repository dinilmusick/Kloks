import {describe,expect,it} from 'vitest';
import {FodFlowStore} from './flowStore.js';
import {createSqlFodPublicationSink,type FodPublicationDescriptor} from './publicationSync.js';
import {FodRuntime} from './runtime.js';

function memoryWorkspace() {
  const files=new Map<string,string>();
  const pathKey=(id:string,path:string)=>id+':'+path;
  return {
    files,
    listFiles:async(id:string,folder:string)=>[...files.keys()]
      .filter(key=>key.startsWith(id+':'+folder+'/'))
      .map(key=>{const path=key.slice(id.length+1);return {path,name:path.split('/').at(-1),isFolder:false};}),
    readFile:async(id:string,path:string)=>{
      const value=files.get(pathKey(id,path));
      if (value===undefined) throw Object.assign(new Error('missing'),{code:'ENOENT'});
      return value;
    },
    writeFile:async(id:string,path:string,content:string)=>{
      files.set(pathKey(id,path),content);return {success:true,path};
    },
    deleteFile:async(id:string,path:string)=>({success:files.delete(pathKey(id,path))}),
  };
}
function flow(id:string,name='Shared') {
  return {id,name,version:1,createdAt:'2026-11-18T00:00:00.000Z',updatedAt:'2026-11-18T00:00:00.000Z',nodes:[],edges:[]};
}

describe('FodFlowStore',()=>{
  it('persists a backwards-readable flow under its owning workspace FOD directory',async()=>{
    const workspace=memoryWorkspace();
    const store=new FodFlowStore(workspace);
    await store.save('ws-1',flow('hello','Hello'));
    expect(workspace.files.has('ws-1:FOD/hello.json')).toBe(true);
    expect((await store.get('ws-1','hello'))?.name).toBe('Hello');
    expect((await store.list('ws-1')).map(item=>item.id)).toEqual(['hello']);
    expect(await store.get('ws-2','hello')).toBeNull();
  });

  it('resolves same-named flows by workspace, stable ID and pinned version after restart',async()=>{
    const workspace=memoryWorkspace();
    const first=new FodFlowStore(workspace);
    const alpha=await first.save('owner-workspace',flow('stable-id'));
    const beta=await first.save('other-workspace',flow('stable-id'));
    const revised=await first.save('owner-workspace',{...alpha,nodes:[{id:'new-node',type:'small-script',position:{x:0,y:0},data:{}}]});
    expect(revised.id).toBe(alpha.id);
    expect(revised.version).toBe(2);
    expect(beta.version).toBe(1);
    const restarted=new FodFlowStore(workspace);
    expect((await restarted.get('owner-workspace','stable-id',1))?.nodes).toHaveLength(0);
    expect((await restarted.get('owner-workspace','stable-id',2))?.nodes).toHaveLength(1);
    expect((await restarted.get('owner-workspace','stable-id'))?.version).toBe(2);
    expect((await restarted.get('other-workspace','stable-id'))?.nodes).toHaveLength(0);
    expect(await restarted.get('other-workspace','stable-id',2)).toBeNull();
    expect((await restarted.list('owner-workspace')).map(item=>item.version)).toEqual([2]);
    expect((await restarted.list('other-workspace')).map(item=>item.version)).toEqual([1]);
    expect(revised.createdAt).toBe(alpha.createdAt);
  });

  it('retains legacy plain JSON as the first pinned revision on update',async()=>{
    const workspace=memoryWorkspace();
    workspace.files.set('ws:FOD/legacy.json',JSON.stringify(flow('legacy')));
    const store=new FodFlowStore(workspace);
    expect((await store.get('ws','legacy',1))?.version).toBe(1);
    const v2=await store.save('ws',{...flow('legacy'),name:'Updated'});
    expect(v2.version).toBe(2);
    expect((await new FodFlowStore(workspace).get('ws','legacy',1))?.name).toBe('Shared');
    expect((await new FodFlowStore(workspace).get('ws','legacy',2))?.name).toBe('Updated');
  });

  it('rejects stale revisions and unsafe IDs without changing the persisted latest flow',async()=>{
    const workspace=memoryWorkspace();
    const store=new FodFlowStore(workspace);
    const first=flow('safe');
    await store.save('ws',first);
    await store.save('ws',{...first,name:'Updated'});
    await expect(store.save('ws',{...first,name:'Stale'})).rejects.toThrow(/Stale flow revision/);
    await expect(store.save('ws',flow('a/b'))).rejects.toThrow(/path-safe/);
    await expect(store.get('ws','safe',0)).rejects.toThrow(/Invalid requested/);
    expect((await store.get('ws','safe'))?.name).toBe('Updated');
  });

  it('does not advance the visible latest version when storage rejects a write',async()=>{
    const workspace=memoryWorkspace();
    const store=new FodFlowStore(workspace);
    const first=await store.save('ws',flow('stable'));
    const write=workspace.writeFile;
    workspace.writeFile=async()=>({success:false,path:''});
    await expect(store.save('ws',{...first,name:'Must not persist'})).rejects.toThrow(/Unable to persist/);
    workspace.writeFile=write;
    expect((await new FodFlowStore(workspace).get('ws','stable'))?.version).toBe(1);
  });
});

describe('workspace-owned FOD publication lifecycle',()=>{
  function registry() {
    const events:FodPublicationDescriptor[]=[];
    let failNext=false;
    const sink={synchronize:async(d:FodPublicationDescriptor)=>{
      if (failNext) {failNext=false;throw new Error('registry temporarily offline');}
      events.push({...d});
    }};
    return {events,sink,failOnce:()=>{failNext=true;}};
  }
  function publication(sink:ReturnType<typeof registry>['sink'],ownerUserId='luth-owner') {
    return {appId:'aiko',ownerUserId,sink};
  }

  it('keeps private creates out of global discovery until explicit publish; syncs every subsequent save',async()=>{
    const workspace=memoryWorkspace();
    const remote=registry();
    const store=new FodFlowStore(workspace,publication(remote.sink));
    const privateFlow=await store.save('owner-workspace',{
      ...flow('private','A private workflow'),
      nodes:[{id:'secret-node',type:'small-script',position:{x:0,y:0},data:{secret:'NEVER-SYNC'}}],
    });
    expect(remote.events).toHaveLength(0);
    expect(privateFlow.version).toBe(1);
    const published=await store.publish('owner-workspace','private');
    expect(published).not.toHaveProperty('__publication');
    expect(remote.events).toHaveLength(1);
    expect(remote.events[0]).toEqual({
      appId:'aiko',ownerUserId:'luth-owner',workspaceId:'owner-workspace',
      workflowId:'private',version:1,displayName:'A private workflow',
      description:undefined,state:'published',
    });
    expect(JSON.stringify(remote.events)).not.toContain('NEVER-SYNC');
    await store.save('owner-workspace',{...privateFlow,name:'Changed name'});
    expect(remote.events.at(-1)).toMatchObject({version:2,displayName:'Changed name',state:'published'});
    expect((await store.get('owner-workspace','private',1))?.name).toBe('A private workflow');
    expect((await store.get('owner-workspace','private',2))?.name).toBe('Changed name');
    expect(await store.unpublish('owner-workspace','private')).toBe(true);
    expect(remote.events.at(-1)).toMatchObject({state:'withdrawn',version:2});
    expect(await store.delete('owner-workspace','private')).toBe(true);
    expect(await store.get('owner-workspace','private')).toBeNull();
    expect(remote.events.at(-1)).toMatchObject({state:'withdrawn'});
  });

  it('never leaks same-name flows or owner scope between workspaces',async()=>{
    const ws=memoryWorkspace(), remote=registry();
    const a=new FodFlowStore(ws,publication(remote.sink,'owner-a'));
    const b=new FodFlowStore(ws,publication(remote.sink,'owner-b'));
    await a.save('one',flow('identical','Same name'));
    await b.save('two',flow('identical','Same name'));
    await a.publish('one','identical');
    expect(remote.events).toHaveLength(1);
    expect(remote.events[0]).toMatchObject({ownerUserId:'owner-a',workspaceId:'one'});
    await b.publish('two','identical');
    expect(remote.events).toHaveLength(2);
    expect(remote.events[1]).toMatchObject({ownerUserId:'owner-b',workspaceId:'two'});
    expect(await a.get('one','identical')).not.toBeNull();
    expect(await a.get('two','identical')).not.toBeNull(); // Reads do not grant remote access.
    expect(remote.events[0]?.workspaceId).not.toBe(remote.events[1]?.workspaceId);
  });

  it('durably retries failed publish and withdrawal without copying flow definitions',async()=>{
    const ws=memoryWorkspace(), remote=registry();
    const store=new FodFlowStore(ws,publication(remote.sink));
    await store.save('ws',flow('saved'));
    remote.failOnce();
    await expect(store.publish('ws','saved')).rejects.toThrow(/temporarily offline/);
    expect(remote.events).toHaveLength(0);
    expect(await new FodFlowStore(ws,publication(remote.sink)).reconcilePublications('ws')).toBe(1);
    expect(remote.events.at(-1)).toMatchObject({state:'published',version:1});
    remote.failOnce();
    await expect(store.unpublish('ws','saved')).rejects.toThrow(/temporarily offline/);
    expect(await new FodFlowStore(ws,publication(remote.sink)).reconcilePublications('ws')).toBe(1);
    expect(remote.events.at(-1)).toMatchObject({state:'withdrawn'});
    expect(await store.unpublish('ws','saved')).toBe(true);
  });

  it('tombstones before delete, blocks deletion on failed withdrawal and replays on reconnect',async()=>{
    const ws=memoryWorkspace(), remote=registry();
    const store=new FodFlowStore(ws,publication(remote.sink));
    await store.save('ws',flow('protected'));
    await store.publish('ws','protected');
    remote.failOnce();
    await expect(store.delete('ws','protected')).rejects.toThrow('registry temporarily offline');
    expect(await store.get('ws','protected')).not.toBeNull();
    expect(await store.reconcilePublications('ws')).toBe(1);
    expect(remote.events.at(-1)).toMatchObject({state:'withdrawn'});
    expect(await store.delete('ws','protected')).toBe(true);
    expect(await store.get('ws','protected')).toBeNull();
  });

  it('fails closed when an indexed workflow is reopened without its trusted publication sink',async()=>{
    const ws=memoryWorkspace(), remote=registry();
    const indexed=new FodFlowStore(ws,publication(remote.sink));
    const v1=await indexed.save('ws',flow('published'));
    await indexed.publish('ws','published');
    const noRegistry=new FodFlowStore(ws);
    await expect(noRegistry.save('ws',v1)).rejects.toThrow(/trusted publication sink/);
    await expect(noRegistry.delete('ws','published')).rejects.toThrow(/trusted publication sink/);
    await expect(noRegistry.publish('ws','published')).rejects.toThrow(/trusted publication sink/);
  });

  it('requires host authorization for facade publication even with a configured sink',async()=>{
    const ws=memoryWorkspace(), remote=registry();
    const runtime=new FodRuntime({workspaceId:'ws',workspaceService:ws,publication:publication(remote.sink)});
    await runtime.saveFlow(flow('private'));
    await expect(runtime.publishFlow('private')).rejects.toThrow(/authorization not configured/);
    expect(remote.events).toHaveLength(0);
    const authorized=new FodRuntime({
      workspaceId:'ws',workspaceService:ws,publication:publication(remote.sink),
      authorizePublication:async(action)=>{if(action==='unpublish')throw new Error('denied');},
    });
    await authorized.publishFlow('private');
    await expect(authorized.unpublishFlow('private')).rejects.toThrow('denied');
    expect(remote.events).toHaveLength(1);
  });

  it('only sends parameterized allowlisted metadata in one atomic SQL statement',async()=>{
    const calls:Array<{sql:string,args:readonly unknown[]}>=[];
    const sink=createSqlFodPublicationSink(async(sql,args)=>{calls.push({sql,args});});
    const record:FodPublicationDescriptor={
      appId:'aiko',ownerUserId:'owner',workspaceId:'ws',
      workflowId:'flow',version:2,displayName:'Display',
      description:'Summary',state:'published',
    };
    await sink.synchronize(record);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('UPDATE skipo_ecosystem.workflow_publications');
    expect(calls[0]!.sql).toContain('ON CONFLICT');
    expect(calls[0]!.sql).toContain('version<>$5::integer');
    expect(calls[0]!.args).toEqual(['aiko','owner','ws','flow',2,'Display','Summary','published']);
    expect(JSON.stringify(calls)).not.toMatch(/nodes|edges|credential|secret|api_key/i);
    await expect(sink.synchronize({...record,appId:'https://bad'})).rejects.toThrow('app_id');
    await expect(sink.synchronize({...record,ownerUserId:' '})).rejects.toThrow('owner');
    await expect(sink.synchronize({...record,version:0})).rejects.toThrow('version');
    expect(calls).toHaveLength(1);
  });
});
