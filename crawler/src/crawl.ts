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
};

type CrawlPageResult = {
  url: string;
  status: "ok" | "error";
  discoveredLinks: string[];
  error?: string;
};

type CrawlReport = {
  site: string;
  scannedAt: string;
  pagesCount: number;
  maxPages: number;
  usedSitemap: boolean;
  robots: {
    url: string;
    hasContent: boolean;
    sitemaps: string[];
  };
  sitemapSources: Array<{
    sitemapUrl: string;
    entriesCount: number;
  }>;
  pages: CrawlPageResult[];
};

const SITE_URL = process.env.SITE_URL;
const MAX_PAGES = Number(process.env.MAX_PAGES || 100);
const CRAWL_DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 150);

if (!SITE_URL) {
  throw new Error("Brak SITE_URL w pliku .env");
}

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

function isSameDomain(url: string): boolean {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

function shouldSkipUrl(url: string): boolean {
  return (
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("javascript:") ||
    url.startsWith("data:") ||
    /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|rar|doc|docx|xls|xlsx|mp4|mp3)$/i.test(
      url,
    )
  );
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
          const normalized = normalizeUrl(nestedUrl);
          if (normalized) discoveredUrls.add(normalized);
        }
      } else {
        if (!isSameDomain(entry)) continue;
        const normalized = normalizeUrl(entry);
        if (normalized) discoveredUrls.add(normalized);
      }
    }
  }

  return {
    robots,
    sitemapSources,
    urls: [...discoveredUrls],
  };
}

function extractInternalLinks(html: string, currentUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_: any, element: any) => {
    const href = $(element).attr("href");
    if (!href) return;
    if (shouldSkipUrl(href)) return;

    const absolute = toAbsoluteUrl(href, currentUrl);
    if (!absolute) return;
    if (!isSameDomain(absolute)) return;

    const normalized = normalizeUrl(absolute);
    if (!normalized) return;

    links.add(normalized);
  });

  return [...links];
}

async function crawlFromHomepage(
  initialQueue: string[],
): Promise<CrawlPageResult[]> {
  const queue = [...initialQueue];
  const visited = new Set<string>();
  const results: CrawlPageResult[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const currentUrl = queue.shift();
    if (!currentUrl) continue;
    if (visited.has(currentUrl)) continue;
    if (!isSameDomain(currentUrl)) continue;

    visited.add(currentUrl);

    try {
      const html = await fetchText(currentUrl);
      const discoveredLinks = extractInternalLinks(html, currentUrl);

      results.push({
        url: currentUrl,
        status: "ok",
        discoveredLinks,
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

  const seedUrls = sitemapDiscovery.urls.length
    ? sitemapDiscovery.urls
    : SITE_URL ? [normalizeUrl(SITE_URL)].filter((url): url is string => Boolean(url)) : [];

  const pages = await crawlFromHomepage(seedUrls);

  return {
    site: SITE_URL || ORIGIN,
    scannedAt: new Date().toISOString(),
    pagesCount: pages.length,
    maxPages: MAX_PAGES,
    usedSitemap: sitemapDiscovery.urls.length > 0,
    robots: {
      url: sitemapDiscovery.robots.url,
      hasContent: Boolean(sitemapDiscovery.robots.content),
      sitemaps: sitemapDiscovery.robots.sitemaps,
    },
    sitemapSources: sitemapDiscovery.sitemapSources,
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
}

main().catch(error => {
  console.error("Błąd krytyczny:", error);
  process.exit(1);
});
