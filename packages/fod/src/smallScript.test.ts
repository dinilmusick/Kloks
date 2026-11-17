import { describe, expect, it, vi } from 'vitest';
import { executeFodFlow } from './executor.js';
import { FodRuntime } from './runtime.js';
import { createQuickJsSmallScriptExecutor } from './quickJsAdapter.js';
import { DEFAULT_SMALL_SCRIPT_LIMITS, executeSmallScript, type SmallScriptExecutor } from './smallScript.js';

const flow = (code = 'return { result: inputs.input + 1 };') => ({
  id: 'small-js', name: 'Small JS', version: 1,
  createdAt: '2026-11-17', updatedAt: '2026-11-17',
  nodes: [{ id: 'script', type: 'system/javascript', position: { x: 0, y: 0 }, data: { code } }],
  edges: [],
});

describe('bounded FOD JavaScript nodes', () => {
  it('registers the code node but fails closed with no interpreter', async () => {
    const runtime = new FodRuntime({ workspaceId: 'workspace-1', workspaceService: {} });
    expect(runtime.getNodeDefinitions().find(n => n.type === 'system/javascript')?.metadata?.requiresIsolatedExecutor).toBe(true);
    const result = await executeFodFlow(flow(), new Map(), undefined, { input: 16 });
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/executor is not configured/);
    expect(result.events.some(e => e.type === 'node-failed')).toBe(true);
  });

  it('executes via an explicitly injected adapter and propagates typed results', async () => {
    const execute = vi.fn(async ({ inputs }: any) => ({ result: Number(inputs.input) + 1 }));
    const executor: SmallScriptExecutor = { execute };
    const result = await executeFodFlow(flow(), new Map(), undefined, { input: 16 }, { scriptExecutor: executor });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: 17 });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].limits.sourceBytes).toBe(8192);
  });

  it('rejects UTF-8 oversized code before calling an adapter', async () => {
    const execute = vi.fn(async () => ({ result: 1 }));
    await expect(executeSmallScript({ execute }, '/*' + 'é'.repeat(5000) + '*/', {}))
      .rejects.toMatchObject({ code: 'SCRIPT_TOO_LARGE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects oversized JSON input and output, once per invocation', async () => {
    const execute = vi.fn(async () => ({ result: 'x'.repeat(70_000) }));
    await expect(executeSmallScript({ execute }, 'return 1;', { input: 'x'.repeat(70_000) }))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(execute).not.toHaveBeenCalled();
    await expect(executeSmallScript({ execute }, 'return 1;', { input: 1 }))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects cancelled execution before invoking any code', async () => {
    const controller = new AbortController(); controller.abort();
    const execute = vi.fn(async () => 1);
    await expect(executeSmallScript({ execute }, 'return 1;', {}, controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires interpreter-enforced heap and interrupt limits and disposes runtime', async () => {
    const hooks = { interrupt: undefined as undefined | (() => boolean), memory: 0, stack: 0, disposed: false, code: '' };
    const value = { dispose: vi.fn() };
    const ctx = {
      evalCode: vi.fn((source: string) => { hooks.code = source; return { value }; }),
      dump: vi.fn(() => JSON.stringify({ result: 17 })),
      dispose: vi.fn(),
    };
    const runtime = {
      setMemoryLimit: (bytes: number) => { hooks.memory = bytes; },
      setMaxStackSize: (bytes: number) => { hooks.stack = bytes; },
      setInterruptHandler: (fn: () => boolean) => { hooks.interrupt = fn; },
      newContext: () => ctx,
      dispose: () => { hooks.disposed = true; },
    };
    const executor = createQuickJsSmallScriptExecutor(async () => ({ newRuntime: () => runtime }));
    const result = await executeSmallScript(executor, 'return { result: inputs.input + 1 };', { input: 16 });
    expect(result).toEqual({ result: 17 });
    expect(hooks.memory).toBe(DEFAULT_SMALL_SCRIPT_LIMITS.heapBytes);
    expect(hooks.stack).toBeGreaterThan(0);
    expect(hooks.code).toContain('return { result: inputs.input + 1 };');
    expect(hooks.interrupt?.()).toBe(false);
    expect(ctx.dispose).toHaveBeenCalledOnce();
    expect(value.dispose).toHaveBeenCalledOnce();
    expect(hooks.disposed).toBe(true);
  });
});
