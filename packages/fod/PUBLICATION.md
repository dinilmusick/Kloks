# FOD workflow publication lifecycle (W2)

This is an **opt-in, server-side** extension of the canonical Kloks/FOD workspace store.
It depends on the W1 workspace-revision work (Kloks PR #93) and Skipo's
metadata-only `skipo_ecosystem.workflow_publications` migration (Skipo PR #165).

## Host wiring

Provide `FodRuntime` with a trusted, authenticated Luth principal's canonical
`appId` / `ownerUserId` and a server-side `publication.sink`. Construct a
sink with `createSqlFodPublicationSink(query)`, where `query` is the host's
authorized parameterized Postgres executor. Also pass an
`authorizePublication(action, workspaceId, flowId)` callback that **must**
check current Luth identity, ownership and workspace permissions at each call.
There is no browser-side authority or implicit authorization default.

Do not pass caller-provided owner IDs to this configuration. Do not permit
client sessions, public APIs, or cross-app callers to use the registry-writer
database credential. Skipo registry tables are private metadata, **not**
authorization grants for invoking workflows.

- `saveFlow` creates a private versioned workflow in its original workspace
  file. Nothing enters the global catalog without `publishFlow`.
- `publishFlow` explicitly records publication intent inside the workspace
  file and atomically withdraws older published revisions while upserting the
  selected latest version's metadata. It does **not** grant other apps access.
- `saveFlow` on an already published workflow republishes its new immutable
  revision. A private workflow stays private after subsequent saves.
- `unpublishFlow` marks the workspace record withdrawn and retires every
  exposed revision for that workflow; no private definition is copied.
- `deleteFlow` marks an indexed flow withdrawn, syncs that withdrawal and only
  then deletes the owner document. On registry failure deletion fails closed,
  keeping a workspace tombstone for reconnection.
- `reconcilePublications` resends source-owned publication intent on startup
  or reconnect. Sink upserts and withdrawals are idempotent. It is the host's
  responsibility to invoke reconciliation and retry failed operations.

The only synchronized fields are canonical app ID, Luth owner user ID, owning
workspace ID, stable workflow ID, immutable version, display name, description,
and published/withdrawn state. Never index full graph definitions, edges,
nodes, execution input/output, provider keys or other workspace contents.

## Security and rollout limits

This PR does **not** implement cross-app invocation or grant enforcement.
All requests to read, discover or execute a workflow must recheck the target
owner, workspace, active publication version, and owner-approved caller grant
at the owning backend on every hop; metadata discovery is never sufficient.
Until those authorization services are deployed, this feature must remain
disabled for unauthenticated and untrusted hosts.

Deployment/production and merge are not part of this PR. Verify on an isolated
branch using private-workflow, owner/workspace/version separation, failed sink,
reconnection and negative-path tests before enabling the feature.
