import { devices } from "playwright";

export type ViewportPresetName = "desktop" | "mobile";

export type AuditViewportPreset = {
  name: ViewportPresetName;
  viewport: {
    width: number;
    height: number;
  };
  deviceDescriptor?: Record<string, unknown>;
};

const IPHONE_PRESET = devices["iPhone 13"];

export const AUDIT_VIEWPORTS: AuditViewportPreset[] = [
  {
    name: "desktop",
    viewport: {
      width: 1440,
      height: 1200,
    },
  },
  {
    name: "mobile",
    viewport: {
      width: 390,
      height: 844,
    },
    deviceDescriptor: {
      ...IPHONE_PRESET,
      viewport: {
        width: 390,
        height: 844,
      },
    },
  },
];
