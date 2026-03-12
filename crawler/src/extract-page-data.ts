import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";

type Stage1Page = {
  url: string;
  status: string;
  discoveredLinks?: string[];
};

type Stage1Output = {
  site?: string;
  pages: Stage1Page[];
};

type PageType =
  | "homepage"
  | "contact"
  | "service"
  | "product"
  | "article"
  | "legal"
  | "unknown";

type SocialLink = {
  platform: string;
  url: string;
};

type PageTypeClassification = {
  pageType: PageType;
  pageTypeConfidence: number;
  pageTypeReason: string | null;
};

type ExtractedPageData = {
  url: string;
  fetchStatus: "ok" | "error";
  error: string | null;
  finalUrl: string | null;
  statusCode: number | null;
  contentType: string | null;
  wasRedirected: boolean;
  redirectedFrom: string | null;
  redirectChain: string[];
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogImage: string | null;
  h1: string[];
  h2: string[];
  rawText: string;
  mainContentText: string;
  bodyTextLength: number;
  wordCount: number;
  mainContentWordCount: number;
  internalLinks: string[];
  externalLinks: string[];
  buttons: string[];
  formsCount: number;
  emails: string[];
  phones: string[];
  socialLinks: SocialLink[];
  structuredData: unknown[];
  pageType: PageType;
  pageTypeConfidence: number;
  pageTypeReason: string | null;
};

type Stage2Output = {
  sourceFile: string;
  generatedAt: string;
  pagesCount: number;
  processedOkCount: number;
  processedErrorCount: number;
  pages: ExtractedPageData[];
};

type RedirectInfo = {
  wasRedirected: boolean;
  redirectedFrom: string | null;
  redirectChain: string[];
};

const SOURCE_FILE_REL = "output/01-crawl.json";
const OUTPUT_FILE_REL = "output/02-page-data.json";
const REQUEST_DELAY_MS = Number(process.env.EXTRACT_DELAY_MS || 200);
const REQUEST_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS || 15000);

const MAIN_CONTENT_SELECTORS = [
  "main",
  "article",
  '[role="main"]',
  "#main",
  ".main-content",
  "#content",
  ".content",
];

const SOCIAL_DOMAINS: Array<{ platform: string; domain: string }> = [
  { platform: "facebook", domain: "facebook.com" },
  { platform: "instagram", domain: "instagram.com" },
  { platform: "linkedin", domain: "linkedin.com" },
  { platform: "youtube", domain: "youtube.com" },
  { platform: "x", domain: "x.com" },
  { platform: "tiktok", domain: "tiktok.com" },
  { platform: "pinterest", domain: "pinterest.com" },
  { platform: "threads", domain: "threads.net" },
];

const ASSET_FILE_REGEX =
  /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|pdf|zip|rar|doc|docx|xls|xlsx|ppt|pptx|mp4|mp3|wav|ogg|woff|woff2|ttf|eot|css|js|map|xml|json|txt|webmanifest)$/i;

const TECHNICAL_TEXT_PATTERNS: RegExp[] = [
  /self\.__next_f/i,
  /__next_data__/i,
  /document\.queryselectorall\(/i,
  /static\/chunks\//i,
  /webpack/i,
  /sourcemappingurl/i,
  /hydration/i,
  /metadata stream/i,
  /__webpack_require__/i,
];

const TECHNICAL_REMOVE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "object",
  "embed",
  '[id="__NEXT_DATA__"]',
  "[data-nextjs-scroll-focus-boundary]",
  "next-route-announcer",
];

const http = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  maxRedirects: 10,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; KubaCrawler/2.1; +page-data)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  validateStatus: status => status >= 200 && status < 400,
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function normalizeUrl(input: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(input, baseUrl) : new URL(input);
    url.hash = "";

    if (url.pathname.endsWith("/") && url.pathname !== "/") {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.href;
  } catch {
    return null;
  }
}

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function shouldSkipHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  return (
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("javascript:") ||
    value.startsWith("data:")
  );
}

function isInternalUrl(url: string, rootHostname: string): boolean {
  try {
    return normalizeHostname(new URL(url).hostname) === rootHostname;
  } catch {
    return false;
  }
}

