import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { AuditViewportPreset, LoadTimingSummary, Stage5Config } from "./types.js";

export async function launchAuditBrowser(config: Stage5Config): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: config.headless,
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
  config: Stage5Config,
): Promise<BrowserContext> {
  const deviceDescriptor = preset.deviceDescriptor ?? {};

  return browser.newContext({
    ...deviceDescriptor,
    viewport: preset.viewport,
    screen: preset.viewport,
    ignoreHTTPSErrors: true,
    userAgent: typeof deviceDescriptor.userAgent === "string" ? deviceDescriptor.userAgent : undefined,
    javaScriptEnabled: true,
    bypassCSP: true,
    serviceWorkers: "block",
    locale: "en-US",
  });
}

export async function createAuditPage(context: BrowserContext, config: Stage5Config): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(config.pageTimeoutMs);
  page.setDefaultNavigationTimeout(config.pageTimeoutMs);
  return page;
}

export async function collectLoadTimingSummary(page: Page): Promise<LoadTimingSummary | null> {
  try {
    return await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const nav = navigation ? JSON.parse(JSON.stringify(navigation)) : null;
      if (nav) {
        return {
          domContentLoadedMs:
            Number.isFinite(nav.domContentLoadedEventEnd) && nav.domContentLoadedEventEnd >= 0
              ? Number(nav.domContentLoadedEventEnd.toFixed(1))
              : null,
          loadMs:
            Number.isFinite(nav.loadEventEnd) && nav.loadEventEnd >= 0
              ? Number(nav.loadEventEnd.toFixed(1))
              : null,
          responseStartMs:
            Number.isFinite(nav.responseStart) && nav.responseStart >= 0
              ? Number(nav.responseStart.toFixed(1))
              : null,
          firstByteMs:
            Number.isFinite(nav.responseStart) && nav.responseStart >= 0
              ? Number(nav.responseStart.toFixed(1))
              : null,
          durationMs:
            Number.isFinite(nav.duration) && nav.duration >= 0
              ? Number(nav.duration.toFixed(1))
              : null,
        };
      }

      const timing = performance.timing;
      if (!timing || !timing.navigationStart) return null;
      const navigationStart = timing.navigationStart;

      return {
        domContentLoadedMs:
          Number.isFinite(timing.domContentLoadedEventEnd - navigationStart) &&
          timing.domContentLoadedEventEnd - navigationStart >= 0
            ? Number((timing.domContentLoadedEventEnd - navigationStart).toFixed(1))
            : null,
        loadMs:
          Number.isFinite(timing.loadEventEnd - navigationStart) && timing.loadEventEnd - navigationStart >= 0
            ? Number((timing.loadEventEnd - navigationStart).toFixed(1))
            : null,
        responseStartMs:
          Number.isFinite(timing.responseStart - navigationStart) && timing.responseStart - navigationStart >= 0
            ? Number((timing.responseStart - navigationStart).toFixed(1))
            : null,
        firstByteMs:
          Number.isFinite(timing.responseStart - navigationStart) && timing.responseStart - navigationStart >= 0
            ? Number((timing.responseStart - navigationStart).toFixed(1))
            : null,
        durationMs:
          Number.isFinite(timing.loadEventEnd - navigationStart) && timing.loadEventEnd - navigationStart >= 0
            ? Number((timing.loadEventEnd - navigationStart).toFixed(1))
            : null,
      };
    });
  } catch {
    return null;
  }
}
