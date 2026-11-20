import { describe, expect, it, vi } from 'vitest';
import { createOAuthBff } from '../packages/backend/src/auth/OidcBff.js';
import { createApplicationUniversalInitializationClient } from '../packages/client/src/UniversalInitializationBffClient.js';

const luth = 'https://luth.example.test';
const document = {
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: luth + '/api/auth',
  oidcDiscoveryUrl: luth + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: luth + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: luth + '/api/config/v1',
  sessionUrl: luth + '/api/session',
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  capabilities: { email: true, google: true, authorizationCode: true, pkceS256: true,
    publicNativeClients: false, trustedWorkloads: false },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  cache: { maxAgeSeconds: 30, generatedAt: new Date().toISOString() },
};
const config = {
  protocol: 'ultrst.configuration.v1', version: 1,
  application: document.application, principal: { userId: 'person-1' },
  workspaceId: null,
  settings: { supportedServices: ['accounts'], deploymentOrigin: null, deploymentEnvironment: null },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '42' },
};

describe('ULTRST BFF-mediated universal application initialization', () => {
  it('discovers from Luth, retrieves config only via same-origin BFF without bearer', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return Response.json(url === '/api/initialization/config' ? config : document);
    });
    const client = createApplicationUniversalInitializationClient({
      appId: 'srkl', luthOrigin: luth, fetcher: network as typeof fetch,
    });
    expect((await client.discover()).application.appId).toBe('srkl');
    expect((await client.configuration()).principal.userId).toBe('person-1');
    expect(calls.map(x => x.url)).toEqual([
      luth + '/api/discovery/v1?app_id=srkl',
      '/api/initialization/config',
    ]);
    expect(calls[1]?.init?.credentials).toBe('include');
    expect(new Headers(calls[1]?.init?.headers).has('authorization')).toBe(false);
  });

  it('refuses an attacker-controlled bootstrap origin', () => {
    expect(() => createApplicationUniversalInitializationClient({
      appId: 'srkl', luthOrigin: 'http://evil.example.test',
    })).toThrow('UNTRUSTED_LUTH_BOOTSTRAP');
  });

  it('BFF config endpoint requires the original first-party session cookie', async () => {
    const database = { query: vi.fn(async () => ({ rows: [] as any[] })) };
    const bff = createOAuthBff({
      issuer: luth + '/api/auth', appId: 'srkl', clientId: 'client-1',
      clientSecret: 'server-only-secret', encryptionSecret: 'long-server-only-secret-00000000000000000000',
      redirectUri: 'https://srkl.example.test/api/auth/oidc/callback',
      database,
      fetcher: vi.fn() as typeof fetch,
    });
    const unauth = await bff.handle(new Request('https://srkl.example.test/api/initialization/config'));
    expect(unauth?.status).toBe(401);
    const crossSite = await bff.handle(new Request('https://srkl.example.test/api/initialization/config', {
      headers: { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' },
    }));
    expect(crossSite?.status).toBe(403);
    expect(database.query).not.toHaveBeenCalled();
  });
});
