import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { Page } from "playwright";

import type { ViewportPresetName } from "./devices.js";

export type ScreenshotPaths = {
  fullAbsolutePath: string;
  viewportAbsolutePath: string;
  fullRelativePath: string;
  viewportRelativePath: string;
};

function normalizeForFile(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimSlugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function createPageSlug(url: string, pageType?: string | null): string {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split("/").filter(Boolean).map(trimSlugPart).filter(Boolean);
  const base =
    pathParts.length === 0
      ? pageType === "home" || !pageType
        ? "home"
        : pageType
      : pathParts.join("-");
  const query = parsed.search ? trimSlugPart(parsed.search.slice(1)) : "";

  if (!query) return base || "page";

  const queryHash = createHash("sha1").update(parsed.search).digest("hex").slice(0, 8);
  return `${base || "page"}-${query || "query"}-${queryHash}`;
}

export function buildScreenshotPaths(
  screenshotsDir: string,
  url: string,
  viewportName: ViewportPresetName,
  pageType?: string | null,
): ScreenshotPaths {
  const slug = createPageSlug(url, pageType);
  const fullFileName = `${slug}-${viewportName}-full.png`;
  const viewportFileName = `${slug}-${viewportName}-viewport.png`;
  const fullAbsolutePath = path.resolve(screenshotsDir, fullFileName);
  const viewportAbsolutePath = path.resolve(screenshotsDir, viewportFileName);

  return {
    fullAbsolutePath,
    viewportAbsolutePath,
    fullRelativePath: normalizeForFile(path.relative(process.cwd(), fullAbsolutePath)),
    viewportRelativePath: normalizeForFile(path.relative(process.cwd(), viewportAbsolutePath)),
  };
}

export async function saveAuditScreenshots(page: Page, screenshotPaths: ScreenshotPaths): Promise<void> {
  await fs.mkdir(path.dirname(screenshotPaths.fullAbsolutePath), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.waitForTimeout(150);

  await page.screenshot({
    path: screenshotPaths.fullAbsolutePath,
    fullPage: true,
    animations: "disabled",
  });

  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.waitForTimeout(150);

  await page.screenshot({
    path: screenshotPaths.viewportAbsolutePath,
    fullPage: false,
    animations: "disabled",
  });
}
