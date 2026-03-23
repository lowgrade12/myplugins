"use strict";

const CONFIG = {};
const CARDS = {};
const CRITERIA = { tag: "t", rating: "r", disabled: "d" };
// Custom CSS style presets for hot cards.
const STYLES = {
  default: getDefaultStylePreset(),
  hot: getHotStylePreset(),
  bronze: getBronzeStylePreset(),
  silver: getSilverStylePreset(),
  gold: getGoldStylePreset(),
  holo: getHoloStylePreset(),
};
/**
 * URL regex patterns for each card type.
 * Maps card type keys to the routes where that card type should be processed.
 */
const CARD_PATTERNS = {
  gallery: /^\/(galleries|(performers|studios|tags)\/\d+\/galleries)$/,
  image: /^\/(images|(performers|studios|tags)\/\d+\/images|galleries\/\d+)$/,
  group: /^\/(groups|(groups\/\d+\/subgroups)|(performers|studios|tags)\/\d+\/groups)$/,
  performer: /^\/(performers(?:\/\d+\/appearswith)?|(performers|studios|tags)\/\d+\/performers)$/,
  scene: /^\/(scenes|(performers|studios|tags|groups)\/\d+\/scenes|(groups|galleries)\/\d+)$/,
  studio: /^\/(studios|(studios\/\d+\/childstudios)|(tags\/\d+\/studios))$/,
};
// Element to inject custom CSS styles.
const STYLE_ELEMENT = document.createElement("style");
document.head.appendChild(STYLE_ELEMENT);

// Backup card elements
let backupCardElements = [];
// Current hot card elements
let hotCardElements = [];
// Current hot card classes
let hotCardClasses = [];
// Home page observer for detecting late-loading recommendation rows
let homeObserver = null;
let homeDebounceTimer = null;
let homeDisconnectTimer = null;
// Backup img elements for holo cards
let backupImgElements = [];
// Current holo elements
let holoElements = [];

async function hotCardsSetup() {
  await setConfiguration();

  // Handle home hot cards separately
  if (CONFIG.settings.home && CONFIG.is.tagOrRatingBased) handleHomeHotCards();

  for (const [key, card] of Object.entries(CARDS)) {
    if (card.enabled && CARD_PATTERNS[key] && CONFIG.is.tagOrRatingBased) {
      registerPathChangeListener(CARD_PATTERNS[key], () => {
        handleHotCards(card.type);
      });
    }
  }

  /**
   * Since it was necessary to insert a div before the card for
   * the border design to be visible (otherwise the overflow:hidden; property of
   * the .card class does not allow it to be seen), this also brought up another problem:
   *
   * "DOMException: Node.removeChild: The node to be removed is not a child of this node".
   *
   * Because of how the internal content of some divs are updated when navigating.
   *
   * This restores the card back to the original DOM structure to prevent that.
   */
  function restoreCards() {
    cleanupHomeObserver();
    backupCardElements.forEach((backupCard, i) => {
      if (hotCardElements[i] && hotCardElements[i].parentNode) {
        hotCardElements[i].before(backupCard);
        hotCardElements[i].remove();
      }
    });
    backupImgElements.forEach((backupImg, i) => {
      if (holoElements[i] && holoElements[i].parentNode) {
        holoElements[i].before(backupImg);
        holoElements[i].remove();
      }
    });
    backupCardElements.length = 0;
    hotCardElements.length = 0;
    backupImgElements.length = 0;
    holoElements.length = 0;
  }

  onPathChange(restoreCards);
}

/**
 * Add hot cards to the home page.
 *
 * Uses a MutationObserver on the document body to detect recommendation rows
 * and cards as they load asynchronously. Processes each card type's unprocessed
 * cards with debouncing to handle rows that appear at different times.
 */
function handleHomeHotCards() {
  const pattern = /^\/$/;
  registerPathChangeListener(pattern, () => {
    setupHomePageObserver();
  });
}

function cleanupHomeObserver() {
  if (homeObserver) {
    homeObserver.disconnect();
    homeObserver = null;
  }
  clearTimeout(homeDebounceTimer);
  homeDebounceTimer = null;
  clearTimeout(homeDisconnectTimer);
  homeDisconnectTimer = null;
}

/**
 * Process all enabled card types on the home page.
 * Only triggers handleHotCards for types that have unprocessed cards
 * (cards not yet wrapped with the hot-border class).
 */