function getFinalUrl(response: AxiosResponse<string>, fallbackUrl: string): string {
  const requestWithResponseUrl = response.request as
    | { res?: { responseUrl?: string } }
    | undefined;
  const responseUrl = requestWithResponseUrl?.res?.responseUrl;
  return normalizeUrl(responseUrl || fallbackUrl) || fallbackUrl;
}

function toComparableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hostname = normalizeHostname(parsed.hostname);
    return parsed.href;
  } catch {
    return null;
  }
}

function isAssetUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return ASSET_FILE_REGEX.test(pathname);
  } catch {
    return true;
  }
}

function toContentType(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function isJsonLikeTechnicalPayload(segment: string): boolean {
  if (segment.length < 80) return false;

  const lower = segment.toLowerCase();
  const jsonMarkers = [
    '"props":',
    '"pageprops":',
    '"buildid":',
    '"chunks":',
    '"rsc":',
    "self.__next_f",
  ];

  if (jsonMarkers.some(marker => lower.includes(marker))) {
    return true;
  }

  const punctuationCount = (segment.match(/[{}[\]:]/g) || []).length;
  const quoteCount = (segment.match(/"/g) || []).length;
  return punctuationCount > 30 && quoteCount > 20;
}

function isTechnicalTextSegment(segment: string): boolean {
  const cleaned = cleanText(segment);
  if (!cleaned) return true;
  if (TECHNICAL_TEXT_PATTERNS.some(pattern => pattern.test(cleaned))) return true;
  return isJsonLikeTechnicalPayload(cleaned);
}

function removeTechnicalNodes(root: cheerio.Cheerio<any>): void {
  root.find(TECHNICAL_REMOVE_SELECTOR.join(",")).remove();
}

function normalizeTextBlocks(rawText: string): string {
  const segments = rawText
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean)
    .filter(segment => !isTechnicalTextSegment(segment));

  const deduped: string[] = [];
  for (const segment of segments) {
    if (deduped[deduped.length - 1] === segment) continue;
    deduped.push(segment);
  }

  return deduped.join("\n\n");
}

function extractTextFromSelection(
  $: cheerio.CheerioAPI,
  selection: cheerio.Cheerio<any>,
): string {
  if (!selection.length) return "";

  const clone = selection.clone();
  removeTechnicalNodes(clone);
  clone.find("br").replaceWith("\n");
  clone
    .find("p,li,div,section,article,header,footer,nav,main,aside,h1,h2,h3,h4,h5,h6,tr,td,th,blockquote")
    .append("\n");

  return normalizeTextBlocks(clone.text());
}

function extractRawText($: cheerio.CheerioAPI): string {
  const root = $("body").length ? $("body") : $.root();
  return extractTextFromSelection($, root);
}

function extractMainContentText($: cheerio.CheerioAPI, fallbackText: string): string {
  const candidates: Array<{ text: string; words: number }> = [];

  for (const selector of MAIN_CONTENT_SELECTORS) {
    $(selector).each((_: number, element) => {
      const text = extractTextFromSelection($, $(element));
      const words = getWordCount(text);
      if (words >= 20) {
        candidates.push({ text, words });
      }
    });
  }

  if (!candidates.length) {
    return fallbackText;
  }

  candidates.sort((a, b) => b.words - a.words);
  return candidates[0].text;
}

function extractStructuredData($: cheerio.CheerioAPI): unknown[] {
  const results: unknown[] = [];

  $('script[type="application/ld+json"]').each((_: number, element) => {
    const raw = ($(element).html() || "").trim();
    if (!raw) return;

    try {
      results.push(JSON.parse(raw));
    } catch {
      results.push(raw);
    }
  });

  return results;
}

function getMetaContent($: cheerio.CheerioAPI, selector: string): string | null {
  const value = cleanText($(selector).attr("content") || "");
  return value || null;
}

function extractMetaFields($: cheerio.CheerioAPI, finalUrl: string): {
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogImage: string | null;
} {
  const title = cleanText($("title").first().text()) || null;
  const metaDescription =
    getMetaContent($, 'meta[name="description"]') ||
    getMetaContent($, 'meta[property="og:description"]');
  const metaRobots =
    getMetaContent($, 'meta[name="robots"]') ||
    getMetaContent($, 'meta[name="googlebot"]');
  const canonicalRaw = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalRaw ? normalizeUrl(canonicalRaw, finalUrl) : null;
  const lang =
    cleanText($("html").attr("lang") || "") ||
    cleanText($('meta[property="og:locale"]').attr("content") || "") ||
    null;

  return {
    title,
    metaDescription,
    metaRobots,
    canonical,
    lang,
    ogTitle: getMetaContent($, 'meta[property="og:title"]'),
    ogDescription: getMetaContent($, 'meta[property="og:description"]'),
    ogUrl: getMetaContent($, 'meta[property="og:url"]'),
    ogImage: getMetaContent($, 'meta[property="og:image"]'),
  };
}

function extractHeadingList($: cheerio.CheerioAPI, selector: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  $(selector).each((_: number, element) => {
    const text = cleanText($(element).text());
    if (!text) return;
    if (isTechnicalTextSegment(text)) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(text);
  });

  return values;
}

function collectLinks(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  rootHostname: string,
): { internalLinks: string[]; externalLinks: string[] } {
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();

  $("a[href], area[href]").each((_: number, element) => {
    const href = $(element).attr("href");
    if (!href || shouldSkipHref(href)) return;

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;
    if (isAssetUrl(normalized)) return;

    if (isInternalUrl(normalized, rootHostname)) {
      internalLinks.add(normalized);
    } else {
      externalLinks.add(normalized);
    }
  });

  return {
    internalLinks: [...internalLinks],
    externalLinks: [...externalLinks],
  };
}

function isLikelyCtaText(text: string): boolean {
  const value = text.toLowerCase();
  return (
    /(zobacz|sprawdz|umow|skontaktuj|zadzwo[nn]|napisz|kup|zamow|start|learn|contact|book|buy|try|demo)/i.test(
      value,
    ) && value.length <= 80
  );
}

function extractButtons($: cheerio.CheerioAPI): string[] {
  const values = new Set<string>();

  $("button, input[type='button'], input[type='submit']").each(
    (_: number, element) => {
      const text = cleanText(
        $(element).text() || $(element).attr("value") || $(element).attr("aria-label") || "",
      );
      if (text) values.add(text);
    },
  );

  $("a[href]").each((_: number, element) => {
    const className = ($(element).attr("class") || "").toLowerCase();
    const role = ($(element).attr("role") || "").toLowerCase();
    const label = cleanText($(element).text() || $(element).attr("aria-label") || "");

    const ctaByClass = /(btn|button|cta)/i.test(className);
    const ctaByRole = role === "button";
    const ctaByText = label ? isLikelyCtaText(label) : false;

    if ((ctaByClass || ctaByRole || ctaByText) && label) {
      values.add(label);
    }
  });

  return [...values];
}

function extractEmails($: cheerio.CheerioAPI, text: string): string[] {
  const values = new Set<string>();

  $("a[href^='mailto:']").each((_: number, element) => {
    const href = $(element).attr("href") || "";
    const email = href.replace(/^mailto:/i, "").trim().toLowerCase();
    if (email) values.add(email);
  });

  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}\b/gi) || [];
  for (const match of matches) {
    values.add(match.toLowerCase());
  }

  return [...values];
}

