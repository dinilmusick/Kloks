import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createTieredFacadeDispatcher, TieredFacadeDenied,
  type CrossAppRequest, type TrustedFacadeTarget,
} from './tieredFacadeDispatcher.js';

const request: CrossAppRequest = {
  appId: 'app-b', targetWorkspaceId: 'workspace-b', operationId: 'Math.sum',
  version: 'v1', invocationId: 'call-1', input: { a: 2, b: 3 },
};
const target = (tier: 'process' | 'peer' | 'cloud', deploymentId: string, weight = 1): TrustedFacadeTarget => ({
  tier, appId: 'app-b', workspaceId: 'workspace-b', operationId: 'Math.sum',
  version: 'v1', deploymentId, leaseExpiresAt: Date.now() + 30000, verified: true,
  ...(tier === 'cloud' ? { weight } : {}),
});

function fixture(runtime: 'composed' | 'desktop' | 'cloud' = 'composed') {
  const principal = {
    userId: 'user-one', sessionId: 'session-one', sourceAppId: 'app-a',
    sourceWorkspaceId: 'workspace-a', deadlineAt: Date.now() + 30000,
    expiresAt: Date.now() + 30000,
  };
  const state = {
    authenticated: true, live: true, grant: true, lease: true, effect: 'read' as 'read' | 'write',
    operationVersion: 'v1', outputGrant: true, retryApproved: false,
    candidates: {
      process: [target('process', 'process-1')],
      peer: [target('peer', 'peer-1')],
      cloud: [target('cloud', 'cloud-low', 2), target('cloud', 'cloud-high', 99)],
    },
    results: {} as Record<string, 'down' | 'forbidden' | 'guarded401' | 'guarded403' | 'hang' | 'network'>,
    calls: [] as Array<{ tier: string; id: string; invocationId: string; bearer: string; input: unknown }>,
    issues: [] as string[],
    phases: [] as string[],
    onInvoke: undefined as undefined | (() => void),
  };
  const dispatch = createTieredFacadeDispatcher({
    runtime,
    attemptTimeoutMs: 35,
    maxDurationMs: 250,
    authenticate: async () => state.authenticated ? { ...principal } : null,
    revalidateCaller: async () => state.live ? { ...principal } : null,
    resolveOperation: async () => ({
      appId: 'app-b', workspaceId: 'workspace-b', id: 'Math.sum',
      version: state.operationVersion, effect: state.effect,
    }),
    discover: async tier => state.candidates[tier],
    validateTarget: async () => state.lease,
    authorize: async (_caller, _operation, _target, phase) => {
      state.phases.push(phase);
      return state.grant && (phase !== 'output' || state.outputGrant);
    },
    mintAudienceProof: async (_caller, candidate) => {
      const proof = 'fresh-' + candidate.deploymentId + '-' + (state.issues.length + 1);
      state.issues.push(proof);
      return proof;
    },
    invokeTarget: async (candidate, req, bearer) => {
      state.calls.push({ tier: candidate.tier, id: candidate.deploymentId, invocationId: req.invocationId, bearer, input: req.input });
      state.onInvoke?.();
      const mode = state.results[candidate.deploymentId];
      if (mode === 'down') throw new TieredFacadeDenied('TARGET_UNAVAILABLE', 503);
      if (mode === 'forbidden') throw new TieredFacadeDenied('ACCESS_DENIED', 403);
      if (mode === 'guarded401') throw Object.assign(new Error('distinct target guard class'), { status: 401, code: 'AUTH_INVALID' });
      if (mode === 'guarded403') throw Object.assign(new Error('distinct target guard class'), { status: 403, code: 'ACCESS_DENIED' });
      if (mode === 'network') throw new Error('internal network failure with secret data');
      if (mode === 'hang') return new Promise<never>(() => undefined);
      return { invocationId: req.invocationId, output: { total: 5 } };
    },
    mayRetryUncertainWrite: async () => state.retryApproved,
  });
  return { dispatch, state, principal };
}
async function expectDenied(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (e: any) => e instanceof TieredFacadeDenied && e.code === code);
}

