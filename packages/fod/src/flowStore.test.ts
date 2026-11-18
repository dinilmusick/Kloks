import {describe,expect,it} from 'vitest';
import {FodFlowStore} from './flowStore.js';

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