function normalizePhone(raw: string): string | null {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
}

function extractPhones($: cheerio.CheerioAPI, text: string): string[] {
  const values = new Set<string>();

  $("a[href^='tel:']").each((_: number, element) => {
    const href = $(element).attr("href") || "";
    const normalized = normalizePhone(href.replace(/^tel:/i, ""));
    if (normalized) values.add(normalized);
  });

  const phoneMatches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  for (const match of phoneMatches) {
    if (!/[+\s().-]/.test(match)) continue;
    const normalized = normalizePhone(match);
    if (normalized) values.add(normalized);
  }

  return [...values];
}

function extractSocialLinks($: cheerio.CheerioAPI, pageUrl: string): SocialLink[] {
  const values = new Map<string, SocialLink>();

  $("a[href]").each((_: number, element) => {
    const href = $(element).attr("href");
    if (!href || shouldSkipHref(href)) return;

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;

    const lower = normalized.toLowerCase();
    const social = SOCIAL_DOMAINS.find(item => lower.includes(item.domain));
    if (!social) return;

    values.set(normalized, {
      platform: social.platform,
      url: normalized,
    });
  });

  return [...values.values()];
}

function addTypeSignal(
  scores: Map<PageType, number>,
  reasons: Map<PageType, string[]>,
  type: PageType,
  score: number,
  reason: string,
): void {
  const currentScore = scores.get(type) || 0;
  scores.set(type, currentScore + score);

  const currentReasons = reasons.get(type) || [];
  currentReasons.push(reason);
  reasons.set(type, currentReasons);
}

