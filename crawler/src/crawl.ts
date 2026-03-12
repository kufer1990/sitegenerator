import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { parseStringPromise } from "xml2js";

dotenv.config();

type RobotsResult = {
  url: string;
  content: string;
  sitemaps: string[];
};

type SitemapDiscoveryResult = {
  robots: RobotsResult;
  sitemapSources: Array<{
    sitemapUrl: string;
    entriesCount: number;
  }>;
  urls: string[];
  rejectedUrls: Array<{
    url: string;
    reason: string;
  }>;
};
type CrawlPageResult = {
  url: string;
  status: "ok" | "error";
  discoveredLinks: string[];
  idLikeLinks: string[];
  error?: string;
};

type CrawlReport = {
  site: string;
  scannedAt: string;
  pagesCount: number;
  maxPages: number;
  usedSitemap: boolean;
  sitemapUrlsCount: number;
  robots: {
    url: string;
    hasContent: boolean;
    sitemaps: string[];
  };
  sitemapSources: Array<{
    sitemapUrl: string;
    entriesCount: number;
  }>;
  rejectedSitemapUrls: Array<{
    url: string;
    reason: string;
  }>;
  pages: CrawlPageResult[];
};

type HtmlExtractionResult = {
  links: string[];
  scriptUrls: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Brak ${name} w pliku .env`);
  }
  return value;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

const SITE_URL = requireEnv("SITE_URL");
const MAX_PAGES = Number(process.env.MAX_PAGES || 100);
const CRAWL_DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 150);
const SCRIPT_SCAN_MAX_PER_PAGE = Number(
  process.env.SCRIPT_SCAN_MAX_PER_PAGE || 15,
);
const INCLUDE_WORDPRESS_API = parseBooleanEnv("INCLUDE_WORDPRESS_API", false);
const ALWAYS_EXCLUDED_URL_PATTERNS: RegExp[] = [
  /^\/wp-admin(?:\/|$)/i,
  /^\/wp-login\.php(?:$|\?)/i,
  /^\/xmlrpc\.php(?:$|\?)/i,
  /^\/wp-cron\.php(?:$|\?)/i,
  /^\/wp-comments-post\.php(?:$|\?)/i,
  /^\/wp-trackback\.php(?:$|\?)/i,
  /^\/wlwmanifest\.xml(?:$|\?)/i,
  /\/comments\/feed(?:\/|$)/i,
  /\/feed(?:\/|$)/i,
  /^\/author\/[^/]+(?:\/|$)/i,
  /^\/category\/[^/]+\/feed(?:\/|$)/i,
  /^\/tag\/[^/]+\/feed(?:\/|$)/i,
  /^\/wp-content\/plugins\/(?:elementor|elementor-pro)(?:\/|$)/i,
  /^\/me(?:\/|$)/i,
];
const WORDPRESS_API_EXCLUDED_URL_PATTERNS: RegExp[] = [
  /^\/wp-json(?:\/|$)/i,
  /^\/wp-json\/oembed\/1\.0\/embed(?:$|\?)/i,
];

const startUrl = new URL(SITE_URL);
const ORIGIN = startUrl.origin;

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; KubaCrawler/1.0; +site-audit)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  validateStatus: status => status >= 200 && status < 400,
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input);
    url.hash = "";

    if (url.pathname.endsWith("/") && url.pathname !== "/") {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.href;
  } catch {
    return null;
  }
}

function toAbsoluteUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

const START_HOSTNAME = startUrl.hostname.replace(/^www\./, "");

function isSameDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname === START_HOSTNAME;
  } catch {
    return false;
  }
}

function isExcludedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const pathWithQuery = `${pathname}${parsed.search}`.toLowerCase();
    const activePatterns = INCLUDE_WORDPRESS_API
      ? ALWAYS_EXCLUDED_URL_PATTERNS
      : [...ALWAYS_EXCLUDED_URL_PATTERNS, ...WORDPRESS_API_EXCLUDED_URL_PATTERNS];

    if (activePatterns.some(pattern => pattern.test(pathname))) {
      return true;
    }

    if (activePatterns.some(pattern => pattern.test(pathWithQuery))) {
      return true;
    }

    if (!INCLUDE_WORDPRESS_API && parsed.searchParams.has("rest_route")) {
      return true;
    }

    if (pathname === "/" && parsed.searchParams.has("s")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function shouldSkipUrl(url: string): boolean {
  const trimmedUrl = url.trim();

  if (
    trimmedUrl.startsWith("mailto:") ||
    trimmedUrl.startsWith("tel:") ||
    trimmedUrl.startsWith("javascript:") ||
    trimmedUrl.startsWith("data:")
  ) {
    return true;
  }

  const absolute = toAbsoluteUrl(trimmedUrl, ORIGIN);
  if (!absolute) return true;

  try {
    const parsed = new URL(absolute);
    const pathname = parsed.pathname.toLowerCase();

    if (isExcludedUrl(parsed.href)) {
      return true;
    }

    if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) {
      return true;
    }

    if (
      /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|rar|doc|docx|xls|xlsx|mp4|mp3|woff|woff2|ttf|eot|css|js|map|xml|json|txt|webmanifest|ico)$/i.test(
        pathname,
      )
    ) {
      return true;
    }

    return !isLikelyPagePath(pathname);
  } catch {
    return true;
  }
}

function isLikelyPagePath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true;
  if (pathname.includes(" ")) return false;
  if (pathname.includes("\\")) return false;
  if (pathname.includes("$") || pathname.includes("{") || pathname.includes("}")) {
    return false;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return true;

  if (segments.every(segment => segment.length === 1)) {
    return false;
  }

  return segments.every(segment => /^[a-z0-9\-._~%]+$/i.test(segment));
}

function cleanExtractedUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\\),.;]+$/g, "");
}

function addInternalLinkCandidate(
  rawUrl: string,
  baseUrl: string,
  links: Set<string>,
): void {
  const cleanedUrl = cleanExtractedUrl(rawUrl);
  if (!cleanedUrl) return;

  const absolute = toAbsoluteUrl(cleanedUrl, baseUrl);
  if (!absolute) return;
  if (!isSameDomain(absolute)) return;
  if (shouldSkipUrl(absolute)) return;

  const normalized = normalizeUrl(absolute);
  if (!normalized) return;

  links.add(normalized);
}

function extractUrlCandidatesFromText(text: string): string[] {
  const normalizedText = text.replace(/\\\//g, "/");
  const candidates = new Set<string>();

  const absoluteUrlMatches =
    normalizedText.match(/https?:\/\/[^\s"'`<>\\)]+/gi) || [];
  for (const match of absoluteUrlMatches) {
    candidates.add(match);
  }

  const relativePathMatches =
    normalizedText.match(
      /["'`](\/(?!_next\/|api\/|static\/|assets\/|images\/|img\/|fonts\/|icons\/)[a-z0-9\-._~/%?&=+#:]{1,240})["'`]/gi,
    ) || [];

  for (const match of relativePathMatches) {
    candidates.add(match.slice(1, -1));
  }

  return [...candidates];
}

