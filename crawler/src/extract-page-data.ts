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
  | "app"
  | "help"
  | "unknown";

type SocialLink = {
  platform: string;
  url: string;
};

type ContentSource = "main" | "article" | "role-main" | "body-fallback" | "empty";

type ImageAsset = {
  src: string;
  absoluteUrl: string;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  sourceType: "img-src" | "img-srcset" | "data-src" | "background-image";
  kind: "logo" | "hero" | "content" | "icon" | "unknown";
};

type ContentSection = {
  heading: string | null;
  text: string;
  tag: string;
  index: number;
};

type ContentFlags = {
  hasMainContent: boolean;
  hasH1: boolean;
  hasImages: boolean;
  hasStructuredData: boolean;
  hasCanonical: boolean;
  isThinContent: boolean;
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
  contentSource: ContentSource;
  bodyTextLength: number;
  wordCount: number;
  mainContentWordCount: number;
  internalLinks: string[];
  normalizedInternalLinks: string[];
  externalLinks: string[];
  images: ImageAsset[];
  imageCount: number;
  sections: ContentSection[];
  buttons: string[];
  formsCount: number;
  emails: string[];
  phones: string[];
  socialLinks: SocialLink[];
  structuredData: unknown[];
  contentFlags: ContentFlags;
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

type MainContentExtraction = {
  text: string;
  source: ContentSource;
};

const SOURCE_FILE_REL = "output/01-crawl.json";
const OUTPUT_FILE_REL = "output/02-page-data.json";
const REQUEST_DELAY_MS = Number(process.env.EXTRACT_DELAY_MS || 200);
const REQUEST_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS || 15000);

const MAIN_CONTENT_SELECTORS: Array<{ selector: string; source: ContentSource }> = [
  { selector: "main", source: "main" },
  { selector: "article", source: "article" },
  { selector: '[role="main"]', source: "role-main" },
];

const MAIN_CONTENT_FALLBACK_SELECTORS = ["#main", ".main-content", "#content", ".content"];

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
  /react\.fragment/i,
  /parallelrouterkey/i,
  /dangerouslysetinnerhtml/i,
  /className\\":/i,
  /aria-label\\":/i,
];

const CTA_NOISE_PATTERNS: RegExp[] = [
  /^toggle navigation$/i,
  /^menu$/i,
  /^close$/i,
  /^open$/i,
  /^krok\s+\d+$/i,
  /^zwrot$/i,
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

function normalizeInternalLink(url: string): string | null {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    parsed.hostname = normalizeHostname(parsed.hostname);
    return parsed.href;
  } catch {
    return null;
  }
}

