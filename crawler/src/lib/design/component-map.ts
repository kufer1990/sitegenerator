import type { ElementStyleAudit } from "../browser/types.js";
import type { ComponentCandidate, ComponentMapEntry, ComponentMapOutput, DesignAuditRecord, DesignExtractionContext } from "./types.js";
import {
  buildStyleClues,
  looksLikeCategoryText,
  looksLikeQuoteText,
  makeDetection,
  sortDetections,
  uniqueSorted,
} from "./design-helpers.js";

function addCandidate(target: Map<string, ComponentCandidate>, candidate: ComponentCandidate): void {
  const existing = target.get(candidate.name);
  if (!existing) {
    target.set(candidate.name, candidate);
    return;
  }

  existing.elements.push(...candidate.elements);
  existing.layoutPatterns.push(...candidate.layoutPatterns);
  existing.typicalChildren.push(...candidate.typicalChildren);
  existing.detections.push(...candidate.detections);
}

function createCandidate(
  record: DesignAuditRecord,
  name: ComponentCandidate["name"],
  category: ComponentCandidate["category"],
  elements: ElementStyleAudit[],
  layoutPatterns: string[],
  typicalChildren: string[],
  occurrences = elements.length || 1,
): ComponentCandidate {
  return {
    name,
    category,
    elements,
    layoutPatterns,
    typicalChildren,
    detections: [makeDetection(record, occurrences)],
  };
}

