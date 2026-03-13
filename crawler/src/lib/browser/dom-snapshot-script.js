(function installVisualAuditRuntime() {
  if (window.__VISUAL_AUDIT_RUNTIME__) return;

  const STYLE_KEYS = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "border-radius",
    "box-shadow",
    "padding",
    "margin",
    "display",
    "position",
    "z-index",
    "gap",
    "max-width",
    "text-align",
    "transition",
    "animation",
    "transform",
    "opacity",
    "filter",
    "backdrop-filter",
    "will-change",
  ];

  const CTA_TEXT_REGEX =
    /\b(create|start|get started|try|book|contact|buy|shop|learn|view|browse|share|download|sign up|join|discover|save|submit|continue|compare|request|demo|quote|stworz|zacznij|sprawdz|zobacz|udostepnij|wybierz|polub)\b/i;
  const ICON_CLASS_REGEX = /\b(icon|lucide|heroicon|fa-|material-icons|ph-|tabler-|ri-)\b/i;
  const SPACING_SELECTORS = "section, article, main > div, main > section, nav, header, footer, aside, button, a";

  function round(value) {
    return Number(value.toFixed(1));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function selectorHint(element) {
    if (element.id) return `#${element.id}`;

    const classes = Array.from(element.classList).slice(0, 3);
    if (classes.length) {
      return `${element.tagName.toLowerCase()}.${classes.join(".")}`;
    }

    const role = element.getAttribute("role");
    if (role) return `${element.tagName.toLowerCase()}[role="${role}"]`;

    return element.tagName.toLowerCase();
  }

  function toBox(element) {
    const rect = element.getBoundingClientRect();
    return {
      top: round(rect.top),
      left: round(rect.left),
      width: round(rect.width),
      height: round(rect.height),
      right: round(rect.right),
      bottom: round(rect.bottom),
    };
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) <= 0.02) return false;
    return rect.width >= 12 && rect.height >= 12;
  }

  function isTransparent(value) {
    return !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
  }

  function topN(values, limit) {
    const counts = new Map();
    for (const rawValue of values) {
      const value = normalizeText(rawValue);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  }

  function collectVisible(selectors, limit, predicate) {
    const elements = [];
    const seen = new Set();

    for (const candidate of document.querySelectorAll(selectors)) {
      if (!isVisible(candidate)) continue;
      if (predicate && !predicate(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      elements.push(candidate);
      if (elements.length >= limit) break;
    }

    return elements;
  }

  function getStyleSnapshot(element) {
    const style = window.getComputedStyle(element);
    const styleMap = Object.fromEntries(STYLE_KEYS.map(key => [key, style.getPropertyValue(key) || ""]));

    return {
      fontFamily: styleMap["font-family"],
      fontSize: styleMap["font-size"],
      fontWeight: styleMap["font-weight"],
      lineHeight: styleMap["line-height"],
      letterSpacing: styleMap["letter-spacing"],
      color: styleMap["color"],
      backgroundColor: styleMap["background-color"],
      borderRadius: styleMap["border-radius"],
      boxShadow: styleMap["box-shadow"],
      padding: styleMap["padding"],
      margin: styleMap["margin"],
      display: styleMap["display"],
      position: styleMap["position"],
      zIndex: styleMap["z-index"],
      gap: styleMap["gap"],
      maxWidth: styleMap["max-width"],
      textAlign: styleMap["text-align"],
      transition: styleMap["transition"],
      animation: styleMap["animation"],
      transform: styleMap["transform"],
      opacity: styleMap["opacity"],
      filter: styleMap["filter"],
      backdropFilter: styleMap["backdrop-filter"],
      willChange: styleMap["will-change"],
    };
  }

  function toElementAudit(element) {
    const box = toBox(element);
    return {
      tag: element.tagName.toLowerCase(),
      selectorHint: selectorHint(element),
      textSnippet: normalizeText(element.innerText || element.textContent || "").slice(0, 180),
      href: element instanceof HTMLAnchorElement ? element.href : null,
      src:
        element instanceof HTMLImageElement
          ? element.currentSrc || element.src
          : element instanceof HTMLVideoElement
            ? element.currentSrc || element.src
            : null,
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      isAboveFold: box.top < window.innerHeight,
      boundingBox: box,
      style: getStyleSnapshot(element),
    };
  }

  function detectLayoutBlocks(limit) {
    const layoutBlocks = [];
    const seen = new Set();

    function push(element, roleGuess) {
      if (!isVisible(element) || seen.has(element)) return;
      seen.add(element);
      const box = toBox(element);
      if (box.width < 140 || box.height < 40) return;

      layoutBlocks.push({
        tag: element.tagName.toLowerCase(),
        selectorHint: selectorHint(element),
        boundingBox: box,
        width: box.width,
        height: box.height,
        top: box.top,
        left: box.left,
        textSnippet: normalizeText(element.innerText || element.textContent || "").slice(0, 140),
        roleGuess,
      });
    }

    const landmarks = [
      { selectors: ["header", '[role="banner"]'], roleGuess: "header" },
      { selectors: ["nav", '[role="navigation"]'], roleGuess: "nav" },
      { selectors: ["main", '[role="main"]'], roleGuess: "main" },
      { selectors: ["footer", '[role="contentinfo"]'], roleGuess: "footer" },
      {
        selectors: ['[class*="hero"]', '[data-testid*="hero"]', "main section:first-of-type", "main > div:first-of-type"],
        roleGuess: "hero",
      },
    ];

    for (const landmark of landmarks) {
      for (const selector of landmark.selectors) {
        const element = document.querySelector(selector);
        if (isVisible(element)) {
          push(element, landmark.roleGuess);
          break;
        }
      }
    }

    const structuralSections = collectVisible("main > section, main > div, section, article, aside", limit, element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 90;
    });

    for (const element of structuralSections) {
      const hasCta = collectVisible("button, a, [role='button']", 4, candidate => element.contains(candidate)).length > 0;
      push(element, hasCta ? "cta-section" : "section");
    }

    const repeatedContainers = collectVisible(
      "section, main > div, ul, ol, [class*='grid'], [class*='cards'], [class*='list'], [data-testid*='grid'], [data-testid*='card']",
      limit,
    );
    for (const container of repeatedContainers) {
      const children = Array.from(container.children).filter(child => isVisible(child));
      if (children.length < 2 || children.length > 16) continue;

      const signatureCounts = new Map();
      for (const child of children) {
        const signature = `${child.tagName.toLowerCase()}:${child.className || ""}`.trim();
        signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
      }

      const strongest = Math.max.apply(null, Array.from(signatureCounts.values()));
      if (!Number.isFinite(strongest) || strongest < 2) continue;

      const style = window.getComputedStyle(container);
      let roleGuess = "cards";
      if (style.display.includes("grid")) roleGuess = "grid";
      if (container.tagName.toLowerCase() === "ul" || container.tagName.toLowerCase() === "ol") roleGuess = "list";
      push(container, roleGuess);
    }

    return layoutBlocks.sort((a, b) => a.top - b.top).slice(0, limit);
  }

  function detectKeyElements(layoutBlocks) {
    const keyElements = {};
    function add(label, selectors, limit, predicate) {
      const elements = collectVisible(selectors, limit, predicate).map(toElementAudit);
      if (elements.length) keyElements[label] = elements;
    }

    add("body", "body", 1);
    add("header", "header, [role='banner']", 2);
    add("nav", "nav, [role='navigation']", 2);
    add("main", "main, [role='main']", 1);
    add("footer", "footer, [role='contentinfo']", 2);
    add("h1", "h1", 4);
    add("h2", "h2", 8);
    add("paragraphs", "p", 8);
    add("buttons", "button, input[type='button'], input[type='submit'], a[role='button']", 8);
    add("links", "a[href]", 8, element => normalizeText(element.innerText).length > 0);
    add("ctaButtons", "button, a, [role='button']", 8, element => {
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
      return CTA_TEXT_REGEX.test(text);
    });
    add("cards", "article, li, [class*='card'], [data-testid*='card']", 8);
    add("images", "img", 8);
    add("majorSections", "section, article, main > div", 8, element => {
      const box = element.getBoundingClientRect();
      return box.width >= 220 && box.height >= 120;
    });
    add("detectedLayoutBlocks", "section, article, main > div, header, footer, nav", Math.min(layoutBlocks.length, 10));

    return keyElements;
  }

  function detectTypography(maxTypographyNodes) {
    const typographyElements = collectVisible(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, a, button, span",
      maxTypographyNodes,
    );

    const fontFamilies = typographyElements.map(element => {
      const family = window.getComputedStyle(element).fontFamily.split(",")[0] || "";
      return family.replace(/["']/g, "").trim();
    });

    const headingSizes = typographyElements
      .filter(element => /^H[1-6]$/.test(element.tagName))
      .map(element => `${element.tagName.toLowerCase()}:${window.getComputedStyle(element).fontSize}`);

    const paragraphSizes = typographyElements
      .filter(element => ["P", "LI", "BLOCKQUOTE"].includes(element.tagName))
      .map(element => window.getComputedStyle(element).fontSize);

    const fontWeights = typographyElements.map(element => window.getComputedStyle(element).fontWeight);

    return {
      uniqueFontFamilies: Array.from(new Set(fontFamilies.filter(Boolean))).slice(0, 12),
      fontFamilyUsage: topN(fontFamilies, 8),
      commonHeadingSizes: topN(headingSizes, 8),
      commonParagraphSizes: topN(paragraphSizes, 8),
      fontWeightPatterns: topN(fontWeights, 8),
    };
  }

  function detectColors(maxColorNodes) {
    const colorElements = collectVisible(
      "body, header, nav, main, footer, section, article, div, p, a, button, h1, h2, h3",
      maxColorNodes,
    );

    const textColors = [];
    const backgroundColors = [];
    const buttonColors = [];
    const accentColors = [];
    const borderColors = [];

    for (const element of colorElements) {
      const style = window.getComputedStyle(element);
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
      const className = typeof element.className === "string" ? element.className : "";
      const isButtonLike =
        element.tagName === "BUTTON" ||
        element.getAttribute("role") === "button" ||
        className.toLowerCase().includes("btn") ||
        CTA_TEXT_REGEX.test(text);

      if (!isTransparent(style.color)) textColors.push(style.color);
      if (!isTransparent(style.backgroundColor)) backgroundColors.push(style.backgroundColor);
      if (!isTransparent(style.borderTopColor)) borderColors.push(style.borderTopColor);

      if (isButtonLike) {
        if (!isTransparent(style.backgroundColor)) buttonColors.push(style.backgroundColor);
        if (!isTransparent(style.color)) accentColors.push(style.color);
      } else if (element.tagName === "A" && !isTransparent(style.color)) {
        accentColors.push(style.color);
      }
    }

    return {
      text: topN(textColors, 8),
      backgrounds: topN(backgroundColors, 8),
      buttons: topN(buttonColors, 8),
      accents: topN(accentColors, 8),
      borders: topN(borderColors, 8),
    };
  }

  function detectMedia() {
    const imageElements = collectVisible("img", 24);
    const backgroundImageElements = collectVisible("*", 60, element => {
      const style = window.getComputedStyle(element);
      return style.backgroundImage && style.backgroundImage !== "none";
    });

    return {
      images: {
        count: document.querySelectorAll("img").length,
        lazyHints: document.querySelectorAll("img[loading='lazy'], img[data-src], img[data-lazy-src], [class*='lazy']").length,
        examples: imageElements.slice(0, 8).map(element => ({
          src: element.currentSrc || element.src || null,
          alt: element.alt || null,
          selectorHint: selectorHint(element),
          boundingBox: toBox(element),
        })),
      },
      backgroundImages: {
        count: backgroundImageElements.length,
        examples: backgroundImageElements.slice(0, 8).map(element => ({
          selectorHint: selectorHint(element),
          backgroundImage: window.getComputedStyle(element).backgroundImage,
        })),
      },
      svgCount: document.querySelectorAll("svg").length,
      videoCount: document.querySelectorAll("video").length,
      canvasCount: document.querySelectorAll("canvas").length,
      iframeCount: document.querySelectorAll("iframe").length,
      iconHintsCount:
        document.querySelectorAll("i, [class*='icon'], [data-icon]").length +
        Array.from(document.querySelectorAll("*")).filter(element =>
          ICON_CLASS_REGEX.test(typeof element.className === "string" ? element.className : ""),
        ).length,
    };
  }

  function detectPositioning() {
    const positionedElements = collectVisible("body *", 120, element => {
      const style = window.getComputedStyle(element);
      return style.position === "sticky" || style.position === "fixed";
    });

    return {
      stickyElements: positionedElements
        .filter(element => window.getComputedStyle(element).position === "sticky")
        .slice(0, 8)
        .map(toElementAudit),
      fixedElements: positionedElements
        .filter(element => window.getComputedStyle(element).position === "fixed")
        .slice(0, 8)
        .map(toElementAudit),
      overlayLikeElements: collectVisible("dialog, [role='dialog'], [aria-modal='true'], body *", 20, element => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const zIndex = Number.parseInt(style.zIndex || "0", 10);
        return style.position === "fixed" && zIndex >= 10 && box.width >= window.innerWidth * 0.35 && box.height >= window.innerHeight * 0.2;
      })
        .slice(0, 6)
        .map(toElementAudit),
      modalLikeElements: collectVisible("dialog, [role='dialog'], [aria-modal='true'], [class*='modal']", 6).map(
        toElementAudit,
      ),
      drawerLikeElements: collectVisible("[class*='drawer'], [class*='sidebar'], [class*='panel']", 6, element => {
        const style = window.getComputedStyle(element);
        return style.position === "fixed" || style.position === "sticky";
      }).map(toElementAudit),
    };
  }

  function detectMotionClues(maxMotionNodes) {
    const motionCandidates = collectVisible("body *", maxMotionNodes, element => {
      const style = window.getComputedStyle(element);
      const backdropFilter = style.getPropertyValue("backdrop-filter");
      return (
        style.transitionDuration !== "0s" ||
        style.animationName !== "none" ||
        style.transform !== "none" ||
        style.filter !== "none" ||
        backdropFilter !== "none" ||
        style.willChange !== "auto" ||
        Number(style.opacity) < 1
      );
    });

    return {
      transitionElements: motionCandidates.filter(element => window.getComputedStyle(element).transitionDuration !== "0s").length,
      animationElements: motionCandidates.filter(element => window.getComputedStyle(element).animationName !== "none").length,
      transformElements: motionCandidates.filter(element => window.getComputedStyle(element).transform !== "none").length,
      opacityVariantElements: motionCandidates.filter(element => Number(window.getComputedStyle(element).opacity) < 1).length,
      willChangeElements: motionCandidates.filter(element => window.getComputedStyle(element).willChange !== "auto").length,
      filterElements: motionCandidates.filter(element => window.getComputedStyle(element).filter !== "none").length,
      backdropFilterElements: motionCandidates.filter(
        element => window.getComputedStyle(element).getPropertyValue("backdrop-filter") !== "none",
      ).length,
      samples: motionCandidates.slice(0, 10).map(toElementAudit),
    };
  }

  function detectVisualHierarchy(layoutBlocks, media) {
    const headingCandidates = collectVisible("h1, h2, h3", 20);
    const dominantHeading =
      headingCandidates
        .map(element => ({
          element,
          fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize || "0"),
          top: element.getBoundingClientRect().top,
        }))
        .sort((a, b) => b.fontSize - a.fontSize || a.top - b.top)[0]?.element || null;

    const ctaCandidates = collectVisible("button, a, [role='button']", 30, element => {
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
      return CTA_TEXT_REGEX.test(text);
    });
    const primaryCta =
      ctaCandidates
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { element, score: rect.width * rect.height + (rect.top < window.innerHeight ? 5000 : 0) };
        })
        .sort((a, b) => b.score - a.score)[0]?.element || null;

    const aboveFoldHeadingCount = headingCandidates.filter(element => element.getBoundingClientRect().top < window.innerHeight).length;
    const aboveFoldButtonCount = collectVisible("button, a, [role='button']", 60).filter(
      element => element.getBoundingClientRect().top < window.innerHeight,
    ).length;
    const aboveFoldParagraphCount = collectVisible("p", 80).filter(
      element => element.getBoundingClientRect().top < window.innerHeight,
    ).length;
    const aboveFoldMediaCount = collectVisible("img, video, canvas, svg", 80).filter(
      element => element.getBoundingClientRect().top < window.innerHeight,
    ).length;

    let firstViewportProfile = "balanced";
    if (aboveFoldButtonCount >= 3 && aboveFoldParagraphCount <= 2) {
      firstViewportProfile = "cta-heavy";
    } else if (aboveFoldParagraphCount >= 4 || aboveFoldMediaCount >= 3) {
      firstViewportProfile = "content-heavy";
    } else if (collectVisible("nav a, header a", 40).length >= 8 && aboveFoldButtonCount <= 1) {
      firstViewportProfile = "navigation-heavy";
    }

    let emphasis = "mixed";
    if (aboveFoldMediaCount >= 3 && aboveFoldButtonCount >= 2) {
      emphasis = "product";
    } else if (aboveFoldParagraphCount >= 3 || layoutBlocks.filter(block => block.roleGuess === "section").length >= 3) {
      emphasis = "content";
    } else if (collectVisible("nav a, header a", 60).length >= 10) {
      emphasis = "navigation";
    }

    return {
      dominantHeadingBlock: dominantHeading ? toElementAudit(dominantHeading) : null,
      primaryCta: primaryCta ? toElementAudit(primaryCta) : null,
      visibleMajorSections: layoutBlocks.filter(block => ["hero", "section", "cta-section", "cards", "grid", "list"].includes(block.roleGuess)).length,
      aboveFoldHeadingCount,
      aboveFoldButtonCount,
      aboveFoldParagraphCount,
      aboveFoldMediaCount,
      firstViewportProfile,
      emphasis,
    };
  }

  function collectVisualSystemSignals() {
    const spacingValues = [];
    const containerWidths = [];
    const radiusValues = [];
    const shadowValues = [];
    const buttonPatterns = [];
    const typographyScale = [];

    const spacingNodes = collectVisible(SPACING_SELECTORS, 180);
    for (const element of spacingNodes) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      const spacingCandidates = [
        style.marginTop,
        style.marginBottom,
        style.paddingTop,
        style.paddingBottom,
        style.gap,
      ];

      for (const candidate of spacingCandidates) {
        if (!candidate || candidate === "0px" || candidate === "normal") continue;
        spacingValues.push(candidate);
      }

      if (rect.width >= window.innerWidth * 0.4) {
        containerWidths.push(`${Math.round(rect.width)}px`);
      }

      if (style.borderRadius && style.borderRadius !== "0px") {
        radiusValues.push(style.borderRadius);
      }

      if (style.boxShadow && style.boxShadow !== "none") {
        shadowValues.push(style.boxShadow);
      }

      if (["BUTTON", "A"].includes(element.tagName)) {
        const label = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
        if (label && (element.tagName === "BUTTON" || CTA_TEXT_REGEX.test(label))) {
          buttonPatterns.push(
            [
              style.backgroundColor,
              style.color,
              style.borderRadius,
              style.padding,
              style.boxShadow,
              style.fontWeight,
            ].join(" | "),
          );
        }
      }
    }

    const typographyNodes = collectVisible("h1, h2, h3, h4, p, li, button, a", 120);
    for (const element of typographyNodes) {
      const style = window.getComputedStyle(element);
      typographyScale.push(`${style.fontSize}/${style.lineHeight}/${style.fontWeight}`);
    }

    const paragraphs = collectVisible("p, li, blockquote", 120);
    const averageParagraphChars =
      paragraphs.length > 0
        ? paragraphs.reduce((sum, element) => sum + normalizeText(element.innerText).length, 0) / paragraphs.length
        : 0;
    const averageSectionHeight = spacingNodes.length > 0
      ? spacingNodes.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0) / spacingNodes.length
      : 0;

    let visualDensity = "balanced";
    if (averageParagraphChars >= 150 || averageSectionHeight < 120) {
      visualDensity = "dense";
    } else if (averageSectionHeight >= 240 && averageParagraphChars < 110) {
      visualDensity = "whitespace-heavy";
    }

    return {
      spacingScale: topN(spacingValues, 10),
      containerWidths: topN(containerWidths, 8),
      borderRadiusPatterns: topN(radiusValues, 8),
      shadowPatterns: topN(shadowValues, 8),
      buttonStylePatterns: topN(buttonPatterns, 6).map(item => ({
        signature: item.value,
        count: item.count,
      })),
      typographyScale: topN(typographyScale, 10),
      visualDensity,
    };
  }

  function dismissCommonPopups(args) {
    const selectorList = args && args.selectorList ? args.selectorList : "";
    const keywordList = args && Array.isArray(args.keywordList) ? args.keywordList : [];
    const candidates = Array.from(document.querySelectorAll(selectorList));

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const label = normalizeText(
        candidate.textContent ||
          candidate.getAttribute("aria-label") ||
          candidate.value ||
          "",
      ).toLowerCase();
      if (!label) continue;
      if (!keywordList.some(keyword => label.includes(keyword))) continue;
      candidate.click();
      return label;
    }

    return null;
  }

  function detectObstructions() {
    const results = [];
    for (const element of document.querySelectorAll("body *")) {
      if (!isVisible(element)) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!["fixed", "sticky"].includes(style.position) && !element.matches("dialog, [role='dialog'], [aria-modal='true']")) {
        continue;
      }

      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      const blockingLikely = elementArea >= viewportArea * 0.12 || element.matches("dialog, [role='dialog'], [aria-modal='true']");
      if (!blockingLikely && style.position !== "fixed") continue;

      const text = normalizeText(element.innerText || element.textContent || "");
      const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
      let type = "unknown";
      if (/cookie|consent|privacy/.test(text.toLowerCase()) || /cookie|consent/.test(className)) type = "cookie-banner";
      else if (element.matches("dialog, [role='dialog'], [aria-modal='true']") || /modal/.test(className)) type = "modal";
      else if (/banner/.test(className)) type = "fixed-banner";
      else if (/overlay|backdrop/.test(className)) type = "overlay";

      results.push({
        type,
        selectorHint: selectorHint(element),
        textSnippet: text.slice(0, 160),
        blockingLikely,
        boundingBox: toBox(element),
      });

      if (results.length >= 8) break;
    }

    return results;
  }

  window.__VISUAL_AUDIT_RUNTIME__ = {
    createVisualAuditSnapshot(options) {
      const maxLayoutBlocks = Math.max(8, Math.min(Number(options?.maxLayoutBlocks) || 24, 40));
      const maxTypographyNodes = Math.max(80, Math.min(Number(options?.maxTypographyNodes) || 220, 320));
      const maxColorNodes = Math.max(80, Math.min(Number(options?.maxColorNodes) || 260, 360));
      const maxMotionNodes = Math.max(80, Math.min(Number(options?.maxMotionNodes) || 240, 320));

      const layoutBlocks = detectLayoutBlocks(maxLayoutBlocks);
      const media = detectMedia();
      return {
        layoutBlocks,
        keyElements: detectKeyElements(layoutBlocks),
        typography: detectTypography(maxTypographyNodes),
        colors: detectColors(maxColorNodes),
        media,
        positioning: detectPositioning(),
        motionClues: detectMotionClues(maxMotionNodes),
        visualHierarchy: detectVisualHierarchy(layoutBlocks, media),
        visualSystem: collectVisualSystemSignals(),
      };
    },
    dismissCommonPopups,
    detectObstructions,
  };
})();
