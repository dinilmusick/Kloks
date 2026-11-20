import {describe,it,expect,vi} from 'vitest';
import {listFlyMachines,getFlyMachine,createFlyMachine,mutateFlyMachine} from './fly-machines.js';
import type {ProviderConnection} from './types.js';
const auth:ProviderConnection={providerId:'fly',accountId:'owner-1',credential:'fly-private-test'};
const body={id:'machineA',name:'job',state:'started',region:'ord',
  config:{guest:{cpu_kind:'shared',cpus:4,memory_mb:8192,gpus:0}}};
const fetcher=(data:unknown,status=200)=>vi.fn<typeof fetch>().mockResolvedValue(
  status===204?new Response(null,{status:204}):new Response(JSON.stringify(data),{status}));
describe('Fly Machines real lifecycle API contracts',()=>{
  it('reads real machine CPU/memory and state for an exact app',async()=>{
    const fetchMock=fetcher([body]);
    const result=await listFlyMachines(auth,'app-1',fetchMock);
    expect(result).toEqual([{id:'machineA',app:'app-1',name:'job',state:'started',
      region:'ord',cpuVcpus:4,memoryGiB:8,gpuCount:0}]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.machines.dev/v1/apps/app-1/machines');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string,string>).Authorization).toBe('Bearer fly-private-test');
  });
  it('gets and creates a machine with constrained resource inputs',async()=>{
    const got=await getFlyMachine(auth,'app-1','machineA',fetcher(body));
    expect(got.memoryGiB).toBe(8);
    const fetchMock=fetcher(body);
    const created=await createFlyMachine(auth,{app:'app-1',name:'job',region:'ord',
      image:'registry-1.docker.io/library/ubuntu:latest',cpuKind:'shared',
      cpuVcpus:4,memoryMiB:8192},fetchMock);
    expect(created.id).toBe('machineA');
    const [url,options]=fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.machines.dev/v1/apps/app-1/machines');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body)).config.guest.memory_mb).toBe(8192);
  });
  it('accepts provider start/stop/delete responses including no-content',async()=>{
    for(const op of ['start','stop','delete'] as const){
      const fetchMock=fetcher(null,204);
      const result=await mutateFlyMachine(auth,'app-1','machineA',op,fetchMock);
      expect(result).toEqual({accepted:true,app:'app-1',id:'machineA',operation:op});
      expect(fetchMock.mock.calls[0][1]?.method).toBe(op==='delete'?'DELETE':'POST');
      expect(String(fetchMock.mock.calls[0][0]).endsWith(op==='delete'?'/machineA':'/machineA/'+op)).toBe(true);
    }
  });
  it('refuses wrong-provider credentials and path injection before sending secrets',async()=>{
    const fetchMock=vi.fn<typeof fetch>();
    await expect(listFlyMachines({...auth,providerId:'railway'},'app-1',fetchMock)).rejects.toThrow();
    await expect(listFlyMachines(auth,'../attacker',fetchMock)).rejects.toThrow();
    await expect(mutateFlyMachine(auth,'app','../../id','delete',fetchMock)).rejects.toThrow();
    await expect(createFlyMachine(auth,{app:'app',name:'name',region:'ord',image:'a bad image',
      cpuKind:'shared',cpuVcpus:1,memoryMiB:1024},fetchMock)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects malformed resource inventory, never fabricating machine capability',async()=>{
    await expect(listFlyMachines(auth,'app',fetcher([{id:'vm',state:'started',config:{}}])))
      .rejects.toThrow(/incomplete/);
    await expect(listFlyMachines(auth,'app',fetcher({machines:[]}))).rejects.toThrow();
  });
  it('forces HTTP routing to the chosen running machine without leaking Fly API token',async()=>{
    const fetchMock=fetcher({ok:true});
    const {invokeFlyMachineHttp}=await import('./fly-machines.js');
    const out=await invokeFlyMachineHttp({app:'app-1',machineId:'machineA',
      path:'/jobs/run',method:'POST',payload:{job:'test'}},fetchMock);
    expect(out.status).toBe(200);
    expect(out.body).toContain('ok');
    const [url,options]=fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://app-1.fly.dev/jobs/run');
    const headers=options?.headers as Record<string,string>;
    expect(headers['Fly-Force-Instance-Id']).toBe('machineA');
    expect(headers.Authorization).toBeUndefined();
    expect(options?.body).toBe(JSON.stringify({job:'test'}));
  });
  it('refuses untrusted HTTP paths and oversize payload before network call',async()=>{
    const fetchMock=vi.fn<typeof fetch>();
    const {invokeFlyMachineHttp}=await import('./fly-machines.js');
    await expect(invokeFlyMachineHttp({app:'bad.example.com',machineId:'vm',
      path:'/run',method:'POST'},fetchMock)).rejects.toThrow();
    await expect(invokeFlyMachineHttp({app:'good',machineId:'vm',
      path:'//host.invalid/run',method:'GET'},fetchMock)).rejects.toThrow();
    await expect(invokeFlyMachineHttp({app:'good',machineId:'vm',
      path:'/run',method:'POST',payload:{data:'x'.repeat(140000)}},fetchMock)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
