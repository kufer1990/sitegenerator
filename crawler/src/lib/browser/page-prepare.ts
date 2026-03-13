import type { Page } from "playwright";

import type { AuditNotice, ObstructionDetected, PagePreparationResult, Stage5Config } from "./types.js";

function pushNotice(target: AuditNotice[], code: string, message: string): void {
  if (!target.some(item => item.code === code && item.message === message)) {
    target.push({ code, message });
  }
}

async function waitForBestEffortNetworkIdle(page: Page, config: Stage5Config, notes: string[]): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: config.networkIdleTimeoutMs });
    notes.push("Reached best-effort network idle.");
  } catch {
    notes.push("Network idle wait timed out; continuing with rendered page state.");
  }
}

async function resetViewportPosition(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

async function awakenLazyLoadedMedia(page: Page, config: Stage5Config, notes: string[]): Promise<void> {
  if (!config.awakenLazyLoadEnabled) return;

  const documentHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
  const viewportHeight = page.viewportSize()?.height || config.desktopViewport.height;
  const steps = Math.min(4, Math.max(1, Math.ceil(documentHeight / Math.max(viewportHeight, 1))));

  for (let index = 1; index <= steps; index += 1) {
    const y = Math.min(documentHeight, Math.floor((documentHeight / steps) * index));
    await page.evaluate(scrollY => window.scrollTo({ top: scrollY, left: 0, behavior: "auto" }), y);
    await page.waitForTimeout(150);
  }

  await resetViewportPosition(page);
  notes.push("Awakened lazy-loaded media with a short scroll pass.");
}

async function dismissCommonPopups(page: Page, config: Stage5Config, notes: string[]): Promise<void> {
  if (!config.popupDismissalEnabled) return;

  const popupSelectors = [
    "button",
    "a[role='button']",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
  ].join(",");

  const keywords = [
    "accept",
    "agree",
    "allow",
    "close",
    "dismiss",
    "continue",
    "ok",
    "got it",
    "understood",
    "i understand",
    "accept all",
    "allow all",
    "cookies",
    "consent",
    "zgadzam",
    "akceptuj",
    "akceptuje",
    "zamknij",
    "rozumiem",
    "kontynuuj",
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clickedLabel = await page.evaluate(
      function invokePopupDismissRuntime({ selectorList, keywordList }) {
        const runtime = (window as typeof window & Record<string, unknown>).__VISUAL_AUDIT_RUNTIME__ as
          | { dismissCommonPopups?: (args: { selectorList: string; keywordList: string[] }) => string | null }
          | undefined;
        if (!runtime || typeof runtime.dismissCommonPopups !== "function") {
          return null;
        }
        return runtime.dismissCommonPopups({ selectorList, keywordList });
      },
      {
        selectorList: popupSelectors,
        keywordList: keywords,
      },
    );

    if (!clickedLabel) {
      if (attempt === 0) {
        await page.keyboard.press("Escape").catch(() => undefined);
      }
      continue;
    }

    notes.push(`Dismissed popup/banner via "${clickedLabel}".`);
    await page.waitForTimeout(250);
  }
}

async function detectObstructions(page: Page): Promise<ObstructionDetected[]> {
  return page.evaluate(function invokeObstructionRuntime() {
    const runtime = (window as typeof window & Record<string, unknown>).__VISUAL_AUDIT_RUNTIME__ as
      | { detectObstructions?: () => ObstructionDetected[] }
      | undefined;
    if (!runtime || typeof runtime.detectObstructions !== "function") {
      return [];
    }

    return runtime.detectObstructions();
  });
}

export async function preparePageForAudit(
  page: Page,
  url: string,
  config: Stage5Config,
): Promise<PagePreparationResult> {
  const notes: string[] = [];
  const warnings: AuditNotice[] = [];
  const errors: AuditNotice[] = [];
  let pageLoadStatus: PagePreparationResult["pageLoadStatus"] = "ok";
  let statusCode: number | null = null;

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.pageTimeoutMs,
    });
    statusCode = response?.status() ?? null;
    notes.push("Navigation reached DOMContentLoaded.");
  } catch (error) {
    pageLoadStatus = "partial";
    pushNotice(
      warnings,
      "NAVIGATION_TIMEOUT",
      error instanceof Error ? error.message : "Navigation failed before DOMContentLoaded.",
    );
  }

  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (error) {
    pageLoadStatus = "partial";
    pushNotice(
      warnings,
      "DOMCONTENTLOADED_WAIT_FAILED",
      error instanceof Error ? error.message : "DOMContentLoaded wait failed.",
    );
  }

  await waitForBestEffortNetworkIdle(page, config, notes);
  await page.waitForTimeout(config.renderSettleMs);
  notes.push(`Waited ${config.renderSettleMs}ms for render settle.`);

  try {
    await resetViewportPosition(page);
    notes.push("Reset scroll position to top.");
  } catch (error) {
    pushNotice(
      warnings,
      "SCROLL_RESET_FAILED",
      error instanceof Error ? error.message : "Unable to reset scroll position.",
    );
  }

  try {
    await awakenLazyLoadedMedia(page, config, notes);
  } catch (error) {
    pushNotice(
      warnings,
      "LAZY_LOAD_AWAKEN_FAILED",
      error instanceof Error ? error.message : "Unable to awaken lazy-loaded media.",
    );
  }

  try {
    await dismissCommonPopups(page, config, notes);
  } catch (error) {
    pushNotice(
      warnings,
      "POPUP_DISMISS_FAILED",
      error instanceof Error ? error.message : "Popup dismissal attempt failed.",
    );
  }

  let obstructionsDetected: ObstructionDetected[] = [];
  try {
    obstructionsDetected = await detectObstructions(page);
    if (obstructionsDetected.some(item => item.blockingLikely)) {
      pushNotice(
        warnings,
        "BLOCKING_OVERLAY_DETECTED",
        `Detected ${obstructionsDetected.filter(item => item.blockingLikely).length} likely blocking overlay elements.`,
      );
    }
  } catch (error) {
    pushNotice(
      warnings,
      "OBSTRUCTION_SCAN_FAILED",
      error instanceof Error ? error.message : "Unable to scan for blocking obstructions.",
    );
  }

  const title = await page.title().catch(() => null);
  const finalUrl = page.url();

  if (finalUrl === "about:blank") {
    pageLoadStatus = "error";
    pushNotice(errors, "EMPTY_PAGE", "Page remained at about:blank after preparation.");
  }

  return {
    finalUrl,
    title,
    statusCode,
    pageLoadStatus,
    notes,
    warnings,
    errors,
    obstructionsDetected,
  };
}
