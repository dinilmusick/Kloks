# Verified cross-application BackendFacade integration

This module is **a wire adapter**, not a registry, identity authority, workflow engine, or second BackendFacade. Import `createFacadeRemoteClient` from `@kloks/backend/connectivity` (or the package's main backend export). Its target is the current `createFacadeInvocationBoundary` HTTP endpoint.

## Caller-side host requirements

- `resolveDeployment(appId, workspaceId, operation, signal)` MUST query the **authoritative Skipo registry**. It must return a verified ownership-attested app/deployment identity, exact workspace, environment, HTTPS origin, live lease, and eligibility for the *exact* operation ID and immutable version. For discovery, return only an eligible, workspace-authorized deployment. No caller-provided URL, raw deployment origin or self-asserted `verified` value may be accepted.
- `approveOrigin(origin, deployment)` MUST independently enforce the registry-attested origin and host-controlled network egress and DNS restrictions. The client checks origin shape but cannot enforce network isolation alone. The before/after/just-before-send checks are **not** an alternative to Skipo authority.
- `getAudienceBearer(deployment, operation, signal)` MUST request a **fresh**, target-audience-bound Luth proof for each call, with the authenticated source app/session/user, source and target workspaces, scope, grant, resource and immutable version bound by the issuer. Never treat a client-supplied bearer, arbitrary URL or serialized principal as that proof. A discovery authorization/grant contract must be agreed with Luth before the discovery endpoint is deployed.
- Each caller must pass an independently generated, durable invocation ID (unique per authorized logical attempt); no automatic replay or retry after uncertain delivery. Host-owned atomics reserve retry and remaining-call budgets, and the target's `consumeInvocation` must be durable across processes.
- A local verified immediate-caller router is authoritative for replies. The remote `replyTo` field is dropped even on success. Do not route responses from remote JSON.

## Target-side host requirements

Compose `createFacadeInvocationBoundary` with mandatory real authorities:

1. `verifyLuthCredential`: **single consuming** Luth invocation admission for a registered exact target audience. Validate current session, grant, scope, workspace, app, audience and delegated call provenance.
2. `revalidateLuthCaller`: independent, authenticated, **non-consuming** live Luth authority for the already admitted invocation. It must cover session, grant, user, caller/target app and workspace, audience, scope, expiry and revocation, and MUST NOT replay the one-use token or trust the original caller snapshot.
3. `listCurrentOperations`, `deploymentEligible`, `authorize`: current Skipo revisions and attested live leases, plus owning-app ACL and workflow grant state, re-read at output time; never copy private FOD definitions to the registry.
4. `consumeInvocation`: shared atomic replay/budget debit. No per-process in-memory fallback.
5. `invokePublishedWorkflow`: existing FOD owner-workspace execution interface. No workflow logic is duplicated in connectivity.

The guard passes the same immutable `FacadeInvocationAuthorityContext` — `operationId`, `version`, `targetWorkspaceId`, `invocationId`, and `transport` — as the third parameter to `verifyLuthCredential`, `revalidateLuthCaller`, and `consumeInvocation`. The host MUST bind the authenticated Luth proof/grant and atomic replay debit to these exact values. Never accept caller-side request mutation or a Luth verifier that ignores the bound scope. The output-time revalidation, publication, deployment and ACL checks are subject to the inherited deadline and cancellation, just like execution.

All HTTP, MCP, graph and agent target calls MUST enter through the same existing boundary, with explicit transport identities. The `/api/crossapp/invoke` JSON envelope is `{operationId,version,targetWorkspaceId,invocationId,input}` only, and bearer belongs solely in the Authorization header. Discovery is `GET /api/crossapp/operations?workspace=<id>`, subject to the target guard. HTTP redirects are rejected. Caller-side automatic retries are disabled.

## Current verification boundary

The remote adapter test uses real `Request`/`Response` and the Kloks target boundary with injected Luth and Skipo-shaped authorities. It is a contract fixture, **not a live Luth+Skipo two-deployment test**. As of this branch, Luth `src/backend/auth/crossAppDelegation.ts` provides consuming `/api/oauth/introspect`; a non-consuming live output authority is an upstream dependency. Skipo's current production deployment-resolution/lease contract and authorization must be wired and tested by the owning integration host. Until these are provided and independently run with distinct users/workspaces, no production certification, app deployment or database cutover is justified.

Required independent E2E: successful two-app operation and workflow invocation, unauthorized user/workspace denial, rotated lease/origin, revoked Luth session or grant while work is in flight, stale revision, replay, deadline/cancel, graph/agent/MCP routing, and evidence at exact repository SHAs.
