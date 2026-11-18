# Authenticated owning-workspace publication reconciliation (W6 precursor)

This is a **target-side FOD package boundary**, stacked on Kloks W1–W5.
It is not a Skipo registry migration, a consumer discovery endpoint, or a
production enablement change.

## Host lifecycle

After **authenticated Luth session + application/workspace hydration** on
startup, resume or reconnect, the owning application constructs one
FodPublicationReconciler:

- **targetAppId**: canonical immutable app ID configured by the owning host;
  never taken from request JSON, query string, registry rows or a user header.
- **resolveAuthenticatedWorkspaces**: fresh host-side enumeration of workspaces
  owned by the authenticated Luth principal, with authoritative app owner
  and workspace owner IDs. Return null while logged out. No user-owned
  metadata may be replayed before this function returns verified scopes.
- **verifyStillAuthorized**: re-resolve the Luth principal and exact workspace
  permissions immediately before **each workspace** is replayed.
- **createRuntime**: create a workspace-bound FodRuntime using the **same**
  canonical owner/app scope and server-side SQL publication sink. Supply
  authorizePublicationReconciliation(workspaceId) that checks fresh Luth
  and workspace ownership. It is mandatory for runtime reconciliation,
  including checks before **each flow's** metadata write. The coordinator
  also compares the runtime's host-configured app, owner and workspace
  scope against the independently verified Luth scope before any replay.

Call reconciler.reconcile() after each authenticated startup/reconnect.
Overlapping lifecycle notifications are serialized, not dropped. Each queued
notification independently re-resolves the current session. An unauthenticated
bootstrap returns zero replayed records, without constructing a runtime.

For each persisted workflow, the existing FodFlowStore replays only the
**latest workspace-owned publication intent**. A private save remains private;
withdrawal tombstones win over delayed publish retries; a delete-pending
workflow is retired only after successful withdrawal synchronization.
A missing/corrupt record or failed sink is retained for a later retry.

A refused scope fails closed; if access changes between workspaces, the
remaining workspaces are not replayed. If access changes during one workspace
replay, the per-flow authorization gate rejects subsequent metadata writes.

## Authority boundaries

- Do not enumerate globally indexed workflow handles to decide what to
  publish. The workspace-owned saved document is authoritative.
- Do not replicate graph definitions, node content, credentials, input/output,
  access tokens or whole-workspace documents to the capability registry.
- Do not expose reconciliation through a browser/client-facing public API.
  Calls are host-owned lifecycle work under server-side authorization.
- Clearing a browser session is not grant revocation. A caller's next
  execution must still check the **target-side active grant and publication**
  (W4/W5) on every call; cached capability handles never authorize execution.
- This boundary is **same-owner only** (v1). Cross-user sharing requires a
  separately approved grant and authorization model.

## Verification and remaining integration gates

The publicationReconciler.test.ts suite uses the existing FOD runtime and
workspace store to cover logged-out denial, forged/duplicate scopes,
interrupted publish replay, deferred delete tombstone, per-flow
reauthorization, inter-workspace Luth revocation and concurrent reconnect
notifications.

Full acceptance additionally requires integration of these callbacks in the
actual Aiko/FOD application hosts (web and native), source-storage provider
compare-and-swap semantics across processes, hard cancellation/fencing of
**already in-flight** SQL writer calls on logout, authenticated registry
discovery invalidation, independent N5 SQL migration replay, and end-to-end
Luth/Skipo/Kloks cross-app transport verification. The package alone does not
solve those external contracts or prove a production deployment.
