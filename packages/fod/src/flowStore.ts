import type {FodFlow} from './types.js';

const ROOT='FOD';
type StoredFlow=FodFlow & {__versions?:FodFlow[]};
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
  const {__versions: _versions,...flow}=stored;
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
  constructor(private readonly workspaceService:any) {}

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
      const record:StoredFlow={...next,__versions:[...history,next]};
      const result=await this.workspaceService.writeFile(workspaceId,pathFor(flow.id),JSON.stringify(record,null,2));
      if (result?.success===false) throw new Error('Unable to persist workflow revision.');
      return next;
    });
  }

  async delete(workspaceId:string,flowId:string):Promise<boolean> {
    return this.withLock(workspaceId,flowId,async()=>{
      const result=await this.workspaceService.deleteFile(workspaceId,pathFor(flowId));
      return Boolean(result?.success);
    });
  }
}