function processHomeCards() {
  Object.values(CARD_KEYS).forEach((type) => {
    if (!CARDS[type].enabled) return;
    const cardClass = CARDS[type].class;
    const hasUnprocessedCards = document.querySelector(
      `.recommendation-row .${cardClass}:not(.hot-border)`
    );
    if (hasUnprocessedCards) {
      handleHotCards(type, true);
    }
  });
}

function setupHomePageObserver() {
  cleanupHomeObserver();

  homeObserver = new MutationObserver(() => {
    clearTimeout(homeDebounceTimer);
    homeDebounceTimer = setTimeout(processHomeCards, 250);
  });

  homeObserver.observe(document.body, { childList: true, subtree: true });

  // Initial processing for cards already in the DOM
  processHomeCards();

  // Auto-disconnect after 30 seconds to avoid indefinite observation
  homeDisconnectTimer = setTimeout(() => cleanupHomeObserver(), 30000);
}

function handleHotCards(type, isHome = false) {
  const card = CARDS[type];
  waitForClass(card.class, () => {
    createAndInsertHotCards(card.data, card.class, card.config, isHome);
    setHotCardStyling(card);
  });
}

/**
 * Wraps cards in "hot" elements based on specific conditions (tag or rating).
 *
 * On the home page, multiple GraphQL requests are intercepted,
 * each corresponding to a premade filter / user saved filter.
 *
 * This function is called for each card type enabled to add hot elements.
 *
 * The first time it runs, the hotCards array is populated,
 * so we need an additional flag to differentiate that we are on the home page.
 *
 * @param {Object} stashData - Data fetched from the GraphQL interceptor. e.g. stash.performers.
 * @param {string} cardClass - CSS class used to identify cards in the DOM. e.g. 'performer-card'.
 * @param {Object} config - User settings for the current card type.
 * @param {boolean} isHome - Flag indicating if the current page is the homepage.
 */
function createAndInsertHotCards(stashData, cardClass, config, isHome) {
  // Defensive check: ensure config is a valid object with expected properties
  if (!config || typeof config !== 'object') {
    console.warn('hotCards: Invalid config provided to createAndInsertHotCards. Expected config to be a valid object with value array property.');
    return;
  }

  const { criterion, value, style, card_opts } = config;

  // FIX: Add defensive check for undefined value to prevent "Cannot read properties of undefined (reading 'length')"
  // The value property should be an array of tag IDs or rating thresholds from the plugin settings
  if (!value || !Array.isArray(value)) {
    console.warn('hotCards: config.value is undefined or not an array, skipping card processing. Expected an array like ["tagId1"] or ["4", "5"]. Check your plugin settings.');
    return;
  }

  const cards = document.querySelectorAll(`.${cardClass}`);
  const isCriterionTagOrEmpty =
    CONFIG.is.tagBased &&
    (criterion === CRITERIA.tag || !criterion);
  const isCriterionRatingOrEmpty =
    CONFIG.is.ratingBased &&
    (criterion === CRITERIA.rating || !criterion);

  cards.forEach((card) => {
    // Skip cards that are already wrapped in a hot card element
    if (card.classList.contains("hot-border")) return;

    // FIX: Some card layouts may not have a thumbnail-section link element,
    // skip processing for cards without proper structure
    const link = card.querySelector(".thumbnail-section > a");
    if (!link) return;

    const id = new URL(link.href).pathname.split("/").pop();
    const data = stashData[id];

    if (!data) return;

    const segmentParams = findMatchingValueSegment(
      value,
      data.tags,
      data.rating100,
      isCriterionTagOrEmpty,
      isCriterionRatingOrEmpty,
      style,
      card_opts
    );

    if (segmentParams) {
      const classId = segmentParams.value.join("-").replace(/[.\s]/g, "-");
      const hotCardEl = createHotElementAndAttachToDOM(
        card,
        cardClass,
        classId,
        isHome
      );
      checkHoloCardAndAttachToDOM(
        hotCardEl,
        cardClass,
        segmentParams.style,
        segmentParams.cardOptions
      );
    }
  });
}

