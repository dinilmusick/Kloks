import * as PortableLuthAuth from '@dinilmusick/gutts/auth';

/** Structural invocation type only. The actual wire validator lives in GutTS. */
type UniversalRuntimeKind =
  | 'browser' | 'cloudflare-worker' | 'serverless' | 'server'
  | 'desktop' | 'android' | 'ios' | 'headless';
type UniversalAuthReadiness =
  | 'discovery' | 'unauthenticated' | 'authenticating' | 'authenticated'
  | 'configuring' | 'ready' | 'denied' | 'unavailable';
interface UniversalDiscoveryV1 {
  application: { appId: string; ecosystemId: string; name: string };
  issuer: string;
  configurationUrl: string;
}
interface UniversalConfigurationV1 {
  application: { appId: string; ecosystemId: string; name: string };
  principal: { userId: string };
  settings: { supportedServices: string[] };
}
interface PortableClient {
  discover(): Promise<UniversalDiscoveryV1>;
  configuration(): Promise<UniversalConfigurationV1>;
  invalidate(): void;
  readonly readiness: UniversalAuthReadiness;
}
type PortableClientFactory = (
  bootstrap: { appId: string; runtime: UniversalRuntimeKind; discoveryUrl?: string },
  transport: {
    expectedIssuerOrigin: string;
    authorize?: () => Promise<HeadersInit>;
    fetcher?: typeof fetch;
    onStateChange?: (state: UniversalAuthReadiness) => void;
  },
) => PortableClient;

function requiredGutTSFactory(): PortableClientFactory {
  const source = PortableLuthAuth as Record<string, unknown>;
  const factory = source.createUniversalInitializationClient;
  if (typeof factory !== 'function') {
    throw new Error('UNIVERSAL_INITIALIZATION_CONTRACT_UNAVAILABLE');
  }
  // No fallback to untrusted app URL, custom credential source or raw SQL.
  return factory as PortableClientFactory;
}

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
  runtime: UniversalRuntimeKind;
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
  const client = requiredGutTSFactory()(
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
