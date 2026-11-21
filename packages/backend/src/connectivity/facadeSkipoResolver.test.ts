import { describe, expect, it, vi } from 'vitest';
import { createFacadeInvocationBoundary, type VerifiedFacadeCaller } from './facadeInvocation.js';
import { createFacadeRemoteClient } from './facadeRemoteClient.js';
import {
  createSkipoFacadeDeploymentResolver,
  type SkipoResolvedCapability,
  type SkipoTrustedLease,
  type SkipoVerifiedDiscovery,
} from './facadeSkipoResolver.js';

/** Registry/host integration shape follows Skipo PR #208 exactly. */
const deploymentId = '11111111-1111-4111-8111-111111111111';
const registryRow: SkipoResolvedCapability = {
  deploymentId, url: 'https://app-b.example.com', revision: 2,
  descriptor: {
    id: 'math.add', description: 'Adds two numbers', inputSchema: {}, outputSchema: {},
    invocation: { serviceId: 'math', operationId: 'add' },
  },
};
function fixture() {
  const state = {
    authorized: true, current: true, proof: true, lease: true, targetLive: true,
    origin: 'https://app-b.example.com', stage: 'production', wrongWorkspace: false,
    workspace: 'workspace-B', resolved: 0, listed: 0, admitted: 0, sent: 0,
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    state.sent++;
    expect(String(input).startsWith('https://app-b.example.com/api/crossapp/')).toBe(true);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer delegated.one.use');
    return target.http(new Request(input, init));
  });
  const discovery: SkipoVerifiedDiscovery = {
    list: async (req, appId, environment) => {
      state.listed++;
      expect(req.headers.get('authorization')).toBe('Bearer verified-source-session');
      return state.authorized && appId === 'app-b' && environment === 'production' &&
        state.current ? [registryRow] : [];
    },
    resolve: async () => registryRow,
    revalidate: async (req, selector) => {
      state.resolved++;
      expect(req.headers.get('authorization')).toBe('Bearer verified-source-session');
      return state.authorized && state.current && selector.appId === 'app-b' &&
        selector.environment === 'production' && selector.capabilityId === 'math.add' &&
        selector.revision === 2 ? registryRow : null;
    },
  };
  const lease = async (_appId: string, _workspaceId: string,
    found: Readonly<SkipoResolvedCapability>): Promise<SkipoTrustedLease> => ({
    appId: 'app-b', deploymentId: found.deploymentId,
    workspaceId: state.wrongWorkspace ? 'workspace-other' : state.workspace,
    environment: state.stage as 'production', origin: state.origin,
    leaseExpiresAt: state.lease ? Date.now() + 30_000 : Date.now() - 1,
    verified: state.proof,
  });
  const resolveDeployment = createSkipoFacadeDeploymentResolver({
    environment: 'production',
    discovery,
    getAuthenticatedRequest: async () => new Request('https://app-a.example.com/verified-discovery', {
      headers: { Authorization: 'Bearer verified-source-session' },
    }),
    inspectAttestedLease: lease,
  });
  const sourceCaller: VerifiedFacadeCaller = {
    principalId: 'user-A', sourceAppId: 'app-a', sourceWorkspaceId: 'workspace-A',
    audience: 'app-b', sessionId: 'session-A',
    invoker: { kind: 'app-agent', id: 'agent-A' }, chain: ['app-a'],
    depth: 1, maxDepth: 4, remainingCalls: 8,
    deadlineAt: Date.now() + 25_000, expiresAt: Date.now() + 25_000,
  };
  const used = new Set<string>();
  const target = createFacadeInvocationBoundary({
    targetAppId: 'app-b',
    facade: {
      services: { math: { execute: async (_name: string, input: unknown) => {
        const p = input as { a: number; b: number };
        return { result: p.a + p.b };
      } } },
      orchestrations: {},
    },
    verifyLuthCredential: async (bearer, audience) => {
      state.admitted++;
      return bearer === 'delegated.one.use' && audience === 'app-b' && state.targetLive
        ? { ...sourceCaller } : null;
    },
    revalidateLuthCaller: async admitted => state.targetLive ? { ...admitted } : null,
    listCurrentOperations: async () => [{
      id: 'math.add', version: '2', name: 'Addition', kind: 'static',
      targetWorkspaceId: 'workspace-B', serviceId: 'math', serviceOperation: 'add',
    }],
    authorize: async () => state.authorized,
    deploymentEligible: async () => state.proof && state.lease,
    consumeInvocation: async (_caller, id) => {
      if (used.has(id)) return false;
      used.add(id);
      return true;
    },
    invokePublishedWorkflow: async () => { throw new Error('Workflow unavailable'); },
    delegateCredential: async () => { throw new Error('Unexpected target delegation'); },
  });
  const client = createFacadeRemoteClient({
    environment: 'production', resolveDeployment,
    approveOrigin: async origin => origin === 'https://app-b.example.com',
    getAudienceBearer: async () => 'delegated.one.use',
    fetch: fetcher as typeof fetch, maxRequestMs: 1500,
  });
  return { state, client, discovery, resolveDeployment, fetcher };
}

