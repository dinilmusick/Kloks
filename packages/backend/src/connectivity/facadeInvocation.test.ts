import { describe, expect, it } from 'vitest';
import {
  createFacadeInvocationBoundary,
  FacadeInvocationDenied,
  type VerifiedFacadeCaller,
  type FacadeInvocation,
  type FacadeOperationDescriptor,
} from './facadeInvocation.js';

const staticOp: FacadeOperationDescriptor = {
  id: 'Math.add', version: 'v1', name: 'Add numbers', kind: 'static',
  targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
};
const workflow: FacadeOperationDescriptor = {
  id: 'workflow.report', version: 'v4', name: 'Published report', kind: 'workflow',
  targetWorkspaceId: 'workspace-B', workflowId: 'report-123',
};
const request = (id: string, changes: Partial<FacadeInvocation> = {}): FacadeInvocation => ({
  operationId: 'Math.add', version: 'v1', targetWorkspaceId: 'workspace-B',
  invocationId: id, input: { a: 2, b: 3 }, ...changes,
});

function fixture() {
  const state = { grant: true, deployed: true, published: true, owner: 'user-1', version: 'v1', workspace: 'workspace-B', slow: false };
  const calls: Array<{ operation: string; signal?: AbortSignal }> = [];
  const used = new Set<string>();
  const now = Date.now();
  const principal = (changes: Partial<VerifiedFacadeCaller> = {}): VerifiedFacadeCaller => ({
    principalId: 'user-1',
    sourceAppId: 'app-A',
    sourceWorkspaceId: 'workspace-A',
    audience: 'app-B',
    sessionId: 'session-1',
    invoker: { kind: 'app-agent', id: 'aiko-A' },
    chain: ['app-A'],
    depth: 1,
    maxDepth: 5,
    remainingCalls: 10,
    deadlineAt: now + 30_000,
    expiresAt: now + 30_000,
    ...changes,
  });
  const proofs = new Map<string, VerifiedFacadeCaller>([
    ['token-B', principal()],
    ['token-other-user', principal({ principalId: 'user-2' })],
    ['token-bad-workspace', principal({ sourceWorkspaceId: 'workspace-other' })],
    ['token-B-nested', principal({ sourceAppId: 'app-B', chain: ['app-A', 'app-B'], depth: 2, invoker: { kind: 'workflow-agent', id: 'flow-B' } })],
    ['token-B-expired', principal({ expiresAt: now - 1 })],
  ]);

  const backend = createFacadeInvocationBoundary({
    targetAppId: 'app-B',
    facade: {
      services: {
        math: {
          execute: async (operation: string, input: any, context: any) => {
            calls.push({ operation, signal: context?.signal });
            if (state.slow) return new Promise(resolve => setTimeout(() => resolve({ result: 5 }), 300));
            return { result: Number(input.a) + Number(input.b) };
          },
        },
      },
      orchestrations: {},
    },
    verifyLuthCredential: async (credential, audience) => {
      const found = proofs.get(credential);
      return found?.audience === audience ? { ...found, chain: [...found.chain] } : null;
    },
    listCurrentOperations: async workspace => workspace === state.workspace
      ? [{ ...staticOp, version: state.version }, ...(state.published ? [workflow] : [])]
      : [],
    deploymentEligible: async () => state.deployed,
    authorize: async ({ caller, operation }) => state.grant &&
      caller.principalId === state.owner && caller.sourceWorkspaceId === 'workspace-A' &&
      operation.targetWorkspaceId === state.workspace,
    consumeInvocation: async (caller, id) => {
      if (used.has(caller.audience + ':' + id)) return false;
      used.add(caller.audience + ':' + id);
      return true;
    },
    invokePublishedWorkflow: async (reference, input, signal) => {
      calls.push({ operation: reference.workflowId, signal });
      return { executed: reference.workflowId, version: reference.version, input };
    },
    delegateCredential: async (_caller, targetAppId) => {
      if (targetAppId === 'app-B') return _caller.sourceAppId === 'app-B' ? 'token-B-nested' : 'token-B';
      return '';
    },
  });

  const rootCaller = principal({ audience: 'app-A', depth: 0, sourceAppId: 'app-A', chain: ['app-A'], invoker: { kind: 'user', id: 'user-1' } });
  const a = createFacadeInvocationBoundary({
    targetAppId: 'app-A', facade: { services: {}, orchestrations: {} },
    verifyLuthCredential: async (credential, audience) => credential === 'token-A' && audience === 'app-A' ? rootCaller : null,
    listCurrentOperations: async () => [],
    deploymentEligible: async () => true,
    authorize: async () => true,
    consumeInvocation: async () => true,
    invokePublishedWorkflow: async () => { throw new Error('No A workflows'); },
    delegateCredential: async (_caller, targetAppId) => targetAppId === 'app-B' ? 'token-B' : '',
  });

  return { state, proofs, backend, a, calls, principal };
}

