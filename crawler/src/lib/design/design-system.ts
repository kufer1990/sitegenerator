import { round1 } from "../browser/normalizers.js";
import type { ButtonStyleToken, DesignExtractionContext, DesignSystemOutput, ShadowToken, TypographyScaleToken } from "./types.js";
import {
  classifyShadow,
  clusterNumbers,
  colorLuminance,
  colorSaturation,
  counterToRanked,
  createCounter,
  detectBaseSpacingUnit,
  incrementCounter,
  isNeutralColor,
  normalizeButtonSignature,
  normalizeColor,
  normalizeFontFamily,
  parsePxValue,
  parseTypographyScale,
  uniqueNumberValues,
} from "./design-helpers.js";

function choosePrimaryTextColor(counter: Map<string, number>): string | null {
  const ranked = counterToRanked(counter).filter(entry => entry.value !== "transparent");
  return ranked.find(entry => colorLuminance(entry.value) < 0.55)?.value || ranked[0]?.value || null;
}

function chooseSecondaryTextColor(counter: Map<string, number>, primaryText: string | null): string | null {
  const ranked = counterToRanked(counter).filter(entry => entry.value !== "transparent" && entry.value !== primaryText);
  return (
    ranked.find(
      entry =>
        colorLuminance(entry.value) > 0.25 &&
        colorLuminance(entry.value) < 0.85 &&
        (isNeutralColor(entry.value) || colorSaturation(entry.value) < 0.22),
    )?.value ||
    ranked[0]?.value ||
    null
  );
}

function chooseBackgroundColor(counter: Map<string, number>): string | null {
  const ranked = counterToRanked(counter).filter(entry => entry.value !== "transparent");
  return ranked.find(entry => colorLuminance(entry.value) >= 0.88)?.value || ranked[0]?.value || null;
}

function chooseAccentColor(accentCounter: Map<string, number>, fallbacks: Map<string, number>): string | null {
  const candidates = [...counterToRanked(accentCounter), ...counterToRanked(fallbacks)]
    .filter(entry => entry.value !== "transparent")
    .map(entry => ({
      ...entry,
      score: entry.count * (1 + colorSaturation(entry.value)) * (isNeutralColor(entry.value) ? 0.25 : 1),
    }))
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value));

  return candidates.find(entry => !isNeutralColor(entry.value) && colorSaturation(entry.value) >= 0.18)?.value || candidates[0]?.value || null;
}

function pickSecondaryFont(fontFamilies: Map<string, number>, primaryFont: string | null): string | null {
  const generic = new Set(["sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-monospace", "ui-serif"]);
  return (
    counterToRanked(fontFamilies).find(
      entry => entry.value !== primaryFont && !generic.has(entry.value.toLowerCase()) && !/fallback/i.test(entry.value),
    )?.value || null
  );
}

function buildPalette(
  textCounter: Map<string, number>,
  backgroundCounter: Map<string, number>,
  accentCounter: Map<string, number>,
  borderCounter: Map<string, number>,
): DesignSystemOutput["colors"]["palette"] {
  const merged = createCounter<string>();
  for (const counter of [textCounter, backgroundCounter, accentCounter, borderCounter]) {
    for (const [value, count] of counter.entries()) {
      incrementCounter(merged, value, count);
    }
  }

  return counterToRanked(merged)
    .filter(entry => entry.value !== "transparent")
    .slice(0, 8)
    .map((entry, index) => ({
      token: `color-${index + 1}`,
      color: entry.value,
      sampleCount: entry.count,
    }));
}

function pickButtonStyles(signatures: Map<string, number>): { primary: ButtonStyleToken | null; secondary: ButtonStyleToken | null } {
  const ranked = counterToRanked(signatures)
    .map(entry => {
      const parsed = normalizeButtonSignature(entry.value);
      if (!parsed) return null;
      return {
        ...parsed,
        sampleCount: entry.count,
      };
    })
    .filter((entry): entry is ButtonStyleToken => Boolean(entry));

  const primary =
    ranked.find(entry => entry.background !== "transparent" && colorLuminance(entry.background) < 0.85) ||
    ranked.find(entry => entry.background !== "transparent") ||
    ranked[0] ||
    null;

  const secondary =
    ranked.find(
      entry =>
        primary &&
        (entry.background !== primary.background || entry.text !== primary.text || entry.borderRadius !== primary.borderRadius),
    ) || null;

  return { primary, secondary };
}

