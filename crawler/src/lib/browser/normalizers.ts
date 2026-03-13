export function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  const compact = pathname.replace(/\/+/g, "/");
  const trimmed = compact === "/" ? "/" : compact.replace(/\/+$/, "");
  return trimmed || "/";
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.pathname = normalizePathname(parsed.pathname);
  return parsed.href;
}

export function round1(value: number): number {
  return Number(value.toFixed(1));
}

export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseOptionalIntegerEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function toRelativeOutputPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").replace(`${process.cwd().replace(/\\/g, "/")}/`, "");
}

export function slugify(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => cleanText(value)).filter(Boolean))];
}
