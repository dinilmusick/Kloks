import { describe, expect, it, vi, afterEach } from 'vitest';
import { HTTPTransport } from './HTTPTransport.js';
import type { Message } from './types.js';

afterEach(() => vi.unstubAllGlobals());

function command(operation: string): Message {
  return {
    id: 'route-security-test', type: 'COMMAND', operation,
    payload: { workflowId: 'wf-1' }, timestamp: 1,
  };
}

describe('HTTPTransport remote capability path boundaries', () => {
  it('routes ordinary dotted operation identifiers to the canonical API path', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({ baseUrl: 'https://example.test/' });
    await transport.request(command('workflow.execute.version2'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api/workflow/execute/version2');
  });

  it.each([
    '', 'workflow..run', '.workflow.run', 'workflow.run.',
    'workflow/../admin.delete', '../../admin.delete', 'workflow\\admin.delete',
    'workflow.run?workspace=other', 'workflow.run#fragment',
    'workflow.%2e%2e.admin', 'workflow.run%2fadmin',
    'workflow.run\r\nx-injected: true',
    ' workflow.run', 'workflow.run ',
  ])('rejects malformed operation %s without sending credentials or payload', async (operation) => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({
      baseUrl: 'https://example.test',
      defaultHeaders: { Authorization: 'Bearer caller-token' },
    });
    await expect(transport.request(command(operation))).rejects.toThrow('Invalid remote operation identifier');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('percent-encodes safe reserved characters within one operation segment', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HTTPTransport({ baseUrl: 'https://example.test' });
    await transport.request(command('workflow.run:version2'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api/workflow/run%3Aversion2');
  });
});
