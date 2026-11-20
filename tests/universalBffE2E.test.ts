import { describe, expect, it, vi } from 'vitest';
import { createOAuthBff } from '../packages/backend/src/auth/OidcBff.js';

const issuer = 'https://luth.example.test/api/auth';
const appOrigin = 'https://srkl.example.test';
const access = 'sensitive-app-oauth-access-token-123456';
const configuration = {
  protocol: 'ultrst.configuration.v1', version: 1,
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  principal: { userId: 'user-1' }, workspaceId: null,
  settings: { supportedServices: ['accounts'],
    deploymentOrigin: appOrigin, deploymentEnvironment: 'test' },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '1' },
};

describe('Kloks BFF authorized configuration continuation', () => {
  it('holds bearer server-side through PKCE callback, session and config', async () => {
    let flow: { encrypted: string; returnTo: string } | null = null;
    let session: Record<string, unknown> | null = null;
    const db = {
      async query(statement: string, values: readonly unknown[]) {
        if (statement.startsWith('INSERT INTO public.kloks_oidc_flows')) {
          flow = { encrypted: String(values[2]), returnTo: String(values[4]) };
          return { rows: [] };
        }
        if (statement.startsWith('UPDATE public.kloks_oidc_flows')) {
          return { rows: flow ? [{ verifier_encrypted: flow.encrypted,
            return_to: flow.returnTo }] : [] };
        }
        if (statement.startsWith('INSERT INTO public.kloks_oidc_sessions')) {
          session = {
            session_id: String(values[1]), principal_id: String(values[3]),
            email: String(values[4]), display_name: String(values[5]),
            access_encrypted: String(values[6]), refresh_encrypted: values[7],
            access_expires_at: String(values[8]), expires_at: String(values[9]),
            revision: 0,
          };
          return { rows: [] };
        }
        if (statement.startsWith('SELECT session_id,principal_id')) {
          return { rows: session ? [session] : [] };
        }
        if (statement.startsWith('SELECT principal_id,access_encrypted')) {
          return { rows: session ? [session] : [] };
        }
        if (statement.startsWith('SELECT 1 FROM public.kloks_oidc_sessions')) {
          return { rows: session ? [{ authorized: true }] : [] };
        }
        throw new Error('Unexpected test query (fail closed)');
      },
    };
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/oauth2/token')) {
        return Response.json({ access_token: access,
          refresh_token: 'server-private-refresh-token', expires_in: 3600 });
      }
      if (url.endsWith('/oauth2/userinfo')) {
        return Response.json({ sub: 'user-1', email: 'test@example.test' });
      }
      if (url.endsWith('/api/config/v1?app_id=srkl')) return Response.json(configuration);
      return Response.json({ error: 'UNEXPECTED_UPSTREAM' }, { status: 500 });
    });
    const bff = createOAuthBff({
      appId: 'srkl', issuer, clientId: 'srkl-confidential',
      clientSecret: 'only-on-trusted-server',
      redirectUri: appOrigin + '/api/auth/oidc/callback',
      encryptionSecret: 'long-test-key-for-unique-server-only-encryption-key',
      database: db, fetcher: fetcher as typeof fetch,
    });

    const started = await bff.start(new Request(appOrigin + '/api/auth/oidc/start'));
    expect(started.status).toBe(303);
    const startedAt = new URL(started.headers.get('location')!);
    expect(startedAt.searchParams.get('code_challenge_method')).toBe('S256');
    expect(startedAt.searchParams.has('client_secret')).toBe(false);
    const flowCookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const callback = new URL(appOrigin + '/api/auth/oidc/callback');
    callback.searchParams.set('code', 'abcdefghijklmnopqrstuvwxyz012345');
    callback.searchParams.set('state', startedAt.searchParams.get('state')!);
    callback.searchParams.set('iss', issuer);
    const authenticated = await bff.callback(new Request(callback, {
      headers: { cookie: flowCookie },
    }));
    expect(authenticated.status).toBe(303);
    const sessionCookie = authenticated.headers.get('set-cookie')!.split(';')[0]!;
    expect(sessionCookie).toContain('__Host-ultrst_oidc_session=');
    expect(sessionCookie).not.toContain(access);
    const response = await bff.handle(new Request(
      appOrigin + '/api/initialization/config',
      { headers: { cookie: sessionCookie, origin: appOrigin, 'sec-fetch-site': 'same-origin' } },
    ));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    const body = await response!.json();
    expect(body.principal.userId).toBe('user-1');
    expect(body.settings.supportedServices).toEqual(['accounts']);
    expect(JSON.stringify(body)).not.toContain(access);
    const request = calls.find(x => x.url.includes('/api/config/v1'));
    expect(new Headers(request?.init?.headers).get('authorization')).toBe('Bearer ' + access);
    expect(request?.url.startsWith('https://luth.example.test/')).toBe(true);
    expect(request?.init?.credentials).toBe('omit');
  });
});
