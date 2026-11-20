import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('@neondatabase/serverless', () => ({ neon: () => ({ query }) }));
import { createCanonicalApplicationOAuthBff } from './OidcBffEnv.js';

const url = 'https://srkl.example.test';
const session = new Request(url + '/api/auth/oidc/session');
const env = { APP_URL: url, SYSTEM_DATABASE_URL: 'postgres://trusted-host' };

const credential = {
  clientId: 'verified-official-client',
  clientSecret: 'official-client-secret-never-in-browser',
  bffSecret: 'a-stable-server-only-secret-longer-than-32-characters',
};
beforeEach(() => {
  query.mockReset();
});

describe('canonical ULTRST four-variable authentication bootstrap', () => {
  it('reads only from the canonical database and rejects removed or inactive credentials', async () => {
    query.mockResolvedValue([]);
    const bff = createCanonicalApplicationOAuthBff(session, {
      ...env,
      LUTH_OAUTH_CLIENT_ID: 'injected-attacker-id',
      LUTH_OAUTH_CLIENT_SECRET: 'injected-attacker-secret',
      LUTH_OAUTH_BFF_SECRET: 'injected-attacker-encryption-secret',
    }, 'srkl');
    await expect(bff.handle(session)).rejects.toThrow('CANONICAL_APP_AUTH_NOT_PROVISIONED');
    expect(query).toHaveBeenCalledTimes(1);
    const [statement, values] = query.mock.calls[0];
    expect(statement).toContain('public."ultrst-credentials"');
    expect(statement).toContain('public."oauthClient"');
    expect(statement).toContain("a.status = 'active'");
    expect(statement).toContain('o.enabled = true');
    expect(statement).toContain('COALESCE(c.disabled, false) = false');
    expect(values).toEqual(['srkl', url, 'srkl|' + url]);
    expect(JSON.stringify(values)).not.toContain('injected-attacker');
  });

  it('preserves anonymous 401 without credentials ever entering the response', async () => {
    query.mockResolvedValue([{ client_id: credential.clientId, settings: credential }]);
    const result = await createCanonicalApplicationOAuthBff(session, env, 'srkl').handle(session);
    expect(result?.status).toBe(401);
    const serialized = await result!.text();
    expect(serialized).not.toContain(credential.clientSecret);
    expect(serialized).not.toContain(credential.bffSecret);
  });

  it('fails closed on any OAuth client ID mismatch', async () => {
    query.mockResolvedValue([{ client_id: 'an-other-client', settings: credential }]);
    const bff = createCanonicalApplicationOAuthBff(session, env, 'srkl');
    await expect(bff.getSession(session)).rejects.toThrow('CANONICAL_APP_AUTH_NOT_PROVISIONED');
  });

  it('rejects origin spoofing before reading the database', async () => {
    expect(() => createCanonicalApplicationOAuthBff(
      new Request('https://foreign.example.test/api/auth/oidc/session'), env, 'srkl',
    )).toThrow('APPLICATION_ORIGIN_MISMATCH');
    expect(query).not.toHaveBeenCalled();
  });

  it('uses an eligible backup only when the primary throws, not after a denied client', async () => {
    query.mockRejectedValueOnce(new Error('database offline')).mockResolvedValueOnce([
      { client_id: credential.clientId, settings: credential },
    ]);
    const alternative = { ...env, SYSTEM_DATABASE_URL_2: 'postgres://backup-host' };
    const bff = createCanonicalApplicationOAuthBff(session, alternative, 'srkl');
    expect((await bff.handle(session))?.status).toBe(401);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