function findMatchingValueSegment(
  value,
  tags,
  rating,
  isCriterionTagOrEmpty,
  isCriterionRatingOrEmpty,
  style,
  cardOptions
) {
  // FIX: Additional defensive check for value array
  if (!value || !Array.isArray(value) || value.length === 0) {
    return null;
  }

  for (let i = 0; i < value.length; i++) {
    const segment = value[i];
    const valueNotSet = segment.length === 0;
    const segmentOrValue = Array.isArray(segment) ? segment : value;

    if (
      (isCriterionTagOrEmpty &&
        matchesTagCriterion(tags, segmentOrValue, valueNotSet)) ||
      (isCriterionRatingOrEmpty &&
        matchesRatingCriterion(rating, segmentOrValue, valueNotSet))
    ) {
      const v = segmentOrValue || [""];
      const s = style[i] || style[0];
      const co = cardOptions[i] || cardOptions[0];
      return { value: v, style: s, cardOptions: co };
    }

    if (segmentOrValue === value) break;
  }
  return null;
}

function matchesTagCriterion(tags, valueSegment, valueNotSet) {
  if (!tags) return false;

  const tagIds = valueNotSet ? [CONFIG.tagId] : valueSegment;
  return tagIds.every((tagId) =>
    tags.some((t) => t.id === tagId || t.name === tagId)
  );
}

function matchesRatingCriterion(rating, valueSegment, valueNotSet) {
  if (!rating) return false;

  const isStarsRatingSystem = CONFIG.ratingThreshold <= 5;
  const parsedRating = isStarsRatingSystem ? rating / 20 : rating;
  const ratingThresholds = valueNotSet
    ? [CONFIG.ratingThreshold]
    : valueSegment;
  return ratingThresholds.length > 1
    ? ratingThresholds.includes(parsedRating.toString())
    : parsedRating >= ratingThresholds[0];
}

function createHotElementAndAttachToDOM(
  cardElement,
  className,
  classId,
  isHome
) {
  const hotCardClassName = `hot-${className}-${classId}`;
  const hotElement = createElementFromHTML(
    `<div class="hot-card ${hotCardClassName}"></div>`
  );
  if (isHome) hotElement.style.height = "100%";

  backupCardElements.push(cardElement);
  cardElement.style.removeProperty("box-shadow");
  cardElement.classList.add("hot-border");
  cardElement.before(hotElement);
  hotElement.append(cardElement);
  hotCardElements.push(hotElement);

  return hotElement;
}

/**
 * Sets the style of the hot card based on the user's configuration.
 */
function setHotCardStyling(card) {
  const { value, style, gradient_opts, hover_opts, card_opts } = card.config;

  // FIX: Add defensive check for value array
  // The value property should be an array from the parsed plugin settings
  if (!value || !Array.isArray(value)) {
    console.warn('hotCards: card.config.value is undefined or not an array in setHotCardStyling. Check your plugin settings configuration.');
    return;
  }

  const hotElement = document.querySelector(".hot-card");
  // Check if the hot card already contains all the necessary classes
  const hotCardContainsAllClasses = hotCardClasses.every((hotCardClass) =>
    hotElement?.classList.contains(hotCardClass)
  );

  if (hotCardClasses.length === 0 || !hotCardContainsAllClasses) {
    const pseudoElementStyles = value.map((segment, index) => {
      const segmentOrValue = Array.isArray(segment) ? segment : value;
      const classId = segmentOrValue.join("-").replace(/[.\s]/g, "-");
      const hotCardClass = `.hot-${card.class}-${classId}`;

      // Skip if the hot card class is already present
      if (hotCardClasses.includes(hotCardClass)) return;

      hotCardClasses.push(hotCardClass);
      const currentStyle = Array.isArray(style[index]) ? style[index] : style;
      const gradientOptions = gradient_opts[index] || gradient_opts[0];
      const hoverOptions = hover_opts[index] || hover_opts[0];
      const cardOptions = card_opts[index] || card_opts[0];

      // If there is only a single style, get the single color style
      if (style.length === 1 || style[index].length === 1) {
        return getSingleColorStyle(
          hotCardClass,
          style[index] || style[0],
          gradientOptions,
          hoverOptions,
          cardOptions
        );
      }

      return getCustomGradientStyle(
        hotCardClass,
        currentStyle,
        gradientOptions,
        hoverOptions,
        cardOptions
      );
    });

    // Join pseudo styles to the style element
    STYLE_ELEMENT.innerHTML += pseudoElementStyles.join("");
  }
}

/**
 * Apply a single color style, which can be a style preset or a fixed color.
 */
