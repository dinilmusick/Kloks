import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
const driver = vi.hoisted(() => ({ legacy: false }));
vi.mock('@neondatabase/serverless', () => ({
  neon: () => driver.legacy ? query : Object.assign(
    () => { throw new Error('NEON_V1_TAGGED_TEMPLATE_MISUSE'); },
    { query },
  ),
}));
import { createCanonicalApplicationOAuthBff } from './OidcBffEnv.js';

const url = 'https://srkl.example.test';
const callback = url + '/api/auth/oidc/callback';
const request = new Request(url + '/api/auth/oidc/session');
const env = { APP_URL: url, SYSTEM_DATABASE_URL_1: 'postgres://canonical-db' };
const skipoConfig = { version: 1, authentication: { luthUrls: ['https://luth.example.test'] } };
const registration = { client_id: 'registered-public-client',
  encryption_secret: 'stable-server-only-encryption-secret-32-characters' };

beforeEach(() => { driver.legacy = false; query.mockReset(); vi.unstubAllGlobals(); });
afterEach(() => vi.unstubAllGlobals());

describe('open OAuth BFF registration without a trusted-origin catalogue', () => {
  it('self-registers unknown clients through public Luth DCR without preapproved apps or confidential secrets', async () => {
    let saved: typeof registration | null = null;
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT client_id,encryption_secret')) return saved ? [saved] : [];
      if (sql.startsWith('INSERT INTO public.kloks_oidc_registrations')) {
        saved = { client_id: String(params[2]), encryption_secret: String(params[3]) };
        return [];
      }
      throw new Error('unexpected SQL ' + sql);
    });
    const transport = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        token_endpoint_auth_method: 'none',
        redirect_uris: [callback],
        grant_types: ['authorization_code', 'refresh_token'],
      });
      expect(options?.credentials).toBe('omit');
      expect(options?.redirect).toBe('manual');
      expect(body).not.toHaveProperty('appId');
      expect(body).not.toHaveProperty('origin');
      return Response.json({
        client_id: registration.client_id,
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
      }, { status: 201 });
    });
    vi.stubGlobal('fetch', transport);
    const response = await createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request);
    expect(response?.status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]?.[0])).toBe('https://luth.example.test/api/auth/oauth2/register');
    expect(saved?.client_id).toBe(registration.client_id);
    const statements = query.mock.calls.map(call => String(call[0])).join(' ');
    expect(statements).not.toMatch(/luth_auth_origins|ultrst-apps|applicationOAuth|oauthClient/);
  });

  it('reuses its own issued client without registering again or requiring operator enrollment', async () => {
    query.mockResolvedValue([registration]);
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const response = await createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request);
    expect(response?.status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
    expect(query.mock.calls[0][1]).toEqual(['srkl', callback]);
  });

  it('also uses parameterized SQL on Neon 0.10 without the v1 query method', async () => {
    driver.legacy = true;
    query.mockResolvedValue([registration]);
    const response = await createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request);
    expect(response?.status).toBe(401);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE app_id=$1 AND redirect_uri=$2'),
      ['srkl', callback],
    );
  });

  it('fails closed on provider rejection, malformed response and missing local state', async () => {
    query.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ error: 'rate_limited' }, { status: 429 })));
    await expect(createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request))
      .rejects.toThrow('OAUTH_CLIENT_REGISTRATION_UNAVAILABLE');
  });

  it('rejects OAuth registration redirects without following them', async () => {
    query.mockResolvedValue([]);
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 302, headers: { location: 'https://unrelated.example.test/login' },
    }));
    vi.stubGlobal('fetch', transport);
    await expect(createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request))
      .rejects.toThrow('OAUTH_CLIENT_REGISTRATION_UNAVAILABLE');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('emits bounded server diagnostics without connection strings or redirect URLs', async () => {
    query.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ error: 'provider-unavailable' }, { status: 503 })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request))
        .rejects.toThrow('OAUTH_CLIENT_REGISTRATION_UNAVAILABLE');
      expect(log).toHaveBeenCalledWith('[Kloks OAuth bootstrap failed]', {
        phase: 'public_registration', code: 'LUTH_PUBLIC_OAUTH_REGISTRATION_DENIED',
        sqlstate: 'UNKNOWN',
      });
      const output = JSON.stringify(log.mock.calls);
      expect(output).not.toContain(env.SYSTEM_DATABASE_URL_1);
      expect(output).not.toContain(callback);
    } finally { log.mockRestore(); }
  });

  it('refuses missing or invalid Skipo Luth endpoint configuration', () => {
    expect(() => createCanonicalApplicationOAuthBff(request, env, 'srkl', undefined))
      .toThrow('SKIPO_AUTH_CONFIG_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects spoofed request hosts before any database or provider request', () => {
    expect(() => createCanonicalApplicationOAuthBff(
      new Request('https://foreign.example.test/api/auth/oidc/session'), env, 'srkl', skipoConfig,
    )).toThrow('APPLICATION_ORIGIN_MISMATCH');
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when canonical registration database is not migrated', async () => {
    query.mockRejectedValue(new Error('no such table'));
    await expect(createCanonicalApplicationOAuthBff(request, env, 'srkl', skipoConfig).handle(request))
      .rejects.toThrow('OAUTH_CLIENT_REGISTRATION_UNAVAILABLE');
  });
});
