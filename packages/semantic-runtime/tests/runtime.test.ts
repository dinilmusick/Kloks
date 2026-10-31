import {describe,expect,it} from 'vitest';
import {CapabilityRegistry,RequirementResolver,TaskRuntime,TaskGraphRuntime} from '../src/index.js';

describe('semantic runtime',()=>{
  it('registers and discovers capabilities',()=>{
    const r=new CapabilityRegistry();
    r.register({id:'orders.get',name:'Get order',description:'Reads an order',kind:'endpoint',inputSchema:{type:'object',properties:{orderId:{type:'string'}}}});
    expect(r.get('orders.get')?.kind).toBe('endpoint');
  });
  it('returns explicit unresolved state instead of asking the model to invent data',async()=>{
    const r=new CapabilityRegistry();
    const resolver=new RequirementResolver(r);
    const result=await resolver.resolve({id:'r1',semanticType:'OrderIdentifier',description:'Order id',required:true,sourceCapability:'orders.get',sourceField:'orderId'},{runtime:{applicationId:'a',sessionId:'s'},task:{taskId:'t',request:'get order',requirements:[],artifacts:[]},capabilities:r.list()});
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('NO_INTERNAL_RESOLUTION');
  });
  it('creates dependency-aware task graphs',()=>{\n    const graph=new TaskGraphRuntime().create('r1',[{id:'a',capabilityId:'a',dependsOn:[]},{id:'b',capabilityId:'b',dependsOn:['a']}]);\n    expect(graph.nodes.find(n=>n.id==='a')?.status).toBe('submitted');\n  });\n  it('supports resumable task states',()=>{
    const runtime=new TaskRuntime(); const task=runtime.create('create invoice');
    runtime.transition(task.id,'input-required');
    expect(runtime.get(task.id)?.status).toBe('input-required');
  });
});
