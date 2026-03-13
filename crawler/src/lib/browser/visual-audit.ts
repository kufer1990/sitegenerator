import * as fs from "node:fs/promises";
import type { Browser, Page } from "playwright";

import type { AuditViewportPreset } from "./devices.js";
import {
  collectLoadTimingSummary,
  createAuditContext,
  createAuditPage,
  getDefaultTimeoutMs,
  waitForRenderedUi,
} from "./playwright.js";
import { buildScreenshotPaths, saveAuditScreenshots } from "./screenshots.js";

export type LayoutBlock = {
  tag: string;
  selectorHint: string;
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  };
  width: number;
  height: number;
  top: number;
  left: number;
  textSnippet: string;
  roleGuess: string;
};

export type StyleSnapshot = {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  borderRadius: string;
  boxShadow: string;
  padding: string;
  margin: string;
  display: string;
  position: string;
  zIndex: string;
  gap: string;
  maxWidth: string;
  textAlign: string;
  transition: string;
  animation: string;
  transform: string;
  opacity: string;
  filter: string;
  backdropFilter: string;
  willChange: string;
};

export type ElementStyleAudit = {
  tag: string;
  selectorHint: string;
  textSnippet: string;
  href: string | null;
  src: string | null;
  role: string | null;
  ariaLabel: string | null;
  isAboveFold: boolean;
  boundingBox: LayoutBlock["boundingBox"];
  style: StyleSnapshot;
};

export type CountedValue = {
  value: string;
  count: number;
};

export type TypographyAudit = {
  uniqueFontFamilies: string[];
  fontFamilyUsage: CountedValue[];
  commonHeadingSizes: CountedValue[];
  commonParagraphSizes: CountedValue[];
  fontWeightPatterns: CountedValue[];
};

export type ColorAudit = {
  text: CountedValue[];
  backgrounds: CountedValue[];
  buttons: CountedValue[];
  accents: CountedValue[];
  borders: CountedValue[];
};

export type MediaAudit = {
  images: {
    count: number;
    lazyHints: number;
    examples: Array<{
      src: string | null;
      alt: string | null;
      selectorHint: string;
      boundingBox: LayoutBlock["boundingBox"];
    }>;
  };
  backgroundImages: {
    count: number;
    examples: Array<{
      selectorHint: string;
      backgroundImage: string;
    }>;
  };
  svgCount: number;
  videoCount: number;
  canvasCount: number;
  iframeCount: number;
  iconHintsCount: number;
};

export type PositioningAudit = {
  stickyElements: ElementStyleAudit[];
  fixedElements: ElementStyleAudit[];
  overlayLikeElements: ElementStyleAudit[];
  modalLikeElements: ElementStyleAudit[];
  drawerLikeElements: ElementStyleAudit[];
};

export type MotionAudit = {
  transitionElements: number;
  animationElements: number;
  transformElements: number;
  opacityVariantElements: number;
  willChangeElements: number;
  filterElements: number;
  backdropFilterElements: number;
  samples: ElementStyleAudit[];
};

export type VisualHierarchyAudit = {
  dominantHeadingBlock: ElementStyleAudit | null;
  primaryCta: ElementStyleAudit | null;
  visibleMajorSections: number;
  aboveFoldHeadingCount: number;
  aboveFoldButtonCount: number;
  aboveFoldParagraphCount: number;
  aboveFoldMediaCount: number;
  firstViewportProfile: "cta-heavy" | "content-heavy" | "navigation-heavy" | "balanced";
  emphasis: "product" | "content" | "navigation" | "mixed";
};

