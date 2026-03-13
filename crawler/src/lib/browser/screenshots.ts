import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { Page } from "playwright";

import { normalizePathname, slugify, toRelativeOutputPath } from "./normalizers.js";
import type {
  RenderedHtmlArtifact,
  ScreenshotArtifact,
  Stage5Config,
  ViewportArtifactPaths,
  ViewportPresetName,
} from "./types.js";

function hashQuery(query: string): string {
  return createHash("sha1").update(query).digest("hex").slice(0, 8);
}

export function createPageSlug(url: string, pageType?: string | null): string {
  const parsed = new URL(url);
  const pathname = normalizePathname(parsed.pathname);
  const pathParts = pathname.split("/").filter(Boolean).map(slugify).filter(Boolean);
  const base =
    pathParts.length > 0
      ? pathParts.join("-")
      : slugify(pageType || "") || "home";

  if (!parsed.search) return base;

  const querySlug = slugify(parsed.search.slice(1)) || "query";
  return `${base}-${querySlug}-${hashQuery(parsed.search)}`;
}

export function buildViewportArtifactPaths(
  config: Stage5Config,
  url: string,
  viewportName: ViewportPresetName,
  pageType?: string | null,
): ViewportArtifactPaths {
  const slug = createPageSlug(url, pageType);
  const fullScreenshotFile = `${slug}-${viewportName}-full.png`;
  const viewportScreenshotFile = `${slug}-${viewportName}-viewport.png`;
  const renderedHtmlFile = `${slug}-${viewportName}.html`;

  const fullScreenshotAbsolutePath = path.resolve(config.screenshotsDir, fullScreenshotFile);
  const viewportScreenshotAbsolutePath = path.resolve(config.screenshotsDir, viewportScreenshotFile);
  const renderedHtmlAbsolutePath = path.resolve(config.renderedHtmlDir, renderedHtmlFile);

  return {
    fullScreenshot: {
      absolutePath: fullScreenshotAbsolutePath,
      relativePath: toRelativeOutputPath(fullScreenshotAbsolutePath),
      filename: fullScreenshotFile,
    },
    viewportScreenshot: {
      absolutePath: viewportScreenshotAbsolutePath,
      relativePath: toRelativeOutputPath(viewportScreenshotAbsolutePath),
      filename: viewportScreenshotFile,
    },
    renderedHtml: {
      absolutePath: renderedHtmlAbsolutePath,
      relativePath: toRelativeOutputPath(renderedHtmlAbsolutePath),
      filename: renderedHtmlFile,
    },
  };
}

export async function saveAuditScreenshots(
  page: Page,
  artifactPaths: ViewportArtifactPaths,
  config: Stage5Config,
): Promise<{
  full: ScreenshotArtifact | null;
  viewport: ScreenshotArtifact | null;
}> {
  if (!config.screenshotEnabled) {
    return {
      full: null,
      viewport: null,
    };
  }

  await fs.mkdir(path.dirname(artifactPaths.fullScreenshot.absolutePath), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  await page.waitForTimeout(150);

  await page.screenshot({
    path: artifactPaths.fullScreenshot.absolutePath,
    fullPage: true,
    animations: "disabled",
  });

  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  await page.waitForTimeout(150);

  await page.screenshot({
    path: artifactPaths.viewportScreenshot.absolutePath,
    fullPage: false,
    animations: "disabled",
  });

  return {
    full: {
      kind: "full",
      path: artifactPaths.fullScreenshot.relativePath,
      filename: artifactPaths.fullScreenshot.filename,
    },
    viewport: {
      kind: "viewport",
      path: artifactPaths.viewportScreenshot.relativePath,
      filename: artifactPaths.viewportScreenshot.filename,
    },
  };
}

export async function saveRenderedHtml(
  page: Page,
  artifactPaths: ViewportArtifactPaths,
  config: Stage5Config,
): Promise<RenderedHtmlArtifact | null> {
  if (!config.renderedHtmlEnabled) return null;

  const html = await page.content();
  await fs.mkdir(path.dirname(artifactPaths.renderedHtml.absolutePath), { recursive: true });
  await fs.writeFile(artifactPaths.renderedHtml.absolutePath, html, "utf-8");

  return {
    path: artifactPaths.renderedHtml.relativePath,
    filename: artifactPaths.renderedHtml.filename,
  };
}
