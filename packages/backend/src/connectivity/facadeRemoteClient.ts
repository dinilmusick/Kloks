/**
 * Caller-side wire adapter for the canonical target-owned BackendFacade boundary.
 * Skipo decides the deployment and Luth mints audience-bound credentials.
 * This adapter does not create a second operation authority or retry side effects.
 */
import { FacadeInvocationDenied, assertFacadeJsonInput, type FacadeInvocation, type FacadeHandleKind } from './facadeInvocation.js';

export interface VerifiedFacadeDeployment {
  readonly appId: string;
  readonly deploymentId: string;
  readonly workspaceId: string;
  readonly environment: string;
  /** An exact HTTPS origin (not a caller-controlled path or URL). */
  readonly origin: string;
  readonly leaseExpiresAt: number;
  /** Must come from the authoritative, ownership-attested Skipo lookup. */
  readonly verified: true;
}

export interface RemoteFacadeOperation {
  readonly id: string;
  readonly version: string;
  /** Trusted caller-side selector: FOD grants are not Skipo static capabilities. */
  readonly kind?: 'static' | 'workflow';
}

export interface FacadeRemoteClientOptions {
  readonly environment: string;
  /** Must attest ownership, active lease, operation/version eligibility and environment. */
  readonly resolveDeployment: (
    appId: string, workspaceId: string, operation: RemoteFacadeOperation | undefined,
    signal: AbortSignal,
    /** Pin to the exact deployment UUID already attested for this request. */
    expectedDeploymentId?: string,
  ) => Promise<VerifiedFacadeDeployment | null>;
  /**
   * Separate FOD owning-workspace publication/grant + Skipo host-lease path.
   * MUST reauthorize the exact published revision and target before every call.
   * Never fall back from a failed static selector or from a missing workflow grant.
   */
  readonly resolveWorkflowDeployment?: (
    appId: string, workspaceId: string, operation: RemoteFacadeOperation,
    signal: AbortSignal, expectedDeploymentId?: string,
  ) => Promise<VerifiedFacadeDeployment | null>;
  /** Host allowlist/registry proof. DNS/egress policy must also restrict reachable hosts. */
  readonly approveOrigin: (origin: string, deployment: VerifiedFacadeDeployment) => Promise<boolean>;
  /** Ask Luth for a live audience-bound bearer on *each* request, never from caller JSON. */
  readonly getAudienceBearer: (
    deployment: VerifiedFacadeDeployment, operation: RemoteFacadeOperation | undefined,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly maxRequestMs?: number;
  readonly now?: () => number;
}

export interface RemoteFacadeResult {
  output: unknown;
  invocationId: string;
}

/** Only stable, caller-authorized metadata leaves the owning application. */
export interface RemoteFacadeDescriptor {
  id: string;
  name: string;
  version: string;
  kind: FacadeHandleKind;
  targetWorkspaceId: string;
}

/** Persistable static operation identity, pinned to its verified Skipo instance. */
export interface PinnedRemoteFacadeDescriptor extends RemoteFacadeDescriptor {
  readonly kind: 'static';
  readonly appId: string;
  readonly deploymentId: string;
  readonly environment: string;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && idPattern.test(value) &&
  !value.includes('..') && !['__proto__', 'constructor', 'prototype'].some(v => value.includes(v));
const tokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;
const deploymentUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const denied = (code: string, status: number): never => { throw new FacadeInvocationDenied(code, status); };

function approvedHttpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    // URL canonicalisation is intentional: reject embedded credentials, ports,
    // paths, query, fragment, IP literals and obfuscated special hostnames.
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.port === '' && url.pathname === '/' && !url.search && !url.hash &&
      value === url.origin && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) &&
      !/^\d+(?:\.\d+)+$/.test(host) &&
      !/\.(?:localhost|local|internal|test|invalid)$/.test(host);
  } catch { return false; }
}

function requireInvocation(request: FacadeInvocation) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(k => !['operationId', 'version', 'targetWorkspaceId', 'invocationId', 'input'].includes(k)) ||
      ![request.operationId, request.version, request.targetWorkspaceId, request.invocationId].every(validId) ||
      !own(request, 'input')) denied('MALFORMED_HANDLE', 400);
}

function matchDeployment(before: VerifiedFacadeDeployment, after: VerifiedFacadeDeployment | null, now: number) {
  return !!after && after.verified === true && after.appId === before.appId &&
    after.deploymentId === before.deploymentId && after.workspaceId === before.workspaceId &&
    after.environment === before.environment && after.origin === before.origin &&
    Number.isFinite(after.leaseExpiresAt) && after.leaseExpiresAt > now;
}

