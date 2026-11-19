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

/** Immutable operation identity passed to Luth admission, output revalidation and atomic replay/budget authority. */
export interface FacadeInvocationAuthorityContext {
  readonly operationId: string;
  readonly version: string;
  readonly targetWorkspaceId: string;
  readonly invocationId: string;
  readonly transport: FacadeTransport;
}

export interface FacadeDecision {
  caller: Readonly<VerifiedFacadeCaller>;
  operation: Readonly<FacadeOperationDescriptor>;
  transport: FacadeTransport;
  /** Durable, authority-verified invocation correlation; never taken from caller claims. */
  invocationId?: string;
}

export interface FacadeInvocationOptions {
  targetAppId: string;
  facade: BackendFacade;
  /** Must validate Luth signature, audience, session status, revocation and delegation chain at each use. */
  verifyLuthCredential: (credential: string, targetAudience: string, context?: Readonly<FacadeInvocationAuthorityContext>) => Promise<VerifiedFacadeCaller | null>;
  /**
   * Fresh, NON-CONSUMING Luth/session authority check for an already admitted caller.
   * Must validate the live session, delegation/grant revocation, target app and
   * audience against trusted state; must NEVER introspect or replay the one-use
   * admission bearer. Return the current trusted identity or null.
   */
  revalidateLuthCaller: (admitted: Readonly<VerifiedFacadeCaller>, targetAudience: string, context: Readonly<FacadeInvocationAuthorityContext>) => Promise<VerifiedFacadeCaller | null>;
  /** Must return only current static definitions and explicitly published workflow references. */
  listCurrentOperations: (workspaceId: string) => Promise<FacadeOperationDescriptor[]>;
  /** Must re-read current owner, publication, ACL, grant, scopes, input and output rules. */
  authorize: (decision: FacadeDecision, phase: 'discover' | 'invoke' | 'output', value?: unknown) => Promise<boolean>;
  /** Must verify registry attestation, active lease, environment and target-workspace access. */
  deploymentEligible: (decision: FacadeDecision) => Promise<boolean>;
  /** Durable, atomic replay rejection and shared work-budget debit. No in-memory fallback. */
  consumeInvocation: (caller: VerifiedFacadeCaller, invocationId: string, context: Readonly<FacadeInvocationAuthorityContext>) => Promise<boolean>;
  /** Resolve the workflow from its owning workspace, then invoke via existing FOD runtime. */
  invokePublishedWorkflow: (reference: { workspaceId: string; workflowId: string; version: string }, input: unknown, signal: AbortSignal) => Promise<unknown>;
  /** Issue a new Luth-verifiable, audience-scoped delegated credential after atomic budget reservation. */
  delegateCredential: (caller: VerifiedFacadeCaller, targetAppId: string, invocationId: string, signal?: AbortSignal) => Promise<string>;
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

/** Compare authority and immutable dispatch references, not mutable display labels. */
function sameCallerIdentity(before: VerifiedFacadeCaller, after: VerifiedFacadeCaller): boolean {
  return before.principalId === after.principalId &&
    before.sessionId === after.sessionId &&
    before.sourceAppId === after.sourceAppId &&
    before.sourceWorkspaceId === after.sourceWorkspaceId &&
    before.audience === after.audience &&
    before.invoker.kind === after.invoker.kind && before.invoker.id === after.invoker.id &&
    before.depth === after.depth && before.chain.length === after.chain.length &&
    before.chain.every((id, index) => id === after.chain[index]);
}
function sameDispatchReference(before: FacadeOperationDescriptor, after: FacadeOperationDescriptor): boolean {
  return before.id === after.id && before.version === after.version &&
    before.targetWorkspaceId === after.targetWorkspaceId && before.kind === after.kind &&
    (before.kind === 'workflow'
      ? before.workflowId === after.workflowId
      : before.serviceId === after.serviceId && before.serviceOperation === after.serviceOperation);
}

function parseJson(body: Request): Promise<unknown> {
  return body.json().catch(() => fail('MALFORMED_JSON', 400));
}

/**
 * All four entry points call the same guard. No client-controlled user, app,
 * source workspace, parent caller or grant claim is accepted as authority.
 */
export function createFacadeInvocationBoundary(options: FacadeInvocationOptions) {
  if (!validId(options.targetAppId)) throw new Error('Invalid target application identity');
  for (const name of ['verifyLuthCredential', 'revalidateLuthCaller', 'listCurrentOperations', 'authorize',
    'deploymentEligible', 'consumeInvocation', 'invokePublishedWorkflow', 'delegateCredential'] as const) {
    if (typeof options[name] !== 'function') throw new Error(`Missing required facade authority: ${name}`);
  }

  async function callerFor(credential: string, context?: Readonly<FacadeInvocationAuthorityContext>): Promise<VerifiedFacadeCaller> {
    if (!credential || typeof credential !== 'string') fail('AUTH_REQUIRED', 401);
    const caller = await options.verifyLuthCredential(credential, options.targetAppId, context);
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
    // Snapshot the input handle so caller-side mutation cannot change the target
    // workspace, immutable revision or invocation correlation during execution.
    const admittedRequest: FacadeInvocation = {
      operationId: request.operationId, version: request.version,
      targetWorkspaceId: request.targetWorkspaceId, invocationId: request.invocationId,
      input: (() => {
        try { return structuredClone(request.input); }
        catch { return fail('MALFORMED_INPUT', 400); }
      })(),
    };
    const proofContext: FacadeInvocationAuthorityContext = Object.freeze({
      operationId: admittedRequest.operationId, version: admittedRequest.version,
      targetWorkspaceId: admittedRequest.targetWorkspaceId,
      invocationId: admittedRequest.invocationId, transport,
    });
    const verified = await callerFor(credential, proofContext);
    // Snapshot the signed caller so a host adapter cannot mutate the original
    // object during a long-running operation and bypass the final identity check.
    const caller: VerifiedFacadeCaller = {
      ...verified, invoker: { ...verified.invoker }, chain: [...verified.chain],
    };
    const current = await options.listCurrentOperations(admittedRequest.targetWorkspaceId);
    const matching = current.find(op => assertDescriptor(op) && op.id === admittedRequest.operationId &&
      op.targetWorkspaceId === admittedRequest.targetWorkspaceId && op.version === admittedRequest.version);
    const operation = matching && Object.freeze({ ...matching });
    if (!operation) fail('OPERATION_UNAVAILABLE', 404);
    const decision = { caller, operation, transport, invocationId: admittedRequest.invocationId };
    if (!await options.deploymentEligible(decision)) fail('DEPLOYMENT_UNAVAILABLE', 503);
    if (!await options.authorize(decision, 'invoke', admittedRequest.input)) fail('ACCESS_DENIED');
    // This must be backed by durable atomic state, not a per-process Set.
    if (!await options.consumeInvocation(caller, admittedRequest.invocationId, proofContext)) fail('REPLAY_OR_BUDGET_EXHAUSTED', 409);

    const controller = new AbortController();
    const deadline = Math.min(caller.deadlineAt, caller.expiresAt, Date.now() + 30_000);
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('DEADLINE_EXCEEDED', 408);
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const abortError = () => new FacadeInvocationDenied(timedOut ? 'DEADLINE_EXCEEDED' : 'CANCELLED', 408);
    try {
      const stopped = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
        if (controller.signal.aborted) reject(abortError());
      });
      const work = async () => {
        if (operation.kind === 'workflow') {
          return options.invokePublishedWorkflow({ workspaceId: operation.targetWorkspaceId, workflowId: operation.workflowId!, version: operation.version }, admittedRequest.input, controller.signal);
        }
        const services = options.facade.services as Record<string, unknown>;
        if (!own(services, operation.serviceId!)) fail('OPERATION_UNAVAILABLE', 404);
        const service = services[operation.serviceId!] as { execute?: (name: string, input: unknown, context?: unknown) => unknown };
        if (typeof service?.execute !== 'function') fail('OPERATION_UNAVAILABLE', 404);
        return service.execute(operation.serviceOperation!, admittedRequest.input, { signal: controller.signal, transport });
      };
      const output = await Promise.race([work(), stopped]);
      // Do not release an output based solely on the authorization made before execution.
      // Session revocation, deployment expiry, workflow unpublication and operation
      // version/dispatch-reference replacement must all take effect while work is running.
      // Luth invocation bearers are single-use: a second consuming introspection
      // would reject every legitimate result. Consult a distinct non-consuming
      // live Luth/session authority instead; fail closed if it is unavailable.
      const currentCaller = await options.revalidateLuthCaller(caller, options.targetAppId, proofContext);
      if (!currentCaller || !currentCaller.invoker || !Array.isArray(currentCaller.chain) ||
        !Number.isFinite(currentCaller.expiresAt) || currentCaller.expiresAt <= Date.now() ||
        !Number.isFinite(currentCaller.deadlineAt) || currentCaller.deadlineAt <= Date.now() ||
        currentCaller.audience !== options.targetAppId) fail('AUTH_INVALID', 401);
      if (!sameCallerIdentity(caller, currentCaller)) fail('CALLER_CHANGED', 401);
      const currentOperations = await options.listCurrentOperations(admittedRequest.targetWorkspaceId);
      if (!currentOperations.some(op => assertDescriptor(op) && sameDispatchReference(operation, op))) {
        fail('OPERATION_REVOKED', 403);
      }
      const currentDecision: FacadeDecision = { caller: currentCaller, operation, transport, invocationId: admittedRequest.invocationId };
      if (!await options.deploymentEligible(currentDecision)) fail('DEPLOYMENT_UNAVAILABLE', 503);
      if (!await options.authorize(currentDecision, 'output', output)) fail('ACCESS_REVOKED');
      if (controller.signal.aborted) throw abortError();
      return { output, replyTo: { ...currentCaller.invoker }, invocationId: admittedRequest.invocationId };
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
    // The same deadline/cancellation applies while minting and while dispatching.
    // Never retry an uncertain delivery: the target's durable invocation ID protects
    // side-effectful operations and retries need a separately proven delivery budget.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const abortError = () => new FacadeInvocationDenied(timedOut ? 'DEADLINE_EXCEEDED' : 'CANCELLED', 408);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const remaining = Math.min(caller.deadlineAt, caller.expiresAt, Date.now() + 30_000) - Date.now();
      if (remaining <= 0) fail('DEADLINE_EXCEEDED', 408);
      const stopped = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
        if (controller.signal.aborted) reject(abortError());
      });
      const forward = async () => {
        if (controller.signal.aborted) throw abortError();
        const delegated = await options.delegateCredential(caller, targetAppId, request.invocationId, controller.signal);
        if (controller.signal.aborted) throw abortError();
        if (!delegated) fail('DELEGATION_DENIED');
        return dispatch(delegated, request, controller.signal);
      };
      return await Promise.race([forward(), stopped]);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
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
        return Response.json(await invoke(credential, await parseJson(request) as FacadeInvocation, 'http', request.signal), { headers: { 'Cache-Control': 'no-store' } });
      }
      return errorResponse(new FacadeInvocationDenied('NOT_FOUND', 404));
    } catch (error) { return errorResponse(error); }
  }

  async function mcp(request: Request): Promise<Response> {
    let id: unknown = null;
    try {
      const credential = bearer(request);
      // tools/list and tools/call perform their own admission verification
      // inside discover/invoke. Do not consume a one-use Luth bearer twice.
      const body = await parseJson(request) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' ||
        typeof body.method !== 'string') fail('INVALID_MCP_REQUEST', 400);
      id = body.id ?? null;
      // Administrative MCP methods still require authenticated admission.
      if (body.method !== 'tools/list' && body.method !== 'tools/call') await callerFor(credential);
      if (body.method === 'notifications/initialized' && body.id === undefined) {
        return new Response(null, { status: 202 });
      }
      if (body.id === undefined || (typeof body.id !== 'string' && typeof body.id !== 'number')) {
        fail('INVALID_MCP_REQUEST', 400);
      }
      if (body.method === 'initialize') {
        return Response.json({ jsonrpc: '2.0', id, result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'kloks-backend-facade', version: '1.0.0' },
        } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (body.method === 'tools/list') {
        const workspace = body.params?.workspaceId;
        if (typeof workspace !== 'string') throw new FacadeInvocationDenied('INVALID_WORKSPACE', 400);
        const operations = await discover(credential, workspace, 'mcp');
        return Response.json({ jsonrpc: '2.0', id, result: { tools: operations.map(op => ({
          name: op.id, description: op.name,
          inputSchema: {
            type: 'object',
            properties: {
              version: { type: 'string', const: op.version },
              targetWorkspaceId: { type: 'string', const: op.targetWorkspaceId },
              invocationId: { type: 'string', minLength: 1, maxLength: 128 },
              input: {},
            },
            required: ['version', 'targetWorkspaceId', 'invocationId', 'input'],
            additionalProperties: false,
          },
          _meta: { version: op.version, targetWorkspaceId: op.targetWorkspaceId },
        })) } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (body.method === 'tools/call') {
        const params = body.params;
        let invocation: FacadeInvocation;
        if (typeof params?.name === 'string') {
          const args = params.arguments;
          if (!args || typeof args !== 'object' || Array.isArray(args) ||
            Object.keys(args).some(key => !['version', 'targetWorkspaceId', 'invocationId', 'input'].includes(key)) ||
            own(params, 'invocation')) fail('INVALID_MCP_REQUEST', 400);
          const values = args as Record<string, unknown>;
          invocation = {
            operationId: params.name,
            version: values.version as string,
            targetWorkspaceId: values.targetWorkspaceId as string,
            invocationId: values.invocationId as string,
            input: values.input,
          };
        } else {
          // Temporary legacy adapter; both request forms share the same target guard.
          invocation = params?.invocation as FacadeInvocation;
        }
        const result = await invoke(credential, invocation, 'mcp', request.signal);
        const output = result.output ?? null;
        const structuredContent = output && typeof output === 'object' && !Array.isArray(output)
          ? output : { value: output };
        return Response.json({ jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent, isError: false,
        } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, { status: 404 });
    } catch (error) {
      const denied = error instanceof FacadeInvocationDenied ? error : new FacadeInvocationDenied('INTERNAL_ERROR', 500);
      return Response.json({ jsonrpc: '2.0', id, error: { code: denied.status, message: denied.code } },
        { status: denied.status, headers: { 'Cache-Control': 'no-store' } });
    }
  }

  return { discover, invoke, delegate, http, mcp };
}
