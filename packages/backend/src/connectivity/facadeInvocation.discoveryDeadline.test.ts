import { describe, expect, it } from 'vitest';
import {
  createFacadeInvocationBoundary,
  type FacadeInvocationAuthorityContext,
  type FacadeOperationDescriptor,
  type VerifiedFacadeCaller,
} from './facadeInvocation.js';

const descriptor: FacadeOperationDescriptor = {
  id: 'math.add', version: 'v2', name: 'Addition', kind: 'static',
  targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
};

function fixture(options: {
  revokeSession?: boolean; revokeGrantBeforeOutput?: boolean; hangPreflight?: boolean;
  deadlineMs?: number;
} = {}) {
  const now = Date.now();
  const caller: VerifiedFacadeCaller = {
    principalId: 'user-1', sourceAppId: 'app-A', sourceWorkspaceId: 'workspace-A',
    audience: 'app-B', sessionId: 'session-1', invoker: { kind: 'app-agent', id: 'agent-A' },
    chain: ['app-A'], depth: 1, maxDepth: 4, remainingCalls: 5,
    deadlineAt: now + (options.deadlineMs ?? 5000), expiresAt: now + 5000,
  };
  const state = {
    grant: true, sessionLive: true, lists: 0, admissionCalls: 0, outputChecks: 0,
    debits: 0, executions: 0,
  };
  const scopes: FacadeInvocationAuthorityContext[] = [];
  const boundary = createFacadeInvocationBoundary({
    targetAppId: 'app-B',
    facade: {
      services: {
        math: {
          execute: async () => { state.executions++; return { result: 5 }; },
        },
      },
      orchestrations: {},
    },
    verifyLuthCredential: async (bearer, target, scope) => {
      state.admissionCalls++;
      if (scope) scopes.push({ ...scope });
      return bearer === 'luth' && target === 'app-B' ? { ...caller } : null;
    },
    revalidateLuthCaller: async (admitted, target, scope) => {
      state.outputChecks++;
      scopes.push({ ...scope });
      return target === 'app-B' && state.sessionLive && !options.revokeSession
        ? { ...admitted, invoker: { ...admitted.invoker }, chain: [...admitted.chain] }
        : null;
    },
    listCurrentOperations: async () => {
      state.lists++;
      if (options.revokeGrantBeforeOutput && state.lists === 2) state.grant = false;
      return [descriptor];
    },
    authorize: async () => state.grant,
    deploymentEligible: async () => {
      if (options.hangPreflight) return new Promise<boolean>(() => undefined);
      return true;
    },
    consumeInvocation: async () => { state.debits++; return true; },
    invokePublishedWorkflow: async () => { throw new Error('unreachable'); },
    delegateCredential: async () => { throw new Error('unreachable'); },
  });
  return { boundary, caller, state, scopes };
}

describe('fresh authorized discovery and bounded target admission', () => {
  it('revalidates the exact catalog workspace before disclosing descriptors', async () => {
    const { boundary, scopes, state } = fixture();
    await expect(boundary.discover('luth', 'workspace-B', 'http')).resolves.toEqual([
      { id: 'math.add', version: 'v2', name: 'Addition', kind: 'static', targetWorkspaceId: 'workspace-B' },
    ]);
    expect(scopes).toHaveLength(2);
    for (const scope of scopes) {
      expect(scope).toMatchObject({
        operationId: 'catalog.discover', version: 'current',
        targetWorkspaceId: 'workspace-B', transport: 'http',
      });
      expect(scope.invocationId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(scopes[0].invocationId).toBe(scopes[1].invocationId);
    expect(state).toMatchObject({ admissionCalls: 1, outputChecks: 1, lists: 2, executions: 0 });
  });

  it('removes descriptors revoked after their initial grant checks', async () => {
    const { boundary, state } = fixture({ revokeGrantBeforeOutput: true });
    await expect(boundary.discover('luth', 'workspace-B', 'graph')).resolves.toEqual([]);
    expect(state.lists).toBe(2);
    expect(state.executions).toBe(0);
  });

  it('fails closed on revoked Luth session before returning discovery metadata', async () => {
    const { boundary, state } = fixture({ revokeSession: true });
    await expect(boundary.discover('luth', 'workspace-B', 'agent'))
      .rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.outputChecks).toBe(1);
  });

  it('denies a pre-cancelled discovery before spending a one-use proof', async () => {
    const { boundary, state } = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(boundary.discover('luth', 'workspace-B', 'http', abort.signal))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(state.admissionCalls).toBe(0);
    expect(state.lists).toBe(0);
  });

  it('bounds a hanging deployment admission by the inherited caller deadline', async () => {
    const { boundary, state } = fixture({ hangPreflight: true, deadlineMs: 120 });
    await expect(boundary.invoke('luth', {
      operationId: 'math.add', version: 'v2', targetWorkspaceId: 'workspace-B',
      invocationId: 'deadline-preflight', input: { a: 2, b: 3 },
    }, 'http')).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    expect(state.debits).toBe(0);
    expect(state.executions).toBe(0);
  });

  it('bounds hanging discovery authorization without exposing the catalog', async () => {
    const { boundary, state } = fixture({ hangPreflight: true, deadlineMs: 120 });
    await expect(boundary.discover('luth', 'workspace-B', 'mcp'))
      .rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    expect(state.outputChecks).toBe(0);
  });

  it('blocks malformed target workspace before consuming Luth admission', async () => {
    const { boundary, state } = fixture();
    await expect(boundary.discover('luth', '../workspace', 'http'))
      .rejects.toMatchObject({ code: 'INVALID_WORKSPACE' });
    expect(state.admissionCalls).toBe(0);
  });
});
