import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPTransport } from './HTTPTransport.js';
import type { Message } from './types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTPTransport bearer propagation', () => {
  it('sends the request bearer in Authorization and never in the JSON body', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({
      baseUrl: 'https://api.example.test',
      defaultHeaders: { 'x-client-kind': 'web' },
    });
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const payload = { workspaceId: 'workspace-1', operation: 'list' };
    const message: Message<typeof payload> = {
      id: 'request-1',
      type: 'COMMAND',
      operation: 'storage.list',
      payload,
      sessionId: 'opaque-session-id',
      correlationId: 'correlation-1',
      timestamp: 1,
      authContext: { token, userId: 'caller-1', role: 'owner' },
      capabilityContext: { domain: 'storage', capability: 'list' },
    };

    await transport.request(message);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers['x-session-id']).toBe('opaque-session-id');
    expect(headers['x-correlation-id']).toBe('correlation-1');
    expect(headers['x-client-kind']).toBe('web');
    expect(init.body).toBe(JSON.stringify(payload));
    expect(String(init.body)).not.toContain(token);
    expect(String(init.body)).not.toContain('authContext');
  });

  it('rejects malformed bearer credentials before making a network request', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({ baseUrl: 'https://api.example.test' });
    const message: Message = {
      id: 'request-invalid',
      type: 'QUERY',
      operation: 'storage.get',
      payload: { key: 'document-1' },
      timestamp: 1,
      authContext: { token: 'Bearer token-with-spaces' },
    };

    await expect(transport.request(message)).rejects.toThrow(/Invalid bearer token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps unauthenticated requests backward compatible without inventing caller identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({ baseUrl: 'https://api.example.test' });

    await transport.request({
      id: 'request-plain',
      type: 'QUERY',
      operation: 'health.check',
      payload: {},
      timestamp: 1,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(init.body).toBe('{}');
  });
});
