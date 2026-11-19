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


## Concrete staged Luth #23 + Skipo #208 adapters

The Kloks connectivity surface now exports:

- createLuthFacadeBearerIssuer — invokes Luth /api/oauth/delegate with a protected source LUTH-SESSION-V1 assertion, owner-approved scope and exact versioned resource key, and validates audience, token type, scope and expiry.
- createLuthFacadeTargetAuthorities — consumes the one-use proof using /api/oauth/introspect, then independently checks the separately signed receipt using /api/oauth/revalidate. The admission receipt remains in a server-only WeakMap keyed by the original trusted admission object. It never enters a response or published workflow metadata.
- createSkipoFacadeDeploymentResolver — calls Skipo createVerifiedCapabilityDiscovery.list/revalidate, enforces exact numeric revisions, and requires a *separate trusted registrar* lease/endpoint/workspace proof. The Skipo discovery record does not contain lease expiry, so no caller-provided or fabricated lease may substitute.

Example host-only composition (import these exports from @kloks/backend/connectivity):

    const resolveDeployment = createSkipoFacadeDeploymentResolver({
      environment: 'production',
      discovery: skipo.createVerifiedCapabilityDiscovery(trustedQuery, verifiedPolicy),
      getAuthenticatedRequest: host.getProtectedLuthDiscoveryRequest,
      inspectAttestedLease: registrar.readVerifiedLeaseAndWorkspace,
    });

    const getAudienceBearer = createLuthFacadeBearerIssuer({
      luthOrigin: host.approvedLuthOrigin,
      getSourceSessionAssertion: host.getSourceLuthAssertion,
      resolveIntent: ownerGrants.resolveExactInvocationIntent,
    });

    const remote = createFacadeRemoteClient({
      environment: 'production',
      resolveDeployment,
      approveOrigin: host.authorizeRegistryOriginAndEgress,
      getAudienceBearer,
    });

    const luthTarget = createLuthFacadeTargetAuthorities({
      luthOrigin: host.approvedLuthOrigin,
      targetAppId: host.canonicalAppId,
      getTargetSessionAssertion: host.getTargetLuthAssertion,
      resolveResource: ownerGrants.resolveExactResourceKey,
      resolveTrustedCaller: host.resolveServerVerifiedInvoker,
      recheckTrustedCaller: host.revalidateInvokerSessionAndBudget,
    });
    const target = createFacadeInvocationBoundary({
      targetAppId: host.canonicalAppId,
      facade: host.existingBackendFacade,
      ...luthTarget,
      listCurrentOperations: ownerServices.listExactPublishedDescriptors,
      authorize: ownerServices.authorizeCurrentGrantAndACL,
      deploymentEligible: ownerServices.checkCurrentVerifiedLease,
      consumeInvocation: ownerBudgets.atomicConsumeInvocation,
      invokePublishedWorkflow: fodPublishedInterface.invokeExactOwnedWorkflow,
      delegateCredential: host.delegateNestedInvocation,
    });

All these callback owners are **mandatory**; there is no permissive production default.

**Security requirements:** The target assertion must be Luth-verified for the SAME live principal/session as the delegated source. An app-only static secret is insufficient. resolveTrustedCaller must obtain immediate invoker, chain, depth, deadlines and remaining-call budget from protected server state; no identity claim in the caller JSON is trusted. resolveResource must match the exact Skipo capability revision or FOD owner-published workflow version and current owner grant. For static capabilities the Kloks version must be a canonical decimal positive integer, e.g. "2" for Skipo revision 2. "v2", "02" and latest-version fallback are rejected.

The output receipt is consumed locally at most once; errors, timeout and revocation deny output. Target-side operation, deployment and grant authorization is rechecked independently, under the inherited deadline. Registrar proof/read access remains server-only under least-privilege database roles.

### Cross-repository candidate-head contract checkpoint

- Luth #23: 3ba5b687cc23b5fc4dedde5babb76a3451f0daad — delegation, one-use admission, output receipt.
- Skipo #208: 8e92502c5538bb239be1e860da40093b194f37e4 — Luth-scoped capability discovery and trusted-registrar lease contract.
- Kloks FOD #124: 6eb1c4a49ab2edeadb1779b2a475b0c8d48ea615 — owner workflow and output-time grant contracts.

The new facadeCrossAppContracts.integration.test.ts exercises Luth→Skipo→Kloks with two in-process application endpoints, authorization, revocation, retry/replay and concurrency. Its Luth and Skipo services use accurate staged response shapes but simulated endpoints: this is *not* a live OAuth/Neon dual-deployment certificate. Do not merge or deploy without coordinated upstream integration, real registered grants/registrar permissions and an independently witnessed two-user/two-deployment E2E.


## Skipo verified deployment-instance binding (PR #208 follow-up)

