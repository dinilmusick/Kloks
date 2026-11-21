# Cross-app published FOD workflow — BackendFacade contract (W5 isolated)

This is an **isolated target-side integration** stacked on Kloks FOD W1 (#93),
W2 (#98), W3 (#103) and W4 (#110). The Skipo identity registry is reviewed
separately in Skipo #198. No production deployment, registration or merge.

## Stable callable operation

- **BackendFacade command:** fod.executePublishedWorkflow
- **Transport:** canonical Kloks BackendClient, resolver, BackendRegistry, and
  existing in-process/remote executor. No second service engine.
- **Request fields:** targetAppId, targetWorkspaceId, workflowId, version
  (positive immutable revision), optional input. App/workspace/workflow are
  stable opaque keys; the caller does not send any owner ID, grant or graph.
- **Success:** existing FodExecutionResult with success, flowId, output,
  outputs, errors and events. Source graphs, revision history, secrets and
  workspace contents are never returned.
- **Failure:** rejected handle, missing verified Luth identity, wrong owner,
  stale version, revoked grant, unpublished/withdrawn workflow, cycles or
  execution deadline.
- **Client:** the graph or consumer calls backend.fod.executePublishedWorkflow
  using the existing BackendClient. A registry descriptor is a discovery hint
  only, NOT authority or an independently invokable URL.

## Target host wiring

The trusted owning application installs
registerFodPublishedWorkflowBackendCommand(registry,options) and supplies:

1. targetAppId: canonical registered target app identity, host-configured.
2. verifyInvocation(transportContext,call): independently authenticate the
   current Luth user and verify ownership of the caller app, source workspace,
   target app and requested target workspace. Return a verified principal,
   exact resolved owner IDs, a trusted call chain and optional deadline/signal.
   Never treat Message.sessionId, forwarded headers, payload, registry
   descriptor or caller-provided chain as proof.
3. grantStore: existing W4 FodWorkflowGrantStore with N5 SQL. Query active
   publication and active exact-version app/source-workspace grant for EVERY
   request. V1 permits one common Luth owner only.
4. buildRuntime(workspaceId,verified): create a REQUEST-BOUND FodRuntime
   backed by the owning workspace and with authorizePublishedExecution
   configured, e.g. createSqlFodPublishedWorkflowAuthorizer. Never mutate a
   shared runtime's active user; concurrent requests may interleave.
5. withExecutionScope(verified,nextChain,signal,run): propagate attested
   ancestry, timeout and budgets to nested BackendFacade calls. Remote
   transports must protect or independently attest the chain at each hop.
   If authenticated propagation is not wired, disable nested remote calls.
6. maxDepth (default 8) and timeoutMs (default 30000). The earliest of the
   verified inherited deadline and local timeout governs the call. AbortSignal
   is cooperative; transport must enforce hard time limits for non-cooperative
   downstream operations.

Execution order: validate handle; verify Luth, app and workspace ownership;
deny cycles/depth; current exact-version grant check; construct a
request-bound owning FOD runtime; run its independent Luth/grant check; reload
the exact CURRENT published workspace revision AFTER that check; execute the
existing FOD engine. Never fetch or copy a remote workflow graph.

## Publication lifecycle

Owner calls canonical FOD saveFlow, publishFlow, unpublishFlow, grantFlow,
revokeFlow and deleteFlow; there is no separate grant API. Immutable revisions,
durable publication intent, delete-pending flags and retained tombstones
remain in owning workspace storage. Reconnect calls reconcilePublications
only after authorized workspace hydration. Delayed equal/older publish events
cannot revive a withdrawn version. Revocation is checked at execution even
with stale cached descriptors. A regrant creates a new active grant in W4.

Eligible connected consumer notifications must be built on the existing
authenticated scoped capability-event channel by another integration unit.
Do not broadcast private workflow names, graphs, grants or secrets.

## Graph/consumer contract

Each graph workflow operation node stores only the stable target
app/workspace/workflow/version handle, the caller's own input and optional
non-authoritative display metadata. Invoke the exact operation through the
BackendFacade. A nested call carries a trusted chain; cycle identity is
the app/workspace/workflow triple regardless of version (A→B→A is denied).
Existing FodExecutionResult outputs return to the original invoker.

## Acceptance and merge gates

The isolated adapter tests exercise real BackendRegistry and
InProcessExecutor, in-memory owned workspace revisions, and existing FOD
execution: same-owner, two users, same-named workspace IDs, private and
published flows, multiple versions, grant/revoke/regrant, withdrawal,
missing authorization, cycles, depth and deadlines.

NOT certified by this PR: a live authenticated cross-app transport,
Skipo #198 proof-qualified deployment resolver, hard transport timeouts,
scoped consumer notifications, complete storage-provider reconnect races,
independent N5 SQL fixtures, or integrated Kloks CI/typecheck/build.
Do not enable production invocation or merge this stack out of order.


## Aiko and other owning-app host adapter: output-time authorization

The owning application supplies the following callbacks to
`registerFodPublishedWorkflowBackendCommand` (no new graph engine):

```ts
{
  targetAppId: 'aiko', // host-configured, registered immutable app ID
  grantStore: createSqlFodWorkflowGrantStore(serverSql),
  verifyInvocation: (transportContext, handle) => admitSingleUseLuthInvocation(
    transportContext, handle
  ), // MUST return trusted invocationId AND luthSessionId
  revalidateResult: (transportContext, handle, admitted) =>
    revalidateLuthInvocationWithoutConsumingCredential(
      transportContext, handle, admitted
    ), // same invocation, live session, source+target scopes, audience, grant
  isCurrentPublishedVersion: async (handle, verified) =>
    Boolean(await owningWorkspaceFlowStore(verified).getCurrentPublishedRevision(
      handle.targetWorkspaceId, handle.workflowId, handle.version
    )),
  buildRuntime: (workspaceId, verified) =>
    existingAikoFodHost(verified).pinnedWorkflowExecutor(workspaceId),
  withExecutionScope: (verified, chain, signal, run) =>
    withAuthenticatedAikoScope(verified, chain, signal, run),
}
```

`verifyInvocation` is the **single-use admission**, not a reusable result checker.
`revalidateResult` MUST call a trusted **non-consuming** Luth authority:
running single-use introspection twice is an authentication failure, and
accepting a cached principal is a security failure. Both responses MUST
identify the same server-admitted `invocationId`, authenticated `luthSessionId`,
user, caller app, source workspace, target app and owning target workspace.
A different session or principal suppresses the result. An actual Luth session
ID is required; the BackendFacade message's untrusted `sessionId` is NOT proof.

The host's `isCurrentPublishedVersion` consults its live owning workspace,
not the registry. It MUST return false on edits, withdrawal, deletion, lost
storage, stale versions or mismatched workspace. The BackendFacade adapter
rechecks the active version and exact-version caller grant *after* the owner's
executor completes, before returning any output. If revocation or withdrawal
races execution, it rejects the output. The owner executor must independently
validate admission/grants and execute the original FOD/Aiko runtime; do not
clone private graphs into the global registry, create a second workflow engine
or trust a discovery descriptor as authority.

The `FodVerifiedPublishedInvocation` returned by the host includes
`invocationId` and `luthSessionId` alongside the existing canonical owner,
workspace, caller, chain, deadline and abort fields. Output revalidation may
not extend a previous deadline or allow a new caller/workspace. A denied
operation is an error, never a successful result with omitted data.

**Schema dependency for expiring grants:** the historical Skipo N5
`workflow_grants` contract contains `granted_at` and revocation state, but
does not yet contain an `expires_at`/lease column. Explicit TTL expiration
cannot be certified or made durable by this FOD package alone. The database
migration owner must add an immutable optional expiry and enforce it in active
grant lookup and discovery before enabling expiring grants; the FOD host must
fail closed for any requested expiry until the storage contract exists.
No production schema or transport is modified by this PR.