describe('tiered BackendFacade dispatcher with independent trusted adapters', () => {
  it('prefers same-process invocation without selecting a network candidate', async () => {
    const { dispatch, state } = fixture();
    const output = await dispatch.invoke(request);
    assert.equal(output.tier, 'process');
    assert.deepEqual(output.output, { total: 5 });
    assert.deepEqual(state.calls.map(c => c.id), ['process-1']);
    assert.deepEqual(state.phases, ['invoke', 'invoke', 'output']);
  });
  it('desktop uses authenticated peer then cloud, never process', async () => {
    const { dispatch, state } = fixture('desktop');
    state.results['peer-1'] = 'down';
    const output = await dispatch.invoke(request);
    assert.equal(output.tier, 'cloud');
    assert.deepEqual(state.calls.map(c => c.id), ['peer-1', 'cloud-high']);
  });
  it('cloud uses existing precomputed DEPM weights and falls back after timeout', async () => {
    const { dispatch, state } = fixture('cloud');
    state.results['cloud-high'] = 'hang';
    const result = await dispatch.invoke(request);
    assert.equal(result.deploymentId, 'cloud-low');
    assert.deepEqual(state.calls.map(c => c.id), ['cloud-high', 'cloud-low']);
    assert.equal(state.issues.length, 2);
    assert.notEqual(state.calls[0].bearer, state.calls[1].bearer);
  });
  it('never downgrades after 403, even when an alternative is available', async () => {
    const { dispatch, state } = fixture('desktop');
    state.results['peer-1'] = 'forbidden';
    await expectDenied(() => dispatch.invoke(request), 'ACCESS_DENIED');
    assert.deepEqual(state.calls.map(c => c.id), ['peer-1']);
  });
  it('never downgrades a target-side 401/403 from another guarded error class', async () => {
    const { dispatch, state } = fixture('desktop');
    state.results['peer-1'] = 'guarded403';
    await expectDenied(() => dispatch.invoke(request), 'ACCESS_DENIED');
    assert.deepEqual(state.calls.map(c => c.id), ['peer-1']);
    state.calls.length = 0;
    state.results['peer-1'] = 'guarded401';
    await expectDenied(() => dispatch.invoke(request), 'AUTH_INVALID');
    assert.deepEqual(state.calls.map(c => c.id), ['peer-1']);
  });
  it('rejects missing identity and cross-workspace grants', async () => {
    const { dispatch, state } = fixture();
    state.authenticated = false;
    await expectDenied(() => dispatch.invoke(request), 'AUTH_INVALID');
    state.authenticated = true;
    state.grant = false;
    await expectDenied(() => dispatch.invoke(request), 'ACCESS_DENIED');
    assert.equal(state.calls.length, 0);
  });
  it('never treats a forged or expired target as a discovery hint', async () => {
    const { dispatch, state } = fixture('cloud');
    state.candidates.cloud = [{ ...target('cloud', 'cloud-forged'), appId: 'app-other' }];
    await expectDenied(() => dispatch.invoke(request), 'MALFORMED_TARGET');
    assert.equal(state.calls.length, 0);
  });
  it('blocks a revoked lease before sending and never exposes an output on revocation', async () => {
    const { dispatch, state } = fixture();
    state.lease = false;
    await expectDenied(() => dispatch.invoke(request), 'TARGET_UNAVAILABLE');
    assert.equal(state.calls.length, 0);
    state.lease = true;
    state.onInvoke = () => { state.outputGrant = false; };
    await expectDenied(() => dispatch.invoke(request), 'ACCESS_REVOKED');
    assert.equal(state.calls.length, 1);
  });
  it('fails closed when identity is revoked midflight and does not retry to cloud', async () => {
    const { dispatch, state } = fixture();
    state.onInvoke = () => { state.live = false; };
    await expectDenied(() => dispatch.invoke(request), 'AUTH_INVALID');
    assert.equal(state.calls.length, 1);
  });
  it('does not replay an uncertain write to a second deployment without durable proof', async () => {
    const { dispatch, state } = fixture('cloud');
    state.effect = 'write';
    state.results['cloud-high'] = 'network';
    await expectDenied(() => dispatch.invoke(request), 'UNCERTAIN_WRITE_NOT_RETRIED');
    assert.deepEqual(state.calls.map(c => c.id), ['cloud-high']);
  });
  it('retries a write only with host-verified global idempotency and identical operation ID', async () => {
    const { dispatch, state } = fixture('cloud');
    state.effect = 'write';
    state.retryApproved = true;
    state.results['cloud-high'] = 'network';
    const output = await dispatch.invoke(request);
    assert.equal(output.deploymentId, 'cloud-low');
    assert.deepEqual(state.calls.map(c => c.invocationId), ['call-1', 'call-1']);
    assert.notEqual(state.calls[0].bearer, state.calls[1].bearer);
  });
  it('rejects changed current publication after execution', async () => {
    const { dispatch, state } = fixture('cloud');
    state.onInvoke = () => { state.operationVersion = 'v2'; };
    await expectDenied(() => dispatch.invoke(request), 'OPERATION_REVOKED');
  });
  it('rejects caller-supplied claims and malformed nested JSON', async () => {
    const { dispatch, state } = fixture();
    await expectDenied(() => dispatch.invoke({ ...request, userId: 'forged' } as any), 'MALFORMED_HANDLE');
    await expectDenied(() => dispatch.invoke({ ...request, input: { score: BigInt(1) } }), 'MALFORMED_INPUT');
    const cycle: any = {}; cycle.self = cycle;
    await expectDenied(() => dispatch.invoke({ ...request, input: cycle }), 'MALFORMED_INPUT');
    assert.equal(state.calls.length, 0);
  });
  it('snapshots input before awaiting authority and cannot dispatch mutated payload', async () => {
    const { dispatch, state } = fixture();
    const value = { a: 1 };
    const running = dispatch.invoke({ ...request, input: value });
    value.a = 999;
    await running;
    assert.deepEqual(state.calls[0].input, { a: 1 });
  });
  it('fails closed on unknown authority exception without leaking host text', async () => {
    const dispatch = createTieredFacadeDispatcher({
      runtime: 'cloud',
      authenticate: async () => { throw new Error('secret database password'); },
      resolveOperation: async () => null, discover: async () => [],
      validateTarget: async () => false, authorize: async () => false,
      mintAudienceProof: async () => '', invokeTarget: async () => ({ invocationId: 'x', output: null }),
      revalidateCaller: async () => null,
    });
    await expectDenied(() => dispatch.invoke(request), 'AUTHORITY_UNAVAILABLE');
  });
  it('honors cancellation before network delivery', async () => {
    const { dispatch, state } = fixture();
    const cancelled = new AbortController(); cancelled.abort();
    await expectDenied(() => dispatch.invoke(request, cancelled.signal), 'CANCELLED');
    assert.equal(state.calls.length, 0);
  });
  it('requires all eight authority adapters and a valid runtime', () => {
    assert.throws(() => createTieredFacadeDispatcher({ runtime: 'cloud' } as any), /Missing mandatory authority/);
  });
});
