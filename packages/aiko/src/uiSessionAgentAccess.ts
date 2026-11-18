/**
 * Host-authorized, consent-gated access to the existing Kloks UI-session API.
 * This is not an identity authority, window registry, UI executor or consent store.
 *
 * REQUIRED HOST CONTRACT:
 * - verifyCaller reads the live, non-revoked Luth session on EVERY call;
 * - authorizeWindow reads live consent, membership and a still-open window;
 * - grantId changes on each reissue/revocation; no cached grants;
 * - uiSession routes through the existing authenticated app UI-session API;
 * - the UI action consumer verifies its own live window and revision at dispatch.
 */
export interface VerifiedUiAgentCaller {
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
  /** Trusted Luth session identifier, NOT a model or browser-supplied value. */
  readonly sessionId: string;
  /** Unix milliseconds; verified against the live session, not JWT alone. */
  readonly sessionExpiresAt: number;
  /** Origin verified for this application deployment by the host. */
  readonly appOrigin: string;
}

export interface UiAgentConsentGrant {
  readonly grantId: string;
  readonly windowId: string;
  readonly tabId: string;
  readonly origin: string;
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
  /** A grant is valid for ONE live login, never all sessions of a user. */
  readonly sessionId: string;
  readonly consented: true;
  readonly expiresAt: number;
  readonly permissions: readonly ('inspect' | 'action')[];
}

export interface UiAgentActionRequest {
  readonly revision: string;
  readonly componentId: string;
  readonly controlId: string;
  readonly payload?: unknown;
}

