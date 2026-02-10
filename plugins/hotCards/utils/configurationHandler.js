const SEPARATOR = "_";
const INNER_SEPARATOR = ",";
const INNER_SEGMENT_SEPARATOR = "/";
const DEFAULTS = {
  criterion: "",
  value: [""],
  style: ["default"],
  gradient_opts: {
    type: "linear",
    angle: "0deg",
    animation: "",
  },
  hover_opts: {
    color: "transparent",
    animation: "",
  },
  card_opts: {
    fill: true,
    opacity: 80,
    animate: false,
  },
};

// Simple style shortcuts - users can just type "gold" instead of full config
// These map to the style presets defined in hotCards.js (STYLES object)
const STYLE_SHORTCUTS = ["default", "hot", "bronze", "silver", "gold", "holo"];

// Common CSS color names for quick card styling
// These allow users to use simple color names directly (e.g., "red", "blue")
// Colors not in this list can still be used via hex codes (#ff0000) or CSS functions (rgb/hsl)
const CSS_COLOR_NAMES = [
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "cyan",
  "magenta", "lime", "teal", "navy", "maroon", "olive", "aqua", "fuchsia",
  "white", "black", "gray", "grey", "crimson", "coral", "tomato", "salmon",
  "indianred", "darkred", "firebrick", "lightcoral", "darkorange", "goldenrod",
  "khaki", "plum", "violet", "orchid", "indigo", "slateblue", "darkslateblue",
  "mediumseagreen", "forestgreen", "darkgreen", "lightgreen", "springgreen",
  "darkturquoise", "deepskyblue", "dodgerblue", "royalblue", "steelblue",
  "midnightblue", "darkviolet", "darkmagenta", "deeppink", "hotpink",
  "chocolate", "saddlebrown", "sienna", "peru", "tan", "burlywood",
  "slategray", "slategrey", "darkslategray", "darkslategrey", "dimgray", "dimgrey",
  "lightgray", "lightgrey", "gainsboro", "whitesmoke", "snow", "ivory"
];
const CARD_KEYS = {
  galleries: "gallery",
  images: "image",
  groups: "group",
  performers: "performer",
  scenes: "scene",
  studios: "studio",
};

let previousPathname = window.location.pathname;

async function getUserSettings() {
  const userSettings = await csLib.getConfiguration("hotCards", {});
  return parseSettings(userSettings ?? "");
}

function parseSettings(settings) {
  return Object.keys(settings).reduce((acc, key) => {
    if (key === "threshold" || key === "tagId" || key === "home") {
      acc[key] = settings[key];
    } else {
      acc[key] = parseField(settings[key]);
    }
    return acc;
  }, {});
}

function parseField(input) {
  const inputStr = input.toString().trim();
  
  // Simple shortcut: if input is just a style name (e.g., "gold", "silver", "bronze"),
  // automatically expand it to full configuration with that style
  if (isSimpleStyleShortcut(inputStr)) {
    return {
      criterion: DEFAULTS.criterion,
      value: DEFAULTS.value,
      style: [inputStr],
      gradient_opts: [DEFAULTS.gradient_opts],
      hover_opts: [DEFAULTS.hover_opts],
      card_opts: [DEFAULTS.card_opts],
    };
  }
  
  // Color shortcut: if input looks like a color (e.g., "#ff0000", "red", "rgb(...)"),
  // automatically expand it to full configuration with that color
  if (isColorValue(inputStr)) {
    return {
      criterion: DEFAULTS.criterion,
      value: DEFAULTS.value,
      style: [inputStr],
      gradient_opts: [DEFAULTS.gradient_opts],
      hover_opts: [DEFAULTS.hover_opts],
      card_opts: [DEFAULTS.card_opts],
    };
  }
  
  const segments = inputStr.split(SEPARATOR);

  return {
    criterion: segments[0] || DEFAULTS.criterion,
    value: parseValues(segments[1]) || DEFAULTS.value,
    style: parseValues(segments[2]) || DEFAULTS.style,
    gradient_opts: parseArraySegment(segments[3], DEFAULTS.gradient_opts, [
      "type",
      "angle",
      "animation",
    ]),
    hover_opts: parseArraySegment(segments[4], DEFAULTS.hover_opts, [
      "color",
      "animation",
    ]),
    card_opts: parseArraySegment(segments[5], DEFAULTS.card_opts, [
      "fill",
      "opacity",
      "animate",
    ]),
  };
}

