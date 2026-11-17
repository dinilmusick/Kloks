import { describe, expect, it } from 'vitest';
import { executeFodFlow } from './executor.js';
import { createNodeQuickJsSmallScriptExecutor } from './quickjs-node.js';
import { DEFAULT_SMALL_SCRIPT_LIMITS, executeSmallScript } from './smallScript.js';

const executor = createNodeQuickJsSmallScriptExecutor();
const run = (code: string, inputs: Record<string, unknown> = {}) =>
  executeSmallScript(executor, code, inputs);

describe('real QuickJS-WASM execution from FOD', () => {
  it('passes an isolated JavaScript node result downstream', async () => {
    const result = await executeFodFlow({
      id: 'real-wasm', name: 'Real WASM', version: 1, createdAt: '', updatedAt: '',
      nodes: [
        { id: 'script', type: 'system/javascript', position: { x: 0, y: 0 },
          data: { code: 'return inputs.input * 2;' } },
        { id: 'endpoint', type: 'host/add', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [{ id: 'wire', source: 'script', target: 'endpoint' }],
    }, new Map([['add', {
      id: 'add', serviceId: 'test', serviceName: 'Test',
      operationId: 'add', operationName: 'Add',
      invoke: async (input) => (input as { input: number }).input + 1,
    }]]), undefined, { input: 20 }, { scriptExecutor: executor });

    expect(result).toMatchObject({ success: true, output: 41 });
    expect(result.events.map(event => event.type)).toEqual([
      'flow-started', 'node-started', 'node-completed', 'node-started', 'node-completed', 'flow-completed',
    ]);
  });

  it('blocks host capabilities, runtime code generation and state across invocations', async () => {
    await expect(run(`
      globalThis.state = 1;
      return [
        typeof fetch, typeof process, typeof require, typeof Deno, typeof WebAssembly,
        typeof eval, typeof Function, typeof (() => {}).constructor,
        typeof (async () => {}).constructor, typeof (function* () {}).constructor,
      ];
    `)).resolves.toEqual(Array(10).fill('undefined'));
    await expect(run('return typeof globalThis.state;')).resolves.toBe('undefined');
    await expect(run("return import('node:fs');")).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('interrupts a non-yielding loop and remains usable', async () => {
    const limits = { ...DEFAULT_SMALL_SCRIPT_LIMITS, wallMs: 25 };
    await expect(executeSmallScript(executor, 'while (true) {}', {}, undefined, limits))
      .rejects.toMatchObject({ code: 'SCRIPT_INTERRUPTED' });
    await expect(run('return 42;')).resolves.toBe(42);
  });

  it('contains interpreter heap exhaustion and remains usable', async () => {
    const limits = { ...DEFAULT_SMALL_SCRIPT_LIMITS, heapBytes: 2 * 1024 * 1024 };
    await expect(executeSmallScript(executor, 'return new Uint8Array(8 * 1024 * 1024).length;', {}, undefined, limits))
      .rejects.toMatchObject({ code: 'SCRIPT_ERROR' });
    await expect(run('return 42;')).resolves.toBe(42);
  });

  it('rejects malformed and oversized values without disclosing guest exceptions', async () => {
    await expect(run('return inputs;', { bad: undefined })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(run('return "é".repeat(40000);')).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(run('return null; junk ?')).rejects.toMatchObject({ code: 'SCRIPT_ERROR' });
    await expect(run("throw {get message() { while (true) {} }};"))
      .rejects.toMatchObject({ code: 'SCRIPT_ERROR', message: 'JavaScript execution failed.' });
    await expect(run('return inputs.__proto__;', JSON.parse('{"__proto__":{"own":true}}')))
      .resolves.toEqual({ own: true });
  });
});
