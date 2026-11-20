import { calculateProviderCapacity } from './capacity.js';
import type { ProviderUsageSnapshot } from './types.js';

/** Compute profiles specify requests, never assert provider-side availability. */
export type ComputeProfile = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ComputeWorkload = 'vm' | 'container' | 'function' | 'gpu' | 'sandbox';
export interface ComputeSpec {
  cpuVcpus: number;
  memoryGiB: number;
  gpuCount?: number;
  gpuMemoryGiB?: number;
  diskGiB?: number;
  workload?: ComputeWorkload;
}
export const COMPUTE_PROFILE_PRESETS: Readonly<Record<Exclude<ComputeProfile,'custom'>,Readonly<ComputeSpec>>> = Object.freeze({
  low: Object.freeze({ cpuVcpus:1, memoryGiB:1 }),
  medium: Object.freeze({ cpuVcpus:2, memoryGiB:4 }),
  high: Object.freeze({ cpuVcpus:4, memoryGiB:8 }),
  ultra: Object.freeze({ cpuVcpus:8, memoryGiB:16 }),
});
export function validateComputeSpec(value: ComputeSpec): ComputeSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Compute spec must be an object');
  const positive=(value:unknown,name:string,min:number,max:number):number=>{
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)
      throw new Error('Invalid compute requirement: '+name);
    return value;
  };
  const cpuVcpus=positive(value.cpuVcpus,'cpuVcpus',0.1,4096);
  const memoryGiB=positive(value.memoryGiB,'memoryGiB',0.125,65536);
  const gpuCount=value.gpuCount===undefined?0:positive(value.gpuCount,'gpuCount',0,64);
  if(!Number.isInteger(gpuCount))throw new Error('GPU count must be an integer');
  const gpuMemoryGiB=value.gpuMemoryGiB===undefined?0:positive(value.gpuMemoryGiB,'gpuMemoryGiB',0,4096);
  if(gpuCount===0 && gpuMemoryGiB>0)throw new Error('GPU memory requires a GPU');
  const diskGiB=value.diskGiB===undefined?0:positive(value.diskGiB,'diskGiB',0,1048576);
  const workload=value.workload;
  if(workload!==undefined && !['vm','container','function','gpu','sandbox'].includes(workload))
    throw new Error('Unsupported compute workload');
  return {cpuVcpus,memoryGiB,gpuCount,gpuMemoryGiB,diskGiB,...(workload?{workload}:{})};
}
export function resolveComputeSpec(profile:ComputeProfile, custom?:ComputeSpec):ComputeSpec {
  if(profile==='custom'){
    if(!custom)throw new Error('Custom compute profile requires a specification');
    return validateComputeSpec(custom);
  }
  if(!Object.prototype.hasOwnProperty.call(COMPUTE_PROFILE_PRESETS,profile))
    throw new Error('Unknown compute profile');
  return validateComputeSpec(COMPUTE_PROFILE_PRESETS[profile as Exclude<ComputeProfile,'custom'>]);
}
/** Every resource must originate from an authorized backend inventory, not plan-level metadata. */
export interface ComputeRouteAccount {
  ownerUserId:string;
  workspaceId:string;
  providerId:string;
  accountId:string;
  resourceId:string;
  /** Backend-verified running/dispatchable resource; must never come directly from an untrusted request. */
  executable:boolean;
  enabled:boolean;
  capabilities:ComputeSpec;
  /** User-configured multiplier. Zero disables the account. */
  preferenceWeight:number;
  usage?:ProviderUsageSnapshot;
}
export type MissingUsagePolicy = 'exclude' | 'user-weight';
export interface ComputeRouteRequest {
  ownerUserId:string;
  workspaceId:string;
  profile:ComputeProfile;
  customSpec?:ComputeSpec;
  /** Explicit choice: unknown telemetry excluded or manually user-weighted. */
  missingUsage:MissingUsagePolicy;
  allowAccountIds?:readonly string[];
}
export interface RankedComputeRoute {
  providerId:string;
  accountId:string;
  resourceId:string;
  capabilityFit:number;
  remainingFraction:number|null;
  weightSource:'verified-usage'|'user-weight';
  probability:number;
}
export interface ComputeRouteRanking {
  requested:ComputeSpec;
  candidates:RankedComputeRoute[];
  rejected:Array<{providerId:string;accountId:string;resourceId:string;reason:string}>;
}
function fit(required:ComputeSpec, available:ComputeSpec):number {
  let resource:ComputeSpec;
  try{resource=validateComputeSpec(available);}catch{return 0;}
  if(required.workload && resource.workload!==required.workload)return 0;
  if(resource.cpuVcpus<required.cpuVcpus||resource.memoryGiB<required.memoryGiB
    ||(resource.gpuCount??0)<(required.gpuCount??0)
    ||(resource.gpuMemoryGiB??0)<(required.gpuMemoryGiB??0)
    ||(resource.diskGiB??0)<(required.diskGiB??0))return 0;
  const cpuFit=required.cpuVcpus/resource.cpuVcpus;
  const memFit=required.memoryGiB/resource.memoryGiB;
  const gpuFit=!required.gpuCount && resource.gpuCount?0.5
    :required.gpuCount?required.gpuCount/(resource.gpuCount||1):1;
  return Math.max(0.01,Math.min(1,(cpuFit+memFit+gpuFit)/3));
}
/** Capability filtering precedes quota weighting. No cross-owner accounts are exposed. */
export function rankComputeRoutes(request:ComputeRouteRequest,resources:readonly ComputeRouteAccount[],
  now:Date=new Date()):ComputeRouteRanking {
  if(!request.ownerUserId?.trim()||!request.workspaceId?.trim())
    throw new Error('An authenticated user and workspace are required');
  if(!['exclude','user-weight'].includes(request.missingUsage))
    throw new Error('Missing-usage policy must be explicit');
  if(request.allowAccountIds && (!Array.isArray(request.allowAccountIds)
    ||request.allowAccountIds.some(id=>typeof id!=='string'||!id)))
    throw new Error('Invalid account allowlist');
  const requested=resolveComputeSpec(request.profile,request.customSpec);
  const permittedIds=request.allowAccountIds && new Set(request.allowAccountIds);
  const candidates:Array<RankedComputeRoute&{rawWeight:number}>=[];
  const rejected:ComputeRouteRanking['rejected']=[];
  const seen=new Set<string>();
  for(const account of resources){
    if(account.ownerUserId!==request.ownerUserId||account.workspaceId!==request.workspaceId)continue;
    if(permittedIds && !permittedIds.has(account.accountId))continue;
    const tag={providerId:account.providerId,accountId:account.accountId,resourceId:account.resourceId};
    const reject=(reason:string)=>{rejected.push({...tag,reason});};
    if(!account.providerId||!account.accountId||!account.resourceId||!account.enabled||!account.executable){
      reject('Provider runtime not available');continue;
    }
    const key=[account.providerId,account.accountId,account.resourceId].join('\u0000');
    if(seen.has(key)){reject('Duplicate resource');continue;}
    seen.add(key);
    const fitScore=fit(requested,account.capabilities);
    if(!fitScore){reject('Compute capabilities below requested profile');continue;}
    if(!Number.isFinite(account.preferenceWeight)||account.preferenceWeight<0||account.preferenceWeight>100){
      reject('Invalid user account weight');continue;
    }
    if(account.preferenceWeight===0){reject('Disabled by user account weight');continue;}
    let remainingFraction:number|null=null;
    let weightSource:RankedComputeRoute['weightSource']='user-weight';
    if(account.usage&&account.usage.accountId===account.accountId
      &&account.usage.providerId===account.providerId){
      const decision=calculateProviderCapacity(account.usage,now);
      if(decision.status==='exhausted'){reject('Provider-measured quota exhausted');continue;}
      if(decision.status==='eligible'){remainingFraction=decision.weight;weightSource='verified-usage';}
    }
    if(remainingFraction===null && request.missingUsage==='exclude'){
      reject('Verified quota measurement unavailable');continue;
    }
    const rawWeight=fitScore*account.preferenceWeight*(remainingFraction??1);
    if(!Number.isFinite(rawWeight)||rawWeight<=0){reject('Account has no routing weight');continue;}
    candidates.push({...tag,capabilityFit:fitScore,remainingFraction,weightSource,rawWeight,probability:0});
  }
  const sum=candidates.reduce((total,item)=>total+item.rawWeight,0);
  const ranked=candidates.map(({rawWeight,...item})=>({...item,probability:rawWeight/sum}))
    .sort((a,b)=>b.probability-a.probability||a.providerId.localeCompare(b.providerId)
      ||a.accountId.localeCompare(b.accountId)||a.resourceId.localeCompare(b.resourceId));
  return {requested,candidates:ranked,rejected};
}
/** One weighted choice per request; execution must independently recheck the provider grant. */
export function selectComputeRoute(ranking:ComputeRouteRanking,selectionUnit:number):RankedComputeRoute|null {
  if(!Number.isFinite(selectionUnit)||selectionUnit<0||selectionUnit>=1)
    throw new Error('Selection unit must be between 0 inclusive and 1 exclusive');
  let accumulated=0;
  for(const candidate of ranking.candidates){
    accumulated+=candidate.probability;
    if(selectionUnit<accumulated)return candidate;
  }
  return ranking.candidates.at(-1)??null;
}
