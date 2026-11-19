import { describe, expect, it, vi } from 'vitest';
import {
  createFacadeInvocationBoundary, type VerifiedFacadeCaller,
} from './facadeInvocation.js';
import { createFacadeRemoteClient } from './facadeRemoteClient.js';
import {
  createFodWorkflowDeploymentResolver,
  type FodCurrentPublishedReference,
  type FodWorkflowDeploymentAuthorityOptions,
} from './facadeFodResolver.js';

const appId = 'app-b';
const workspace = 'workspace-B';
const deploymentId = '55555555-5555-4555-8555-555555555555';
const otherDeployment = '66666666-6666-4666-8666-666666666666';
const operation = { id: 'workflow.report', version: 'v4', kind: 'workflow' as const };
const invoke = (id: string) => ({
  operationId: operation.id, version: operation.version,
  targetWorkspaceId: workspace, invocationId: id, input: { report: 7 },
});

function fixture() {
  const state = {
    ownerApproved: true, published: true, sessionLive: true,
    leaseLive: true, hostId: deploymentId, currentVersion: 'v4',
    slow: false, revocations: 0, dispatches: 0, minted: 0, staticChecks: 0,
    selections: [] as Array<string | undefined>,
  };
  const now = Date.now();
  const caller: VerifiedFacadeCaller = {
    principalId: 'owner-A', sourceAppId: 'app-a', sourceWorkspaceId: 'workspace-A',
    audience: appId, sessionId: 'session-A',
    invoker: { kind: 'workflow-agent', id: 'workflow-agent-A' },
    chain: ['app-a'], depth: 1, maxDepth: 5, remainingCalls: 5,
    deadlineAt: now + 20_000, expiresAt: now + 20_000,
  };
  const resolveDeployment = vi.fn(async () => {
    state.staticChecks++;
    return null;
  });
  const target = createFacadeInvocationBoundary({
    targetAppId: appId,
    facade: { services: {}, orchestrations: {} },
    verifyLuthCredential: async (bearer, audience) =>
      bearer === 'luth.one.use' && audience === appId && state.sessionLive
        ? { ...caller, chain: [...caller.chain], invoker: { ...caller.invoker } } : null,
    revalidateLuthCaller: async admitted =>
      state.sessionLive ? { ...admitted, chain: [...admitted.chain], invoker: { ...admitted.invoker } } : null,
    listCurrentOperations: async () => state.published ? [{
      id: operation.id, version: state.currentVersion,
      name: 'Owner published report', kind: 'workflow' as const,
      targetWorkspaceId: workspace, workflowId: 'flow-secret-123',
    }] : [],
    authorize: async ({ caller: verified }) =>
      state.ownerApproved && verified.principalId === 'owner-A' &&
      verified.sourceWorkspaceId === 'workspace-A',
    deploymentEligible: async () => state.leaseLive,
    consumeInvocation: async () => true,
    invokePublishedWorkflow: async (ref, input) => {
      state.dispatches++;
      if (state.slow) await new Promise(resolve => setTimeout(resolve, 50));
      return { flowId: ref.workflowId, version: ref.version, input };
    },
    delegateCredential: async () => { throw new Error('nested delegation disabled'); },
  });
  const options: FodWorkflowDeploymentAuthorityOptions = {
    environment: 'production',
    authorizeCurrentWorkflow: async (targetApp, targetWorkspace, selector) =>
      state.ownerApproved && state.published && state.currentVersion === selector.version &&
      targetApp === appId && targetWorkspace === workspace &&
      selector.id === operation.id && selector.kind === 'workflow'
        ? {
          appId, targetWorkspaceId: workspace, operationId: selector.id,
          workflowId: 'flow-secret-123', version: selector.version,
        } : null,
    locateVerifiedWorkflowHost: async (_reference: Readonly<FodCurrentPublishedReference>, _env, _signal, pinned) => {
      state.selections.push(pinned);
      return { appId, deploymentId: state.hostId, origin: 'https://app-b.example.com' };
    },
    inspectAttestedLease: async () => state.leaseLive ? {
      appId, workspaceId: workspace, deploymentId: state.hostId,
      environment: 'production', origin: 'https://app-b.example.com',
      verified: true, leaseExpiresAt: Date.now() + 20_000,
    } : null,
  };
  const resolveWorkflowDeployment = createFodWorkflowDeploymentResolver(options);
  const getAudienceBearer = vi.fn(async (_deployment, selector) => {
    expect(selector.kind).toBe('workflow');
    state.minted++;
    return 'luth.one.use';
  });
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    target.http(new Request(url, init)));
  const remote = createFacadeRemoteClient({
    environment: 'production', resolveDeployment, resolveWorkflowDeployment,
    approveOrigin: async origin => origin === 'https://app-b.example.com',
    getAudienceBearer, fetch: fetcher as typeof fetch,
  });
  return { state, options, remote, target, fetcher, getAudienceBearer, resolveDeployment };
}

