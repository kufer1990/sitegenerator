import * as fs from "node:fs/promises";
import * as path from "node:path";

type Stage2PageType =
  | "homepage"
  | "contact"
  | "service"
  | "product"
  | "article"
  | "legal"
  | "app"
  | "help"
  | "unknown";

type Stage2Page = {
  [key: string]: unknown;
  url: string;
  error?: string | null;
  finalUrl?: string | null;
  fetchStatus: "ok" | "error";
  statusCode?: number | null;
  contentType?: string | null;
  wasRedirected?: boolean;
  redirectedFrom?: string | null;
  redirectChain?: string[];
  title?: string | null;
  metaDescription?: string | null;
  metaRobots?: string | null;
  canonical?: string | null;
  lang?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogUrl?: string | null;
  ogImage?: string | null;
  h1?: string[];
  h2?: string[];
  rawText?: string;
  mainContentText?: string;
  contentSource?: string;
  bodyTextLength?: number;
  wordCount?: number;
  mainContentWordCount?: number;
  internalLinks?: string[];
  normalizedInternalLinks?: string[];
  externalLinks?: string[];
  images?: unknown[];
  imageCount?: number;
  sections?: unknown[];
  buttons?: string[];
  formsCount?: number;
  emails?: string[];
  phones?: string[];
  socialLinks?: unknown[];
  structuredData?: unknown[];
  contentFlags?: {
    hasMainContent?: boolean;
    hasStructuredData?: boolean;
  };
  pageType?: Stage2PageType;
  pageTypeConfidence?: number;
  pageTypeReason?: string | null;
};

type Stage2Output = {
  sourceFile: string;
  generatedAt: string;
  pagesCount: number;
  processedOkCount: number;
  processedErrorCount: number;
  pages: Stage2Page[];
};

type PageType =
  | "homepage"
  | "about"
  | "contact"
  | "service"
  | "product"
  | "offer"
  | "faq"
  | "article"
  | "help"
  | "gallery"
  | "team"
  | "legal"
  | "category"
  | "tag"
  | "author"
  | "search"
  | "archive"
  | "pagination"
  | "system"
  | "unknown";

type BusinessValue = "high" | "medium" | "low";
type SiteRole =
  | "homepage"
  | "about"
  | "offer"
  | "service-detail"
  | "product-detail"
  | "contact"
  | "faq"
  | "article"
  | "legal"
  | "utility"
  | "unknown";

type Cluster = "core" | "offer" | "content" | "legal" | "utility" | "blog" | "unknown";

type ContentSignals = {
  hasMainContent: boolean;
  hasSections: boolean;
  hasImages: boolean;
  hasContactData: boolean;
  hasForms: boolean;
  hasButtons: boolean;
  hasStructuredData: boolean;
  wordCount: number;
  imageCount: number;
  internalLinksCount: number;
};

type EnrichmentFields = {
  businessValue: BusinessValue;
  shouldKeep: boolean;
  shouldAnalyze: boolean;
  isWordpressLike: boolean;
  isLikelyUtilityPage: boolean;
  isLikelyJunk: boolean;
  confidence: number;
  reason: string;
  contentSignals: ContentSignals;
  siteRole: SiteRole;
  cluster: Cluster;
  parentCandidate: string | null;
};

type EnrichedPage = Stage2Page & EnrichmentFields;

type Stage25Output = {
  sourceFile: string;
  generatedAt: string;
  sourceGeneratedAt: string;
  pagesTotal: number;
  pagesKept: number;
  pagesForAnalysis: number;
  pagesIgnored: number;
  utilityCount: number;
  junkCount: number;
  wordpressLikeCount: number;
  pages: EnrichedPage[];
};

type DetectPageTypeResult = {
  pageType: PageType;
  confidence: number;
  reasons: string[];
};

const SOURCE_FILE_REL = "output/02-page-data.json";
const OUTPUT_FILE_REL = "output/03-enriched-site-data.json";