function buildHeadingScale(counter: Map<string, number>): TypographyScaleToken[] {
  const ranked = counterToRanked(counter)
    .map(entry => {
      const parsed = parseTypographyScale(entry.value);
      if (!parsed) return null;
      return {
        token: "",
        sizePx: parsed.sizePx,
        lineHeightPx: parsed.lineHeightPx,
        fontWeight: parsed.fontWeight,
        sampleCount: entry.count,
      };
    })
    .filter((entry): entry is TypographyScaleToken => Boolean(entry))
    .sort((left, right) => right.sizePx - left.sizePx || right.sampleCount - left.sampleCount);

  const uniqueBySize: TypographyScaleToken[] = [];
  for (const entry of ranked) {
    if (uniqueBySize.some(existing => Math.abs(existing.sizePx - entry.sizePx) <= 1)) continue;
    uniqueBySize.push(entry);
  }

  return uniqueBySize.slice(0, 5).map((entry, index) => ({
    ...entry,
    token: ["display", "h1", "h2", "h3", "h4"][index] || `heading-${index + 1}`,
  }));
}

function pickParagraphToken(counter: Map<string, number>): DesignSystemOutput["typography"]["paragraphSize"] {
  const ranked = counterToRanked(counter)
    .map(entry => {
      const parsed = parseTypographyScale(entry.value);
      if (!parsed) return null;
      return {
        sizePx: parsed.sizePx,
        lineHeightPx: parsed.lineHeightPx,
        fontWeight: parsed.fontWeight,
        sampleCount: entry.count,
      };
    })
    .filter((entry): entry is DesignSystemOutput["typography"]["paragraphSize"] => Boolean(entry))
    .sort((left, right) => right.sampleCount - left.sampleCount || left.sizePx! - right.sizePx!);

  return ranked[0] || {
    sizePx: null,
    lineHeightPx: null,
    fontWeight: null,
    sampleCount: 0,
  };
}

function buildShadowScale(counter: Map<string, number>): ShadowToken[] {
  return counterToRanked(counter)
    .slice(0, 5)
    .map((entry, index) => ({
      token: `shadow-${index + 1}`,
      css: entry.value,
      sampleCount: entry.count,
      intensity: classifyShadow(entry.value),
    }));
}

