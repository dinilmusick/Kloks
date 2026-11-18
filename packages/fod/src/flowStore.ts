import type {FodFlow} from './types.js';
import type {FodPublicationOptions,FodPublicationDescriptor} from './publicationSync.js';

const ROOT='FOD';
type StoredFlow=FodFlow & {__versions?:FodFlow[];__publication?:{visible:boolean};__deletePending?:boolean};
const locks=new Map<string,Promise<void>>();

function pathFor(flowId:string):string {
  if (!flowId || flowId==='.' || flowId==='..') throw new Error('Invalid flow ID.');
  const safe=flowId.replace(/[^a-zA-Z0-9._-]/g,'_');
  return `${ROOT}/${safe}.json`;
}
function assertWritableId(flowId:string):void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(flowId)) {
    throw new Error('Flow IDs must be non-empty, path-safe identifiers.');
  }
}
function publicFlow(stored:StoredFlow):FodFlow {
  const {__versions: _versions,__publication: _publication,__deletePending: _deletePending,...flow}=stored;
  return flow;
}
function isMissing(error:unknown):boolean {
  const e=error as {code?:string;status?:number;statusCode?:number};
  return e?.code==='ENOENT' || e?.code==='NOT_FOUND' || e?.status===404 || e?.statusCode===404;
}
function decodeFlow(raw:unknown):StoredFlow|null {
  if (raw===null || raw===undefined || raw==='') return null;
  const json=typeof raw==='string' ? raw : new TextDecoder().decode(raw as Uint8Array);
  const record=JSON.parse(json) as StoredFlow;
  if (!record || typeof record.id!=='string' || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new Error('Invalid persisted FOD flow record.');
  }
  return record;
}

/**
 * A single workspace-owned document holds both the readable latest flow and
 * immutable revision snapshots. Updating the file is one storage operation;
 * existing FOD/<id>.json consumers continue to read the latest flow shape.
 * The global capability catalog must index metadata only, never this document.
 */
export class FodFlowStore {
  constructor(
    private readonly workspaceService:any,
    private readonly publication?:FodPublicationOptions,
  ) {}

  private publicationDescriptor(workspaceId:string,stored:StoredFlow):FodPublicationDescriptor {
    if (!this.publication) throw new Error('A trusted publication sink is required.');
    return {
      appId:this.publication.appId,
      ownerUserId:this.publication.ownerUserId,
      workspaceId,
      workflowId:stored.id,
      version:stored.version,
      displayName:stored.name,
      description:stored.description,
      state:stored.__publication?.visible ? 'published' : 'withdrawn',
    };
  }

  private async syncPublication(workspaceId:string,stored:StoredFlow):Promise<void> {
    if (!stored.__publication) return; // Private flows are never indexed.
    if (!this.publication) throw new Error('A trusted publication sink is required.');
    await this.publication.sink.synchronize(this.publicationDescriptor(workspaceId,stored));
  }

  private async writeRecord(workspaceId:string,record:StoredFlow):Promise<void> {
    const result=await this.workspaceService.writeFile(workspaceId,pathFor(record.id),JSON.stringify(record,null,2));
    if (result?.success===false) throw new Error('Unable to persist workflow revision.');
  }

