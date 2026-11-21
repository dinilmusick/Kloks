import { describe, expect, it, vi } from 'vitest';
import {
  assertFacadeJsonInput, createFacadeInvocationBoundary,
  type VerifiedFacadeCaller,
} from './facadeInvocation.js';
import { createFacadeRemoteClient } from './facadeRemoteClient.js';

const now = Date.now();
const caller: VerifiedFacadeCaller = {
  principalId: 'user-A', sourceAppId: 'app-A', sourceWorkspaceId: 'workspace-A',
  audience: 'app-B', sessionId: 'session-A',
  invoker: { kind: 'user', id: 'user-A' }, chain: ['app-A'],
  depth: 1, maxDepth: 5, remainingCalls: 3,
  deadlineAt: now + 100_000, expiresAt: now + 100_000,
};
function target() {
  const auth = vi.fn(async () => ({ ...caller }));
  const facade = createFacadeInvocationBoundary({
    targetAppId: 'app-B',
    facade: { services: { echo: { execute: async (_op: string, input: unknown) => input } }, orchestrations: {} },
    verifyLuthCredential: auth,
    revalidateLuthCaller: async () => ({ ...caller }),
    listCurrentOperations: async () => [{
      id: 'echo', version: '1', name: 'Echo', kind: 'static', targetWorkspaceId: 'workspace-B',
      serviceId: 'echo', serviceOperation: 'echo',
    }],
    authorize: async () => true, deploymentEligible: async () => true,
    consumeInvocation: async () => true,
    invokePublishedWorkflow: async () => { throw new Error('no workflows'); },
    delegateCredential: async () => 'delegated',
  });
  return { facade, auth };
}

describe('bounded cross-app JSON request and graph input', () => {
  it('accepts finite nested JSON values but refuses non-JSON classes and unsafe key shapes', () => {
    expect(() => assertFacadeJsonInput({ n: 1, values: [null, false, { s: 'yes' }] })).not.toThrow();
    for (const unsafe of [new Map(), new Date(), { n: Infinity }, { n: NaN },
      { n: undefined }, { n: BigInt(1) }, { fn: () => 1 },
      JSON.parse('{"__proto__":"pollute"}'),
    ]) {
      expect(() => assertFacadeJsonInput(unsafe)).toThrow();
    }
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => assertFacadeJsonInput(cyclic)).toThrow();
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true, get: () => 'read',
    });
    expect(() => assertFacadeJsonInput(accessor)).toThrow();
  });

  it('denies direct graph invocation with a cyclic input before consuming Luth admission', async () => {
    const { facade, auth } = target();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(facade.invoke('delegated', {
      operationId: 'echo', version: '1', targetWorkspaceId: 'workspace-B',
      invocationId: 'cyclic-graph', input: cyclic,
    }, 'graph')).rejects.toMatchObject({ code: 'MALFORMED_INPUT' });
    expect(auth).not.toHaveBeenCalled();
  });

  it('rejects oversized declared HTTP payload before Luth admission', async () => {
    const { facade, auth } = target();
    const response = await facade.http(new Request('https://app-b.example.com/api/crossapp/invoke', {
      method: 'POST', headers: {
        Authorization: 'Bearer delegated',
        'Content-Length': '1048577',
      }, body: '{"input":{}}',
    }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
    expect(auth).not.toHaveBeenCalled();
  });

  it('rejects actual oversized body bytes even without Content-Length', async () => {
    const { facade, auth } = target();
    const response = await facade.http(new Request('https://app-b.example.com/api/crossapp/invoke', {
      method: 'POST', headers: { Authorization: 'Bearer delegated' },
      body: JSON.stringify({ input: 'x'.repeat(1_048_577) }),
    }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
    expect(auth).not.toHaveBeenCalled();
  });

  it('prevents unbounded MCP request bodies from reaching Luth or dispatch', async () => {
    const { facade, auth } = target();
    const response = await facade.mcp(new Request('https://app-b.example.com/mcp', {
      method: 'POST', headers: { Authorization: 'Bearer delegated' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', input: 'x'.repeat(1_048_577) }),
    }));
    expect(response.status).toBe(413);
    expect((await response.json() as { error: { message: string } }).error.message)
      .toBe('PAYLOAD_TOO_LARGE');
    expect(auth).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON or oversized caller payload before querying Skipo or minting Luth', async () => {
    const resolveDeployment = vi.fn(async () => null);
    const getAudienceBearer = vi.fn(async () => 'delegated.one.use');
    const remote = createFacadeRemoteClient({
      environment: 'production', resolveDeployment, getAudienceBearer,
      approveOrigin: async () => false, maxRequestMs: 1000,
    });
    const input = { a: new Map() };
    await expect(remote.invoke('app-B', {
      operationId: 'echo', version: '1', targetWorkspaceId: 'workspace-B',
      invocationId: 'reject-map', input,
    })).rejects.toMatchObject({ code: 'MALFORMED_INPUT' });
    await expect(remote.invoke('app-B', {
      operationId: 'echo', version: '1', targetWorkspaceId: 'workspace-B',
      invocationId: 'reject-big', input: 'x'.repeat(1_048_577),
    })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(resolveDeployment).not.toHaveBeenCalled();
    expect(getAudienceBearer).not.toHaveBeenCalled();
  });
});
