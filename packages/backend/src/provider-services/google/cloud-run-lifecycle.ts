/** Google Cloud Run v2 lifecycle and invocation; no inferred free-tier quota or credentials. */
import {createProviderClient} from '../client.js';
import type {ProviderConnection} from '../types.js';

export interface CloudRunScope {project:string;location:string;service:string}
export interface CloudRunService {
  name:string; uri:string|null; cpuVcpus:number|null; memoryGiB:number|null;
  ready:boolean; manualInstanceCount:number|null;
}
export interface CloudRunOperation {
  name:string; done:boolean; success:boolean; errorCode:number|null;
}
export interface CloudRunCreate extends CloudRunScope {
  image:string;cpuVcpus:number;memoryMiB:number;approveProvisioning:true;
}
const projectPattern=/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const locationPattern=/^[a-z][a-z0-9-]{1,40}$/;
const servicePattern=/^[a-z][a-z0-9-]{0,48}[a-z0-9]$/;
function segment(input:string,name:string,pattern:RegExp):string{
  if(typeof input!=='string'||!pattern.test(input))throw new Error('Invalid '+name);
  return input;
}
function connection(input:ProviderConnection):ProviderConnection{
  if(input.providerId!=='google-cloud-run')throw new Error('Cloud Run provider mismatch');
  return input;
}
function root(scope:Pick<CloudRunScope,'project'|'location'>):string {
  const project=segment(scope.project,'project',projectPattern);
  const location=segment(scope.location,'location',locationPattern);
  return `projects/${project}/locations/${location}`;
}
function servicePath(scope:CloudRunScope):string{
  return root(scope)+'/services/'+segment(scope.service,'service',servicePattern);
}
function operation(data:unknown,scope:Pick<CloudRunScope,'project'|'location'>):CloudRunOperation{
  const obj=data as Record<string,any>|null;
  const prefix=root(scope)+'/operations/';
  if(!obj||typeof obj.name!=='string'||!obj.name.startsWith(prefix)
    ||!/^[A-Za-z0-9_-]{1,160}$/.test(obj.name.slice(prefix.length))
    ||(obj.done!==undefined&&typeof obj.done!=='boolean')
    ||(obj.error!==undefined && (typeof obj.error!=='object'||!obj.error)))
    throw new Error('Malformed Cloud Run operation response');
  const error=obj.error as Record<string,unknown>|undefined;
  if(error && (typeof error.code!=='number'||!Number.isSafeInteger(error.code)))
    throw new Error('Malformed Cloud Run operation failure');
  const done=obj.done===true;
  return {name:obj.name,done,success:done&&!error,errorCode:error?error.code as number:null};
}
function cpuValue(raw:unknown):number|null{
  if(typeof raw!=='string')return null;
  const value=/^([0-9]+(?:\.[0-9]+)?)m$/.test(raw)
    ?Number(raw.slice(0,-1))/1000
    :/^[0-9]+(?:\.[0-9]+)?$/.test(raw)?Number(raw):NaN;
  return Number.isFinite(value)&&value>0?value:null;
}
function memoryValue(raw:unknown):number|null{
  if(typeof raw!=='string')return null;
  const match=/^([0-9]+)(Mi|Gi)$/.exec(raw);
  if(!match)return null;
  const number=Number(match[1]);
  return Number.isFinite(number)&&number>0?(match[2]==='Gi'?number:number/1024):null;
}
function service(data:unknown,scope:CloudRunScope):CloudRunService{
  const value=data as Record<string,any>|null;
  const expected=servicePath(scope);
  if(!value||value.name!==expected||typeof value.template!=='object')
    throw new Error('Cloud Run returned an unexpected service');
  const limits=value.template?.containers?.[0]?.resources?.limits;
  const cpuVcpus=cpuValue(limits?.cpu);
  const memoryGiB=memoryValue(limits?.memory);
  const uri=value.uri;
  if(uri!==undefined&&uri!==null&&(typeof uri!=='string'
    ||!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(uri)))
    throw new Error('Cloud Run service URL is not an approved origin');
  const count=value.scaling?.manualInstanceCount;
  if(count!==undefined&&(!Number.isInteger(Number(count))||Number(count)<0))
    throw new Error('Cloud Run scaling information is invalid');
  return {name:expected,uri:typeof uri==='string'?uri:null,
    cpuVcpus,memoryGiB,ready:value.reconciling===false
      &&value.terminalCondition?.state==='CONDITION_SUCCEEDED',
    manualInstanceCount:count===undefined?null:Number(count)};
}
export async function getCloudRunService(
  auth:ProviderConnection,scope:CloudRunScope,transport:typeof fetch=fetch,
):Promise<CloudRunService>{
  const {data}=await createProviderClient(connection(auth),transport)
    .request<unknown>({path:'/v2/'+servicePath(scope)});
  return service(data,scope);
}
/** Google returns a long-running Operation, never an already-deployed Service. */
export async function createCloudRunService(
  auth:ProviderConnection,input:CloudRunCreate,transport:typeof fetch=fetch,
):Promise<CloudRunOperation>{
  const parent=root(input);const name=segment(input.service,'service',servicePattern);
  if(input.approveProvisioning!==true
    ||typeof input.image!=='string'||input.image.length>240
    ||!/^([a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9._/-]+(?::[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$/.test(input.image)
    ||!Number.isInteger(input.cpuVcpus)||input.cpuVcpus<1||input.cpuVcpus>64
    ||!Number.isInteger(input.memoryMiB)||input.memoryMiB<128||input.memoryMiB>262144)
    throw new Error('Invalid or unapproved Cloud Run service configuration');
  const {data}=await createProviderClient(connection(auth),transport).request<unknown>({
    path:'/v2/'+parent+'/services',method:'POST',query:{serviceId:name},
    body:{template:{containers:[{image:input.image,resources:{limits:{
      cpu:String(input.cpuVcpus),memory:input.memoryMiB+'Mi',
    }}}]},scaling:{minInstanceCount:0}},
  });
  return operation(data,input);
}
/** Manual zero disables a service. One instance resumes it and can incur charges. */
export async function setCloudRunManualInstances(
  auth:ProviderConnection,scope:CloudRunScope,count:0|1,
  approveScaling:boolean,transport:typeof fetch=fetch,
):Promise<CloudRunOperation>{
  const name=servicePath(scope);
  if(approveScaling!==true ||(count!==0&&count!==1))
    throw new Error('Explicit Cloud Run scaling approval required');
  const {data}=await createProviderClient(connection(auth),transport).request<unknown>({
    path:'/v2/'+name,method:'PATCH',
    query:{update_mask:'scaling.manualInstanceCount'},
    body:{scaling:{manualInstanceCount:count}},
  });
  return operation(data,scope);
}
export async function deleteCloudRunService(
  auth:ProviderConnection,scope:CloudRunScope,approveDeletion:boolean,
  transport:typeof fetch=fetch,
):Promise<CloudRunOperation>{
  const name=servicePath(scope);
  if(approveDeletion!==true)throw new Error('Explicit Cloud Run deletion approval required');
  const {data}=await createProviderClient(connection(auth),transport)
    .request<unknown>({path:'/v2/'+name,method:'DELETE'});
  return operation(data,scope);
}
/** Read operation status after mutations; done=true may also mean failure. */
export async function getCloudRunOperation(
  auth:ProviderConnection,scope:Pick<CloudRunScope,'project'|'location'>,
  name:string,transport:typeof fetch=fetch,
):Promise<CloudRunOperation>{
  const prefix=root(scope)+'/operations/';
  if(typeof name!=='string'||!name.startsWith(prefix)
    ||!/^[A-Za-z0-9_-]{1,160}$/.test(name.slice(prefix.length)))
    throw new Error('Invalid Cloud Run operation scope');
  const {data}=await createProviderClient(connection(auth),transport)
    .request<unknown>({path:'/v2/'+name});
  return operation(data,scope);
}
