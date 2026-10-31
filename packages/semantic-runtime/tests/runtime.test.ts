import {describe,expect,it} from 'vitest';
import {CapabilityRegistry,RequirementResolver,TaskRuntime} from '../src/index.js';

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
  it('supports resumable task states',()=>{
    const runtime=new TaskRuntime(); const task=runtime.create('create invoice');
    runtime.transition(task.id,'waiting-for-user');
    expect(runtime.get(task.id)?.status).toBe('waiting-for-user');
  });
});
