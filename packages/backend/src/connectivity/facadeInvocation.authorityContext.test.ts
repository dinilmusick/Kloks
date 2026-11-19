import { describe, expect, it } from 'vitest';
import {
  createFacadeInvocationBoundary,
  type FacadeInvocation,
  type FacadeInvocationAuthorityContext,
  type VerifiedFacadeCaller,
} from './facadeInvocation.js';

const expected: FacadeInvocationAuthorityContext = {
  operationId: 'math.add',
  version: 'v7',
  targetWorkspaceId: 'workspace-B',
  invocationId: 'invocation-1',
  transport: 'graph',
};

function fixture() {
  const time = Date.now();
  const caller: VerifiedFacadeCaller = {
    principalId: 'user-1',
    sourceAppId: 'app-A',
    sourceWorkspaceId: 'workspace-A',
    audience: 'app-B',
    sessionId: 'session-1',
    invoker: { kind: 'app-agent', id: 'agent-A' },
    chain: ['app-A'],
    depth: 1,
    maxDepth: 4,
    remainingCalls: 4,
    deadlineAt: time + 15_000,
    expiresAt: time + 15_000,
  };
  const state = { grant: true, admitted: false, admissions: 0, outputs: 0, debits: 0 };
  const scopes: FacadeInvocationAuthorityContext[] = [];
  const boundary = createFacadeInvocationBoundary({
    targetAppId: 'app-B',
    facade: {
      services: {
        math: {
          execute: async (_operation: string, input: unknown) => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return { value: (input as { value: number }).value + 1 };
          },
        },
      },
      orchestrations: {},
    },
    verifyLuthCredential: async (token, audience, scope) => {
      state.admissions++;
      if (!scope || token !== 'one-use-bearer' || audience !== 'app-B' ||
          state.admitted || JSON.stringify(scope) !== JSON.stringify(expected)) return null;
      scopes.push({ ...scope });
      state.admitted = true;
      return { ...caller };
    },
    revalidateLuthCaller: async (admitted, audience, scope) => {
      state.outputs++;
      scopes.push({ ...scope });
      return state.grant && audience === 'app-B'
        ? { ...admitted, invoker: { ...admitted.invoker }, chain: [...admitted.chain] } : null;
    },
    listCurrentOperations: async () => [{
      id: 'math.add', version: 'v7', name: 'Addition', kind: 'static',
      targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
    }],
    authorize: async () => state.grant,
    deploymentEligible: async () => true,
    consumeInvocation: async (_caller, id, scope) => {
      state.debits++;
      scopes.push({ ...scope });
      return id === expected.invocationId;
    },
    invokePublishedWorkflow: async () => { throw new Error('Unexpected FOD call'); },
    delegateCredential: async () => { throw new Error('Unexpected delegation'); },
  });
  const request: FacadeInvocation = {
    operationId: 'math.add', version: 'v7', targetWorkspaceId: 'workspace-B',
    invocationId: 'invocation-1', input: { value: 4 },
  };
  return { boundary, request, state, scopes };
}

describe('exact identity to Luth and atomic invocation authority', () => {
  it('binds admission, replay debit and output revalidation to the same immutable operation', async () => {
    const { boundary, request, state, scopes } = fixture();
    const originalInput = request.input as { value: number };
    const result = boundary.invoke('one-use-bearer', request, 'graph');
    // Caller-controlled graph inputs can mutate while an async target executes.
    originalInput.value = 999;
    request.operationId = 'math.withdraw';
    request.version = 'v8';
    request.targetWorkspaceId = 'workspace-other';
    request.invocationId = 'spoofed-correlation';
    request.input = { value: 999 };
    await expect(result).resolves.toMatchObject({
      output: { value: 5 },
      invocationId: 'invocation-1',
      replyTo: { kind: 'app-agent', id: 'agent-A' },
    });
    expect(scopes).toEqual([expected, expected, expected]);
    expect(state).toMatchObject({ admissions: 1, outputs: 1, debits: 1 });
  });

  it('suppresses output after the live grant is revoked without replaying the Luth bearer', async () => {
    const { boundary, request, state } = fixture();
    const pending = boundary.invoke('one-use-bearer', request, 'graph');
    await new Promise(resolve => setTimeout(resolve, 10));
    state.grant = false;
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.admissions).toBe(1);
    expect(state.outputs).toBe(1);
    expect(state.debits).toBe(1);
  });

  it('never accepts a second consuming admission of the same signed proof', async () => {
    const { boundary, request, state } = fixture();
    await boundary.invoke('one-use-bearer', request, 'graph');
    await expect(boundary.invoke('one-use-bearer', { ...request, invocationId: 'invocation-2' }, 'graph'))
      .rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.admissions).toBe(2);
    expect(state.debits).toBe(1);
  });
});
