# Consent adapter integration contract (Agent 11)
This file documents the scoped implementation; it does not grant access or certify real browser E2E.

Public APIs: `createConsentedUiAgentAccess` (host gateway) and `createSessionScopedConsentedUiAgentAccess` (recommended AppShell binding) in `uiSessionAgentAccess.ts`.
**Package index export requires AppShell/consumer owner coordination.** Do not add a permissive fallback if unresolved.

## Trusted host dependencies (all required)
- `verifyCaller(session)`: revalidate the **live** non-revoked Luth session and workspace membership for each operation, returning verified `userId`, `sessionId`, `sessionExpiresAt`, immutable `appId`, `workspaceId`, and registered HTTPS `appOrigin`. No claims from models, URL parameters or browser-supplied JWT metadata.
- `authorizeWindow(caller,windowId)`: read a currently open, explicitly consented browser window and UUID tab with permissions separately for `inspect` and `action`. Bind the exact user, Luth session, app, workspace, registered origin, window, tab, expiry, and new `grantId` on every issue. Close/revoke/switch disposes that generation immediately.
- `approveAction(caller,grant,action,signal?)`: actual user prompt for **every** action and its exact immutable JSON payload, advertised component/control, and revision. Listing a capability is never consent. The host MUST close a pending approval on `signal.abort`.
- `sanitizeSnapshot`: mandatory redaction of all sensitive data before sending to any model. Deny any unrecognized data; adapter revalidates after redaction to prevent disclosure during revocation races.
- `uiSession(request,context)`: authenticated host-only bridge into `handleUiSessionRequest`, not a raw model-provided fetch. The second argument now includes `appId`, `principalId`, `sessionId`, `workspaceId`, `windowId`, `tabId`, `grantId`, and read/action `permission`. The host MUST independently recheck them against the live session and currently approved window before it forwards a read or action; current backend API accepts only app/principal and does not perform all these checks itself. Do not expose raw `/api/ui-session/:tab` to agents.
- For action POST, window consumer MUST revalidate live session, active workspace, current advertised control, revision, grant/window liveness, and cancellation. HTTP 202 is a **queued receipt**, not execution success or rollback guarantee.

## AppShell / Agent Chat lifecycle
- Bind one `FrontendSession` to the exact active Luth session and workspace scope. Prefer `createSessionScopedConsentedUiAgentAccess(frontendSession, { userId, appId, workspaceId, appOrigin }, options)` with a **trusted** scope captured from the verified login. It rejects session/user/app/workspace/origin switches and automatically attaches abort controllers to `FrontendSession.trackAbortController`. On sign-out, workspace switch, window closure, deployment withdrawal, or grant revoke, dispose the relevant frontend scope and clear local session-scope state.
- Never infer target from model output; choose the approved host-resolved window and grant generation. Rehydrate grants only from authenticated host authority, never an old serialized graph.
- No cross-user, cross-session, cross-workspace or cross-window fallback. Propagate abort, refusal, backend denial and unavailable window; never return a fabricated successful click.
- The graph/chat owner needs an `@kloks/aiko` package entry export, and the Kloks backend owner must enforce a target-side consent gate and propagate terminal action/cancellation semantics.

## Verification
`pnpm --dir packages/aiko typecheck && pnpm --dir packages/aiko test`, backend disposal Vitest tests, architecture CI. Unit/target-simulation suites cover 2 users x 2 workspaces x 2 windows; they are **not real browser E2E**. External gate: run two authenticated real browser windows with production-matching Luth/AppShell and verify grant/revoke, expiry, closure, session switching and denied raw HTTP/MCP calls. Do not merge/certify until that gate is recorded.

## Queue receipt and redacted snapshot boundaries
- A sanitized snapshot is JSON-cloned and size-bounded before returning; callers cannot mutate the host-owned redaction object after the inspection to retroactively change its contents.
- After a POST returns `202`, the adapter revalidates live Luth/session/window/grant authority **again** before returning a queued receipt. Revocation during POST yields a rejected promise, but a command might already be in the target queue; host/window consumer must abort it and report a terminal status. This adapter cannot roll back effects.
- The scoped adapter uses structural `FrontendSession` methods instead of importing backend packages; it is a stable AppShell integration point and does not create a second identity/consent authority.

## Cancellation and typed error propagation
- `verifyCaller`, `authorizeWindow`, `sanitizeSnapshot`, and `approveAction` callbacks accept an optional `AbortSignal`. Hosts should propagate cancellation to network verification, live-window checks, redaction work and visible consent dialogs instead of only waiting for the adapter to reject.
- Invalid/denied backend responses throw `UiAgentAccessError` with a stable `code`: `BACKEND_DENIED` (HTTP 401/403), `WINDOW_CLOSED` (404), `REVISION_CONFLICT` (409), or `BACKEND_UNAVAILABLE` (no response/other status). `status` holds the HTTP code when present. The exception message deliberately excludes untrusted backend response bodies.
- Cancellation and stale-grant errors remain ordinary rejections. Frontends must display failure rather than converting rejection into a successful action.
