import { describe, expect, it, vi } from 'vitest';
import {
  createFacadeInvocationBoundary, type FacadeInvocation, type VerifiedFacadeCaller,
} from './facadeInvocation.js';
import {
  createFacadeRemoteClient, type FacadeRemoteClientOptions, type VerifiedFacadeDeployment,
} from './facadeRemoteClient.js';

const app = 'app-B';
const workspace = 'workspace-B';
const op = { id: 'Math.add', version: 'v1', name: 'Addition', kind: 'static' as const,
  targetWorkspaceId: workspace, serviceId: 'math', serviceOperation: 'add' };
const request = (invocationId: string, patch: Partial<FacadeInvocation> = {}): FacadeInvocation => ({
  operationId: op.id, version: op.version, targetWorkspaceId: workspace,
  invocationId, input: { a: 2, b: 3 }, ...patch,
});

function harness() {
  const state = {
    authorized: true, published: true, active: true, originApproved: true, validBearer: true,
    currentVersion: 'v1', slow: false, transportCalls: 0, credentialCalls: 0,
    deployment: {
      appId: app, deploymentId: 'lease-123', workspaceId: workspace,
      environment: 'production', origin: 'https://app-b.example',
      leaseExpiresAt: Date.now() + 30_000, verified: true as const,
    } satisfies VerifiedFacadeDeployment,
  };
  const caller: VerifiedFacadeCaller = {
    principalId: 'user-1', sourceAppId: 'app-A', sourceWorkspaceId: 'workspace-A',
    audience: app, sessionId: 'session-A', invoker: { kind: 'app-agent', id: 'aiko-A' },
    chain: ['app-A'], depth: 1, maxDepth: 5, remainingCalls: 10,
    deadlineAt: Date.now() + 30_000, expiresAt: Date.now() + 30_000,
  };
  const used = new Set<string>();
  const boundary = createFacadeInvocationBoundary({
    targetAppId: app,
    facade: {
      services: { math: { execute: async (_operation: string, input: any, _context: { signal: AbortSignal }) => {
        if (state.slow) await new Promise(resolve => setTimeout(resolve, 75));
        return { result: input.a + input.b };
      } } }, orchestrations: {},
    },
    verifyLuthCredential: async (token, audience) =>
      token === 'signed-token-for-app-B' && state.validBearer && audience === app
        ? { ...caller, chain: [...caller.chain] } : null,
    // This represents the distinct trusted Luth revalidation authority; it
    // does not replay or consume the invocation bearer a second time.
    revalidateLuthCaller: async (admitted, audience) =>
      state.validBearer && audience === app
        ? { ...admitted, invoker: { ...admitted.invoker }, chain: [...admitted.chain] } : null,
    listCurrentOperations: async targetWorkspace => targetWorkspace === workspace && state.published
      ? [{ ...op, version: state.currentVersion }] : [],
    authorize: async ({ caller: c }) => state.authorized && c.principalId === 'user-1' &&
      c.sourceWorkspaceId === 'workspace-A',
    deploymentEligible: async () => state.active,
    consumeInvocation: async (_caller, id) => !used.has(id) && !!used.add(id),
    invokePublishedWorkflow: async () => ({ executed: true }),
    delegateCredential: async () => 'signed-token-for-app-B',
  });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    state.transportCalls++;
    expect(String(input).startsWith('https://app-b.example/api/crossapp/')).toBe(true);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer signed-token-for-app-B');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
    const body = init?.body ? String(init.body) : '';
    expect(body).not.toContain('signed-token-for-app-B');
    expect(body).not.toContain('principalId');
    expect(body).not.toContain('replyTo');
    return boundary.http(new Request(input, init));
  });
  const options: FacadeRemoteClientOptions = {
    environment: 'production',
    resolveDeployment: async () => state.active ? { ...state.deployment } : null,
    approveOrigin: async () => state.originApproved,
    getAudienceBearer: async (_target, _operation, _signal) => {
      state.credentialCalls++;
      return 'signed-token-for-app-B';
    },
    fetch: fetcher as typeof fetch,
    maxRequestMs: 1000,
  };
  return { state, options, fetcher, boundary, client: createFacadeRemoteClient(options) };
}

