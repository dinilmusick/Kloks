# Scoped discovery of published FOD workflows (W7 FOD-owned prerequisite)

The owning application can expose a **metadata-only discovery operation**
using createSqlFodWorkflowDiscovery. This does not change or duplicate the
shared Kloks HTTP/MCP transport, Skipo verified deployment directory, or the
existing FOD workflow grant writer.

## Host configuration

Supply the immutable, host-configured targetAppId, server-side parameterized
PostgreSQL query adapter, W4 grant store and three trusted Luth/owner callbacks:

1. verifyDiscovery(trustedContext) resolves a fresh Luth user, registered
   source and target app ownership, source workspace owner and the explicit
   set of allowed target workspaces. None of these identities is accepted
   from client-supplied JSON, a forwarded header, a sessionId string or a
   cached capability descriptor.
2. verifyStillAuthorized(trustedContext,verified,workspaceId) reauthenticates
   the current Luth user and the exact workspace before EACH descriptor is
   evaluated and again immediately before it is returned.
3. getCurrentPublishedRevision(workspaceId,workflowId,version,verified)
   reads the current published revision from the OWNING FodFlowStore. A
   newer version, explicit withdrawal, delete-pending record, deleted workflow,
   or offline local revision edit suppresses stale index visibility.

The SQL joins workflow_publications with workflow_grants for the exact active
version, same owner, caller app, source workspace and allowed target workspace.
A second fresh W4 grant check runs after the owning-workspace read so a
revocation that lands during that read prevents returning an old handle.

The result is an allowlisted immutable handle:
targetAppId, targetWorkspaceId, workflowId, version, displayName, and
optional description. No graph, source document, node data, credentials,
input/output values or independently invokable URL may be returned.

## Security and lifecycle

- Default private: no index row exists before explicit publish.
- No cross-user v1 delegation. The verified Luth user must own source app,
  source workspace, target app and every target workspace.
- Index presence does not authorize execution. Use the existing W5
  target-side BackendFacade command and its two independent fresh grant
  checks for each actual invocation.
- A cached descriptor may persist in a consumer UI; it is never a bearer
  capability. Revoked grants and withdrawn/stale source versions cannot
  be discovered by a new request and cannot execute even if cached.
- Reconciliation after offline edit, startup or reconnect must use the
  authenticated W6 owner-workspace replay coordinator. Do not derive
  publication intent from old global index rows.
- No production route is activated by this package. The runtime agent owns
  transport; the Aiko owner agent must wire these trusted callbacks from
  the canonical Luth and Skipo ownership sources.

## Verification and merge dependencies

FOD unit tests exercise in-memory owning workspace publication, stale and
withdrawn revisions, revoked grants, malformed and cross-owner metadata,
empty scope, duplicate descriptors, Luth session loss and parameterized
SQL query shape. Exact-head CI and architecture checks are mandatory.

This FOD-only PR is stacked after #116. Coordinating integration merges
after #93 → #98 → #103 → #110 → #113 → #116 and the verified N5
workflow publication/grant schema. Live Luth+Neon+Skipo+Kloks cross-app
certification is a separate acceptance gate.
