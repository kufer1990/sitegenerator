import * as path from "node:path";

import { parseBooleanEnv, parseIntegerEnv, parseOptionalIntegerEnv } from "./normalizers.js";
import type { PublicStage5Config, Stage5Config } from "./types.js";

export function getStage5ConfigFromEnv(): Stage5Config {
  return {
    auditVersion: "2.0.0",
    inputFile: path.resolve(process.env.STAGE5_INPUT_FILE || "output/03-enriched-site-data.json"),
    outputJsonFile: path.resolve(process.env.STAGE5_OUTPUT_FILE || "output/05-visual-audit.json"),
    outputSummaryFile: path.resolve(process.env.STAGE5_OUTPUT_SUMMARY_FILE || "output/05-visual-audit-summary.md"),
    screenshotsDir: path.resolve(process.env.STAGE5_SCREENSHOTS_DIR || "output/screenshots"),
    renderedHtmlDir: path.resolve(process.env.STAGE5_RENDERED_HTML_DIR || "output/rendered-html"),
    headless: parseBooleanEnv("STAGE5_HEADLESS", true),
    pageTimeoutMs: parseIntegerEnv("STAGE5_PAGE_TIMEOUT_MS", 30000),
    networkIdleTimeoutMs: parseIntegerEnv("STAGE5_NETWORK_IDLE_TIMEOUT_MS", 5000),
    renderSettleMs: parseIntegerEnv("STAGE5_RENDER_SETTLE_MS", 1200),
    screenshotEnabled: parseBooleanEnv("STAGE5_ENABLE_SCREENSHOTS", true),
    renderedHtmlEnabled: parseBooleanEnv("STAGE5_ENABLE_RENDERED_HTML", true),
    popupDismissalEnabled: parseBooleanEnv("STAGE5_DISMISS_POPUPS", true),
    awakenLazyLoadEnabled: parseBooleanEnv("STAGE5_AWAKEN_LAZY_LOAD", true),
    maxSelectedPages: parseOptionalIntegerEnv("STAGE5_MAX_PAGES"),
    maxCategoryPages: parseIntegerEnv("STAGE5_MAX_CATEGORY_PAGES", 3),
    maxDetailPages: parseIntegerEnv("STAGE5_MAX_DETAIL_PAGES", 5),
    urlFilter: process.env.STAGE5_URL_FILTER?.trim().toLowerCase() || null,
    desktopViewport: {
      width: parseIntegerEnv("STAGE5_DESKTOP_WIDTH", 1440),
      height: parseIntegerEnv("STAGE5_DESKTOP_HEIGHT", 1200),
    },
    mobileViewport: {
      width: parseIntegerEnv("STAGE5_MOBILE_WIDTH", 390),
      height: parseIntegerEnv("STAGE5_MOBILE_HEIGHT", 844),
    },
  };
}

export function toPublicStage5Config(config: Stage5Config): PublicStage5Config {
  return { ...config };
}
