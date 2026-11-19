/**
 * Target application FOD workflow deployment authority.
 *
 * An owner-published FOD workflow is not a Skipo static capability, so it
 * must not be resolved through deployment_capability_revisions. The existing
 * FOD owner/grant authority resolves the *exact* current workflow reference;
 * Skipo's trusted registrar independently proves the host's deployment UUID,
 * HTTPS origin, target workspace, environment and live lease. Only metadata
 * and an attested host leave this adapter: never private FOD graph definitions.
 */
import type {
  FacadeRemoteClientOptions, RemoteFacadeOperation, VerifiedFacadeDeployment,
} from './facadeRemoteClient.js';
import type { SkipoEnvironment, SkipoTrustedLease } from './facadeSkipoResolver.js';

export interface FodCurrentPublishedReference {
  appId: string;
  targetWorkspaceId: string;
  operationId: string;
  workflowId: string;
  version: string;
}

export interface FodVerifiedHostingCandidate {
  appId: string;
  deploymentId: string;
  origin: string;
}

export interface FodWorkflowDeploymentAuthorityOptions {
  environment: SkipoEnvironment;
  /**
   * Host-owned FOD publication + Luth owner/source/target workspace grant lookup.
   * MUST reauthorize exact current revision for each lookup. Never trust a
   * graph-provided user, owner, workspace grant or publication status.
   */
  authorizeCurrentWorkflow: (
    appId: string, targetWorkspaceId: string,
    operation: Readonly<RemoteFacadeOperation>, signal: AbortSignal,
  ) => Promise<FodCurrentPublishedReference | null>;
  /**
   * Skipo trusted server-side deployment locator: not the static capability
   * registry, APP_URL, browser state, URL parameter or an unverified ticket.
   */
  locateVerifiedWorkflowHost: (
    reference: Readonly<FodCurrentPublishedReference>, environment: SkipoEnvironment,
    signal: AbortSignal, expectedDeploymentId?: string,
  ) => Promise<FodVerifiedHostingCandidate | null>;
  /** Current registrar proof/lease, queried with a distinct privileged read. */
  inspectAttestedLease: (
    reference: Readonly<FodCurrentPublishedReference>,
    candidate: Readonly<FodVerifiedHostingCandidate>,
    environment: SkipoEnvironment, signal: AbortSignal,
  ) => Promise<SkipoTrustedLease | null>;
  now?: () => number;
}
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
  !value.includes('..') && !['__proto__', 'prototype', 'constructor'].some(x => value.includes(x));
const validApp = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export function createFodWorkflowDeploymentResolver(
  options: FodWorkflowDeploymentAuthorityOptions,
): NonNullable<FacadeRemoteClientOptions['resolveWorkflowDeployment']> {
  if (!['development', 'preview', 'staging', 'production'].includes(options.environment) ||
      typeof options.authorizeCurrentWorkflow !== 'function' ||
      typeof options.locateVerifiedWorkflowHost !== 'function' ||
      typeof options.inspectAttestedLease !== 'function') {
    throw new Error('FOD current grant, verified Skipo hosting and registrar lease authorities are mandatory');
  }
  const now = options.now ?? Date.now;
  return async function resolveWorkflowDeployment(
    appId: string, workspaceId: string, operation: RemoteFacadeOperation,
    signal: AbortSignal, expectedDeploymentId?: string,
  ): Promise<VerifiedFacadeDeployment | null> {
    if (signal.aborted || !validApp(appId) || !id(workspaceId) ||
        !operation || operation.kind !== 'workflow' ||
        !id(operation.id) || !id(operation.version) ||
        (expectedDeploymentId !== undefined && !uuid(expectedDeploymentId))) return null;
    try {
      const permitted = await options.authorizeCurrentWorkflow(appId, workspaceId, operation, signal);
      if (signal.aborted || !permitted ||
          permitted.appId !== appId || permitted.targetWorkspaceId !== workspaceId ||
          permitted.operationId !== operation.id || permitted.version !== operation.version ||
          !id(permitted.workflowId)) return null;
      const reference: FodCurrentPublishedReference = Object.freeze({
        appId, targetWorkspaceId: workspaceId,
        operationId: operation.id, version: operation.version,
        workflowId: permitted.workflowId,
      });
      const candidate = await options.locateVerifiedWorkflowHost(
        reference, options.environment, signal, expectedDeploymentId,
      );
      if (signal.aborted || !candidate || candidate.appId !== appId ||
          !uuid(candidate.deploymentId) || typeof candidate.origin !== 'string' ||
          (expectedDeploymentId !== undefined && candidate.deploymentId !== expectedDeploymentId)) {
        return null;
      }
      const fixed: FodVerifiedHostingCandidate = Object.freeze({ ...candidate });
      const proof = await options.inspectAttestedLease(reference, fixed, options.environment, signal);
      if (signal.aborted || !proof || proof.verified !== true ||
          proof.appId !== appId || proof.workspaceId !== workspaceId ||
          proof.deploymentId !== fixed.deploymentId ||
          proof.environment !== options.environment || proof.origin !== fixed.origin ||
          !Number.isFinite(proof.leaseExpiresAt) || proof.leaseExpiresAt <= now()) return null;
      return {
        appId, workspaceId, deploymentId: fixed.deploymentId, origin: fixed.origin,
        environment: options.environment, leaseExpiresAt: proof.leaseExpiresAt, verified: true,
      };
    } catch {
      // An error or unavailable FOD/Skipo/Luth authority is NEVER a fallback to
      // static capability discovery, APP_URL, a sibling workspace or old host.
      return null;
    }
  };
}
