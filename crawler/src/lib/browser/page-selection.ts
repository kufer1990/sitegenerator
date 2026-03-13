import { cleanText, median, normalizePathname, normalizeUrl, round2 } from "./normalizers.js";
import type { AuditPageArchetype, EnrichedPage, SelectedPage, Stage3Output, Stage5Config } from "./types.js";

const CORE_PATH_RULES: Array<{ path: string; archetype: AuditPageArchetype; reasons: string[] }> = [
  { path: "/", archetype: "homepage", reasons: ["core path", "homepage archetype"] },
  { path: "/create", archetype: "conversion", reasons: ["core path", "conversion archetype"] },
  { path: "/categories", archetype: "category-hub", reasons: ["core path", "category hub archetype"] },
  { path: "/top", archetype: "ranking", reasons: ["core path", "ranking archetype"] },
  { path: "/favorites", archetype: "retention", reasons: ["core path", "retention archetype"] },
  { path: "/about", archetype: "trust", reasons: ["core path", "trust archetype"] },
  { path: "/privacy-policy", archetype: "legal", reasons: ["core path", "legal archetype"] },
  { path: "/terms", archetype: "legal", reasons: ["core path", "legal archetype"] },
];

function getFinalUrl(page: EnrichedPage): string {
  return normalizeUrl(page.finalUrl || page.url);
}

function getNormalizedPath(page: EnrichedPage): string {
  return normalizePathname(page.normalizedPath || new URL(getFinalUrl(page)).pathname);
}

function getMainWordCount(page: EnrichedPage): number {
  return page.contentSignals?.mainContentWordCount || 0;
}

function getWordCount(page: EnrichedPage): number {
  return page.contentSignals?.wordCount || 0;
}

function getImageCount(page: EnrichedPage): number {
  return page.contentSignals?.imageCount || page.imageCount || 0;
}

function pageScore(page: EnrichedPage): number {
  const confidence = page.pageTypeConfidence || page.confidence || 0;
  return round2(confidence * 100 + getMainWordCount(page) * 0.2 + getWordCount(page) * 0.05 + getImageCount(page) * 4);
}

function sortPages(pages: EnrichedPage[]): EnrichedPage[] {
  return [...pages].sort((a, b) => pageScore(b) - pageScore(a) || getFinalUrl(a).localeCompare(getFinalUrl(b)));
}

function looksLikeKnownAuthor(page: EnrichedPage): boolean {
  const text = cleanText(`${page.mainContentText || ""} ${page.rawText || ""} ${(page.h1 || []).join(" ")} ${(page.h2 || []).join(" ")}`).toLowerCase();
  if (!text) return false;
  if (/anonim|anonymous/.test(text)) return false;
  return /-\s+[a-z][a-z .'-]{3,40}\b|by\s+[a-z][a-z .'-]{3,40}\b|autor|author/.test(text);
}

function toSelectedPage(page: EnrichedPage, archetype: AuditPageArchetype, selectedBecause: string[]): SelectedPage {
  return {
    url: normalizeUrl(page.url),
    finalUrl: getFinalUrl(page),
    normalizedPath: getNormalizedPath(page),
    title: page.title || null,
    pageType: page.pageType,
    siteRole: page.siteRole,
    cluster: page.cluster,
    businessValue: page.businessValue,
    archetype,
    selectedBecause,
  };
}

function mergeSelectionReason(existing: SelectedPage, reasons: string[]): SelectedPage {
  return {
    ...existing,
    selectedBecause: [...new Set([...existing.selectedBecause, ...reasons])],
  };
}

function addSelection(
  selections: Map<string, SelectedPage>,
  page: EnrichedPage | undefined,
  archetype: AuditPageArchetype,
  reasons: string[],
): void {
  if (!page || page.fetchStatus !== "ok") return;
  const key = getFinalUrl(page);
  const normalizedReasons = [...new Set(reasons)];
  const existing = selections.get(key);

  if (existing) {
    selections.set(key, mergeSelectionReason(existing, normalizedReasons));
    return;
  }

  selections.set(key, toSelectedPage(page, archetype, normalizedReasons));
}

function findByPath(pages: EnrichedPage[], wantedPath: string): EnrichedPage | undefined {
  return pages.find(page => getNormalizedPath(page) === wantedPath && page.fetchStatus === "ok");
}

