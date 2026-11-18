import { describe, expect, it, vi } from 'vitest';
import { FrontendSession } from './FrontendSession.js';

describe('FrontendSession disposal revocation', () => {
  it('forgets Luth credentials and all capability grants at sign-out', () => {
    const session = new FrontendSession({
      sessionId: 'session-1',
      credentials: { bearer: 'Luth-token', refresh: 'refresh-token' },
      capabilities: ['workspace.read', '*'],
    });
    expect(session.getCredential('bearer')).toBe('Luth-token');
    expect(session.hasCapability('anything')).toBe(true);

    session.dispose();

    expect(session.getCredential('bearer')).toBeUndefined();
    expect(session.getCredential('refresh')).toBeUndefined();
    expect(session.getCredentials()).toEqual({});
    expect(session.hasCapability('workspace.read')).toBe(false);
    expect(session.hasCapability('anything')).toBe(false);
  });

  it('prevents credentials or privileges being re-added to a disposed session', () => {
    const session = new FrontendSession({ sessionId: 'session-1' });
    session.dispose();
    expect(() => session.setCredential('bearer', 'stale-token')).toThrow('disposed session');
    expect(() => session.grantCapability('*')).toThrow('disposed session');
    expect(session.getCredentials()).toEqual({});
    expect(session.hasCapability('*')).toBe(false);
  });

  it('cleans subscriptions once even when disposal is repeated', () => {
    const session = new FrontendSession();
    const cleanup = vi.fn();
    session.trackSubscription(cleanup);
    session.dispose();
    session.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('immediately closes a subscription attached after disposal', () => {
    const session = new FrontendSession();
    session.dispose();
    const cleanup = vi.fn();
    const unsubscribe = session.trackSubscription(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('invalidates session callback handles on disposal', async () => {
    const session = new FrontendSession({ sessionId: 'session-1' });
    const callback = vi.fn(() => 'secret');
    const handle = session.callbackRegistry.register(callback, session.sessionId);
    session.dispose();
    await expect(session.callbackRegistry.invoke(handle, [], session.sessionId))
      .rejects.toThrow('not found or expired');
    expect(callback).not.toHaveBeenCalled();
  });
});