export interface UiAgentAccessOptions {
  /** Verify Luth session, revocation, expiry and workspace server-side on each use. */
  readonly verifyCaller: (session: unknown) =>
    Promise<VerifiedUiAgentCaller | null> | VerifiedUiAgentCaller | null;
  /** Resolve only currently open, approved windows for the exact caller. */
  readonly authorizeWindow: (caller: VerifiedUiAgentCaller, windowId: string) =>
    Promise<UiAgentConsentGrant | null> | UiAgentConsentGrant | null;
  /** Human/user-controlled approval for this exact revision and action payload. */
  readonly approveAction: (caller: VerifiedUiAgentCaller, grant: UiAgentConsentGrant,
    action: UiAgentActionRequest) => Promise<boolean> | boolean;
  /** Mandatory trusted redaction of every snapshot before agent exposure. */
  readonly sanitizeSnapshot: (caller: VerifiedUiAgentCaller, grant: UiAgentConsentGrant,
    snapshot: unknown) => Promise<unknown> | unknown;
  /** Existing Luth-middleware-protected backend, not model-selected URL/fetch. */
  readonly uiSession: (request: Request, input: { appId: string; principalId: string }) =>
    Promise<Response | undefined>;
  readonly now?: () => number;
}

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionName = /^[\w.:-]{1,128}$/;

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('UI session operation cancelled.');
}
function baseUrl(origin: string): URL {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A verified HTTPS application UI origin is required.');
  }
  return url;
}
function assertCaller(caller: VerifiedUiAgentCaller | null, now: number):
  asserts caller is VerifiedUiAgentCaller {
  if (!caller || !caller.userId?.trim() || !caller.appId?.trim() ||
      !caller.workspaceId?.trim() || !caller.sessionId?.trim() ||
      caller.sessionId.length > 256 || !Number.isFinite(caller.sessionExpiresAt) ||
      caller.sessionExpiresAt <= now) {
    throw new Error('A verified, unexpired Luth session and active workspace are required.');
  }
}
/** Never reuse consent across users, sessions, workspaces, apps or tabs. */
export function createConsentedUiAgentAccess(options: UiAgentAccessOptions) {
  const now = options.now ?? Date.now;

  async function checked(session: unknown, windowId: string,
    permission: 'inspect' | 'action', signal?: AbortSignal) {
    assertNotCancelled(signal);
    const caller = await options.verifyCaller(session);
    assertNotCancelled(signal);
    assertCaller(caller, now());
    if (!windowId || windowId.length > 128) throw new Error('Invalid UI window identifier.');
    const grant = await options.authorizeWindow(caller, windowId);
    assertNotCancelled(signal);
    if (!grant || grant.consented !== true ||
        !grant.permissions?.includes(permission) || grant.windowId !== windowId ||
        !grant.grantId?.trim() || !uuidV4.test(grant.tabId) ||
        grant.userId !== caller.userId || grant.appId !== caller.appId ||
        grant.workspaceId !== caller.workspaceId ||
        grant.sessionId !== caller.sessionId ||
        !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now()) {
      throw new Error('UI session consent is missing, expired, revoked or for another session.');
    }
    const url = baseUrl(grant.origin);
    if (url.origin !== baseUrl(caller.appOrigin).origin) {
      throw new Error('The approved UI window is not on the verified application origin.');
    }
    return { caller, grant, url };
  }

  /** Check the same grant generation after every potentially slow async boundary. */
  async function rechecked(session: unknown, previous: Awaited<ReturnType<typeof checked>>,
    permission: 'inspect' | 'action', signal?: AbortSignal) {
    const current = await checked(session, previous.grant.windowId, permission, signal);
    if (current.caller.sessionId !== previous.caller.sessionId ||
        current.grant.grantId !== previous.grant.grantId ||
        current.grant.tabId !== previous.grant.tabId ||
        current.grant.origin !== previous.grant.origin) {
      throw new Error('UI session approval is stale, replaced or revoked.');
    }
    return current;
  }

  async function callUi(current: Awaited<ReturnType<typeof checked>>,
    method: 'GET' | 'POST', body?: UiAgentActionRequest, signal?: AbortSignal) {
    assertNotCancelled(signal);
    const { grant, url } = current;
    const request = new Request(new URL('/api/ui-session/' + grant.tabId +
      (method === 'POST' ? '/action' : ''), url.origin), {
      method, signal,
      headers: method === 'POST'
        ? { Origin: url.origin, 'Content-Type': 'application/json' }
        : { Origin: url.origin },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    const response = await options.uiSession(request, {
      appId: current.caller.appId, principalId: current.caller.userId,
    });
    assertNotCancelled(signal);
    if (!response || response.status !== (method === 'GET' ? 200 : 202)) {
      throw new Error('The approved UI window is unavailable or the requested action was denied.');
    }
    return response;
  }

  async function readRevision(response: Response, signal?: AbortSignal) {
    const document: unknown = await response.json();
    assertNotCancelled(signal);
    const session = document !== null && typeof document === 'object' && 'session' in document
      ? document.session : undefined;
    const revision = session !== null && typeof session === 'object' && 'revision' in session
      ? session.revision : undefined;
    if (typeof revision !== 'string' || !uuidV4.test(revision)) {
      throw new Error('UI session revision is unavailable.');
    }
    return { revision, session };
  }

  return Object.freeze({
    async inspect(session: unknown, windowId: string, signal?: AbortSignal) {
      const current = await checked(session, windowId, 'inspect', signal);
      const response = await callUi(current, 'GET', undefined, signal);
      const { revision, session: document } = await readRevision(response, signal);
      const snapshot = document !== null && typeof document === 'object' && 'snapshot' in document
        ? document.snapshot : undefined;
      const sanitized = await options.sanitizeSnapshot(current.caller, current.grant, snapshot);
      assertNotCancelled(signal);
      if (sanitized === undefined || sanitized === null) {
        throw new Error('UI snapshot redaction rejected the result.');
      }
      // Never return a snapshot captured before sign-out, switch, revoke or close.
      await rechecked(session, current, 'inspect', signal);
      return { windowId, revision, snapshot: sanitized };
    },
    async action(session: unknown, windowId: string, input: UiAgentActionRequest,
      signal?: AbortSignal) {
      if (!input || !uuidV4.test(input.revision) || !actionName.test(input.componentId) ||
          !actionName.test(input.controlId)) {
        throw new Error('Invalid approved UI action.');
      }
      let current = await checked(session, windowId, 'action', signal);
      // The tab must still be open and the revision current BEFORE prompting.
      const before = await readRevision(await callUi(current, 'GET', undefined, signal), signal);
      if (before.revision !== input.revision) {
        throw new Error('UI action revision is stale.');
      }
      current = await rechecked(session, current, 'action', signal);
      const approved = await options.approveAction(current.caller, current.grant, input);
      assertNotCancelled(signal);
      if (!approved) throw new Error('User approval for the exact UI action was denied.');
      current = await rechecked(session, current, 'action', signal);
      // Backend rejects closed tabs, non-advertised controls and stale revisions.
      // Cancellation before dispatch prevents queueing. An already queued command
      // must be cancelled by the host UI action consumer, not this overlay.
      const response = await callUi(current, 'POST', input, signal);
      const result: unknown = await response.json();
      assertNotCancelled(signal);
      const actionId = result !== null && typeof result === 'object' && 'actionId' in result
        ? result.actionId : undefined;
      if (typeof actionId !== 'string' || !uuidV4.test(actionId)) {
        throw new Error('UI action acceptance receipt is invalid.');
      }
      return { windowId, status: 'queued' as const, actionId };
    },
  });
}