function parseDimension(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function decodeBasicEscapes(value: string): string {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
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

function extractFrameworkPayloadText($: cheerio.CheerioAPI): string {
  const values = new Set<string>();

  $("script").each((_: number, element) => {
    const type = ($(element).attr("type") || "").toLowerCase();
    if (type === "application/ld+json") return;

    const rawScript = $(element).html() || "";
    if (!rawScript) return;
    if (!/__next_f|__next_data__|children|parallelrouterkey|dangerouslysetinnerhtml/i.test(rawScript)) {
      return;
    }

    const decoded = decodeBasicEscapes(rawScript);
    const quoted = decoded.match(/"([^"\\]{2,220})"/g) || [];

    for (const entry of quoted) {
      const candidate = cleanText(entry.slice(1, -1));
      if (!candidate) continue;
      if (candidate.length < 3 || candidate.length > 220) continue;
      if (isTechnicalTextSegment(candidate)) continue;
      if (
        /(https?:\/\/|\/_next\/|static\/chunks\/|className|parallelRouterKey|dangerouslySetInnerHTML|next-error-h1|applicationCategory|priceCurrency|prefers-color-scheme)/i.test(
          candidate,
        )
      ) {
        continue;
      }

      const words = getWordCount(candidate);
      if (words < 2 && !/[.!?]/.test(candidate)) continue;
      if (/^[a-z0-9_-]+$/i.test(candidate) && candidate.length < 18) continue;

      values.add(candidate);
    }
  });

  return [...values].join("\n\n");
}

function extractRawText($: cheerio.CheerioAPI): string {
  const root = $("body").length ? $("body") : $.root();
  const extracted = extractTextFromSelection($, root);
  if (getWordCount(extracted) >= 20) {
    return extracted;
  }

  const payloadText = extractFrameworkPayloadText($);
  if (getWordCount(payloadText) > getWordCount(extracted)) {
    return payloadText;
  }

  if (extracted && payloadText) {
    return normalizeTextBlocks(`${extracted}\n${payloadText}`);
  }

  return extracted || payloadText;
}

function extractMainContent(
  $: cheerio.CheerioAPI,
  fallbackText: string,
): MainContentExtraction {
  const candidates: Array<{ text: string; words: number; source: ContentSource }> = [];

  for (const { selector, source } of MAIN_CONTENT_SELECTORS) {
    $(selector).each((_: number, element) => {
      const text = extractTextFromSelection($, $(element));
      const words = getWordCount(text);
      if (words >= 20) {
        candidates.push({ text, words, source });
      }
    });
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.words - a.words);
    const winner = candidates[0];
    return { text: winner.text, source: winner.source };
  }

  for (const selector of MAIN_CONTENT_FALLBACK_SELECTORS) {
    let winnerText = "";
    let winnerWords = 0;

    $(selector).each((_: number, element) => {
      const text = extractTextFromSelection($, $(element));
      const words = getWordCount(text);
      if (words > winnerWords) {
        winnerText = text;
        winnerWords = words;
      }
    });

    if (winnerWords >= 20) {
      return { text: winnerText, source: "body-fallback" };
    }
  }

  if (getWordCount(fallbackText) >= 20) {
    return { text: fallbackText, source: "body-fallback" };
  }

  return { text: "", source: "empty" };
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

function deriveFallbackHeadings(
  title: string | null,
  mainContentText: string,
  sections: ContentSection[],
): { h1: string[]; h2: string[] } {
  const h1Values: string[] = [];
  const h2Values: string[] = [];

  for (const section of sections) {
    if (!section.heading) continue;
    if (h1Values.length === 0) {
      h1Values.push(section.heading);
    } else if (!h2Values.includes(section.heading)) {
      h2Values.push(section.heading);
    }
  }

  if (!h1Values.length && title) {
    const normalizedTitle = cleanText(title)
      .split("|")[0]
      .split("-")[0]
      .trim();
    if (normalizedTitle) {
      h1Values.push(normalizedTitle);
    }
  }

  if (!h1Values.length && mainContentText) {
    const firstLine = mainContentText
      .split(/\n+/)
      .map(cleanText)
      .find(line => getWordCount(line) >= 2 && getWordCount(line) <= 12);
    if (firstLine) {
      h1Values.push(firstLine);
    }
  }

  return { h1: h1Values, h2: h2Values };
}

function getScopeByContentSource(
  $: cheerio.CheerioAPI,
  source: ContentSource,
): cheerio.Cheerio<any> {
  if (source === "main") {
    const node = $("main").first();
    if (node.length) return node;
  }
  if (source === "article") {
    const node = $("article").first();
    if (node.length) return node;
  }
  if (source === "role-main") {
    const node = $('[role="main"]').first();
    if (node.length) return node;
  }

  const body = $("body").first();
  if (body.length) return body;
  return $.root();
}

function extractSections(
  $: cheerio.CheerioAPI,
  source: ContentSource,
  mainContentText: string,
): ContentSection[] {
  const sections: ContentSection[] = [];
  const seen = new Set<string>();
  const scope = getScopeByContentSource($, source);

  scope.find("section, article").each((_: number, element) => {
    const sectionNode = $(element);
    const heading = cleanText(sectionNode.find("h1, h2, h3").first().text()) || null;
    const text = extractTextFromSelection($, sectionNode);
    if (getWordCount(text) < 10) return;

    const key = `${heading || ""}::${text.slice(0, 280).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    sections.push({
      heading,
      text,
      tag: element.tagName || "section",
      index: sections.length,
    });
  });

  if (sections.length < 2) {
    scope.find("h1, h2, h3").each((_: number, element) => {
      const heading = cleanText($(element).text());
      if (!heading) return;
      if (isTechnicalTextSegment(heading)) return;

      const parts: string[] = [];
      let sibling = $(element).next();
      let guard = 0;

      while (sibling.length && guard < 8) {
        const tag = sibling.get(0)?.tagName || "";
        if (/^h[1-3]$/i.test(tag)) break;
        const piece = cleanText(sibling.text());
        if (piece && !isTechnicalTextSegment(piece)) {
          parts.push(piece);
        }
        sibling = sibling.next();
        guard += 1;
      }

      const text = normalizeTextBlocks(parts.join("\n"));
      if (getWordCount(text) < 8) return;

      const key = `${heading}::${text.slice(0, 220).toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);

      sections.push({
        heading,
        text,
        tag: element.tagName || "h2",
        index: sections.length,
      });
    });
  }

  if (!sections.length && mainContentText) {
    const parts = mainContentText
      .split(/\n{2,}/)
      .map(cleanText)
      .filter(part => getWordCount(part) >= 6);

    for (const part of parts.slice(0, 20)) {
      sections.push({
        heading: null,
        text: part,
        tag: "p",
        index: sections.length,
      });
    }
  }

  return sections.map((section, index) => ({ ...section, index }));
}

