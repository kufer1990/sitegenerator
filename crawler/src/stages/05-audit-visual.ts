import * as fs from "node:fs/promises";
import * as path from "node:path";

import { AUDIT_VIEWPORTS } from "../lib/browser/devices.js";
import { launchAuditBrowser } from "../lib/browser/playwright.js";
import { createPageSlug } from "../lib/browser/screenshots.js";
import { runViewportVisualAudit, type BrowserViewportAudit } from "../lib/browser/visual-audit.js";

type BusinessValue = "high" | "medium" | "low";
type SiteRole =
  | "homepage"
  | "discovery"
  | "detail"
  | "creator"
  | "account"
  | "contact"
  | "about"
  | "legal"
  | "utility"
  | "unknown";
type Cluster =
  | "core"
  | "discovery"
  | "content"
  | "conversion"
  | "account"
  | "legal"
  | "utility"
  | "unknown";
type PageType =
  | "home"
  | "listing"
  | "category"
  | "detail"
  | "creator"
  | "search"
  | "favorites"
  | "auth"
  | "legal"
  | "contact"
  | "about"
  | "utility"
  | "unknown";

type EnrichedPage = {
  url: string;
  finalUrl?: string | null;
  normalizedPath?: string | null;
  fetchStatus: "ok" | "error";
  title?: string | null;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  shouldAnalyze: boolean;
  pageTypeConfidence?: number;
  confidence?: number;
  parentCandidate?: string | null;
  reason?: string | null;
  contentSignals?: {
    wordCount?: number;
    mainContentWordCount?: number;
    imageCount?: number;
    internalLinksCount?: number;
  };
};

type Stage3Output = {
  sourceFile: string;
  generatedAt: string;
  pagesTotal: number;
  pages: EnrichedPage[];
};

type SelectedPage = {
  url: string;
  finalUrl: string;
  normalizedPath: string;
  title: string | null;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  selectionReason: string;
};

type Stage5OutputPage = {
  url: string;
  finalUrl: string;
  title: string | null;
  normalizedPath: string;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  selectionReason: string;
  audits: Record<string, BrowserViewportAudit>;
};

type Stage5Output = {
  generatedAt: string;
  sourceFile: string;
  sourceGeneratedAt: string;
  screenshotsDir: string;
  pagesAudited: number;
  auditVariants: number;
  pages: Stage5OutputPage[];
};

const SOURCE_FILE_REL = "output/03-enriched-site-data.json";
const OUTPUT_FILE_REL = "output/05-visual-audit.json";
const SCREENSHOTS_DIR_REL = "output/screenshots";
const EXACT_PATHS = ["/", "/create", "/categories", "/top", "/favorites", "/about", "/privacy-policy", "/terms"];
const MAX_CATEGORY_PAGES = Number(process.env.STAGE5_MAX_CATEGORY_PAGES || 3);
const MAX_DETAIL_PAGES = Number(process.env.STAGE5_MAX_DETAIL_PAGES || 5);
const MAX_SELECTED_PAGES = Number(process.env.STAGE5_MAX_PAGES || 0);
const URL_FILTER = (process.env.STAGE5_URL_FILTER || "").trim().toLowerCase();

function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  const compact = pathname.replace(/\/+/g, "/");
  const trimmed = compact === "/" ? "/" : compact.replace(/\/+$/, "");
  return trimmed || "/";
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.pathname = normalizePathname(parsed.pathname);
  return parsed.href;
}

function getFinalUrl(page: EnrichedPage): string {
  return page.finalUrl || page.url;
}

