(() => {
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
    /\b(create|start|get started|try|book|contact|buy|shop|learn|view|browse|share|download|sign up|join|discover|stw[oó]rz|zacznij|sprawd[zź]|zobacz|udost[ęe]pnij|wybierz|polub)\b/i;
  const ICON_CLASS_REGEX = /\b(icon|lucide|heroicon|fa-|material-icons|ph-|tabler-|ri-)\b/i;

  function round(value) {
    return Number(value.toFixed(1));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isTransparent(value) {
    return !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
  }

  function selectorHint(element) {
    if (element.id) return `#${element.id}`;

    const classes = Array.from(element.classList).slice(0, 3);
    if (classes.length) {
      return `${element.tagName.toLowerCase()}.${classes.join(".")}`;
    }

    const role = element.getAttribute("role");
    if (role) return `${element.tagName.toLowerCase()}[role="${role}"]`;

    const dataTestId = element.getAttribute("data-testid");
    if (dataTestId) return `${element.tagName.toLowerCase()}[data-testid="${dataTestId}"]`;

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

  function topN(values, limit = 8) {
    const counts = new Map();
    for (const value of values) {
      const clean = normalizeText(value);
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  }

  function collectVisible(selectors, limit, predicate) {
    const values = [];
    const seen = new Set();

    for (const element of document.querySelectorAll(selectors)) {
      if (!isVisible(element)) continue;
      if (predicate && !predicate(element)) continue;
      if (seen.has(element)) continue;
      seen.add(element);
      values.push(element);
      if (values.length >= limit) break;
    }

    return values;
  }

  const layoutBlocks = [];
  const layoutSeen = new Set();
  function pushLayoutBlock(element, roleGuess) {
    if (!isVisible(element) || layoutSeen.has(element)) return;
    layoutSeen.add(element);

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

  const landmarkSelectors = [
    { selectors: ["header", '[role="banner"]'], roleGuess: "header" },
    { selectors: ["nav", '[role="navigation"]'], roleGuess: "nav" },
    { selectors: ["main", '[role="main"]'], roleGuess: "main" },
    { selectors: ["footer", '[role="contentinfo"]'], roleGuess: "footer" },
    {
      selectors: ['[class*="hero"]', '[data-testid*="hero"]', "main section:first-of-type", "main > div:first-of-type"],
      roleGuess: "hero",
    },
  ];

  for (const landmark of landmarkSelectors) {
    for (const selector of landmark.selectors) {
      const element = document.querySelector(selector);
      if (isVisible(element)) {
        pushLayoutBlock(element, landmark.roleGuess);
        break;
      }
    }
  }

  const sectionCandidates = collectVisible("main > section, main > div, section, article, aside", 20, element => {
    const box = element.getBoundingClientRect();
    return box.height >= 100 && box.width >= 220;
  });
  for (const element of sectionCandidates) {
    const hasCta = collectVisible("button, a, [role='button']", 4, candidate => element.contains(candidate)).length > 0;
    pushLayoutBlock(element, hasCta ? "cta-section" : "section");
  }

  const repeatedContainers = collectVisible(
    "section, main > div, ul, ol, [class*='grid'], [class*='cards'], [class*='list']",
    16,
  );
  for (const container of repeatedContainers) {
    const visibleChildren = Array.from(container.children).filter(child => isVisible(child));
    if (visibleChildren.length < 2 || visibleChildren.length > 14) continue;

    const signatureCounts = new Map();
    for (const child of visibleChildren) {
      const signature = `${child.tagName.toLowerCase()}:${child.className || ""}`.trim();
      signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    }

    const strongest = Math.max(...signatureCounts.values());
    if (strongest < 2) continue;

    const display = window.getComputedStyle(container).display;
    let roleGuess = "cards";
    if (display.includes("grid")) roleGuess = "grid";
    if (container.tagName.toLowerCase() === "ul" || container.tagName.toLowerCase() === "ol") roleGuess = "list";
    pushLayoutBlock(container, roleGuess);
  }

  layoutBlocks.sort((a, b) => a.top - b.top);

  const keyElements = {};
  function addKeyElements(label, selectors, limit, predicate) {
    const elements = collectVisible(selectors, limit, predicate).map(toElementAudit);
    if (elements.length) {
      keyElements[label] = elements;
    }
  }

  addKeyElements("body", "body", 1);
  addKeyElements("header", "header, [role='banner']", 2);
  addKeyElements("nav", "nav, [role='navigation']", 2);
  addKeyElements("main", "main, [role='main']", 1);
  addKeyElements("footer", "footer, [role='contentinfo']", 2);
  addKeyElements("h1", "h1", 3);
  addKeyElements("h2", "h2", 6);
  addKeyElements("paragraphs", "p", 8);
  addKeyElements("buttons", "button, input[type='button'], input[type='submit'], a[role='button']", 8);
  addKeyElements("links", "a[href]", 8, element => normalizeText(element.innerText).length > 0);
  addKeyElements("ctaButtons", "button, a, [role='button']", 6, element => {
    const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
    return CTA_TEXT_REGEX.test(text);
  });
  addKeyElements("cards", "article, li, [class*='card'], [data-testid*='card']", 8);
  addKeyElements("images", "img", 8);
  addKeyElements("majorSections", "section, article, main > div", 8, element => {
    const box = element.getBoundingClientRect();
    return box.width >= 220 && box.height >= 120;
  });

  const typographyElements = collectVisible("h1, h2, h3, h4, h5, h6, p, li, blockquote, a, button, span", 220);
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

  const colorElements = collectVisible(
    "body, header, nav, main, footer, section, article, div, p, a, button, h1, h2, h3",
    260,
  );
  const textColors = [];
  const backgroundColors = [];
  const buttonColors = [];
  const accentColors = [];
  const borderColors = [];

  for (const element of colorElements) {
    const style = window.getComputedStyle(element);
    if (!isTransparent(style.color)) textColors.push(style.color);
    if (!isTransparent(style.backgroundColor)) backgroundColors.push(style.backgroundColor);
    if (!isTransparent(style.borderTopColor)) borderColors.push(style.borderTopColor);

    const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
    const className = typeof element.className === "string" ? element.className : "";
    const isButtonLike =
      element.tagName === "BUTTON" ||
      element.getAttribute("role") === "button" ||
      className.toLowerCase().includes("btn") ||
      CTA_TEXT_REGEX.test(text);

    if (isButtonLike) {
      if (!isTransparent(style.backgroundColor)) buttonColors.push(style.backgroundColor);
      if (!isTransparent(style.color)) accentColors.push(style.color);
    } else if (element.tagName === "A" && !isTransparent(style.color)) {
      accentColors.push(style.color);
    }
  }

  const imageElements = collectVisible("img", 24);
  const backgroundImageElements = collectVisible("*", 60, element => {
    const style = window.getComputedStyle(element);
    return style.backgroundImage && style.backgroundImage !== "none";
  });

  const media = {
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

  const positionedElements = collectVisible("body *", 120, element => {
    const style = window.getComputedStyle(element);
    return style.position === "sticky" || style.position === "fixed";
  });

  const positioning = {
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

  const motionCandidates = collectVisible("body *", 240, element => {
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

  const motionClues = {
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
    layoutBlocks: layoutBlocks.slice(0, 24),
    keyElements,
    typography: {
      uniqueFontFamilies: Array.from(new Set(fontFamilies.filter(Boolean))).slice(0, 12),
      fontFamilyUsage: topN(fontFamilies),
      commonHeadingSizes: topN(headingSizes),
      commonParagraphSizes: topN(paragraphSizes),
      fontWeightPatterns: topN(fontWeights),
    },
    colors: {
      text: topN(textColors),
      backgrounds: topN(backgroundColors),
      buttons: topN(buttonColors),
      accents: topN(accentColors),
      borders: topN(borderColors),
    },
    media,
    positioning,
    motionClues,
    visualHierarchy: {
      dominantHeadingBlock: dominantHeading ? toElementAudit(dominantHeading) : null,
      primaryCta: primaryCta ? toElementAudit(primaryCta) : null,
      visibleMajorSections: layoutBlocks.filter(block => ["hero", "section", "cta-section", "cards", "grid", "list"].includes(block.roleGuess)).length,
      aboveFoldHeadingCount,
      aboveFoldButtonCount,
      aboveFoldParagraphCount,
      aboveFoldMediaCount,
      firstViewportProfile,
      emphasis,
    },
  };
})()
