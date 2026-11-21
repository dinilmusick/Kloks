/**
 * Server-only wire composition for Luth's single-use cross-app invocation
 * admission and distinct signed, non-consuming output receipt (Luth PR #23).
 * Luth owns identity and token verification. This module never signs tokens,
 * creates grants or routes business operations.
 */
import { FacadeInvocationDenied, type FacadeInvocationAuthorityContext, type VerifiedFacadeCaller } from './facadeInvocation.js';
import type { RemoteFacadeOperation, VerifiedFacadeDeployment } from './facadeRemoteClient.js';

export type LuthInvocationScope = 'backend.invoke' | 'workflow.invoke';
export interface LuthResourceBinding {
  scope: LuthInvocationScope;
  resourceKey: string;
}
export interface LuthAdmissionIdentity {
  principalId: string;
  callerAppId: string;
  targetAppId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  scope: LuthInvocationScope;
  resourceKey: string;
}
interface LuthAdmissionResponse extends LuthAdmissionIdentity {
  authenticated: true;
  targetAuthorizationRequired: true;
  invocationId: string;
  admission_token: string;
  admission_expires_in: number;
}
interface LuthOutputResponse extends LuthAdmissionIdentity {
  authenticated: true;
  revalidated: true;
  targetAuthorizationRequired: true;
  invocationId: string;
}

const validHandle = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v) &&
  !v.includes('..') && !['__proto__', 'constructor', 'prototype'].some(x => v.includes(x));
const validBearer = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length < 8192 && /^[A-Za-z0-9._~+/-]+=*$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const denied = (code: string, status = 403): never => { throw new FacadeInvocationDenied(code, status); };
const sameContext = (a: FacadeInvocationAuthorityContext, b: FacadeInvocationAuthorityContext) =>
  a.operationId === b.operationId && a.version === b.version &&
  a.targetWorkspaceId === b.targetWorkspaceId &&
  a.invocationId === b.invocationId && a.transport === b.transport;

function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash || value !== url.origin ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) ||
        /\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
        /^\d+(?:\.\d+)+$/.test(url.hostname)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Luth must be configured with a host-approved public HTTPS origin');
  }
}

function matchesIdentity(value: unknown, expected: {
  principalId: string; sourceAppId: string; targetAppId: string;
  sourceWorkspaceId: string; targetWorkspaceId: string;
  scope: LuthInvocationScope; resourceKey: string;
}): value is LuthAdmissionIdentity {
  if (!record(value)) return false;
  return value.principalId === expected.principalId &&
    value.callerAppId === expected.sourceAppId &&
    value.targetAppId === expected.targetAppId &&
    value.sourceWorkspaceId === expected.sourceWorkspaceId &&
    value.targetWorkspaceId === expected.targetWorkspaceId &&
    value.scope === expected.scope && value.resourceKey === expected.resourceKey &&
    value.targetAuthorizationRequired === true && value.authenticated === true;
}

async function limitedJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok || !response.body) return null;
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > 16_384) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let doneReading = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { doneReading = true; break; }
      size += value.byteLength;
      if (size > 16_384) return null;
      chunks.push(value);
    }
  } catch { return null; }
  finally {
    if (!doneReading) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return record(value) ? value : null;
  } catch { return null; }
}