export type BrowserViewportAudit = {
  viewport: {
    width: number;
    height: number;
  };
  title: string | null;
  finalUrl: string;
  pageLoadStatus: "ok" | "partial" | "error";
  statusCode: number | null;
  error: string | null;
  timings: {
    domContentLoadedMs: number | null;
    loadMs: number | null;
    responseStartMs: number | null;
    firstByteMs: number | null;
    durationMs: number | null;
  } | null;
  screenshots: {
    full: string;
    viewport: string;
  };
  layoutBlocks: LayoutBlock[];
  keyElements: Record<string, ElementStyleAudit[]>;
  typography: TypographyAudit;
  colors: ColorAudit;
  media: MediaAudit;
  positioning: PositioningAudit;
  motionClues: MotionAudit;
  visualHierarchy: VisualHierarchyAudit;
};

type AuditDomSnapshot = {
  layoutBlocks: LayoutBlock[];
  keyElements: Record<string, ElementStyleAudit[]>;
  typography: TypographyAudit;
  colors: ColorAudit;
  media: MediaAudit;
  positioning: PositioningAudit;
  motionClues: MotionAudit;
  visualHierarchy: VisualHierarchyAudit;
};

type RunVisualAuditParams = {
  browser: Browser;
  preset: AuditViewportPreset;
  url: string;
  screenshotsDir: string;
  pageType?: string | null;
};

let domSnapshotScriptPromise: Promise<string> | null = null;

export async function runViewportVisualAudit({
  browser,
  preset,
  url,
  screenshotsDir,
  pageType,
}: RunVisualAuditParams): Promise<BrowserViewportAudit> {
  const context = await createAuditContext(browser, preset);
  const page = await createAuditPage(context);
  const screenshotPaths = buildScreenshotPaths(screenshotsDir, url, preset.name, pageType);

  let pageLoadStatus: BrowserViewportAudit["pageLoadStatus"] = "ok";
  let errorMessage: string | null = null;
  let statusCode: number | null = null;

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: getDefaultTimeoutMs(),
    });
    statusCode = response?.status() ?? null;
  } catch (error) {
    pageLoadStatus = "partial";
    errorMessage = error instanceof Error ? error.message : "navigation error";
  }

  try {
    await waitForRenderedUi(page);
  } catch (error) {
    pageLoadStatus = pageLoadStatus === "ok" ? "partial" : pageLoadStatus;
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : "render wait error";
    }
  }

  const finalUrl = page.url();
  const title = await page.title().catch(() => null);
  const timings = await collectLoadTimingSummary(page);

  let domSnapshot: AuditDomSnapshot;
  try {
    domSnapshot = await collectDomSnapshot(page);
  } catch (error) {
    pageLoadStatus = "error";
    errorMessage = error instanceof Error ? error.message : "dom snapshot error";
    domSnapshot = createEmptyAuditDomSnapshot();
  }

  try {
    await saveAuditScreenshots(page, screenshotPaths);
  } catch (error) {
    pageLoadStatus = pageLoadStatus === "ok" ? "partial" : pageLoadStatus;
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : "screenshot error";
    }
  }

  await context.close();

  return {
    viewport: preset.viewport,
    title,
    finalUrl,
    pageLoadStatus,
    statusCode,
    error: errorMessage,
    timings,
    screenshots: {
      full: screenshotPaths.fullRelativePath,
      viewport: screenshotPaths.viewportRelativePath,
    },
    layoutBlocks: domSnapshot.layoutBlocks,
    keyElements: domSnapshot.keyElements,
    typography: domSnapshot.typography,
    colors: domSnapshot.colors,
    media: domSnapshot.media,
    positioning: domSnapshot.positioning,
    motionClues: domSnapshot.motionClues,
    visualHierarchy: domSnapshot.visualHierarchy,
  };
}

function createEmptyAuditDomSnapshot(): AuditDomSnapshot {
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
  };
}

async function collectDomSnapshot(page: Page): Promise<AuditDomSnapshot> {
  if (!domSnapshotScriptPromise) {
    domSnapshotScriptPromise = fs.readFile(new URL("./dom-snapshot-script.js", import.meta.url), "utf-8");
  }

  const script = await domSnapshotScriptPromise;
  return page.evaluate(function runVisualAuditScript(scriptSource) {
    return (0, eval)(scriptSource);
  }, script);
}
