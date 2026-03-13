import type { Stage5Output } from "./types.js";

function topValues<T extends { value: string; count: number }>(items: T[] | undefined, limit = 5): string {
  if (!items || items.length === 0) return "none";
  return items
    .slice(0, limit)
    .map(item => `${item.value} (${item.count})`)
    .join(", ");
}

export function buildVisualAuditMarkdownSummary(output: Stage5Output): string {
  const allAudits = output.pages.flatMap(page =>
    Object.entries(page.audits).map(([viewport, audit]) => ({
      page,
      viewport,
      audit,
    })),
  );

  const firstAudit = allAudits[0]?.audit;
  const pagesWithIssues = allAudits.filter(
    item =>
      item.audit.errors.length > 0 ||
      item.audit.warnings.length > 0 ||
      item.audit.obstructionsDetected.some(entry => entry.blockingLikely),
  );

  const dominantFonts = topValues(firstAudit?.typography.fontFamilyUsage);
  const dominantTextColors = topValues(firstAudit?.colors.text);
  const dominantBackgrounds = topValues(firstAudit?.colors.backgrounds);
  const dominantSpacing = topValues(firstAudit?.visualSystem.spacingScale);
  const dominantContainers = topValues(firstAudit?.visualSystem.containerWidths);
  const dominantRadius = topValues(firstAudit?.visualSystem.borderRadiusPatterns);
  const dominantShadows = topValues(firstAudit?.visualSystem.shadowPatterns);

  const sophisticationSignals = allAudits
    .filter(item => item.audit.motionClues.transitionElements > 0 || item.audit.motionClues.backdropFilterElements > 0)
    .map(item => `${item.page.normalizedPath} (${item.viewport})`)
    .slice(0, 8);

  const lines: string[] = [
    "# Stage 5 Visual Audit Summary",
    "",
    `- Audit version: ${output.auditVersion}`,
    `- Generated at: ${output.generatedAt}`,
    `- Pages audited: ${output.pagesAudited}`,
    `- Viewport audits: ${output.auditVariants}`,
    "",
    "## Audited Pages",
    "",
    ...output.pages.map(
      page =>
        `- ${page.normalizedPath} | ${page.archetype} | ${page.selectedBecause.join(", ")}`,
    ),
    "",
    "## Strongest Visual Patterns",
    "",
    `- Dominant fonts: ${dominantFonts}`,
    `- Common text colors: ${dominantTextColors}`,
    `- Common backgrounds: ${dominantBackgrounds}`,
    `- Repeated spacing values: ${dominantSpacing}`,
    `- Common container widths: ${dominantContainers}`,
    `- Repeated border radii: ${dominantRadius}`,
    `- Repeated shadow styles: ${dominantShadows}`,
    "",
    "## Layout Characteristics",
    "",
    ...allAudits.slice(0, 8).map(item => {
      const hierarchy = item.audit.visualHierarchy;
      return `- ${item.page.normalizedPath} (${item.viewport}): ${hierarchy.firstViewportProfile}, emphasis=${hierarchy.emphasis}, sections=${hierarchy.visibleMajorSections}`;
    }),
    "",
    "## UI Sophistication Clues",
    "",
    `- Motion/filter clues present on ${sophisticationSignals.length} sampled audits.`,
    `- Example pages: ${sophisticationSignals.length > 0 ? sophisticationSignals.join(", ") : "none"}`,
    "",
    "## Pages With Issues Or Obstructions",
    "",
  ];

  if (pagesWithIssues.length === 0) {
    lines.push("- None detected.");
  } else {
    lines.push(
      ...pagesWithIssues.map(item => {
        const warnings = item.audit.warnings.map(entry => entry.code).join(", ") || "none";
        const errors = item.audit.errors.map(entry => entry.code).join(", ") || "none";
        const obstructions =
          item.audit.obstructionsDetected
            .filter(entry => entry.blockingLikely)
            .map(entry => entry.type)
            .join(", ") || "none";
        return `- ${item.page.normalizedPath} (${item.viewport}): warnings=${warnings}; errors=${errors}; obstructions=${obstructions}`;
      }),
    );
  }

  return `${lines.join("\n")}\n`;
}