function luthTransport(origin: string, send: typeof fetch) {
  return async function post(path: string, body: object, assertion: string, signal?: AbortSignal):
    Promise<Record<string, unknown> | null> {
    if (!validBearer(assertion) || signal?.aborted) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 10_000);
    try {
      const reply = await send(origin + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + assertion,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (controller.signal.aborted) return null;
      return await limitedJson(reply);
    } catch { return null; }
    finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}

export interface LuthFacadeTargetOptions {
  /** Exact HTTPS origin of independently trusted Luth authority. No caller URLs. */
  luthOrigin: string;
  targetAppId: string;
  /** Host-owned same-user/same-session target LUTH-SESSION-V1 assertion. */
  getTargetSessionAssertion: (context: Readonly<FacadeInvocationAuthorityContext>) => Promise<string>;
  /** Authoritative Skipo/FOD operation-to-grant key. Must resolve exact revision. */
  resolveResource: (context: Readonly<FacadeInvocationAuthorityContext>) =>
    Promise<LuthResourceBinding | null>;
  /** Protected target-host route/session/ancestry metadata. Never derive from input JSON. */
  resolveTrustedCaller: (
    identity: Readonly<LuthAdmissionIdentity>, context: Readonly<FacadeInvocationAuthorityContext>,
  ) => Promise<VerifiedFacadeCaller | null>;
  /** Fresh independent caller/invoker/session check, including current work budget. */
  recheckTrustedCaller: (
    caller: Readonly<VerifiedFacadeCaller>, context: Readonly<FacadeInvocationAuthorityContext>,
  ) => Promise<VerifiedFacadeCaller | null>;
  /** Authenticated MCP initialize/control-plane requests have no operation proof. */
  verifyControlCredential?: (credential: string, targetAppId: string) =>
    Promise<VerifiedFacadeCaller | null>;
  fetch?: typeof fetch;
}

/**
 * Returned callbacks plug directly into createFacadeInvocationBoundary.
 *
 * The signed output receipt is held only in a WeakMap keyed by the original
 * authoritative admission object. It never reaches FacadeDecision, wire
 * responses, discovery descriptors or user/workflow persistence.
 */
export function createLuthFacadeTargetAuthorities(options: LuthFacadeTargetOptions) {
  const origin = exactOrigin(options.luthOrigin);
  if (!validHandle(options.targetAppId) ||
      typeof options.getTargetSessionAssertion !== 'function' ||
      typeof options.resolveResource !== 'function' ||
      typeof options.resolveTrustedCaller !== 'function' ||
      typeof options.recheckTrustedCaller !== 'function') {
    throw new Error('Luth target session, resource and trusted caller authorities are mandatory');
  }
  const post = luthTransport(origin, options.fetch ?? fetch);
  const receipts = new WeakMap<VerifiedFacadeCaller, {
    context: FacadeInvocationAuthorityContext;
    identity: LuthAdmissionIdentity;
    admissionToken: string;
    luthInvocationId: string;
    resource: LuthResourceBinding;
  }>();

  async function verifyLuthCredential(
    credential: string, targetAppId: string, context?: Readonly<FacadeInvocationAuthorityContext>,
  ): Promise<VerifiedFacadeCaller | null> {
    if (targetAppId !== options.targetAppId || !validBearer(credential)) return null;
    if (!context) return options.verifyControlCredential?.(credential, targetAppId) ?? null;
    if (!validHandle(context.operationId) || !validHandle(context.version) ||
        !validHandle(context.targetWorkspaceId) || !validHandle(context.invocationId)) return null;
    try {
      const resource = await options.resolveResource(context);
      if (!resource || !['backend.invoke', 'workflow.invoke'].includes(resource.scope) ||
          !validHandle(resource.resourceKey)) return null;
      const assertion = await options.getTargetSessionAssertion(context);
      const data = await post('/api/oauth/introspect', { token: credential }, assertion);
      if (!data || data.authenticated !== true || data.targetAuthorizationRequired !== true ||
          data.targetAppId !== targetAppId || data.targetWorkspaceId !== context.targetWorkspaceId ||
          !validHandle(data.principalId) || !validHandle(data.callerAppId) ||
          !validHandle(data.sourceWorkspaceId) || data.scope !== resource.scope ||
          data.resourceKey !== resource.resourceKey ||
          typeof data.invocationId !== 'string' || !/^[0-9a-f]{64}$/.test(data.invocationId) ||
          !validBearer(data.admission_token) ||
          !Number.isSafeInteger(data.admission_expires_in) ||
          (data.admission_expires_in as number) < 1 || (data.admission_expires_in as number) > 600) return null;
      const identity = data as unknown as LuthAdmissionResponse;
      const caller = await options.resolveTrustedCaller(identity, context);
      if (!caller || caller.principalId !== identity.principalId ||
          caller.sourceAppId !== identity.callerAppId ||
          caller.sourceWorkspaceId !== identity.sourceWorkspaceId ||
          caller.audience !== identity.targetAppId) return null;
      receipts.set(caller, {
        context: { ...context }, identity, admissionToken: identity.admission_token,
        luthInvocationId: identity.invocationId, resource: { ...resource },
      });
      return caller;
    } catch { return null; }
  }

  async function revalidateLuthCaller(
    admitted: Readonly<VerifiedFacadeCaller>, targetAppId: string,
    context: Readonly<FacadeInvocationAuthorityContext>,
    admissionEvidence: Readonly<VerifiedFacadeCaller>,
  ): Promise<VerifiedFacadeCaller | null> {
    if (!admissionEvidence || targetAppId !== options.targetAppId) return null;
    const proof = receipts.get(admissionEvidence);
    if (!proof || !sameContext(proof.context, context)) return null;
    // One output permit per admitted call; never replay the consumed bearer.
    receipts.delete(admissionEvidence);
    try {
      const resource = await options.resolveResource(context);
      if (!resource || resource.scope !== proof.resource.scope ||
          resource.resourceKey !== proof.resource.resourceKey) return null;
      const assertion = await options.getTargetSessionAssertion(context);
      const data = await post('/api/oauth/revalidate', {
        admission_token: proof.admissionToken, invocation_id: proof.luthInvocationId,
      }, assertion);
      if (!data || data.revalidated !== true || data.invocationId !== proof.luthInvocationId ||
          !matchesIdentity(data, {
            principalId: proof.identity.principalId,
            sourceAppId: proof.identity.callerAppId,
            targetAppId,
            sourceWorkspaceId: proof.identity.sourceWorkspaceId,
            targetWorkspaceId: context.targetWorkspaceId,
            scope: resource.scope,
            resourceKey: resource.resourceKey,
          })) return null;
      const current = await options.recheckTrustedCaller(admitted, context);
      if (!current || current.principalId !== data.principalId ||
          current.sourceAppId !== data.callerAppId ||
          current.sourceWorkspaceId !== data.sourceWorkspaceId ||
          current.audience !== data.targetAppId) return null;
      return current;
    } catch { return null; }
  }
  return { verifyLuthCredential, revalidateLuthCaller };
}

export interface LuthFacadeSourceOptions {
  luthOrigin: string;
  /** Fresh source LUTH-SESSION-V1 assertion for the live source app/user/session. */
  getSourceSessionAssertion: (
    deployment: VerifiedFacadeDeployment, operation: RemoteFacadeOperation | undefined, signal: AbortSignal,
  ) => Promise<string>;
  /** Owner/workspace-scoped exact-grant intent. Never from caller JSON. */
  resolveIntent: (
    deployment: VerifiedFacadeDeployment, operation: RemoteFacadeOperation | undefined, signal: AbortSignal,
  ) => Promise<{
    caller_workspace_id: string;
    target_workspace_id: string;
    scope: LuthInvocationScope;
    resource_key: string;
  } | null>;
  fetch?: typeof fetch;
}

/** Caller-side per-request grant-bound Luth issuer for createFacadeRemoteClient. */
export function createLuthFacadeBearerIssuer(options: LuthFacadeSourceOptions) {
  const origin = exactOrigin(options.luthOrigin);
  if (typeof options.getSourceSessionAssertion !== 'function' ||
      typeof options.resolveIntent !== 'function') {
    throw new Error('Trusted Luth source session and grant-intent authorities are mandatory');
  }
  const post = luthTransport(origin, options.fetch ?? fetch);
  return async function getAudienceBearer(
    deployment: VerifiedFacadeDeployment, operation: RemoteFacadeOperation | undefined, signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) denied('CANCELLED', 408);
    const intent = await options.resolveIntent(deployment, operation, signal);
    if (!intent || !validHandle(intent.caller_workspace_id) ||
        intent.target_workspace_id !== deployment.workspaceId ||
        !validHandle(intent.resource_key) ||
        !['backend.invoke', 'workflow.invoke'].includes(intent.scope) ||
        (operation?.kind === 'workflow' && intent.scope !== 'workflow.invoke') ||
        (operation?.kind !== 'workflow' && intent.scope !== 'backend.invoke')) {
      denied('DELEGATION_DENIED');
    }
    if (signal.aborted) denied('CANCELLED', 408);
    const assertion = await options.getSourceSessionAssertion(deployment, operation, signal);
    const data = await post('/api/oauth/delegate', {
      audience: deployment.appId,
      caller_workspace_id: intent.caller_workspace_id,
      target_workspace_id: intent.target_workspace_id,
      scope: intent.scope,
      resource_key: intent.resource_key,
    }, assertion, signal);
    if (signal.aborted) denied('CANCELLED', 408);
    if (!data || data.token_type !== 'Bearer' ||
        data.scope !== intent.scope || data.audience !== deployment.appId ||
        !validBearer(data.access_token) ||
        !Number.isSafeInteger(data.expires_in) ||
        (data.expires_in as number) < 1 || (data.expires_in as number) > 60) {
      denied('DELEGATION_DENIED');
    }
    return data.access_token as string;
  };
}
