import type { EnrichedPage } from "../browser/types.js";
import type { DesignAuditRecord, DesignExtractionContext, LayoutBlueprint, LayoutBlueprintsOutput } from "./types.js";
import { inferPageTypeFromRecord, looksLikeQuoteText, resolveEnrichedPath } from "./design-helpers.js";

type BlueprintDefinition = {
  pageType: LayoutBlueprint["pageType"];
  primaryGoal: string;
  sectionRoleDescriptions: Record<string, string>;
  matches: (record: DesignAuditRecord) => boolean;
};

function inferSectionRoles(record: DesignAuditRecord): string[] {
  const sections: string[] = [];

  if ((record.audit.keyElements.header || []).length) sections.push("header");
  if ((record.audit.keyElements.nav || []).length) sections.push("navigation");

  if ((record.audit.keyElements.h1 || []).length) {
    sections.push(record.page.pageType === "detail" ? "quote-hero" : "hero");
  }

  for (const section of record.audit.keyElements.majorSections || []) {
    const text = section.textSnippet.toLowerCase();
    if (!text || text.includes("miejsce na reklam")) continue;

    if ((record.page.pageType === "legal" || record.page.archetype === "legal") && text.length > 40) {
      sections.push("legal-content");
      continue;
    }

    if (record.page.pageType === "creator" && /\b(treść cytatu|format|stwórz|grafik)\b/.test(text)) {
      sections.push("editor");
      continue;
    }

    if (record.page.archetype === "category-hub" && /\botwórz\b/.test(text)) {
      sections.push("category-grid");
      continue;
    }

    if (record.page.pageType === "category" && looksLikeQuoteText(text)) {
      sections.push("quote-grid");
      continue;
    }

    if (record.page.pageType === "detail" && looksLikeQuoteText(text)) {
      sections.push("quote-card");
      continue;
    }

    if (record.page.archetype === "ranking" && /\btop|ranking|zwycięzca\b/.test(text)) {
      sections.push("ranking-list");
      continue;
    }

    if (/\b(kategorii|cytat(?:y|ów)?|polubie(?:ń|nia)|dni|godzin)\b/.test(text) && /\d/.test(text)) {
      sections.push("stats-strip");
      continue;
    }

    if (/\bnie masz jeszcze|brak danych|brak polubionych\b/.test(text)) {
      sections.push("empty-state");
      continue;
    }

    if (/\bstwórz|kliknij|udostępnij|otwórz\b/.test(text)) {
      sections.push("cta");
      continue;
    }

    sections.push("content-section");
  }

  const cards = record.audit.keyElements.cards || [];
  if ((record.page.archetype === "homepage" || record.page.pageType === "home") && cards.some(card => looksLikeQuoteText(card.textSnippet))) {
    sections.push("quote-grid");
  }
  if (record.page.archetype === "category-hub" && (record.html?.categoryLinkCount || 0) > 2) sections.push("category-grid");
  if (record.page.pageType === "category" && cards.some(card => looksLikeQuoteText(card.textSnippet))) sections.push("quote-grid");
  if (record.page.pageType === "detail" && cards.some(card => looksLikeQuoteText(card.textSnippet))) sections.push("quote-card");
  if (record.page.archetype === "ranking" && cards.length > 0) sections.push("ranking-list");
  if ((record.audit.keyElements.ctaButtons || []).length > 0 && !sections.includes("cta")) sections.push("cta");
  if ((record.audit.keyElements.footer || []).length) sections.push("footer");

  return sections.filter((section, index) => index === 0 || section !== sections[index - 1]);
}

function pickContentDensity(records: DesignAuditRecord[], enrichedPages: EnrichedPage[]): LayoutBlueprint["contentDensity"] {
  const words = enrichedPages
    .map(page => page.contentSignals?.mainContentWordCount || page.contentSignals?.wordCount || 0)
    .filter(count => count > 0)
    .sort((left, right) => left - right);

  const medianWords = words.length ? words[Math.floor(words.length / 2)] : 0;
  const hasForm = records.some(record => (record.html?.formCount || 0) > 0 || record.page.pageType === "creator");

  if (hasForm) return "conversion-focused";
  if (medianWords >= 320) return "content-heavy";
  if (medianWords <= 120) return "light";
  return "balanced";
}

