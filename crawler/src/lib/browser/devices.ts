import { devices } from "playwright";

import type { AuditViewportPreset, Stage5Config } from "./types.js";

const IPHONE_PRESET = devices["iPhone 13"];

export function buildAuditViewports(config: Stage5Config): AuditViewportPreset[] {
  return [
    {
      name: "desktop",
      viewport: config.desktopViewport,
    },
    {
      name: "mobile",
      viewport: config.mobileViewport,
      deviceDescriptor: {
        ...IPHONE_PRESET,
        viewport: config.mobileViewport,
      },
    },
  ];
}
