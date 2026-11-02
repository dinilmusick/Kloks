import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import type {
  InspectionCheck,
  InspectionCheckResult,
  InspectionError,
  PlaywrightInspectionRequest,
  PlaywrightInspectionResult,
} from './playwrightInspectionTypes.js';

type PageLike = {
  on(event: string, handler: (...args: any[]) => void): void;
  goto(url: string, options: object): Promise<{ status(): number } | null>;
  waitForLoadState(state: string, options: object): Promise<void>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
  locator(selector: string): {
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    innerText(): Promise<string>;
    click(): Promise<void>;
    fill(value: string): Promise<void>;
  };
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<Buffer>;
  close(): Promise<void>;
};
type BrowserLike = {
  newContext(options: object): Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>;
  close(): Promise<void>;
};
type PlaywrightModule = { chromium: { launch(options: object): Promise<BrowserLike> } };

const require = createRequire(import.meta.url);

function loadPlaywright(): PlaywrightModule {
  try { return require('playwright') as PlaywrightModule; }
  catch { throw new Error('Playwright is required for browser inspection. Install the optional "playwright" package and Chromium browser.'); }
}

function error(errors: InspectionError[], kind: InspectionError['kind'], message: string, url?: string, status?: number, method?: string) {
  errors.push({ kind, message, ...(url ? { url } : {}), ...(status ? { status } : {}), ...(method ? { method } : {}) });
}

async function runCheck(page: PageLike, check: InspectionCheck): Promise<InspectionCheckResult> {
  try {
    const locator = page.locator(check.selector);
    if (await locator.count() === 0) throw new Error('Selector matched no elements');
    if (check.visible !== undefined && await locator.isVisible() !== check.visible) throw new Error(`Expected visible=${check.visible}`);
    if (check.text !== undefined && !(await locator.innerText()).includes(check.text)) throw new Error(`Expected text containing: ${check.text}`);
    if (check.action?.type === 'click') await locator.click();
    if (check.action?.type === 'fill') await locator.fill(check.action.value ?? '');
    return { selector: check.selector, passed: true };
  } catch (cause) {
    return { selector: check.selector, passed: false, details: cause instanceof Error ? cause.message : String(cause) };
  }
}

export class PlaywrightInspectionRuntime {
  async inspect(request: PlaywrightInspectionRequest): Promise<PlaywrightInspectionResult> {
    const started = Date.now();
    const errors: InspectionError[] = [];
    const checks: InspectionCheckResult[] = [];
    const screenshots: string[] = [];
    const screenshotDirectory = request.screenshotDirectory ?? join(process.cwd(), 'artifacts/playwright', String(started));
    const reportPath = request.reportPath ?? join(screenshotDirectory, 'report.json');
    const timeout = request.timeoutMs ?? 15000;
    let browser: BrowserLike;
    try { browser = await loadPlaywright().chromium.launch({ headless: true }); }
    catch (cause) {
      error(errors, 'browser', cause instanceof Error ? cause.message : String(cause), request.url);
      const result: PlaywrightInspectionResult = {
        ok: false, url: request.url, durationMs: Date.now() - started,
        errors, checks, screenshots, reportPath,
      };
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
      return result;
    }
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const page = await context.newPage();
    let status: number | undefined;
    let title: string | undefined;
    let domSnapshot: string | undefined;

    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') error(errors, 'console', message.text(), page.url());
    });
    page.on('pageerror', cause => error(errors, 'pageerror', cause instanceof Error ? cause.stack ?? cause.message : String(cause), page.url()));
    page.on('requestfailed', requestInfo => error(errors, 'requestfailed', requestInfo.failure()?.errorText ?? 'Request failed', requestInfo.url(), undefined, requestInfo.method()));
    page.on('response', response => {
      if (response.status() >= 400) error(errors, 'http', `HTTP ${response.status()} ${response.statusText()}`, response.url(), response.status(), response.request().method());
    });
    page.on('crash', () => error(errors, 'crash', 'Browser page crashed', page.url()));
    page.on('dialog', async dialog => {
      error(errors, 'dialog', `Unexpected ${dialog.type()} dialog: ${dialog.message()}`, page.url());
      await dialog.dismiss();
    });

    try {
      try {
        const response = await page.goto(request.url, { waitUntil: request.waitUntil ?? 'networkidle', timeout });
        status = response?.status();
      } catch (cause) {
        error(errors, 'navigation', cause instanceof Error ? cause.message : String(cause), request.url);
      }
      try { await page.waitForLoadState('domcontentloaded', { timeout }); } catch {}
      try { title = await page.title(); } catch {}
      for (const check of request.checks ?? []) checks.push(await runCheck(page, check));
      for (const viewport of request.viewports ?? [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        try {
          await page.setViewportSize(viewport);
          {
            await mkdir(screenshotDirectory, { recursive: true });
            const path = join(screenshotDirectory, `inspection-${viewport.width}x${viewport.height}.png`);
            await page.screenshot({ path, fullPage: true });
            screenshots.push(path);
          }
        } catch (cause) { error(errors, 'screenshot', cause instanceof Error ? cause.message : String(cause), request.url); }
      }
      if (request.captureDom) {
        try {
          const html = await page.content();
          domSnapshot = html.slice(0, request.maxDomCharacters ?? 40000);
        } catch (cause) { error(errors, 'dom', cause instanceof Error ? cause.message : String(cause), request.url); }
      }
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
    for (const check of checks) if (!check.passed) error(errors, 'assertion', check.details ?? 'Inspection assertion failed', request.url);
    const result: PlaywrightInspectionResult = {
      ok: errors.length === 0,
      url: request.url,
      ...(title ? { title } : {}),
      ...(status !== undefined ? { status } : {}),
      durationMs: Date.now() - started,
      errors,
      checks,
      screenshots,
      reportPath,
      ...(domSnapshot ? { domSnapshot } : {}),
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

const runtime = new PlaywrightInspectionRuntime();
export const PlaywrightInspectionServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.playwrightInspection',
  name: 'PlaywrightInspectionService',
  version: '1.0.0',
  operations: {
    inspect: {
      id: 'PlaywrightInspectionService.inspect',
      name: 'inspect',
      handler: async (input: PlaywrightInspectionRequest) => runtime.inspect(input),
    },
  },
});

export const PlaywrightInspectionServiceFacade = {
  id: PlaywrightInspectionServiceDefinition.id,
  name: PlaywrightInspectionServiceDefinition.name,
  version: PlaywrightInspectionServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'local' as const,
  definition: PlaywrightInspectionServiceDefinition,
  createInstance: () => createService(PlaywrightInspectionServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => {
    const instance: IService = createService(PlaywrightInspectionServiceDefinition);
    await instance.start();
    return instance.call<TIn, TOut>(op, input);
  },
};
