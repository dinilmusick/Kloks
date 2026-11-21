import { describe, expect, it, vi } from 'vitest';
import {
  createFacadeInvocationBoundary,
  type FacadeInvocationAuthorityContext,
  type VerifiedFacadeCaller,
} from './facadeInvocation.js';
import {
  createLuthFacadeBearerIssuer, createLuthFacadeTargetAuthorities,
} from './facadeLuthAuthority.js';
import type { VerifiedFacadeDeployment } from './facadeRemoteClient.js';

/**
 * Protocol contract for staged Luth PR #23's exact introspect/revalidate JSON.
 * Fetch dispatches to a simulated Luth endpoint; this is NOT an actual
 * deployed-Luth database or multi-user certification.
 */
const identity = {
  principalId: 'user-A', callerAppId: 'app-A', targetAppId: 'app-B',
  sourceWorkspaceId: 'workspace-A', targetWorkspaceId: 'workspace-B',
  scope: 'backend.invoke', resourceKey: 'math.add:v2',
};
const validReceipt = 'signed.receipt.signature';
const receiptId = 'a'.repeat(64);
const invocation = {
  operationId: 'math.add', version: 'v2', targetWorkspaceId: 'workspace-B',
  invocationId: 'attempt-1', input: { a: 2, b: 3 },
};
function caller(): VerifiedFacadeCaller {
  const now = Date.now();
  return {
    principalId: 'user-A', sourceAppId: 'app-A', sourceWorkspaceId: 'workspace-A',
    audience: 'app-B', sessionId: 'session-A',
    invoker: { kind: 'endpoint-agent', id: 'executor-A' }, chain: ['app-A'],
    depth: 1, maxDepth: 5, remainingCalls: 4,
    deadlineAt: now + 20_000, expiresAt: now + 20_000,
  };
}
function fixture() {
  const state = {
    sessionLive: true, grant: true, operationCurrent: true, consumed: false,
    execute: 0, revalidate: 0, currentCaller: true, wrongScope: false, slow: false,
  };
  const responses: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request = JSON.parse(String(init?.body)) as Record<string, string>;
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer target-session-assertion');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(url).toMatch(/^https:\/\/luth\.example\.com\/api\/oauth\/(introspect|revalidate)$/);
    responses.push(url);
    if (url.endsWith('/introspect')) {
      expect(request.token).toBe('delegated.one.use');
      if (state.consumed) return Response.json({ authenticated: false }, { status: 401 });
      state.consumed = true;
      return Response.json({
        authenticated: true, targetAuthorizationRequired: true,
        ...identity, scope: state.wrongScope ? 'workflow.invoke' : identity.scope,
        invocationId: receiptId, admission_token: validReceipt, admission_expires_in: 600,
      });
    }
    expect(request).toEqual({ admission_token: validReceipt, invocation_id: receiptId });
    state.revalidate++;
    if (!state.sessionLive || !state.grant) return Response.json({ authenticated: false }, { status: 401 });
    return Response.json({
      authenticated: true, revalidated: true, targetAuthorizationRequired: true,
      ...identity, invocationId: receiptId,
    });
  });
  const luth = createLuthFacadeTargetAuthorities({
    luthOrigin: 'https://luth.example.com',
    targetAppId: 'app-B',
    getTargetSessionAssertion: async () => 'target-session-assertion',
    resolveResource: async (ctx: FacadeInvocationAuthorityContext) =>
      ctx.operationId === 'math.add' && ctx.version === 'v2' && state.operationCurrent
        ? { scope: 'backend.invoke', resourceKey: 'math.add:v2' } : null,
    resolveTrustedCaller: async () => caller(),
    recheckTrustedCaller: async admitted => state.currentCaller
      ? { ...admitted, chain: [...admitted.chain], invoker: { ...admitted.invoker } } : null,
    fetch: fetcher as typeof fetch,
  });
  const used = new Set<string>();
  const boundary = createFacadeInvocationBoundary({
    targetAppId: 'app-B',
    facade: {
      services: {
        math: {
          execute: async (_operation: string, input: unknown) => {
            state.execute++;
            if (state.slow) await new Promise(resolve => setTimeout(resolve, 40));
            const value = input as { a: number; b: number };
            return { result: value.a + value.b };
          },
        },
      },
      orchestrations: {},
    },
    ...luth,
    listCurrentOperations: async () => state.operationCurrent ? [{
      id: 'math.add', version: 'v2', name: 'Addition', kind: 'static',
      targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
    }] : [],
    authorize: async () => state.grant,
    deploymentEligible: async () => true,
    consumeInvocation: async (_caller, id) => {
      if (used.has(id)) return false;
      used.add(id);
      return true;
    },
    invokePublishedWorkflow: async () => { throw new Error('Workflow not selected'); },
    delegateCredential: async () => { throw new Error('Not delegated by target'); },
  });
  return { boundary, state, fetcher, responses, luth };
}