function extractInternalLinks(
  html: string,
  currentUrl: string,
): HtmlExtractionResult {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  const scriptUrls = new Set<string>();

  const selectors: Array<{ selector: string; attr: string }> = [
    { selector: "a[href]", attr: "href" },
    { selector: "area[href]", attr: "href" },
    { selector: "link[href]", attr: "href" },
    { selector: "[data-href]", attr: "data-href" },
    { selector: "[data-url]", attr: "data-url" },
    { selector: "[data-link]", attr: "data-link" },
  ];

  for (const { selector, attr } of selectors) {
    $(selector).each((_: any, element: any) => {
      const value = $(element).attr(attr);
      if (!value) return;
      addInternalLinkCandidate(value, currentUrl, links);
    });
  }

  $("[onclick]").each((_: any, element: any) => {
    const onclick = $(element).attr("onclick");
    if (!onclick) return;

    for (const candidate of extractUrlCandidatesFromText(onclick)) {
      addInternalLinkCandidate(candidate, currentUrl, links);
    }
  });

  $("script").each((_: any, element: any) => {
    const src = $(element).attr("src");
    if (src) {
      const absolute = toAbsoluteUrl(src, currentUrl);
      if (absolute && isSameDomain(absolute)) {
        try {
          const pathname = new URL(absolute).pathname.toLowerCase();
          if (pathname.endsWith(".js")) {
            scriptUrls.add(absolute);
          }
        } catch {
          return;
        }
      }
      return;
    }

    const inlineContent = $(element).html() || "";
    for (const candidate of extractUrlCandidatesFromText(inlineContent)) {
      addInternalLinkCandidate(candidate, currentUrl, links);
    }
  });

  return {
    links: [...links],
    scriptUrls: [...scriptUrls],
  };
}