describe('Skipo/Luth-authorized cross-app remote facade client', () => {
  it('discovers and invokes real HTTP boundary through verified deployment with no identity in payload', async () => {
    const { client, state, fetcher } = harness();
    const operations = await client.discover(app, workspace);
    expect(operations).toEqual([{ id: 'Math.add', version: 'v1',
      name: 'Addition', kind: 'static', targetWorkspaceId: workspace }]);
    const result = await client.invoke(app, request('remote-1'));
    expect(result).toEqual({ output: { result: 5 }, invocationId: 'remote-1' });
    expect(JSON.stringify(result)).not.toContain('replyTo');
    expect(state.credentialCalls).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://app-b.example/api/crossapp/operations?workspace=workspace-B');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://app-b.example/api/crossapp/invoke');
  });

  it('fails closed before fetch on missing, invalid or unapproved deployment', async () => {
    const { state, client, fetcher } = harness();
    state.originApproved = false;
    await expect(client.discover(app, workspace)).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.originApproved = true;
    state.deployment.origin = 'http://127.0.0.1';
    await expect(client.invoke(app, request('ssrf-1'))).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.deployment.origin = 'https://app-b.example';
    state.deployment.leaseExpiresAt = Date.now() - 1;
    await expect(client.invoke(app, request('expired-1'))).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects wrong target app, environment and malformed request claims', async () => {
    const { client, fetcher } = harness();
    await expect(client.invoke('app-X', request('wrong-app-1'))).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    await expect(client.invoke(app, { ...request('bad-extra-1'), principalId: 'user-2' } as any))
      .rejects.toMatchObject({ code: 'MALFORMED_HANDLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects forged Luth credentials and wrong-version operations at the target', async () => {
    const { client, state } = harness();
    state.validBearer = false;
    await expect(client.invoke(app, request('bad-credential-1'))).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    state.validBearer = true;
    state.currentVersion = 'v2';
    await expect(client.invoke(app, request('wrong-version-1'))).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' });
  });

  it('never returns revoked grants, withdrawn operations, or offline deployment results', async () => {
    const { client, state } = harness();
    state.authorized = false;
    expect(await client.discover(app, workspace)).toEqual([]);
    await expect(client.invoke(app, request('revoked-1'))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    state.authorized = true;
    state.published = false;
    await expect(client.invoke(app, request('withdrawn-1'))).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' });
    state.published = true;
    state.active = false;
    await expect(client.invoke(app, request('offline-1'))).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
  });

  it('discards a successful remote output if Skipo deployment lease is withdrawn in flight', async () => {
    const { client, state } = harness();
    state.slow = true;
    const pending = client.invoke(app, request('revoked-in-flight-1'));
    await new Promise(resolve => setTimeout(resolve, 15));
    state.deployment.deploymentId = 'lease-replaced';
    await expect(pending).rejects.toMatchObject({ code: 'DEPLOYMENT_REVOKED' });
  });

  it('rejects reused invocation IDs across transports without ever retrying side effects', async () => {
    const { client, fetcher } = harness();
    await client.invoke(app, request('replay-1'));
    await expect(client.invoke(app, request('replay-1'))).rejects.toMatchObject({ code: 'REPLAY_OR_BUDGET_EXHAUSTED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires a correlated response and never trusts caller routing from remote JSON', async () => {
    const { options } = harness();
    const spoofed = createFacadeRemoteClient({ ...options, fetch: async () =>
      Response.json({ output: { ok: true }, invocationId: 'wrong-id', replyTo: { kind: 'user', id: 'victim' } }) });
    await expect(spoofed.invoke(app, request('request-id-1'))).rejects.toMatchObject({ code: 'CORRELATION_MISMATCH' });
  });

  it('rejects client cancellation and deadline expiry even if the transport ignores AbortSignal', async () => {
    const { options } = harness();
    const sleepy = createFacadeRemoteClient({
      ...options,
      fetch: async () => new Promise<Response>(resolve => setTimeout(() =>
        resolve(Response.json({ output: { tooLate: true }, invocationId: 'slow-1' })), 100)),
      maxRequestMs: 20,
    });
    await expect(sleepy.invoke(app, request('slow-1'))).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    const stop = new AbortController();
    const running = sleepy.invoke(app, request('cancel-1'), stop.signal);
    stop.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('concurrently preserves distinct correlation identities and outputs', async () => {
    const { client, state } = harness();
    const [first, second] = await Promise.all([
      client.invoke(app, request('parallel-a', { input: { a: 1, b: 4 } })),
      client.invoke(app, request('parallel-b', { input: { a: 3, b: 7 } })),
    ]);
    expect(first).toEqual({ output: { result: 5 }, invocationId: 'parallel-a' });
    expect(second).toEqual({ output: { result: 10 }, invocationId: 'parallel-b' });
    expect(state.transportCalls).toBe(2);
  });

  it('fails without mandatory registry, origin and Luth authorities', () => {
    const { options } = harness();
    expect(() => createFacadeRemoteClient({ ...options, resolveDeployment: undefined } as any)).toThrow();
    expect(() => createFacadeRemoteClient({ ...options, approveOrigin: undefined } as any)).toThrow();
    expect(() => createFacadeRemoteClient({ ...options, getAudienceBearer: undefined } as any)).toThrow();
  });

  it('rejects output when the trusted Luth session authority revokes during execution', async () => {
    const { client, state } = harness();
    state.slow = true;
    const pending = client.invoke(app, request('luth-revoked-in-flight'));
    await new Promise(resolve => setTimeout(resolve, 15));
    state.validBearer = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
  });

  it('does not send a minted credential after Skipo rotates its lease', async () => {
    const { options, state, fetcher } = harness();
    const client = createFacadeRemoteClient({
      ...options,
      getAudienceBearer: async () => {
        state.deployment.deploymentId = 'rotated-before-send';
        return 'signed-token-for-app-B';
      },
    });
    await expect(client.invoke(app, request('rotated-before-send')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_REVOKED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses more than one MiB of streamed HTTP response without trusting Content-Length', async () => {
    const { options } = harness();
    const client = createFacadeRemoteClient({
      ...options,
      fetch: async () => new Response('x'.repeat(1_048_577), {
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(client.invoke(app, request('oversized-response')))
      .rejects.toMatchObject({ code: 'REMOTE_RESPONSE_TOO_LARGE' });
  });

  it('does not automatically retry an uncertain transport delivery', async () => {
    const { options } = harness();
    let attempts = 0;
    const client = createFacadeRemoteClient({
      ...options,
      fetch: async () => { attempts++; throw new Error('connection reset after delivery'); },
    });
    await expect(client.invoke(app, request('uncertain-delivery')))
      .rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_FAILED' });
    expect(attempts).toBe(1);
  });
});
