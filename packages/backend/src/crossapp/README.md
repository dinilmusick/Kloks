# Guarded three-tier BackendFacade dispatch

`createTieredFacadeDispatcher` is the transport-neutral caller-side interface exported by `@ultrst-armada/kloks/backend`. It does not create a second app, Luth issuer, database, deployment registrar, UDP socket, scheduler or target executor.

## Runtime order

- **Composed (Hubrys):** same-process installed capability → authenticated native peer → cloud.
- **Desktop:** authenticated local peer → cloud.
- **Cloud:** cloud only; deployments are ordered by *already-computed* DEPM capacity weights. Invokers do not calculate weights.

## Required host injection

1. **Luth:** `authenticate` and `revalidateCaller` must verify the official identity, current session, revocation and source app/workspace; never trust input claims or consume a one-use bearer twice.
2. **Publication:** `resolveOperation` must retrieve the live target operation, exact version, and authoritative read/write classification.
3. **Discovery:** `discover` returns only attested candidates. For `process`, resolve a composed capability. For `peer`, UDP beacons are **hints**, not credentials; verify the peer/lease over an authenticated transport. For `cloud`, query trusted Skipo/DEPM deployment state, not caller URLs or client-side database credentials.
4. **Target authority:** `validateTarget` verifies exact app, operation, version, target workspace, deployment and lease before invocation and output release.
5. **Grants:** `authorize` checks audience, user, caller app, target operation and workspace grants at invocation **and output time**. 401/403 never triggers a lower-tier retry.
6. **Delegation:** `mintAudienceProof` issues a fresh Luth audience-scoped proof per attempt; keep tokens out of JSON input and application logs.
7. **Execution:** `invokeTarget` calls the existing target-owned `createFacadeInvocationBoundary` or its guarded HTTPS endpoint, even in-process. Never directly bypass the target's authorization. The separately owned Kloks draft PR #123 provides an HTTPS adapter that may be connected after independent review.
8. **Uncertain writes:** `mayRetryUncertainWrite` may return true **only** on durable, atomic, cross-deployment deduplication for the same operation invocation ID. A local Set, per-node cache or optimistic HTTP header cannot justify replay.

Each operation enforces a bounded deadline and inherited cancellation. The dispatcher snapshots JSON input, denies malformed/oversized targets, checks Luth and grants before and after execution, and sanitizes unexpected host exceptions.

## Scope of verification

`tieredFacadeDispatcher.test.ts` exercises tier order, weighted failover, terminal authorization failures, in-flight revocation, deadline/abort, immutable request input and safe write deduplication. The isolated fixtures do **not** certify live Luth/Skipo authority, UDP communication, cloud heartbeat or Aiko/SRKL/Brwlr end-to-end operation. Run the full repository TypeScript, Vitest, packed export and exact-head CI gates before integration or publication.