function buildDetections(record: DesignAuditRecord): ComponentCandidate[] {
  const candidates: ComponentCandidate[] = [];

  if ((record.audit.keyElements.header || []).length) {
    candidates.push(
      createCandidate(record, "Header", "layout", record.audit.keyElements.header || [], ["sticky", "top-bar"], [
        "brand",
        "navigation",
        "cta",
      ]),
    );
  }

  if ((record.audit.keyElements.nav || []).length) {
    candidates.push(
      createCandidate(
        record,
        "NavigationBar",
        "navigation",
        record.audit.keyElements.nav || [],
        [record.viewport === "mobile" ? "mobile-nav" : "horizontal-nav", "sticky"],
        ["link", "icon", "current-state"],
      ),
    );
  }

  if (record.viewport === "mobile" && record.html?.fixedBottomNav) {
    candidates.push(
      createCandidate(
        record,
        "MobileTabBar",
        "navigation",
        record.audit.positioning.fixedElements.filter(element => /start|kategorie|stwórz|ulubione|top/i.test(element.textSnippet)),
        ["fixed-bottom", "icon-tabs"],
        ["icon", "label", "active-tab"],
      ),
    );
  }

  if ((record.audit.keyElements.footer || []).length) {
    candidates.push(
      createCandidate(
        record,
        "Footer",
        "layout",
        record.audit.keyElements.footer || [],
        ["meta-links", "utility-footer"],
        ["copyright", "legal-links", "contact-link"],
      ),
    );
  }

  const heroElements = [
    ...(record.audit.keyElements.h1 || []),
    ...(record.audit.keyElements.majorSections || []).filter(element => element.boundingBox.top < 380),
  ];
  if (heroElements.length) {
    candidates.push(createCandidate(record, "HeroSection", "content", heroElements, ["split-hero", "intro-block"], [
      "eyebrow",
      "headline",
      "supporting-text",
      "primary-cta",
    ]));
  }

  if ((record.audit.keyElements.ctaButtons || []).length) {
    candidates.push(
      createCandidate(record, "CTAButton", "conversion", record.audit.keyElements.ctaButtons || [], ["pill-button", "inline-cta"], [
        "label",
        "icon",
      ]),
    );
  }

  const quoteCards = (record.audit.keyElements.cards || []).filter(element => looksLikeQuoteText(element.textSnippet));
  if (quoteCards.length) {
    candidates.push(createCandidate(record, "QuoteCard", "content", quoteCards, ["card", "stacked-content"], [
      "quote",
      "author",
      "meta",
      "actions",
    ]));
  }

  const categoryCards = [
    ...(record.audit.keyElements.links || []).filter(element => /\/categories\//.test(element.href || "")),
    ...(record.audit.keyElements.cards || []).filter(
      element => looksLikeCategoryText(element.textSnippet) && /\d/.test(element.textSnippet),
    ),
  ];
  if (categoryCards.length || (record.html?.categoryLinkCount || 0) > 0) {
    candidates.push(
      createCandidate(
        record,
        "CategoryCard",
        "content",
        categoryCards,
        ["grid-card", "collection-entry"],
        ["icon", "title", "count", "open-cta"],
        Math.max(categoryCards.length, record.html?.categoryLinkCount || 0),
      ),
    );
  }

  const gridLike = record.audit.layoutBlocks.filter(block => block.roleGuess === "grid");
  const cardCount = (record.audit.keyElements.cards || []).length;
  const htmlGridCount = record.html?.sectionSamples.filter(sample => /\bgrid\b/.test(sample.className)).length || 0;
  if (gridLike.length || cardCount >= 2 || htmlGridCount > 0) {
    candidates.push(
      createCandidate(
        record,
        "Grid",
        "layout",
        [...(record.audit.keyElements.majorSections || []), ...(record.audit.keyElements.cards || [])],
        ["multi-column", "card-grid"],
        ["card", "heading", "cta"],
        Math.max(gridLike.length, cardCount, htmlGridCount),
      ),
    );
  }

  const formSignals = (record.html?.formCount || 0) + (record.html?.textareaCount || 0) + (record.html?.inputCount || 0);
  if (formSignals > 0 || record.page.pageType === "creator" || record.page.archetype === "conversion") {
    candidates.push(
      createCandidate(
        record,
        "FormPanel",
        "conversion",
        [...(record.audit.keyElements.majorSections || []), ...(record.audit.keyElements.buttons || [])],
        ["two-column", "editor-panel"],
        ["textarea", "field", "preview", "submit-cta"],
        Math.max(1, formSignals),
      ),
    );
  }

  if (record.page.pageType === "legal" || record.page.archetype === "legal") {
    candidates.push(
      createCandidate(
        record,
        "LegalSection",
        "legal",
        [...(record.audit.keyElements.h2 || []), ...(record.audit.keyElements.paragraphs || []).slice(0, 8)],
        ["document-section", "stacked-copy"],
        ["section-title", "paragraph", "list", "back-link"],
        Math.max(1, (record.audit.keyElements.h2 || []).length),
      ),
    );
  }

  const statsSections = (record.audit.keyElements.majorSections || []).filter(element =>
    /\b(kategorii|cytat(?:y|ów)?|polubie(?:ń|nia)|dni|godzin)\b/i.test(element.textSnippet),
  );
  if (statsSections.length) {
    candidates.push(
      createCandidate(record, "StatsStrip", "content", statsSections, ["metrics-row", "summary-strip"], [
        "metric",
        "label",
        "context",
      ]),
    );
  }

  const emptyStates = (record.audit.keyElements.majorSections || []).filter(element =>
    /\bnie masz jeszcze|brak danych|brak polubionych|wypełni się\b/i.test(element.textSnippet),
  );
  if (emptyStates.length) {
    candidates.push(
      createCandidate(record, "EmptyState", "feedback", emptyStates, ["message-block", "supporting-cta"], [
        "headline",
        "description",
        "action",
      ]),
    );
  }

  return candidates;
}

function buildComponentEntry(candidate: ComponentCandidate): ComponentMapEntry {
  const uniquePageCount = new Set(candidate.detections.map(detection => `${detection.path}:${detection.viewport}`)).size;
  const confidence = Math.min(0.99, Number((0.45 + Math.min(uniquePageCount, 10) * 0.05).toFixed(2)));

  return {
    name: candidate.name,
    category: candidate.category,
    typicalTags: uniqueSorted(candidate.elements.map(element => element.tag)),
    layoutPatterns: uniqueSorted(candidate.layoutPatterns),
    typicalChildren: uniqueSorted(candidate.typicalChildren),
    styleClues: buildStyleClues(candidate.elements),
    detectedOnPages: sortDetections(candidate.detections),
    confidence,
  };
}

export function detectComponents(context: DesignExtractionContext): ComponentMapOutput {
  const candidates = new Map<string, ComponentCandidate>();

  for (const record of context.records) {
    for (const candidate of buildDetections(record)) {
      addCandidate(candidates, candidate);
    }
  }

  const components = [...candidates.values()]
    .map(buildComponentEntry)
    .filter(entry => entry.detectedOnPages.length >= 2 || ["FormPanel", "LegalSection", "MobileTabBar"].includes(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    schemaVersion: context.config.version,
    generatedAt: new Date().toISOString(),
    components,
  };
}
