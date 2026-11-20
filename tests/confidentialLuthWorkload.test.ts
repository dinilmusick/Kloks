import { describe, expect, it, vi } from 'vitest';
import { createConfidentialLuthWorkloadClient } from '../packages/backend/src/auth/ConfidentialLuthWorkload.js';

const origin = 'https://luth.example.test';
function discovery(ready: boolean) {
  return {
    protocol: 'ultrst.discovery.v1', version: 1,
    issuer: origin + '/api/auth',
    oidcDiscoveryUrl: origin + '/api/auth/.well-known/openid-configuration',
    oauthAuthorizationServerMetadataUrl: origin + '/api/auth/.well-known/oauth-authorization-server',
    configurationUrl: origin + '/api/config/v1', sessionUrl: origin + '/api/session',
    application: { appId: 'aiko', ecosystemId: 'ultrst-armada', name: 'Aiko' },
    capabilities: {
      email: true, google: true, authorizationCode: true,
      pkceS256: true, publicNativeClients: false, trustedWorkloads: ready,
    },
    publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
    cache: { maxAgeSeconds: 30, generatedAt: new Date().toISOString() },
  };
}
function configuration() {
  return {
    protocol: 'ultrst.configuration.workload.v1', version: 1,
    application: { appId: 'aiko', ecosystemId: 'ultrst-armada', name: 'Aiko' },
    principal: { workloadId: 'aiko-worker-client' },
    workspaceId: null,
    settings: {
      supportedServices: ['agents'], deploymentOrigin: 'https://aiko.example.test',
      deploymentEnvironment: 'test',
    },
    cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '42' },
  };
}
async function keyPair() {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']) as CryptoKeyPair;
  return { privateKeyJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: pair.publicKey };
}
const decode = (part: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')),
    c => c.charCodeAt(0),
  ))) as Record<string, unknown>;

describe('confidential Luth workload identity', () => {
  it('performs server-only private_key_jwt grant and typed least-privilege configuration', async () => {
    const { privateKeyJwk, publicKey } = await keyPair();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (target: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(target);
      calls.push({ url, init });
      if (url.includes('/api/discovery/v1')) return Response.json(discovery(true));
      if (url.includes('/oauth2/token')) return Response.json({
        access_token: 'verified-service-access-token-123456',
        token_type: 'Bearer', expires_in: 1800,
      });
      return Response.json(configuration());
    });
    const service = createConfidentialLuthWorkloadClient({
      appId: 'aiko', clientId: 'aiko-worker-client',
      issuerOrigin: origin, keyId: 'worker-key-1', privateKeyJwk,
      fetcher: fetcher as typeof fetch,
    });
    expect((await service.configuration()).principal.workloadId).toBe('aiko-worker-client');
    expect(calls.map(c => c.url)).toEqual([
      origin + '/api/discovery/v1?app_id=aiko',
      origin + '/api/auth/oauth2/token',
      origin + '/api/config/workload/v1?app_id=aiko',
    ]);
    const form = new URLSearchParams(String(calls[1]?.init.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('config:read');
    expect(form.get('client_secret')).toBeNull();
    const jwt = form.get('client_assertion')!;
    const [header, payload, signature] = jwt.split('.');
    expect(decode(header).kid).toBe('worker-key-1');
    expect(decode(payload).sub).toBe('aiko-worker-client');
    expect(decode(payload).aud).toBe(origin + '/api/auth/oauth2/token');
    expect(Number(decode(payload).exp) - Number(decode(payload).iat)).toBe(60);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      publicKey,
      Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')
        .padEnd(Math.ceil(signature.length / 4) * 4, '=')), c => c.charCodeAt(0)),
      new TextEncoder().encode(header + '.' + payload),
    );
    expect(valid).toBe(true);
    expect(new Headers(calls[2]?.init.headers).get('authorization'))
      .toBe('Bearer verified-service-access-token-123456');
    expect(calls[2]?.init.credentials).toBe('omit');
  });

  it('refuses unregistered clients before any grant request', async () => {
    const { privateKeyJwk } = await keyPair();
    const fetcher = vi.fn(async () => Response.json(discovery(false)));
    const client = createConfidentialLuthWorkloadClient({
      appId: 'aiko', clientId: 'aiko-worker-client',
      issuerOrigin: origin, keyId: 'key-1', privateKeyJwk, fetcher: fetcher as typeof fetch,
    });
    await expect(client.configuration()).rejects.toThrow('WORKLOAD_REGISTRATION_NOT_ENABLED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires a private key and rejects secret-shaped server configuration', async () => {
    const { privateKeyJwk } = await keyPair();
    expect(() => createConfidentialLuthWorkloadClient({
      appId: 'aiko', clientId: 'aiko-worker-client',
      issuerOrigin: origin, keyId: 'key-1', privateKeyJwk: { kty: 'RSA' },
    })).toThrow('UNPROVISIONED_CONFIDENTIAL_WORKLOAD');
    const fetcher = vi.fn(async (target: RequestInfo | URL) => {
      const url = String(target);
      if (url.includes('discovery')) return Response.json(discovery(true));
      if (url.includes('oauth2/token')) return Response.json({
        access_token: 'verified-service-access-token-123456', token_type: 'Bearer', expires_in: 3600,
      });
      return Response.json({ ...configuration(), settings: {
        ...configuration().settings, databaseUrl: 'postgres://hidden.invalid',
      } });
    });
    const client = createConfidentialLuthWorkloadClient({
      appId: 'aiko', clientId: 'aiko-worker-client',
      issuerOrigin: origin, keyId: 'key-1', privateKeyJwk, fetcher: fetcher as typeof fetch,
    });
    await expect(client.configuration()).rejects.toThrow('WORKLOAD_CONFIGURATION_SCHEMA_REJECTED');
  });
});
