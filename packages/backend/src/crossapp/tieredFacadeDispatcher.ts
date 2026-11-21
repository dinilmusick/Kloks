/**
 * Transport-neutral caller-side dispatcher for the existing BackendFacade guard.
 *
 * Composition, UDP discovery and cloud registry implementations are injected by
 * the host. Every target still executes the canonical Luth-authorized target
 * boundary; this module is not a second identity provider or operation store.
 */
export type FacadeTier = 'process' | 'peer' | 'cloud';
export type FacadeRuntime = 'composed' | 'desktop' | 'cloud';
export type FacadeDispatchPhase = 'invoke' | 'output';

export interface CrossAppRequest {
  readonly appId: string;
  readonly targetWorkspaceId: string;
  readonly operationId: string;
  readonly version: string;
  readonly invocationId: string;
  readonly input: unknown;
}
export interface TrustedFacadePrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly sourceAppId: string;
  readonly sourceWorkspaceId: string;
  readonly expiresAt: number;
  readonly deadlineAt: number;
}
export interface TrustedFacadeOperation {
  readonly appId: string;
  readonly workspaceId: string;
  readonly id: string;
  readonly version: string;
  readonly effect: 'read' | 'write';
}
export interface TrustedFacadeTarget {
  readonly tier: FacadeTier;
  readonly appId: string;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly version: string;
  readonly deploymentId: string;
  readonly leaseExpiresAt: number;
  readonly verified: true;
  /** Precomputed DEPM weight, never calculated in the request path. */
  readonly weight?: number;
}
export interface CrossAppResult {
  readonly output: unknown;
  readonly invocationId: string;
  readonly tier: FacadeTier;
  readonly deploymentId: string;
}
export class TieredFacadeDenied extends Error {
  constructor(readonly code: string, readonly status: number = 403) {
    super(code);
    this.name = 'TieredFacadeDenied';
  }
}
export interface TieredFacadeDispatcherOptions {
  readonly runtime: FacadeRuntime;
  /** Verified Luth identity; no caller-supplied user/app claims. */
  readonly authenticate: (signal: AbortSignal) => Promise<TrustedFacadePrincipal | null>;
  /** Authoritative current publication and trusted read/write classification. */
  readonly resolveOperation: (caller: TrustedFacadePrincipal, request: CrossAppRequest, signal: AbortSignal) => Promise<TrustedFacadeOperation | null>;
  /** Peer beacon is a hint; only attested, authenticated peers can be returned. */
  readonly discover: (tier: FacadeTier, caller: TrustedFacadePrincipal, request: CrossAppRequest, signal: AbortSignal) => Promise<readonly TrustedFacadeTarget[]>;
  /** Revalidate target identity, ownership, exact version and live lease. */
  readonly validateTarget: (target: TrustedFacadeTarget, caller: TrustedFacadePrincipal, signal: AbortSignal) => Promise<boolean>;
  /** Enforce user, app, workspace, audience and operation grants. */
  readonly authorize: (caller: TrustedFacadePrincipal, operation: TrustedFacadeOperation, target: TrustedFacadeTarget, phase: FacadeDispatchPhase, value: unknown, signal: AbortSignal) => Promise<boolean>;
  /** Mint a fresh audience-scoped Luth proof for each exact target. */
  readonly mintAudienceProof: (caller: TrustedFacadePrincipal, target: TrustedFacadeTarget, operation: TrustedFacadeOperation, signal: AbortSignal) => Promise<string>;
  /** MUST invoke canonical target-side guarded BackendFacade even for process/peer. */
  readonly invokeTarget: (target: TrustedFacadeTarget, request: CrossAppRequest, audienceProof: string, signal: AbortSignal) => Promise<{ readonly output: unknown; readonly invocationId: string }>;
  /** Non-consuming Luth session/grant revalidation, not one-use proof replay. */
  readonly revalidateCaller: (caller: TrustedFacadePrincipal, signal: AbortSignal) => Promise<TrustedFacadePrincipal | null>;
  /** Authoritative durable, cross-deployment idempotency proof for uncertain writes. */
  readonly mayRetryUncertainWrite?: (caller: TrustedFacadePrincipal, operation: TrustedFacadeOperation, request: CrossAppRequest, failedTarget: TrustedFacadeTarget, signal: AbortSignal) => Promise<boolean>;
  readonly attemptTimeoutMs?: number;
  readonly maxDurationMs?: number;
  readonly now?: () => number;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validId = (v: unknown): v is string => typeof v === 'string' && ID.test(v) &&
  !v.includes('..') && !['__proto__', 'prototype', 'constructor'].some(k => v.includes(k));
const denied = (code: string, status: number): never => { throw new TieredFacadeDenied(code, status); };
const sameCaller = (a: TrustedFacadePrincipal, b: TrustedFacadePrincipal) =>
  a.userId === b.userId && a.sessionId === b.sessionId && a.sourceAppId === b.sourceAppId &&
  a.sourceWorkspaceId === b.sourceWorkspaceId;
const sameOperation = (a: TrustedFacadeOperation, b: TrustedFacadeOperation) =>
  a.appId === b.appId && a.workspaceId === b.workspaceId && a.id === b.id &&
  a.version === b.version && a.effect === b.effect;
const availabilityError = (e: unknown) => e instanceof TieredFacadeDenied &&
  ['TARGET_UNAVAILABLE', 'DISPATCH_TIMEOUT', 'REMOTE_TRANSPORT_FAILED'].includes(e.code);

function assertRequest(request: CrossAppRequest): void {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    Object.keys(request).some(key => !['appId', 'targetWorkspaceId', 'operationId', 'version', 'invocationId', 'input'].includes(key)) ||
    ![request.appId, request.targetWorkspaceId, request.operationId, request.version, request.invocationId].every(validId) ||
    !Object.prototype.hasOwnProperty.call(request, 'input')) denied('MALFORMED_HANDLE', 400);
}
function assertPrincipal(caller: TrustedFacadePrincipal | null, now: number): asserts caller is TrustedFacadePrincipal {
  if (!caller || ![caller.userId, caller.sessionId, caller.sourceAppId, caller.sourceWorkspaceId].every(validId) ||
    !Number.isFinite(caller.expiresAt) || caller.expiresAt <= now ||
    !Number.isFinite(caller.deadlineAt) || caller.deadlineAt <= now) denied('AUTH_INVALID', 401);
}
function assertOperation(operation: TrustedFacadeOperation | null, request: CrossAppRequest): asserts operation is TrustedFacadeOperation {
  if (!operation || operation.appId !== request.appId || operation.workspaceId !== request.targetWorkspaceId ||
    operation.id !== request.operationId || operation.version !== request.version ||
    !['read', 'write'].includes(operation.effect)) denied('OPERATION_UNAVAILABLE', 404);
}
function assertTarget(target: TrustedFacadeTarget, tier: FacadeTier, request: CrossAppRequest, now: number): void {
  if (!target || target.verified !== true || target.tier !== tier ||
    target.appId !== request.appId || target.workspaceId !== request.targetWorkspaceId ||
    target.operationId !== request.operationId || target.version !== request.version ||
    !validId(target.deploymentId) || !Number.isFinite(target.leaseExpiresAt) || target.leaseExpiresAt <= now ||
    (tier === 'cloud' && (typeof target.weight !== 'number' || !Number.isFinite(target.weight) || target.weight < 0))) {
    denied('MALFORMED_TARGET', 503);
  }
}
/** A hung adapter cannot exceed deadline even if it ignores AbortSignal. */
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number, signal?: AbortSignal, now: () => number = Date.now): Promise<T> {
  if (signal?.aborted) denied('CANCELLED', 408);
  const ms = Math.ceil(deadlineAt - now());
  if (ms <= 0) denied('DISPATCH_TIMEOUT', 504);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let remove: (() => void) | undefined;
  const abortReason = { timedOut: false };
  const interruption = new Promise<never>((_, reject) => {
    const failAbort = () => reject(new TieredFacadeDenied(abortReason.timedOut ? 'DISPATCH_TIMEOUT' : 'CANCELLED', abortReason.timedOut ? 504 : 408));
    controller.signal.addEventListener('abort', failAbort, { once: true });
    const forward = () => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    remove = () => signal?.removeEventListener('abort', forward);
    timeout = setTimeout(() => { abortReason.timedOut = true; controller.abort(); }, ms);
    if (signal?.aborted) controller.abort();
  });
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), interruption]); }
  finally { if (timeout) clearTimeout(timeout); remove?.(); controller.abort(); }
}
export function createTieredFacadeDispatcher(options: TieredFacadeDispatcherOptions) {
  if (!options || !['composed', 'desktop', 'cloud'].includes(options.runtime)) {
    throw new Error('A known runtime is required');
  }
  for (const key of ['authenticate', 'resolveOperation', 'discover', 'validateTarget', 'authorize',
    'mintAudienceProof', 'invokeTarget', 'revalidateCaller'] as const) {
    if (typeof options[key] !== 'function') throw new Error('Missing mandatory authority: ' + key);
  }
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 5_000;
  const maxDurationMs = options.maxDurationMs ?? 30_000;
  if (![attemptTimeoutMs, maxDurationMs].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 30_000)) {
    throw new Error('Invalid dispatch deadline');
  }
  const now = options.now ?? Date.now;
  const tiers: readonly FacadeTier[] = options.runtime === 'composed'
    ? ['process', 'peer', 'cloud'] : options.runtime === 'desktop' ? ['peer', 'cloud'] : ['cloud'];

  async function invoke(request: CrossAppRequest, parentSignal?: AbortSignal): Promise<CrossAppResult> {
    assertRequest(request);
    // Snapshot JSON input before async authority/discovery; no post-authorization mutation.
    let encoded: string;
    try { encoded = JSON.stringify(request.input); }
    catch { denied('MALFORMED_INPUT', 400); }
    if (typeof encoded! !== 'string' || new TextEncoder().encode(encoded!).byteLength > 1_048_576) {
      denied('MALFORMED_INPUT', 400);
    }
    const snapshot: CrossAppRequest = Object.freeze({ ...request, input: JSON.parse(encoded!) });
    const startDeadline = now() + maxDurationMs;
    try { return await bounded(async signal => {
      const principal = await options.authenticate(signal);
      assertPrincipal(principal, now());
      const caller = Object.freeze({ ...principal });
      const deadline = Math.min(startDeadline, caller.expiresAt, caller.deadlineAt);
      if (deadline <= now()) denied('DISPATCH_TIMEOUT', 504);
      const operation = await bounded(s => options.resolveOperation(caller, snapshot, s), deadline, signal, now);
      assertOperation(operation, snapshot);
      const contract = Object.freeze({ ...operation });
      let uncertainWriteTarget: TrustedFacadeTarget | undefined;
      let lastFailure: TieredFacadeDenied | undefined;
      for (const tier of tiers) {
        let candidates: readonly TrustedFacadeTarget[];
        try { candidates = await bounded(s => options.discover(tier, caller, snapshot, s), deadline, signal, now); }
        catch (error) {
          if (error instanceof TieredFacadeDenied && error.code === 'CANCELLED') throw error;
          if (tier === 'cloud') throw error;
          if (error instanceof TieredFacadeDenied && [401, 403].includes(error.status)) throw error;
          lastFailure = new TieredFacadeDenied('TARGET_UNAVAILABLE', 503);
          continue;
        }
        if (!Array.isArray(candidates) || candidates.length > 32) denied('MALFORMED_TARGET', 503);
        const seen = new Set<string>();
        for (const candidate of candidates) {
          assertTarget(candidate, tier, snapshot, now());
          if (seen.has(candidate.deploymentId)) denied('MALFORMED_TARGET', 503);
          seen.add(candidate.deploymentId);
        }
        const ordered = tier === 'cloud' ? [...candidates].sort((a, b) =>
          (b.weight! - a.weight!) || a.deploymentId.localeCompare(b.deploymentId)) : candidates;
        for (const candidate of ordered) {
          const attemptEnd = Math.min(deadline, now() + attemptTimeoutMs);
          let sent = false;
          try {
            const result = await bounded(async attemptSignal => {
              if (uncertainWriteTarget) {
                const permit = await options.mayRetryUncertainWrite?.(caller, contract, snapshot, uncertainWriteTarget, attemptSignal);
                if (permit !== true) denied('UNCERTAIN_WRITE_NOT_RETRIED', 409);
              }
              const currentlyLive = await options.revalidateCaller(caller, attemptSignal);
              assertPrincipal(currentlyLive, now());
              if (!sameCaller(caller, currentlyLive)) denied('AUTH_REVOKED', 401);
              const current = await options.resolveOperation(caller, snapshot, attemptSignal);
              if (!current || !sameOperation(contract, current)) denied('OPERATION_REVOKED', 403);
              if (!await options.validateTarget(candidate, caller, attemptSignal)) denied('TARGET_UNAVAILABLE', 503);
              if (!await options.authorize(caller, contract, candidate, 'invoke', snapshot.input, attemptSignal)) denied('ACCESS_DENIED', 403);
              const bearer = await options.mintAudienceProof(caller, candidate, contract, attemptSignal);
              if (typeof bearer !== 'string' || bearer.length < 1 || bearer.length > 8192 || /\s/.test(bearer)) denied('AUTH_INVALID', 401);
              if (!await options.validateTarget(candidate, caller, attemptSignal)) denied('TARGET_UNAVAILABLE', 503);
              if (!await options.authorize(caller, contract, candidate, 'invoke', snapshot.input, attemptSignal)) denied('ACCESS_DENIED', 403);
              let returned: { readonly output: unknown; readonly invocationId: string } | undefined;
              sent = true;
              try { returned = await options.invokeTarget(candidate, snapshot, bearer, attemptSignal); }
              catch (e) {
                if (e instanceof TieredFacadeDenied) throw e;
                denied('REMOTE_TRANSPORT_FAILED', 502);
              }
              if (!returned || returned.invocationId !== snapshot.invocationId ||
                !Object.prototype.hasOwnProperty.call(returned, 'output')) denied('MALFORMED_RESULT', 502);
              const response = returned!;
              const freshCaller = await options.revalidateCaller(caller, attemptSignal);
              assertPrincipal(freshCaller, now());
              if (!sameCaller(caller, freshCaller)) denied('AUTH_REVOKED', 401);
              const latestOperation = await options.resolveOperation(caller, snapshot, attemptSignal);
              if (!latestOperation || !sameOperation(contract, latestOperation)) denied('OPERATION_REVOKED', 403);
              if (!await options.validateTarget(candidate, caller, attemptSignal)) denied('TARGET_UNAVAILABLE', 503);
              if (!await options.authorize(caller, contract, candidate, 'output', response.output, attemptSignal)) denied('ACCESS_REVOKED', 403);
              return { output: response.output, invocationId: snapshot.invocationId, tier, deploymentId: candidate.deploymentId };
            }, attemptEnd, signal, now);
            return result;
          } catch (error) {
            if (!availabilityError(error)) throw error;
            lastFailure = error as TieredFacadeDenied;
            if (contract.effect === 'write' && sent) uncertainWriteTarget = candidate;
          }
        }
      }
      if (uncertainWriteTarget) denied('UNCERTAIN_WRITE_NOT_RETRIED', 409);
      throw lastFailure ?? new TieredFacadeDenied('TARGET_UNAVAILABLE', 503);
    }, startDeadline, parentSignal, now); }
    catch (error) {
      if (error instanceof TieredFacadeDenied) throw error;
      throw new TieredFacadeDenied('AUTHORITY_UNAVAILABLE', 503);
    }
  }
  return { invoke };
}