function parseSrcsetCandidates(srcsetValue: string): string[] {
  return srcsetValue
    .split(",")
    .map(part => cleanText(part).split(" ")[0])
    .filter(Boolean);
}

function extractBackgroundImageUrls(styleValue: string): string[] {
  const values: string[] = [];
  const regex = /background-image\s*:\s*url\((['"]?)(.*?)\1\)/gi;
  let match = regex.exec(styleValue);
  while (match) {
    const candidate = cleanText(match[2] || "");
    if (candidate) values.push(candidate);
    match = regex.exec(styleValue);
  }
  return values;
}

function inferImageKind(input: {
  absoluteUrl: string;
  alt: string | null;
  title: string | null;
  className: string;
  id: string;
  width: number | null;
  height: number | null;
  sourceType: ImageAsset["sourceType"];
  index: number;
}): ImageAsset["kind"] {
  const context = cleanText(
    `${input.absoluteUrl} ${input.alt || ""} ${input.title || ""} ${input.className} ${input.id}`,
  ).toLowerCase();

  if (/logo|brand/.test(context)) return "logo";

  if (
    /icon|favicon|sprite/.test(context) ||
    ((input.width || 0) > 0 &&
      (input.height || 0) > 0 &&
      (input.width || 0) <= 64 &&
      (input.height || 0) <= 64)
  ) {
    return "icon";
  }

  if (
    /hero|banner|cover|masthead/.test(context) ||
    (input.index <= 2 &&
      (((input.width || 0) >= 900 && (input.height || 0) >= 250) ||
        ((input.width || 0) >= 1200 || (input.height || 0) >= 500)))
  ) {
    return "hero";
  }

  if (input.sourceType === "img-src" || input.sourceType === "img-srcset") {
    return "content";
  }

  return "unknown";
}

function extractImages($: cheerio.CheerioAPI, pageUrl: string): ImageAsset[] {
  const seen = new Set<string>();
  const images: ImageAsset[] = [];

  const pushImage = (payload: {
    src: string;
    absoluteUrl: string;
    alt?: string | null;
    title?: string | null;
    width?: number | null;
    height?: number | null;
    sourceType: ImageAsset["sourceType"];
    className?: string;
    id?: string;
  }) => {
    const key = `${payload.absoluteUrl}::${payload.sourceType}`;
    if (seen.has(key)) return;
    seen.add(key);

    images.push({
      src: payload.src,
      absoluteUrl: payload.absoluteUrl,
      alt: payload.alt || null,
      title: payload.title || null,
      width: payload.width ?? null,
      height: payload.height ?? null,
      sourceType: payload.sourceType,
      kind: inferImageKind({
        absoluteUrl: payload.absoluteUrl,
        alt: payload.alt || null,
        title: payload.title || null,
        className: payload.className || "",
        id: payload.id || "",
        width: payload.width ?? null,
        height: payload.height ?? null,
        sourceType: payload.sourceType,
        index: images.length,
      }),
    });
  };

  $("img").each((_: number, element) => {
    const node = $(element);
    const alt = cleanText(node.attr("alt") || "") || null;
    const title = cleanText(node.attr("title") || "") || null;
    const width = parseDimension(node.attr("width"));
    const height = parseDimension(node.attr("height"));
    const className = node.attr("class") || "";
    const id = node.attr("id") || "";

    const directSources: Array<{ attr: string; sourceType: ImageAsset["sourceType"] }> = [
      { attr: "src", sourceType: "img-src" },
      { attr: "data-src", sourceType: "data-src" },
      { attr: "data-lazy-src", sourceType: "data-src" },
      { attr: "data-original", sourceType: "data-src" },
    ];

    for (const direct of directSources) {
      const raw = cleanText(node.attr(direct.attr) || "");
      if (!raw || /^data:/i.test(raw)) continue;
      const absolute = normalizeUrl(raw, pageUrl);
      if (!absolute) continue;

      pushImage({
        src: raw,
        absoluteUrl: absolute,
        alt,
        title,
        width,
        height,
        sourceType: direct.sourceType,
        className,
        id,
      });
    }

    const srcsetAttributes = ["srcset", "data-srcset", "data-lazy-srcset"];
    for (const attr of srcsetAttributes) {
      const rawSrcset = node.attr(attr);
      if (!rawSrcset) continue;

      for (const candidate of parseSrcsetCandidates(rawSrcset)) {
        if (!candidate || /^data:/i.test(candidate)) continue;
        const absolute = normalizeUrl(candidate, pageUrl);
        if (!absolute) continue;

        pushImage({
          src: candidate,
          absoluteUrl: absolute,
          alt,
          title,
          width,
          height,
          sourceType: "img-srcset",
          className,
          id,
        });
      }
    }
  });

  $("source[srcset]").each((_: number, element) => {
    const rawSrcset = $(element).attr("srcset");
    if (!rawSrcset) return;
    for (const candidate of parseSrcsetCandidates(rawSrcset)) {
      if (!candidate || /^data:/i.test(candidate)) continue;
      const absolute = normalizeUrl(candidate, pageUrl);
      if (!absolute) continue;

      pushImage({
        src: candidate,
        absoluteUrl: absolute,
        sourceType: "img-srcset",
        className: $(element).attr("class") || "",
        id: $(element).attr("id") || "",
      });
    }
  });

  $("[style*='background-image']").each((_: number, element) => {
    const style = $(element).attr("style") || "";
    for (const candidate of extractBackgroundImageUrls(style)) {
      if (!candidate || /^data:/i.test(candidate)) continue;
      const absolute = normalizeUrl(candidate, pageUrl);
      if (!absolute) continue;

      pushImage({
        src: candidate,
        absoluteUrl: absolute,
        sourceType: "background-image",
        className: $(element).attr("class") || "",
        id: $(element).attr("id") || "",
        title: cleanText($(element).attr("title") || "") || null,
      });
    }
  });

  return images;
}

function collectLinks(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  rootHostname: string,
): {
  internalLinks: string[];
  normalizedInternalLinks: string[];
  externalLinks: string[];
} {
  const internalLinks = new Set<string>();
  const normalizedInternalLinks = new Set<string>();
  const externalLinks = new Set<string>();

  $("a[href], area[href]").each((_: number, element) => {
    const href = $(element).attr("href");
    if (!href || shouldSkipHref(href)) return;

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;
    if (isAssetUrl(normalized)) return;

    if (isInternalUrl(normalized, rootHostname)) {
      internalLinks.add(normalized);
      const normalizedInternal = normalizeInternalLink(normalized);
      if (normalizedInternal) {
        normalizedInternalLinks.add(normalizedInternal);
      }
    } else {
      externalLinks.add(normalized);
    }
  });

  return {
    internalLinks: [...internalLinks],
    normalizedInternalLinks: [...normalizedInternalLinks],
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

function normalizeButtonLabel(raw: string): string {
  let value = cleanText(raw);
  value = value.replace(/\s{2,}/g, " ");
  value = value.replace(/[|<>]+/g, " ");
  value = cleanText(value);
  return value;
}

function isButtonNoise(label: string): boolean {
  if (!label) return true;
  if (label.length > 90) return true;
  if (isTechnicalTextSegment(label)) return true;
  if (CTA_NOISE_PATTERNS.some(pattern => pattern.test(label))) return true;
  if (/^[\W_]+$/.test(label)) return true;
  return false;
}

function extractButtons($: cheerio.CheerioAPI): string[] {
  const values = new Map<string, string>();

  $("button, input[type='button'], input[type='submit']").each(
    (_: number, element) => {
      const text = normalizeButtonLabel(
        $(element).text() || $(element).attr("value") || $(element).attr("aria-label") || "",
      );
      if (isButtonNoise(text)) return;
      values.set(text.toLowerCase(), text);
    },
  );

  $("a[href]").each((_: number, element) => {
    const className = ($(element).attr("class") || "").toLowerCase();
    const role = ($(element).attr("role") || "").toLowerCase();
    const label = normalizeButtonLabel($(element).text() || $(element).attr("aria-label") || "");

    const ctaByClass = /(btn|button|cta)/i.test(className);
    const ctaByRole = role === "button";
    const ctaByText = label ? isLikelyCtaText(label) : false;

    if ((ctaByClass || ctaByRole || ctaByText) && label && !isButtonNoise(label)) {
      values.set(label.toLowerCase(), label);
    }
  });

  return [...values.values()];
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
  const headingContext = cleanText(`${title} ${h1.join(" ")}`).toLowerCase();
  const mainContext = mainContentText.toLowerCase();
  const context = `${headingContext} ${mainContext}`;

  const scores = new Map<PageType, number>();
  const reasons = new Map<PageType, string[]>();

  if (pathValue === "/" || /^\/?(home|start)?$/.test(pathValue)) {
    addTypeSignal(scores, reasons, "homepage", 1.1, "finalUrl path indicates homepage");
  }

  if (/komunikator|app|panel|dashboard|generator|narzedzie|tool/.test(pathValue)) {
    addTypeSignal(scores, reasons, "app", 1.05, "url contains app keyword");
  }
  if (/komunikator|uruchom aplikacje|szybki powiedzto|wpisz tekst/.test(context)) {
    addTypeSignal(scores, reasons, "app", 0.7, "title/h1/content indicates app view");
  }

  if (/instrukcja|faq|pomoc|help|jak korzystac|guide|manual/.test(pathValue)) {
    addTypeSignal(scores, reasons, "help", 1, "url contains help keyword");
  }
  if (/instrukcja|faq|najczestsze pytania|jak korzystac|poradnik/.test(context)) {
    addTypeSignal(scores, reasons, "help", 0.75, "title/h1/content indicates help");
  }

  if (/kontakt|contact|skontaktuj|dojazd|napisz|telefon/.test(pathValue)) {
    addTypeSignal(scores, reasons, "contact", 0.95, "url contains contact keyword");
  }
  if (/kontakt|contact|skontaktuj|zadzwo[nn]|napisz/.test(context)) {
    addTypeSignal(scores, reasons, "contact", 0.65, "title/h1/content indicates contact");
  }

  if (/polityka|prywatn|privacy|cookies|regulamin|terms|rodo|legal/.test(pathValue)) {
    addTypeSignal(scores, reasons, "legal", 1.05, "url contains legal keyword");
  }
  if (/privacy policy|polityka prywatno[s]ci|cookies|regulamin/.test(context)) {
    addTypeSignal(scores, reasons, "legal", 0.75, "title/h1/content indicates legal page");
  }

  if (/blog|article|articles|news|aktualnosci|poradnik/.test(pathValue)) {
    addTypeSignal(scores, reasons, "article", 0.85, "url contains article keyword");
  }
  if (/blog|artykul|aktualno[s]ci|wpis|czytaj wiecej/.test(context)) {
    addTypeSignal(scores, reasons, "article", 0.6, "title/h1/content indicates article");
  }

  if (/produkt|product|shop|sklep|cennik|pricing|offer/.test(pathValue)) {
    addTypeSignal(scores, reasons, "product", 0.8, "url contains product keyword");
  }
  if (/produkt|cennik|pricing|offer|kup|zamow/.test(context)) {
    addTypeSignal(scores, reasons, "product", 0.55, "title/h1/content indicates product");
  }

  if (/uslugi|usluga|services|service|oferta|zabieg/.test(pathValue)) {
    addTypeSignal(scores, reasons, "service", 0.8, "url contains service keyword");
  }
  if (/uslugi|service|oferta|zabieg|pakiet/.test(context)) {
    addTypeSignal(scores, reasons, "service", 0.5, "title/h1/content indicates service");
  }

  if (/404|not found|nie znaleziono/.test(`${pathValue} ${context}`)) {
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
  const confidence = Number(Math.max(0.2, Math.min(1, bestScore - secondScore * 0.2)).toFixed(2));
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
    contentSource: "empty",
    bodyTextLength: 0,
    wordCount: 0,
    mainContentWordCount: 0,
    internalLinks: [],
    normalizedInternalLinks: [],
    externalLinks: [],
    images: [],
    imageCount: 0,
    sections: [],
    buttons: [],
    formsCount: 0,
    emails: [],
    phones: [],
    socialLinks: [],
    structuredData: [],
    contentFlags: {
      hasMainContent: false,
      hasH1: false,
      hasImages: false,
      hasStructuredData: false,
      hasCanonical: false,
      isThinContent: true,
    },
    pageType: "unknown",
    pageTypeConfidence: 0,
    pageTypeReason: null,
  };
}

function getStructuredDescription(structuredData: unknown[]): string {
  for (const item of structuredData) {
    if (!item || typeof item !== "object") continue;
    const maybeDescription = (item as { description?: unknown }).description;
    if (typeof maybeDescription === "string") {
      const value = cleanText(maybeDescription);
      if (value) return value;
    }
  }
  return "";
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
    const structuredData = extractStructuredData($);

    let rawText = extractRawText($);
    const mainExtraction = extractMainContent($, rawText);
    let mainContentText = mainExtraction.text;
    let contentSource: ContentSource = mainExtraction.source;

    if (!rawText && mainContentText) {
      rawText = mainContentText;
    }

    if (!rawText) {
      rawText =
        meta.metaDescription ||
        getStructuredDescription(structuredData) ||
        cleanText(meta.title || "");
    }

    if (!mainContentText && rawText) {
      mainContentText = rawText;
      contentSource = "body-fallback";
    }

    if (!mainContentText && !rawText) {
      contentSource = "empty";
    }

    const sections = extractSections($, contentSource, mainContentText);
    let h1 = extractHeadingList($, "h1");
    let h2 = extractHeadingList($, "h2");

    if (!h1.length || !h2.length) {
      const fallbackHeadings = deriveFallbackHeadings(meta.title, mainContentText, sections);
      if (!h1.length && fallbackHeadings.h1.length) {
        h1 = fallbackHeadings.h1;
      }
      if (!h2.length && fallbackHeadings.h2.length) {
        h2 = fallbackHeadings.h2;
      }
    }

    const bodyTextLength = rawText.length;
    const wordCount = getWordCount(rawText);
    const mainContentWordCount = getWordCount(mainContentText);

    const { internalLinks, normalizedInternalLinks, externalLinks } = collectLinks(
      $,
      finalUrl,
      rootHostname,
    );
    const images = extractImages($, finalUrl);
    const imageCount = images.length;
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

    const contentFlags: ContentFlags = {
      hasMainContent: mainContentWordCount > 0,
      hasH1: h1.length > 0,
      hasImages: imageCount > 0,
      hasStructuredData: structuredData.length > 0,
      hasCanonical: Boolean(meta.canonical),
      isThinContent: mainContentWordCount > 0 ? mainContentWordCount < 60 : wordCount < 60,
    };

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
      contentSource,
      bodyTextLength,
      wordCount,
      mainContentWordCount,
      internalLinks,
      normalizedInternalLinks,
      externalLinks,
      images,
      imageCount,
      sections,
      buttons,
      formsCount,
      emails,
      phones,
      socialLinks,
      structuredData,
      contentFlags,
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