async function extractLinksFromScripts(
  scriptUrls: string[],
  currentUrl: string,
  scannedScriptUrls: Set<string>,
): Promise<string[]> {
  const links = new Set<string>();

  for (const scriptUrl of scriptUrls.slice(0, SCRIPT_SCAN_MAX_PER_PAGE)) {
    if (scannedScriptUrls.has(scriptUrl)) continue;
    scannedScriptUrls.add(scriptUrl);

    try {
      const scriptText = await fetchText(scriptUrl);
      for (const candidate of extractUrlCandidatesFromText(scriptText)) {
        addInternalLinkCandidate(candidate, currentUrl, links);
      }
    } catch {
      continue;
    }
  }

  return [...links];
}

function isIdLikeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    for (const [key] of parsed.searchParams.entries()) {
      if (key.toLowerCase() === "id" || key.toLowerCase().endsWith("id")) {
        return true;
      }
    }

    if (/\/\d{2,}(?:\/|$)/.test(parsed.pathname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await http.get<string>(url);
  return typeof response.data === "string" ? response.data : "";
}

async function readRobotsTxt(): Promise<RobotsResult> {
  const robotsUrl = `${ORIGIN}/robots.txt`;

  try {
    const content = await fetchText(robotsUrl);

    const sitemaps = content
      .split("\n")
      .map(line => line.trim())
      .filter(line => /^sitemap:/i.test(line))
      .map(line => line.replace(/^sitemap:\s*/i, "").trim())
      .filter(Boolean);

    return {
      url: robotsUrl,
      content,
      sitemaps,
    };
  } catch {
    return {
      url: robotsUrl,
      content: "",
      sitemaps: [],
    };
  }
}

async function parseSitemap(url: string): Promise<string[]> {
  try {
    const xml = await fetchText(url);
    const parsed = await parseStringPromise(xml);
    const foundUrls: string[] = [];

    if (parsed.urlset?.url) {
      for (const item of parsed.urlset.url) {
        const loc = item.loc?.[0];
        if (typeof loc === "string") {
          foundUrls.push(loc);
        }
      }
    }

    if (parsed.sitemapindex?.sitemap) {
      for (const item of parsed.sitemapindex.sitemap) {
        const loc = item.loc?.[0];
        if (typeof loc === "string") {
          foundUrls.push(loc);
        }
      }
    }

    return foundUrls;
  } catch {
    return [];
  }
}

async function discoverSitemaps(): Promise<SitemapDiscoveryResult> {
  const robots = await readRobotsTxt();

  const defaultCandidates = [
    `${ORIGIN}/sitemap.xml`,
    `${ORIGIN}/sitemap_index.xml`,
    `${ORIGIN}/sitemap-index.xml`,
    `${ORIGIN}/sitemap.txt`,
  ];

  const candidateSitemaps = [
    ...new Set([...robots.sitemaps, ...defaultCandidates]),
  ];

  const sitemapSources: Array<{
    sitemapUrl: string;
    entriesCount: number;
  }> = [];

 const discoveredUrls = new Set<string>();
const rejectedUrls: Array<{ url: string; reason: string }> = [];

  for (const sitemapUrl of candidateSitemaps) {
    const entries = await parseSitemap(sitemapUrl);

    if (!entries.length) {
      continue;
    }

    sitemapSources.push({
      sitemapUrl,
      entriesCount: entries.length,
    });

    for (const entry of entries) {
      if (entry.endsWith(".xml")) {
        const nestedEntries = await parseSitemap(entry);

        for (const nestedUrl of nestedEntries) {
          if (!isSameDomain(nestedUrl)) continue;
          if (isExcludedUrl(nestedUrl)) {
            rejectedUrls.push({
              url: nestedUrl,
              reason: "excluded-pattern",
            });
            continue;
          }
          const normalized = normalizeUrl(nestedUrl);
          if (normalized) discoveredUrls.add(normalized);
        }
      } else {
      if (isExcludedUrl(entry)) {
  rejectedUrls.push({
    url: entry,
    reason: "excluded-pattern",
  });
  continue;
}

      if (!isSameDomain(entry)) {
  rejectedUrls.push({
    url: entry,
    reason: "different-domain",
  });
  continue;
}

const normalized = normalizeUrl(entry);

if (!normalized) {
  rejectedUrls.push({
    url: entry,
    reason: "invalid-url",
  });
  continue;
}

discoveredUrls.add(normalized);
      }
    }
  }

return {
  robots,
  sitemapSources,
  urls: [...discoveredUrls],
  rejectedUrls,
};
}

async function crawlFromHomepage(
  initialQueue: string[],
): Promise<CrawlPageResult[]> {
  const queue = [...initialQueue];
  const visited = new Set<string>();
  const scannedScriptUrls = new Set<string>();
  const results: CrawlPageResult[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const currentUrl = queue.shift();
    if (!currentUrl) continue;
    if (visited.has(currentUrl)) continue;
    if (!isSameDomain(currentUrl)) continue;
    if (shouldSkipUrl(currentUrl)) continue;

    visited.add(currentUrl);

    try {
      const html = await fetchText(currentUrl);
      const htmlExtraction = extractInternalLinks(html, currentUrl);
      const scriptDiscoveredLinks = await extractLinksFromScripts(
        htmlExtraction.scriptUrls,
        currentUrl,
        scannedScriptUrls,
      );
      const discoveredLinks = [
        ...new Set([...htmlExtraction.links, ...scriptDiscoveredLinks]),
      ];
      const idLikeLinks = discoveredLinks.filter(isIdLikeUrl);

      results.push({
        url: currentUrl,
        status: "ok",
        discoveredLinks,
        idLikeLinks,
      });

      for (const link of discoveredLinks) {
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }

      console.log(`[OK] ${currentUrl}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      results.push({
        url: currentUrl,
        status: "error",
        discoveredLinks: [],
        idLikeLinks: [],
        error: errorMessage,
      });

      console.log(`[ERR] ${currentUrl} -> ${errorMessage}`);
    }

    await sleep(CRAWL_DELAY_MS);
  }

  return results;
}

async function buildReport(): Promise<CrawlReport> {
  const sitemapDiscovery = await discoverSitemaps();

  const homepageSeed = normalizeUrl(SITE_URL);
  const seedUrls = [
    ...new Set(
      [
        homepageSeed,
        ...sitemapDiscovery.urls,
      ].filter((url): url is string => Boolean(url)),
    ),
  ];

  const pages = await crawlFromHomepage(seedUrls);

return {
  site: SITE_URL,
  scannedAt: new Date().toISOString(),
  pagesCount: pages.length,
  maxPages: MAX_PAGES,
  usedSitemap: sitemapDiscovery.urls.length > 0,
  sitemapUrlsCount: sitemapDiscovery.urls.length,
    robots: {
      url: sitemapDiscovery.robots.url,
      hasContent: Boolean(sitemapDiscovery.robots.content),
      sitemaps: sitemapDiscovery.robots.sitemaps,
    },
    sitemapSources: sitemapDiscovery.sitemapSources,
    rejectedSitemapUrls: sitemapDiscovery.rejectedUrls,
    pages,
  };
}

async function saveReport(report: CrawlReport): Promise<void> {
  const outputDir = path.resolve("output");
  await fs.mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, "01-crawl.json");

  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\nZapisano raport: ${filePath}`);
}

async function main(): Promise<void> {
  console.log(`Start crawl dla: ${SITE_URL}\n`);
  const report = await buildReport();
  await saveReport(report);

  console.log("\nPodsumowanie:");
  console.log(`- pagesCount: ${report.pagesCount}`);
  console.log(`- usedSitemap: ${report.usedSitemap}`);
  console.log(`- sitemapSources: ${report.sitemapSources.length}`);
  console.log(
    `- idLikeLinks: ${report.pages.reduce(
      (sum, page) => sum + page.idLikeLinks.length,
      0,
    )}`,
  );
}

main().catch(error => {
  console.error("Błąd krytyczny:", error);
  process.exit(1);
});
