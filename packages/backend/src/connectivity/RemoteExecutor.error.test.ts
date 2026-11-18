import { describe, expect, it, vi } from 'vitest';
import { RemoteExecutor } from './RemoteExecutor.js';
import type { ITransport } from './Transport.js';
import type { Message } from './types.js';

function createExecutor(response: Message) {
  const request = vi.fn(async () => response);
  const transport = {
    request,
    onMessage: vi.fn(() => () => undefined),
  } as unknown as ITransport;
  return {
    executor: new RemoteExecutor({ transport, sessionId: 'test-session' }),
    request,
  };
}

const forbidden: Message = {
  id: 'denied',
  type: 'ERROR',
  operation: 'workflow.run',
  error: { code: 'ACCESS_DENIED', message: 'Target authorization denied' },
  timestamp: 1,
};

describe('RemoteExecutor fail-closed result handling', () => {
  it('propagates the target authorization failure from delegated operations', async () => {
    const { executor, request } = createExecutor(forbidden);
    await expect(executor.delegate({
      target: 'workflow',
      operation: 'run',
      payload: { workflowId: 'private-workflow' },
    })).rejects.toThrow('Target authorization denied');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects remote delegation errors even when the target omits an error message', async () => {
    const { executor } = createExecutor({ ...forbidden, error: undefined, payload: { ok: true } });
    await expect(executor.delegate({
      target: 'workspace',
      operation: 'delete',
      payload: { id: 'w1' },
    })).rejects.toThrow('Delegation "workspace.delete" failed.');
  });

  it('propagates job submission denials without treating them as accepted jobs', async () => {
    const { executor, request } = createExecutor(forbidden);
    await expect(executor.submitJob({
      type: 'workflow.run',
      payload: { id: 'private-workflow' },
    })).rejects.toThrow('Target authorization denied');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects job errors that omit error details', async () => {
    const { executor } = createExecutor({ ...forbidden, error: undefined, payload: { id: 'fake-job' } });
    await expect(executor.submitJob({ type: 'workflow.run', payload: {} }))
      .rejects.toThrow('Remote job submission failed.');
  });

  it('preserves successful delegation and job submission payloads', async () => {
    const delegated = createExecutor({
      id: 'delegation-ok', type: 'RESULT', operation: 'workflow.run',
      payload: { runId: 'run-1' }, timestamp: 1,
    });
    await expect(delegated.executor.delegate({
      target: 'workflow', operation: 'run', payload: {},
    })).resolves.toEqual({ runId: 'run-1' });

    const job = { id: 'job-1', type: 'workflow.run', payload: {}, state: 'QUEUED', createdAt: 1, updatedAt: 1 };
    const submitted = createExecutor({
      id: 'job-ok', type: 'RESULT', operation: 'jobs.submit', payload: job, timestamp: 1,
    });
    await expect(submitted.executor.submitJob({ type: 'workflow.run', payload: {} }))
      .resolves.toEqual(job);
  });
});
