import { describe, expect, it, vi } from 'vitest';
import { createFacadeInvocationBoundary, type VerifiedFacadeCaller } from './facadeInvocation.js';
import { createFacadeRemoteClient } from './facadeRemoteClient.js';
import { createLuthFacadeTargetAuthorities, createLuthFacadeBearerIssuer } from './facadeLuthAuthority.js';
import { createSkipoFacadeDeploymentResolver, type SkipoResolvedCapability } from './facadeSkipoResolver.js';

/**
 * Two-application Request/Response fixture using the exact staged Luth #23
 * delegate/one-use introspect/revalidate JSON and Skipo #208
 * list/revalidate/registrar lease contracts. All network endpoints are
 * simulated in-memory; this is NOT live Neon or two-deployment certification.
 */
const id = '99999999-9999-4999-8999-999999999999';
const row: SkipoResolvedCapability = {
  deploymentId: id, url: 'https://app-b.example.com', revision: 2,
  descriptor: {
    id: 'math.add', description: 'Math', inputSchema: {}, outputSchema: {},
    invocation: { serviceId: 'math', operationId: 'add' },
  },
};
function harness() {
  const state = {
    grant: true, sessionLive: true, leaseLive: true, version: 2,
    callerUser: 'user-A', delay: false,
    issued: 0, admitted: 0, outputs: 0, executed: 0, targetRequests: 0,
  };
  type Intent = {
    audience: string; caller_workspace_id: string;
    target_workspace_id: string; scope: string; resource_key: string;
  };
  const issued = new Map<string, Intent>();
  const consumed = new Set<string>();
  const receipts = new Map<string, Intent & { invocationId: string }>();
  const luthFetch = vi.fn(async (address: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(address);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    const assertion = new Headers(init?.headers).get('authorization');
    expect(url.startsWith('https://luth.example.com/api/oauth/')).toBe(true);
    expect(init?.redirect).toBe('error');
    const active = state.grant && state.sessionLive && state.callerUser === 'user-A';
    if (path === '/api/oauth/delegate') {
      expect(assertion).toBe('Bearer source-session');
      if (!active) return Response.json({ error: 'access_denied' }, { status: 403 });
      state.issued++;
      const token = 'delegated.' + state.issued + '.signature';
      issued.set(token, body as unknown as Intent);
      return Response.json({
        access_token: token, token_type: 'Bearer', scope: body.scope,
        audience: body.audience, expires_in: 60,
      });
    }
    expect(assertion).toBe('Bearer target-session');
    const identity = (intent: Intent) => ({
      principalId: 'user-A', callerAppId: 'app-a', targetAppId: intent.audience,
      sourceWorkspaceId: intent.caller_workspace_id,
      targetWorkspaceId: intent.target_workspace_id,
      scope: intent.scope, resourceKey: intent.resource_key,
      targetAuthorizationRequired: true,
    });
    if (path === '/api/oauth/introspect') {
      const intent = issued.get(body.token);
      if (!active || !intent || consumed.has(body.token)) {
        return Response.json({ authenticated: false }, { status: 401 });
      }
      consumed.add(body.token);
      state.admitted++;
      const invocationId = state.admitted.toString(16).padStart(64, '0');
      const receipt = 'receipt.' + state.admitted + '.signed';
      receipts.set(receipt, { ...intent, invocationId });
      return Response.json({
        authenticated: true, ...identity(intent), invocationId,
        admission_token: receipt, admission_expires_in: 600,
      });
    }
    if (path === '/api/oauth/revalidate') {
      const receipt = receipts.get(body.admission_token);
      if (!active || !receipt || receipt.invocationId !== body.invocation_id) {
        return Response.json({ authenticated: false }, { status: 401 });
      }
      state.outputs++;
      return Response.json({
        authenticated: true, revalidated: true, ...identity(receipt),
        invocationId: receipt.invocationId,
      });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
  const resource = (ctx: { operationId: string; version: string }) => {
    if (ctx.operationId === 'catalog.discover' && ctx.version === 'current') {
      return { scope: 'backend.invoke' as const, resourceKey: 'catalog.discover:current' };
    }
    if (ctx.operationId === 'math.add' && ctx.version === '2' && state.version === 2) {
      return { scope: 'backend.invoke' as const, resourceKey: 'math.add:2' };
    }
    return null;
  };
  const caller: VerifiedFacadeCaller = {
    principalId: 'user-A', sourceAppId: 'app-a', sourceWorkspaceId: 'workspace-A',
    audience: 'app-b', sessionId: 'session-A',
    invoker: { kind: 'app-agent', id: 'agent-A' }, chain: ['app-a'],
    depth: 1, maxDepth: 5, remainingCalls: 8,
    deadlineAt: Date.now() + 20_000, expiresAt: Date.now() + 20_000,
  };
  const luthTarget = createLuthFacadeTargetAuthorities({
    luthOrigin: 'https://luth.example.com', targetAppId: 'app-b',
    getTargetSessionAssertion: async () => 'target-session',
    resolveResource: async ctx => resource(ctx),
    resolveTrustedCaller: async () => state.callerUser === 'user-A' ? { ...caller } : null,
    recheckTrustedCaller: async admitted => state.sessionLive
      ? { ...admitted, invoker: { ...admitted.invoker }, chain: [...admitted.chain] } : null,
    fetch: luthFetch as typeof fetch,
  });
  const used = new Set<string>();
  const target = createFacadeInvocationBoundary({
    targetAppId: 'app-b',
    facade: {
      services: { math: { execute: async (_operation: string, input: unknown) => {
        state.executed++;
        if (state.delay) await new Promise(resolve => setTimeout(resolve, 50));
        const p = input as { a: number; b: number };
        return { result: p.a + p.b };
      } } },
      orchestrations: {},
    },
    ...luthTarget,
    listCurrentOperations: async () => state.version === 2 ? [{
      id: 'math.add', version: '2', name: 'Addition', kind: 'static',
      targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
    }] : [],
    authorize: async () => state.grant && state.callerUser === 'user-A',
    deploymentEligible: async () => state.leaseLive,
    consumeInvocation: async (_caller, invocationId) => {
      if (used.has(invocationId)) return false;
      used.add(invocationId);
      return true;
    },
    invokePublishedWorkflow: async () => { throw new Error('No FOD graph'); },
    delegateCredential: async () => { throw new Error('No target delegation'); },
  });
  const skipo = createSkipoFacadeDeploymentResolver({
    environment: 'production',
    discovery: {
      list: async () => state.grant && state.callerUser === 'user-A' && state.version === 2 ? [row] : [],
      resolve: async () => row,
      revalidate: async (_request, selector) => state.grant && state.callerUser === 'user-A' &&
        state.version === 2 && selector.revision === 2 && selector.capabilityId === 'math.add'
          ? row : null,
    },
    getAuthenticatedRequest: async () => new Request('https://app-a.example.com/server', {
      headers: { Authorization: 'Bearer live-source-session' },
    }),
    inspectAttestedLease: async () => state.leaseLive ? {
      appId: 'app-b', deploymentId: id, workspaceId: 'workspace-B',
      environment: 'production', origin: 'https://app-b.example.com',
      verified: true, leaseExpiresAt: Date.now() + 30_000,
    } : null,
  });
  const luthSource = createLuthFacadeBearerIssuer({
    luthOrigin: 'https://luth.example.com',
    getSourceSessionAssertion: async () => 'source-session',
    resolveIntent: async (deployment, operation) => {
      const requested = operation
        ? resource({ operationId: operation.id, version: operation.version })
        : resource({ operationId: 'catalog.discover', version: 'current' });
      return requested && {
        caller_workspace_id: 'workspace-A', target_workspace_id: deployment.workspaceId,
        scope: requested.scope, resource_key: requested.resourceKey,
      };
    },
    fetch: luthFetch as typeof fetch,
  });
  const targetFetch = vi.fn(async (address: RequestInfo | URL, init?: RequestInit) => {
    state.targetRequests++;
    return target.http(new Request(address, init));
  });
  const remote = createFacadeRemoteClient({
    environment: 'production',
    resolveDeployment: skipo,
    approveOrigin: async (origin, deployment) =>
      origin === 'https://app-b.example.com' && deployment.verified,
    getAudienceBearer: luthSource,
    fetch: targetFetch as typeof fetch,
    maxRequestMs: 2000,
  });
  const call = (invocationId: string, a = 2, b = 3) => remote.invoke('app-b', {
    operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
    invocationId, input: { a, b },
  });
  return { remote, state, call, luthFetch, targetFetch };
}

describe('two-app Luth / Skipo / Kloks bridge protocol fixture', () => {
  it('discovers and executes through all three verified authorities, preserving immediate caller identity', async () => {
    const { remote, call, state } = harness();
    await expect(remote.discover('app-b', 'workspace-B')).resolves.toMatchObject([
      { id: 'math.add', version: '2', targetWorkspaceId: 'workspace-B' },
    ]);
    await expect(call('integrated-1', 4, 6)).resolves.toEqual({
      output: { result: 10 }, invocationId: 'integrated-1',
    });
    expect(state).toMatchObject({
      issued: 2, admitted: 2, outputs: 2, executed: 1, targetRequests: 2,
    });
  });

  it('revokes grant during execution without returning an already-produced output', async () => {
    const { call, state } = harness();
    state.delay = true;
    const pending = call('integrated-revocation');
    await new Promise(resolve => setTimeout(resolve, 25));
    state.grant = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.executed).toBe(1);
    expect(state.outputs).toBe(0);
  });

  it('denies cross-user discovery and invocation before target dispatch', async () => {
    const { remote, call, state, targetFetch } = harness();
    state.callerUser = 'user-B';
    await expect(remote.discover('app-b', 'workspace-B'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    await expect(call('wrong-user')).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it('rejects replay with a newly delegated bearer while allowing independent concurrency', async () => {
    const { call, state } = harness();
    await expect(call('unique-1')).resolves.toMatchObject({ output: { result: 5 } });
    await expect(call('unique-1')).rejects.toMatchObject({ code: 'REPLAY_OR_BUDGET_EXHAUSTED' });
    const [a, b] = await Promise.all([call('unique-2', 1, 2), call('unique-3', 3, 4)]);
    expect(a.output).toEqual({ result: 3 });
    expect(b.output).toEqual({ result: 7 });
    expect(state.executed).toBe(3);
  });
});
