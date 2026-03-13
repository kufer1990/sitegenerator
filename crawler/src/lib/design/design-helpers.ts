import * as fs from "node:fs/promises";
import * as path from "node:path";

import { load } from "cheerio";

import { cleanText, normalizePathname, round1, toRelativeOutputPath } from "../browser/normalizers.js";
import type { ElementStyleAudit, Stage5OutputPage } from "../browser/types.js";
import type {
  ComponentStyleClues,
  DesignAuditRecord,
  HtmlSectionSignal,
  HtmlSignal,
  NumericToken,
  RankedValue,
  ShadowToken,
  TypographyScaleToken,
} from "./types.js";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf-8");
}

export function parsePxValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = cleanText(value).match(/-?\d+(?:\.\d+)?(?=px\b)/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractPxValues(value: string | null | undefined): number[] {
  if (!value) return [];
  return [...cleanText(value).matchAll(/-?\d+(?:\.\d+)?(?=px\b)/gi)]
    .map(match => Number.parseFloat(match[0]))
    .filter(entry => Number.isFinite(entry));
}

export function normalizeFontFamily(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .split(",")[0]
    .replace(/["']/g, "")
    .replace(/\s+fallback$/i, "")
    .trim();
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function normalizeColor(value: string | null | undefined): string {
  const text = cleanText(value).toLowerCase();
  if (!text || text === "none" || text === "transparent") return "transparent";
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(",")
      .map(part => Number.parseFloat(part.trim()))
      .filter(part => Number.isFinite(part));
    if (parts.length >= 3) {
      const [red, green, blue, alpha] = parts;
      if (typeof alpha === "number" && alpha >= 0 && alpha < 1) {
        return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${Number(alpha.toFixed(2))})`;
      }
      return rgbToHex(red, green, blue);
    }
  }
  return text;
}

export function colorToRgb(value: string | null | undefined): { red: number; green: number; blue: number; alpha: number } | null {
  const normalized = normalizeColor(value);
  if (normalized === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return {
      red: Number.parseInt(normalized.slice(1, 3), 16),
      green: Number.parseInt(normalized.slice(3, 5), 16),
      blue: Number.parseInt(normalized.slice(5, 7), 16),
      alpha: 1,
    };
  }

  const rgbaMatch = normalized.match(/^rgba\((\d+), (\d+), (\d+), (\d+(?:\.\d+)?)\)$/);
  if (rgbaMatch) {
    return {
      red: Number.parseInt(rgbaMatch[1], 10),
      green: Number.parseInt(rgbaMatch[2], 10),
      blue: Number.parseInt(rgbaMatch[3], 10),
      alpha: Number.parseFloat(rgbaMatch[4]),
    };
  }

  return null;
}

export function colorLuminance(value: string | null | undefined): number {
  const rgb = colorToRgb(value);
  if (!rgb || rgb.alpha === 0) return 1;
  const channels = [rgb.red, rgb.green, rgb.blue].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function colorSaturation(value: string | null | undefined): number {
  const rgb = colorToRgb(value);
  if (!rgb || rgb.alpha === 0) return 0;
  const max = Math.max(rgb.red, rgb.green, rgb.blue) / 255;
  const min = Math.min(rgb.red, rgb.green, rgb.blue) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

export function isNeutralColor(value: string | null | undefined): boolean {
  const rgb = colorToRgb(value);
  if (!rgb || rgb.alpha === 0) return true;
  return Math.max(rgb.red, rgb.green, rgb.blue) - Math.min(rgb.red, rgb.green, rgb.blue) < 18;
}

export function createCounter<T extends string | number>(): Map<T, number> {
  return new Map<T, number>();
}

export function incrementCounter<T extends string | number>(counter: Map<T, number>, value: T | null | undefined, amount = 1): void {
  if (value === null || value === undefined) return;
  counter.set(value, (counter.get(value) || 0) + amount);
}

export function counterToRanked<T extends string | number>(counter: Map<T, number>): RankedValue<T>[] {
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || `${left.value}`.localeCompare(`${right.value}`));
}

export function clusterNumbers(values: Array<{ value: number; count: number }>, tolerance = 1): NumericToken[] {
  const sorted = [...values].sort((left, right) => left.value - right.value || left.count - right.count);
  const clusters: Array<{ center: number; values: Array<{ value: number; count: number }> }> = [];

  for (const entry of sorted) {
    const target = clusters.find(cluster => Math.abs(cluster.center - entry.value) <= tolerance);
    if (target) {
      target.values.push(entry);
      const totalWeight = target.values.reduce((sum, item) => sum + item.count, 0);
      const weightedCenter = target.values.reduce((sum, item) => sum + item.value * item.count, 0) / totalWeight;
      target.center = round1(weightedCenter);
      continue;
    }

    clusters.push({
      center: round1(entry.value),
      values: [entry],
    });
  }

  return clusters
    .map(cluster => {
      const sampleCount = cluster.values.reduce((sum, entry) => sum + entry.count, 0);
      return {
        token: `${cluster.center}px`,
        value: cluster.center,
        sampleCount,
      };
    })
    .sort((left, right) => left.value - right.value || right.sampleCount - left.sampleCount);
}

export function parseTypographyScale(value: string): Omit<TypographyScaleToken, "token" | "sampleCount"> | null {
  const match = cleanText(value).match(/^(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)px\/(\d+)$/);
  if (!match) return null;
  return {
    sizePx: Number.parseFloat(match[1]),
    lineHeightPx: Number.parseFloat(match[2]),
    fontWeight: Number.parseInt(match[3], 10),
  };
}

export function detectBaseSpacingUnit(scale: NumericToken[]): number | null {
  if (!scale.length) return null;
  const candidates = [2, 4, 5, 6, 8];
  const scored = candidates.map(candidate => ({
    candidate,
    score: scale.reduce((sum, token) => {
      const ratio = token.value / candidate;
      const closeness = Math.abs(ratio - Math.round(ratio));
      return sum + (closeness <= 0.16 ? token.sampleCount : 0);
    }, 0),
  }));

  scored.sort((left, right) => right.score - left.score || left.candidate - right.candidate);
  const best = scored[0];
  if (!best?.score) return null;

  const token4 = scale.find(token => token.value === 4);
  const token2 = scale.find(token => token.value === 2);
  if (token4 && (!token2 || token4.sampleCount >= token2.sampleCount * 3)) {
    return 4;
  }

  if (token4 && token4.sampleCount > 0) {
    const score4 = scored.find(entry => entry.candidate === 4);
    if (score4 && score4.score >= best.score * 0.72) return 4;
  }

  return best.candidate;
}

export function classifyShadow(css: string): ShadowToken["intensity"] {
  const text = cleanText(css);
  if (!text || text === "none" || /rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:,?\s*)+$/i.test(text)) {
    return "none";
  }
  const values = extractPxValues(text).map(value => Math.abs(value));
  const strength = values.reduce((sum, value) => sum + value, 0);
  if (strength < 8) return "subtle";
  if (strength < 20) return "medium";
  return "strong";
}

export function topStrings(values: RankedValue<string>[], limit = 3): string[] {
  return values.slice(0, limit).map(entry => entry.value);
}

export function buildStyleClues(elements: ElementStyleAudit[]): ComponentStyleClues {
  const textColors = createCounter<string>();
  const backgroundColors = createCounter<string>();
  const borderRadius = createCounter<string>();
  const shadows = createCounter<string>();
  const fontSizes = createCounter<string>();
  const fontWeights = createCounter<string>();
  const paddings = createCounter<string>();
  const positions = createCounter<string>();
  const maxWidths = createCounter<string>();

  for (const element of elements) {
    incrementCounter(textColors, normalizeColor(element.style.color));
    incrementCounter(backgroundColors, normalizeColor(element.style.backgroundColor));
    incrementCounter(borderRadius, cleanText(element.style.borderRadius));
    incrementCounter(shadows, cleanText(element.style.boxShadow));
    incrementCounter(fontSizes, cleanText(element.style.fontSize));
    incrementCounter(fontWeights, cleanText(element.style.fontWeight));
    incrementCounter(paddings, cleanText(element.style.padding));
    incrementCounter(positions, cleanText(element.style.position));
    incrementCounter(maxWidths, cleanText(element.style.maxWidth));
  }

  return {
    textColors: topStrings(counterToRanked(textColors)),
    backgroundColors: topStrings(counterToRanked(backgroundColors)),
    borderRadius: topStrings(counterToRanked(borderRadius)),
    shadows: topStrings(counterToRanked(shadows)),
    fontSizes: topStrings(counterToRanked(fontSizes)),
    fontWeights: topStrings(counterToRanked(fontWeights)),
    paddings: topStrings(counterToRanked(paddings)),
    positions: topStrings(counterToRanked(positions)),
    maxWidths: topStrings(counterToRanked(maxWidths)),
  };
}

export async function readHtmlSignal(relativePath: string | null): Promise<HtmlSignal | null> {
  if (!relativePath) return null;

  const absolutePath = path.resolve(relativePath);
  let content = "";

  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch {
    return null;
  }

  const $ = load(content);
  const sectionSamples: HtmlSectionSignal[] = $("main section, main article, body > section, body > article")
    .slice(0, 12)
    .toArray()
    .map(node => {
      const element = $(node);
      return {
        tag: node.tagName.toLowerCase(),
        className: cleanText(element.attr("class")),
        textSnippet: cleanText(element.text()).slice(0, 220),
        href: element.attr("href") || null,
      };
    })
    .filter(sample => sample.textSnippet);

  const fixedBottomNav = $("nav")
    .toArray()
    .some(node => {
      const className = cleanText($(node).attr("class"));
      return /\bfixed\b/.test(className) && /\bbottom-0\b/.test(className);
    });

  return {
    relativePath,
    sourcePath: toRelativeOutputPath(absolutePath),
    sectionCount: $("main section, body section").length,
    articleCount: $("main article, body article").length,
    formCount: $("form").length,
    inputCount: $("input").length,
    textareaCount: $("textarea").length,
    buttonCount: $("button").length,
    navCount: $("nav").length,
    footerCount: $("footer").length,
    categoryLinkCount: $('a[href*="/categories/"]').length,
    quoteLinkCount: $('a[href*="/quote/"]').length,
    fixedBottomNav,
    sectionSamples,
  };
}

export function createAuditRecords(
  pages: Stage5OutputPage[],
  htmlByPath: Map<string, HtmlSignal | null>,
): DesignAuditRecord[] {
  return pages
    .flatMap(page =>
      Object.entries(page.audits).map(([viewport, audit]) => ({
        page,
        viewport: viewport as DesignAuditRecord["viewport"],
        audit,
        html: htmlByPath.get(audit.renderedHtmlPath || "") || null,
      })),
    )
    .sort(
      (left, right) =>
        left.page.normalizedPath.localeCompare(right.page.normalizedPath) ||
        left.viewport.localeCompare(right.viewport),
    );
}

export function getPageKey(record: Pick<DesignAuditRecord, "page" | "viewport">): string {
  return `${record.page.normalizedPath}::${record.viewport}`;
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => cleanText(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function uniqueNumberValues(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))].sort(
    (left, right) => left - right,
  );
}

export function makeDetection(record: DesignAuditRecord, occurrences: number) {
  return {
    path: record.page.normalizedPath,
    viewport: record.viewport,
    archetype: record.page.archetype,
    occurrences,
  };
}

export function sortDetections<T extends { path: string; viewport: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.path.localeCompare(right.path) || left.viewport.localeCompare(right.viewport));
}

export function normalizeButtonSignature(signature: string): {
  background: string;
  text: string;
  borderRadius: string;
  padding: string;
  shadow: string;
  fontWeight: string;
} | null {
  const parts = signature.split("|").map(part => cleanText(part));
  if (parts.length < 6) return null;
  return {
    background: normalizeColor(parts[0]),
    text: normalizeColor(parts[1]),
    borderRadius: parts[2],
    padding: parts[3],
    shadow: parts[4],
    fontWeight: parts[5],
  };
}

export function looksLikeQuoteText(value: string): boolean {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /„|”|"|—|anonim|arystoteles|wilde|rumi|cummings/.test(text);
}

export function looksLikeCategoryText(value: string): boolean {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return /\bkategoria\b/.test(text) || (/\bcytat(?:y|ów)?\b/.test(text) && /\botwórz\b/.test(text));
}

export function inferPageTypeFromRecord(record: DesignAuditRecord):
  | "homepage"
  | "category-hub"
  | "category-detail"
  | "detail-page"
  | "conversion-page"
  | "legal-page"
  | null {
  if (record.page.archetype === "homepage" || record.page.siteRole === "homepage") return "homepage";
  if (record.page.archetype === "category-hub" || record.page.normalizedPath === "/categories") return "category-hub";
  if (record.page.archetype === "category-detail" || record.page.pageType === "category") return "category-detail";
  if (record.page.pageType === "detail" || record.page.archetype.startsWith("detail-")) return "detail-page";
  if (record.page.archetype === "conversion" || record.page.pageType === "creator") return "conversion-page";
  if (record.page.archetype === "legal" || record.page.pageType === "legal") return "legal-page";
  return null;
}

export function resolveEnrichedPath(page: { normalizedPath?: string | null; finalUrl?: string | null; url?: string }): string {
  if (page.normalizedPath) return normalizePathname(page.normalizedPath);
  if (page.finalUrl) return normalizePathname(new URL(page.finalUrl).pathname);
  if (page.url) return normalizePathname(new URL(page.url).pathname);
  return "/";
}