describe('actual Luth #23 wire-protocol adapter', () => {
  it('runs target guard with exactly one consuming admission and a separate non-consuming output receipt', async () => {
    const { boundary, state, fetcher, responses } = fixture();
    const reply = await boundary.http(new Request('https://app-b.example/api/crossapp/invoke', {
      method: 'POST', headers: { Authorization: 'Bearer delegated.one.use' },
      body: JSON.stringify(invocation),
    }));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({
      output: { result: 5 }, replyTo: { kind: 'endpoint-agent', id: 'executor-A' },
      invocationId: 'attempt-1',
    });
    expect(state).toMatchObject({ consumed: true, execute: 1, revalidate: 1 });
    expect(responses.map(x => x.split('/').at(-1))).toEqual(['introspect', 'revalidate']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cannot replay the same one-use bearer after successful execution', async () => {
    const { boundary, state } = fixture();
    await boundary.invoke('delegated.one.use', invocation, 'http');
    await expect(boundary.invoke('delegated.one.use', {
      ...invocation, invocationId: 'attempt-2',
    }, 'http')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.execute).toBe(1);
    expect(state.revalidate).toBe(1);
  });

  it('denies mismatched Luth scope before even executing a target operation', async () => {
    const { boundary, state } = fixture();
    state.wrongScope = true;
    await expect(boundary.invoke('delegated.one.use', invocation, 'graph'))
      .rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.execute).toBe(0);
  });

  it('discards output when Luth reports session revocation in flight', async () => {
    const { boundary, state } = fixture();
    state.slow = true;
    const pending = boundary.invoke('delegated.one.use', invocation, 'agent');
    await new Promise(resolve => setTimeout(resolve, 20));
    state.sessionLive = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.execute).toBe(1);
    expect(state.revalidate).toBe(1);
  });

  it('suppresses outputs when the exact resource revision is retired while executing', async () => {
    const { boundary, state } = fixture();
    state.slow = true;
    const pending = boundary.invoke('delegated.one.use', invocation, 'http');
    await new Promise(resolve => setTimeout(resolve, 20));
    state.operationCurrent = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.execute).toBe(1);
  });

  it('suppresses outputs when the trusted immediate invoker ceases to be current', async () => {
    const { boundary, state } = fixture();
    state.slow = true;
    const pending = boundary.invoke('delegated.one.use', invocation, 'mcp');
    await new Promise(resolve => setTimeout(resolve, 20));
    state.currentCaller = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.execute).toBe(1);
  });

  it('does not use a different original admission object to access the output receipt', async () => {
    const { luth } = fixture();
    const context: FacadeInvocationAuthorityContext = {
      operationId: 'math.add', version: 'v2', targetWorkspaceId: 'workspace-B',
      invocationId: 'attempt-1', transport: 'http',
    };
    const admitted = await luth.verifyLuthCredential('delegated.one.use', 'app-B', context);
    expect(admitted).not.toBeNull();
    await expect(luth.revalidateLuthCaller(admitted!, 'app-B', context, { ...admitted! }))
      .resolves.toBeNull();
    await expect(luth.revalidateLuthCaller(admitted!, 'app-B', context, admitted!))
      .resolves.toMatchObject({ principalId: 'user-A' });
  });

  it('requires independent target session assertion and trusted identity callbacks', () => {
    expect(() => createLuthFacadeTargetAuthorities({
      luthOrigin: 'https://localhost',
      targetAppId: 'app-B',
      getTargetSessionAssertion: async () => 'x',
      resolveResource: async () => ({ scope: 'backend.invoke', resourceKey: 'math.add:v2' }),
      resolveTrustedCaller: async () => caller(),
      recheckTrustedCaller: async () => caller(),
    })).toThrow();
  });
});