const UTILITY_TYPES = new Set<PageType>([
  "legal",
  "category",
  "tag",
  "author",
  "search",
  "archive",
  "pagination",
  "system",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function getEffectiveUrl(page: Stage2Page): string {
  return page.finalUrl || page.url;
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function toLowerContext(page: Stage2Page): string {
  const parts = [
    cleanText(page.title),
    cleanText(page.metaDescription),
    arrayOrEmpty(page.h1).join(" "),
    arrayOrEmpty(page.h2).slice(0, 6).join(" "),
    cleanText(page.mainContentText),
    cleanText(page.rawText).slice(0, 700),
  ];

  return cleanText(parts.join(" ")).toLowerCase();
}

function toHeadingContext(page: Stage2Page): string {
  const parts = [
    cleanText(page.title),
    cleanText(page.metaDescription),
    arrayOrEmpty(page.h1).join(" "),
    arrayOrEmpty(page.h2).slice(0, 3).join(" "),
  ];

  return cleanText(parts.join(" ")).toLowerCase();
}

function addScore(
  scores: Map<PageType, number>,
  reasons: Map<PageType, string[]>,
  pageType: PageType,
  score: number,
  reason: string,
): void {
  scores.set(pageType, (scores.get(pageType) || 0) + score);
  const current = reasons.get(pageType) || [];
  current.push(reason);
  reasons.set(pageType, current);
}

function mapStage2PageType(stage2Type: Stage2PageType | undefined): PageType | null {
  if (!stage2Type) return null;

  switch (stage2Type) {
    case "homepage":
      return "homepage";
    case "contact":
      return "contact";
    case "service":
      return "service";
    case "product":
      return "product";
    case "article":
      return "article";
    case "legal":
      return "legal";
    case "help":
      return "help";
    case "app":
      return "system";
    default:
      return null;
  }
}

function detectPageType(page: Stage2Page): DetectPageTypeResult {
  const pageUrl = safeUrl(getEffectiveUrl(page));
  const pathValue = pageUrl?.pathname.toLowerCase() || "/";
  const context = toLowerContext(page);
  const headingContext = toHeadingContext(page);
  const query = pageUrl?.searchParams;

  const scores = new Map<PageType, number>();
  const reasons = new Map<PageType, string[]>();

  if (pathValue === "/" || pathValue === "") {
    addScore(scores, reasons, "homepage", 3, "path '/'");
  }

  if (/^\/wp-(admin|content|includes|json)(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "system", 2.6, "wp-* path");
  }
  if (/^\/(wp-login\.php|xmlrpc\.php)$/.test(pathValue)) {
    addScore(scores, reasons, "system", 2.6, "wp login/xmlrpc path");
  }
  if (/^\/(feed|comments\/feed)(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "system", 2.5, "feed path");
  }
  if (/^\/sitemap(?:[-_a-z0-9]*)?\.xml$/.test(pathValue)) {
    addScore(scores, reasons, "system", 2.5, "sitemap xml path");
  }

  if (pathValue.startsWith("/search") || Boolean(query?.get("s")) || Boolean(query?.get("search"))) {
    addScore(scores, reasons, "search", 2.2, "search path/query");
  }
  if (/\/page\/\d+\/?$/.test(pathValue) || Boolean(query?.get("page")) || Boolean(query?.get("paged"))) {
    addScore(scores, reasons, "pagination", 1.9, "pagination marker");
  }
  if (/^\/category(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "category", 2, "category path");
  }
  if (/^\/tag(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "tag", 2, "tag path");
  }
  if (/^\/author(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "author", 2, "author path");
  }
  if (
    /^\/(archive|archiwum)(\/|$)/.test(pathValue) ||
    /^\/\d{4}(\/\d{1,2})?(\/|$)/.test(pathValue) ||
    /\/date\/\d{4}/.test(pathValue)
  ) {
    addScore(scores, reasons, "archive", 1.9, "archive-like path");
  }

  if (
    /\/(o-nas|about|o-firmie|firma)(\/|$)/.test(pathValue) ||
    /\b(o nas|about us|nasza historia)\b/.test(headingContext)
  ) {
    addScore(scores, reasons, "about", 1.5, "about keyword");
  }
  if (/\/(kontakt|contact)(\/|$)/.test(pathValue)) {
    addScore(scores, reasons, "contact", 2.2, "contact path");
  }
  if (
    /\b(kontakt|contact|skontaktuj)\b/.test(headingContext) &&
    ((page.formsCount || 0) > 0 || arrayOrEmpty(page.emails).length > 0 || arrayOrEmpty(page.phones).length > 0)
  ) {
    addScore(scores, reasons, "contact", 0.6, "contact heading + contact data");
  }
  if (
    /\/(oferta|offer|cennik|pakiety)(\/|$)/.test(pathValue) ||
    /\b(oferta|pakiet|cennik|price list)\b/.test(headingContext)
  ) {
    addScore(scores, reasons, "offer", 1.4, "offer keyword");
  }
  if (
    /\/(uslugi|usluga|service|services)(\/|$)/.test(pathValue) ||
    /\/gabinet(?:-|\/|$)/.test(pathValue) ||
    /\b(uslugi|service|zabieg)\b/.test(headingContext)
  ) {
    addScore(scores, reasons, "service", 1.35, "service keyword");
  }
  if (
    /(badani|medycyn|kardiolog|chirurg|stomatolog|fizjoterapi|dietetyk|psycholog|neurolog|ortoped|diabetolog|laborator|proby)/.test(
      pathValue,
    )
  ) {
    addScore(scores, reasons, "service", 1.8, "medical/service slug");
  }
  if (/\/(produkt|product|shop|sklep)(\/|$)/.test(pathValue) || /\b(produkt|product|kup|zamow)\b/.test(headingContext)) {
    addScore(scores, reasons, "product", 1.2, "product keyword");
  }
  if (/\/(faq|pytania|najczestsze-pytania)(\/|$)/.test(pathValue) || /\b(faq|najczesciej zadawane pytania)\b/.test(headingContext)) {
    addScore(scores, reasons, "faq", 1.7, "faq keyword");
  }
  if (/\/(help|pomoc|support|instrukcja|guide)(\/|$)/.test(pathValue) || /\b(pomoc|support|instrukcja)\b/.test(headingContext)) {
    addScore(scores, reasons, "help", 1.6, "help keyword");
  }
  if (/\/(galeria|gallery|portfolio)(\/|$)/.test(pathValue) || /\b(galeria|portfolio)\b/.test(headingContext)) {
    addScore(scores, reasons, "gallery", 1.45, "gallery keyword");
  }
  if (/\/(zespol|team|lekarze|specjalisci)(\/|$)/.test(pathValue) || /\b(nasz zespol|team)\b/.test(headingContext)) {
    addScore(scores, reasons, "team", 1.4, "team keyword");
  }
  if (
    /\/(polityka|privacy|cookies|regulamin|terms|rodo|legal)(\/|$)/.test(pathValue) ||
    /\b(polityka prywatnosci|privacy policy|regulamin|cookies)\b/.test(headingContext)
  ) {
    addScore(scores, reasons, "legal", 2, "legal keyword");
  }
  if (
    /\/(blog|article|articles|news|aktualnosci|wpis|witaj-swiecie|hello-world)(\/|$)/.test(pathValue) ||
    /\b(blog|artykul|aktualnosci)\b/.test(headingContext)
  ) {
    addScore(scores, reasons, "article", 1.35, "article keyword");
  }

  const stage2Mapped = mapStage2PageType(page.pageType);
  if (stage2Mapped) {
    addScore(scores, reasons, stage2Mapped, 0.7, "stage2 pageType");
  }

  if (!scores.size && context.length > 20) {
    addScore(scores, reasons, "unknown", 0.4, "fallback unknown");
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return {
      pageType: "unknown",
      confidence: 0.25,
      reasons: ["brak silnych sygnalow klasyfikacji"],
    };
  }

  const [bestType, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  let confidence = 0.28 + bestScore * 0.22 + (bestScore - secondScore) * 0.18;

  if (bestType === "unknown") {
    confidence -= 0.12;
  }

  confidence = clamp(confidence, 0.25, 0.98);

  return {
    pageType: bestType,
    confidence: round2(confidence),
    reasons: (reasons.get(bestType) || []).slice(0, 3),
  };
}

function extractContentSignals(page: Stage2Page): ContentSignals {
  const primaryWordCount = Math.max(page.mainContentWordCount || 0, page.wordCount || 0);
  const textContext = cleanText(page.mainContentText || page.rawText).toLowerCase();
  const links = arrayOrEmpty(page.normalizedInternalLinks).length
    ? arrayOrEmpty(page.normalizedInternalLinks)
    : arrayOrEmpty(page.internalLinks);

  const hasMainContent =
    Boolean(page.contentFlags?.hasMainContent) ||
    (page.mainContentWordCount || 0) >= 30 ||
    primaryWordCount >= 80;

  return {
    hasMainContent,
    hasSections: arrayOrEmpty(page.sections).length > 0,
    hasImages: (page.imageCount || 0) > 0,
    hasContactData:
      arrayOrEmpty(page.emails).length > 0 ||
      arrayOrEmpty(page.phones).length > 0 ||
      (/\b(kontakt|contact|telefon|phone|email|e-mail)\b/.test(textContext) &&
        /(\+?\d[\d\s().-]{7,}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/.test(textContext)),
    hasForms: (page.formsCount || 0) > 0,
    hasButtons: arrayOrEmpty(page.buttons).length > 0,
    hasStructuredData:
      Boolean(page.contentFlags?.hasStructuredData) || arrayOrEmpty(page.structuredData).length > 0,
    wordCount: primaryWordCount,
    imageCount: page.imageCount || 0,
    internalLinksCount: links.length,
  };
}

function detectWordpressSignals(page: Stage2Page): string[] {
  const reasons = new Set<string>();
  const pageUrl = safeUrl(getEffectiveUrl(page));
  const pathValue = pageUrl?.pathname.toLowerCase() || "/";
  const context = toLowerContext(page);
  const query = pageUrl?.searchParams;

  if (/\/wp-(content|includes|admin|json)(\/|$)/.test(pathValue)) {
    reasons.add("wp-* path");
  }
  if (/^\/(wp-login\.php|xmlrpc\.php)$/.test(pathValue)) {
    reasons.add("wp login/xmlrpc path");
  }
  if (/^\/(category|tag|author)(\/|$)/.test(pathValue)) {
    reasons.add("wordpress taxonomy/author path");
  }
  if (/^\/\d{4}\/\d{1,2}\//.test(pathValue)) {
    reasons.add("wordpress date permalink");
  }
  if (query) {
    const wpQueryKeys = ["p", "page_id", "attachment_id", "preview", "replytocom", "rest_route"];
    for (const key of wpQueryKeys) {
      if (query.has(key)) {
        reasons.add(`wordpress query param: ${key}`);
      }
    }
  }
  if (/\bwordpress\b/.test(context)) {
    reasons.add("wordpress marker in content");
  }

  return Array.from(reasons);
}

function detectUtilitySignals(
  page: Stage2Page,
  pageType: PageType,
  contentSignals: ContentSignals,
): string[] {
  const reasons = new Set<string>();
  const pageUrl = safeUrl(getEffectiveUrl(page));
  const pathValue = pageUrl?.pathname.toLowerCase() || "/";
  const robots = cleanText(page.metaRobots).toLowerCase();

  if (UTILITY_TYPES.has(pageType)) {
    reasons.add(`utility type: ${pageType}`);
  }
  if (robots.includes("noindex") || robots.includes("nofollow")) {
    reasons.add("meta robots noindex/nofollow");
  }
  if (/\/feed(\/|$)/.test(pathValue) || /\/sitemap(?:[-_a-z0-9]*)?\.xml$/.test(pathValue)) {
    reasons.add("feed/sitemap path");
  }
  if (page.fetchStatus !== "ok") {
    reasons.add("fetchStatus error");
  }
  if (
    !contentSignals.hasMainContent &&
    contentSignals.wordCount < 40 &&
    contentSignals.internalLinksCount > 10
  ) {
    reasons.add("thin navigation-like page");
  }

  return Array.from(reasons);
}

function detectJunkSignals(
  page: Stage2Page,
  pageType: PageType,
  contentSignals: ContentSignals,
): string[] {
  const reasons = new Set<string>();
  const pageUrl = safeUrl(getEffectiveUrl(page));
  const pathValue = pageUrl?.pathname.toLowerCase() || "/";
  const title = cleanText(page.title).toLowerCase();
  const headline = arrayOrEmpty(page.h1).join(" ").toLowerCase();
  const context = `${pathValue} ${title} ${headline} ${toLowerContext(page)}`;

  if (/(witaj-swiecie|hello-world|sample-page|just another wordpress site)/.test(context)) {
    reasons.add("default/test wordpress content");
  }
  if (/\/category\/(bez-kategorii|uncategorized)(\/|$)/.test(pathValue) && contentSignals.wordCount < 90) {
    reasons.add("uncategorized archive with low content");
  }
  if (/\/(feed|comments\/feed)(\/|$)/.test(pathValue)) {
    reasons.add("feed endpoint");
  }

  const utilityOrTechnical = new Set<PageType>([
    "search",
    "tag",
    "author",
    "pagination",
    "archive",
    "system",
    "category",
  ]);

  if (
    utilityOrTechnical.has(pageType) &&
    contentSignals.wordCount < 35 &&
    !contentSignals.hasMainContent &&
    !contentSignals.hasImages &&
    !contentSignals.hasForms &&
    !contentSignals.hasContactData &&
    !contentSignals.hasButtons
  ) {
    reasons.add("utility/technical page with no real content");
  }

  if (
    page.fetchStatus === "error" &&
    contentSignals.wordCount === 0 &&
    contentSignals.imageCount === 0 &&
    !contentSignals.hasStructuredData
  ) {
    reasons.add("failed page without usable content");
  }

  return Array.from(reasons);
}

function inferBusinessValue(
  pageType: PageType,
  isLikelyUtilityPage: boolean,
  isLikelyJunk: boolean,
  contentSignals: ContentSignals,
): BusinessValue {
  if (isLikelyJunk) return "low";

  let value: BusinessValue;

  switch (pageType) {
    case "homepage":
    case "about":
    case "contact":
    case "service":
    case "product":
    case "offer":
    case "team":
      value = "high";
      break;
    case "faq":
    case "article":
    case "help":
    case "gallery":
    case "legal":
    case "unknown":
      value = "medium";
      break;
    default:
      value = "low";
      break;
  }

  if (value === "low" && !isLikelyUtilityPage && contentSignals.hasMainContent && contentSignals.wordCount >= 150) {
    value = "medium";
  }
  if (pageType === "article" && contentSignals.wordCount < 70) {
    value = "low";
  }

  return value;
}

function hasRealContent(contentSignals: ContentSignals): boolean {
  return (
    contentSignals.hasMainContent ||
    contentSignals.wordCount >= 70 ||
    contentSignals.hasSections ||
    contentSignals.hasImages ||
    contentSignals.hasContactData ||
    contentSignals.hasForms ||
    contentSignals.hasButtons
  );
}

function decideShouldKeep(
  page: Stage2Page,
  pageType: PageType,
  isLikelyJunk: boolean,
  contentSignals: ContentSignals,
): boolean {
  if (hasRealContent(contentSignals)) return true;

  if (
    isLikelyJunk &&
    ["system", "search", "pagination", "author", "tag", "archive", "category"].includes(pageType)
  ) {
    return false;
  }

  if (
    pageType === "system" &&
    page.fetchStatus !== "ok" &&
    contentSignals.wordCount === 0 &&
    contentSignals.imageCount === 0
  ) {
    return false;
  }

  return true;
}

function decideShouldAnalyze(
  pageType: PageType,
  businessValue: BusinessValue,
  isLikelyJunk: boolean,
  isLikelyUtilityPage: boolean,
  contentSignals: ContentSignals,
): boolean {
  if (isLikelyJunk) return false;

  if (["search", "pagination", "author", "tag", "archive", "system"].includes(pageType)) {
    return false;
  }

  if (pageType === "legal") {
    return contentSignals.wordCount >= 600 && contentSignals.hasSections;
  }

  if (pageType === "category" && contentSignals.wordCount < 140 && !contentSignals.hasSections) {
    return false;
  }

  if (businessValue === "high") return true;

  if (businessValue === "medium") {
    return !isLikelyUtilityPage || contentSignals.wordCount >= 130;
  }

  return (
    contentSignals.wordCount >= 180 &&
    (contentSignals.hasMainContent || contentSignals.hasSections) &&
    !isLikelyUtilityPage
  );
}

function buildReason(
  pageType: PageType,
  siteRole: SiteRole,
  cluster: Cluster,
  businessValue: BusinessValue,
  shouldKeep: boolean,
  shouldAnalyze: boolean,
  pageTypeReasons: string[],
  wordpressSignals: string[],
  utilitySignals: string[],
  junkSignals: string[],
  contentSignals: ContentSignals,
): string {
  const highlights: string[] = [];

  if (pageTypeReasons.length) {
    highlights.push(`type: ${pageTypeReasons[0]}`);
  }
  if (junkSignals.length) {
    highlights.push(`junk: ${junkSignals[0]}`);
  } else if (utilitySignals.length) {
    highlights.push(`utility: ${utilitySignals[0]}`);
  }
  if (wordpressSignals.length) {
    highlights.push(`wp: ${wordpressSignals[0]}`);
  }

  highlights.push(
    `signals words=${contentSignals.wordCount}, images=${contentSignals.imageCount}, links=${contentSignals.internalLinksCount}`,
  );
  highlights.push(
    `decision keep=${shouldKeep}, analyze=${shouldAnalyze}, value=${businessValue}, type=${pageType}, role=${siteRole}, cluster=${cluster}`,
  );

  return highlights.join(" | ");
}

function computeFinalConfidence(
  pageType: PageType,
  typeConfidence: number,
  shouldKeep: boolean,
  shouldAnalyze: boolean,
  isLikelyUtilityPage: boolean,
  isLikelyJunk: boolean,
): number {
  let confidence = typeConfidence * 0.68;

  if (isLikelyJunk) confidence += 0.16;
  if (isLikelyUtilityPage) confidence += 0.08;
  if (shouldKeep && shouldAnalyze) confidence += 0.08;
  if (shouldKeep && !shouldAnalyze) confidence += 0.04;
  if (!shouldKeep) confidence += 0.1;
  if (pageType === "unknown") confidence -= 0.1;

  return round2(clamp(confidence, 0.2, 0.98));
}

function toNormalizedUrl(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) return null;

  parsed.hash = "";
  if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.href;
}

function getRootUrl(url: URL): string {
  return `${url.origin}/`;
}

function getLinkCandidates(page: Stage2Page): string[] {
  const candidates =
    arrayOrEmpty(page.normalizedInternalLinks).length > 0
      ? arrayOrEmpty(page.normalizedInternalLinks)
      : arrayOrEmpty(page.internalLinks);

  const deduped = new Map<string, string>();

  for (const link of candidates) {
    if (typeof link !== "string") continue;
    const normalized = toNormalizedUrl(link);
    if (!normalized) continue;
    if (!deduped.has(normalized)) {
      deduped.set(normalized, normalized);
    }
  }

  return Array.from(deduped.values());
}

function pathDepth(url: string): number {
  const parsed = safeUrl(url);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  return parsed.pathname.split("/").filter(Boolean).length;
}

function getSortedLinksForPage(page: Stage2Page): string[] {
  const current = safeUrl(getEffectiveUrl(page));
  if (!current) return [];

  const currentNormalized = toNormalizedUrl(current.href);
  if (!currentNormalized) return [];

  return getLinkCandidates(page)
    .filter(link => {
      const parsed = safeUrl(link);
      return Boolean(parsed && parsed.origin === current.origin && link !== currentNormalized);
    })
    .sort((a, b) => pathDepth(a) - pathDepth(b));
}

function findLinkByPathPattern(links: string[], pattern: RegExp): string | null {
  for (const link of links) {
    const parsed = safeUrl(link);
    if (!parsed) continue;
    if (pattern.test(parsed.pathname.toLowerCase())) {
      return link;
    }
  }
  return null;
}

function inferParentCandidate(page: Stage2Page, pageType: PageType): string | null {
  const current = safeUrl(getEffectiveUrl(page));
  if (!current) return null;
  if (current.pathname === "/" || current.pathname === "") return null;

  const links = getSortedLinksForPage(page);
  if (!links.length) return null;

  if (["service", "product", "offer"].includes(pageType)) {
    const offerParent = findLinkByPathPattern(
      links,
      /\/(oferta|offer|uslugi|usluga|services|service|pakiety|cennik)(\/|$)/i,
    );
    if (offerParent) return offerParent;
  }

  if (["article", "category", "tag", "archive"].includes(pageType)) {
    const contentParent = findLinkByPathPattern(links, /\/(blog|aktualnosci|news|article|artykul)(\/|$)/i);
    if (contentParent) return contentParent;
  }

  const currentPath = current.pathname.replace(/\/+$/, "");
  const pathSegments = currentPath.split("/").filter(Boolean);
  if (pathSegments.length > 1) {
    const parentPath = `/${pathSegments.slice(0, -1).join("/")}`;
    const parentUrl = toNormalizedUrl(`${current.origin}${parentPath}`);
    if (parentUrl && links.includes(parentUrl)) {
      return parentUrl;
    }
  }

  const rootUrl = getRootUrl(current);
  if (links.includes(rootUrl)) {
    return rootUrl;
  }

  return null;
}

function inferSiteRole(pageType: PageType): SiteRole {
  switch (pageType) {
    case "homepage":
      return "homepage";
    case "about":
    case "team":
      return "about";
    case "offer":
      return "offer";
    case "service":
      return "service-detail";
    case "product":
      return "product-detail";
    case "contact":
      return "contact";
    case "faq":
      return "faq";
    case "article":
      return "article";
    case "legal":
      return "legal";
    case "category":
    case "tag":
    case "author":
    case "search":
    case "archive":
    case "pagination":
    case "system":
      return "utility";
    default:
      return "unknown";
  }
}

function inferCluster(siteRole: SiteRole): Cluster {
  switch (siteRole) {
    case "homepage":
    case "about":
    case "contact":
      return "core";
    case "offer":
    case "service-detail":
    case "product-detail":
      return "offer";
    case "faq":
      return "content";
    case "article":
      return "blog";
    case "legal":
      return "legal";
    case "utility":
      return "utility";
    default:
      return "unknown";
  }
}

function classifyPage(page: Stage2Page): EnrichmentFields {
  const typeDetection = detectPageType(page);
  const contentSignals = extractContentSignals(page);
  const wordpressSignals = detectWordpressSignals(page);
  const utilitySignals = detectUtilitySignals(page, typeDetection.pageType, contentSignals);
  const junkSignals = detectJunkSignals(page, typeDetection.pageType, contentSignals);

  const isWordpressLike = wordpressSignals.length > 0;
  const isLikelyUtilityPage = utilitySignals.length > 0;
  const isLikelyJunk = junkSignals.length > 0;

  const businessValue = inferBusinessValue(
    typeDetection.pageType,
    isLikelyUtilityPage,
    isLikelyJunk,
    contentSignals,
  );

  const shouldKeep = decideShouldKeep(page, typeDetection.pageType, isLikelyJunk, contentSignals);
  const shouldAnalyze = decideShouldAnalyze(
    typeDetection.pageType,
    businessValue,
    isLikelyJunk,
    isLikelyUtilityPage,
    contentSignals,
  );
  const siteRole = inferSiteRole(typeDetection.pageType);
  const cluster = inferCluster(siteRole);
  const parentCandidate = inferParentCandidate(page, typeDetection.pageType);

  const reason = buildReason(
    typeDetection.pageType,
    siteRole,
    cluster,
    businessValue,
    shouldKeep,
    shouldAnalyze,
    typeDetection.reasons,
    wordpressSignals,
    utilitySignals,
    junkSignals,
    contentSignals,
  );

  const confidence = computeFinalConfidence(
    typeDetection.pageType,
    typeDetection.confidence,
    shouldKeep,
    shouldAnalyze,
    isLikelyUtilityPage,
    isLikelyJunk,
  );

  return {
    businessValue,
    shouldKeep,
    shouldAnalyze,
    isWordpressLike,
    isLikelyUtilityPage,
    isLikelyJunk,
    confidence,
    reason,
    contentSignals,
    siteRole,
    cluster,
    parentCandidate,
  };
}

async function readInput(sourcePath: string): Promise<Stage2Output> {
  const content = await fs.readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(content) as Stage2Output;

  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error("Nieprawidlowy format output/02-page-data.json");
  }

  return parsed;
}

async function saveOutput(outputPath: string, output: Stage25Output): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
}

async function main(): Promise<void> {
  const sourcePath = path.resolve(SOURCE_FILE_REL);
  const outputPath = path.resolve(OUTPUT_FILE_REL);

  const source = await readInput(sourcePath);
  const pages: EnrichedPage[] = source.pages.map(page => ({
    ...page,
    ...classifyPage(page),
  }));

  const pagesTotal = pages.length;
  const pagesKept = pages.filter(page => page.shouldKeep).length;
  const pagesForAnalysis = pages.filter(page => page.shouldAnalyze).length;
  const pagesIgnored = pagesTotal - pagesKept;

  const output: Stage25Output = {
    sourceFile: SOURCE_FILE_REL,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: source.generatedAt,
    pagesTotal,
    pagesKept,
    pagesForAnalysis,
    pagesIgnored,
    utilityCount: pages.filter(page => page.isLikelyUtilityPage).length,
    junkCount: pages.filter(page => page.isLikelyJunk).length,
    wordpressLikeCount: pages.filter(page => page.isWordpressLike).length,
    pages,
  };

  await saveOutput(outputPath, output);

  console.log("Etap 2.5 zakonczony.");
  console.log(`- source: ${sourcePath}`);
  console.log(`- output: ${outputPath}`);
  console.log(`- pagesTotal: ${output.pagesTotal}`);
  console.log(`- pagesKept: ${output.pagesKept}`);
  console.log(`- pagesForAnalysis: ${output.pagesForAnalysis}`);
  console.log(`- pagesIgnored: ${output.pagesIgnored}`);
  console.log(`- utilityCount: ${output.utilityCount}`);
  console.log(`- junkCount: ${output.junkCount}`);
  console.log(`- wordpressLikeCount: ${output.wordpressLikeCount}`);
}

main().catch(error => {
  console.error("Blad krytyczny w etapie 2.5:", error);
  process.exit(1);
});
