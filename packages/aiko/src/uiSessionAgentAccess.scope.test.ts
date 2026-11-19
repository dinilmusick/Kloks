import { describe, expect, it, vi } from 'vitest';
import {
  createConsentedUiAgentAccess, createSessionScopedConsentedUiAgentAccess,
  UiAgentAccessError,
  type UiAgentFrontendSessionScope, type UiAgentVerifiedFrontendScope,
  type UiAgentAccessOptions, type UiAgentConsentGrant, type VerifiedUiAgentCaller,
} from './uiSessionAgentAccess.js';

const tab = '2743a144-98ac-4be0-a90b-f8868237d1cb';
const revision = '63599882-203c-43e1-a9c7-60322e1507b1';
const actionId = 'f63f7f3b-d6e4-4c99-9ee0-5b26973647b6';
const origin = 'https://aiko.example';
const identity: VerifiedUiAgentCaller = {
  userId: 'alice', sessionId: 'luth-alice-1', appId: 'aiko',
  workspaceId: 'workspace-A', sessionExpiresAt: 9000, appOrigin: origin,
};
const pinned: UiAgentVerifiedFrontendScope = {
  userId: identity.userId, appId: identity.appId, workspaceId: identity.workspaceId,
  appOrigin: identity.appOrigin,
};
function fixture() {
  let now = 1000;
  let active = true;
  let caller: VerifiedUiAgentCaller | null = { ...identity };
  let grant: UiAgentConsentGrant | null = {
    ...identity, tabId: tab, windowId: 'window-A', grantId: 'generation-A',
    consented: true, expiresAt: 8000, origin, permissions: ['inspect', 'action'],
  };
  const calls: Request[] = [];
  const approvals = vi.fn(async () => true);
  const uiSession = vi.fn(async (request: Request) => {
    calls.push(request);
    return request.method === 'GET'
      ? Response.json({ session: { revision, snapshot: { safe: true, secret: 'must-redact' } } })
      : Response.json({ actionId }, { status: 202 });
  });
  const options: UiAgentAccessOptions = {
    now: () => now,
    verifyCaller: () => active ? caller : null,
    authorizeWindow: () => grant,
    approveAction: approvals,
    sanitizeSnapshot: () => ({ safe: true }),
    uiSession,
  };
  const operations = new Set<AbortController>();
  let disposed = false;
  const frontend: UiAgentFrontendSessionScope = {
    sessionId: identity.sessionId,
    isDisposed: () => disposed,
    trackAbortController(controller) {
      if (disposed) { controller.abort(); return () => {}; }
      operations.add(controller);
      return () => { operations.delete(controller); };
    },
  };
  const dispose = () => {
    disposed = true;
    for (const controller of operations) controller.abort();
    operations.clear();
  };
  return {
    options, frontend, dispose, uiSession, calls, approvals,
    active: (value: boolean) => { active = value; },
    caller: (value: VerifiedUiAgentCaller | null) => { caller = value; },
    grant: (value: UiAgentConsentGrant | null) => { grant = value; },
    currentGrant: () => grant,
    time: (value: number) => { now = value; },
    trackedCount: () => operations.size,
  };
}