describe('Luth source-side audience-bound delegation', () => {
  const deployment: VerifiedFacadeDeployment = {
    appId: 'app-B', deploymentId: 'lease-1', workspaceId: 'workspace-B',
    environment: 'staging', origin: 'https://app-b.example.com',
    leaseExpiresAt: Date.now() + 30_000, verified: true,
  };

  it('calls /delegate with the exact scope and verifies the target audience before sending a bearer', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://luth.example.com/api/oauth/delegate');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer source-session-assertion');
      expect(JSON.parse(String(init?.body))).toEqual({
        audience: 'app-B', caller_workspace_id: 'workspace-A',
        target_workspace_id: 'workspace-B', scope: 'backend.invoke', resource_key: 'math.add:v2',
      });
      return Response.json({
        access_token: 'delegated.one.use', token_type: 'Bearer',
        scope: 'backend.invoke', audience: 'app-B', expires_in: 60,
      });
    });
    const issue = createLuthFacadeBearerIssuer({
      luthOrigin: 'https://luth.example.com',
      getSourceSessionAssertion: async () => 'source-session-assertion',
      resolveIntent: async () => ({
        caller_workspace_id: 'workspace-A', target_workspace_id: 'workspace-B',
        scope: 'backend.invoke', resource_key: 'math.add:v2',
      }),
      fetch: fetcher as typeof fetch,
    });
    const token = await issue(deployment, { id: 'math.add', version: 'v2' }, new AbortController().signal);
    expect(token).toBe('delegated.one.use');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a source intent for another target workspace before calling Luth', async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: 'do.not.issue' }));
    const issue = createLuthFacadeBearerIssuer({
      luthOrigin: 'https://luth.example.com',
      getSourceSessionAssertion: async () => 'source-session-assertion',
      resolveIntent: async () => ({
        caller_workspace_id: 'workspace-A', target_workspace_id: 'workspace-X',
        scope: 'backend.invoke', resource_key: 'math.add:v2',
      }),
      fetch: fetcher as typeof fetch,
    });
    await expect(issue(deployment, { id: 'math.add', version: 'v2' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'DELEGATION_DENIED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('mints a workflow.invoke proof only for an explicit FOD workflow selection', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        audience: 'app-B', caller_workspace_id: 'workspace-A',
        target_workspace_id: 'workspace-B',
        scope: 'workflow.invoke', resource_key: 'flow-secret-123:v4',
      });
      return Response.json({
        access_token: 'workflow.one.use', token_type: 'Bearer',
        scope: 'workflow.invoke', audience: 'app-B', expires_in: 60,
      });
    });
    const issue = createLuthFacadeBearerIssuer({
      luthOrigin: 'https://luth.example.com',
      getSourceSessionAssertion: async () => 'source-session-assertion',
      resolveIntent: async () => ({
        caller_workspace_id: 'workspace-A', target_workspace_id: 'workspace-B',
        scope: 'workflow.invoke', resource_key: 'flow-secret-123:v4',
      }),
      fetch: fetcher as typeof fetch,
    });
    await expect(issue(deployment, { id: 'workflow.report', version: 'v4', kind: 'workflow' },
      new AbortController().signal)).resolves.toBe('workflow.one.use');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not mint backend.invoke authority for a workflow or workflow.invoke authority for a static method', async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: 'should-not-issue' }));
    for (const [kind, scope] of [
      ['workflow', 'backend.invoke'], ['static', 'workflow.invoke'],
    ] as const) {
      const issue = createLuthFacadeBearerIssuer({
        luthOrigin: 'https://luth.example.com',
        getSourceSessionAssertion: async () => 'source-session-assertion',
        resolveIntent: async () => ({
          caller_workspace_id: 'workspace-A', target_workspace_id: 'workspace-B',
          scope, resource_key: 'flow-secret-123:v4',
        }),
        fetch: fetcher as typeof fetch,
      });
      await expect(issue(deployment, { id: 'workflow.report', version: 'v4', kind },
        new AbortController().signal)).rejects.toMatchObject({ code: 'DELEGATION_DENIED' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