export function createFacadeRemoteClient(options: FacadeRemoteClientOptions) {
  if (!validId(options.environment) || typeof options.resolveDeployment !== 'function' ||
      typeof options.approveOrigin !== 'function' || typeof options.getAudienceBearer !== 'function') {
    throw new Error('Verified Skipo resolution, origin attestation and Luth delegation are required');
  }
  const maxRequestMs = options.maxRequestMs ?? 30_000;
  if (!Number.isSafeInteger(maxRequestMs) || maxRequestMs < 1 || maxRequestMs > 30_000) {
    throw new Error('Invalid bounded cross-app timeout');
  }
  const now = options.now ?? Date.now;
  const transport = options.fetch ?? fetch;

  async function exchange(
    appId: string, workspaceId: string, operation: RemoteFacadeOperation | undefined,
    method: 'GET' | 'POST', payload: FacadeInvocation | undefined,
    signal?: AbortSignal, deadlineAt?: number,
    expectedDeploymentId?: string, pinnedCatalog = false,
  ): Promise<{ body: unknown; deployment: VerifiedFacadeDeployment }> {
    if (!validId(appId) || !validId(workspaceId) ||
        (expectedDeploymentId !== undefined && !deploymentUuid.test(expectedDeploymentId)) ||
        (operation && (!validId(operation.id) || !validId(operation.version)))) {
      denied('MALFORMED_HANDLE', 400);
    }
    // Workflow authority is intentionally separate from verified static APIs.
    // A missing FOD authority is a denial, not a fallback to a static method.
    const workflow = operation?.kind === 'workflow' ? operation : undefined;
    if (workflow && !options.resolveWorkflowDeployment) denied('WORKFLOW_AUTHORITY_REQUIRED', 503);
    const resolver: FacadeRemoteClientOptions['resolveDeployment'] = workflow
      ? (a, w, _operation, s, pinned) => options.resolveWorkflowDeployment!(a, w, workflow, s, pinned)
      : options.resolveDeployment;
    const end = Math.min(now() + maxRequestMs, deadlineAt ?? Infinity);
    if (!Number.isFinite(end) || end <= now()) denied('DEADLINE_EXCEEDED', 408);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let deadlineExceeded = false;
    const abortError = () => new FacadeInvocationDenied(deadlineExceeded ? 'DEADLINE_EXCEEDED' : 'CANCELLED', 408);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const stopped = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      timeout = setTimeout(() => { deadlineExceeded = true; controller.abort(); }, Math.max(1, end - now()));
      if (controller.signal.aborted) reject(abortError());
    });
    const perform = async () => {
      if (controller.signal.aborted) throw abortError();
      const resolved = await resolver(appId, workspaceId, operation, controller.signal, expectedDeploymentId);
      const deployment = resolved && Object.freeze({ ...resolved });
      if (!deployment || deployment.verified !== true || deployment.appId !== appId ||
          (expectedDeploymentId !== undefined && deployment.deploymentId !== expectedDeploymentId) ||
          deployment.workspaceId !== workspaceId || deployment.environment !== options.environment ||
          !validId(deployment.deploymentId) || !Number.isFinite(deployment.leaseExpiresAt) ||
          deployment.leaseExpiresAt <= now() || !approvedHttpsOrigin(deployment.origin) ||
          !await options.approveOrigin(deployment.origin, deployment)) denied('DEPLOYMENT_UNAVAILABLE', 503);
      if (controller.signal.aborted) throw abortError();
      const bearer = await options.getAudienceBearer(deployment, operation, controller.signal);
      if (typeof bearer !== 'string' || bearer.length === 0 || bearer.length > 8192 ||
          !tokenPattern.test(bearer)) denied('AUTH_INVALID', 401);
      if (controller.signal.aborted) throw abortError();
      // Credential issuance may block. Do not send a minted one-use bearer to
      // a deployment whose ownership, origin or lease changed during minting.
      const beforeSend = await resolver(
        appId, workspaceId, operation, controller.signal, deployment.deploymentId,
      );
      if (!matchDeployment(deployment, beforeSend, now()) ||
          !await options.approveOrigin(beforeSend!.origin, beforeSend!)) {
        denied('DEPLOYMENT_REVOKED', 503);
      }
      if (controller.signal.aborted) throw abortError();
      const suffix = method === 'GET'
        ? '/api/crossapp/operations?workspace=' + encodeURIComponent(workspaceId)
        : '/api/crossapp/invoke';
      let response: Response;
      try {
        response = await transport(deployment.origin + suffix, {
          method,
          headers: {
            Authorization: 'Bearer ' + bearer,
            Accept: 'application/json',
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: controller.signal,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
      } catch {
        if (controller.signal.aborted) throw abortError();
        // An unknown transport failure does NOT prove non-delivery. Never retry.
        denied('REMOTE_TRANSPORT_FAILED', 502);
      }
      if (controller.signal.aborted) throw abortError();
      // Bound actual received bytes, not only a possibly forged Content-Length.
      // Streaming also stops oversized responses before buffering them in memory.
      const declared = response.headers.get('content-length');
      if (declared !== null && Number(declared) > 1_048_576) {
        denied('REMOTE_RESPONSE_TOO_LARGE', 502);
      }
      if (!response.body) denied('INVALID_REMOTE_RESPONSE', 502);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytesRead = 0;
      let finished = false;
      try {
        while (true) {
          if (controller.signal.aborted) throw abortError();
          const { done, value } = await reader.read();
          if (done) { finished = true; break; }
          bytesRead += value.byteLength;
          if (bytesRead > 1_048_576) denied('REMOTE_RESPONSE_TOO_LARGE', 502);
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof FacadeInvocationDenied) throw error;
        if (controller.signal.aborted) throw abortError();
        denied('INVALID_REMOTE_RESPONSE', 502);
      } finally {
        if (!finished) void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(bytesRead);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { denied('INVALID_REMOTE_RESPONSE', 502); }
      if (!response.ok) {
        const value = body && typeof body === 'object' && !Array.isArray(body) &&
          own(body, 'error') ? (body as { error?: unknown }).error : undefined;
        const code = typeof value === 'string' && /^[A-Z_]{3,64}$/.test(value)
          ? value : 'REMOTE_DENIED';
        denied(code, response.status >= 400 && response.status < 600 ? response.status : 502);
      }
      // A Skipo lease or deployment mapping can be revoked during a long call.
      const latest = await resolver(
        appId, workspaceId, operation, controller.signal, deployment.deploymentId,
      );
      if (!matchDeployment(deployment, latest, now()) || !await options.approveOrigin(latest!.origin, latest!)) {
        denied('DEPLOYMENT_REVOKED', 503);
      }
      if (controller.signal.aborted) throw abortError();
      if (pinnedCatalog) {
        // Discovery is only authoritative for operations approved by BOTH
        // current Skipo registry and target owner ACL. A verified host alone
        // is not permission to advertise every operation it can execute.
        const entries = decodeOperations(body, workspaceId)
          .filter(entry => entry.kind === 'static');
        if (entries.length > 64) denied('CATALOG_TOO_LARGE', 503);
        const visible: RemoteFacadeDescriptor[] = [];
        for (const entry of entries) {
          if (controller.signal.aborted) throw abortError();
          const found = await resolver(appId, workspaceId, {
            id: entry.id, version: entry.version, kind: 'static',
          }, controller.signal, deployment.deploymentId);
          if (!matchDeployment(deployment, found, now())) continue;
          if (!await options.approveOrigin(found!.origin, found!)) continue;
          if (controller.signal.aborted) throw abortError();
          visible.push(entry);
        }
        return { body: { operations: visible }, deployment };
      }
      return { body, deployment };
    };
    try { return await Promise.race([perform(), stopped]); }
    finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  function decodeOperations(result: unknown, targetWorkspaceId: string): RemoteFacadeDescriptor[] {
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        !Array.isArray((result as { operations?: unknown }).operations)) denied('INVALID_REMOTE_RESPONSE', 502);
    const operations = (result as { operations: unknown[] }).operations;
    if (operations.length > 1000) denied('INVALID_REMOTE_RESPONSE', 502);
    return operations.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) denied('INVALID_REMOTE_RESPONSE', 502);
      const op = value as Record<string, unknown>;
      if (!validId(op.id) || !validId(op.version) || op.targetWorkspaceId !== targetWorkspaceId ||
          !['static', 'workflow'].includes(String(op.kind)) ||
          typeof op.name !== 'string' || op.name.length > 160) denied('INVALID_REMOTE_RESPONSE', 502);
      return {
        id: op.id as string, name: op.name as string, version: op.version as string,
        kind: op.kind as FacadeHandleKind, targetWorkspaceId,
      };
    });
  }

  async function discover(targetAppId: string, targetWorkspaceId: string, signal?: AbortSignal, deadlineAt?: number): Promise<RemoteFacadeDescriptor[]> {
    const { body } = await exchange(targetAppId, targetWorkspaceId, undefined, 'GET', undefined, signal, deadlineAt);
    return decodeOperations(body, targetWorkspaceId);
  }

  /** Authorized catalog entries with a durable, exact deployment identity. */
  async function discoverPinned(targetAppId: string, targetWorkspaceId: string,
    signal?: AbortSignal, deadlineAt?: number): Promise<PinnedRemoteFacadeDescriptor[]> {
    const { body, deployment } = await exchange(
      targetAppId, targetWorkspaceId, undefined, 'GET', undefined, signal,
      deadlineAt, undefined, true,
    );
    if (!deploymentUuid.test(deployment.deploymentId)) denied('DEPLOYMENT_UNAVAILABLE', 503);
    return decodeOperations(body, targetWorkspaceId)
      .filter((operation): operation is RemoteFacadeDescriptor & { kind: 'static' } => operation.kind === 'static')
      .map(operation => ({ ...operation, appId: deployment.appId,
        deploymentId: deployment.deploymentId, environment: deployment.environment }));
  }

  async function invoke(targetAppId: string, request: FacadeInvocation,
    signal?: AbortSignal, deadlineAt?: number, expectedDeploymentId?: string): Promise<RemoteFacadeResult> {
    requireInvocation(request);
    // Deep snapshot before any async Skipo/Luth lookup, so a graph caller cannot
    // change the authorized operation, workspace or input while a proof is minted.
    let input: unknown;
    try { input = structuredClone(request.input); }
    catch { denied('MALFORMED_INPUT', 400); }
    assertFacadeJsonInput(input);
    const captured = {
      operationId: request.operationId, version: request.version,
      targetWorkspaceId: request.targetWorkspaceId, invocationId: request.invocationId, input,
    };
    // The wire envelope itself counts toward the target's one-MiB body cap.
    assertFacadeJsonInput(captured);
    const operation = { id: captured.operationId, version: captured.version };
    const { body } = await exchange(targetAppId, captured.targetWorkspaceId, operation,
      'POST', captured, signal, deadlineAt, expectedDeploymentId);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !own(body, 'output') || (body as Record<string, unknown>).invocationId !== captured.invocationId) {
      denied('CORRELATION_MISMATCH', 502);
    }
    // Target-provided replyTo is deliberately NOT exposed as routing authority.
    // The verified local ImmediateCallerRouter already owns return destinations.
    return { output: (body as { output: unknown }).output, invocationId: captured.invocationId };
  }

  /**
   * Explicit workflow call. The FOD owning workspace and grants select a
   * verified host independent of Skipo static capability enumeration.
   * The actual target still verifies Luth + exact current workflow revision.
   */
  async function invokeWorkflow(
    targetAppId: string, request: FacadeInvocation,
    signal?: AbortSignal, deadlineAt?: number,
  ): Promise<RemoteFacadeResult> {
    requireInvocation(request);
    let input: unknown;
    try { input = structuredClone(request.input); }
    catch { denied('MALFORMED_INPUT', 400); }
    assertFacadeJsonInput(input);
    const captured = {
      operationId: request.operationId, version: request.version,
      targetWorkspaceId: request.targetWorkspaceId, invocationId: request.invocationId, input,
    };
    assertFacadeJsonInput(captured);
    const operation: RemoteFacadeOperation = {
      id: captured.operationId, version: captured.version, kind: 'workflow',
    };
    const { body } = await exchange(targetAppId, captured.targetWorkspaceId, operation,
      'POST', captured, signal, deadlineAt);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !own(body, 'output') || (body as Record<string, unknown>).invocationId !== captured.invocationId) {
      denied('CORRELATION_MISMATCH', 502);
    }
    return { output: (body as { output: unknown }).output, invocationId: captured.invocationId };
  }

  /** Execute a persisted static handle only on its exact registered deployment. */
  async function invokePinned(handle: PinnedRemoteFacadeDescriptor, input: unknown,
    invocationId: string, signal?: AbortSignal, deadlineAt?: number): Promise<RemoteFacadeResult> {
    if (!handle || typeof handle !== 'object' || handle.kind !== 'static' ||
        !validId(handle.appId) || !validId(handle.id) || !validId(handle.version) ||
        !validId(handle.targetWorkspaceId) || !validId(invocationId) ||
        handle.environment !== options.environment ||
        typeof handle.deploymentId !== 'string' || !deploymentUuid.test(handle.deploymentId)) {
      denied('MALFORMED_HANDLE', 400);
    }
    const captured = {
      appId: handle.appId, deploymentId: handle.deploymentId,
      operationId: handle.id, version: handle.version, targetWorkspaceId: handle.targetWorkspaceId,
    };
    return invoke(captured.appId, {
      operationId: captured.operationId, version: captured.version,
      targetWorkspaceId: captured.targetWorkspaceId, invocationId, input,
    }, signal, deadlineAt, captured.deploymentId);
  }

  return { discover, discoverPinned, invoke, invokePinned, invokeWorkflow };
}
