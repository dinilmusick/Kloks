import { describe, expect, it } from 'vitest';
import {
  createFacadeInvocationBoundary,
  type VerifiedFacadeCaller,
  type FacadeInvocation,
  type FacadeOperationDescriptor,
} from './facadeInvocation.js';

/**
 * Independent cross-repository contract regression, NOT a live E2E certificate.
 *
 * Luth #21's /api/oauth/introspect runs CONSUME_INVOCATION_SQL:
 * its first successful introspection atomically sets consumed_at; any second
 * introspection of that same bearer returns authenticated:false.
 *
 * Kloks #115 currently invokes verifyLuthCredential twice (admission/output).
 * A target adapter using the one-use Luth endpoint cannot release output.
 *
 * The owner must reconcile the single-use admission proof with a separate,
 * revocation-aware output-time authorization check. Do not solve this by
 * replay-enabling the original bearer or omitting the final grant check.
 */
describe('Luth #21 one-use admission / Kloks #115 output authorization contract', () => {
  function setup(options: { revokeDuringOperation?: boolean } = {}) {
    const now = Date.now();
    const caller: VerifiedFacadeCaller = {
      principalId: 'user-A', sourceAppId: 'app-A',
      sourceWorkspaceId: 'workspace-A', audience: 'app-B', sessionId: 'session-A',
      invoker: { kind: 'app-agent', id: 'agent-A' },
      chain: ['app-A'], depth: 1, maxDepth: 4, remainingCalls: 5,
      deadlineAt: now + 20_000, expiresAt: now + 20_000,
    };
    const op: FacadeOperationDescriptor = {
      id: 'math.add', version: 'v1', name: 'Add',
      kind: 'static', targetWorkspaceId: 'workspace-B',
      serviceId: 'math', serviceOperation: 'add',
    };
    const state = { admitted: false, grant: true, checks: 0, outputs: 0 };
    const boundary = createFacadeInvocationBoundary({
      targetAppId: 'app-B',
      facade: {
        services: {
          math: {
            execute: async (_name: string, input: unknown) => {
              if (options.revokeDuringOperation) state.grant = false;
              const p = input as { a: number; b: number };
              state.outputs += 1;
              return { result: p.a + p.b };
            },
          },
        },
        orchestrations: {},
      },
      verifyLuthCredential: async (credential, audience) => {
        state.checks += 1;
        // Model Luth #21's atomic SQL consumption, not an always-green mock.
        if (credential !== 'single-use-luth-proof' || audience !== 'app-B' || state.admitted) return null;
        state.admitted = true;
        return { ...caller, invoker: { ...caller.invoker }, chain: [...caller.chain] };
      },
      listCurrentOperations: async () => [op],
      deploymentEligible: async () => true,
      authorize: async () => state.grant,
      consumeInvocation: async () => true,
      invokePublishedWorkflow: async () => {
        throw new Error('Unexpected workflow dispatch');
      },
      delegateCredential: async () => '',
    });
    const request: FacadeInvocation = {
      operationId: 'math.add', version: 'v1', targetWorkspaceId: 'workspace-B',
      invocationId: 'luth-once-1', input: { a: 2, b: 3 },
    };
    return { boundary, request, state };
  }

  it('releases an authorized output after one-use admission without replaying the bearer', async () => {
    const { boundary, request, state } = setup();
    await expect(boundary.invoke('single-use-luth-proof', request, 'http'))
      .resolves.toMatchObject({ output: { result: 5 }, invocationId: 'luth-once-1' });
    expect(state.outputs).toBe(1);
    // A second invocation using the same one-use bearer must be rejected.
    await expect(boundary.invoke('single-use-luth-proof', { ...request, invocationId: 'luth-once-2' }, 'http'))
      .rejects.toMatchObject({ code: 'AUTH_INVALID' });
  });

  it('rejects in-flight output after a grant is revoked despite consumed admission proof', async () => {
    const { boundary, request, state } = setup({ revokeDuringOperation: true });
    await expect(boundary.invoke('single-use-luth-proof', request, 'http'))
      .rejects.toMatchObject({ code: 'ACCESS_REVOKED' });
    expect(state.outputs).toBe(1);
    expect(state.grant).toBe(false);
  });
});