function getSingleColorStyle(
  hotCardClass,
  color,
  gradientOptions,
  hoverOptions,
  cardOptions
) {
  return STYLES[color]
    ? getPresetStyle(
        hotCardClass,
        STYLES[color],
        gradientOptions,
        hoverOptions,
        cardOptions
      )
    : /**
       * Get a fixed color style.
       */
      getHotCardPseudoElementString(
        hotCardClass,
        color,
        hoverOptions,
        cardOptions
      );
}

/**
 * Apply a style preset.
 */
function getPresetStyle(
  hotCardClass,
  preset,
  gradientOptions,
  hoverOptions,
  cardOptions
) {
  const { gradient, hover, card } = preset;
  const { angle, animation } = gradientOptions;
  const { color: hoverColor, animation: hoverAnimation } = hoverOptions;

  // Update gradient options with preset defaults if not provided
  const updatedGradientOpts = {
    type: gradient.type,
    angle: angle !== DEFAULTS.gradient_opts.angle ? angle : gradient.angle,
    animation: animation || gradient.animation,
  };

  // Update hover options with preset defaults if not provided
  const updatedHoverOpts = {
    color: hoverColor !== DEFAULTS.hover_opts.color ? hoverColor : hover.color,
    animation: hoverAnimation || hover.animation,
  };

  // Update card options with preset defaults if not provided
  const updatedCardOpts = {
    fill:
      cardOptions.fill !== DEFAULTS.card_opts.fill
        ? cardOptions.fill
        : card.fill,
    opacity:
      cardOptions.opacity !== DEFAULTS.card_opts.opacity
        ? cardOptions.opacity
        : card.opacity,
    additional: card.additional,
  };

  return getCustomGradientStyle(
    hotCardClass,
    gradient.colors,
    updatedGradientOpts,
    updatedHoverOpts,
    updatedCardOpts
  );
}

/**
 * If there are more than one color, it's a custom gradient.
 */
function getCustomGradientStyle(
  hotCardClass,
  colors,
  gradientOptions,
  hoverOptions,
  cardOptions
) {
  const { type, angle, animation } = gradientOptions;
  const gradient = getGradient(type, angle, colors);
  return getHotCardPseudoElementString(
    hotCardClass,
    gradient,
    hoverOptions,
    cardOptions,
    animation
  );
}

function getGradient(type, positionAngle = "", colors) {
  const positionAngleStr = positionAngle ? `${positionAngle},` : "";
  if (type === "stacked") return colors.join(", ");
  return `${type}-gradient(${positionAngleStr} ${colors.join(", ")})`;
}

function getHotCardPseudoElementString(
  hotCardClass,
  background,
  hoverOptions,
  cardOptions,
  gradientAnimation = "",
  filter = ""
) {
  const opacity = getFixedBackgroundOpacity(cardOptions.opacity);
  const fill = /true/i.test(cardOptions.fill);
  const gradientAnimationStr =
    gradientAnimation === "none"
      ? "animation: none;"
      : `animation: move ${gradientAnimation};`;
  const hoverAnimationStr =
    hoverOptions.animation === "none"
      ? `box-shadow: none; animation: none;`
      : `animation: pulse ${hoverOptions.animation};`;
  const additionalAttrStr = cardOptions.additional || "";
  const fillStr = fill
    ? `background-color: rgba(0, 0, 0, ${opacity}) !important;`
    : "box-shadow: none;";
  const filterStr = filter ? `filter: ${filter};` : "";

  return `${hotCardClass}::before,
    ${hotCardClass}::after {
      content: "";
      position: absolute;
      top: calc(0.8 * var(--border-width));
      left: calc(0.8 * var(--border-width));
      width: calc(100% + var(--border-width) * -1.5);
      height: calc(100% + var(--border-width) * -1.5);
      border-radius: calc(2 * var(--border-width));
      background: ${background};
      background-size: 300% 300%;
      background-position: 0 50%;
      ${gradientAnimationStr}
      ${additionalAttrStr}
    }
    ${hotCardClass} > .hot-border {
      --hover-color: ${hoverOptions.color};
      ${hoverAnimationStr}
      ${fillStr}
    }
    ${hotCardClass}::after {
      ${filterStr}
    }`;
}

