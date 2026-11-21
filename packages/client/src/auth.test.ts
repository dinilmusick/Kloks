import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LUTH_URL, extractLuthToken, isPublicRoute, verifyLuthRequest } from './auth.js';

afterEach(() => vi.unstubAllGlobals());

describe('single canonical OAuth identity client', () => {
  it('exports one known public Luth issuer without a trusted-client origin catalogue', () => {
    expect(DEFAULT_LUTH_URL).toMatch(/^https:\/\//);
    expect(isPublicRoute('/api/auth/oidc/start')).toBe(true);
    expect(isPublicRoute('/api/private-workspace')).toBe(false);
  });

  it('never authenticates through a foreign cookie or x-api-key fallback', async () => {
    const request = new Request('https://unlisted-app.example.test/api/private', {
      headers: { cookie: 'better-auth.session_token=fake', 'x-api-key': 'fake-key' },
    });
    expect(extractLuthToken(request)).toBe('');
    const result = await verifyLuthRequest(request);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('verifies bearer identity using live official UserInfo and never reuses a stale cache', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(Response.json({
        sub: 'luth-user', email: 'owner@example.test', name: 'Owner',
      }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_token' }, { status: 401 }));
    vi.stubGlobal('fetch', transport);
    const request = new Request('https://unlisted-app.example.test/api/private', {
      headers: { authorization: 'Bearer verified-opaque-oauth-token-123456' },
    });
    expect(await verifyLuthRequest(request)).toEqual({
      id: 'luth-user', email: 'owner@example.test', name: 'Owner', role: 'user',
    });
    const second = await verifyLuthRequest(request);
    expect(second).toBeInstanceOf(Response);
    expect((second as Response).status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(String(transport.mock.calls[0]?.[0])).toContain('/api/auth/oauth2/userinfo');
    expect(transport.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });
});
