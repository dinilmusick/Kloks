import {describe,expect,it} from 'vitest';
import {scanBackendFacadeToNodes} from './endpointNodeProvider.js';
import {executeFodFlow} from './executor.js';

describe('embedded FOD',()=>{
  it('derives host-app nodes from typed backend operation schemas',()=>{
    const facade={services:{
      math:{
        id:'app.math',name:'Math',runtime:'server',deployment:'local',
        definition:{operations:{add:{id:'Math.add',name:'add',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b']},outputSchema:{type:'object',properties:{result:{type:'number'}}}},}},
        execute:async(_op:string,input:any)=>({result:Number(input.a)+Number(input.b)})
      }
    }};
    const {endpoints,nodes}=scanBackendFacadeToNodes(facade);
    expect(endpoints).toHaveLength(1);
    expect(nodes[0].type).toBe('host/Math.add');
    expect(nodes[0].inputs.map(p=>p.id)).toEqual(['a','b']);
    expect(nodes[0].outputs.map(p=>p.id)).toEqual(['result']);
  });

  it('routes a registered cross-app endpoint through the host-bound call-chain guard',async()=>{
    let localInvocations=0;
    const routed:Array<{appId:string;agentId:string;input:unknown}>=[];
    const endpoint={id:'Kone.run',serviceId:'kone.service',serviceName:'Kone',operationId:'Kone.run',operationName:'run',
      targetApp:{appId:'kone',agentId:'FodService.executePublishedFlow'},
      invoke:async()=>{localInvocations++;return 'unsafe-local';}};
    const flow:any={id:'remote',name:'Remote',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      nodes:[{id:'run',type:'host/Kone.run',position:{x:0,y:0},data:{endpointId:'Kone.run',inputs:{value:7},targetApp:{appId:'attacker'}}}],edges:[]};
    const result=await executeFodFlow(flow,new Map([[endpoint.id,endpoint as any]]),undefined,undefined,{
      appId:'aiko',
      invokeCrossApp:async(target,input)=>{routed.push({...target,input});return {routed:true};},
    });
    expect(result.success).toBe(true);
    expect(routed).toEqual([{appId:'kone',agentId:'FodService.executePublishedFlow',input:{value:7}}]);
    expect(localInvocations).toBe(0);
  });

  it('fails closed rather than locally invoking a cross-app endpoint without trusted ancestry',async()=>{
    let invoked=0;
    const endpoint={id:'Kone.run',serviceId:'kone',serviceName:'Kone',operationId:'Kone.run',operationName:'run',
      targetApp:{appId:'kone',agentId:'workflow-1'},invoke:async()=>{invoked++;return 'unsafe';}};
    const flow:any={id:'remote',name:'Remote',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      nodes:[{id:'run',type:'host/Kone.run',position:{x:0,y:0},data:{endpointId:'Kone.run'}}],edges:[]};
    const result=await executeFodFlow(flow,new Map([[endpoint.id,endpoint as any]]),undefined,undefined,{appId:'aiko'});
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/active trusted call-chain context/);
    expect(invoked).toBe(0);
  });

  it('keeps a same-app endpoint local when the trusted host identity matches',async()=>{
    let invoked=0, routed=0;
    const endpoint={id:'Local.run',serviceId:'local',serviceName:'Local',operationId:'Local.run',operationName:'run',
      targetApp:{appId:'aiko',agentId:'Local.run'},invoke:async()=>{invoked++;return {ok:true};}};
    const flow:any={id:'local',name:'Local',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      nodes:[{id:'run',type:'host/Local.run',position:{x:0,y:0},data:{endpointId:'Local.run'}}],edges:[]};
    const result=await executeFodFlow(flow,new Map([[endpoint.id,endpoint as any]]),undefined,undefined,{
      appId:'aiko',invokeCrossApp:async()=>{routed++;return null;},
    });
    expect(result.success).toBe(true);
    expect(invoked).toBe(1);
    expect(routed).toBe(0);
  });

  it('executes a persisted graph deterministically through endpoint nodes',async()=>{
    const endpoint={id:'Math.add',serviceId:'app.math',serviceName:'Math',operationId:'Math.add',operationName:'add',invoke:async(input:any)=>({result:Number(input.a)+Number(input.b)})};
    const flow:any={id:'sum',name:'Sum',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      nodes:[
        {id:'a',type:'host/Math.add',position:{x:0,y:0},data:{endpointId:'Math.add',inputs:{a:2,b:3}}}
      ],edges:[]};
    const result=await executeFodFlow(flow,new Map([[endpoint.id,endpoint as any]]));
    expect(result.success).toBe(true);
    expect((result.output as any).result).toBe(5);
  });
});