describe('session-scoped frontend agent consent lifecycle', () => {
  it('runs inspection and action under one exact authenticated frontend scope', async () => {
    const f = fixture();
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, f.options);
    await expect(access.inspect('opaque-host-handle', 'window-A')).resolves.toMatchObject({
      windowId: 'window-A', revision, snapshot: { safe: true },
    });
    await expect(access.action('opaque-host-handle', 'window-A', {
      revision, componentId: 'panel', controlId: 'click',
    })).resolves.toMatchObject({ windowId: 'window-A', status: 'queued', actionId });
    expect(f.calls.map(call => call.method)).toEqual(['GET', 'GET', 'POST']);
    expect(f.trackedCount()).toBe(0);
  });

  it.each([
    ['another user', { ...identity, userId: 'bob' }],
    ['another Luth session', { ...identity, sessionId: 'luth-alice-2' }],
    ['another app', { ...identity, appId: 'kone' }],
    ['another workspace', { ...identity, workspaceId: 'workspace-B' }],
    ['another verified origin', { ...identity, appOrigin: 'https://other.example' }],
  ])('rejects %s even when host returns the original consent grant', async (_label, changed) => {
    const f = fixture();
    f.caller(changed);
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, f.options);
    await expect(access.inspect('handle', 'window-A')).rejects.toThrow('Luth session');
    expect(f.uiSession).not.toHaveBeenCalled();
    expect(f.trackedCount()).toBe(0);
  });

  it('rejects disposed scopes before contacting the UI and denies rehydrating a disposed scope', async () => {
    const f = fixture();
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, f.options);
    f.dispose();
    await expect(access.inspect('handle', 'window-A')).rejects.toThrow('scope disposed');
    expect(() => createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, f.options))
      .toThrow('live, trusted frontend session');
    expect(f.uiSession).not.toHaveBeenCalled();
  });

  it('aborts an in-flight individual action approval when the frontend scope is disposed', async () => {
    const f = fixture();
    let approvalEntered!: () => void;
    const approvalStarted = new Promise<void>(resolve => { approvalEntered = resolve; });
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, {
      ...f.options,
      approveAction: () => { approvalEntered(); return new Promise<boolean>(() => {}); },
    });
    const promise = access.action('handle', 'window-A', {
      revision, componentId: 'panel', controlId: 'click',
    });
    await approvalStarted;
    expect(f.trackedCount()).toBe(1);
    f.dispose();
    await expect(promise).rejects.toThrow('cancelled');
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    expect(f.trackedCount()).toBe(0);
  });

  it('propagates an individual cancellation without revoking a different active operation', async () => {
    const f = fixture();
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, {
      ...f.options, sanitizeSnapshot: () => {
        entered();
        return new Promise<unknown>(() => {});
      },
    });
    const promise = access.inspect('handle', 'window-A', controller.signal);
    await started;
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(f.trackedCount()).toBe(0);
    const other = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, f.options);
    await expect(other.inspect('handle', 'window-A')).resolves.toHaveProperty('revision', revision);
  });

  it('clones redacted snapshot data so later host mutation cannot expose sensitive fields', async () => {
    const f = fixture();
    const snapshot = { safe: { text: 'approved' } };
    const access = createConsentedUiAgentAccess({
      ...f.options, sanitizeSnapshot: () => snapshot,
    });
    const result = await access.inspect('handle', 'window-A');
    snapshot.safe.text = 'changed-after-approval';
    (snapshot as Record<string, unknown>).secret = 'credential';
    expect(result.snapshot).toEqual({ safe: { text: 'approved' } });
  });

  it('rejects non-serializable and oversized redaction results without exposing data', async () => {
    const f = fixture();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const invalid = createConsentedUiAgentAccess({
      ...f.options, sanitizeSnapshot: () => circular,
    });
    await expect(invalid.inspect('handle', 'window-A')).rejects.toThrow('serializable JSON');
    const oversized = createConsentedUiAgentAccess({
      ...f.options, sanitizeSnapshot: () => ({ safe: 'x'.repeat(300000) }),
    });
    await expect(oversized.inspect('handle', 'window-A')).rejects.toThrow('response limit');
  });

  it('notifies a host approval prompt immediately when its frontend session is disposed', async () => {
    const f = fixture();
    let approvalEntered!: () => void;
    const started = new Promise<void>(resolve => { approvalEntered = resolve; });
    let approvalSignal: AbortSignal | undefined;
    const access = createSessionScopedConsentedUiAgentAccess(f.frontend, pinned, {
      ...f.options,
      approveAction: (_caller, _grant, _action, signal) => {
        approvalSignal = signal;
        approvalEntered();
        return new Promise<boolean>(() => {});
      },
    });
    const pending = access.action('host-handle', 'window-A', {
      revision, componentId: 'panel', controlId: 'click',
    });
    await started;
    expect(approvalSignal?.aborted).toBe(false);
    f.dispose();
    expect(approvalSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow('cancelled');
  });

  it.each([
    [401, 'BACKEND_DENIED'],
    [403, 'BACKEND_DENIED'],
    [404, 'WINDOW_CLOSED'],
    [409, 'REVISION_CONFLICT'],
    [503, 'BACKEND_UNAVAILABLE'],
  ] as const)('propagates HTTP %i as a typed %s denial without backend contents', async (status, code) => {
    const f = fixture();
    const access = createConsentedUiAgentAccess({
      ...f.options,
      uiSession: async () => Response.json({ secret: 'do-not-expose', error: 'internal' }, { status }),
    });
    const caught = await access.inspect('handle', 'window-A').catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(UiAgentAccessError);
    expect(caught).toMatchObject({ code, status });
    expect((caught as Error).message).not.toContain('do-not-expose');
  });

  it('does not return a queued receipt if the grant is revoked during target dispatch', async () => {
    const f = fixture();
    const access = createConsentedUiAgentAccess({
      ...f.options,
      uiSession: async request => {
        if (request.method === 'GET') {
          return Response.json({ session: { revision, snapshot: { safe: true } } });
        }
        f.grant(null);
        return Response.json({ actionId }, { status: 202 });
      },
    });
    await expect(access.action('handle', 'window-A', {
      revision, componentId: 'panel', controlId: 'click',
    })).rejects.toThrow('consent');
    // The backend may already have accepted work; cancellation there is still required.
  });
});
