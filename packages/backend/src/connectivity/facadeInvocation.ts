/**
 * Host-owned execution guard for the existing BackendFacade.
 * Luth credential verification, grants, deployment proof, replay storage and workflow
 * storage are mandatory injected authorities; this module creates none of them.
 */
import type { BackendFacade } from '../architecture/types.js';

export type FacadeTransport = 'http' | 'mcp' | 'graph' | 'agent';
export type InvokerKind = 'user' | 'app-agent' | 'endpoint-agent' | 'workflow-agent';
export type FacadeHandleKind = 'static' | 'workflow';

export interface VerifiedFacadeCaller {
  principalId: string;
  sourceAppId: string;
  sourceWorkspaceId: string;
  audience: string;
  sessionId: string;
  invoker: { kind: InvokerKind; id: string };
  chain: readonly string[];
  depth: number;
  maxDepth: number;
  remainingCalls: number;
  deadlineAt: number;
  expiresAt: number;
}

/** Only metadata and an immutable function reference; never include graph definitions or secrets. */
export interface FacadeOperationDescriptor {
  id: string;
  version: string;
  name: string;
  kind: FacadeHandleKind;
  targetWorkspaceId: string;
  serviceId?: string;
  serviceOperation?: string;
  workflowId?: string;
}

export interface FacadeInvocation {
  operationId: string;
  version: string;
  targetWorkspaceId: string;
  invocationId: string;
  input: unknown;
}

export interface FacadeDecision {
  caller: Readonly<VerifiedFacadeCaller>;
  operation: Readonly<FacadeOperationDescriptor>;
  transport: FacadeTransport;
}

export interface FacadeInvocationOptions {
  targetAppId: string;
  facade: BackendFacade;
  /** Must validate Luth signature, audience, session status, revocation and delegation chain at each use. */
  verifyLuthCredential: (credential: string, targetAudience: string) => Promise<VerifiedFacadeCaller | null>;
  /** Must return only current static definitions and explicitly published workflow references. */
  listCurrentOperations: (workspaceId: string) => Promise<FacadeOperationDescriptor[]>;
  /** Must re-read current owner, publication, ACL, grant, scopes, input and output rules. */
  authorize: (decision: FacadeDecision, phase: 'discover' | 'invoke' | 'output', value?: unknown) => Promise<boolean>;
  /** Must verify registry attestation, active lease, environment and target-workspace access. */
  deploymentEligible: (decision: FacadeDecision) => Promise<boolean>;
  /** Durable, atomic replay rejection and shared work-budget debit. No in-memory fallback. */
  consumeInvocation: (caller: VerifiedFacadeCaller, invocationId: string) => Promise<boolean>;
  /** Resolve the workflow from its owning workspace, then invoke via existing FOD runtime. */
  invokePublishedWorkflow: (reference: { workspaceId: string; workflowId: string; version: string }, input: unknown, signal: AbortSignal) => Promise<unknown>;
  /** Issue a new Luth-verifiable, audience-scoped delegated credential after atomic budget reservation. */
  delegateCredential: (caller: VerifiedFacadeCaller, targetAppId: string, invocationId: string) => Promise<string>;
}

export class FacadeInvocationDenied extends Error {
  constructor(readonly code: string, readonly status = 403) { super(code); this.name = 'FacadeInvocationDenied'; }
}

const handle = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && handle.test(value) &&
  !value.includes('..') && !value.includes('__proto__') && !value.includes('constructor') && !value.includes('prototype');
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const fail = (code: string, status = 403): never => { throw new FacadeInvocationDenied(code, status); };

function assertInvocation(request: FacadeInvocation): void {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('MALFORMED_HANDLE', 400);
  if (Object.keys(request).some(key => !['operationId', 'version', 'targetWorkspaceId', 'invocationId', 'input'].includes(key))) fail('UNTRUSTED_CLAIMS', 400);
  if (![request.operationId, request.version, request.targetWorkspaceId, request.invocationId].every(validId)) fail('MALFORMED_HANDLE', 400);
  if (!own(request, 'input')) fail('MALFORMED_INPUT', 400);
}

function assertDescriptor(operation: FacadeOperationDescriptor): boolean {
  if (!operation || !validId(operation.id) || !validId(operation.version) ||
      !validId(operation.targetWorkspaceId) || typeof operation.name !== 'string' || operation.name.length > 160) return false;
  if (operation.kind === 'static') return validId(operation.serviceId) && validId(operation.serviceOperation);
  return operation.kind === 'workflow' && validId(operation.workflowId);
}

