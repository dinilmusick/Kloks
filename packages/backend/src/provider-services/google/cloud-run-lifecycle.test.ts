import {describe,it,expect,vi} from 'vitest';
import {createCloudRunService,getCloudRunService,setCloudRunManualInstances,
  deleteCloudRunService,getCloudRunOperation} from './cloud-run-lifecycle.js';
import type {ProviderConnection} from '../types.js';
const auth:ProviderConnection={providerId:'google-cloud-run',accountId:'acct-1',
  credential:'temporary-access-token'};
const scope={project:'project-123',location:'us-central1',service:'worker'};
const name='projects/project-123/locations/us-central1/services/worker';
const operationName='projects/project-123/locations/us-central1/operations/op1';
const respond=(body:unknown,status=200)=>vi.fn<typeof fetch>().mockResolvedValue(
  new Response(JSON.stringify(body),{status}));
describe('Cloud Run real v2 lifecycle API',()=>{
  it('gets only exact project/region service with verified resource quantities',async()=>{
    const fetcher=respond({name,uri:'https://worker-123.a.run.app',
      reconciling:false,terminalCondition:{state:'CONDITION_SUCCEEDED'},
      template:{containers:[{resources:{limits:{cpu:'2000m',memory:'2048Mi'}}}]}});
    const result=await getCloudRunService(auth,scope,fetcher);
    expect(result).toMatchObject({name,cpuVcpus:2,memoryGiB:2,ready:true});
    expect(fetcher.mock.calls[0][0]).toBe('https://run.googleapis.com/v2/'+name);
    expect((fetcher.mock.calls[0][1]?.headers as Record<string,string>).Authorization)
      .toBe('Bearer temporary-access-token');
  });
  it('creates bounded service under exact project with explicit user approval',async()=>{
    const fetcher=respond({name:operationName});
    const output=await createCloudRunService(auth,{...scope,
      image:'us-docker.pkg.dev/project-123/jobs/worker:v1',
      cpuVcpus:2,memoryMiB:2048,approveProvisioning:true},fetcher);
    expect(output).toMatchObject({name:operationName,done:false,success:false});
    const [url,options]=fetcher.mock.calls[0];
    expect(String(url)).toBe('https://run.googleapis.com/v2/projects/project-123/locations/us-central1/services?serviceId=worker');
    expect(options?.method).toBe('POST');
    const body=JSON.parse(String(options?.body));
    expect(body.template.containers[0].resources.limits.memory).toBe('2048Mi');
    expect(body.scaling.minInstanceCount).toBe(0);
  });
  it('sets manual instance count only when explicitly approved',async()=>{
    const fetcher=respond({name:operationName,done:true});
    for(const count of [0,1] as const){
      const op=await setCloudRunManualInstances(auth,scope,count,true,fetcher);
      expect(op.success).toBe(true);
      const [url,options]=fetcher.mock.calls.at(-1)!;
      expect(String(url)).toContain('?update_mask=scaling.manualInstanceCount');
      expect(JSON.parse(String(options?.body)).scaling.manualInstanceCount).toBe(count);
    }
  });
  it('deletes and verifies operation status without assuming provider completion',async()=>{
    const pending=respond({name:operationName,done:false});
    const requested=await deleteCloudRunService(auth,scope,true,pending);
    expect(requested).toMatchObject({done:false,success:false});
    expect(pending.mock.calls[0][1]?.method).toBe('DELETE');
    const completed=await getCloudRunOperation(auth,scope,operationName,
      respond({name:operationName,done:true}));
    expect(completed.success).toBe(true);
    const failed=await getCloudRunOperation(auth,scope,operationName,
      respond({name:operationName,done:true,error:{code:7,message:'Permission denied'}}));
    expect(failed).toMatchObject({done:true,success:false,errorCode:7});
  });
  it('rejects foreign-project operations and malformed service or create payloads',async()=>{
    const remote=vi.fn<typeof fetch>();
    await expect(getCloudRunService(auth,{...scope,project:'../evil'},remote)).rejects.toThrow();
    await expect(getCloudRunService(auth,{...scope,service:'bad/name'},remote)).rejects.toThrow();
    await expect(deleteCloudRunService(auth,scope,false,remote)).rejects.toThrow();
    await expect(setCloudRunManualInstances(auth,scope,1,false,remote)).rejects.toThrow();
    await expect(createCloudRunService(auth,{...scope,image:'evil image',cpuVcpus:1,
      memoryMiB:512,approveProvisioning:true},remote)).rejects.toThrow();
    await expect(getCloudRunOperation(auth,scope,'projects/other/locations/us-central1/operations/op1',remote))
      .rejects.toThrow();
    expect(remote).not.toHaveBeenCalled();
  });
  it('rejects wrong provider tokens, malicious service URI and fabricated operations',async()=>{
    const bad={...auth,providerId:'vercel'};
    await expect(getCloudRunService(bad,scope,vi.fn<typeof fetch>())).rejects.toThrow();
    await expect(getCloudRunService(auth,scope,respond({name,
      uri:'http://169.254.169.254/metadata',template:{containers:[]}}))).rejects.toThrow();
    await expect(createCloudRunService(auth,{...scope,
      image:'us-docker.pkg.dev/project-123/jobs/worker:v1',
      cpuVcpus:2,memoryMiB:1024,approveProvisioning:true},
      respond({name:'projects/other/locations/us-central1/operations/op1'})))
      .rejects.toThrow();
  });
});
