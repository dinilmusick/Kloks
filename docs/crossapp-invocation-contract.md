# Kloks authenticated cross-application invocation contract (pre-integration)

> **Status:** host-owned contract on the draft #111 → #115 stack; **not a production deployment or integration certification**.
> The existing `BackendFacade` is the sole execution authority. This module is a
> security boundary around it, **not** a second service/registry/workflow runtime.

## Host-supplied authorities (all mandatory)

Import `createFacadeInvocationBoundary` from `@ultrst-armada/kloks/backend`
(or `@kloks/backend/connectivity` inside the monorepo). Supply:

| Callback | Owner and required invariant |
| --- | --- |
| `verifyLuthCredential(rawBearer, targetAppId)` | Luth: validate signature, **audience**, expiry, live session, revocation, delegated chain, principal and verified immediate invoker on every request and again before output |
| `listCurrentOperations(workspaceId)` | Skipo + owner-app adapter: currently eligible immutable static capability revisions and explicitly published workflow references **only** |
| `authorize(decision, phase, value?)` | Owning app: current owner, user, source/target workspace, grant, scope, operation and input/output policy. Called for discover, invoke and output |
| `deploymentEligible(decision)` | Skipo: verified application/deployment identity, environment, live lease and eligibility on every call and before output |
| `consumeInvocation(caller, invocationId)` | Durable shared atomic budget/replay debit, scoped to caller, app/workspace, operation and identity; no per-process Set in production |
| `invokePublishedWorkflow(reference, input, signal)` | Owning FOD app resolves exact saved workflow reference and executes its existing runtime; never globally copy workflow graphs/secrets |
| `delegateCredential(caller, targetAppId, invocationId, signal?)` | Luth delegation: atomically reserve inherited budget and mint signed audience-bound proof; honor cancellation |

For `static` operations, the existing `facade.services[serviceId].execute(serviceOperation, input, {signal, transport})`
runs on the target. Registration/authorization **must** ensure this executor is server-owned;
untrusted callers cannot choose arbitrary service implementations.

The target will reject a request with unknown/retired `operationId + version`,
revoked grant, unavailable deployment, missing signed proof, replay, invalid handle,
deadline expiry or a cross-app cycle. Its output is discarded if any fresh authorization,
caller or deployment check fails.

## HTTP

The target mounts **exactly** the exported handlers behind:

- `GET /api/crossapp/operations?workspace=<targetWorkspaceId>` with `Authorization: Bearer <Luth proof>`.
  Response: `{ "operations": [{ "id", "version", "name", "kind", "targetWorkspaceId" }] }`.
  No unapproved operation, raw workflow definition, provider secret or arbitrary owner ID appears.
- `POST /api/crossapp/invoke` with the same Authorization header, `Content-Type: application/json`,
  and body `{ "operationId": "Math.add", "version": "v1", "targetWorkspaceId": "workspace-B", "invocationId": "unique-uuid-or-handle", "input": { "a": 2, "b": 3 } }`.
  Response: `{ "output": ..., "replyTo": { "kind": "app-agent", "id": "verified-id" }, "invocationId": "..." }`.

The caller **must not** supply user IDs, agent reply-to IDs, delegated identity fields,
access grants, target deployment URLs or workflow storage references in the body.
Use a verified Skipo deployment target and an audience-bound credential acquired
through Luth. Never follow HTTP redirects with credentials to unverified origins.

## MCP

The same boundary's `mcp(request)` supports:

1. JSON-RPC 2.0 `initialize` (protocol version `2025-06-18`), then
   `notifications/initialized` (HTTP 202).
2. `tools/list` with `params: { "workspaceId": "workspace-B" }`. Every
   authorized tool has `name: operation.id`, `inputSchema`, and immutable
   `_meta.version` / `_meta.targetWorkspaceId`. A host should publish **one active
   version per operation name per workspace** so tool names remain unambiguous.
3. `tools/call` with `params: { "name": "Math.add", "arguments":
   { "version": "v1", "targetWorkspaceId": "workspace-B",
   "invocationId": "unique-id", "input": { "a": 2, "b": 3 } } }`.

Each MCP invocation uses the identical `invoke` guard as HTTP, graph and agent
calls. The legacy `params.invocation` request form is transitional; consumers
should switch to the standard MCP tool name and arguments.

## Graph/agent and nested delegation

Graph and Aiko application/endpoint/workflow agents call
`boundary.invoke(credential, invocation, 'graph' | 'agent', parentSignal)`.
To call another verified app, use `boundary.delegate(credential, targetAppId,
invocation, dispatch, signal)`; the supplied `dispatch` is the existing transport
adapter. It MUST deliver the newly delegated credential as a bearer header (never
JSON), preserve the immutable `invocationId` correlation and abort signal, and route
the reply to the **verified immediate invoker**, not user/model-provided reply-to.

Each target checks the currently signed chain and re-authorizes every nested hop.
Cross-app returns to a prior app are denied, while bounded same-app nesting is
allowed. The deadline is inherited and capped to 30 seconds; parent cancellation
aborts the target call. Durable call-count debits belong to `consumeInvocation`
and `delegateCredential`.

**Retries:** no automatic replay of uncertain or side-effectful requests.
A host may retry only after proving the attempt was *not delivered* and atomically
reserving retry budget against the same durable invocation identity. Generic transport
exceptions are **not** non-delivery proof. Until the compatible host-owned
idempotency/retry adapter is integrated, fail closed rather than duplicate effects.

## Required independent integration certification

Before treating this as production-ready: run an actual two-deployment test
(Luth → Skipo verified target → Kloks target BackendFacade → owning FOD or static
service → immediate-caller reply). Exercise revoked live sessions, grants and
deployments, cross-user/workspace access, wrong audience, operation revisions,
malformed requests, concurrent invocations, deadlines, cancellation, nested
cycles, replay/retry and rollback. Verify independent signatures, current workspace
permissions and absence of raw workflow/secret disclosures. Unit fixtures and
isolated GitHub CI cannot replace that test.

**Dependencies:** Kloks #111/#115; #94/#112 immediate-caller stack;
Kloks #96 canonical caller-authorized directory (already merged); Luth signed
delegation; Skipo verified registry; FOD owning-app publication/ACL; consumer wiring.