describe('Skipo #208 verified capability resolution into Kloks remote HTTP boundary', () => {
  it('discovers authorized descriptors and invokes the exact pinned revision through Luth guard', async () => {
    const { client, state } = fixture();
    await expect(client.discover('app-b', 'workspace-B')).resolves.toEqual([
      { id: 'math.add', version: '2', name: 'Addition', kind: 'static', targetWorkspaceId: 'workspace-B' },
    ]);
    await expect(client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'skipo-1', input: { a: 5, b: 9 },
    })).resolves.toEqual({ output: { result: 14 }, invocationId: 'skipo-1' });
    expect(state.listed).toBeGreaterThan(0);
    expect(state.resolved).toBeGreaterThan(0);
    expect(state.admitted).toBe(2);
  });

  it('fails closed before network on wrong principal grant, workspace or unverified lease', async () => {
    const { state, client, fetcher } = fixture();
    state.authorized = false;
    await expect(client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'skipo-denied-1', input: {},
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.authorized = true;
    state.wrongWorkspace = true;
    await expect(client.discover('app-b', 'workspace-B'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.wrongWorkspace = false;
    state.proof = false;
    await expect(client.discover('app-b', 'workspace-B'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses stale or ambiguous revisions instead of selecting a nearby verified snapshot', async () => {
    const { client, fetcher } = fixture();
    for (const version of ['v2', '02', '1', '2e0']) {
      await expect(client.invoke('app-b', {
        operationId: 'math.add', version, targetWorkspaceId: 'workspace-B',
        invocationId: 'revision-' + version, input: {},
      })).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a registrar-origin switch and stale lease before contacting target', async () => {
    const { state, client, fetcher } = fixture();
    state.origin = 'https://attacker.example.com';
    await expect(client.discover('app-b', 'workspace-B'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    state.origin = 'https://app-b.example.com';
    state.lease = false;
    await expect(client.discover('app-b', 'workspace-B'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('re-resolves the current Skipo revision on each invocation, not legacy tickets', async () => {
    const { state, client, fetcher } = fixture();
    await client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'fresh-1', input: { a: 2, b: 1 },
    });
    state.current = false;
    await expect(client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'fresh-2', input: { a: 2, b: 2 },
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.resolved).toBeGreaterThanOrEqual(4);
  });

  it('pins the original attested deployment ID on both pre-send and output revalidation', async () => {
    const { client, discovery, fetcher } = fixture();
    const pinned: Array<string | undefined> = [];
    const original = discovery.revalidate;
    discovery.revalidate = async (req, selector) => {
      pinned.push(selector.deploymentId);
      return original(req, selector);
    };
    const output = await client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'instance-pinned-1', input: { a: 5, b: 3 },
    });
    expect(output).toEqual({ output: { result: 8 }, invocationId: 'instance-pinned-1' });
    expect(pinned).toEqual([undefined, deploymentId, deploymentId]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects another verified instance with the same app, operation and revision before dispatch', async () => {
    const { client, discovery, fetcher } = fixture();
    let calls = 0;
    const impostor = '22222222-2222-4222-8222-222222222222';
    discovery.revalidate = async () => ++calls === 1
      ? registryRow : { ...registryRow, deploymentId: impostor };
    await expect(client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'wrong-instance-before-send', input: { a: 1, b: 1 },
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_REVOKED' });
    expect(calls).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('suppresses already-executed output when the registry switches to a different instance', async () => {
    const { client, discovery, fetcher } = fixture();
    let calls = 0;
    const impostor = '33333333-3333-4333-8333-333333333333';
    discovery.revalidate = async () => ++calls === 3
      ? { ...registryRow, deploymentId: impostor } : registryRow;
    await expect(client.invoke('app-b', {
      operationId: 'math.add', version: '2', targetWorkspaceId: 'workspace-B',
      invocationId: 'wrong-instance-after-output', input: { a: 1, b: 1 },
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_REVOKED' });
    expect(calls).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed pinned UUIDs and cross-instance discovery substitutions', async () => {
    const { resolveDeployment, discovery } = fixture();
    const signal = new AbortController().signal;
    const operation = { id: 'math.add', version: '2' };
    await expect(resolveDeployment('app-b', 'workspace-B', operation, signal, 'not-a-uuid'))
      .resolves.toBeNull();
    const wrong = '44444444-4444-4444-8444-444444444444';
    await expect(resolveDeployment('app-b', 'workspace-B', operation, signal, wrong))
      .resolves.toBeNull();
    discovery.list = async () => [{ ...registryRow, deploymentId: wrong }];
    await expect(resolveDeployment('app-b', 'workspace-B', undefined, signal, deploymentId))
      .resolves.toBeNull();
  });

  it('refuses a FOD workflow handle on Skipo static-capability resolution', async () => {
    const { resolveDeployment, state } = fixture();
    await expect(resolveDeployment('app-b', 'workspace-B', {
      id: 'math.add', version: '2', kind: 'workflow',
    }, new AbortController().signal)).resolves.toBeNull();
    expect(state.resolved).toBe(0);
    expect(state.listed).toBe(0);
  });

  it('persists Skipo-attested static identity and invokes that same instance through the real target guard', async () => {
    const { client, state, discovery, fetcher } = fixture();
    const pinnedSelectors: Array<string | undefined> = [];
    const revalidate = discovery.revalidate;
    discovery.revalidate = async (req, selector) => {
      pinnedSelectors.push(selector.deploymentId);
      return revalidate(req, selector);
    };
    const [handle] = await client.discoverPinned('app-b', 'workspace-B');
    expect(handle).toEqual({
      id: 'math.add', version: '2', name: 'Addition', kind: 'static',
      appId: 'app-b', targetWorkspaceId: 'workspace-B',
      environment: 'production', deploymentId,
    });
    const result = await client.invokePinned(handle, { a: 7, b: 2 }, 'skipo-persisted-static-1');
    expect(result).toEqual({ output: { result: 9 }, invocationId: 'skipo-persisted-static-1' });
    expect(state.admitted).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Discovery validates each capability against this exact deployment.
    // Invocation keeps the same instance pinned across all three phases.
    expect(pinnedSelectors).toEqual([deploymentId, deploymentId, deploymentId, deploymentId]);
    state.current = false;
    await expect(client.invokePinned(handle, { a: 1, b: 1 }, 'skipo-persisted-after-revoke'))
      .rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('allows explicit Skipo-verified deployment selection for a multi-instance catalog', async () => {
    const { client, fetcher, discovery } = fixture();
    const [selected] = await client.discoverPinned(
      'app-b', 'workspace-B', undefined, undefined, deploymentId,
    );
    expect(selected.deploymentId).toBe(deploymentId);
    const wrongInstance = '77777777-7777-4777-8777-777777777777';
    await expect(client.discoverPinned(
      'app-b', 'workspace-B', undefined, undefined, wrongInstance,
    )).rejects.toMatchObject({ code: 'DEPLOYMENT_UNAVAILABLE' });
    await expect(client.discoverPinned(
      'app-b', 'workspace-B', undefined, undefined, 'malformed',
    )).rejects.toMatchObject({ code: 'MALFORMED_HANDLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(discovery).toBeTruthy();
  });
});
