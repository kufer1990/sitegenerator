export type BusinessValue = "high" | "medium" | "low";
export type SiteRole =
  | "homepage"
  | "discovery"
  | "detail"
  | "creator"
  | "account"
  | "contact"
  | "about"
  | "legal"
  | "utility"
  | "unknown";
export type Cluster =
  | "core"
  | "discovery"
  | "content"
  | "conversion"
  | "account"
  | "legal"
  | "utility"
  | "unknown";
export type PageType =
  | "home"
  | "listing"
  | "category"
  | "detail"
  | "creator"
  | "search"
  | "favorites"
  | "auth"
  | "legal"
  | "contact"
  | "about"
  | "utility"
  | "unknown";

export type ViewportPresetName = "desktop" | "mobile";
export type AuditPageArchetype =
  | "homepage"
  | "conversion"
  | "category-hub"
  | "category-detail"
  | "ranking"
  | "retention"
  | "trust"
  | "legal"
  | "detail-thin"
  | "detail-rich"
  | "detail-known-author"
  | "detail-typical"
  | "detail-media-heavy";

export type Stage5Config = {
  auditVersion: string;
  inputFile: string;
  outputJsonFile: string;
  outputSummaryFile: string;
  screenshotsDir: string;
  renderedHtmlDir: string;
  headless: boolean;
  pageTimeoutMs: number;
  networkIdleTimeoutMs: number;
  renderSettleMs: number;
  screenshotEnabled: boolean;
  renderedHtmlEnabled: boolean;
  popupDismissalEnabled: boolean;
  awakenLazyLoadEnabled: boolean;
  maxSelectedPages: number | null;
  maxCategoryPages: number;
  maxDetailPages: number;
  urlFilter: string | null;
  desktopViewport: {
    width: number;
    height: number;
  };
  mobileViewport: {
    width: number;
    height: number;
  };
};

export type PublicStage5Config = Omit<Stage5Config, "headless"> & {
  headless: boolean;
};

export type ContentSignals = {
  wordCount?: number;
  mainContentWordCount?: number;
  imageCount?: number;
  internalLinksCount?: number;
};

export type EnrichedPage = {
  url: string;
  finalUrl?: string | null;
  normalizedPath?: string | null;
  fetchStatus: "ok" | "error";
  title?: string | null;
  normalizedTitle?: string | null;
  normalizedVisibleTextSnippet?: string | null;
  rawText?: string | null;
  mainContentText?: string | null;
  h1?: string[] | null;
  h2?: string[] | null;
  imageCount?: number | null;
  buttons?: string[] | null;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  shouldAnalyze: boolean;
  pageTypeConfidence?: number;
  confidence?: number;
  parentCandidate?: string | null;
  reason?: string | null;
  contentSignals?: ContentSignals;
};

export type Stage3Output = {
  sourceFile: string;
  generatedAt: string;
  pagesTotal: number;
  pages: EnrichedPage[];
};

export type SelectedPage = {
  url: string;
  finalUrl: string;
  normalizedPath: string;
  title: string | null;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  archetype: AuditPageArchetype;
  selectedBecause: string[];
};

export type CountedValue = {
  value: string;
  count: number;
};

export type LayoutBoundingBox = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

export type LayoutBlock = {
  tag: string;
  selectorHint: string;
  boundingBox: LayoutBoundingBox;
  width: number;
  height: number;
  top: number;
  left: number;
  textSnippet: string;
  roleGuess: string;
};

export type StyleSnapshot = {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  borderRadius: string;
  boxShadow: string;
  padding: string;
  margin: string;
  display: string;
  position: string;
  zIndex: string;
  gap: string;
  maxWidth: string;
  textAlign: string;
  transition: string;
  animation: string;
  transform: string;
  opacity: string;
  filter: string;
  backdropFilter: string;
  willChange: string;
};

export type ElementStyleAudit = {
  tag: string;
  selectorHint: string;
  textSnippet: string;
  href: string | null;
  src: string | null;
  role: string | null;
  ariaLabel: string | null;
  isAboveFold: boolean;
  boundingBox: LayoutBoundingBox;
  style: StyleSnapshot;
};

export type TypographyAudit = {
  uniqueFontFamilies: string[];
  fontFamilyUsage: CountedValue[];
  commonHeadingSizes: CountedValue[];
  commonParagraphSizes: CountedValue[];
  fontWeightPatterns: CountedValue[];
};

export type ColorAudit = {
  text: CountedValue[];
  backgrounds: CountedValue[];
  buttons: CountedValue[];
  accents: CountedValue[];
  borders: CountedValue[];
};

export type MediaAudit = {
  images: {
    count: number;
    lazyHints: number;
    examples: Array<{
      src: string | null;
      alt: string | null;
      selectorHint: string;
      boundingBox: LayoutBoundingBox;
    }>;
  };
  backgroundImages: {
    count: number;
    examples: Array<{
      selectorHint: string;
      backgroundImage: string;
    }>;
  };
  svgCount: number;
  videoCount: number;
  canvasCount: number;
  iframeCount: number;
  iconHintsCount: number;
};

