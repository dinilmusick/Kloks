import { describe, expect, it, vi } from 'vitest';
import { CallbackRegistry } from './CallbackRegistry.js';
import { InProcessExecutor } from './InProcessExecutor.js';

describe('InProcessExecutor delegated callback session boundary', () => {
  function fixture() {
    const callbacks = new CallbackRegistry();
    const executor = new InProcessExecutor(undefined, undefined, callbacks);
    const callback = vi.fn((payload: unknown) => ({ accepted: true, payload }));
    const handle = callbacks.register(callback, 'owner-session');
    return { executor, callback, handle };
  }

  it('denies a delegated callback with no caller session', async () => {
    const { executor, callback, handle } = fixture();
    await expect(executor.delegate({
      target: 'workspace', operation: 'export', payload: {},
      callbackHandle: handle,
    })).rejects.toThrow('requires caller session identity');
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects blank caller sessions rather than skipping registry authorization', async () => {
    const { executor, callback, handle } = fixture();
    await expect(executor.delegate({
      target: 'workspace', operation: 'export', payload: {},
      callbackHandle: handle, sessionId: '   ',
    })).rejects.toThrow('requires caller session identity');
    expect(callback).not.toHaveBeenCalled();
  });

  it('denies cross-session delegation even when handle is known', async () => {
    const { executor, callback, handle } = fixture();
    await expect(executor.delegate({
      target: 'workspace', operation: 'export', payload: {},
      callbackHandle: handle, sessionId: 'different-session',
    })).rejects.toThrow('Unauthorized callback invocation');
    expect(callback).not.toHaveBeenCalled();
  });

  it('invokes callback exactly once for matching owner session', async () => {
    const { executor, callback, handle } = fixture();
    const payload = { workspaceId: 'mine' };
    await expect(executor.delegate({
      target: 'workspace', operation: 'export', payload,
      callbackHandle: handle, sessionId: 'owner-session',
    })).resolves.toEqual({ accepted: true, payload });
    expect(callback).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('keeps command delegation without callbacks backward compatible', async () => {
    const executor = new InProcessExecutor();
    executor.getRegistry().registerCommand('workspace', 'list', async () => ['one']);
    await expect(executor.delegate({
      target: 'workspace', operation: 'list', payload: {},
    })).resolves.toEqual(['one']);
  });
});
