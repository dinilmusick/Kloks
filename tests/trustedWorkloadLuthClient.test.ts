import { describe, expect, it, vi } from 'vitest';

const host = 'https://luth.example.test';
const doc = {
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: host + '/api/auth',
  configurationUrl: host + '/api/config/v1',
  workloadConfigurationUrl: host + '/api/config/workload/v1',
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  capabilities: { trustedWorkloads: true },
};
const result = {
  protocol: 'ultrst.configuration.workload.v1', version: 1,
  application: doc.application,
  principal: { kind: 'workload', clientId: 'srkl-worker-client' },
  workspaceId: null,
  settings: {
    supportedServices: ['accounts'], deploymentOrigin: 'https://srkl.example.test',
    deploymentEnvironment: 'production',
  },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '1' },
};

vi.mock('@dinilmusick/gutts/auth', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createUniversalInitializationClient: () => ({
      discover: async () => doc, readiness: 'unauthenticated',
      invalidate: () => {},
    }),
    parseUniversalWorkloadConfigurationV1: (input: unknown, appId: string, clientId: string) => {
      const data = input as typeof result;
      if (data.application.appId !== appId ||
          data.principal.clientId !== clientId ||
          data.settings.supportedServices.some(x => typeof x !== 'string')) {
        throw new Error('INVALID_WORKLOAD_CONFIGURATION');
      }
      return data;
    },
  };
});
import { createTrustedWorkloadLuthClient } from '../packages/backend/src/auth/TrustedWorkloadLuthClient.js';

async function key() {
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, false, ['sign', 'verify']);
  return keys.privateKey;
}

describe('Trusted headless discovery and client credentials continuation', () => {
  it('posts private_key_jwt then retrieves only app-bound no-store config', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/oauth2/token')) return Response.json({
        token_type: 'Bearer', access_token: 'signed-provider-token-123456789',
        expires_in: 300, scope: 'config:read',
      });
      if (url.includes('/api/config/workload/v1')) return Response.json(result);
      throw new Error('UNEXPECTED_NETWORK_ROUTE');
    });
    const client = createTrustedWorkloadLuthClient({
      appId: 'srkl', clientId: 'srkl-worker-client', luthOrigin: host,
      algorithm: 'RS256', keyId: 'key-1', privateKey: await key(),
      fetcher: network as typeof fetch,
    });
    expect((await client.getConfiguration()).principal.kind).toBe('workload');
    const token = calls[0];
    expect(token.url).toBe(host + '/api/auth/oauth2/token');
    expect(String(token.init?.body)).toContain('grant_type=client_credentials');
    expect(String(token.init?.body)).toContain('client_assertion_type=');
    expect(String(token.init?.body)).not.toContain('client_secret');
    const call = calls[1];
    expect(call.url).toBe(host + '/api/config/workload/v1?app_id=srkl');
    expect(call.init?.credentials).toBe('omit');
    expect(call.init?.cache).toBe('no-store');
    expect(new Headers(call.init?.headers).get('authorization'))
      .toBe('Bearer signed-provider-token-123456789');
  });
  it('rejects a token missing explicit config:read scope', async () => {
    const network = vi.fn(async () => Response.json({
      token_type: 'Bearer', access_token: 'unscoped-token-123456789',
      expires_in: 300, scope: 'read:other',
    }));
    const client = createTrustedWorkloadLuthClient({
      appId: 'srkl', clientId: 'srkl-worker-client',
      luthOrigin: host, privateKey: await key(),
      keyId: 'key-1', algorithm: 'RS256', fetcher: network as typeof fetch,
    });
    await expect(client.getConfiguration()).rejects.toThrow('INVALID_WORKLOAD_TOKEN_RESPONSE');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('rejects http issuer rather than sending private assertions over insecure transport', async () => {
    expect(() => createTrustedWorkloadLuthClient({
      appId: 'srkl', clientId: 'srkl-worker-client',
      luthOrigin: 'http://public.example.test',
      privateKey: await key(), keyId: 'key-1', algorithm: 'RS256',
    })).toThrow('UNTRUSTED_LUTH_WORKLOAD_ISSUER');
  });
});
