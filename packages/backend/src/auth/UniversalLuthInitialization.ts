import {
  createUniversalInitializationClient,
  type UniversalBootstrapOptions,
  type UniversalConfigurationV1,
  type UniversalDiscoveryV1,
  type UniversalAuthReadiness,
} from '@dinilmusick/gutts/auth';

/**
 * Canonical Kloks service for public discovery and least-privilege user
 * configuration. All schema validation, issuer pinning and retries live in
 * GutTS; this runtime adapter does not recreate the identity protocol.
 *
 * This is NOT a way to fetch OAuth client secrets, BFF encryption keys, or
 * database credentials. The existing OIDC BFF keeps its protected bootstrap
 * until authenticated confidential workload provisioning is implemented.
 */
export interface UniversalLuthRuntimeAdapter {
  runtime: UniversalBootstrapOptions['runtime'];
  appId: string;
  /** Existing Luth issuer origin; pinned before accepting discovery URLs. */
  issuerOrigin: string;
  /** Adapter may supply verified session cookies or OAuth bearer transport. */
  authorizationHeaders?: () => Promise<HeadersInit>;
  /** Injectable URL for local and integration fixtures only. */
  discoveryUrl?: string;
  fetcher?: typeof fetch;
  onStateChange?: (state: UniversalAuthReadiness) => void;
}

export interface UniversalLuthRuntimeService {
  discover(): Promise<UniversalDiscoveryV1>;
  getConfiguration(): Promise<UniversalConfigurationV1>;
  invalidate(): void;
  readonly readiness: UniversalAuthReadiness;
}

/** Runtime privilege is never inferred from app ID or APP_URL. */
export function createUniversalLuthRuntimeService(
  adapter: UniversalLuthRuntimeAdapter,
): UniversalLuthRuntimeService {
  if (adapter.runtime === 'headless') {
    // This requires a separately verified workload identity, not an
    // environment-string identity or a public caller-provided header.
    throw new Error('VERIFIED_WORKLOAD_AUTHENTICATION_REQUIRED');
  }
  const client = createUniversalInitializationClient(
    { appId: adapter.appId, runtime: adapter.runtime,
      ...(adapter.discoveryUrl ? { discoveryUrl: adapter.discoveryUrl } : {}) },
    {
      expectedIssuerOrigin: adapter.issuerOrigin,
      ...(adapter.authorizationHeaders ? { authorize: adapter.authorizationHeaders } : {}),
      ...(adapter.fetcher ? { fetcher: adapter.fetcher } : {}),
      ...(adapter.onStateChange ? { onStateChange: adapter.onStateChange } : {}),
    },
  );
  return {
    discover: () => client.discover(),
    getConfiguration: () => client.configuration(),
    invalidate: () => client.invalidate(),
    get readiness() { return client.readiness; },
  };
}
