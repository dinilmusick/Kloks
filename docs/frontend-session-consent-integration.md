# Frontend session consent integration (Kloks / Aiko)

Status: **integration contract / draft**, not a production authorization certification.
Implementation: \`@kloks/aiko\` \`createConsentedUiAgentAccess\`.
Dependency: Kloks PR #114; security follow-up PR #120.

## Authorities

- **Luth** verifies the actual live user session. Never derive the user/session from a model response, a frontend-request body, caller-provided headers or JWT claims without session revocation checks.
- **Application host** resolves the authenticated application, verified deployment origin, active workspace membership and explicitly approved **live** window/tab. The opaque \`windowId\` is a host-resolved selector, not permission.
- **Consent host** stores/revokes grants, exposes separate \`inspect\` and \`action\` permissions and prompts for **each action**, including immutable UI revision and exact action JSON. Mint a fresh, unique \`grantId\` on every reissue; never reactivate a revoked generation.
- **Kloks \`handleUiSessionRequest\`** remains the frontend snapshot/advertised action queue. Both the HTTP/BackendFacade target and window consumer independently validate current Luth session, app, workspace, tab, revision and advertised control. The adapter does not introduce a new UI state store.
- **Floks Agent Chat / Graph** are presentation and invocation clients, not authorization authorities. Static frontend capability listing, graph navigation and agent selection must never inspect or click.

## Host installation

Construct \`createConsentedUiAgentAccess\` only on the **trusted application host**. All five callbacks are mandatory; an omitted callback must not be replaced with a permissive default. \`verifyCaller\` returns \`{userId, appId, workspaceId, sessionId, sessionExpiresAt, appOrigin}\` from the current server-verified session/registered deployment. \`authorizeWindow(caller, windowId)\` returns consent only while that exact tab remains live; \`UiAgentConsentGrant\` repeats the caller's user, app, workspace and session IDs, and includes a unique grant generation, HTTPS origin, UUID tab ID, permissions and short expiry.

\`inspect(session, windowId, signal?)\`: verify caller and consent → GET current tab snapshot via authenticated UI session → mandatory sanitize/redact → verify caller, window and consent generation **again** before returning anything. Return no unredacted snapshot.

\`action(session, windowId, input, signal?)\`: validate fields and serialize immutable JSON → verify caller/consent → GET current live revision (must equal requested) → verify again → prompt with exact revision, component/control and payload → verify again → POST the **captured** JSON to the existing advertised-control queue. A 202 queue receipt is **not** proof of successful UI execution.

Revocation events (sign-out, expiry, workspace switch, grant revoke, window closure, deployment withdrawal) must immediately invalidate host consent and any Floks session-scope state. The adapter revalidates on each access and after async steps. Abort signals are per-operation; aborting before POST prevents dispatch. If POST is already accepted, the **window consumer** must implement cancellation/terminal result reporting. This adapter cannot roll back an action already executed.

## Required downstream tests

1. Two tabs for the same user stay distinct; other active login of the same user is denied.
2. No access after logout, session expiry, workspace switch, wrong origin, grant revoke or tab closure.
3. Revocation during async redaction never leaks snapshot output.
4. No approval prompt for a stale tab/revision; approval binds exact payload and target.
5. Grant replacement, cancellation during approval, large or non-JSON payload and backend errors fail closed.
6. Exact-head Kloks build/typecheck/Vitest/architecture checks; two real authenticated windows in one deployed app; Floks Agent Chat and graph requests with independent target reauthorization.
7. Negative HTTP/MCP tests: direct raw \`/api/ui-session\` access with a known tab UUID but without current window-specific session consent must be denied. **This remains a consumer/BackendFacade integration requirement**, not supplied by the Aiko adapter alone.

Do not claim production browser automation or cross-app authorization certification based on Vitest fixtures alone. Keep the stack draft until independent live checks and Kloks/Floks consumer wiring pass.