describe('FOD owner-granted workflow dispatch over verified Skipo host', () => {
  it('executes an exact owner workflow revision without relying on a static registry descriptor', async () => {
    const { remote, state, resolveDeployment, fetcher } = fixture();
    await expect(remote.invokeWorkflow(appId, invoke('fod-1'))).resolves.toEqual({
      output: {
        flowId: 'flow-secret-123', version: 'v4', input: { report: 7 },
      }, invocationId: 'fod-1',
    });
    expect(resolveDeployment).not.toHaveBeenCalled();
    expect(state.selections).toEqual([undefined, deploymentId, deploymentId]);
    expect(state).toMatchObject({ minted: 1, dispatches: 1, staticChecks: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('denies missing FOD authority without attempting static capability fallback or minting a bearer', async () => {
    const { state, resolveDeployment, getAudienceBearer } = fixture();
    const remote = createFacadeRemoteClient({
      environment: 'production', resolveDeployment,
      approveOrigin: async () => true, getAudienceBearer,
    });
    await expect(remote.invokeWorkflow(appId, invoke('fod-no-authority')))
      .rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_REQUIRED' });
    expect(resolveDeployment).not.toHaveBeenCalled();
    expect(getAudienceBearer).not.toHaveBeenCalled();
    expect(state.dispatches).toBe(0);
  });

  it('refuses revoked FOD grants and withdrawn immutable versions before dispatch', async () => {
    const { remote, state, fetcher } = fixture();
    state.ownerApproved = false;
    await expect(remote.invokeWorkflow(appId, invoke('fod-revoked')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.ownerApproved = true;
    state.currentVersion = 'v5';
    await expect(remote.invokeWorkflow(appId, invoke('fod-retired')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.currentVersion = 'v4';
    state.published = false;
    await expect(remote.invokeWorkflow(appId, invoke('fod-withdrawn')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(state.dispatches).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a sibling verified deployment before dispatch despite a valid FOD owner grant', async () => {
    const { remote, state, fetcher } = fixture();
    let checks = 0;
    const original = state.selections.push.bind(state.selections);
    state.selections.push = (...items) => {
      checks++;
      if (checks === 2) state.hostId = otherDeployment;
      return original(...items);
    };
    await expect(remote.invokeWorkflow(appId, invoke('fod-other-host')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_REVOKED' });
    expect(state.dispatches).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('suppresses workflow results when owning publication or session is withdrawn during execution', async () => {
    const { remote, state, fetcher } = fixture();
    state.slow = true;
    const running = remote.invokeWorkflow(appId, invoke('fod-midflight-revoke'));
    await new Promise(resolve => setTimeout(resolve, 25));
    state.ownerApproved = false;
    await expect(running).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    expect(state.dispatches).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed standalone FOD selector and unverified host leases', async () => {
    const { remote, state } = fixture();
    state.leaseLive = false;
    await expect(remote.invokeWorkflow(appId, invoke('fod-no-lease')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.leaseLive = true;
    state.hostId = 'not-a-uuid';
    await expect(remote.invokeWorkflow(appId, invoke('fod-invalid-id')))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(state.dispatches).toBe(0);
  });
});
