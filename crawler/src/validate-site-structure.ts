import * as fs from "node:fs/promises";
import * as path from "node:path";

type LegacyStage2PageType =
  | "homepage"
  | "contact"
  | "service"
  | "product"
  | "article"
  | "legal"
  | "app"
  | "help"
  | "unknown";

export type PageType =
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

export type PageClassification = {
  pageType: PageType;
  pageSubtype: string | null;
  confidence: number;
  signals: string[];
};

export type ValidationWarning = {
  code:
    | "LOW_CLASSIFICATION_CONFIDENCE"
    | "EMPTY_MAIN_CONTENT"
    | "TITLE_MISSING"
    | "POSSIBLE_CLIENT_SIDE_LOADER"
    | "FETCH_ERROR"
    | "URL_INVALID";
  message: string;
};

export type NormalizedPageData = {
  effectiveUrl: string;
  normalizedPath: string;
  rawTitle: string | null;
  normalizedTitle: string;
  normalizedMetaTitle: string;
  normalizedMetaDescription: string;
  normalizedHeadings: string;
  normalizedVisibleText: string;
  normalizedVisibleTextSnippet: string;
  queryParamKeys: string[];
  mainContentWordCount: number;
  contentWordCount: number;
  hasMainContent: boolean;
};

type Stage2Page = {
  [key: string]: unknown;
  url: string;
  finalUrl?: string | null;
  fetchStatus: "ok" | "error";
  statusCode?: number | null;
  contentType?: string | null;
  title?: string | null;
  metaDescription?: string | null;
  metaRobots?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  h1?: string[];
  h2?: string[];
  rawText?: string;
  mainContentText?: string;
  contentSource?: string;
  wordCount?: number;
  mainContentWordCount?: number;
  internalLinks?: string[];
  normalizedInternalLinks?: string[];
  imageCount?: number;
  sections?: unknown[];
  buttons?: string[];
  formsCount?: number;
  emails?: string[];
  phones?: string[];
  structuredData?: unknown[];
  contentFlags?: {
    hasMainContent?: boolean;
    hasStructuredData?: boolean;
  };
  pageType?: LegacyStage2PageType;
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

type ContentSignals = {
  hasMainContent: boolean;
  hasSections: boolean;
  hasImages: boolean;
  hasContactData: boolean;
  hasForms: boolean;
  hasButtons: boolean;
  hasStructuredData: boolean;
  wordCount: number;
  mainContentWordCount: number;
  imageCount: number;
  internalLinksCount: number;
};

type EnrichmentFields = {
  normalizedPath: string;
  rawTitle: string | null;
  normalizedTitle: string;
  normalizedMetaDescription: string;
  normalizedHeadings: string;
  normalizedVisibleTextSnippet: string;
  rawPageType: LegacyStage2PageType | null;
  rawPageTypeConfidence: number | null;
  rawPageTypeReason: string | null;
  classification: PageClassification;
  warnings: ValidationWarning[];
  pageType: PageType;
  pageSubtype: string | null;
  pageTypeConfidence: number;
  pageTypeReason: string | null;
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

type EnrichedPage = Omit<Stage2Page, "pageType" | "pageTypeConfidence" | "pageTypeReason"> & EnrichmentFields;

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
  unknownCount: number;
  lowConfidenceCount: number;
  warningsCount: number;
  pages: EnrichedPage[];
};

type ClassifierContext = {
  path: string;
  segments: string[];
  queryKeys: Set<string>;
  title: string;
  metaTitle: string;
  metaDescription: string;
  headings: string;
  text: string;
  buttons: string;
  allText: string;
  hasForm: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  mainWordCount: number;
  totalWordCount: number;
  contentType: string;
  fetchStatus: "ok" | "error";
  internalLinksCount: number;
};

type ScoreState = {
  score: number;
  signals: string[];
  subtypeWeights: Map<string, number>;
};

const SOURCE_FILE_REL = "output/02-page-data.json";
const OUTPUT_FILE_REL = "output/03-enriched-site-data.json";
const PAGE_TYPES: PageType[] = [
  "home",
  "listing",
  "category",
  "detail",
  "creator",
  "search",
  "favorites",
  "auth",
  "legal",
  "contact",
  "about",
  "utility",
  "unknown",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: string | null | undefined): number {
  const text = cleanText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function safeUrl(input: string | null | undefined): URL | null {
  if (!input) return null;
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function normalizePathname(pathname: string): string {
  const compact = (pathname || "/").replace(/\/+/, "/").replace(/\/+/g, "/");
  const withoutTrailing = compact === "/" ? "/" : compact.replace(/\/+$/, "");
  const decoded = withoutTrailing
    .split("/")
    .map(segment => {
      if (!segment) return "";
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
  return (decoded || "/").toLowerCase();
}

function getEffectiveUrl(page: Stage2Page): string {
  return page.finalUrl || page.url;
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function addScore(
  scores: Map<PageType, ScoreState>,
  pageType: PageType,
  score: number,
  signal: string,
  subtype?: string,
): void {
  const current = scores.get(pageType);
  if (!current) return;
  current.score += score;
  current.signals.push(signal);
  if (subtype) {
    current.subtypeWeights.set(subtype, (current.subtypeWeights.get(subtype) || 0) + score);
  }
}

function calculateConfidence(bestScore: number, secondScore: number, pageType: PageType): number {
  const strength = clamp(bestScore / 6.5, 0, 1);
  const margin = bestScore > 0 ? clamp((bestScore - secondScore) / Math.max(bestScore, 1), 0, 1) : 0;
  let confidence = 0.2 + strength * 0.55 + margin * 0.25;
  if (bestScore >= 4.6) confidence += 0.08;
  if (bestScore <= 1.6) confidence -= 0.08;
  if (pageType === "unknown") confidence = Math.min(confidence, 0.45);
  return round2(clamp(confidence, 0, 1));
}

function mapLegacyPageType(legacy: LegacyStage2PageType | undefined): PageType | null {
  switch (legacy) {
    case "homepage":
      return "home";
    case "contact":
      return "contact";
    case "service":
    case "product":
    case "article":
      return "detail";
    case "legal":
      return "legal";
    case "app":
      return "creator";
    case "help":
      return "utility";
    default:
      return null;
  }
}

function normalizePageData(page: Stage2Page): NormalizedPageData {
  const parsed = safeUrl(getEffectiveUrl(page));
  const normalizedPath = normalizePathname(parsed?.pathname || "/");
  const normalizedTitle = cleanText(page.title);
  const normalizedMetaTitle = cleanText(page.ogTitle);
  const normalizedMetaDescription = cleanText(page.metaDescription || page.ogDescription);
  const normalizedHeadings = cleanText([...arrayOrEmpty(page.h1), ...arrayOrEmpty(page.h2)].join(" "));
  const normalizedVisibleText = cleanText(page.mainContentText || page.rawText);
  const mainContentWordCount = Math.max(page.mainContentWordCount || 0, wordCount(page.mainContentText));
  const contentWordCount = Math.max(page.wordCount || 0, wordCount(page.rawText));
  return {
    effectiveUrl: getEffectiveUrl(page),
    normalizedPath,
    rawTitle: page.title ?? null,
    normalizedTitle,
    normalizedMetaTitle,
    normalizedMetaDescription,
    normalizedHeadings,
    normalizedVisibleText,
    normalizedVisibleTextSnippet: normalizedVisibleText.slice(0, 240),
    queryParamKeys: parsed ? [...new Set([...parsed.searchParams.keys()].map(key => key.toLowerCase()))] : [],
    mainContentWordCount,
    contentWordCount,
    hasMainContent:
      Boolean(page.contentFlags?.hasMainContent) || mainContentWordCount >= 25 || contentWordCount >= 80,
  };
}

function makeClassifierContext(page: Stage2Page, normalized: NormalizedPageData): ClassifierContext {
  const title = normalized.normalizedTitle.toLowerCase();
  const metaTitle = normalized.normalizedMetaTitle.toLowerCase();
  const metaDescription = normalized.normalizedMetaDescription.toLowerCase();
  const headings = normalized.normalizedHeadings.toLowerCase();
  const text = normalized.normalizedVisibleText.toLowerCase();
  const buttons = cleanText(arrayOrEmpty(page.buttons).join(" ")).toLowerCase();

  return {
    path: normalized.normalizedPath,
    segments: normalized.normalizedPath.split("/").filter(Boolean),
    queryKeys: new Set(normalized.queryParamKeys),
    title,
    metaTitle,
    metaDescription,
    headings,
    text,
    buttons,
    allText: cleanText(`${title} ${metaTitle} ${metaDescription} ${headings} ${text} ${buttons}`).toLowerCase(),
    hasForm: (page.formsCount || 0) > 0,
    hasEmail: arrayOrEmpty(page.emails).length > 0,
    hasPhone: arrayOrEmpty(page.phones).length > 0,
    mainWordCount: normalized.mainContentWordCount,
    totalWordCount: normalized.contentWordCount,
    contentType: cleanText(page.contentType).toLowerCase(),
    fetchStatus: page.fetchStatus,
    internalLinksCount:
      arrayOrEmpty(page.normalizedInternalLinks).length || arrayOrEmpty(page.internalLinks).length,
  };
}

function detectLegalPage(context: ClassifierContext): Array<{ score: number; signal: string; subtype?: string }> {
  const result: Array<{ score: number; signal: string; subtype?: string }> = [];

  if (/\/(privacy|privacy-policy|polityka-prywatnosci)(\/|$)/.test(context.path)) {
    result.push({ score: 4.9, signal: "url contains privacy policy marker", subtype: "privacy" });
  }
  if (/\/(terms|terms-and-conditions|regulamin|warunki)(\/|$)/.test(context.path)) {
    result.push({ score: 4.9, signal: "url contains terms/regulations marker", subtype: "terms" });
  }
  if (/\/(cookies|cookie-policy|polityka-cookies)(\/|$)/.test(context.path)) {
    result.push({ score: 4.6, signal: "url contains cookies marker", subtype: "cookies" });
  }
  if (/\/(rodo|gdpr|legal)(\/|$)/.test(context.path)) {
    result.push({ score: 4.5, signal: "url contains legal/compliance marker", subtype: "compliance" });
  }
  if (
    containsAny(context.title + " " + context.headings, [
      /privacy policy|polityka prywatnosci|regulamin|terms and conditions|cookies policy|polityka cookies|rodo/,
    ])
  ) {
    result.push({ score: 2.2, signal: "title/headings contain legal terms" });
  }

  return result;
}

function detectAuthPage(context: ClassifierContext): Array<{ score: number; signal: string; subtype?: string }> {
  const result: Array<{ score: number; signal: string; subtype?: string }> = [];

  if (/^\/(login|log-in|signin|sign-in)(\/|$)/.test(context.path)) {
    result.push({ score: 4.9, signal: "url contains login marker", subtype: "login" });
  }
  if (/^\/(register|signup|sign-up)(\/|$)/.test(context.path)) {
    result.push({ score: 4.9, signal: "url contains register marker", subtype: "register" });
  }
  if (/^\/(logout|signout|sign-out)(\/|$)/.test(context.path)) {
    result.push({ score: 4.6, signal: "url contains logout marker", subtype: "logout" });
  }
  if (/^\/(forgot-password|reset-password|password-reset)(\/|$)/.test(context.path)) {
    result.push({ score: 4.7, signal: "url contains password reset marker", subtype: "password-reset" });
  }
  if (/^\/auth(\/|$)/.test(context.path)) {
    result.push({ score: 4.7, signal: "url contains /auth namespace", subtype: "auth" });
  }
  if (
    context.hasForm &&
    containsAny(context.allText, [
      /log in|login|sign in|zaloguj|register|signup|utworz konto|create account|reset password|forgot password/,
    ])
  ) {
    result.push({ score: 2.3, signal: "form + auth text markers" });
  }

  return result;
}

function pickSubtype(entry: ScoreState): string | null {
  const ranked = [...entry.subtypeWeights.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || null;
}

function classifyPageType(page: Stage2Page, normalized: NormalizedPageData): PageClassification {
  const context = makeClassifierContext(page, normalized);
  const scores = new Map<PageType, ScoreState>();

  for (const pageType of PAGE_TYPES) {
    scores.set(pageType, { score: 0, signals: [], subtypeWeights: new Map<string, number>() });
  }

  if (context.path === "/") addScore(scores, "home", 5.2, "url pathname is root '/'");
  if (/^\/(home|start)(\/|$)/.test(context.path)) {
    addScore(scores, "home", 3.2, "url contains explicit home/start slug");
  }

  if (/^\/(categories|listing|catalog|collections?|top|quotes|cytaty)(\/)?$/.test(context.path)) {
    addScore(scores, "listing", 4.9, "url matches listing root pattern");
  }

  if (/^\/(categories|category|kategorie|kategoria)\/[a-z0-9\-._~%]+(\/|$)/.test(context.path)) {
    addScore(scores, "category", 5, "url matches category detail pattern", context.segments[1] || "item");
  }

  if (/^\/(quote|quotes|cytat|cytaty|detail|details|post|posts|article|articles)\/[a-z0-9\-._~%]+(\/|$)/.test(context.path)) {
    addScore(scores, "detail", 4.9, "url matches content detail pattern", context.segments[0] || "detail");
  }

  if (/^\/(create|creator|generator|editor|compose|kreator|stworz|utworz)(\/|$)/.test(context.path)) {
    addScore(scores, "creator", 5, "url contains content creation marker", context.segments[1] || "default");
  }

  if (containsAny(context.title + " " + context.buttons + " " + context.headings, [/create|generate|stworz|utworz|kreator|generator/])) {
    addScore(scores, "creator", 2.2, "title/headings/buttons suggest content generation intent");
  }

  if (/^\/(search|szukaj|find)(\/|$)/.test(context.path)) {
    addScore(scores, "search", 4.9, "url contains /search-like path");
  }
  if (["q", "query", "s", "search"].some(key => context.queryKeys.has(key))) {
    addScore(scores, "search", 3.8, "query string includes search parameter");
  }
  if (containsAny(context.allText, [/search results|wyniki wyszukiwania|filtruj|filter results/])) {
    addScore(scores, "search", 1.8, "text indicates search results page");
  }

  if (/^\/(favorites|favourites|saved|bookmarks|ulubione)(\/|$)/.test(context.path)) {
    addScore(scores, "favorites", 4.9, "url contains favorites/saved marker");
  }
  if (containsAny(context.title + " " + context.headings, [/favorites|saved|ulubione|zapisane/])) {
    addScore(scores, "favorites", 1.9, "title/headings indicate favorites page");
  }

  for (const signal of detectAuthPage(context)) {
    addScore(scores, "auth", signal.score, signal.signal, signal.subtype);
  }
  for (const signal of detectLegalPage(context)) {
    addScore(scores, "legal", signal.score, signal.signal, signal.subtype);
  }

  if (/^\/(contact|kontakt|support)(\/|$)/.test(context.path)) {
    addScore(scores, "contact", 4.8, "url contains contact marker");
  }
  if (
    (context.hasEmail || context.hasPhone || context.hasForm) &&
    containsAny(context.title + " " + context.headings + " " + context.text, [
      /contact|kontakt|skontaktuj|zadzwon|napisz do nas|support/,
    ])
  ) {
    addScore(scores, "contact", 2.5, "contact intent + contact data/form signals");
  }

  if (/^\/(about|o-nas|o-firmie|kim-jestesmy|our-story|mission)(\/|$)/.test(context.path)) {
    addScore(scores, "about", 4.7, "url contains about marker");
  }
  if (containsAny(context.title + " " + context.headings, [/about us|o nas|nasza historia|kim jestesmy|misja|vision|our mission/])) {
    addScore(scores, "about", 2.1, "title/headings indicate about page");
  }

  if (
    context.segments.length <= 1 &&
    context.internalLinksCount >= 18 &&
    containsAny(context.text, [/strona\s+\d+\s+z\s+\d+|page\s+\d+\s+of\s+\d+|kategorie|categories|browse|list/])
  ) {
    addScore(scores, "listing", 2.1, "list-like pagination and internal linking footprint");
  }

  if (
    context.segments.length >= 2 &&
    context.mainWordCount >= 80 &&
    !/^\/(categories|category|search|favorites|auth|login|register|privacy|terms|contact|about|create)/.test(context.path)
  ) {
    addScore(scores, "detail", 2.2, "deep path + substantial content suggests detail page");
  }

  if (/^\/(404|500|error|api|_next|sitemap|feed|rss|robots\.txt|manifest|favicon\.ico|status|health)(\/|$)/.test(context.path)) {
    addScore(scores, "utility", 5, "url matches technical/system endpoint", context.segments[0] || "system");
  }
  if (/\.(xml|json|txt|js|css)$/.test(context.path)) {
    addScore(scores, "utility", 4.2, "url extension indicates machine-readable utility endpoint");
  }
  if (context.fetchStatus !== "ok") addScore(scores, "utility", 3.2, "fetch status is error");
  if (context.contentType && !/text\/html|application\/xhtml\+xml/.test(context.contentType)) {
    addScore(scores, "utility", 1.7, "content type indicates non-document resource");
  }

  const legacy = mapLegacyPageType(page.pageType);
  if (legacy) addScore(scores, legacy, 0.7, "legacy stage2 pageType hint");

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const best = ranked[0];
  const secondScore = ranked[1]?.[1].score || 0;

  if (!best || best[1].score <= 0) {
    return {
      pageType: "unknown",
      pageSubtype: null,
      confidence: 0.25,
      signals: ["no strong deterministic match from url/title/content"],
    };
  }

  return {
    pageType: best[0],
    pageSubtype: pickSubtype(best[1]),
    confidence: calculateConfidence(best[1].score, secondScore, best[0]),
    signals: [...new Set(best[1].signals)].slice(0, 6),
  };
}

function collectValidationWarnings(
  page: Stage2Page,
  normalized: NormalizedPageData,
  classification: PageClassification,
): ValidationWarning[] {
  const warnings = new Map<ValidationWarning["code"], ValidationWarning>();
  const add = (code: ValidationWarning["code"], message: string): void => {
    if (!warnings.has(code)) warnings.set(code, { code, message });
  };

  if (!safeUrl(normalized.effectiveUrl)) add("URL_INVALID", "Effective URL cannot be parsed.");
  if (page.fetchStatus !== "ok") add("FETCH_ERROR", "Page fetch status is error.");
  if (!normalized.normalizedTitle) add("TITLE_MISSING", "Title is empty or missing.");
  if (normalized.mainContentWordCount === 0) add("EMPTY_MAIN_CONTENT", "Main content text is empty.");

  const loaderPattern = /(loading|please wait|ladowanie|spinner|enable javascript|app is loading|hydrating)/i;
  if (
    page.fetchStatus === "ok" &&
    normalized.mainContentWordCount < 20 &&
    (loaderPattern.test(cleanText(page.rawText)) || page.contentSource === "empty")
  ) {
    add(
      "POSSIBLE_CLIENT_SIDE_LOADER",
      "Page appears to be a client-side loader with little extracted content.",
    );
  }

  if (classification.confidence < 0.55) {
    add(
      "LOW_CLASSIFICATION_CONFIDENCE",
      `Deterministic classification confidence is low (${classification.confidence}).`,
    );
  }

  return [...warnings.values()];
}

function extractContentSignals(page: Stage2Page, normalized: NormalizedPageData): ContentSignals {
  const links = arrayOrEmpty(page.normalizedInternalLinks).length
    ? arrayOrEmpty(page.normalizedInternalLinks)
    : arrayOrEmpty(page.internalLinks);

  const joinedText = cleanText(`${page.mainContentText || ""} ${page.rawText || ""}`).toLowerCase();

  return {
    hasMainContent: normalized.hasMainContent,
    hasSections: arrayOrEmpty(page.sections).length > 0,
    hasImages: (page.imageCount || 0) > 0,
    hasContactData:
      arrayOrEmpty(page.emails).length > 0 ||
      arrayOrEmpty(page.phones).length > 0 ||
      /contact|kontakt|telefon|phone|email|e-mail/.test(joinedText),
    hasForms: (page.formsCount || 0) > 0,
    hasButtons: arrayOrEmpty(page.buttons).length > 0,
    hasStructuredData:
      Boolean(page.contentFlags?.hasStructuredData) || arrayOrEmpty(page.structuredData).length > 0,
    wordCount: normalized.contentWordCount,
    mainContentWordCount: normalized.mainContentWordCount,
    imageCount: page.imageCount || 0,
    internalLinksCount: links.length,
  };
}

function detectWordpressSignals(page: Stage2Page, normalizedPath: string): string[] {
  const reasons = new Set<string>();
  const parsed = safeUrl(getEffectiveUrl(page));

  if (/^\/wp-(admin|content|includes|json)(\/|$)/.test(normalizedPath)) reasons.add("wp-* path");
  if (/^\/(wp-login\.php|xmlrpc\.php)$/.test(normalizedPath)) reasons.add("wp login/xmlrpc endpoint");
  if (/^\/(category|tag|author)(\/|$)/.test(normalizedPath)) reasons.add("wp taxonomy path");

  for (const key of ["p", "page_id", "attachment_id", "preview", "replytocom", "rest_route"]) {
    if (parsed?.searchParams.has(key)) reasons.add(`wordpress query param: ${key}`);
  }

  return [...reasons];
}

function inferBusinessValue(pageType: PageType, contentSignals: ContentSignals): BusinessValue {
  switch (pageType) {
    case "home":
    case "listing":
    case "category":
    case "detail":
    case "creator":
    case "contact":
    case "about":
      return "high";
    case "favorites":
    case "search":
    case "legal":
    case "auth":
      return contentSignals.wordCount >= 180 ? "medium" : "low";
    case "utility":
      return "low";
    default:
      return contentSignals.wordCount >= 140 ? "medium" : "low";
  }
}

function inferSiteRole(pageType: PageType): SiteRole {
  switch (pageType) {
    case "home":
      return "homepage";
    case "listing":
    case "category":
    case "search":
      return "discovery";
    case "detail":
      return "detail";
    case "creator":
      return "creator";
    case "favorites":
    case "auth":
      return "account";
    case "contact":
      return "contact";
    case "about":
      return "about";
    case "legal":
      return "legal";
    case "utility":
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
    case "discovery":
      return "discovery";
    case "detail":
      return "content";
    case "creator":
      return "conversion";
    case "account":
      return "account";
    case "legal":
      return "legal";
    case "utility":
      return "utility";
    default:
      return "unknown";
  }
}

function isLikelyUtilityPage(pageType: PageType, page: Stage2Page, contentSignals: ContentSignals): boolean {
  if (pageType === "utility") return true;
  if (page.fetchStatus !== "ok") return true;

  const robots = cleanText(page.metaRobots).toLowerCase();
  if (robots.includes("noindex") || robots.includes("nofollow")) return true;

  return ["search", "legal", "auth"].includes(pageType) && contentSignals.mainContentWordCount < 35;
}

function isLikelyJunkPage(
  pageType: PageType,
  page: Stage2Page,
  contentSignals: ContentSignals,
  warnings: ValidationWarning[],
): boolean {
  if (page.fetchStatus === "error" && contentSignals.wordCount === 0) return true;

  const codes = new Set(warnings.map(item => item.code));
  if (codes.has("POSSIBLE_CLIENT_SIDE_LOADER") && contentSignals.wordCount < 30) return true;

  return pageType === "utility" && contentSignals.wordCount < 25 && !contentSignals.hasMainContent;
}

function decideShouldKeep(pageType: PageType, isLikelyJunk: boolean, contentSignals: ContentSignals): boolean {
  if (
    contentSignals.hasMainContent ||
    contentSignals.wordCount >= 70 ||
    contentSignals.hasSections ||
    contentSignals.hasImages ||
    contentSignals.hasContactData ||
    contentSignals.hasForms ||
    contentSignals.hasButtons
  ) {
    return true;
  }

  if (isLikelyJunk) return !["utility", "search"].includes(pageType);
  return pageType !== "utility";
}

function decideShouldAnalyze(
  pageType: PageType,
  businessValue: BusinessValue,
  isLikelyJunk: boolean,
  classification: PageClassification,
  contentSignals: ContentSignals,
): boolean {
  if (isLikelyJunk) return false;
  if (["utility", "auth", "search"].includes(pageType)) return false;
  if (pageType === "legal") return contentSignals.wordCount >= 220;
  if (classification.confidence < 0.4 && pageType === "unknown") return false;

  if (businessValue === "high") return true;
  if (businessValue === "medium") return contentSignals.wordCount >= 90;

  return contentSignals.wordCount >= 180 && contentSignals.hasMainContent;
}

function computeDecisionConfidence(
  classification: PageClassification,
  shouldKeep: boolean,
  shouldAnalyze: boolean,
  isUtility: boolean,
  isJunk: boolean,
): number {
  let confidence = classification.confidence * 0.7;
  if (shouldKeep) confidence += 0.08;
  if (shouldAnalyze) confidence += 0.08;
  if (isUtility) confidence += 0.05;
  if (isJunk) confidence += 0.08;
  if (classification.pageType === "unknown") confidence -= 0.1;
  return round2(clamp(confidence, 0.2, 0.98));
}

function toNormalizedUrl(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  parsed.hash = "";
  parsed.pathname = normalizePathname(parsed.pathname);
  return parsed.href;
}

function inferParentCandidate(page: Stage2Page, pageType: PageType): string | null {
  const current = safeUrl(getEffectiveUrl(page));
  if (!current) return null;

  const candidates = arrayOrEmpty(page.normalizedInternalLinks).length
    ? arrayOrEmpty(page.normalizedInternalLinks)
    : arrayOrEmpty(page.internalLinks);

  const normalized = [...new Set(candidates.map(link => toNormalizedUrl(link)).filter(Boolean))] as string[];
  if (!normalized.length) return null;

  const listingRegex = /\/(categories|category|listing|catalog|top|quotes|cytaty)(\/|$)/;
  const accountRegex = /\/(create|creator|auth|account|profile)(\/|$)/;

  if (["detail", "category"].includes(pageType)) {
    const parent = normalized.find(link => listingRegex.test(normalizePathname(new URL(link).pathname)));
    if (parent) return parent;
  }

  if (["creator", "favorites", "auth"].includes(pageType)) {
    const parent = normalized.find(link => accountRegex.test(normalizePathname(new URL(link).pathname)));
    if (parent) return parent;
  }

  const currentPath = normalizePathname(current.pathname);
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length > 1) {
    const parentPath = `/${segments.slice(0, -1).join("/")}`;
    const parentUrl = toNormalizedUrl(`${current.origin}${parentPath}`);
    if (parentUrl && normalized.includes(parentUrl)) return parentUrl;
  }

  const root = `${current.origin}/`;
  return normalized.includes(root) ? root : null;
}

function buildReason(
  classification: PageClassification,
  warnings: ValidationWarning[],
  shouldKeep: boolean,
  shouldAnalyze: boolean,
  businessValue: BusinessValue,
  siteRole: SiteRole,
  cluster: Cluster,
  contentSignals: ContentSignals,
): string {
  const parts: string[] = [];
  if (classification.signals.length) parts.push(`classification: ${classification.signals[0]}`);
  if (warnings.length) parts.push(`warnings: ${warnings.map(item => item.code).join(",")}`);
  parts.push(
    `signals words=${contentSignals.wordCount}, mainWords=${contentSignals.mainContentWordCount}, images=${contentSignals.imageCount}, links=${contentSignals.internalLinksCount}`,
  );
  parts.push(
    `decision keep=${shouldKeep}, analyze=${shouldAnalyze}, value=${businessValue}, role=${siteRole}, cluster=${cluster}`,
  );
  return parts.join(" | ");
}

function enrichPage(page: Stage2Page): EnrichedPage {
  const normalized = normalizePageData(page);
  const classification = classifyPageType(page, normalized);
  const warnings = collectValidationWarnings(page, normalized, classification);
  const contentSignals = extractContentSignals(page, normalized);
  const wordpressSignals = detectWordpressSignals(page, normalized.normalizedPath);

  const businessValue = inferBusinessValue(classification.pageType, contentSignals);
  const shouldKeep = decideShouldKeep(
    classification.pageType,
    isLikelyJunkPage(classification.pageType, page, contentSignals, warnings),
    contentSignals,
  );

  const isUtility = isLikelyUtilityPage(classification.pageType, page, contentSignals);
  const isJunk = isLikelyJunkPage(classification.pageType, page, contentSignals, warnings);

  const shouldAnalyze = decideShouldAnalyze(
    classification.pageType,
    businessValue,
    isJunk,
    classification,
    contentSignals,
  );

  const siteRole = inferSiteRole(classification.pageType);
  const cluster = inferCluster(siteRole);

  const reason = buildReason(
    classification,
    warnings,
    shouldKeep,
    shouldAnalyze,
    businessValue,
    siteRole,
    cluster,
    contentSignals,
  );

  return {
    ...page,
    normalizedPath: normalized.normalizedPath,
    rawTitle: normalized.rawTitle,
    normalizedTitle: normalized.normalizedTitle,
    normalizedMetaDescription: normalized.normalizedMetaDescription,
    normalizedHeadings: normalized.normalizedHeadings,
    normalizedVisibleTextSnippet: normalized.normalizedVisibleTextSnippet,
    rawPageType: page.pageType || null,
    rawPageTypeConfidence:
      typeof page.pageTypeConfidence === "number" ? page.pageTypeConfidence : null,
    rawPageTypeReason: cleanText(page.pageTypeReason) || null,
    classification,
    warnings,
    pageType: classification.pageType,
    pageSubtype: classification.pageSubtype,
    pageTypeConfidence: classification.confidence,
    pageTypeReason: classification.signals.join("; ") || null,
    businessValue,
    shouldKeep,
    shouldAnalyze,
    isWordpressLike: wordpressSignals.length > 0,
    isLikelyUtilityPage: isUtility,
    isLikelyJunk: isJunk,
    confidence: computeDecisionConfidence(classification, shouldKeep, shouldAnalyze, isUtility, isJunk),
    reason,
    contentSignals,
    siteRole,
    cluster,
    parentCandidate: inferParentCandidate(page, classification.pageType),
  };
}

async function readInput(sourcePath: string): Promise<Stage2Output> {
  const content = await fs.readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(content) as Stage2Output;
  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error("Invalid format in output/02-page-data.json");
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
  const pages = source.pages.map(page => enrichPage(page));

  const output: Stage25Output = {
    sourceFile: SOURCE_FILE_REL,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: source.generatedAt,
    pagesTotal: pages.length,
    pagesKept: pages.filter(page => page.shouldKeep).length,
    pagesForAnalysis: pages.filter(page => page.shouldAnalyze).length,
    pagesIgnored: pages.filter(page => !page.shouldKeep).length,
    utilityCount: pages.filter(page => page.isLikelyUtilityPage).length,
    junkCount: pages.filter(page => page.isLikelyJunk).length,
    wordpressLikeCount: pages.filter(page => page.isWordpressLike).length,
    unknownCount: pages.filter(page => page.pageType === "unknown").length,
    lowConfidenceCount: pages.filter(page => page.classification.confidence < 0.55).length,
    warningsCount: pages.reduce((sum, page) => sum + page.warnings.length, 0),
    pages,
  };

  await saveOutput(outputPath, output);

  console.log("Stage 2.5 completed.");
  console.log(`- source: ${sourcePath}`);
  console.log(`- output: ${outputPath}`);
  console.log(`- pagesTotal: ${output.pagesTotal}`);
  console.log(`- pagesKept: ${output.pagesKept}`);
  console.log(`- pagesForAnalysis: ${output.pagesForAnalysis}`);
  console.log(`- pagesIgnored: ${output.pagesIgnored}`);
  console.log(`- utilityCount: ${output.utilityCount}`);
  console.log(`- junkCount: ${output.junkCount}`);
  console.log(`- unknownCount: ${output.unknownCount}`);
  console.log(`- lowConfidenceCount: ${output.lowConfidenceCount}`);
  console.log(`- warningsCount: ${output.warningsCount}`);
}

main().catch(error => {
  console.error("Critical stage 2.5 error:", error);
  process.exit(1);
});
