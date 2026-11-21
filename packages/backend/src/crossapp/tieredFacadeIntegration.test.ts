import { describe, expect, it } from 'vitest';
import { createFacadeRemoteClient } from '../connectivity/facadeRemoteClient.js';
import { createTieredFacadeDispatcher, type CrossAppRequest, type TrustedFacadeTarget } from './tieredFacadeDispatcher.js';

const deploymentA = '11111111-1111-4111-8111-111111111111';
const deploymentB = '22222222-2222-4222-8222-222222222222';
const baseRequest: CrossAppRequest = {
  appId: 'app-b', targetWorkspaceId: 'workspace-b', operationId: 'Math.sum',
  version: 'v1', invocationId: 'crossapp-call-1', input: { a: 2, b: 3 },
};
const caller = {
  userId: 'user-one', sessionId: 'session-one', sourceAppId: 'app-a',
  sourceWorkspaceId: 'workspace-a', expiresAt: Date.now() + 60000, deadlineAt: Date.now() + 60000,
};
const target = (id: string, weight: number): TrustedFacadeTarget => ({
  tier: 'cloud', appId: 'app-b', workspaceId: 'workspace-b',
  operationId: 'Math.sum', version: 'v1', deploymentId: id,
  leaseExpiresAt: Date.now() + 60000, verified: true, weight,
});

function wiredFixture(forbidden = false) {
  const targets = [target(deploymentB, 5), target(deploymentA, 90)];
  const sent: Array<{ deploymentId: string; proof: string; invocationId: string }> = [];
  let issued = 0;
  const dispatcher = createTieredFacadeDispatcher({
    runtime: 'cloud', maxDurationMs: 5000, attemptTimeoutMs: 1500,
    authenticate: async () => ({ ...caller }),
    revalidateCaller: async () => ({ ...caller }),
    resolveOperation: async () => ({
      appId: 'app-b', workspaceId: 'workspace-b', id: 'Math.sum',
      version: 'v1', effect: 'read',
    }),
    discover: async () => targets,
    validateTarget: async candidate => targets.some(t => t.deploymentId === candidate.deploymentId),
    authorize: async () => true,
    mintAudienceProof: async (_principal, candidate) => {
      issued += 1;
      return 'luth.proof.' + candidate.deploymentId.replace(/-/g, '');
    },
    invokeTarget: async (candidate, request, proof, signal) => {
      const deployment = {
        appId: candidate.appId, workspaceId: candidate.workspaceId,
        deploymentId: candidate.deploymentId, environment: 'production',
        origin: 'https://app-b.example.com', leaseExpiresAt: candidate.leaseExpiresAt,
        verified: true as const,
      };
      // The client receives exactly the dispatcher-issued one-use proof.
      // It does not invoke a second Luth mint or accept a caller-supplied URL.
      const remote = createFacadeRemoteClient({
        environment: 'production', maxRequestMs: 1400,
        resolveDeployment: async (appId, workspaceId, operation, _signal, pinnedId) =>
          appId === candidate.appId && workspaceId === candidate.workspaceId &&
          operation?.id === request.operationId && operation.version === request.version &&
          pinnedId === candidate.deploymentId ? { ...deployment } : null,
        approveOrigin: async (origin, resolved) =>
          origin === deployment.origin && resolved.deploymentId === candidate.deploymentId,
        getAudienceBearer: async (resolved, operation) => {
          expect(resolved.deploymentId).toBe(candidate.deploymentId);
          expect(operation?.id).toBe(request.operationId);
          return proof;
        },
        fetch: async (url, init) => {
          expect(String(url)).toBe(deployment.origin + '/api/crossapp/invoke');
          expect(init?.redirect).toBe('error');
          expect(init?.credentials).toBe('omit');
          const token = new Headers(init?.headers).get('Authorization');
          expect(token).toBe('Bearer ' + proof);
          const envelope = JSON.parse(String(init?.body));
          expect(Object.keys(envelope).sort()).toEqual(['input','invocationId','operationId','targetWorkspaceId','version']);
          expect(envelope.input).toEqual({ a: 2, b: 3 });
          sent.push({ deploymentId: candidate.deploymentId, proof, invocationId: envelope.invocationId });
          return new Response(JSON.stringify(forbidden
            ? { error: 'ACCESS_DENIED' }
            : { output: { total: 5 }, invocationId: envelope.invocationId }), {
            status: forbidden ? 403 : 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      return remote.invoke(candidate.appId, {
        operationId: request.operationId, version: request.version,
        targetWorkspaceId: request.targetWorkspaceId,
        invocationId: request.invocationId, input: request.input,
      }, signal, Math.min(caller.deadlineAt, Date.now() + 1400), candidate.deploymentId);
    },
  });
  return { dispatcher, sent, getIssued: () => issued };
}
describe('tiered dispatcher to verified HTTPS BackendFacade client', () => {
  it('selects the highest precomputed cloud weight, pins the exact instance and forwards one Luth proof', async () => {
    const { dispatcher, sent, getIssued } = wiredFixture();
    const result = await dispatcher.invoke(baseRequest);
    expect(result).toEqual({
      output: { total: 5 }, invocationId: baseRequest.invocationId,
      tier: 'cloud', deploymentId: deploymentA,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].deploymentId).toBe(deploymentA);
    expect(sent[0].invocationId).toBe(baseRequest.invocationId);
    expect(getIssued()).toBe(1);
  });
  it('never retries an authenticated remote 403 against a lower-weight cloud instance', async () => {
    const { dispatcher, sent, getIssued } = wiredFixture(true);
    await expect(dispatcher.invoke(baseRequest))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
    expect(sent).toHaveLength(1);
    expect(sent[0].deploymentId).toBe(deploymentA);
    expect(getIssued()).toBe(1);
  });
});