Skipo PR #208 added `CapabilitySelector.deploymentId?: string` and
`resolveVerifiedCapabilityDeployment(..., deploymentId?)` so a capability
selector can pin its **exact attested deployment UUID**, not merely application,
environment, capability and revision. The corresponding source head is
`f1f4bb4cffdd3e9482c19b4790b649d19dedd3bd`.

The remote client now passes the original authenticated deployment ID into
`resolveDeployment(..., expectedDeploymentId)` immediately before sending its
one-use Luth proof **and again after execution before returning output**.
`createSkipoFacadeDeploymentResolver` forwards the ID into Skipo
`revalidate` as `selector.deploymentId` and independently rejects any
mismatched ID returned by a registry adapter. For catalog discovery, the
resolver filters the Skipo `list` result against the original deployment ID.
The new argument is optional so host resolvers predating #208 still typecheck,
but trusted deployments MUST be compared against the original handle at both
post-admission checks. Missing, expired, switched or revoked exact instances
fail closed; a newer instance with an identical app/capability/revision is
**not** a permitted substitute. This does not add cross-deployment retries.

The dedicated Skipo tests verify selectors `[undefined, originalDeploymentId,
originalDeploymentId]`, wrong-instance substitution before network dispatch,
wrong-instance substitution after execution, malformed UUID denial and
cross-instance catalog-list substitution.


## Published FOD workflow invocation — distinct from static Skipo capability revisions

The existing target-side createFacadeInvocationBoundary handles current kind=workflow descriptors by calling the owning app's invokePublishedWorkflow. The caller-side remote client now provides an explicit invokeWorkflow operation for this path, without misusing the Skipo static capability registry or falling back from denied static operations.

The host must construct createFodWorkflowDeploymentResolver with THREE mandatory trusted callbacks:

1. authorizeCurrentWorkflow(appId,targetWorkspaceId,operation,signal): current owner-published exact workflow version, active owner grant, live Luth principal, source/target workspace authorization and scope. Return only opaque IDs, not private workflow graphs.
2. locateVerifiedWorkflowHost(reference,environment,signal,expectedDeploymentId?): trusted Skipo owning application deployment locator independent of a static capability descriptor. Never trust a user-supplied URL, APP_URL or legacy unverified ticket.
3. inspectAttestedLease(reference,candidate,environment,signal): independent registrar check of immutable app/deployment identity, workspace, environment, origin, proof validity, lease freshness and terminal revocation.

Pass the created callback to createFacadeRemoteClient as resolveWorkflowDeployment. Call remote.invokeWorkflow(targetAppId,{operationId,version,targetWorkspaceId,invocationId,input}). The remote obtains a fresh Luth workflow.invoke credential bound to the current exact resource and checks the SAME verified deployment UUID before sending and again after execution. The target independently verifies Luth, owning-app FOD publication/current revision, grant, replay budget, deadline and output authority through its original BackendFacade. No clone of the private workflow graph or second workflow engine is involved.

The Luth source issuer now rejects backend.invoke for an explicit workflow, and workflow.invoke for a static API. Do not infer a workflow route from a failed static lookup or trust the caller's selector as a grant.

Workflow callback wiring remains owner-host responsibility and can only be live-certified after staged FOD Kloks PR #124, Luth #23, Skipo #208 and isolated Neon schema are integrated. New FOD fixture tests exercise real Kloks target guard with versioned grant, revoked publication, revoked output, missing independent workflow authority, verified host expiry and changed deployment instance. They are fixtures, not live two-user deployed Neon acceptance evidence.


### Owning FOD executor: trusted Luth-admitted context, no second consumption

The target FacadeInvocationOptions.invokePublishedWorkflow callback now receives a fourth, server-only FacadeTrustedWorkflowContext argument containing: immutable targetAppId; a frozen signed caller snapshot (principal, app, source workspace, live session ID, verified immediate invoker, ancestry/depth and deadline/budget); immutable operation+version; and the exact Luth admission authority context including invocationId and transport. The context is not sent to the remote caller and contains no bearer, signing secret or output receipt.

An owning FOD host that calls its registered FOD execution command MUST propagate this already single-use-admitted context through a protected local transport scope. Do NOT re-run consuming Luth /api/oauth/introspect inside the FOD host; it would always reject an already-consumed valid invocation. FOD's verifyInvocation callback must validate this trusted canonical admission context plus the CURRENT owning workspace, publication version, owner grant, source+target scope and budget. The outer target guard independently performs non-consuming Luth output receipt revalidation and live grant/deployment checks before releasing any output. A FOD host may also revalidate its own live current permission; it cannot skip target-side final checks.

The trusted context must remain request-local; do not store it in workspace files, workflow graphs, global tables, URLs, analytics or browser state. FOD nested child invocations require separately audience-bound Luth credentials, fresh scoped grants, current ancestry/budget and explicit host consent. Never reuse or replay the parent bearer or its output-only receipt for nested admission. If request-scoped context propagation is unavailable, disable nested cross-app execution and fail closed.