describe('two-app BackendFacade invocation boundary', () => {
  it('routes real HTTP and MCP calls through the same authorized target operation', async () => {
    const { backend, calls } = fixture();
    const list = await backend.http(new Request('https://app-b.example/api/crossapp/operations?workspace=workspace-B', {
      headers: { Authorization: 'Bearer token-B' },
    }));
    expect(list.status).toBe(200);
    const discovered = await list.json() as any;
    expect(discovered.operations.map((op: any) => op.id)).toEqual(['Math.add', 'workflow.report']);
    expect(JSON.stringify(discovered)).not.toContain('workflowId');

    const http = await backend.http(new Request('https://app-b.example/api/crossapp/invoke', {
      method: 'POST', headers: { Authorization: 'Bearer token-B', 'Content-Type': 'application/json' },
      body: JSON.stringify(request('http-1')),
    }));
    expect(http.status).toBe(200);
    expect((await http.json() as any).output).toEqual({ result: 5 });

    const mcp = await backend.mcp(new Request('https://app-b.example/mcp', {
      method: 'POST', headers: { Authorization: 'Bearer token-B', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { invocation: request('mcp-1') } }),
    }));
    expect(mcp.status).toBe(200);
    expect((await mcp.json() as any).result.structuredContent).toEqual({ result: 5 });
    expect(calls.map(call => call.operation)).toEqual(['add', 'add']);
  });

  it('routes graph and agent calls to the same guard and preserves the verified immediate invoker', async () => {
    const { backend } = fixture();
    const graph = await backend.invoke('token-B', request('graph-1'), 'graph');
    expect(graph.replyTo).toEqual({ kind: 'app-agent', id: 'aiko-A' });
    expect(graph.output).toEqual({ result: 5 });
    const agent = await backend.invoke('token-B-nested', request('agent-1'), 'agent');
    expect(agent.replyTo).toEqual({ kind: 'workflow-agent', id: 'flow-B' });
  });

  it('denies revoked grants and cross-user/cross-workspace discovery without counts or identifiers', async () => {
    const { backend, state } = fixture();
    expect(await backend.discover('token-other-user', 'workspace-B', 'http')).toEqual([]);
    expect(await backend.discover('token-bad-workspace', 'workspace-B', 'mcp')).toEqual([]);
    await expect(backend.invoke('token-other-user', request('cross-user'), 'http')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(backend.invoke('token-bad-workspace', request('cross-workspace'), 'graph')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    state.grant = false;
    expect(await backend.discover('token-B', 'workspace-B', 'http')).toEqual([]);
    await expect(backend.invoke('token-B', request('revoked'), 'mcp')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('denies unavailable deployment, retired operation version and withdrawn workflow', async () => {
    const { backend, state } = fixture();
    state.deployed = false;
    await expect(backend.invoke('token-B', request('offline'), 'agent')).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.deployed = true;
    state.version = 'v2';
    await expect(backend.invoke('token-B', request('stale-version'), 'agent')).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' });
    state.published = false;
    await expect(backend.invoke('token-B', request('withdrawn', { operationId: 'workflow.report', version: 'v4' }), 'graph')).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' });
  });

  it('invokes a published workflow from its owning workspace without returning the raw graph', async () => {
    const { backend } = fixture();
    const result = await backend.invoke('token-B', request('workflow-1', {
      operationId: 'workflow.report', version: 'v4', input: { filter: 'today' },
    }), 'http');
    expect(result.output).toEqual({ executed: 'report-123', version: 'v4', input: { filter: 'today' } });
    expect(JSON.stringify(await backend.discover('token-B', 'workspace-B', 'http'))).not.toContain('report-123');
  });

  it('fails closed on absent/expired Luth credentials and forged client-supplied parent claims', async () => {
    const { backend } = fixture();
    await expect(backend.invoke('token-B-expired', request('expired'), 'http')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(backend.invoke('untrusted', request('unverified'), 'http')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(backend.invoke('token-B', { ...request('forged'), principalId: 'user-1' } as any, 'http')).rejects.toMatchObject({ code: 'UNTRUSTED_CLAIMS' });
  });

  it('rejects malformed capability handles and replayed invocation identity', async () => {
    const { backend } = fixture();
    for (const bad of ['../admin', 'math/add', 'bad?x', 'a%2fb', 'constructor', '__proto__', 'path#frag']) {
      await expect(backend.invoke('token-B', request('bad-' + bad, { operationId: bad }), 'graph')).rejects.toMatchObject({ code: 'MALFORMED_HANDLE' });
    }
    await backend.invoke('token-B', request('unique-1'), 'http');
    await expect(backend.invoke('token-B', request('unique-1'), 'mcp')).rejects.toMatchObject({ code: 'REPLAY_OR_BUDGET_EXHAUSTED' });
  });

  it('supports A-to-B delegated execution while rejecting an A-to-B-to-A cycle', async () => {
    const { a, backend } = fixture();
    const result = await a.delegate('token-A', 'app-B', request('delegated-1'),
      (credential, payload, signal) => backend.invoke(credential, payload, 'agent', signal));
    expect((result as any).output).toEqual({ result: 5 });
    await expect(backend.delegate('token-B-nested', 'app-A', request('cycle-1'),
      () => Promise.resolve('should-not-run'))).rejects.toMatchObject({ code: 'APP_CYCLE' });
  });

  it('allows bounded same-app nested calls without a cross-app cycle', async () => {
    const { backend } = fixture();
    const output = await backend.delegate('token-B-nested', 'app-B', request('nested-1'),
      (credential, payload, signal) => backend.invoke(credential, payload, 'agent', signal));
    expect((output as any).output).toEqual({ result: 5 });
  });

  it('propagates a verified deadline and cancellation to the existing facade executor', async () => {
    const { backend, proofs, state, calls, principal } = fixture();
    state.slow = true;
    proofs.set('token-short', principal({ deadlineAt: Date.now() + 20 }));
    await expect(backend.invoke('token-short', request('deadline-1'), 'graph')).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls[0].signal?.aborted).toBe(true);
    const controller = new AbortController();
    const pending = backend.invoke('token-B', request('cancel-1'), 'agent', controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('provides typed denial errors for the hosting router', async () => {
    const { backend } = fixture();
    await expect(backend.invoke('', request('missing'), 'http')).rejects.toBeInstanceOf(FacadeInvocationDenied);
  });
});