/**
 * All four entry points call the same guard. No client-controlled user, app,
 * source workspace, parent caller or grant claim is accepted as authority.
 */
export function createFacadeInvocationBoundary(options: FacadeInvocationOptions) {
  if (!validId(options.targetAppId)) throw new Error('Invalid target application identity');

  async function callerFor(credential: string): Promise<VerifiedFacadeCaller> {
    if (!credential || typeof credential !== 'string') fail('AUTH_REQUIRED', 401);
    const caller = await options.verifyLuthCredential(credential, options.targetAppId);
    if (!caller || !validId(caller.principalId) || !validId(caller.sourceAppId) ||
        !validId(caller.sourceWorkspaceId) || !validId(caller.sessionId) ||
        caller.audience !== options.targetAppId || !validId(caller.invoker?.id) ||
        !['user', 'app-agent', 'endpoint-agent', 'workflow-agent'].includes(caller.invoker.kind) ||
        !Array.isArray(caller.chain) || caller.chain.length < 1 || caller.chain.some(id => !validId(id)) ||
        !Number.isSafeInteger(caller.depth) || caller.depth < 0 ||
        !Number.isSafeInteger(caller.maxDepth) || caller.maxDepth < 1 ||
        !Number.isSafeInteger(caller.remainingCalls) || caller.remainingCalls < 1 ||
        !Number.isFinite(caller.deadlineAt) || !Number.isFinite(caller.expiresAt) ||
        caller.expiresAt <= Date.now()) fail('AUTH_INVALID', 401);
    if (caller.chain.includes(options.targetAppId) && caller.chain.at(-1) !== options.targetAppId) fail('APP_CYCLE');
    if (caller.depth >= caller.maxDepth) fail('DEPTH_EXCEEDED', 429);
    if (Date.now() >= caller.deadlineAt) fail('DEADLINE_EXCEEDED', 408);
    return caller;
  }

  async function discover(credential: string, workspaceId: string, transport: FacadeTransport) {
    const caller = await callerFor(credential);
    if (!validId(workspaceId)) fail('INVALID_WORKSPACE', 400);
    const rows = await options.listCurrentOperations(workspaceId);
    const visible: Array<Pick<FacadeOperationDescriptor, 'id' | 'version' | 'name' | 'kind' | 'targetWorkspaceId'>> = [];
    for (const op of rows) {
      if (!assertDescriptor(op) || op.targetWorkspaceId !== workspaceId) continue;
      const decision = { caller, operation: op, transport };
      if (!await options.deploymentEligible(decision) || !await options.authorize(decision, 'discover')) continue;
      visible.push({ id: op.id, version: op.version, name: op.name, kind: op.kind, targetWorkspaceId: op.targetWorkspaceId });
    }
    return visible;
  }

  async function invoke(credential: string, request: FacadeInvocation, transport: FacadeTransport, parentSignal?: AbortSignal) {
    assertInvocation(request);
    const caller = await callerFor(credential);
    const current = await options.listCurrentOperations(request.targetWorkspaceId);
    const operation = current.find(op => assertDescriptor(op) && op.id === request.operationId &&
      op.targetWorkspaceId === request.targetWorkspaceId && op.version === request.version);
    if (!operation) fail('OPERATION_UNAVAILABLE', 404);
    const decision = { caller, operation, transport };
    if (!await options.deploymentEligible(decision)) fail('DEPLOYMENT_UNAVAILABLE', 503);
    if (!await options.authorize(decision, 'invoke', request.input)) fail('ACCESS_DENIED');
    // This must be backed by durable atomic state, not a per-process Set.
    if (!await options.consumeInvocation(caller, request.invocationId)) fail('REPLAY_OR_BUDGET_EXHAUSTED', 409);

    const controller = new AbortController();
    const deadline = Math.min(caller.deadlineAt, caller.expiresAt, Date.now() + 30_000);
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('DEADLINE_EXCEEDED', 408);
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stopped = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new FacadeInvocationDenied('CANCELLED', 408)), { once: true });
        timer = setTimeout(() => { controller.abort(); }, remaining);
        if (controller.signal.aborted) reject(new FacadeInvocationDenied('CANCELLED', 408));
      });
      const work = async () => {
        if (operation.kind === 'workflow') {
          return options.invokePublishedWorkflow({ workspaceId: operation.targetWorkspaceId, workflowId: operation.workflowId!, version: operation.version }, request.input, controller.signal);
        }
        const services = options.facade.services as Record<string, unknown>;
        if (!own(services, operation.serviceId!)) fail('OPERATION_UNAVAILABLE', 404);
        const service = services[operation.serviceId!] as { execute?: (name: string, input: unknown, context?: unknown) => unknown };
        if (typeof service?.execute !== 'function') fail('OPERATION_UNAVAILABLE', 404);
        return service.execute(operation.serviceOperation!, request.input, { signal: controller.signal, transport });
      };
      const output = await Promise.race([work(), stopped]);
      if (!await options.authorize(decision, 'output', output)) fail('ACCESS_REVOKED');
      return { output, replyTo: { ...caller.invoker }, invocationId: request.invocationId };
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  async function delegate(credential: string, targetAppId: string, request: FacadeInvocation,
    dispatch: (credential: string, request: FacadeInvocation, signal?: AbortSignal) => Promise<unknown>,
    signal?: AbortSignal) {
    assertInvocation(request);
    const caller = await callerFor(credential);
    if (!validId(targetAppId)) fail('INVALID_TARGET', 400);
    if (caller.chain.includes(targetAppId) && caller.chain.at(-1) !== targetAppId) fail('APP_CYCLE');
    if (caller.depth + 1 >= caller.maxDepth || caller.remainingCalls <= 1) fail('BUDGET_EXCEEDED', 429);
    // Luth must mint the audience-bound child proof and atomically reserve budget.
    const delegated = await options.delegateCredential(caller, targetAppId, request.invocationId);
    if (!delegated) fail('DELEGATION_DENIED');
    return dispatch(delegated, request, signal);
  }

  const bearer = (request: Request): string => {
    const value = request.headers.get('Authorization');
    const match = /^Bearer ([^\s]+)$/.exec(value ?? '');
    if (!match) fail('AUTH_REQUIRED', 401);
    return match[1];
  };
  const errorResponse = (error: unknown) => {
    const denied = error instanceof FacadeInvocationDenied ? error : new FacadeInvocationDenied('INTERNAL_ERROR', 500);
    return Response.json({ error: denied.code }, { status: denied.status, headers: { 'Cache-Control': 'no-store' } });
  };

  async function http(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const credential = bearer(request);
      if (path === '/api/crossapp/operations' && request.method === 'GET') {
        return Response.json({ operations: await discover(credential, new URL(request.url).searchParams.get('workspace') ?? '', 'http') }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (path === '/api/crossapp/invoke' && request.method === 'POST') {
        return Response.json(await invoke(credential, await request.json() as FacadeInvocation, 'http', request.signal), { headers: { 'Cache-Control': 'no-store' } });
      }
      return errorResponse(new FacadeInvocationDenied('NOT_FOUND', 404));
    } catch (error) { return errorResponse(error); }
  }

  async function mcp(request: Request): Promise<Response> {
    let id: unknown = null;
    try {
      const credential = bearer(request);
      const body = await request.json() as { id?: unknown; method?: string; params?: Record<string, unknown> };
      id = body.id ?? null;
      if (body.method === 'tools/list') {
        const workspace = body.params?.workspaceId;
        return Response.json({ jsonrpc: '2.0', id, result: { tools: (await discover(credential, String(workspace ?? ''), 'mcp')).map(op => ({ name: op.id, description: op.name, _meta: { version: op.version, targetWorkspaceId: op.targetWorkspaceId } })) } });
      }
      if (body.method === 'tools/call') {
        const result = await invoke(credential, body.params?.invocation as FacadeInvocation, 'mcp', request.signal);
        return Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result.output) }], structuredContent: result.output } });
      }
      return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, { status: 404 });
    } catch (error) {
      const denied = error instanceof FacadeInvocationDenied ? error : new FacadeInvocationDenied('INTERNAL_ERROR', 500);
      return Response.json({ jsonrpc: '2.0', id, error: { code: denied.status, message: denied.code } }, { status: denied.status });
    }
  }

  return { discover, invoke, delegate, http, mcp };
}
