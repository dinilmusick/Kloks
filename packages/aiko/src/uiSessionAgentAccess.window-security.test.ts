import { describe, expect, it, vi } from 'vitest';
import {
  createConsentedUiAgentAccess, type UiAgentConsentGrant,
  type VerifiedUiAgentCaller,
} from './uiSessionAgentAccess.js';

const tabs = {
  alice: '2743a144-98ac-4be0-a90b-f8868237d1cb',
  bob: 'f7d89b23-f537-4a54-a9b5-a462ad41d0e3',
};
const revision = '63599882-203c-43e1-a9c7-60322e1507b1';
function identity(userId: string, workspaceId: string): VerifiedUiAgentCaller {
  return {
    userId, workspaceId, appId: 'aiko', sessionId: userId + '-live-luth-session',
    sessionExpiresAt: 8000, appOrigin: 'https://aiko.example',
  };
}

describe('independent consent boundary across users, workspaces and windows', () => {
  it('passes exact consent context to the target and never crosses window ownership', async () => {
    const alice = identity('alice', 'workspace-one');
    const bob = identity('bob', 'workspace-two');
    const grants = new Map<string, UiAgentConsentGrant>([
      ['window-alice', {
        ...alice, grantId: 'generation-alice', consented: true, tabId: tabs.alice,
        origin: alice.appOrigin, windowId: 'window-alice', expiresAt: 7000,
        permissions: ['inspect', 'action'],
      }],
      ['window-bob', {
        ...bob, grantId: 'generation-bob', consented: true, tabId: tabs.bob,
        origin: bob.appOrigin, windowId: 'window-bob', expiresAt: 7000,
        permissions: ['inspect', 'action'],
      }],
    ]);
    const invoked: string[] = [];
    const access = createConsentedUiAgentAccess({
      now: () => 1000,
      verifyCaller: session => session === 'alice-token' ? alice :
        session === 'bob-token' ? bob : null,
      authorizeWindow: (_caller, windowId) => grants.get(windowId) ?? null,
      sanitizeSnapshot: (_caller, _grant, snapshot) =>
        ({ label: (snapshot as { label: string }).label }),
      approveAction: () => true,
      uiSession: async (request, context) => {
        const expected = context.windowId === 'window-alice' ? alice : bob;
        const expectedTab = context.windowId === 'window-alice' ? tabs.alice : tabs.bob;
        // Simulate required independent host/target reauthorization.
        if (context.principalId !== expected.userId ||
            context.workspaceId !== expected.workspaceId ||
            context.sessionId !== expected.sessionId || context.tabId !== expectedTab ||
            !request.url.includes(expectedTab)) {
          return Response.json({ error: 'denied' }, { status: 403 });
        }
        invoked.push(context.principalId + ':' + context.windowId);
        return Response.json({ session: { revision, snapshot: {
          label: context.windowId, secret: 'must-redact',
        } } });
      },
    });
    await expect(access.inspect('alice-token', 'window-alice'))
      .resolves.toMatchObject({ snapshot: { label: 'window-alice' } });
    await expect(access.inspect('bob-token', 'window-bob'))
      .resolves.toMatchObject({ snapshot: { label: 'window-bob' } });
    await expect(access.inspect('alice-token', 'window-bob')).rejects.toThrow('consent');
    await expect(access.inspect('bob-token', 'window-alice')).rejects.toThrow('consent');
    expect(invoked).toEqual(['alice:window-alice', 'bob:window-bob']);
    grants.delete('window-alice');
    await expect(access.inspect('alice-token', 'window-alice')).rejects.toThrow('consent');
    expect(invoked).toHaveLength(2);
  });

  it('rejects a grant reissued by mutating the same host object during redaction', async () => {
    const caller = identity('alice', 'workspace-one');
    const grant: UiAgentConsentGrant = {
      ...caller, windowId: 'window-alice', tabId: tabs.alice,
      origin: caller.appOrigin, grantId: 'generation-one', consented: true,
      expiresAt: 7000, permissions: ['inspect'],
    };
    const access = createConsentedUiAgentAccess({
      now: () => 1000, verifyCaller: () => caller,
      authorizeWindow: () => grant,
      sanitizeSnapshot: () => {
        (grant as { grantId: string }).grantId = 'generation-two';
        return { safelyRedacted: true };
      },
      approveAction: () => false,
      uiSession: async () => Response.json({ session: { revision, snapshot: {} } }),
    });
    await expect(access.inspect('token', 'window-alice')).rejects.toThrow('stale');
  });

  it('drops a snapshot if a reused login identifier changes user and workspace mid-flight', async () => {
    let user = 'alice';
    let workspace = 'workspace-one';
    const login = (): VerifiedUiAgentCaller => ({
      ...identity(user, workspace), sessionId: 'reused-session-id',
    });
    const liveGrant = (): UiAgentConsentGrant => ({
      ...login(), grantId: 'same-buggy-generation', windowId: 'window-alice',
      tabId: tabs.alice, origin: 'https://aiko.example', expiresAt: 7000,
      consented: true, permissions: ['inspect'],
    });
    const access = createConsentedUiAgentAccess({
      now: () => 1000,
      verifyCaller: login,
      authorizeWindow: liveGrant,
      sanitizeSnapshot: () => {
        user = 'bob';
        workspace = 'workspace-two';
        return { safe: true };
      },
      approveAction: () => false,
      uiSession: async () => Response.json({
        session: { revision, snapshot: { safe: true, secret: 'do-not-leak' } },
      }),
    });
    await expect(access.inspect('same-client-handle', 'window-alice'))
      .rejects.toThrow('stale');
  });

  it('rejects immediately when cancellation occurs during stalled user approval', async () => {
    const caller = identity('alice', 'workspace-one');
    const grant: UiAgentConsentGrant = {
      ...caller, windowId: 'window-alice', tabId: tabs.alice,
      origin: caller.appOrigin, grantId: 'generation-one', consented: true,
      expiresAt: 7000, permissions: ['action'],
    };
    const controller = new AbortController();
    const backend = vi.fn(async (request: Request) => request.method === 'GET'
      ? Response.json({ session: { revision, snapshot: {} } })
      : Response.json({ actionId: tabs.alice }, { status: 202 }));
    const access = createConsentedUiAgentAccess({
      now: () => 1000, verifyCaller: () => caller,
      authorizeWindow: () => grant,
      sanitizeSnapshot: () => ({}),
      approveAction: () => new Promise<boolean>(() => {}),
      uiSession: backend,
    });
    const promise = access.action('token', 'window-alice', {
      revision, componentId: 'card', controlId: 'click',
    }, controller.signal);
    for (let i = 0; i < 10 && backend.mock.calls.length === 0; i++) await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(backend.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(0);
  });
});
