import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Browser } from "playwright";

import { buildAuditViewports } from "../lib/browser/devices.js";
import { collectDomSnapshot, installDomSnapshotRuntime } from "../lib/browser/dom-snapshot.js";
import { getStage5ConfigFromEnv, toPublicStage5Config } from "../lib/browser/config.js";
import { normalizePathname, normalizeUrl, toRelativeOutputPath } from "../lib/browser/normalizers.js";
import { preparePageForAudit } from "../lib/browser/page-prepare.js";
import { selectVisualAuditPages } from "../lib/browser/page-selection.js";
import { createAuditContext, createAuditPage, collectLoadTimingSummary, launchAuditBrowser } from "../lib/browser/playwright.js";
import { buildViewportArtifactPaths, createPageSlug, saveAuditScreenshots, saveRenderedHtml } from "../lib/browser/screenshots.js";
import { buildVisualAuditMarkdownSummary } from "../lib/browser/summary-report.js";
import type {
  AuditNotice,
  BrowserViewportAudit,
  DomSnapshotResult,
  SelectedPage,
  Stage3Output,
  Stage5Config,
  Stage5Output,
  Stage5OutputPage,
} from "../lib/browser/types.js";

function pushNotice(target: AuditNotice[], code: string, message: string): void {
  if (!target.some(item => item.code === code && item.message === message)) {
    target.push({ code, message });
  }
}

function createEmptyDomSnapshot(): DomSnapshotResult {
  return {
    layoutBlocks: [],
    keyElements: {},
    typography: {
      uniqueFontFamilies: [],
      fontFamilyUsage: [],
      commonHeadingSizes: [],
      commonParagraphSizes: [],
      fontWeightPatterns: [],
    },
    colors: {
      text: [],
      backgrounds: [],
      buttons: [],
      accents: [],
      borders: [],
    },
    media: {
      images: {
        count: 0,
        lazyHints: 0,
        examples: [],
      },
      backgroundImages: {
        count: 0,
        examples: [],
      },
      svgCount: 0,
      videoCount: 0,
      canvasCount: 0,
      iframeCount: 0,
      iconHintsCount: 0,
    },
    positioning: {
      stickyElements: [],
      fixedElements: [],
      overlayLikeElements: [],
      modalLikeElements: [],
      drawerLikeElements: [],
    },
    motionClues: {
      transitionElements: 0,
      animationElements: 0,
      transformElements: 0,
      opacityVariantElements: 0,
      willChangeElements: 0,
      filterElements: 0,
      backdropFilterElements: 0,
      samples: [],
    },
    visualHierarchy: {
      dominantHeadingBlock: null,
      primaryCta: null,
      visibleMajorSections: 0,
      aboveFoldHeadingCount: 0,
      aboveFoldButtonCount: 0,
      aboveFoldParagraphCount: 0,
      aboveFoldMediaCount: 0,
      firstViewportProfile: "balanced",
      emphasis: "mixed",
    },
    visualSystem: {
      spacingScale: [],
      containerWidths: [],
      borderRadiusPatterns: [],
      shadowPatterns: [],
      buttonStylePatterns: [],
      typographyScale: [],
      visualDensity: "balanced",
    },
  };
}

async function readStage3Output(filePath: string): Promise<Stage3Output> {
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(content) as Stage3Output;
  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error(`Invalid format in ${filePath}`);
  }
  return parsed;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf-8");
}

