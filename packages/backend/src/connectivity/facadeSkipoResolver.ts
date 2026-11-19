/**
 * Server-only adapter for Skipo PR #208's createVerifiedCapabilityDiscovery
 * (list/resolve/revalidate), plus independent trusted registrar lease proof.
 *
 * The Skipo discovery return intentionally contains NO lease expiry or
 * authenticated workspace owner. Those must come from a distinct trusted
 * registrar, never invented from descriptor metadata or caller-supplied URLs.
 */
import type { FacadeRemoteClientOptions, RemoteFacadeOperation, VerifiedFacadeDeployment } from './facadeRemoteClient.js';

export type SkipoEnvironment = 'development' | 'preview' | 'staging' | 'production';
export interface SkipoCapabilitySelector {
  appId: string;
  capabilityId: string;
  environment: SkipoEnvironment;
  revision?: number;
  /** Skipo #208 target-specific revalidation must match this deployment UUID. */
  deploymentId?: string;
}
export interface SkipoResolvedCapability {
  deploymentId: string;
  url: string;
  revision: number;
  descriptor: {
    id: string;
    description: string;
    invocation: { serviceId: string; operationId: string };
    [field: string]: unknown;
  };
}
export interface SkipoVerifiedDiscovery {
  list(request: Request, appId: string, environment: SkipoEnvironment):
    Promise<SkipoResolvedCapability[]>;
  resolve(request: Request, selector: SkipoCapabilitySelector):
    Promise<SkipoResolvedCapability | null>;
  revalidate(request: Request, selector: SkipoCapabilitySelector):
    Promise<SkipoResolvedCapability | null>;
}
export interface SkipoTrustedLease {
  appId: string;
  deploymentId: string;
  workspaceId: string;
  environment: SkipoEnvironment;
  origin: string;
  leaseExpiresAt: number;
  verified: boolean;
}
export interface SkipoFacadeResolverOptions {
  environment: SkipoEnvironment;
  /** Exact Skipo createVerifiedCapabilityDiscovery return; uses live Luth/grants. */
  discovery: SkipoVerifiedDiscovery;
  /** A server-authenticated Request; never copied from untrusted graph/input JSON. */
  getAuthenticatedRequest: (
    appId: string, workspaceId: string, signal: AbortSignal,
  ) => Promise<Request>;
  /**
   * Registrar-only read of current attested app/deployment ownership, workspace,
   * environment, exact HTTPS origin, proof state, and unexpired renewable lease.
   * Ordinary Skipo heartbeats or the discovery row cannot attest this result.
   */
  inspectAttestedLease: (
    appId: string, workspaceId: string, found: Readonly<SkipoResolvedCapability>,
    signal: AbortSignal,
  ) => Promise<SkipoTrustedLease | null>;
  now?: () => number;
}
const validApp = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
const validHandle = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
  !value.includes('..') && !['__proto__', 'prototype', 'constructor'].some(x => value.includes(x));
const validUUID = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * A registry revision is a canonical positive integer. Do not accept "v1",
 * "01", exponent notation or best-match fallbacks for an immutable operation.
 */
function parseRevision(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const revision = Number(value);
  return isRevision(revision) && String(revision) === value ? revision : null;
}

export function createSkipoFacadeDeploymentResolver(options: SkipoFacadeResolverOptions):
  FacadeRemoteClientOptions['resolveDeployment'] {
  if (!['development', 'preview', 'staging', 'production'].includes(options.environment) ||
      !options.discovery ||
      !['list', 'resolve', 'revalidate'].every(k =>
        typeof options.discovery[k as keyof SkipoVerifiedDiscovery] === 'function') ||
      typeof options.getAuthenticatedRequest !== 'function' ||
      typeof options.inspectAttestedLease !== 'function') {
    throw new Error('Live Luth-bound Skipo discovery and trusted registrar lease authority are required');
  }
  const now = options.now ?? Date.now;
  return async function resolveDeployment(
    appId: string, workspaceId: string, operation: RemoteFacadeOperation | undefined,
    signal: AbortSignal, expectedDeploymentId?: string,
  ): Promise<VerifiedFacadeDeployment | null> {
    if (signal.aborted || !validApp(appId) || !validHandle(workspaceId) ||
        operation?.kind === 'workflow' ||
        (expectedDeploymentId !== undefined && !validUUID(expectedDeploymentId)) ||
        (operation && (!validHandle(operation.id) || !parseRevision(operation.version)))) return null;
    try {
      const request = await options.getAuthenticatedRequest(appId, workspaceId, signal);
      if (signal.aborted || !(request instanceof Request)) return null;
      const selector = operation && {
        appId, capabilityId: operation.id, environment: options.environment,
        revision: parseRevision(operation.version)!,
        ...(expectedDeploymentId ? { deploymentId: expectedDeploymentId } : {}),
      };
      // list() is already Luth-bound, grant-filtered and exact-current in Skipo.
      // Invocation MUST use revalidate(), never an earlier discovery cache.
      const rows = selector
        ? [await options.discovery.revalidate(request, selector)]
        : await options.discovery.list(request, appId, options.environment);
      if (signal.aborted || !Array.isArray(rows) || rows.length === 0 || rows.length > 256) return null;
      for (const found of rows) {
        if (!found || !validUUID(found.deploymentId) ||
            (expectedDeploymentId !== undefined && found.deploymentId !== expectedDeploymentId) ||
            !isRevision(found.revision) ||
            !found.descriptor || !validHandle(found.descriptor.id) ||
            !found.descriptor.invocation || !validHandle(found.descriptor.invocation.serviceId) ||
            !validHandle(found.descriptor.invocation.operationId) ||
            typeof found.url !== 'string' ||
            (selector && (found.descriptor.id !== selector.capabilityId ||
              found.revision !== selector.revision))) continue;
        const lease = await options.inspectAttestedLease(appId, workspaceId, found, signal);
        if (signal.aborted || !lease || lease.verified !== true ||
            lease.appId !== appId || lease.workspaceId !== workspaceId ||
            lease.deploymentId !== found.deploymentId ||
            lease.environment !== options.environment ||
            lease.origin !== found.url ||
            !Number.isFinite(lease.leaseExpiresAt) || lease.leaseExpiresAt <= now()) continue;
        return {
          appId, deploymentId: found.deploymentId, workspaceId,
          environment: options.environment, origin: lease.origin,
          leaseExpiresAt: lease.leaseExpiresAt, verified: true,
        };
      }
      return null;
    } catch {
      // A registry error, revoked proof or policy failure cannot fall back to
      // legacy findDeployment(), a URL or an unverified capability descriptor.
      return null;
    }
  };
}