function classifyPageType(
  finalUrl: string,
  title: string,
  h1: string[],
  mainContentText: string,
): PageTypeClassification {
  const parsed = new URL(finalUrl);
  const pathValue = parsed.pathname.toLowerCase();
  const headingContext = `${title} ${h1.join(" ")}`.toLowerCase();
  const mainContext = mainContentText.toLowerCase();

  const scores = new Map<PageType, number>();
  const reasons = new Map<PageType, string[]>();

  if (pathValue === "/") {
    addTypeSignal(scores, reasons, "homepage", 1, "finalUrl path is root");
  }

  if (/kontakt|contact|skontaktuj|dojazd|napisz|telefon/.test(pathValue)) {
    addTypeSignal(scores, reasons, "contact", 0.9, "url contains contact keyword");
  }
  if (/kontakt|contact|skontaktuj/.test(headingContext)) {
    addTypeSignal(scores, reasons, "contact", 0.7, "title/h1 indicates contact");
  }
  if (/kontakt|contact|zadzwo[nn]|napisz/.test(mainContext)) {
    addTypeSignal(scores, reasons, "contact", 0.45, "main content indicates contact");
  }

  if (/polityka|prywatn|privacy|cookies|regulamin|terms|rodo|legal/.test(pathValue)) {
    addTypeSignal(scores, reasons, "legal", 0.95, "url contains legal keyword");
  }
  if (/privacy policy|polityka prywatno[s]ci|cookies|regulamin/.test(headingContext)) {
    addTypeSignal(scores, reasons, "legal", 0.75, "title/h1 indicates legal page");
  }

  if (/blog|article|articles|news|aktualnosci|poradnik/.test(pathValue)) {
    addTypeSignal(scores, reasons, "article", 0.85, "url contains article keyword");
  }
  if (/blog|artykul|aktualno[s]ci/.test(headingContext)) {
    addTypeSignal(scores, reasons, "article", 0.6, "title/h1 indicates article");
  }

  if (/produkt|product|shop|sklep|cennik|pricing|offer/.test(pathValue)) {
    addTypeSignal(scores, reasons, "product", 0.8, "url contains product keyword");
  }
  if (/produkt|cennik|pricing|offer/.test(headingContext)) {
    addTypeSignal(scores, reasons, "product", 0.55, "title/h1 indicates product");
  }

  if (/uslugi|usluga|services|service|oferta|zabieg/.test(pathValue)) {
    addTypeSignal(scores, reasons, "service", 0.8, "url contains service keyword");
  }
  if (/uslugi|service|oferta|zabieg/.test(headingContext)) {
    addTypeSignal(scores, reasons, "service", 0.55, "title/h1 indicates service");
  }
  if (/uslugi|service|oferta|zabieg/.test(mainContext)) {
    addTypeSignal(scores, reasons, "service", 0.35, "main content indicates service");
  }

  if (/404|not found|nie znaleziono/.test(`${pathValue} ${headingContext}`)) {
    addTypeSignal(scores, reasons, "unknown", 0.9, "content resembles not-found page");
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return {
      pageType: "unknown",
      pageTypeConfidence: 0.2,
      pageTypeReason: null,
    };
  }

  const [bestType, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  const confidence = Number(
    Math.max(0.2, Math.min(1, bestScore - secondScore * 0.25)).toFixed(2),
  );
  const reason = (reasons.get(bestType) || []).slice(0, 3).join("; ") || null;

  return {
    pageType: bestType,
    pageTypeConfidence: confidence,
    pageTypeReason: reason,
  };
}

function getRootHostname(source: Stage1Output): string | null {
  if (source.site) {
    try {
      return normalizeHostname(new URL(source.site).hostname);
    } catch {
      return null;
    }
  }

  for (const page of source.pages) {
    const normalized = normalizeUrl(page.url);
    if (!normalized) continue;
    try {
      return normalizeHostname(new URL(normalized).hostname);
    } catch {
      continue;
    }
  }

  return null;
}

function getUniqueOkUrls(source: Stage1Output): string[] {
  const urls = new Map<string, string>();

  for (const page of source.pages) {
    if (page.status !== "ok") continue;
    const normalized = normalizeUrl(page.url);
    if (!normalized) continue;

    const comparable = toComparableUrl(normalized);
    if (!comparable) continue;

    if (!urls.has(comparable)) {
      urls.set(comparable, normalized);
    }
  }

  return [...urls.values()];
}

function pushUnique(chain: string[], value: string | null): void {
  if (!value) return;
  if (!chain.includes(value)) chain.push(value);
}

function extractRedirectInfo(
  response: AxiosResponse<string>,
  requestedUrl: string,
  finalUrl: string,
): RedirectInfo {
  const normalizedRequested = normalizeUrl(requestedUrl) || requestedUrl;
  const normalizedFinal = normalizeUrl(finalUrl) || finalUrl;
  const chain: string[] = [];

  pushUnique(chain, normalizedRequested);

  const requestWithRedirects = response.request as
    | { _redirectable?: { _redirects?: unknown[] } }
    | undefined;

  const redirectsRaw = requestWithRedirects?._redirectable?._redirects;
  if (Array.isArray(redirectsRaw)) {
    for (const redirect of redirectsRaw) {
      if (typeof redirect !== "string") continue;
      pushUnique(chain, normalizeUrl(redirect, normalizedRequested));
    }
  }

  pushUnique(chain, normalizedFinal);

  const wasRedirected = normalizedRequested !== normalizedFinal || chain.length > 2;
  return {
    wasRedirected,
    redirectedFrom: wasRedirected ? normalizedRequested : null,
    redirectChain: wasRedirected ? chain : [],
  };
}

function createErrorResult(
  url: string,
  message: string,
  extra?: Partial<
    Pick<
      ExtractedPageData,
      | "finalUrl"
      | "statusCode"
      | "contentType"
      | "wasRedirected"
      | "redirectedFrom"
      | "redirectChain"
    >
  >,
): ExtractedPageData {
  return {
    url,
    fetchStatus: "error",
    error: message,
    finalUrl: extra?.finalUrl ?? normalizeUrl(url),
    statusCode: extra?.statusCode ?? null,
    contentType: extra?.contentType ?? null,
    wasRedirected: extra?.wasRedirected ?? false,
    redirectedFrom: extra?.redirectedFrom ?? null,
    redirectChain: extra?.redirectChain ?? [],
    title: null,
    metaDescription: null,
    metaRobots: null,
    canonical: null,
    lang: null,
    ogTitle: null,
    ogDescription: null,
    ogUrl: null,
    ogImage: null,
    h1: [],
    h2: [],
    rawText: "",
    mainContentText: "",
    bodyTextLength: 0,
    wordCount: 0,
    mainContentWordCount: 0,
    internalLinks: [],
    externalLinks: [],
    buttons: [],
    formsCount: 0,
    emails: [],
    phones: [],
    socialLinks: [],
    structuredData: [],
    pageType: "unknown",
    pageTypeConfidence: 0,
    pageTypeReason: null,
  };
}

async function processPage(url: string, rootHostname: string): Promise<ExtractedPageData> {
  try {
    const response = await http.get<string>(url);
    const html = typeof response.data === "string" ? response.data : "";
    const finalUrl = getFinalUrl(response, url);
    const redirectInfo = extractRedirectInfo(response, url, finalUrl);
    const statusCode = response.status ?? null;
    const contentType = toContentType(response.headers["content-type"]);

    const $ = cheerio.load(html);
    const meta = extractMetaFields($, finalUrl);
    const h1 = extractHeadingList($, "h1");
    const h2 = extractHeadingList($, "h2");
    const rawText = extractRawText($);
    const mainContentText = extractMainContentText($, rawText);
    const bodyTextLength = rawText.length;
    const wordCount = getWordCount(rawText);
    const mainContentWordCount = getWordCount(mainContentText);
    const structuredData = extractStructuredData($);

    const { internalLinks, externalLinks } = collectLinks($, finalUrl, rootHostname);
    const buttons = extractButtons($);
    const formsCount = $("form").length;
    const emails = extractEmails($, `${rawText}\n${mainContentText}`);
    const phones = extractPhones($, `${rawText}\n${mainContentText}`);
    const socialLinks = extractSocialLinks($, finalUrl);

    const classification = classifyPageType(
      finalUrl,
      meta.title || "",
      h1,
      mainContentText,
    );

    return {
      url,
      fetchStatus: "ok",
      error: null,
      finalUrl,
      statusCode,
      contentType,
      wasRedirected: redirectInfo.wasRedirected,
      redirectedFrom: redirectInfo.redirectedFrom,
      redirectChain: redirectInfo.redirectChain,
      title: meta.title,
      metaDescription: meta.metaDescription,
      metaRobots: meta.metaRobots,
      canonical: meta.canonical,
      lang: meta.lang,
      ogTitle: meta.ogTitle,
      ogDescription: meta.ogDescription,
      ogUrl: meta.ogUrl,
      ogImage: meta.ogImage,
      h1,
      h2,
      rawText,
      mainContentText,
      bodyTextLength,
      wordCount,
      mainContentWordCount,
      internalLinks,
      externalLinks,
      buttons,
      formsCount,
      emails,
      phones,
      socialLinks,
      structuredData,
      pageType: classification.pageType,
      pageTypeConfidence: classification.pageTypeConfidence,
      pageTypeReason: classification.pageTypeReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status ?? null;
      const contentType = error.response
        ? toContentType(error.response.headers["content-type"])
        : null;

      let finalUrl = normalizeUrl(url);
      let redirectInfo: RedirectInfo = {
        wasRedirected: false,
        redirectedFrom: null,
        redirectChain: [],
      };

      if (error.response) {
        finalUrl = getFinalUrl(error.response as AxiosResponse<string>, url);
        redirectInfo = extractRedirectInfo(
          error.response as AxiosResponse<string>,
          url,
          finalUrl,
        );
      }

      return createErrorResult(url, message, {
        finalUrl,
        statusCode,
        contentType,
        wasRedirected: redirectInfo.wasRedirected,
        redirectedFrom: redirectInfo.redirectedFrom,
        redirectChain: redirectInfo.redirectChain,
      });
    }

    return createErrorResult(url, message);
  }
}

async function readStage1Output(sourcePath: string): Promise<Stage1Output> {
  const content = await fs.readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(content) as Stage1Output;

  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error("Nieprawidlowy format pliku output/01-crawl.json");
  }

  return parsed;
}

