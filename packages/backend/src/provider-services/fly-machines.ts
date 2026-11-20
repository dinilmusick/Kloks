import {createProviderClient} from './client.js';
import {resolveTrustedApiUrl} from '@dinilmusick/gutts/urls/safety';
import type {ProviderConnection} from './types.js';
/** Typed Fly.io Machines API; does not claim that an API acceptance means a VM is running. */
export interface FlyMachine {
  id:string; app:string; name:string|null; state:string; region:string|null;
  cpuVcpus:number; memoryGiB:number; gpuCount:number;
}
export interface FlyMachineCreate {
  app:string; name:string; image:string; region:string;
  cpuKind:'shared'|'performance'; cpuVcpus:number; memoryMiB:number;
}
function flyConnection(connection:ProviderConnection):ProviderConnection {
  if(connection.providerId!=='fly')throw new Error('Fly machine credentials must belong to Fly');
  return connection;
}
function identifier(value:string,label:string):string {
  if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(value))
    throw new Error('Invalid Fly '+label);
  return value;
}
function appPath(app:string):string {
  return '/v1/apps/'+identifier(app,'app name')+'/machines';
}
function machinePath(app:string,id:string):string {
  return appPath(app)+'/'+identifier(id,'machine ID');
}
function mapMachine(input:unknown,app:string):FlyMachine {
  if(!input||typeof input!=='object')throw new Error('Invalid Fly Machine payload');
  const data=input as Record<string,any>;
  const guest=data.config?.guest;
  if(typeof data.id!=='string'||!data.id||typeof data.state!=='string'||!data.state
    ||!guest||!Number.isInteger(guest.cpus)||guest.cpus<1||guest.cpus>4096
    ||!Number.isFinite(guest.memory_mb)||guest.memory_mb<128
    ||(guest.gpus!==undefined&&(!Number.isInteger(guest.gpus)||guest.gpus<0)))
    throw new Error('Fly Machine configuration is incomplete');
  return {id:data.id,app,name:typeof data.name==='string'?data.name:null,
    state:data.state,region:typeof data.region==='string'?data.region:null,
    cpuVcpus:guest.cpus,memoryGiB:guest.memory_mb/1024,gpuCount:guest.gpus??0};
}
/** Provider-read machine inventory. No assumptions about quotas or accessibility. */
export async function listFlyMachines(
  connection:ProviderConnection,app:string,transport:typeof fetch=fetch,
):Promise<FlyMachine[]> {
  const {data}=await createProviderClient(flyConnection(connection),transport)
    .request<unknown>({path:appPath(app)});
  if(!Array.isArray(data))throw new Error('Fly Machines inventory was not an array');
  return data.map(item=>mapMachine(item,app));
}
export async function getFlyMachine(
  connection:ProviderConnection,app:string,id:string,transport:typeof fetch=fetch,
):Promise<FlyMachine> {
  const {data}=await createProviderClient(flyConnection(connection),transport)
    .request<unknown>({path:machinePath(app,id)});
  return mapMachine(data,app);
}
/** Create a real machine: caller must hold explicit owner/workspace authorization. */
export async function createFlyMachine(
  connection:ProviderConnection,input:FlyMachineCreate,transport:typeof fetch=fetch,
):Promise<FlyMachine> {
  const path=appPath(input.app);
  identifier(input.name,'machine name');
  if(!/^[a-z]{3}$/.test(input.region)
    ||! /^[A-Za-z0-9._/@:-]{3,240}$/.test(input.image)
    ||!['shared','performance'].includes(input.cpuKind)
    ||!Number.isInteger(input.cpuVcpus)||input.cpuVcpus<1||input.cpuVcpus>64
    ||!Number.isInteger(input.memoryMiB)||input.memoryMiB<256||input.memoryMiB>262144)
    throw new Error('Invalid Fly Machine resources or image');
  const body={name:input.name,region:input.region,config:{
    image:input.image,guest:{cpu_kind:input.cpuKind,
      cpus:input.cpuVcpus,memory_mb:input.memoryMiB},
  }};
  const {data}=await createProviderClient(flyConnection(connection),transport)
    .request<unknown>({path,method:'POST',body});
  return mapMachine(data,input.app);
}
/** Start, stop and delete acknowledge provider acceptance, not eventual state convergence. */
export type FlyMutationResult = {accepted:true;app:string;id:string;operation:'start'|'stop'|'delete'};
export async function mutateFlyMachine(
  connection:ProviderConnection,app:string,id:string,
  operation:FlyMutationResult['operation'],transport:typeof fetch=fetch,
):Promise<FlyMutationResult> {
  if(!['start','stop','delete'].includes(operation))throw new Error('Invalid Fly operation');
  const path=machinePath(app,id)+(operation==='delete'?'':'/'+operation);
  await createProviderClient(flyConnection(connection),transport).request({
    path,method:operation==='delete'?'DELETE':'POST',
  });
  return {accepted:true,app,id,operation};
}

/** Dispatch an HTTP request to the exact Fly Machine through Fly Proxy.
 * The selected app must expose a public HTTP service and the invoking backend
 * must independently authorize the owner, workspace and machine.
 * NO Fly API bearer token is forwarded to the application.
 */
export interface FlyHttpInvocation {
  app:string; machineId:string; path:string;
  method:'GET'|'POST'; payload?:unknown; appAuthorization?:string;
}
export async function invokeFlyMachineHttp(
  input:FlyHttpInvocation,transport:typeof fetch=fetch,
):Promise<{status:number;contentType:string;body:string}> {
  const app=identifier(input.app,'app name');
  const machineId=identifier(input.machineId,'machine ID');
  if(typeof input.path!=='string'||input.path.length>512||!input.path.startsWith('/')
    ||input.path.startsWith('//')||!/^[\x20-\x7e]*$/.test(input.path))
    throw new Error('Invalid Fly application path');
  if(!['GET','POST'].includes(input.method)|| (input.method==='GET'&&input.payload!==undefined))
    throw new Error('Invalid Fly HTTP method or request');
  if(input.appAuthorization!==undefined
    &&(typeof input.appAuthorization!=='string'||input.appAuthorization.length>4096
      ||/[\r\n]/.test(input.appAuthorization)))
    throw new Error('Invalid application authorization');
  const payload=input.payload===undefined?undefined:JSON.stringify(input.payload);
  if(payload!==undefined&&new TextEncoder().encode(payload).byteLength>131072)
    throw new Error('Fly request exceeds the allowed size');
  const target=resolveTrustedApiUrl('https://'+app+'.fly.dev',input.path);
  const headers:Record<string,string>={
    Accept:'application/json',
    'Fly-Force-Instance-Id':machineId,
    ...(payload===undefined?{}:{'Content-Type':'application/json'}),
    ...(input.appAuthorization?{Authorization:input.appAuthorization}:{}),
  };
  const response=await transport(target.toString(),{
    method:input.method,headers,body:payload,redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  const limit=131072;
  const reader=response.body?.getReader();
  if(!reader)return {status:response.status,contentType:response.headers.get('content-type')||'',body:''};
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>limit)throw new Error('Fly response exceeds the allowed size');
      chunks.push(part.value);
    }
  }finally{
    if(size>limit)await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  const bytes=new Uint8Array(size);let position=0;
  for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.byteLength;}
  return {status:response.status,contentType:response.headers.get('content-type')||'',
    body:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
