import {describe,expect,it} from 'vitest';
import {AikoRuntime} from './runtime.js';

describe('AikoRuntime',()=>{
 it('creates one agent per capability and preserves tool plus intelligence spec',async()=>{
  const runtime=new AikoRuntime({
   capabilities:[{id:'api-1',name:'Example',sourceKind:'endpoint',sourceId:'api-1',execute:async(input)=>input}],
   resolver:{resolve:()=>({spec:{reasoning:9},specId:'preset-agent'})},
   keys:{listKeys:async()=>[],getActiveKey:async()=>null,rotateKey:async()=>null,syncFromAikoEngine:async()=>({synced:0})}
  });
  const agents=await runtime.listAgents();
  expect(agents).toHaveLength(1);
  expect(agents[0].tool.id).toBe('api-1');
  expect(agents[0].intelligenceSpec.reasoning).toBe(9);
 });
});