async function saveStage2Output(outputPath: string, output: Stage2Output): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
}

async function main(): Promise<void> {
  const sourcePath = path.resolve(SOURCE_FILE_REL);
  const outputPath = path.resolve(OUTPUT_FILE_REL);

  const source = await readStage1Output(sourcePath);
  const rootHostname = getRootHostname(source);
  if (!rootHostname) {
    throw new Error("Nie mozna ustalic domeny bazowej z output/01-crawl.json");
  }

  const urls = getUniqueOkUrls(source);
  const pages: ExtractedPageData[] = [];

  console.log(`Start etapu 2, stron do przetworzenia: ${urls.length}`);

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const remaining = urls.length - index - 1;

    console.log(`[${index + 1}/${urls.length}] ${url} | pozostalo: ${remaining}`);

    const result = await processPage(url, rootHostname);
    pages.push(result);

    if (index < urls.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const processedOkCount = pages.filter(page => page.fetchStatus === "ok").length;
  const processedErrorCount = pages.length - processedOkCount;

  const output: Stage2Output = {
    sourceFile: SOURCE_FILE_REL,
    generatedAt: new Date().toISOString(),
    pagesCount: urls.length,
    processedOkCount,
    processedErrorCount,
    pages,
  };

  await saveStage2Output(outputPath, output);

  console.log("\nPodsumowanie etapu 2:");
  console.log(`- output: ${outputPath}`);
  console.log(`- pagesCount: ${output.pagesCount}`);
  console.log(`- processedOkCount: ${output.processedOkCount}`);
  console.log(`- processedErrorCount: ${output.processedErrorCount}`);
}

main().catch(error => {
  console.error("Blad krytyczny w etapie 2:", error);
  process.exit(1);
});