function detailCandidates(pages: EnrichedPage[]): EnrichedPage[] {
  return sortPages(pages.filter(page => page.pageType === "detail" && page.shouldAnalyze));
}

export function selectVisualAuditPages(source: Stage3Output, config: Stage5Config): SelectedPage[] {
  const pages = source.pages.filter(page => page.fetchStatus === "ok");
  const selections = new Map<string, SelectedPage>();

  for (const rule of CORE_PATH_RULES) {
    addSelection(selections, findByPath(pages, rule.path), rule.archetype, rule.reasons);
  }

  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "creator" || page.siteRole === "creator"))[0],
    "conversion",
    ["best available conversion page", "creator/siteRole signal"],
  );
  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "listing" || page.siteRole === "discovery"))[0],
    "category-hub",
    ["best available discovery hub", "listing/discovery signal"],
  );
  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "category"))[0],
    "category-detail",
    ["representative category detail sample", "highest combined discovery score"],
  );
  for (const page of sortPages(pages.filter(page => page.pageType === "category")).slice(0, config.maxCategoryPages)) {
    addSelection(selections, page, "category-detail", [
      "representative category detail sample",
      "selected from top-ranked category detail pages",
    ]);
  }
  addSelection(
    selections,
    sortPages(
      pages.filter(
        page => page.pageType === "listing" && /\/(top|best|ranking|popular|trending)(\/|$)/.test(getNormalizedPath(page)),
      ),
    )[0],
    "ranking",
    ["ranking/top archetype", "ranking-like URL"],
  );
  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "favorites" || page.siteRole === "account"))[0],
    "retention",
    ["retention archetype", "favorites/account signal"],
  );
  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "about" || page.siteRole === "about" || page.siteRole === "contact"))[0],
    "trust",
    ["trust archetype", "about/contact signal"],
  );
  addSelection(
    selections,
    sortPages(pages.filter(page => page.pageType === "legal" || page.siteRole === "legal"))[0],
    "legal",
    ["legal archetype", "legal pageType/siteRole signal"],
  );

  const details = detailCandidates(pages);
  if (details.length > 0) {
    const sortedByMainWords = [...details].sort((a, b) => getMainWordCount(a) - getMainWordCount(b));
    const sortedByImages = [...details].sort((a, b) => getImageCount(b) - getImageCount(a) || pageScore(b) - pageScore(a));
    const authorDetail = details.find(looksLikeKnownAuthor);
    const medianWords = median(details.map(page => getMainWordCount(page))) ?? getMainWordCount(details[0]);
    const typicalDetail = [...details].sort(
      (a, b) =>
        Math.abs(getMainWordCount(a) - medianWords) - Math.abs(getMainWordCount(b) - medianWords) ||
        pageScore(b) - pageScore(a),
    )[0];

    addSelection(selections, sortedByMainWords[0], "detail-thin", [
      "detail-page",
      "representative sample: thin-content",
      "lowest main content word count among detail pages",
    ]);
    addSelection(selections, [...sortedByMainWords].reverse()[0], "detail-rich", [
      "detail-page",
      "representative sample: rich-content",
      "highest main content word count among detail pages",
    ]);
    addSelection(selections, authorDetail, "detail-known-author", [
      "detail-page",
      "representative sample: known-author",
      "author-like text signal detected",
    ]);
    addSelection(selections, typicalDetail, "detail-typical", [
      "detail-page",
      "representative sample: typical",
      "closest to median main content word count",
    ]);
    addSelection(selections, sortedByImages[0], "detail-media-heavy", [
      "detail-page",
      "representative sample: media-heavy",
      "highest image/media footprint among detail pages",
    ]);
  }

  let output = [...selections.values()];
  const nonDetailPages = output.filter(page => page.pageType !== "detail");
  const detailPages = output.filter(page => page.pageType === "detail").slice(0, config.maxDetailPages);
  output = [...nonDetailPages, ...detailPages];

  if (config.urlFilter) {
    output = output.filter(page => page.finalUrl.toLowerCase().includes(config.urlFilter || ""));
  }

  if (config.maxSelectedPages && config.maxSelectedPages > 0) {
    output = output.slice(0, config.maxSelectedPages);
  }

  return output;
}