const BLUEPRINTS: BlueprintDefinition[] = [
  {
    pageType: "homepage",
    primaryGoal: "discovery",
    sectionRoleDescriptions: {
      header: "global brand and top-level site framing",
      navigation: "primary navigation across core product areas",
      hero: "value proposition and above-the-fold orientation",
      "stats-strip": "quick proof points and content inventory summary",
      "quote-grid": "browseable set of featured content cards",
      cta: "prompt to create or explore more content",
      footer: "trust, legal, and support links",
    },
    matches: record => inferPageTypeFromRecord(record) === "homepage",
  },
  {
    pageType: "category-hub",
    primaryGoal: "exploration",
    sectionRoleDescriptions: {
      header: "global brand and navigation anchor",
      navigation: "core wayfinding across discovery surfaces",
      hero: "category overview and browsing context",
      "stats-strip": "counts and browsing cues for the library",
      "category-grid": "entry grid into thematic collections",
      cta: "encouragement to open categories or start creating",
      footer: "supporting links and trust layer",
    },
    matches: record => inferPageTypeFromRecord(record) === "category-hub",
  },
  {
    pageType: "category-detail",
    primaryGoal: "content discovery",
    sectionRoleDescriptions: {
      header: "global brand and navigation shell",
      navigation: "top-level movement across the app",
      hero: "category framing and browsing promise",
      "quote-grid": "scannable content list for the selected theme",
      cta: "jump into content creation from discovered items",
      footer: "legal and trust utilities",
    },
    matches: record => inferPageTypeFromRecord(record) === "category-detail",
  },
  {
    pageType: "detail-page",
    primaryGoal: "consumption and sharing",
    sectionRoleDescriptions: {
      header: "global shell and route back into discovery",
      navigation: "core product navigation",
      "quote-hero": "page headline and content framing",
      "quote-card": "primary content artifact with actions",
      cta: "share, save, or create from the current item",
      footer: "trust and utility links",
    },
    matches: record => inferPageTypeFromRecord(record) === "detail-page",
  },
  {
    pageType: "conversion-page",
    primaryGoal: "conversion",
    sectionRoleDescriptions: {
      header: "global context and trust anchor",
      navigation: "escape hatch to the rest of the site",
      hero: "creator value proposition",
      editor: "primary interactive form and preview workflow",
      cta: "submission and next action prompts",
      footer: "supporting trust and legal links",
    },
    matches: record => inferPageTypeFromRecord(record) === "conversion-page",
  },
  {
    pageType: "legal-page",
    primaryGoal: "trust and compliance",
    sectionRoleDescriptions: {
      header: "global brand shell",
      navigation: "contextual return path to product pages",
      hero: "document title and metadata",
      "legal-content": "structured legal or policy information",
      footer: "cross-links to related trust pages",
    },
    matches: record => inferPageTypeFromRecord(record) === "legal-page",
  },
];

export function buildLayoutBlueprints(context: DesignExtractionContext): LayoutBlueprintsOutput {
  const blueprints: LayoutBlueprint[] = BLUEPRINTS.map(definition => {
    const supportingRecords = context.desktopRecords.filter(definition.matches);
    const supportingPaths = [...new Set(supportingRecords.map(record => record.page.normalizedPath))].sort((left, right) => left.localeCompare(right));
    const supportingArchetypes = [...new Set(supportingRecords.map(record => record.page.archetype))].sort((left, right) => left.localeCompare(right));
    const inferredSections = supportingRecords.flatMap(inferSectionRoles);
    const sectionCounts = new Map<string, number>();

    for (const section of inferredSections) {
      sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    }

    const orderedSections = [...sectionCounts.entries()]
      .sort((left, right) => {
        const firstLeftIndex = inferredSections.indexOf(left[0]);
        const firstRightIndex = inferredSections.indexOf(right[0]);
        return firstLeftIndex - firstRightIndex || right[1] - left[1] || left[0].localeCompare(right[0]);
      })
      .map(([section]) => section)
      .filter(section => section in definition.sectionRoleDescriptions);

    const blueprintPages = context.enrichedSiteData.pages.filter(page => supportingPaths.includes(resolveEnrichedPath(page)));

    return {
      pageType: definition.pageType,
      sections: orderedSections,
      sectionRoles: Object.fromEntries(orderedSections.map(section => [section, definition.sectionRoleDescriptions[section]])),
      contentDensity: pickContentDensity(supportingRecords, blueprintPages),
      primaryGoal: definition.primaryGoal,
      supportingPaths,
      supportingArchetypes,
    };
  });

  return {
    schemaVersion: context.config.version,
    generatedAt: new Date().toISOString(),
    blueprints,
  };
}
