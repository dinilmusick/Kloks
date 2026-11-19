import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  createConsentedUiAgentAccess, type UiAgentConsentGrant,
  type VerifiedUiAgentCaller, type UiAgentActionRequest,
} from './uiSessionAgentAccess.js';

// CI installs Chromium in an isolated Playwright host runtime.
// This is a real-browser consent boundary regression, NOT deployed Luth E2E.
const playwrightRoot = process.env.PLAYWRIGHT_RUNTIME_PATH;
const run = playwrightRoot ? describe : describe.skip;
const tabA = '2743a144-98ac-4be0-a90b-f8868237d1cb';
const tabB = 'f7d89b23-f537-4a54-a9b5-a462ad41d0e3';
const rev = '63599882-203c-43e1-a9c7-60322e1507b1';
const queued = 'f63f7f3b-d6e4-4c99-9ee0-5b26973647b6';
const origin = 'https://aiko.example';
function caller(userId: string, workspaceId: string): VerifiedUiAgentCaller {
  return {
    userId, workspaceId, appId: 'aiko', appOrigin: origin,
    sessionId: 'luth-' + userId, sessionExpiresAt: 8000,
  };
}

run('real browser windows with host-simulated Luth/target authority', () => {
  it('isolates two browser contexts, approval, expiry, revocation, closure, and session switching',
    async () => {
      const require = createRequire(import.meta.url);
      // Playwright is only loaded when the CI host has installed the browser runtime.
      const { chromium } = require(playwrightRoot + '/node_modules/playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const aContext = await browser.newContext();
        const bContext = await browser.newContext();
        for (const context of [aContext, bContext]) {
          await context.route('https://aiko.example/**', (route: any) =>
            route.fulfill({
              status: 200, contentType: 'text/html',
              body: '<!doctype html><title>Approved window</title><button id="approved">Action</button>',
            }));
        }
        const aWindow = await aContext.newPage();
        const bWindow = await bContext.newPage();
        await Promise.all([aWindow.goto(origin + '/'), bWindow.goto(origin + '/')]);
        expect(aWindow).not.toBe(bWindow);
        expect(aWindow.url()).toBe(origin + '/');
        expect(bWindow.url()).toBe(origin + '/');

        const alice = caller('alice', 'workspace-A');
        const bob = caller('bob', 'workspace-B');
        const grants = new Map<string, UiAgentConsentGrant>([
          ['window-A', {
            ...alice, consented: true, windowId: 'window-A', tabId: tabA,
            grantId: 'grant-alice-1', origin, expiresAt: 5000,
            permissions: ['inspect', 'action'],
          }],
          ['window-B', {
            ...bob, consented: true, windowId: 'window-B', tabId: tabB,
            grantId: 'grant-bob-1', origin, expiresAt: 5000,
            permissions: ['inspect', 'action'],
          }],
        ]);
        const windows = new Map([
          ['window-A', aWindow], ['window-B', bWindow],
        ]);
        let clock = 1000;
        let aliceSessionLive = true;
        let allowAction = true;
        let queuedCount = 0;
        const access = createConsentedUiAgentAccess({
          now: () => clock,
          verifyCaller: (session: unknown) => {
            if (session === 'alice-session' && aliceSessionLive) return alice;
            if (session === 'bob-session') return bob;
            return null;
          },
          authorizeWindow: async (_principal, windowId) => {
            const page = windows.get(windowId);
            return page && !page.isClosed() && page.url().startsWith(origin)
              ? grants.get(windowId) ?? null : null;
          },
          approveAction: async (_principal, _grant, action: UiAgentActionRequest) =>
            allowAction && action.componentId === 'approved' && action.controlId === 'click',
          sanitizeSnapshot: (_principal, _grant, value: unknown) =>
            ({ control: (value as { control: string }).control }),
          uiSession: async (request, auth) => {
            const page = windows.get(auth.windowId);
            const expected = auth.windowId === 'window-A' ? alice : bob;
            const tab = auth.windowId === 'window-A' ? tabA : tabB;
            const grant = grants.get(auth.windowId);
            // Independent test-target authority: no tab UUID alone is sufficient.
            if (!page || page.isClosed() || !grant || auth.principalId !== expected.userId ||
                auth.workspaceId !== expected.workspaceId || auth.sessionId !== expected.sessionId ||
                auth.grantId !== grant.grantId || auth.tabId !== tab ||
                !request.url.includes(tab)) {
              return Response.json({ error: 'denied' }, { status: 403 });
            }
            if (request.method === 'GET') {
              const control = await page.locator('#approved').textContent();
              return Response.json({
                session: { revision: rev, snapshot: {
                  control, secret: 'browser-secret-' + expected.userId,
                } },
              });
            }
            if (!allowAction) return Response.json({ error: 'action denied' }, { status: 403 });
            queuedCount++;
            return Response.json({ actionId: queued }, { status: 202 });
          },
        });
        const [a, b] = await Promise.all([
          access.inspect('alice-session', 'window-A'),
          access.inspect('bob-session', 'window-B'),
        ]);
        expect(a.snapshot).toEqual({ control: 'Action' });
        expect(b.snapshot).toEqual({ control: 'Action' });
        expect(JSON.stringify(a)).not.toContain('browser-secret');
        expect(JSON.stringify(b)).not.toContain('browser-secret');
        await expect(access.inspect('alice-session', 'window-B')).rejects.toThrow('consent');
        await expect(access.inspect('bob-session', 'window-A')).rejects.toThrow('consent');

        expect(await access.action('alice-session', 'window-A', {
          revision: rev, componentId: 'approved', controlId: 'click',
        })).toEqual({ windowId: 'window-A', actionId: queued, status: 'queued' });
        expect(queuedCount).toBe(1);
        allowAction = false;
        await expect(access.action('bob-session', 'window-B', {
          revision: rev, componentId: 'approved', controlId: 'click',
        })).rejects.toThrow('approval');
        expect(queuedCount).toBe(1);
        allowAction = true;

        await aWindow.close();
        await expect(access.inspect('alice-session', 'window-A')).rejects.toThrow('consent');
        grants.delete('window-B');
        await expect(access.inspect('bob-session', 'window-B')).rejects.toThrow('consent');

        // Restoring the consent cannot restore another Luth session.
        grants.set('window-B', {
          ...bob, consented: true, windowId: 'window-B', tabId: tabB,
          grantId: 'grant-bob-2', origin, expiresAt: 5000, permissions: ['inspect'],
        });
        await expect(access.inspect('alice-session', 'window-B')).rejects.toThrow('consent');
        clock = 5000;
        await expect(access.inspect('bob-session', 'window-B')).rejects.toThrow('consent');
        clock = 1000;
        aliceSessionLive = false;
        await expect(access.inspect('alice-session', 'window-B')).rejects.toThrow('Luth session');
        await bWindow.close();
        await Promise.all([aContext.close(), bContext.close()]);
      } finally {
        await browser.close();
      }
    }, 45000);
});
