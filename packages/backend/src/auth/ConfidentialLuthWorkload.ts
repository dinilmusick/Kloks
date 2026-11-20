import { parseUniversalDiscoveryV1 } from '@dinilmusick/gutts/auth';

/**
 * Confidential server-side workload identity, using the Luth OAuth Provider's
 * official private_key_jwt client_credentials grant. The caller must obtain
 * its own per-deployment key from a protected server secret, never browser JS.
 */
export interface LuthWorkloadIdentity {
  appId: string;
  clientId: string;
  issuerOrigin: string;
  keyId: string;
  privateKeyJwk: JsonWebKey;
  fetcher?: typeof fetch;
}

export interface LuthWorkloadConfiguration {
  protocol: 'ultrst.configuration.workload.v1';
  version: 1;
  application: { appId: string; ecosystemId: string; name: string };
  principal: { kind: 'workload'; clientId: string };
  workspaceId: null;
  settings: {
    supportedServices: string[];
    deploymentOrigin: string | null;
    deploymentEnvironment: string | null;
  };
  cache: { maxAgeSeconds: 0; generatedAt: string; revision: string };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('WORKLOAD_CONFIGURATION_SCHEMA_REJECTED');
  }
  return input as Record<string, unknown>;
}
function keysEqual(actual: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(actual).every(key => expected.includes(key));
}
function parseWorkloadConfig(
  input: unknown, appId: string, clientId: string,
): LuthWorkloadConfiguration {
  const data = asRecord(input);
  const app = asRecord(data.application), principal = asRecord(data.principal);
  const settings = asRecord(data.settings), cache = asRecord(data.cache);
  if (data.protocol !== 'ultrst.configuration.workload.v1' || data.version !== 1 ||
      app.appId !== appId || typeof app.name !== 'string' ||
      typeof app.ecosystemId !== 'string' || principal.kind !== 'workload' || principal.clientId !== clientId ||
      data.workspaceId !== null || cache.maxAgeSeconds !== 0 ||
      typeof cache.generatedAt !== 'string' || typeof cache.revision !== 'string' ||
      !Array.isArray(settings.supportedServices) ||
      !settings.supportedServices.every(s => typeof s === 'string') ||
      (settings.deploymentOrigin !== null &&
       typeof settings.deploymentOrigin !== 'string') ||
      (settings.deploymentEnvironment !== null &&
       typeof settings.deploymentEnvironment !== 'string') ||
      !keysEqual(data, ['protocol', 'version', 'application', 'principal',
        'workspaceId', 'settings', 'cache']) ||
      !keysEqual(app, ['appId', 'ecosystemId', 'name']) ||
      !keysEqual(principal, ['kind', 'clientId']) ||
      !keysEqual(settings, ['supportedServices', 'deploymentOrigin',
        'deploymentEnvironment']) ||
      !keysEqual(cache, ['maxAgeSeconds', 'generatedAt', 'revision'])) {
    throw new Error('WORKLOAD_CONFIGURATION_SCHEMA_REJECTED');
  }
  return data as unknown as LuthWorkloadConfiguration;
}

function pinnedOrigin(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
       !(url.protocol === 'http:' &&
         ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('UNTRUSTED_LUTH_WORKLOAD_ISSUER');
  }
  return url.origin;
}

export function createConfidentialLuthWorkloadClient(identity: LuthWorkloadIdentity) {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(identity.appId) ||
      !/^[A-Za-z0-9._~-]{3,200}$/.test(identity.clientId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(identity.keyId) ||
      identity.privateKeyJwk?.kty !== 'RSA' ||
      typeof identity.privateKeyJwk.d !== 'string') {
    throw new Error('UNPROVISIONED_CONFIDENTIAL_WORKLOAD');
  }
  const origin = pinnedOrigin(identity.issuerOrigin);
  const fetcher = identity.fetcher ?? fetch;
  const scope = 'config:read';

  async function request(input: URL, init: RequestInit): Promise<Response> {
    if (input.origin !== origin) throw new Error('UNTRUSTED_LUTH_WORKLOAD_ENDPOINT');
    try {
      return await fetcher(input, {
        ...init, cache: 'no-store', redirect: 'error', credentials: 'omit',
      });
    } catch {
      throw new Error('LUTH_WORKLOAD_UNAVAILABLE');
    }
  }

  async function discover(): Promise<void> {
    const url = new URL('/api/discovery/v1', origin);
    url.searchParams.set('app_id', identity.appId);
    const response = await request(url, { method: 'GET' });
    if (!response.ok) throw new Error('LUTH_WORKLOAD_DISCOVERY_UNAVAILABLE');
    const data = parseUniversalDiscoveryV1(
      await response.json(), identity.appId, origin,
    );
    if (!data.capabilities.trustedWorkloads) {
      throw new Error('WORKLOAD_REGISTRATION_NOT_ENABLED');
    }
  }

  async function signClientAssertion(tokenEndpoint: string): Promise<string> {
    const key = await crypto.subtle.importKey('jwk', identity.privateKeyJwk, {
      name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256',
    }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: identity.keyId };
    const claim = {
      iss: identity.clientId, sub: identity.clientId, aud: tokenEndpoint,
      iat: now, nbf: now, exp: now + 60,
      jti: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24))),
    };
    const encode = (data: unknown) =>
      bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
    const input = encode(header) + '.' + encode(claim);
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input),
    );
    return input + '.' + bytesToBase64Url(new Uint8Array(signature));
  }

  /** Fresh per-invocation token; never persist a bearer or return it to UI. */
  async function configuration(): Promise<LuthWorkloadConfiguration> {
    await discover();
    const tokenEndpoint = new URL('/api/auth/oauth2/token', origin);
    const assertion = await signClientAssertion(tokenEndpoint.toString());
    const response = await request(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: identity.clientId,
        scope, client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }),
    });
    if (!response.ok) throw new Error('WORKLOAD_TOKEN_GRANT_REJECTED');
    const token = asRecord(await response.json());
    if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' ||
        !/^[A-Za-z0-9._~-]{16,2048}$/.test(token.access_token) ||
        typeof token.expires_in !== 'number' ||
        token.expires_in <= 0 || token.expires_in > 3600) {
      throw new Error('WORKLOAD_TOKEN_RESPONSE_REJECTED');
    }
    const endpoint = new URL('/api/config/workload/v1', origin);
    endpoint.searchParams.set('app_id', identity.appId);
    const config = await request(endpoint, {
      method: 'GET', headers: { authorization: 'Bearer ' + token.access_token },
    });
    if (config.status === 401 || config.status === 403) {
      throw new Error('WORKLOAD_CONFIGURATION_AUTHORIZATION_DENIED');
    }
    if (!config.ok) throw new Error('WORKLOAD_CONFIGURATION_UNAVAILABLE');
    return parseWorkloadConfig(await config.json(), identity.appId, identity.clientId);
  }

  return { configuration };
}
