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

it('creates a custom agent with an explicit capability allow-list',async()=>{
 const runtime=new AikoRuntime({
  capabilities:[
   {id:'a',name:'A',sourceKind:'endpoint',sourceId:'a',execute:async(input)=>input},
   {id:'b',name:'B',sourceKind:'endpoint',sourceId:'b',execute:async(input)=>input}
  ],
  resolver:{resolve:()=>({spec:{reasoning:8}})},
  keys:{listKeys:async()=>[],getActiveKey:async()=>null,rotateKey:async()=>null,syncFromAikoEngine:async()=>({synced:0})}
 });
 const agent=await runtime.createCustomAgent('Custom',['a']);
 expect(agent.allowedToolIds).toEqual(['a']);
 await expect(runtime.executeAgent(agent.id,{toolId:'b',input:{}})).rejects.toThrow('not permitted');
});

it('resolves natural-language input before executing the agent tool',async()=>{
 let received:any=null;
 const runtime=new AikoRuntime({
  capabilities:[{id:'api',name:'API',sourceKind:'endpoint',sourceId:'api',execute:async(input)=>{received=input;return input}}],
  resolver:{resolve:()=>({spec:{reasoning:9}})},
  resolveNaturalLanguage:async()=>({value:42}),
  keys:{listKeys:async()=>[],getActiveKey:async()=>null,rotateKey:async()=>null,syncFromAikoEngine:async()=>({synced:0})}
 });
 await runtime.executeAgent('aiko-endpoint-api','do it');
 expect(received).toEqual({value:42});
});

it('invalidates previously discovered tools after revocation and uses only the current binding', async () => {
 const original = { id: 'api', name: 'API', sourceKind: 'endpoint' as const, sourceId: 'api',
  execute: async () => 'old' };
 let capabilities = [original];
 const runtime = new AikoRuntime({
  capabilities: () => capabilities,
  resolver: { resolve: () => ({ spec: {} }) },
  keys: { listKeys: async () => [], getActiveKey: async () => null, rotateKey: async () => null, syncFromAikoEngine: async () => ({ synced: 0 }) },
 });
 const [agent] = await runtime.listAgents();
 const custom = await runtime.createCustomAgent('Saved', ['api']);
 capabilities = [{ ...original, execute: async () => 'current' }];
 await expect(agent.tool.execute({})).resolves.toBe('current');
 await expect(runtime.executeAgent(custom.id, { toolId: 'api', input: {} })).resolves.toBe('current');

 capabilities = [{ ...original, sourceId: 'different-operation' }];
 await expect(agent.tool.execute({})).rejects.toThrow('no longer permitted');
 await expect(runtime.executeAgent(custom.id, { toolId: 'api', input: {} })).rejects.toThrow('no longer permitted');
 await expect(runtime.createCustomAgent('Mixed', ['api', 'unknown'])).rejects.toThrow('permitted capabilities');

 capabilities = [];
 expect((await runtime.listAgents()).map(item => item.id)).toEqual([custom.id]);
 await expect(runtime.executeAgent(agent.id, {})).rejects.toThrow('not found');
});

it('executes typed conversational input only after schema validation and a live grant check', async () => {
 const delivered: unknown[] = [];
 const capability = {
  id: 'integer', name: 'Integer', sourceKind: 'endpoint' as const, sourceId: 'integer',
  inputSchema: { type: 'integer' },
  validateInput: (input: unknown) => Number.isInteger(input) ? [] : ['$ must be an integer'],
  execute: async (input: unknown) => { delivered.push(input); return input; },
 };
 let allowed = true;
 const runtime = new AikoRuntime({
  capabilities: () => allowed ? [capability] : [],
  resolver: { resolve: () => ({ spec: {}, specId: 'typed-input' }) },
  parseNaturalLanguage: async (target, prompt) => {
   expect(target.intelligenceSpecId).toBe('typed-input');
   expect(target.inputSchema).toEqual({ type: 'integer' });
   expect(target).not.toHaveProperty('execute');
   if (prompt === 'which number?') return { status: 'clarification', question: 'Which integer?' };
   if (prompt === 'revoke during parsing') allowed = false;
   return { status: 'inputs', input: prompt === 'bad type' ? '16' : 16 };
  },
  keys: { listKeys: async () => [], getActiveKey: async () => null, rotateKey: async () => null, syncFromAikoEngine: async () => ({ synced: 0 }) },
 });
 const id = 'aiko-endpoint-integer';
 await expect(runtime.executeAgentFromNaturalLanguage(id, 'I want to put in 16')).resolves.toEqual({ status: 'completed', output: 16 });
 await expect(runtime.executeAgentFromNaturalLanguage(id, 'bad type')).resolves.toMatchObject({ status: 'clarification', issues: ['$ must be an integer'] });
 await expect(runtime.executeAgentFromNaturalLanguage(id, 'which number?')).resolves.toEqual({ status: 'clarification', question: 'Which integer?' });
 await expect(runtime.executeAgentFromNaturalLanguage(id, 'revoke during parsing')).rejects.toThrow('no longer permitted');
 expect(delivered).toEqual([16]);
});

it('refreshes a saved agent’s selected spec before parsing and stops on revocation', async () => {
  let reasoning = 3;
  let revoked = false;
  const deliveries: unknown[] = [];
  const runtime = new AikoRuntime({
    capabilities: [{
      id: 'item', name: 'Item', sourceKind: 'endpoint', sourceId: 'item',
      execute: async input => { deliveries.push(input); return input; },
    }],
    resolver: { resolve(specId) {
      expect(specId).toBe('selected');
      if (revoked) throw new Error('Central Aiko access was denied.');
      return { spec: { reasoning } };
    } },
    resolveNaturalLanguage: async agent => ({ toolId: 'item', input: agent.intelligenceSpec.reasoning }),
    keys: { listKeys: async () => [], getActiveKey: async () => null, rotateKey: async () => null, syncFromAikoEngine: async () => ({ synced: 0 }) },
  });
  const saved = await runtime.createCustomAgent('Saved', ['item'], 'selected');
  reasoning = 8;
  await expect(runtime.executeAgent(saved.id, 'use current settings')).resolves.toBe(8);
  revoked = true;
  await expect(runtime.executeAgent(saved.id, 'use current settings')).rejects.toThrow('access was denied');
  expect(deliveries).toEqual([8]);
});
