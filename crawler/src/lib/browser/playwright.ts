import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { AuditViewportPreset } from "./devices.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.STAGE5_PAGE_TIMEOUT_MS || 30000);
const RENDER_WAIT_MS = Number(process.env.STAGE5_RENDER_WAIT_MS || 1200);
const LOAD_TIMING_SCRIPT = `(() => {
  function round(value) {
    if (!Number.isFinite(value) || value < 0) return null;
    return Number(value.toFixed(1));
  }

  const navigation = performance.getEntriesByType("navigation")[0];
  if (navigation) {
    const nav = JSON.parse(JSON.stringify(navigation));
    return {
      domContentLoadedMs: round(nav.domContentLoadedEventEnd),
      loadMs: round(nav.loadEventEnd),
      responseStartMs: round(nav.responseStart),
      firstByteMs: round(nav.responseStart),
      durationMs: round(nav.duration),
    };
  }

  const timing = performance.timing;
  if (!timing || !timing.navigationStart) return null;

  const navigationStart = timing.navigationStart;
  return {
    domContentLoadedMs: round(timing.domContentLoadedEventEnd - navigationStart),
    loadMs: round(timing.loadEventEnd - navigationStart),
    responseStartMs: round(timing.responseStart - navigationStart),
    firstByteMs: round(timing.responseStart - navigationStart),
    durationMs: round(timing.loadEventEnd - navigationStart),
  };
})()`;

export function getDefaultTimeoutMs(): number {
  return DEFAULT_TIMEOUT_MS;
}

export async function launchAuditBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: process.env.STAGE5_HEADLESS !== "0",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Unable to launch Playwright Chromium. If browsers are missing, run: npx playwright install chromium\n${message}`,
    );
  }
}

export async function createAuditContext(
  browser: Browser,
  preset: AuditViewportPreset,
): Promise<BrowserContext> {
  const deviceDescriptor = preset.deviceDescriptor ?? {};

  return browser.newContext({
    ...deviceDescriptor,
    viewport: preset.viewport,
    screen: preset.viewport,
    ignoreHTTPSErrors: true,
  });
}

export async function createAuditPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
  return page;
}

export async function waitForRenderedUi(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(DEFAULT_TIMEOUT_MS, 5000) });
  } catch {
    // Dynamic apps often keep connections open. Best-effort only.
  }

  await page.waitForTimeout(RENDER_WAIT_MS);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

export async function collectLoadTimingSummary(page: Page): Promise<{
  domContentLoadedMs: number | null;
  loadMs: number | null;
  responseStartMs: number | null;
  firstByteMs: number | null;
  durationMs: number | null;
} | null> {
  try {
    return await page.evaluate(function runTimingScript(scriptSource) {
      return (0, eval)(scriptSource);
    }, LOAD_TIMING_SCRIPT);
  } catch {
    return null;
  }
}
