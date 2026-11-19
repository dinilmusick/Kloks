import { describe, expect, it } from 'vitest';
import {
  createFacadeInvocationBoundary,
  type VerifiedFacadeCaller,
  type FacadeInvocation,
  type FacadeOperationDescriptor,
} from './facadeInvocation.js';

describe('Kloks Adversarial Stress Test: Single-Use Token Replay & Concurrency', () => {
  function setupBoundary(opts: { revokeSession?: boolean; revokeGrant?: boolean } = {}) {
    const now = Date.now();
    const caller: VerifiedFacadeCaller = {
      principalId: 'user-adversary',
      sourceAppId: 'app-source',
      sourceWorkspaceId: 'ws-src',
      audience: 'app-target',
      sessionId: 'session-adv',
      invoker: { kind: 'app-agent', id: 'agent-adv' },
      chain: ['app-source'],
      depth: 1,
      maxDepth: 4,
      remainingCalls: 10,
      deadlineAt: now + 30_000,
      expiresAt: now + 30_000,
    };

    const op: FacadeOperationDescriptor = {
      id: 'compute.heavy',
      version: 'v1',
      name: 'Heavy Computation',
      kind: 'static',
      targetWorkspaceId: 'ws-target',
      serviceId: 'compute',
      serviceOperation: 'run',
    };

    let admissionTokensConsumed = 0;
    let executionCount = 0;
    let outputRevalidations = 0;
    let sessionActive = !opts.revokeSession;
    let grantActive = !opts.revokeGrant;

    const boundary = createFacadeInvocationBoundary({
      targetAppId: 'app-target',
      facade: {
        services: {
          compute: {
            execute: async (_name: string, input: unknown) => {
              executionCount++;
              // Delay slightly to increase concurrency race probability
              await new Promise(r => setTimeout(r, 20));
              return { success: true, payload: (input as any)?.data };
            },
          },
        },
        orchestrations: {},
      },
      verifyLuthCredential: async (credential, audience) => {
        // Enforce strict atomic single-use check
        if (credential !== 'valid-one-time-proof' || audience !== 'app-target') {
          return null;
        }
        if (admissionTokensConsumed > 0) {
          // Token is burned! Must return null (translates to AUTH_INVALID / 401)
          return null;
        }
        admissionTokensConsumed++;
        return { ...caller, invoker: { ...caller.invoker }, chain: [...caller.chain] };
      },
      revalidateLuthCaller: async (admitted, audience) => {
        outputRevalidations++;
        // Output-time check: does NOT re-consume token. Checks live session and audience
        return sessionActive && audience === 'app-target' ? admitted : null;
      },
      listCurrentOperations: async () => [op],
      deploymentEligible: async () => true,
      authorize: async () => grantActive,
      consumeInvocation: async () => true,
      invokePublishedWorkflow: async () => { throw new Error('Not used'); },
      delegateCredential: async () => '',
    });

    const request: FacadeInvocation = {
      operationId: 'compute.heavy',
      version: 'v1',
      targetWorkspaceId: 'ws-target',
      invocationId: 'inv-adv-1',
      input: { data: 'critical-payload' },
    };

    return {
      boundary,
      request,
      getStats: () => ({ admissionTokensConsumed, executionCount, outputRevalidations }),
      setSessionActive: (v: boolean) => { sessionActive = v; },
      setGrantActive: (v: boolean) => { grantActive = v; },
    };
  }

  it('rejects multiple sequential replay attempts after single-use token burn', async () => {
    const { boundary, request, getStats } = setupBoundary();

    // 1st invocation: succeeds
    const res1 = await boundary.invoke('valid-one-time-proof', request, 'http');
    expect(res1.output).toEqual({ success: true, payload: 'critical-payload' });
    expect(getStats().admissionTokensConsumed).toBe(1);
    expect(getStats().executionCount).toBe(1);
    expect(getStats().outputRevalidations).toBe(1);

    // 2nd invocation (replay 1): rejects with AUTH_INVALID
    await expect(
      boundary.invoke('valid-one-time-proof', { ...request, invocationId: 'inv-adv-2' }, 'http')
    ).rejects.toMatchObject({ code: 'AUTH_INVALID' });

    // 3rd invocation (replay 2): rejects with AUTH_INVALID
    await expect(
      boundary.invoke('valid-one-time-proof', { ...request, invocationId: 'inv-adv-3' }, 'http')
    ).rejects.toMatchObject({ code: 'AUTH_INVALID' });

    // 4th invocation (replay 3): rejects with AUTH_INVALID
    await expect(
      boundary.invoke('valid-one-time-proof', { ...request, invocationId: 'inv-adv-4' }, 'http')
    ).rejects.toMatchObject({ code: 'AUTH_INVALID' });

    // Execution count must remain 1 — replayed attempts must not execute the underlying service
    expect(getStats().executionCount).toBe(1);
  });

  it('handles 20 concurrent invocations with the same token: exactly 1 succeeds, 19 fail', async () => {
    const { boundary, request, getStats } = setupBoundary();

    const promises = Array.from({ length: 20 }, (_, idx) =>
      boundary
        .invoke('valid-one-time-proof', { ...request, invocationId: `inv-conc-${idx}` }, 'http')
        .then(res => ({ success: true, res }))
        .catch(err => ({ success: false, err }))
    );

    const outcomes = await Promise.all(promises);
    const successes = outcomes.filter(o => o.success);
    const failures = outcomes.filter(o => !o.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);

    for (const f of failures) {
      expect((f as any).err).toMatchObject({ code: 'AUTH_INVALID' });
    }

    expect(getStats().executionCount).toBe(1);
  });

  it('aborts at output-time if session revoked mid-flight without token replay', async () => {
    const { boundary, request, getStats, setSessionActive } = setupBoundary();

    // Start invocation and revoke session immediately during execution
    const promise = boundary.invoke('valid-one-time-proof', request, 'http');
    setSessionActive(false);

    await expect(promise).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(getStats().admissionTokensConsumed).toBe(1);
    expect(getStats().outputRevalidations).toBe(1);
  });
});
