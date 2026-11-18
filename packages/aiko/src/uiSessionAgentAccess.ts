/** Authorization overlay for the existing Kloks /backend/ui-session service.
 * No UI state, consent, identity or agent catalogue is persisted here.
 * Host supplies Luth verification, workspace/window grants and redaction policy.
 */
export interface VerifiedUiAgentCaller {
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
}
export interface UiAgentConsentGrant {
  readonly grantId: string;
  readonly windowId: string;
  readonly tabId: string;
  readonly origin: string;
  readonly userId: string;
  readonly appId: string;
  readonly workspaceId: string;
  readonly consented: true;
  readonly expiresAt: number;
  readonly permissions: readonly ('inspect' | 'action')[];
}
export interface UiAgentAccessOptions {
  /** Trusted session only; never a model-supplied caller or principal. */
  readonly verifyCaller: (session: unknown) => Promise<VerifiedUiAgentCaller | null> | VerifiedUiAgentCaller | null;
  /** Fetch active owner/workspace/window consent and revocation status on each access. */
  readonly authorizeWindow: (caller: VerifiedUiAgentCaller, windowId: string) =>
    Promise<UiAgentConsentGrant | null> | UiAgentConsentGrant | null;
  /** Require explicit approval of each UI action, independently of session consent. */
  readonly approveAction: (caller: VerifiedUiAgentCaller, grant: UiAgentConsentGrant,
    action: { componentId: string; controlId: string; payload: unknown }) => Promise<boolean> | boolean;
  /** Mandatory snapshot redaction, enforced on the server before exposure to an agent. */
  readonly sanitizeSnapshot: (caller: VerifiedUiAgentCaller, grant: UiAgentConsentGrant,
    snapshot: unknown) => Promise<unknown> | unknown;
  /** Delegates to the existing handleUiSessionRequest after canonical Luth middleware. */
  readonly uiSession: (request: Request, input: { appId: string; principalId: string }) =>
    Promise<Response | undefined>;
  readonly now?: () => number;
}

const tabPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionPattern = /^[\w.:-]{1,128}$/;
function trust(caller: VerifiedUiAgentCaller | null): asserts caller is VerifiedUiAgentCaller {
  if (!caller || !caller.userId?.trim() || !caller.appId?.trim() || !caller.workspaceId?.trim()) {
    throw new Error('A verified Luth caller and active workspace are required.');
  }
}
function baseUrl(origin: string): URL {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A trusted HTTPS UI session origin is required.');
  }
  return url;
}

/**
 * Current consent is always reloaded. A model cannot name an arbitrary tab,
 * change the workspace, approve an action, or set the reply destination.
 */
export function createConsentedUiAgentAccess(options: UiAgentAccessOptions) {
  const now = options.now ?? Date.now;
  async function checked(session: unknown, windowId: string, permission: 'inspect' | 'action') {
    const caller = await options.verifyCaller(session);
    trust(caller);
    if (!windowId || windowId.length > 128) throw new Error('Invalid UI window identifier.');
    const grant = await options.authorizeWindow(caller, windowId);
    if (!grant || grant.consented !== true || !grant.permissions?.includes(permission) ||
        grant.windowId !== windowId || !grant.grantId?.trim() || !tabPattern.test(grant.tabId) ||
        grant.userId !== caller.userId || grant.appId !== caller.appId ||
        grant.workspaceId !== caller.workspaceId || !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt <= now()) {
      throw new Error('UI session consent is missing, expired or revoked.');
    }
    const url = baseUrl(grant.origin);
    return { caller, grant, url, remainingMs: Math.max(1, grant.expiresAt - now()) };
  }
  async function callUi(grant: UiAgentConsentGrant, url: URL,
    method: 'GET' | 'POST', body?: unknown): Promise<Response> {
    const request = new Request(new URL('/api/ui-session/' + grant.tabId +
      (method === 'POST' ? '/action' : ''), url.origin), {
      method, headers: method === 'POST'
        ? { Origin: url.origin, 'Content-Type': 'application/json' }
        : { Origin: url.origin },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    const response = await options.uiSession(request, { appId: grant.appId, principalId: grant.userId });
    if (!response || ![200, 202].includes(response.status)) {
      throw new Error('The approved UI tab is unavailable or the requested action was denied.');
    }
    return response;
  }
  return Object.freeze({
    async inspect(session: unknown, windowId: string) {
      const { caller, grant, url } = await checked(session, windowId, 'inspect');
      const response = await callUi(grant, url, 'GET');
      const document = await response.json() as { session?: { revision?: unknown; snapshot?: unknown } };
      const revision = document?.session?.revision;
      if (typeof revision !== 'string' || !tabPattern.test(revision)) {
        throw new Error('UI session revision is unavailable.');
      }
      const snapshot = await options.sanitizeSnapshot(caller, grant, document.session?.snapshot);
      if (snapshot === undefined || snapshot === null) throw new Error('UI snapshot redaction rejected the result.');
      return { windowId, revision, snapshot };
    },
    async action(session: unknown, windowId: string, input: {
      revision: string; componentId: string; controlId: string; payload?: unknown;
    }) {
      const { caller, grant, url } = await checked(session, windowId, 'action');
      if (!tabPattern.test(input.revision) || !actionPattern.test(input.componentId) ||
          !actionPattern.test(input.controlId)) throw new Error('Invalid approved UI action.');
      const approved = await options.approveAction(caller, grant, {
        componentId: input.componentId, controlId: input.controlId, payload: input.payload,
      });
      if (!approved) throw new Error('User approval for the UI action was denied.');
      // Re-check identity, grant generation, tab and revocation after awaiting approval.
      const current = await checked(session, windowId, 'action');
      if (current.grant.grantId !== grant.grantId ||
          current.grant.tabId !== grant.tabId || current.grant.origin !== grant.origin) {
        throw new Error('UI session approval is stale or revoked.');
      }
      const response = await callUi(current.grant, current.url, 'POST', {
        revision: input.revision, componentId: input.componentId,
        controlId: input.controlId, payload: input.payload,
      });
      const document = await response.json() as { actionId?: unknown };
      if (response.status !== 202 || typeof document?.actionId !== 'string') {
        throw new Error('UI session action was not accepted.');
      }
      return { windowId, status: 'queued' as const, actionId: document.actionId };
    },
  });
}
