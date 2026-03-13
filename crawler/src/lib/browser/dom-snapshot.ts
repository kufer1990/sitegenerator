import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";

import type { DomSnapshotResult } from "./types.js";

const DOM_SNAPSHOT_SCRIPT_PATH = fileURLToPath(new URL("./dom-snapshot-script.js", import.meta.url));

type DomSnapshotRuntime = {
  createVisualAuditSnapshot: (options?: Record<string, unknown>) => DomSnapshotResult;
};

export async function installDomSnapshotRuntime(context: BrowserContext): Promise<void> {
  await context.addInitScript({ path: DOM_SNAPSHOT_SCRIPT_PATH });
}

export async function collectDomSnapshot(page: Page): Promise<DomSnapshotResult> {
  return page.evaluate(() => {
    const runtime = (window as typeof window & Record<string, unknown>).__VISUAL_AUDIT_RUNTIME__ as
      | DomSnapshotRuntime
      | undefined;
    if (!runtime || typeof runtime.createVisualAuditSnapshot !== "function") {
      throw new Error("Visual audit runtime is not installed in the browser context.");
    }

    return runtime.createVisualAuditSnapshot({
      maxLayoutBlocks: 24,
      maxTypographyNodes: 220,
      maxColorNodes: 260,
      maxMotionNodes: 240,
    });
  });
}
