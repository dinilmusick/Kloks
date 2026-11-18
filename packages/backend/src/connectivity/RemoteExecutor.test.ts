import { describe, expect, it, vi } from 'vitest';
import { RemoteExecutor } from './RemoteExecutor.js';
import type { ITransport } from './Transport.js';
import type { Message } from './types.js';

function createTransport() {
  const messages: Message[] = [];
  const transport = {
    request: vi.fn(async (message: Message) => {
      messages.push(message);
      return {
        id: 'response',
        type: 'RESULT' as const,
        operation: message.operation,
        payload: { accepted: true },
        timestamp: Date.now(),
      };
    }),
    send: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    onMessage: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
  } as unknown as ITransport;
  return { transport, messages };
}

describe('RemoteExecutor request-scoped caller context', () => {
  it('preserves explicit command context without moving credentials into the payload', async () => {
    const { transport, messages } = createTransport();
    const getAuthContext = vi.fn(() => ({ token: 'fallback-token', userId: 'fallback-user' }));
    const getCapabilityContext = vi.fn(() => ({ domain: 'default', capability: 'read' }));
    const executor = new RemoteExecutor({ transport, getAuthContext, getCapabilityContext });

    await executor.execute({
      id: 'incoming-command',
      type: 'COMMAND',
      operation: 'storage.list',
      payload: { workspaceId: 'workspace-1' },
      timestamp: 1,
      authContext: { token: 'request-token', userId: 'caller-1', role: 'owner' },
      capabilityContext: { domain: 'storage', capability: 'list', scope: 'workspace-1' },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.authContext).toEqual({
      token: 'request-token',
      userId: 'caller-1',
      role: 'owner',
    });
    expect(messages[0]?.capabilityContext).toEqual({
      domain: 'storage',
      capability: 'list',
      scope: 'workspace-1',
    });
    expect(messages[0]?.payload).toEqual({ workspaceId: 'workspace-1' });
    expect(getAuthContext).not.toHaveBeenCalled();
    expect(getCapabilityContext).not.toHaveBeenCalled();
  });

  it('resolves current caller credentials separately for each query and delegation', async () => {
    const { transport, messages } = createTransport();
    const getAuthContext = vi.fn()
      .mockReturnValueOnce({ token: 'query-token', userId: 'user-1' })
      .mockReturnValueOnce({ token: 'delegation-token', userId: 'user-1' });
    const executor = new RemoteExecutor({ transport, getAuthContext });

    await executor.query({
      id: 'incoming-query',
      type: 'QUERY',
      operation: 'storage.get',
      payload: { key: 'document-1' },
      timestamp: 2,
    });
    await executor.delegate({
      target: 'storage',
      operation: 'delete',
      payload: { key: 'document-2' },
      sessionId: 'legacy-session',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.type).toBe('QUERY');
    expect(messages[0]?.authContext?.token).toBe('query-token');
    expect(messages[1]?.type).toBe('COMMAND');
    expect(messages[1]?.authContext?.token).toBe('delegation-token');
    expect(messages[1]?.payload).toMatchObject({ target: 'storage', operation: 'delete' });
    expect(messages[1]?.payload).not.toHaveProperty('authContext');
    expect(getAuthContext).toHaveBeenCalledTimes(2);
  });

  it('prefers delegation-scoped context over the ambient provider', async () => {
    const { transport, messages } = createTransport();
    const getAuthContext = vi.fn(() => ({ token: 'ambient-token' }));
    const executor = new RemoteExecutor({ transport, getAuthContext });

    await executor.delegate({
      target: 'workflow',
      operation: 'run',
      payload: { workflowId: 'wf-1' },
      authContext: { token: 'delegation-scoped-token', userId: 'owner-1' },
      capabilityContext: { domain: 'workflow', capability: 'run' },
    });

    expect(messages[0]?.authContext?.token).toBe('delegation-scoped-token');
    expect(messages[0]?.capabilityContext).toEqual({ domain: 'workflow', capability: 'run' });
    expect(getAuthContext).not.toHaveBeenCalled();
  });
});