function getNormalizedPath(page: EnrichedPage): string {
  if (page.normalizedPath) return normalizePathname(page.normalizedPath);
  return normalizePathname(new URL(getFinalUrl(page)).pathname);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function pageScore(page: EnrichedPage): number {
  const wordCount = page.contentSignals?.wordCount || 0;
  const mainContentWordCount = page.contentSignals?.mainContentWordCount || 0;
  const images = page.contentSignals?.imageCount || 0;
  const links = page.contentSignals?.internalLinksCount || 0;
  const confidence = page.pageTypeConfidence || page.confidence || 0;

  return round2(confidence * 100 + mainContentWordCount * 0.18 + wordCount * 0.06 + images * 5 + links * 0.8);
}

function sortCandidates(pages: EnrichedPage[]): EnrichedPage[] {
  return [...pages].sort((a, b) => pageScore(b) - pageScore(a) || getFinalUrl(a).localeCompare(getFinalUrl(b)));
}

function readSelectionCandidate(page: EnrichedPage, selectionReason: string): SelectedPage {
  const finalUrl = normalizeUrl(getFinalUrl(page));
  return {
    url: normalizeUrl(page.url),
    finalUrl,
    normalizedPath: getNormalizedPath(page),
    title: page.title || null,
    pageType: page.pageType,
    siteRole: page.siteRole,
    cluster: page.cluster,
    businessValue: page.businessValue,
    selectionReason,
  };
}

function addSelectedPage(
  map: Map<string, SelectedPage>,
  page: EnrichedPage | undefined,
  selectionReason: string,
): void {
  if (!page || page.fetchStatus !== "ok") return;
  const key = normalizeUrl(getFinalUrl(page));
  if (!map.has(key)) {
    map.set(key, readSelectionCandidate(page, selectionReason));
  }
}

function pickExactPath(pages: EnrichedPage[], wantedPath: string): EnrichedPage | undefined {
  return pages.find(page => getNormalizedPath(page) === wantedPath && page.fetchStatus === "ok");
}

function countSelectedByType(selected: Iterable<SelectedPage>, pageType: PageType): number {
  let count = 0;
  for (const page of selected) {
    if (page.pageType === pageType) count += 1;
  }
  return count;
}

function selectVisualAuditPages(source: Stage3Output): SelectedPage[] {
  const pages = source.pages.filter(page => page.fetchStatus === "ok");
  const selected = new Map<string, SelectedPage>();

  for (const wantedPath of EXACT_PATHS) {
    addSelectedPage(selected, pickExactPath(pages, wantedPath), `core path ${wantedPath}`);
  }

  const categoryCandidates = sortCandidates(
    pages.filter(page => page.pageType === "category" && page.shouldAnalyze && page.businessValue === "high"),
  );

  for (const page of categoryCandidates.slice(0, MAX_CATEGORY_PAGES)) {
    addSelectedPage(selected, page, "representative category page");
  }

  const detailCandidates = sortCandidates(
    pages.filter(
      page =>
        page.pageType === "detail" &&
        page.shouldAnalyze &&
        getNormalizedPath(page).startsWith("/quote/"),
    ),
  );

  const detailsByParent = new Set<string>();
  for (const page of detailCandidates) {
    if (countSelectedByType(selected.values(), "detail") >= MAX_DETAIL_PAGES) break;
    const parentKey = page.parentCandidate || "__no-parent__";
    if (detailsByParent.has(parentKey) && detailsByParent.size >= 2) continue;
    addSelectedPage(
      selected,
      page,
      page.parentCandidate ? "representative quote page by parent cluster" : "representative quote page",
    );
    detailsByParent.add(parentKey);
  }

  for (const page of detailCandidates) {
    if (countSelectedByType(selected.values(), "detail") >= MAX_DETAIL_PAGES) break;
    addSelectedPage(selected, page, "representative quote page");
  }

  let output = [...selected.values()];
  if (URL_FILTER) {
    output = output.filter(page => page.finalUrl.toLowerCase().includes(URL_FILTER));
  }
  if (MAX_SELECTED_PAGES > 0) {
    output = output.slice(0, MAX_SELECTED_PAGES);
  }

  return output;
}

async function readStage3Output(filePath: string): Promise<Stage3Output> {
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(content) as Stage3Output;

  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error("Invalid format in output/03-enriched-site-data.json");
  }

  return parsed;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function main(): Promise<void> {
  const sourcePath = path.resolve(SOURCE_FILE_REL);
  const outputPath = path.resolve(OUTPUT_FILE_REL);
  const screenshotsDir = path.resolve(SCREENSHOTS_DIR_REL);

  const source = await readStage3Output(sourcePath);
  const selectedPages = selectVisualAuditPages(source);

  if (!selectedPages.length) {
    throw new Error("No pages selected for visual audit.");
  }

  console.log(`[stage5] Starting Stage 5 visual audit for ${selectedPages.length} pages.`);
  console.log(`[stage5] Source: ${sourcePath}`);
  console.log(`[stage5] Screenshots: ${screenshotsDir}`);

  const browser = await launchAuditBrowser();

  try {
    const auditedPages: Stage5OutputPage[] = [];

    for (let index = 0; index < selectedPages.length; index += 1) {
      const selectedPage = selectedPages[index];
      console.log(
        `[stage5] [${index + 1}/${selectedPages.length}] ${selectedPage.finalUrl} (${selectedPage.pageType}, ${selectedPage.selectionReason})`,
      );

      const audits: Record<string, BrowserViewportAudit> = {};
      for (const preset of AUDIT_VIEWPORTS) {
        console.log(`[stage5]    -> ${preset.name}`);
        audits[preset.name] = await runViewportVisualAudit({
          browser,
          preset,
          url: selectedPage.finalUrl,
          screenshotsDir,
          pageType: selectedPage.pageType,
        });
      }

      auditedPages.push({
        ...selectedPage,
        audits,
      });
    }

    const output: Stage5Output = {
      generatedAt: new Date().toISOString(),
      sourceFile: SOURCE_FILE_REL,
      sourceGeneratedAt: source.generatedAt,
      screenshotsDir: SCREENSHOTS_DIR_REL.replace(/\\/g, "/"),
      pagesAudited: auditedPages.length,
      auditVariants: auditedPages.length * AUDIT_VIEWPORTS.length,
      pages: auditedPages,
    };

    await writeJson(outputPath, output);

    console.log("[stage5] Stage 5 completed.");
    console.log(`[stage5] Output: ${outputPath}`);
    console.log(`[stage5] Pages audited: ${output.pagesAudited}`);
    console.log(`[stage5] Audit variants: ${output.auditVariants}`);
    console.log(
      `[stage5] Page slugs: ${auditedPages.map(page => createPageSlug(page.finalUrl, page.pageType)).join(", ")}`,
    );
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("[stage5] Critical error:", error);
  process.exit(1);
});