function checkHoloCardAndAttachToDOM(hotCardEl, cardClass, style, cardOptions) {
  if (style !== "holo") return;

  const animateCard = /true/i.test(cardOptions.animate);
  const cardClasses = ["image-card", "scene-card", "studio-card"];
  const classInArray = cardClasses.includes(cardClass);
  const isStudioCard = cardClass === "studio-card";
  const isImageOrSceneCard = classInArray && !isStudioCard;
  const classSuffix = isImageOrSceneCard ? "preview-image" : "image";
  const imgClass = `.${cardClass}-${classSuffix}`;
  const targetEl = hotCardEl.querySelector(imgClass);

  if (!targetEl) return;

  const holoEl = createElementFromHTML(`<div class="holo"></div>`);
  const shineEl = createElementFromHTML(`<div class="shine"></div>`);
  const seedX = getRandomInt(100);
  const seedY = getRandomInt(100);

  const calculateAspectRatio = (width, height) => width / height;
  const calculateDegrees = (aspectRatio, degreesOffset) =>
    degreesOffset + Math.atan(aspectRatio) * (180 / Math.PI);
  const setFixedAspectRatio = (el, aspectRatio) => {
    el.style.setProperty("aspect-ratio", aspectRatio.toFixed(3));
  };
  const applyInitialStyles = () => {
    if (isStudioCard) {
      holoEl.style.display = "block";
      shineEl.style.position = "absolute";
      shineEl.style.top = "0px";
      shineEl.style.left = "0px";
    }
    holoEl.style.setProperty("--posx", `${seedX}%`);
    holoEl.style.setProperty("--posy", `${seedY}%`);
  };

  backupImgElements.push(targetEl);
  targetEl.classList.add("holo-img");
  targetEl.before(holoEl);
  holoEl.append(targetEl);
  holoEl.append(shineEl);
  holoElements.push(holoEl);
  applyInitialStyles();

  waitForImageLoad(targetEl, () => {
    const hotBorderEl = hotCardEl.querySelector(".hot-border");

    if (!hotBorderEl) return;

    const studioCardMarginSize = 5;
    const isSceneCard = cardClass === "scene-card";
    const degreesOffset = isStudioCard ? 98 : isSceneCard ? 83 : 97;
    let aspectRatio = 0;
    let degrees = 0;

    // Delay to ensure the resizing of the width for the cardClass element / hotBorderEl has been completed
    setTimeout(() => {
      if (isStudioCard) {
        aspectRatio = calculateAspectRatio(
          hotBorderEl.offsetWidth - studioCardMarginSize,
          hotBorderEl.offsetHeight - studioCardMarginSize
        );
        degrees = Math.floor(calculateDegrees(aspectRatio, degreesOffset));
      } else {
        aspectRatio = calculateAspectRatio(
          hotBorderEl.offsetWidth,
          targetEl.offsetHeight
        );
        degrees = Math.round(calculateDegrees(aspectRatio, degreesOffset));
      }

      holoEl.style.setProperty("--angle", `${degrees}deg`);
      setFixedAspectRatio(shineEl, aspectRatio);
    }, 100);
  });

  if (animateCard) animateHoloCards(holoEl, seedX, seedY);
}

function animateHoloCards(holoEl, seedX, seedY) {
  const increment = 0.05;
  let posX = seedX;
  let posY = seedY;
  let add = increment;

  function animate() {
    // Stop animation loop if the element has been removed from the DOM
    if (!document.contains(holoEl)) return;
    posX += add;
    posY += add;

    if (posX > 100) add = -increment;
    if (posY > 100) add = -increment;
    if (posX < 0) add = increment;
    if (posY < 0) add = increment;

    holoEl.style.setProperty("--posx", `${posX}%`);
    holoEl.style.setProperty("--posy", `${posY}%`);

    requestAnimationFrame(animate);
  }
  animate();
}

function createCardStyle(
  hoverColor,
  hoverAnimation,
  gradientType,
  gradientAngle,
  gradientColors,
  gradientAnimation,
  fill = DEFAULTS.card_opts.fill,
  opacity = DEFAULTS.card_opts.opacity,
  additional,
  filter
) {
  return {
    hover: {
      color: hoverColor,
      animation: hoverAnimation,
    },
    gradient: {
      type: gradientType,
      angle: gradientAngle,
      colors: gradientColors,
      animation: gradientAnimation,
    },
    card: {
      fill,
      opacity,
      additional,
    },
    filter,
  };
}