  private async withLock<T>(workspaceId:string,flowId:string,action:()=>Promise<T>):Promise<T> {
    const key=workspaceId+'\0'+flowId;
    const previous=locks.get(key)??Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;});
    const queued=previous.then(()=>current);
    locks.set(key,queued);
    await previous;
    try { return await action(); }
    finally { release(); if (locks.get(key)===queued) locks.delete(key); }
  }

  private async read(workspaceId:string,flowId:string):Promise<StoredFlow|null> {
    try {
      const stored=decodeFlow(await this.workspaceService.readFile(workspaceId,pathFor(flowId)));
      if (stored && stored.id!==flowId) throw new Error('Persisted flow ID does not match its workspace path.');
      return stored;
    } catch(error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async list(workspaceId:string):Promise<FodFlow[]> {
    const entries=await this.workspaceService.listFiles(workspaceId,ROOT);
    const flows:FodFlow[]=[];
    for (const entry of entries) {
      if (entry.isFolder || !entry.name.endsWith('.json') || !/^FOD\/[^/]+\.json$/.test(entry.path)) continue;
      try {
        const stored=decodeFlow(await this.workspaceService.readFile(workspaceId,entry.path));
        if (stored) flows.push(publicFlow(stored));
      } catch { /* Preserve legacy behavior for unrelated/corrupt entries. */ }
    }
    return flows.sort((a,b)=>a.name.localeCompare(b.name));
  }

  async get(workspaceId:string,flowId:string,version?:number):Promise<FodFlow|null> {
    if (version!==undefined && (!Number.isSafeInteger(version) || version<1)) {
      throw new Error('Invalid requested flow version.');
    }
    const stored=await this.read(workspaceId,flowId);
    if (!stored) return null;
    const latest=publicFlow(stored);
    if (version===undefined || version===latest.version) return latest;
    return (stored.__versions??[]).find(flow=>flow.id===flowId && flow.version===version)??null;
  }

  async save(workspaceId:string,flow:FodFlow):Promise<FodFlow> {
    assertWritableId(flow.id);
    return this.withLock(workspaceId,flow.id,async()=>{
      const previous=await this.read(workspaceId,flow.id);
      if (previous?.__deletePending) throw new Error('Workflow deletion is pending; reconcile before editing.');
      const latest=previous ? publicFlow(previous) : null;
      if (latest && flow.version!==latest.version) {
        throw new Error('Stale flow revision: reload the current workspace flow before saving.');
      }
      const now=new Date().toISOString();
      const supplied=publicFlow(flow as StoredFlow);
      const next:FodFlow={...supplied,createdAt:latest?.createdAt??flow.createdAt??now,updatedAt:now,
        version:latest ? latest.version+1 : Math.max(1,Number.isSafeInteger(flow.version)?flow.version:1)};
      const history=previous ? (previous.__versions??[latest!]) : [];
      if (history.some(item=>item.version===next.version)) {
        throw new Error('Flow revision already exists.');
      }
      if (previous?.__publication && !this.publication) {
        throw new Error('Cannot edit indexed workflow without a trusted publication sink.');
      }
      const record:StoredFlow={...next,__versions:[...history,next],__publication:previous?.__publication};
      await this.writeRecord(workspaceId,record);
      // Re-publish the latest pinned version (or retry a pending withdrawal).
      // On failure the workspace document remains authoritative; reconcile on
      // startup/reconnect will retry the idempotent metadata sync.
      await this.syncPublication(workspaceId,record);
      return next;
    });
  }

  /** Explicit opt-in only. A private save never publishes or grants access. */
  async publish(workspaceId:string,flowId:string):Promise<FodFlow> {
    if (!this.publication) throw new Error('A trusted publication sink is required.');
    return this.withLock(workspaceId,flowId,async()=>{
      const stored=await this.read(workspaceId,flowId);
      if (!stored) throw new Error('Cannot publish a missing workspace workflow.');
      if (stored.__deletePending) throw new Error('Cannot publish a workflow while deletion is pending.');
      // N5 registry withdrawals are permanent. An explicit republish after
      // withdrawal must allocate the NEXT immutable workspace-owned version;
      // retrying a failed first publish keeps the same version.
      let record:StoredFlow;
      if (stored.__publication?.visible===false) {
        if (!Number.isSafeInteger(stored.version+1)) throw new Error('Workflow revision limit reached.');
        const latest=publicFlow(stored);
        const next:FodFlow={...latest,version:latest.version+1,updatedAt:new Date().toISOString()};
        const history=stored.__versions??[latest];
        record={...next,__versions:[...history,next],__publication:{visible:true}};
      } else {
        record={...stored,__publication:{visible:true}};
      }
      await this.writeRecord(workspaceId,record);
      await this.syncPublication(workspaceId,record);
      return publicFlow(record);
    });
  }

  async unpublish(workspaceId:string,flowId:string):Promise<boolean> {
    if (!this.publication) throw new Error('A trusted publication sink is required.');
    return this.withLock(workspaceId,flowId,async()=>{
      const stored=await this.read(workspaceId,flowId);
      if (!stored?.__publication) return false;
      if (stored.__deletePending) throw new Error('Workflow deletion is pending; reconciliation will finish deletion.');
      const record:StoredFlow={...stored,__publication:{visible:false}};
      await this.writeRecord(workspaceId,record);
      await this.syncPublication(workspaceId,record);
      return true;
    });
  }

  /** Replay workspace-owned publication intent after service reconnect/restart. */
  async reconcilePublications(workspaceId:string):Promise<number> {
    if (!this.publication) throw new Error('A trusted publication sink is required.');
    const entries=await this.workspaceService.listFiles(workspaceId,ROOT);
    let count=0;
    for (const entry of entries) {
      if (entry.isFolder || !entry.name.endsWith('.json') || !/^FOD\/[^/]+\.json$/.test(entry.path)) continue;
      const flowId=entry.name.slice(0,-5);
      await this.withLock(workspaceId,flowId,async()=>{
        const stored=await this.read(workspaceId,flowId);
        if (stored?.__publication) {
          // Registry withdrawal is always retried before the source-owned tombstone is removed.
          await this.syncPublication(workspaceId,stored);
          count++;
          if (stored.__deletePending) {
            const deletion=await this.workspaceService.deleteFile(workspaceId,pathFor(flowId));
            if (!deletion?.success) throw new Error('Unable to finalize deleted workflow after publication withdrawal.');
          }
        }
      });
    }
    return count;
  }

  async delete(workspaceId:string,flowId:string):Promise<boolean> {
    return this.withLock(workspaceId,flowId,async()=>{
      const stored=await this.read(workspaceId,flowId);
      if (stored?.__publication || stored?.__deletePending) {
        // Persist a durable delete intent BEFORE withdrawal. If the registry or
        // workspace delete is interrupted, reconnect can finish the operation.
        if (!this.publication) throw new Error('Cannot delete indexed workflow without a trusted publication sink.');
        const tombstone:StoredFlow={...stored,__publication:{visible:false},__deletePending:true};
        await this.writeRecord(workspaceId,tombstone);
        await this.syncPublication(workspaceId,tombstone);
      }
      const result=await this.workspaceService.deleteFile(workspaceId,pathFor(flowId));
      return Boolean(result?.success);
    });
  }
}
