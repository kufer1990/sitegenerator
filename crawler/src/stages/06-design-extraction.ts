import * as path from "node:path";

import { detectComponents } from "../lib/design/component-map.js";
import {
  createAuditRecords,
  readHtmlSignal,
  readJsonFile,
  readTextFile,
  resolveEnrichedPath,
  writeJsonFile,
  writeTextFile,
} from "../lib/design/design-helpers.js";
import { extractDesignSystem } from "../lib/design/design-system.js";
import { buildLayoutBlueprints } from "../lib/design/layout-blueprints.js";
import type { DesignExtractionContext, Stage6Config } from "../lib/design/types.js";
import type { Stage3Output, Stage5Output } from "../lib/browser/types.js";

function getStage6ConfigFromEnv(): Stage6Config {
  return {
    version: "1.0.0",
    visualAuditFile: path.resolve(process.env.STAGE6_VISUAL_AUDIT_FILE || "output/05-visual-audit.json"),
    enrichedSiteDataFile: path.resolve(process.env.STAGE6_ENRICHED_SITE_DATA_FILE || "output/03-enriched-site-data.json"),
    aiAnalysisFile: path.resolve(process.env.STAGE6_AI_ANALYSIS_FILE || "output/04-ai-analysis.md"),
    outputDesignSystemFile: path.resolve(process.env.STAGE6_OUTPUT_DESIGN_SYSTEM_FILE || "output/06-design-system.json"),
    outputComponentMapFile: path.resolve(process.env.STAGE6_OUTPUT_COMPONENT_MAP_FILE || "output/06-component-map.json"),
    outputLayoutBlueprintsFile: path.resolve(process.env.STAGE6_OUTPUT_LAYOUT_BLUEPRINTS_FILE || "output/06-layout-blueprints.json"),
    outputSummaryFile: path.resolve(process.env.STAGE6_OUTPUT_SUMMARY_FILE || "output/06-design-summary.md"),
    renderedHtmlDir: path.resolve(process.env.STAGE6_RENDERED_HTML_DIR || "output/rendered-html"),
  };
}

function buildSummary(context: DesignExtractionContext, outputs: {
  designSystem: ReturnType<typeof extractDesignSystem>;
  componentMap: ReturnType<typeof detectComponents>;
  layoutBlueprints: ReturnType<typeof buildLayoutBlueprints>;
}): string {
  const fonts = [outputs.designSystem.typography.primaryFont, outputs.designSystem.typography.secondaryFont].filter(Boolean).join(", ") || "none";
  const spacing = outputs.designSystem.spacing.spacingScale.slice(0, 6).map(token => `${token.value}px (${token.sampleCount})`).join(", ") || "none";
  const colors = [
    outputs.designSystem.colors.primaryText,
    outputs.designSystem.colors.secondaryText,
    outputs.designSystem.colors.background,
    outputs.designSystem.colors.accent,
  ]
    .filter(Boolean)
    .join(", ") || "none";

  const lines: string[] = [
    "# Stage 6 Design Extraction Summary",
    "",
    `- Design schema version: ${context.config.version}`,
    `- Generated at: ${new Date().toISOString()}`,
    `- Audited pages used: ${context.visualAudit.pages.length}`,
    `- Audit variants used: ${context.records.length}`,
    "",
    "## Design System",
    "",
    `- Primary fonts: ${fonts}`,
    `- Heading scale: ${outputs.designSystem.typography.headingScale.map(token => `${token.token}=${token.sizePx}px`).join(", ") || "none"}`,
    `- Paragraph size: ${outputs.designSystem.typography.paragraphSize.sizePx || "unknown"}px`,
    `- Base spacing unit: ${outputs.designSystem.spacing.baseSpacingUnit || "unknown"}px`,
    `- Spacing scale: ${spacing}`,
    `- Core colors: ${colors}`,
    `- Max content width: ${outputs.designSystem.containers.maxContentWidth || "unknown"}px`,
    "",
    "## Components",
    "",
    ...outputs.componentMap.components.map(
      component =>
        `- ${component.name}: ${component.detectedOnPages.length} detections, patterns=${component.layoutPatterns.join(", ") || "none"}`,
    ),
    "",
    "## Layout Blueprints",
    "",
    ...outputs.layoutBlueprints.blueprints.map(
      blueprint =>
        `- ${blueprint.pageType}: sections=${blueprint.sections.join(" -> ") || "none"} | goal=${blueprint.primaryGoal} | density=${blueprint.contentDensity}`,
    ),
    "",
    "## AI Context Note",
    "",
    `- AI analysis length: ${context.aiAnalysis.length} characters`,
  ];

  return `${lines.join("\n")}\n`;
}

async function loadContext(config: Stage6Config): Promise<DesignExtractionContext> {
  console.log("[stage6] Reading visual audit");
  const [visualAudit, enrichedSiteData, aiAnalysis] = await Promise.all([
    readJsonFile<Stage5Output>(config.visualAuditFile),
    readJsonFile<Stage3Output>(config.enrichedSiteDataFile),
    readTextFile(config.aiAnalysisFile),
  ]);

  const htmlPaths = [...new Set(visualAudit.pages.flatMap(page => Object.values(page.audits).map(audit => audit.renderedHtmlPath).filter(Boolean)))];
  const htmlSignals = await Promise.all(
    htmlPaths.map(async htmlPath => ({
      htmlPath,
      signal: await readHtmlSignal(htmlPath),
    })),
  );

  const htmlByPath = new Map<string, Awaited<ReturnType<typeof readHtmlSignal>>>();
  for (const entry of htmlSignals) {
    if (entry.htmlPath) htmlByPath.set(entry.htmlPath, entry.signal);
  }

  const records = createAuditRecords(visualAudit.pages, htmlByPath);
  const desktopRecords = records.filter(record => record.viewport === "desktop");
  const enrichedPageByPath = new Map(enrichedSiteData.pages.map(page => [resolveEnrichedPath(page), page]));

  return {
    config,
    visualAudit,
    enrichedSiteData,
    aiAnalysis,
    records,
    desktopRecords,
    enrichedPageByPath,
  };
}

async function main(): Promise<void> {
  const config = getStage6ConfigFromEnv();
  const context = await loadContext(config);

  console.log("[stage6] Extracting design system");
  const designSystem = extractDesignSystem(context);

  console.log("[stage6] Detecting components");
  const componentMap = detectComponents(context);

  console.log("[stage6] Building layout blueprints");
  const layoutBlueprints = buildLayoutBlueprints(context);

  console.log("[stage6] Writing outputs");
  await Promise.all([
    writeJsonFile(config.outputDesignSystemFile, designSystem),
    writeJsonFile(config.outputComponentMapFile, componentMap),
    writeJsonFile(config.outputLayoutBlueprintsFile, layoutBlueprints),
    writeTextFile(
      config.outputSummaryFile,
      buildSummary(context, {
        designSystem,
        componentMap,
        layoutBlueprints,
      }),
    ),
  ]);

  console.log("[stage6] Stage 6 completed.");
  console.log(`[stage6] Design system: ${config.outputDesignSystemFile}`);
  console.log(`[stage6] Component map: ${config.outputComponentMapFile}`);
  console.log(`[stage6] Layout blueprints: ${config.outputLayoutBlueprintsFile}`);
  console.log(`[stage6] Summary: ${config.outputSummaryFile}`);
  console.log("[stage6] Run via: npm run stage:06");
}

main().catch(error => {
  console.error("[stage6] Critical error:", error);
  process.exit(1);
});