/**
 * Check if input is a simple style shortcut (e.g., "gold", "silver", "bronze")
 * These map directly to the preset styles in the STYLES object (defined in hotCards.js).
 * If a matching preset exists, it will use that style's gradient, hover, and card settings.
 * If the preset doesn't exist, the input will be treated as a CSS color value instead.
 */
function isSimpleStyleShortcut(input) {
  return STYLE_SHORTCUTS.includes(input.toLowerCase());
}

/**
 * Check if input looks like a color value.
 * Supports: hex colors (#fff, #ffffff), CSS color names, rgb(), rgba(), hsl(), hsla()
 * For color names not in CSS_COLOR_NAMES, users can use hex codes or CSS functions.
 */
function isColorValue(input) {
  // Hex color patterns: #fff or #ffffff or #ffffffff (with alpha)
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(input)) {
    return true;
  }
  
  // CSS color functions: rgb(), rgba(), hsl(), hsla()
  if (/^(rgb|rgba|hsl|hsla)\s*\(/i.test(input)) {
    return true;
  }
  
  return CSS_COLOR_NAMES.includes(input.toLowerCase());
}

function parseArraySegment(segment, defaults, keys) {
  if (!segment) return [defaults];

  const parsedValues = parseValues(segment);

  // If parsedValues is a single array, convert it to an array of arrays
  const segmentsArray = Array.isArray(parsedValues[0])
    ? parsedValues
    : [parsedValues];

  return segmentsArray.map((valuesArray) =>
    keys.reduce((acc, key, index) => {
      acc[key] = valuesArray[index] || defaults[key];
      return acc;
    }, {})
  );
}

function parseValues(values) {
  if (typeof values !== "string") return values;

  const parts = values.split(INNER_SEGMENT_SEPARATOR);

  if (parts.length === 1)
    return parts[0].split(INNER_SEPARATOR).map((item) => item.trim());

  return parts.map((part) =>
    part.split(INNER_SEPARATOR).map((item) => item.trim())
  );
}

async function setConfiguration() {
  const settings = await getUserSettings();
  const { tagId, threshold } = settings;
  const ratingThreshold = parseInt(threshold ?? 0);
  const isTagBased = tagId?.length;
  const isRatingBased = ratingThreshold !== 0;

  hotCardClasses.length = 0;
  Object.assign(CONFIG, {
    settings,
    tagId,
    ratingThreshold,
    is: {
      tagBased: isTagBased,
      ratingBased: isRatingBased,
      tagOrRatingBased: isTagBased || isRatingBased,
    },
  });
  Object.assign(CARDS, getCards(settings));
}

/**
 * Creates a default config object with proper structure.
 * Used when settings for a card type are not defined.
 */
function getDefaultConfig() {
  return {
    criterion: DEFAULTS.criterion,
    value: DEFAULTS.value,
    style: DEFAULTS.style,
    gradient_opts: [DEFAULTS.gradient_opts],
    hover_opts: [DEFAULTS.hover_opts],
    card_opts: [DEFAULTS.card_opts],
  };
}

function getCards(settings) {
  return Object.entries(CARD_KEYS).reduce((acc, [plural, singular]) => {
    const cardSettings = settings[plural];
    // If settings exist and have valid structure (object with criterion property), use them
    // Otherwise, use default config to prevent "config.value is undefined" errors
    const hasValidConfig = cardSettings && typeof cardSettings === 'object' && 'criterion' in cardSettings;
    
    acc[singular] = {
      type: singular,
      class: `${singular}-card`,
      config: hasValidConfig ? cardSettings : getDefaultConfig(),
      data: stash[plural],
      // Only enable if we have valid config AND criterion is not disabled
      enabled: hasValidConfig && cardSettings.criterion !== CRITERIA.disabled,
    };
    return acc;
  }, {});
}

/** Refresh configuration if previous page is /settings */
async function checkConfigurationRefresh() {
  const pattern = /^\/settings$/;
  const currentPathname = window.location.pathname;
  const previousPathnameIsSettings = pattern.test(previousPathname);
  const currentPathnameIsSettings = pattern.test(currentPathname);

  if (previousPathnameIsSettings && !currentPathnameIsSettings)
    await setConfiguration();

  previousPathname = currentPathname;
}
