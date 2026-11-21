import { describe, expect, it, vi } from 'vitest';
import { createOAuthBff, type OAuthBffDatabase, type OAuthBffConfig } from './OidcBff.js';

const issuer = 'https://luth.example.test/api/auth';
const appOrigin = 'https://srkl.example.test';
const redirectUri = appOrigin + '/api/auth/oidc/callback';

function fixture(publicClient = false) {
  let login: { stateHash: string; verifier: string; returnTo: string; consumed: boolean } | null = null;
  let browserSession: any = null;
  const database: OAuthBffDatabase = {
    query: vi.fn(async (sql, values) => {
      if (sql.startsWith('INSERT INTO public.kloks_oidc_flows')) {
        login = { stateHash: String(values[0]), verifier: String(values[2]),
          returnTo: String(values[4]), consumed: false };
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE public.kloks_oidc_flows')) {
        if (!login || login.consumed || login.stateHash !== values[0]) return { rows: [] };
        login.consumed = true;
        return { rows: [{ verifier_encrypted: login.verifier, return_to: login.returnTo }] };
      }
      if (sql.startsWith('INSERT INTO public.kloks_oidc_sessions')) {
        browserSession = {
          session_id: values[1], principal_id: values[3], email: values[4],
          display_name: values[5], access_encrypted: values[6], refresh_encrypted: values[7],
          access_expires_at: values[8], expires_at: values[9], revision: 0, revoked: false,
          session_hash: values[0],
        };
        return { rows: [] };
      }
      if (sql.startsWith('SELECT session_id,principal_id,email')) {
        if (!browserSession || browserSession.revoked || browserSession.session_hash !== values[0]) {
          return { rows: [] };
        }
        return { rows: [browserSession] };
      }
      if (sql.startsWith('SELECT refresh_encrypted FROM public.kloks_oidc_sessions')) {
        if (browserSession && browserSession.session_hash === values[0] && !browserSession.revoked) {
          return { rows: [{ refresh_encrypted: browserSession.refresh_encrypted }] };
        }
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE public.kloks_oidc_sessions SET revoked_at')) {
        if (browserSession && browserSession.session_hash === values[0]) browserSession.revoked = true;
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE public.kloks_oidc_sessions SET access_encrypted')) {
        if (!browserSession || browserSession.session_hash !== values[3] ||
          browserSession.revision !== values[5]) return { rows: [] };
        browserSession.access_encrypted = values[0];
        browserSession.refresh_encrypted = values[1];
        browserSession.access_expires_at = values[2];
        browserSession.revision++;
        return { rows: [{ ...browserSession }] };
      }
      throw new Error('Unexpected database operation: ' + sql.slice(0, 100));
    }),
  };
  let available = true;
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!available) throw new Error('Luth service offline');
    const path = new URL(String(input)).pathname;
    if (path === '/api/auth/oauth2/token') {
      const body = new URLSearchParams(init?.body as string);
      if (body.get('client_id') !== 'verified-srkl-client' ||
          (publicClient ? body.has('client_secret') :
            body.get('client_secret') !== 'server-private-client-secret')) {
        return Response.json({ error: 'invalid_client' }, { status: 401 });
      }
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== 'valid-authorization-code' ||
            !body.get('code_verifier') || body.get('redirect_uri') !== redirectUri) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        return Response.json({ access_token: 'luth-access-token',
          refresh_token: 'luth-refresh-token', expires_in: 3600 });
      }
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === 'luth-refresh-token') {
        return Response.json({ access_token: 'refreshed-access-token',
          refresh_token: 'rotated-refresh-token', expires_in: 3600 });
      }
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (path === '/api/auth/oauth2/revoke') {
      const params = new URLSearchParams(init?.body as string);
      return params.get('client_id') === 'verified-srkl-client' &&
        params.get('token') === 'luth-refresh-token'
        ? new Response(null, { status: 200 })
        : Response.json({ error: 'invalid_client' }, { status: 401 });
    }
    if (path === '/api/auth/oauth2/userinfo') {
      if (init?.headers && new Headers(init.headers).get('authorization')?.startsWith('Bearer ')) {
        return Response.json({ sub: 'verified-luth-user', email: 'user@example.test',
          name: 'Verified Google User' });
      }
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }
    throw new Error('Unexpected OAuth upstream: ' + path);
  });
  let time = Date.parse('2026-11-19T14:00:00Z');
  const config: OAuthBffConfig = {
    issuer, clientId: 'verified-srkl-client',
    ...(publicClient ? {} : { clientSecret: 'server-private-client-secret' }),
    appId: 'srkl', redirectUri, encryptionSecret: 'this-is-a-server-only-32-byte-oidc-encryption-secret',
    database, fetcher: transport as typeof fetch, now: () => time,
  };
  const bff = createOAuthBff(config);
  async function begin(next = '/workspaces') {
    const first = await bff.handle(new Request(appOrigin + '/api/auth/oidc/start?next=' + encodeURIComponent(next)));
    expect(first?.status).toBe(303);
    const authorization = new URL(first!.headers.get('location')!);
    const state = authorization.searchParams.get('state')!;
    const flowCookie = first!.headers.get('set-cookie')!.split(';')[0]!;
    return { authorization, state, flowCookie };
  }
  async function finish(state: string, flowCookie: string, extras = '') {
    return bff.handle(new Request(
      redirectUri + '?code=valid-authorization-code&state=' + state +
      '&iss=' + encodeURIComponent(issuer) + extras,
      { headers: { cookie: flowCookie } },
    ));
  }
  return { database, bff, begin, finish, transport, setAvailable(value: boolean) { available = value; },
    advance(ms: number) { time += ms; } };
}

