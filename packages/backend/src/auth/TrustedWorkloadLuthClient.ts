import * as GutTSAuth from '@dinilmusick/gutts/auth';
import { createUniversalLuthRuntimeService } from './UniversalLuthInitialization.js';
import {
  signPrivateKeyJwtClientAssertion,
  type WorkloadAssertionSigner,
} from './WorkloadJwtAssertion.js';

export interface TrustedWorkloadLuthOptions extends WorkloadAssertionSigner {
  appId: string;
  luthOrigin: string;
  /** For independently testable environments, never a browser user fetcher. */
  fetcher?: typeof fetch;
}
export interface TrustedWorkloadConfiguration {
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

/**
 * Each invocation discovers via GutTS, signs a new client assertion, acquires
 * a scoped OAuth token through Better Auth, and requests no-store machine
 * configuration. No token, key or confidential client secret is returned.
 *
 * Production requires an operator-enrolled client bound to an authorized
 * app_id, JWKS and origin. No runtime derives privilege from APP_URL alone.
 */
export function createTrustedWorkloadLuthClient(
  options: TrustedWorkloadLuthOptions,
): { getConfiguration(): Promise<TrustedWorkloadConfiguration> } {
  const origin = new URL(options.luthOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== options.luthOrigin ||
      origin.pathname !== '/' || origin.username || origin.password ||
      origin.search || origin.hash) {
    throw new Error('UNTRUSTED_LUTH_WORKLOAD_ISSUER');
  }
  const network = options.fetcher ?? fetch;
  const discovery = createUniversalLuthRuntimeService({
    appId: options.appId,
    runtime: 'server',
    issuerOrigin: origin.origin,
    discoveryUrl: origin.origin + '/api/discovery/v1',
    fetcher: network,
  });
  return {
    async getConfiguration() {
      const document = await discovery.discover();
      const configUrl = (document as { workloadConfigurationUrl?: unknown })
        .workloadConfigurationUrl;
      if (!document.capabilities.trustedWorkloads ||
          typeof configUrl !== 'string') {
        throw new Error('WORKLOAD_REGISTRATION_NOT_AVAILABLE');
      }
      const endpoint = new URL(configUrl);
      if (endpoint.origin !== origin.origin ||
          endpoint.pathname !== '/api/config/workload/v1' ||
          endpoint.username || endpoint.password || endpoint.hash ||
          endpoint.search) {
        throw new Error('UNTRUSTED_WORKLOAD_CONFIGURATION_ENDPOINT');
      }
      const tokenEndpoint = origin.origin + '/api/auth/oauth2/token';
      const assertion = await signPrivateKeyJwtClientAssertion(options, tokenEndpoint);
      const tokenResponse = await network(tokenEndpoint, {
        method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: options.clientId,
          scope: 'config:read',
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion,
        }),
      });
      if (!tokenResponse.ok) throw new Error('WORKLOAD_AUTHENTICATION_DENIED');
      const token = await tokenResponse.json() as Record<string, unknown>;
      if (token.token_type !== 'Bearer' ||
          typeof token.access_token !== 'string' ||
          !/^[A-Za-z0-9._~-]{16,2048}$/.test(token.access_token) ||
          typeof token.expires_in !== 'number' ||
          !Number.isFinite(token.expires_in) ||
          token.expires_in <= 0 || token.expires_in > 3600 ||
          typeof token.scope !== 'string' ||
          !token.scope.split(' ').includes('config:read')) {
        throw new Error('INVALID_WORKLOAD_TOKEN_RESPONSE');
      }
      endpoint.searchParams.set('app_id', options.appId);
      const response = await network(endpoint, {
        method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { authorization: 'Bearer ' + token.access_token,
          accept: 'application/json' },
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('WORKLOAD_AUTHORIZATION_DENIED');
        }
        throw new Error('WORKLOAD_CONFIGURATION_UNAVAILABLE');
      }
      const parser = (GutTSAuth as unknown as {
        parseUniversalWorkloadConfigurationV1?: (
          value: unknown, appId: string, clientId: string,
        ) => TrustedWorkloadConfiguration;
      }).parseUniversalWorkloadConfigurationV1;
      if (typeof parser !== 'function') {
        throw new Error('UNIVERSAL_WORKLOAD_CONTRACT_UNAVAILABLE');
      }
      return parser(await response.json(), options.appId, options.clientId);
    },
  };
}
