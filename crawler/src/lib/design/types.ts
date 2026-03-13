import type {
  BrowserViewportAudit,
  ElementStyleAudit,
  EnrichedPage,
  Stage3Output,
  Stage5Output,
  Stage5OutputPage,
  ViewportPresetName,
} from "../browser/types.js";

export type Stage6Config = {
  version: string;
  visualAuditFile: string;
  enrichedSiteDataFile: string;
  aiAnalysisFile: string;
  outputDesignSystemFile: string;
  outputComponentMapFile: string;
  outputLayoutBlueprintsFile: string;
  outputSummaryFile: string;
  renderedHtmlDir: string;
};

export type HtmlSectionSignal = {
  tag: string;
  className: string;
  textSnippet: string;
  href: string | null;
};

export type HtmlSignal = {
  relativePath: string;
  sourcePath: string;
  sectionCount: number;
  articleCount: number;
  formCount: number;
  inputCount: number;
  textareaCount: number;
  buttonCount: number;
  navCount: number;
  footerCount: number;
  categoryLinkCount: number;
  quoteLinkCount: number;
  fixedBottomNav: boolean;
  sectionSamples: HtmlSectionSignal[];
};

export type DesignAuditRecord = {
  page: Stage5OutputPage;
  viewport: ViewportPresetName;
  audit: BrowserViewportAudit;
  html: HtmlSignal | null;
};

export type DesignExtractionContext = {
  config: Stage6Config;
  visualAudit: Stage5Output;
  enrichedSiteData: Stage3Output;
  aiAnalysis: string;
  records: DesignAuditRecord[];
  desktopRecords: DesignAuditRecord[];
  enrichedPageByPath: Map<string, EnrichedPage>;
};

export type RankedValue<T = string> = {
  value: T;
  count: number;
};

export type NumericToken = {
  token: string;
  value: number;
  sampleCount: number;
};

export type TypographyScaleToken = {
  token: string;
  sizePx: number;
  lineHeightPx: number | null;
  fontWeight: number | null;
  sampleCount: number;
};

export type ButtonStyleToken = {
  background: string;
  text: string;
  borderRadius: string;
  padding: string;
  shadow: string;
  fontWeight: string;
  sampleCount: number;
};

export type ShadowToken = {
  token: string;
  css: string;
  sampleCount: number;
  intensity: "none" | "subtle" | "medium" | "strong";
};

export type DesignSystemOutput = {
  schemaVersion: string;
  generatedAt: string;
  source: {
    visualAuditFile: string;
    enrichedSiteDataFile: string;
    aiAnalysisFile: string;
  };
  typography: {
    primaryFont: string | null;
    secondaryFont: string | null;
    headingScale: TypographyScaleToken[];
    paragraphSize: {
      sizePx: number | null;
      lineHeightPx: number | null;
      fontWeight: number | null;
      sampleCount: number;
    };
    fontWeights: number[];
  };
  spacing: {
    baseSpacingUnit: number | null;
    spacingScale: NumericToken[];
  };
  colors: {
    primaryText: string | null;
    secondaryText: string | null;
    background: string | null;
    accent: string | null;
    border: string | null;
    buttonPrimary: ButtonStyleToken | null;
    buttonSecondary: ButtonStyleToken | null;
    palette: Array<{
      token: string;
      color: string;
      sampleCount: number;
    }>;
  };
  radius: {
    borderRadiusScale: NumericToken[];
  };
  shadows: {
    shadowScale: ShadowToken[];
  };
  containers: {
    containerWidths: NumericToken[];
    maxContentWidth: number | null;
  };
};

export type ComponentStyleClues = {
  textColors: string[];
  backgroundColors: string[];
  borderRadius: string[];
  shadows: string[];
  fontSizes: string[];
  fontWeights: string[];
  paddings: string[];
  positions: string[];
  maxWidths: string[];
};

export type ComponentDetection = {
  path: string;
  viewport: ViewportPresetName;
  archetype: string;
  occurrences: number;
};

export type ComponentMapEntry = {
  name: string;
  category: "layout" | "navigation" | "content" | "conversion" | "feedback" | "legal";
  typicalTags: string[];
  layoutPatterns: string[];
  typicalChildren: string[];
  styleClues: ComponentStyleClues;
  detectedOnPages: ComponentDetection[];
  confidence: number;
};

export type ComponentMapOutput = {
  schemaVersion: string;
  generatedAt: string;
  components: ComponentMapEntry[];
};

export type LayoutBlueprint = {
  pageType:
    | "homepage"
    | "category-hub"
    | "category-detail"
    | "detail-page"
    | "conversion-page"
    | "legal-page";
  sections: string[];
  sectionRoles: Record<string, string>;
  contentDensity: "light" | "balanced" | "content-heavy" | "conversion-focused";
  primaryGoal: string;
  supportingPaths: string[];
  supportingArchetypes: string[];
};

export type LayoutBlueprintsOutput = {
  schemaVersion: string;
  generatedAt: string;
  blueprints: LayoutBlueprint[];
};

export type ComponentCandidate = {
  name: ComponentMapEntry["name"];
  category: ComponentMapEntry["category"];
  elements: ElementStyleAudit[];
  layoutPatterns: string[];
  typicalChildren: string[];
  detections: ComponentDetection[];
};