export function extractDesignSystem(context: DesignExtractionContext): DesignSystemOutput {
  const fontFamilies = createCounter<string>();
  const headingScaleCounter = createCounter<string>();
  const paragraphScaleCounter = createCounter<string>();
  const weightCounter = createCounter<number>();
  const spacingCounter = createCounter<number>();
  const containerCounter = createCounter<number>();
  const desktopContainerCounter = createCounter<number>();
  const textColorCounter = createCounter<string>();
  const backgroundColorCounter = createCounter<string>();
  const accentColorCounter = createCounter<string>();
  const borderColorCounter = createCounter<string>();
  const radiusCounter = createCounter<number>();
  const shadowCounter = createCounter<string>();
  const buttonStyleCounter = createCounter<string>();

  for (const record of context.records) {
    const viewportWeight = record.viewport === "desktop" ? 2 : 1;

    for (const font of record.audit.typography.fontFamilyUsage) {
      incrementCounter(fontFamilies, normalizeFontFamily(font.value), font.count * viewportWeight);
    }

    for (const weight of record.audit.typography.fontWeightPatterns) {
      const parsed = Number.parseInt(weight.value, 10);
      if (Number.isFinite(parsed)) incrementCounter(weightCounter, parsed, weight.count * viewportWeight);
    }

    for (const token of record.audit.visualSystem.typographyScale) {
      const parsed = parseTypographyScale(token.value);
      if (!parsed) continue;
      const target = parsed.sizePx >= 18 ? headingScaleCounter : paragraphScaleCounter;
      incrementCounter(
        target,
        `${round1(parsed.sizePx)}px/${parsed.lineHeightPx ? round1(parsed.lineHeightPx) : parsed.sizePx}px/${parsed.fontWeight || 400}`,
        token.count * viewportWeight,
      );
    }

    const dominantHeading = record.audit.visualHierarchy.dominantHeadingBlock?.style;
    if (dominantHeading) {
      const sizePx = parsePxValue(dominantHeading.fontSize);
      const lineHeightPx = parsePxValue(dominantHeading.lineHeight);
      const fontWeight = Number.parseInt(dominantHeading.fontWeight, 10);
      if (sizePx) {
        incrementCounter(
          headingScaleCounter,
          `${round1(sizePx)}px/${lineHeightPx ? round1(lineHeightPx) : round1(sizePx * 1.15)}px/${Number.isFinite(fontWeight) ? fontWeight : 600}`,
          viewportWeight * 4,
        );
      }
    }

    for (const heading of record.audit.keyElements.h2 || []) {
      const sizePx = parsePxValue(heading.style.fontSize);
      const lineHeightPx = parsePxValue(heading.style.lineHeight);
      const fontWeight = Number.parseInt(heading.style.fontWeight, 10);
      if (!sizePx) continue;
      incrementCounter(
        headingScaleCounter,
        `${round1(sizePx)}px/${lineHeightPx ? round1(lineHeightPx) : round1(sizePx * 1.2)}px/${Number.isFinite(fontWeight) ? fontWeight : 600}`,
        viewportWeight,
      );
    }

    for (const item of record.audit.visualSystem.spacingScale) {
      const parsed = parsePxValue(item.value);
      if (parsed !== null) incrementCounter(spacingCounter, round1(parsed), item.count * viewportWeight);
    }

    for (const item of record.audit.visualSystem.containerWidths) {
      const parsed = parsePxValue(item.value);
      if (parsed !== null) {
        incrementCounter(containerCounter, round1(parsed), item.count * viewportWeight);
        if (record.viewport === "desktop") incrementCounter(desktopContainerCounter, round1(parsed), item.count * 2);
      }
    }

    for (const item of record.audit.colors.text) incrementCounter(textColorCounter, normalizeColor(item.value), item.count * viewportWeight);
    for (const item of record.audit.colors.backgrounds) incrementCounter(backgroundColorCounter, normalizeColor(item.value), item.count * viewportWeight);
    for (const item of record.audit.colors.accents) incrementCounter(accentColorCounter, normalizeColor(item.value), item.count * viewportWeight);
    for (const item of record.audit.colors.borders) incrementCounter(borderColorCounter, normalizeColor(item.value), item.count * viewportWeight);

    for (const item of record.audit.visualSystem.borderRadiusPatterns) {
      const parsed = parsePxValue(item.value);
      if (parsed !== null) incrementCounter(radiusCounter, round1(parsed), item.count * viewportWeight);
    }

    for (const item of record.audit.visualSystem.shadowPatterns) incrementCounter(shadowCounter, item.value, item.count * viewportWeight);
    for (const item of record.audit.visualSystem.buttonStylePatterns) incrementCounter(buttonStyleCounter, item.signature, item.count * viewportWeight);
  }

  const headingScale = buildHeadingScale(headingScaleCounter);
  const paragraphSize = pickParagraphToken(paragraphScaleCounter);
  const spacingScale = clusterNumbers(counterToRanked(spacingCounter).map(entry => ({ value: entry.value, count: entry.count })));
  const containerWidths = clusterNumbers(counterToRanked(containerCounter).map(entry => ({ value: entry.value, count: entry.count })), 8);
  const desktopContainerWidths = clusterNumbers(
    counterToRanked(desktopContainerCounter).map(entry => ({ value: entry.value, count: entry.count })),
    8,
  ).filter(token => token.value >= 600);
  const borderRadiusScale = clusterNumbers(counterToRanked(radiusCounter).map(entry => ({ value: entry.value, count: entry.count })), 1);
  const fontWeights = uniqueNumberValues(counterToRanked(weightCounter).slice(0, 6).map(entry => entry.value));
  const primaryText = choosePrimaryTextColor(textColorCounter);
  const secondaryText = chooseSecondaryTextColor(textColorCounter, primaryText);
  const background = chooseBackgroundColor(backgroundColorCounter);
  const accent = chooseAccentColor(accentColorCounter, textColorCounter);
  const border = counterToRanked(borderColorCounter).find(entry => entry.value !== "transparent")?.value || null;
  const buttonStyles = pickButtonStyles(buttonStyleCounter);
  const primaryFont = counterToRanked(fontFamilies)[0]?.value || null;

  return {
    schemaVersion: context.config.version,
    generatedAt: new Date().toISOString(),
    source: {
      visualAuditFile: context.config.visualAuditFile,
      enrichedSiteDataFile: context.config.enrichedSiteDataFile,
      aiAnalysisFile: context.config.aiAnalysisFile,
    },
    typography: {
      primaryFont,
      secondaryFont: pickSecondaryFont(fontFamilies, primaryFont),
      headingScale,
      paragraphSize,
      fontWeights,
    },
    spacing: {
      baseSpacingUnit: detectBaseSpacingUnit(spacingScale),
      spacingScale,
    },
    colors: {
      primaryText,
      secondaryText,
      background,
      accent,
      border,
      buttonPrimary: buttonStyles.primary,
      buttonSecondary: buttonStyles.secondary,
      palette: buildPalette(textColorCounter, backgroundColorCounter, accentColorCounter, borderColorCounter),
    },
    radius: {
      borderRadiusScale,
    },
    shadows: {
      shadowScale: buildShadowScale(shadowCounter),
    },
    containers: {
      containerWidths,
      maxContentWidth: desktopContainerWidths.sort((left, right) => right.sampleCount - left.sampleCount || left.value - right.value)[0]?.value || null,
    },
  };
}