function getDefaultStylePreset() {
  return createCardStyle(
    "#ff2409",
    "3s ease-in-out infinite",
    "linear",
    "60deg",
    [
      "hsl(224, 85%, 66%)",
      "hsl(269, 85%, 66%)",
      "hsl(314, 85%, 66%)",
      "hsl(359, 85%, 66%)",
      "hsl(44, 85%, 66%)",
      "hsl(357.2, 87.7%, 52.4%)",
      "hsl(301, 70.2%, 50%)",
      "hsl(179, 85%, 66%)",
    ],
    "4s alternate infinite"
  );
}

function getHotStylePreset() {
  return createCardStyle(
    "#a41111",
    "4s ease-in-out infinite",
    "radial",
    "",
    [
      "hsl(351.7, 86.5%, 62.4%)",
      "hsl(351.7, 86.4%, 46.1%)",
      "hsl(357, 86.6%, 49.6%)",
      "hsl(343.3, 73.1%, 39.4%)",
      "hsl(0, 84.9%, 36.5%)",
      "hsl(354.4, 72.9%, 40.6%)",
      "hsl(348.8, 92.9%, 44.1%)",
      "hsl(345, 80%, 49%)",
      "hsl(354.5, 83.1%, 46.5%)",
      "hsl(357, 86.6%, 49.6%)",
      "hsl(328.2, 73.9%, 22.5%)",
      "hsl(345, 81%, 49.4%)",
      "hsl(0, 70%, 31.4%)",
    ],
    "20s linear infinite"
  );
}

function getBronzeStylePreset() {
    return createCardStyle(
        "#7f4f28",
        "6s ease-in-out infinite",
        "linear",
        "45deg",
        [
            "hsl(30, 20%, 40%)",
            "hsl(40, 25%, 30%)",
            "hsl(35, 20%, 25%)",
            "hsl(40, 35%, 40%)",
            "hsl(20, 35%, 20%)",
            "hsl(25, 20%, 35%)",
            "hsl(15, 30%, 45%)",
            "hsl(10, 35%, 25%)"
          ],
        "8s ease-in-out infinite"
    );
}

function getSilverStylePreset() {
    return createCardStyle(
      "#c0c0c0",
      "6s ease-in-out infinite",
      "linear",
      "45deg",
      [
        "hsl(200, 5%, 80%)",
        "hsl(200, 8%, 65%)",
        "hsl(200, 10%, 55%)",
        "hsl(200, 8%, 72%)",
        "hsl(200, 10%, 40%)",
        "hsl(200, 5%, 58%)",
        "hsl(200, 3%, 85%)",
        "hsl(200, 5%, 48%)"
      ],
      "8s ease-in-out infinite"
    );
}

function getGoldStylePreset() {
  return createCardStyle(
    "#d4af37",
    "6s ease-in-out infinite",
    "linear",
    "45deg",
    [
      "hsl(19.9, 62.7%, 52.7%)",
      "hsl(45, 90.4%, 40.8%)",
      "hsl(40.2, 56.5%, 37.8%)",
      "hsl(42.1, 96.5%, 55.1%)",
      "hsl(30.4, 100%, 27.1%)",
      "hsl(30.8, 49.4%, 45.7%)",
      "hsl(20, 85%, 60%)",
      "hsl(14.9, 75.8%, 32.4%)",
    ],
    "8s ease-in-out infinite"
  );
}

function getHoloStylePreset() {
  return createCardStyle(
    "#fbe1f6",
    "8s ease-in-out infinite",
    "stacked",
    "133deg",
    [
      "linear-gradient(180deg, #FFB7B7 0%, #727272 100%)",
      "radial-gradient(60.91% 100% at 50% 0%, #FFD1D1 0%, #260000 100%)",
      "linear-gradient(238.72deg, #FDD 0%, #720066 100%)",
      "linear-gradient(127.43deg, #0FF 0%, #F44 100%)",
      "radial-gradient(100.22% 100% at 70.57% 0%, #69e4a5 0%, #00FFE0 100%)",
      "linear-gradient(127.43deg, #B7D500 0%, #30F 100%)",
    ],
    "14s ease-in-out infinite",
    true,
    70,
    "background-blend-mode: screen, overlay, hard-light, color-burn, color-dodge, normal;"
  );
}

hotCardsSetup();