export type PositioningAudit = {
  stickyElements: ElementStyleAudit[];
  fixedElements: ElementStyleAudit[];
  overlayLikeElements: ElementStyleAudit[];
  modalLikeElements: ElementStyleAudit[];
  drawerLikeElements: ElementStyleAudit[];
};

export type MotionAudit = {
  transitionElements: number;
  animationElements: number;
  transformElements: number;
  opacityVariantElements: number;
  willChangeElements: number;
  filterElements: number;
  backdropFilterElements: number;
  samples: ElementStyleAudit[];
};

export type VisualHierarchyAudit = {
  dominantHeadingBlock: ElementStyleAudit | null;
  primaryCta: ElementStyleAudit | null;
  visibleMajorSections: number;
  aboveFoldHeadingCount: number;
  aboveFoldButtonCount: number;
  aboveFoldParagraphCount: number;
  aboveFoldMediaCount: number;
  firstViewportProfile: "cta-heavy" | "content-heavy" | "navigation-heavy" | "balanced";
  emphasis: "product" | "content" | "navigation" | "mixed";
};

export type VisualSystemAudit = {
  spacingScale: CountedValue[];
  containerWidths: CountedValue[];
  borderRadiusPatterns: CountedValue[];
  shadowPatterns: CountedValue[];
  buttonStylePatterns: Array<{
    signature: string;
    count: number;
  }>;
  typographyScale: CountedValue[];
  visualDensity: "dense" | "balanced" | "whitespace-heavy";
};

export type DomSnapshotResult = {
  layoutBlocks: LayoutBlock[];
  keyElements: Record<string, ElementStyleAudit[]>;
  typography: TypographyAudit;
  colors: ColorAudit;
  media: MediaAudit;
  positioning: PositioningAudit;
  motionClues: MotionAudit;
  visualHierarchy: VisualHierarchyAudit;
  visualSystem: VisualSystemAudit;
};

export type AuditNotice = {
  code: string;
  message: string;
};

export type ObstructionDetected = {
  type: "cookie-banner" | "modal" | "overlay" | "fixed-banner" | "unknown";
  selectorHint: string;
  textSnippet: string;
  blockingLikely: boolean;
  boundingBox: LayoutBoundingBox;
};

export type PagePreparationResult = {
  finalUrl: string;
  title: string | null;
  statusCode: number | null;
  pageLoadStatus: "ok" | "partial" | "error";
  notes: string[];
  warnings: AuditNotice[];
  errors: AuditNotice[];
  obstructionsDetected: ObstructionDetected[];
};

export type ScreenshotArtifact = {
  kind: "full" | "viewport";
  path: string;
  filename: string;
};

export type RenderedHtmlArtifact = {
  path: string;
  filename: string;
};

export type LoadTimingSummary = {
  domContentLoadedMs: number | null;
  loadMs: number | null;
  responseStartMs: number | null;
  firstByteMs: number | null;
  durationMs: number | null;
};

export type BrowserViewportAudit = {
  viewport: {
    width: number;
    height: number;
  };
  title: string | null;
  finalUrl: string;
  pageLoadStatus: "ok" | "partial" | "error";
  statusCode: number | null;
  warnings: AuditNotice[];
  errors: AuditNotice[];
  timings: LoadTimingSummary | null;
  pagePreparationNotes: string[];
  obstructionsDetected: ObstructionDetected[];
  renderedHtmlPath: string | null;
  screenshots: {
    full: ScreenshotArtifact | null;
    viewport: ScreenshotArtifact | null;
  };
  layoutBlocks: LayoutBlock[];
  keyElements: Record<string, ElementStyleAudit[]>;
  typography: TypographyAudit;
  colors: ColorAudit;
  media: MediaAudit;
  positioning: PositioningAudit;
  motionClues: MotionAudit;
  visualHierarchy: VisualHierarchyAudit;
  visualSystem: VisualSystemAudit;
};

export type Stage5OutputPage = {
  url: string;
  finalUrl: string;
  title: string | null;
  normalizedPath: string;
  pageType: PageType;
  siteRole: SiteRole;
  cluster: Cluster;
  businessValue: BusinessValue;
  archetype: AuditPageArchetype;
  selectedBecause: string[];
  audits: Record<ViewportPresetName, BrowserViewportAudit>;
};

export type Stage5Output = {
  auditVersion: string;
  generatedAt: string;
  sourceFile: string;
  sourceGeneratedAt: string;
  config: PublicStage5Config;
  screenshotsDir: string;
  renderedHtmlDir: string;
  pagesAudited: number;
  auditVariants: number;
  pages: Stage5OutputPage[];
};

export type ViewportArtifactPaths = {
  fullScreenshot: {
    absolutePath: string;
    relativePath: string;
    filename: string;
  };
  viewportScreenshot: {
    absolutePath: string;
    relativePath: string;
    filename: string;
  };
  renderedHtml: {
    absolutePath: string;
    relativePath: string;
    filename: string;
  };
};

export type AuditViewportPreset = {
  name: ViewportPresetName;
  viewport: {
    width: number;
    height: number;
  };
  deviceDescriptor?: Record<string, unknown>;
};