describe('Kloks canonical Better Auth application OAuth BFF', () => {
  it('uses only client_id plus PKCE for public self-registered OAuth clients', async () => {
    const f = fixture(true);
    const { state, flowCookie } = await f.begin();
    const callback = await f.finish(state, flowCookie);
    expect(callback?.status).toBe(303);
    const tokenCalls = f.transport.mock.calls.filter(call =>
      new URL(String(call[0])).pathname === '/api/auth/oauth2/token');
    expect(tokenCalls).toHaveLength(1);
    const payload = new URLSearchParams(tokenCalls[0]![1]?.body as string);
    expect(payload.get('client_id')).toBe('verified-srkl-client');
    expect(payload.has('client_secret')).toBe(false);
    expect(payload.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('starts only S256 PKCE with exact registered redirect and host-scoped HttpOnly cookie', async () => {
    const f = fixture();
    const { authorization, flowCookie } = await f.begin('/workspaces');
    expect(authorization.origin).toBe('https://luth.example.test');
    expect(authorization.pathname).toBe('/api/auth/oauth2/authorize');
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('prompt')).toBe('login');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorization.searchParams.get('scope')).toContain('openid');
    expect(authorization.searchParams.has('code_verifier')).toBe(false);
    expect(flowCookie).toMatch(/^__Host-ultrst_oidc_flow=[A-Za-z0-9_-]{43}$/);
  });

  it('does server-side exchange, verifies userinfo, issues only opaque app cookie and survives refresh', async () => {
    const f = fixture();
    const { state, flowCookie } = await f.begin('/workspaces');
    const callback = await f.finish(state, flowCookie);
    expect(callback?.status).toBe(303);
    expect(callback?.headers.get('location')).toBe(appOrigin + '/workspaces');
    expect(callback?.headers.get('location')).not.toContain('token=');
    const browserCookie = callback!.headers.get('set-cookie')!.split(';')[0]!;
    expect(browserCookie).toMatch(/^__Host-ultrst_oidc_session=[A-Za-z0-9_-]{43}$/);
    expect(browserCookie).not.toContain('luth-access-token');
    const sessionRequest = new Request(appOrigin + '/api/auth/oidc/session', {
      headers: { cookie: browserCookie },
    });
    const response = await f.bff.handle(sessionRequest);
    expect(response?.status).toBe(200);
    expect((await response!.json()).user.id).toBe('verified-luth-user');
    expect((await f.bff.getSession(sessionRequest))?.user.email).toBe('user@example.test');
    expect(await f.finish(state, flowCookie).then(x => x?.status)).toBe(400);
  });

  it('rejects a forged issuer, wrong state cookie and external return targets', async () => {
    const f = fixture();
    const { state, flowCookie } = await f.begin('//evil.example.test/');
    expect((await f.finish(state, flowCookie + 'tampered'))?.status).toBe(400);
    expect((await f.finish(state, flowCookie, '&iss=' + encodeURIComponent('https://other.example.test')))?.status).toBe(400);
    const legit = await f.finish(state, flowCookie);
    expect(legit?.headers.get('location')).toBe(appOrigin + '/');
    expect(f.transport).toHaveBeenCalledTimes(2);
  });

  it('does not clear a session cookie because Luth is briefly unavailable', async () => {
    const f = fixture();
    const { state, flowCookie } = await f.begin();
    const callback = await f.finish(state, flowCookie);
    const sessionCookie = callback!.headers.get('set-cookie')!.split(';')[0]!;
    f.setAvailable(false);
    const result = await f.bff.handle(new Request(appOrigin + '/api/auth/oidc/session', {
      headers: { cookie: sessionCookie },
    }));
    expect(result?.status).toBe(503);
    expect(result?.headers.get('set-cookie')).toBeNull();
  });

  it('requires same-origin POST for logout and revokes the server session', async () => {
    const f = fixture();
    const { state, flowCookie } = await f.begin();
    const callback = await f.finish(state, flowCookie);
    const sessionCookie = callback!.headers.get('set-cookie')!.split(';')[0]!;
    const logoutUrl = appOrigin + '/api/auth/oidc/logout';
    expect((await f.bff.handle(new Request(logoutUrl, {
      method: 'POST', headers: { cookie: sessionCookie, origin: 'https://attacker.example.test' },
    })))?.status).toBe(403);
    const accepted = await f.bff.handle(new Request(logoutUrl, {
      method: 'POST', headers: { cookie: sessionCookie, origin: appOrigin },
    }));
    expect(accepted?.status).toBe(200);
    expect((await f.bff.getSession(new Request(logoutUrl, { headers: { cookie: sessionCookie } })))).toBeNull();
  });
});
