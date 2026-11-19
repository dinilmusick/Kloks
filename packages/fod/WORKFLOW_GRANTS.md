# FOD workflow grants

FOD workflow definitions and revision graphs remain in the target owner's
workspace. The `skipo_ecosystem.workflow_publications` table is discovery
metadata only; `workflow_grants` records only an owner-approved app/workspace
scope. Neither table stores graph JSON, inputs, outputs, credentials or secrets.

## V1 sharing boundary

A workflow owner can grant the current published version to one registered
caller app and one source workspace. The target workspace is the owner workspace
containing the workflow. The caller app, source workspace, target app, target
workspace and workflow are all part of the grant scope.

V1 is intentionally same-principal only: the verified Luth user, target app
owner, target workspace owner, caller app owner and source workspace owner
must all be the same user. Cross-user delegation is denied. Caller identity
must come from the current Luth session and canonical app/workspace ownership
records, never request-body IDs, forwarded headers or a catalog descriptor.

## Host wiring

Construct `FodRuntime` with:

- `publication` from a trusted host context containing the canonical
  target app ID and Luth owner ID.
- `workflowGrantStore` from `createSqlFodWorkflowGrantStore` and a
  server-side PostgreSQL query adapter.
- `authorizeWorkflowGrant` bound to the current Luth session. It must
  resolve the current principal and verify ownership/ACL for both apps and
  workspaces, returning the owner IDs required by `FodWorkflowGrantApproval`.
- `authorizePublication` for publish/unpublish, independently bound to
  the verified owner.

The `grantFlow` and `revokeFlow` facade operations fail closed when
any of those dependencies is missing. Granting requires a current local
published revision and an active registry publication. The SQL insert selects
that exact publication row under a share lock and stores only app/workspace
scope. Regrant is an idempotent update of the same immutable scope row.

Revocation updates every publication version for the exact app/source
workspace/target workspace/workflow scope. The target-side
`createSqlFodPublishedWorkflowAuthorizer` resolves a fresh Luth caller and
queries the current published version and active grant on every invocation.
A stale or cached discovery descriptor is not sufficient; a revoked grant
causes the next target authorization check to fail.

Do not expose `executePublishedFlow` through a public remote facade until
the consuming host is wired to the per-request Luth and target-grant
authorizer. Do not enable production cross-app invocation from these package
primitives alone.