async function auditViewport(
  browser: Browser,
  selectedPage: SelectedPage,
  viewportPreset: ReturnType<typeof buildAuditViewports>[number],
  config: Stage5Config,
): Promise<BrowserViewportAudit> {
  const warnings: AuditNotice[] = [];
  const errors: AuditNotice[] = [];
  const domSnapshot = createEmptyDomSnapshot();
  const artifactPaths = buildViewportArtifactPaths(
    config,
    selectedPage.finalUrl,
    viewportPreset.name,
    selectedPage.pageType,
  );

  let pagePreparationNotes: string[] = [];
  let obstructionsDetected: BrowserViewportAudit["obstructionsDetected"] = [];
  let title: string | null = selectedPage.title;
  let finalUrl = selectedPage.finalUrl;
  let pageLoadStatus: BrowserViewportAudit["pageLoadStatus"] = "ok";
  let statusCode: number | null = null;
  let timings: BrowserViewportAudit["timings"] = null;
  let renderedHtmlPath: string | null = null;
  let screenshots: BrowserViewportAudit["screenshots"] = {
    full: null,
    viewport: null,
  };

  let context = null;

  try {
    context = await createAuditContext(browser, viewportPreset, config);
    await installDomSnapshotRuntime(context);
    const page = await createAuditPage(context, config);

    const preparation = await preparePageForAudit(page, selectedPage.finalUrl, config);
    pagePreparationNotes = preparation.notes;
    obstructionsDetected = preparation.obstructionsDetected;
    warnings.push(...preparation.warnings);
    errors.push(...preparation.errors);
    title = preparation.title;
    finalUrl = preparation.finalUrl || selectedPage.finalUrl;
    pageLoadStatus = preparation.pageLoadStatus;
    statusCode = preparation.statusCode;

    try {
      timings = await collectLoadTimingSummary(page);
      if (!timings) {
        pushNotice(warnings, "LOAD_TIMINGS_UNAVAILABLE", "Navigation timing summary was not available.");
      }
    } catch (error) {
      pushNotice(
        warnings,
        "LOAD_TIMINGS_FAILED",
        error instanceof Error ? error.message : "Failed to collect load timing summary.",
      );
    }

    let snapshot = domSnapshot;
    try {
      snapshot = await collectDomSnapshot(page);
    } catch (error) {
      pushNotice(
        errors,
        "DOM_SNAPSHOT_FAILED",
        error instanceof Error ? error.message : "DOM snapshot collection failed.",
      );
      pageLoadStatus = pageLoadStatus === "ok" ? "partial" : pageLoadStatus;
    }

    try {
      renderedHtmlPath = (await saveRenderedHtml(page, artifactPaths, config))?.path || null;
    } catch (error) {
      pushNotice(
        warnings,
        "RENDERED_HTML_FAILED",
        error instanceof Error ? error.message : "Rendered HTML export failed.",
      );
    }

    try {
      screenshots = await saveAuditScreenshots(page, artifactPaths, config);
    } catch (error) {
      pushNotice(
        warnings,
        "SCREENSHOT_FAILED",
        error instanceof Error ? error.message : "Screenshot capture failed.",
      );
      pageLoadStatus = pageLoadStatus === "ok" ? "partial" : pageLoadStatus;
    }

    return {
      viewport: viewportPreset.viewport,
      title,
      finalUrl,
      pageLoadStatus,
      statusCode,
      warnings,
      errors,
      timings,
      pagePreparationNotes,
      obstructionsDetected,
      renderedHtmlPath,
      screenshots,
      layoutBlocks: snapshot.layoutBlocks,
      keyElements: snapshot.keyElements,
      typography: snapshot.typography,
      colors: snapshot.colors,
      media: snapshot.media,
      positioning: snapshot.positioning,
      motionClues: snapshot.motionClues,
      visualHierarchy: snapshot.visualHierarchy,
      visualSystem: snapshot.visualSystem,
    };
  } catch (error) {
    pushNotice(
      errors,
      "VIEWPORT_AUDIT_FAILED",
      error instanceof Error ? error.message : "Viewport audit failed before completion.",
    );

    return {
      viewport: viewportPreset.viewport,
      title,
      finalUrl,
      pageLoadStatus: "error",
      statusCode,
      warnings,
      errors,
      timings,
      pagePreparationNotes,
      obstructionsDetected,
      renderedHtmlPath,
      screenshots,
      layoutBlocks: domSnapshot.layoutBlocks,
      keyElements: domSnapshot.keyElements,
      typography: domSnapshot.typography,
      colors: domSnapshot.colors,
      media: domSnapshot.media,
      positioning: domSnapshot.positioning,
      motionClues: domSnapshot.motionClues,
      visualHierarchy: domSnapshot.visualHierarchy,
      visualSystem: domSnapshot.visualSystem,
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function auditSelectedPage(
  browser: Browser,
  selectedPage: SelectedPage,
  config: Stage5Config,
): Promise<Stage5OutputPage> {
  const viewportPresets = buildAuditViewports(config);
  const audits = {} as Stage5OutputPage["audits"];

  for (const viewportPreset of viewportPresets) {
    console.log(`[stage5]    -> ${viewportPreset.name}`);
    audits[viewportPreset.name] = await auditViewport(browser, selectedPage, viewportPreset, config);
  }

  return {
    ...selectedPage,
    audits,
  };
}

async function main(): Promise<void> {
  const config = getStage5ConfigFromEnv();
  const source = await readStage3Output(config.inputFile);
  const selectedPages = selectVisualAuditPages(source, config);

  if (!selectedPages.length) {
    throw new Error("No pages selected for visual audit.");
  }

  console.log(`[stage5] Starting Stage 5 visual audit for ${selectedPages.length} pages.`);
  console.log(`[stage5] Source: ${config.inputFile}`);
  console.log(`[stage5] Screenshots: ${config.screenshotsDir}`);
  console.log(`[stage5] Rendered HTML: ${config.renderedHtmlDir}`);

  const browser = await launchAuditBrowser(config);

  try {
    const pages: Stage5OutputPage[] = [];
    for (let index = 0; index < selectedPages.length; index += 1) {
      const selectedPage = selectedPages[index];
      console.log(
        `[stage5] [${index + 1}/${selectedPages.length}] ${selectedPage.finalUrl} (${selectedPage.archetype})`,
      );
      pages.push(await auditSelectedPage(browser, selectedPage, config));
    }

    const output: Stage5Output = {
      auditVersion: config.auditVersion,
      generatedAt: new Date().toISOString(),
      sourceFile: toRelativeOutputPath(config.inputFile),
      sourceGeneratedAt: source.generatedAt,
      config: toPublicStage5Config({
        ...config,
        inputFile: toRelativeOutputPath(config.inputFile),
        outputJsonFile: toRelativeOutputPath(config.outputJsonFile),
        outputSummaryFile: toRelativeOutputPath(config.outputSummaryFile),
        screenshotsDir: toRelativeOutputPath(config.screenshotsDir),
        renderedHtmlDir: toRelativeOutputPath(config.renderedHtmlDir),
      }),
      screenshotsDir: toRelativeOutputPath(config.screenshotsDir),
      renderedHtmlDir: toRelativeOutputPath(config.renderedHtmlDir),
      pagesAudited: pages.length,
      auditVariants: pages.length * buildAuditViewports(config).length,
      pages,
    };

    await writeJson(config.outputJsonFile, output);
    await writeText(config.outputSummaryFile, buildVisualAuditMarkdownSummary(output));

    console.log("[stage5] Stage 5 completed.");
    console.log(`[stage5] JSON: ${config.outputJsonFile}`);
    console.log(`[stage5] Summary: ${config.outputSummaryFile}`);
    console.log(`[stage5] Pages audited: ${output.pagesAudited}`);
    console.log(`[stage5] Audit variants: ${output.auditVariants}`);
    console.log(`[stage5] Page slugs: ${pages.map(page => createPageSlug(page.finalUrl, page.pageType)).join(", ")}`);
    console.log("[stage5] Run via: npm run stage:05");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("[stage5] Critical error:", error);
  process.exit(1);
});
