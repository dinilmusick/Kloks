import { describe, expect, it, vi } from 'vitest';
import { createConsentedUiAgentAccess, type VerifiedUiAgentCaller,
  type UiAgentConsentGrant, type UiAgentActionRequest } from './uiSessionAgentAccess.js';

const tab = '2743a144-98ac-4be0-a90b-f8868237d1cb';
const revision = '63599882-203c-43e1-a9c7-60322e1507b1';
const differentRevision = '3ce83a20-7d20-4b59-9f84-0312794cc831';
const receipt = 'f63f7f3b-d6e4-4c99-9ee0-5b26973647b6';
const validAction = (): UiAgentActionRequest =>
  ({ revision, componentId: 'tiles', controlId: 'select', payload: { item: 1 } });

function fixture() {
  let tick = 1000;
  let live = true;
  let revoked = false;
  let activeSession = true;
  let activeRevision = revision;
  let permission: 'inspect' | 'action' | 'both' = 'both';
  let generation = 'grant-generation-1';
  let grantOrigin = 'https://aiko.example';
  let caller: VerifiedUiAgentCaller = {
    userId: 'alice', appId: 'aiko', workspaceId: 'workspace-A',
    sessionId: 'luth-session-1', sessionExpiresAt: 5000, appOrigin: 'https://aiko.example',
  };
  const requests: Request[] = [];
  const approvals: UiAgentActionRequest[] = [];
  const verifier = vi.fn((session: unknown): VerifiedUiAgentCaller | null => {
    if (!activeSession) return null;
    if (session === 's1') return { ...caller };
    if (session === 's2') return { ...caller, sessionId: 'luth-session-2' };
    return null;
  });
  const authorize = vi.fn((_, window: string): UiAgentConsentGrant | null => {
    if (!live || revoked || window !== 'window-1') return null;
    return {
      grantId: generation, windowId: 'window-1', tabId: tab, origin: grantOrigin,
      userId: 'alice', appId: 'aiko', workspaceId: 'workspace-A',
      sessionId: 'luth-session-1', consented: true, expiresAt: 4000,
      permissions: permission === 'both' ? ['inspect', 'action'] : [permission],
    };
  });
  const approve = vi.fn(async (_caller: VerifiedUiAgentCaller, _grant: UiAgentConsentGrant,
    action: UiAgentActionRequest) => { approvals.push(action); return true; });
  const sanitization = vi.fn(async (_caller: VerifiedUiAgentCaller, _grant: UiAgentConsentGrant,
    snapshot: unknown) => ({ safe: (snapshot as { safe: string }).safe }));
  const uiSession = vi.fn(async (req: Request): Promise<Response> => {
    requests.push(req);
    if (!live) return Response.json({ error: 'closed' }, { status: 404 });
    if (req.method === 'GET') {
      return Response.json({ session: { revision: activeRevision,
        snapshot: { safe: 'allowed', secret: 'credential' } } });
    }
    return Response.json({ actionId: receipt }, { status: 202 });
  });
  const opts = {
    verifyCaller: verifier, authorizeWindow: authorize, approveAction: approve,
    sanitizeSnapshot: sanitization, uiSession, now: () => tick,
  };
  return {
    opts, access: createConsentedUiAgentAccess(opts), approvals, requests, verifier,
    get caller() { return caller; },
    setCaller(c: VerifiedUiAgentCaller) { caller = c; },
    now(n: number) { tick = n; },
    logout() { activeSession = false; },
    close() { live = false; },
    revoke() { revoked = true; },
    rotateGrant() { generation = 'grant-generation-2'; },
    switchWorkspace() { caller = { ...caller, workspaceId: 'workspace-B' }; },
    setRevision(r: string) { activeRevision = r; },
    permissions(p: 'inspect' | 'action') { permission = p; },
    badOrigin() { grantOrigin = 'https://unregistered.example'; },
  };
}

