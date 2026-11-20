import {describe,it,expect} from 'vitest';
import {rankComputeRoutes,selectComputeRoute,resolveComputeSpec,validateComputeSpec} from './compute-routing.js';
import type {ComputeRouteAccount,ComputeRouteRequest} from './compute-routing.js';
import type {ProviderUsageSnapshot} from './types.js';
const now=new Date('2026-11-20T05:30:00Z');
const usage=(accountId:string,used:number,options:Partial<ProviderUsageSnapshot>={}):ProviderUsageSnapshot=>({
  providerId:'cloudflare',serviceId:'cloudflare',accountId,capturedAt:now.toISOString(),
  coverage:'complete',metrics:[{id:'requests',label:'Requests',unit:'count',used,limit:100,
    source:'provider',window:'day',enforceable:true,resetAt:'2026-11-21T00:00:00Z'}],...options,
});
const account=(accountId:string,used=10,options:Partial<ComputeRouteAccount>={}):ComputeRouteAccount=>({
  ownerUserId:'u1',workspaceId:'w1',providerId:'cloudflare',accountId,resourceId:'r_'+accountId,
  enabled:true,executable:true,capabilities:{cpuVcpus:4,memoryGiB:8},preferenceWeight:1,
  usage:usage(accountId,used),...options,
});
const request=(options:Partial<ComputeRouteRequest>={}):ComputeRouteRequest=>({
  ownerUserId:'u1',workspaceId:'w1',profile:'high',missingUsage:'exclude',...options,
});
describe('Frnes Compute Spec capability and remaining-usage routing',()=>{
  it('resolves low medium high ultra and validates custom requirements',()=>{
    expect(resolveComputeSpec('low').cpuVcpus).toBe(1);
    expect(resolveComputeSpec('medium').memoryGiB).toBe(4);
    expect(resolveComputeSpec('high').cpuVcpus).toBe(4);
    expect(resolveComputeSpec('ultra').memoryGiB).toBe(16);
    expect(resolveComputeSpec('custom',{cpuVcpus:3,memoryGiB:6}).cpuVcpus).toBe(3);
    expect(()=>resolveComputeSpec('custom')).toThrow();
    expect(()=>validateComputeSpec({cpuVcpus:0,memoryGiB:1})).toThrow();
    expect(()=>validateComputeSpec({cpuVcpus:2,memoryGiB:4,gpuMemoryGiB:4})).toThrow();
  });
  it('never downgrades below the requested compute profile',()=>{
    const ranked=rankComputeRoutes(request(),[account('weak',10,{capabilities:{cpuVcpus:2,memoryGiB:2}}),account('strong')],now);
    expect(ranked.candidates.map(x=>x.accountId)).toEqual(['strong']);
    expect(ranked.rejected[0].reason).toContain('capabilities');
  });
  it('weights accounts by their provider-measured quota remainder',()=>{
    const ranked=rankComputeRoutes(request(),[account('a',20),account('b',80)],now);
    expect(ranked.candidates.find(x=>x.accountId==='a')?.probability).toBeCloseTo(0.8);
    expect(ranked.candidates.find(x=>x.accountId==='b')?.probability).toBeCloseTo(0.2);
    const picks=Array.from({length:100},(_,i)=>selectComputeRoute(ranked,(i+0.5)/100));
    expect(picks.filter(x=>x?.accountId==='a')).toHaveLength(80);
    expect(picks.filter(x=>x?.accountId==='b')).toHaveLength(20);
  });
  it('combines the user priority multiplier with measured usage',()=>{
    const ranked=rankComputeRoutes(request(),[account('a',50),account('b',50,{preferenceWeight:3})],now);
    expect(ranked.candidates.find(x=>x.accountId==='b')?.probability).toBeCloseTo(0.75);
  });
  it('rejects exhausted, stale, partial, cross-account and unavailable capacity',()=>{
    const ranked=rankComputeRoutes(request(),[account('exhausted',100),
      account('old',1,{usage:usage('old',1,{capturedAt:'2025-01-01T00:00:00Z'})}),
      account('partial',1,{usage:usage('partial',1,{coverage:'partial'})}),
      account('misbound',1,{usage:usage('another',1)})],now);
    expect(ranked.candidates).toHaveLength(0);
    expect(ranked.rejected).toHaveLength(4);
  });
  it('user can deliberately select exhausted paid accounts without claiming free capacity',()=>{
    const ranked=rankComputeRoutes(request({exhaustedUsage:'user-weight'}),[account('a',100)],now);
    expect(ranked.candidates).toHaveLength(1);
    expect(ranked.candidates[0].remainingFraction).toBeNull();
    expect(ranked.candidates[0].weightSource).toBe('user-weight');
    expect(()=>rankComputeRoutes(request({exhaustedUsage:'unknown' as never}),[],now)).toThrow();
  });
  it('supports explicitly user-weighted unmetered routing without fake quota',()=>{
    const ranked=rankComputeRoutes(request({missingUsage:'user-weight'}),
      [account('a',1,{usage:undefined}),account('b',1,{usage:undefined,preferenceWeight:3})],now);
    expect(ranked.candidates.every(x=>x.remainingFraction===null&&x.weightSource==='user-weight')).toBe(true);
    expect(ranked.candidates.find(x=>x.accountId==='b')?.probability).toBeCloseTo(.75);
  });
  it('never reveals other tenant resources or considers unverified runtimes',()=>{
    const ranked=rankComputeRoutes(request(),[account('ok'),account('foreign',10,{ownerUserId:'other'}),
      account('foreign-ws',10,{workspaceId:'w2'}),account('offline',10,{executable:false})],now);
    expect(ranked.candidates.map(x=>x.accountId)).toEqual(['ok']);
    expect(JSON.stringify(ranked)).not.toContain('foreign');
    expect(ranked.rejected.map(x=>x.accountId)).toEqual(['offline']);
  });
  it('rejects duplicates, disabled weights and invalid draw units',()=>{
    const ranked=rankComputeRoutes(request({allowAccountIds:['a','b']}),
      [account('a'),account('a'),account('b',10,{preferenceWeight:0}),account('c')],now);
    expect(ranked.candidates).toHaveLength(1);
    expect(ranked.rejected).toHaveLength(2);
    expect(()=>selectComputeRoute(ranked,1)).toThrow();
    expect(selectComputeRoute(rankComputeRoutes(request(),[],now),0.5)).toBeNull();
  });
});