describe('live-session frontend consent security regression', () => {
  it('fences grants to the exact active Luth session, even for the same user', async () => {
    const f = fixture();
    await expect(f.access.inspect('s1', 'window-1')).resolves.toMatchObject({
      windowId: 'window-1', revision, snapshot: { safe: 'allowed' },
    });
    await expect(f.access.inspect('s2', 'window-1')).rejects.toThrow('another session');
    expect(f.requests).toHaveLength(1);
  });

  it('rejects expired or revoked login despite a still-live consent grant', async () => {
    const f = fixture();
    f.now(5000);
    await expect(f.access.inspect('s1', 'window-1')).rejects.toThrow('unexpired Luth session');
    expect(f.requests).toHaveLength(0);
    const x = fixture();
    x.logout();
    await expect(x.access.inspect('s1', 'window-1')).rejects.toThrow('verified');
    expect(x.requests).toHaveLength(0);
  });

  it('rejects the wrong deployment origin and workspace before any UI call', async () => {
    const f = fixture();
    f.badOrigin();
    await expect(f.access.inspect('s1', 'window-1')).rejects.toThrow('application origin');
    expect(f.requests).toHaveLength(0);
    const x = fixture();
    x.switchWorkspace();
    await expect(x.access.inspect('s1', 'window-1')).rejects.toThrow('consent');
    expect(x.requests).toHaveLength(0);
  });

  it('drops a snapshot when consent is revoked during asynchronous redaction', async () => {
    const f = fixture();
    const original = f.opts.sanitizeSnapshot;
    const access = createConsentedUiAgentAccess({
      ...f.opts, sanitizeSnapshot: async (caller, grant, snapshot) => {
        const redacted = await original(caller, grant, snapshot);
        f.revoke();
        return redacted;
      },
    });
    await expect(access.inspect('s1', 'window-1')).rejects.toThrow('consent');
    expect(f.requests).toHaveLength(1);
  });

  it('drops a stale snapshot after a grant is replaced and verifies both sessions', async () => {
    const f = fixture();
    const access = createConsentedUiAgentAccess({
      ...f.opts, sanitizeSnapshot: async (caller, grant, snap) => {
        f.rotateGrant();
        return f.opts.sanitizeSnapshot(caller, grant, snap);
      },
    });
    await expect(access.inspect('s1', 'window-1')).rejects.toThrow('stale');
    expect(f.verifier).toHaveBeenCalledTimes(2);
  });

  it('requires a live tab and exact revision BEFORE asking for consent', async () => {
    const f = fixture();
    f.setRevision(differentRevision);
    await expect(f.access.action('s1', 'window-1', validAction())).rejects.toThrow('stale');
    expect(f.approvals).toHaveLength(0);
    expect(f.requests.map(r => r.method)).toEqual(['GET']);
    const x = fixture();
    x.close();
    await expect(x.access.action('s1', 'window-1', validAction())).rejects.toThrow('consent');
    expect(x.approvals).toHaveLength(0);
  });

  it('consent is specific to exact revision and action payload', async () => {
    const f = fixture();
    await expect(f.access.action('s1', 'window-1', validAction())).resolves.toEqual({
      windowId: 'window-1', status: 'queued', actionId: receipt,
    });
    expect(f.approvals).toEqual([validAction()]);
    expect(f.requests.map(r => r.method)).toEqual(['GET', 'POST']);
    expect(await f.requests[1].json()).toEqual(validAction());
  });

  it('fails closed if user closes or revokes window during action approval', async () => {
    const f = fixture();
    const access = createConsentedUiAgentAccess({
      ...f.opts, approveAction: async () => { f.close(); return true; },
    });
    await expect(access.action('s1', 'window-1', validAction())).rejects.toThrow('consent');
    expect(f.requests.filter(r => r.method === 'POST')).toHaveLength(0);
  });

  it('cancels one action during approval without queueing it or cancelling another session', async () => {
    const f = fixture();
    const controller = new AbortController();
    const access = createConsentedUiAgentAccess({
      ...f.opts, approveAction: async () => { controller.abort(); return true; },
    });
    await expect(access.action('s1', 'window-1', validAction(), controller.signal))
      .rejects.toThrow('cancelled');
    expect(f.requests.filter(r => r.method === 'POST')).toHaveLength(0);
    await expect(f.access.inspect('s1', 'window-1')).resolves.toHaveProperty('revision', revision);
  });

  it('does not return a snapshot when an inspection is cancelled during redaction', async () => {
    const f = fixture();
    const controller = new AbortController();
    const access = createConsentedUiAgentAccess({
      ...f.opts, sanitizeSnapshot: async () => {
        controller.abort();
        return { safe: 'should-not-escape' };
      },
    });
    await expect(access.inspect('s1', 'window-1', controller.signal))
      .rejects.toThrow('cancelled');
  });

  it('rejects missing action permission and backend failures without reporting success', async () => {
    const f = fixture();
    f.permissions('inspect');
    await expect(f.access.action('s1', 'window-1', validAction())).rejects.toThrow('consent');
    const x = fixture();
    const access = createConsentedUiAgentAccess({
      ...x.opts, uiSession: async () => Response.json({ error: 'storage down' }, { status: 503 }),
    });
    await expect(access.action('s1', 'window-1', validAction()))
      .rejects.toThrow('unavailable');
  });

  it('queues only the immutable action that received approval, despite mutable callbacks', async () => {
    const f = fixture();
    const requested = validAction();
    const access = createConsentedUiAgentAccess({
      ...f.opts, approveAction: async (_caller, _grant, displayed) => {
        (displayed as { componentId: string }).componentId = 'different';
        (displayed.payload as { item: number }).item = 999;
        (requested.payload as { item: number }).item = 500;
        return true;
      },
    });
    await access.action('s1', 'window-1', requested);
    expect(await f.requests[1].json()).toEqual(validAction());
  });

  it('rejects oversized action data before consent or dispatch', async () => {
    const f = fixture();
    const big = { ...validAction(), payload: 'x'.repeat(300_000) };
    await expect(f.access.action('s1', 'window-1', big)).rejects.toThrow('limit');
    expect(f.approvals).toHaveLength(0);
    expect(f.requests).toHaveLength(0);
  });

  it('blocks a grant expired during approval, even when the token is still live', async () => {
    const f = fixture();
    const access = createConsentedUiAgentAccess({
      ...f.opts, approveAction: async () => { f.now(4000); return true; },
    });
    await expect(access.action('s1', 'window-1', validAction())).rejects.toThrow('consent');
    expect(f.requests.filter(r => r.method === 'POST')).toHaveLength(0);
  });
});
