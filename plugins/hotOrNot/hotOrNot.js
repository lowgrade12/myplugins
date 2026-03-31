(function () {
  "use strict";

  // Current comparison pair and mode
  let currentPair = { left: null, right: null };
  let currentRanks = { left: null, right: null };
  let currentMode = "swiss"; // "swiss", "calibration", "tournament", or "koth"

  // Calibration mode state
  let calibrationTarget = null; // The performer being calibrated (least confident)
  let calibrationLow = 1; // Binary search lower bound rating
  let calibrationHigh = 100; // Binary search upper bound rating
  let calibrationStep = 0; // Number of calibration matches for current target
  let calibrationLastResult = ""; // Reason why the previous target finished (for dashboard display)
  const CALIBRATION_MAX_STEPS = 10; // Max binary search steps before moving to next target
  const CALIBRATION_CONVERGENCE_THRESHOLD = 5; // Rating range (high - low) at which target is considered converged
  const CALIBRATION_HIGH_CONFIDENCE = 0.75; // Confidence level at which a performer is considered well-established
  const CALIBRATION_LOW_CONFIDENCE = 0.5; // Confidence level below which a performer needs more rating
  const CALIBRATION_MIN_WEIGHT = 0.1; // Minimum weight to prevent zero weights for max-confidence performers
  const CALIBRATION_CONFIDENCE_WEIGHT = 10; // Weight of confidence vs rating proximity in anchor selection
  const CALIBRATION_TOP_CANDIDATES = 3; // Number of top anchor candidates to randomly select from

  // Tournament mode state
  let tournamentBracket = null; // Array of rounds, each with match slots
  let tournamentRound = 0; // Current round index
  let tournamentMatchIndex = 0; // Current match within the round
  let tournamentSize = 0; // Number of participants (8, 16, 32)
  let tournamentPerformers = []; // All tournament participants
  let tournamentSetupDone = false; // Whether bracket has been seeded

  // King of the Hill mode state
  let kothKing = null; // Current king (performer object)
  let kothStreak = 0; // How many challengers the current king has defeated
  let kothBestStreak = 0; // Best streak achieved in this session
  let kothBestKing = null; // Performer who achieved the best streak
  let kothDethroned = []; // History of dethroned kings [{performer, streak}]

  let disableChoice = false; // Track when inputs should be disabled to prevent multiple events
  let battleType = "performers"; // HotOrNot is performers-only
  let cachedUrlFilter = null; // Cache the URL filter when modal is opened
  let badgeInjectionInProgress = false; // Flag to prevent concurrent badge injections
  let previousBattle = null; // Stores pre-battle state for undo functionality
  let pluginConfigCache = null; // Cached plugin configuration from Stash settings
  const MAX_LOAD_RETRIES = 3; // Max auto-retries when not enough performers are available

  /**
   * Reset calibration mode state.
   */
  function resetCalibrationState() {
    calibrationTarget = null;
    calibrationLow = 1;
    calibrationHigh = 100;
    calibrationStep = 0;
    calibrationLastResult = "";
  }

  /**
   * Reset tournament mode state.
   */
  function resetTournamentState() {
    tournamentBracket = null;
    tournamentRound = 0;
    tournamentMatchIndex = 0;
    tournamentSize = 0;
    tournamentPerformers = [];
    tournamentSetupDone = false;
  }

  /**
   * Reset King of the Hill mode state.
   */
  function resetKothState() {
    kothKing = null;
    kothStreak = 0;
    kothBestStreak = 0;
    kothBestKing = null;
    kothDethroned = [];
  }

  /**
   * Reset all mode-specific state (called when switching modes).
   */
  function resetAllModeState() {
    resetCalibrationState();
    resetTournamentState();
    resetKothState();
  }

  // All genders supported by Stash, with display labels
  const ALL_GENDERS = [
    { value: "FEMALE", label: "Female" },
    { value: "MALE", label: "Male" },
    { value: "TRANSGENDER_MALE", label: "Trans Male" },
    { value: "TRANSGENDER_FEMALE", label: "Trans Female" },
    { value: "INTERSEX", label: "Intersex" },
    { value: "NON_BINARY", label: "Non-Binary" },
  ];

  /**
   * Fetch the HotOrNot plugin configuration from Stash settings.
   * Caches the result to avoid repeated GraphQL calls.
   * @returns {Promise<Object>} Plugin config object (may be empty if not yet configured)
   */
  async function getHotOrNotConfig() {
    if (pluginConfigCache !== null) {
      return pluginConfigCache;
    }
    try {
      const result = await graphqlQuery(`
        query Configuration {
          configuration {
            plugins
          }
        }
      `);
      pluginConfigCache = (result.configuration.plugins || {})["hotOrNot"] || {};
    } catch (e) {
      console.error("[HotOrNot] Failed to fetch plugin config:", e);
      pluginConfigCache = {};
    }
    return pluginConfigCache;
  }

  /**
   * Returns true if the battle rank badge is enabled.
   * Reads from Stash plugin settings; defaults to true when not explicitly set to false.
   * @returns {Promise<boolean>}
   */
  async function isBattleRankBadgeEnabled() {
    const config = await getHotOrNotConfig();
    // Default to true if the setting has never been changed
    return config.showBattleRankBadge !== false;
  }

  /**
   * Returns true if the star rating widget is enabled.
   * Reads from Stash plugin settings; defaults to true when not explicitly set to false.
   * @returns {Promise<boolean>}
   */
  async function isStarRatingWidgetEnabled() {
    const config = await getHotOrNotConfig();
    // Default to true if the setting has never been changed
    return config.showStarRatingWidget !== false;
  }

  // GraphQL filter modifier constants
  // Array-based modifiers require value_list field for enum-based criterion inputs
  // (e.g., GenderCriterionInput uses value_list for INCLUDES/EXCLUDES).
  // HierarchicalMultiCriterionInput types (tags, studios) always use 'value' field regardless of modifier.
  const ARRAY_BASED_MODIFIERS = new Set(['INCLUDES', 'EXCLUDES', 'INCLUDES_ALL']);

  // ============================================
  // COUNTRY DISPLAY HELPER
  // ============================================

  // ISO 3166-1 alpha-2 country code to full country name lookup table.
  // Names match the i18n-iso-countries English locale used by Stash (first alias when multiple exist).
  const COUNTRY_NAMES = {
    "AF": "Afghanistan", "AX": "Åland Islands", "AL": "Albania", "DZ": "Algeria",
    "AS": "American Samoa", "AD": "Andorra", "AO": "Angola", "AI": "Anguilla",
    "AQ": "Antarctica", "AG": "Antigua and Barbuda", "AR": "Argentina", "AM": "Armenia",
    "AW": "Aruba", "AU": "Australia", "AT": "Austria", "AZ": "Azerbaijan",
    "BS": "Bahamas", "BH": "Bahrain", "BD": "Bangladesh", "BB": "Barbados",
    "BY": "Belarus", "BE": "Belgium", "BZ": "Belize", "BJ": "Benin", "BM": "Bermuda",
    "BT": "Bhutan", "BO": "Bolivia", "BQ": "Bonaire, Sint Eustatius and Saba",
    "BA": "Bosnia and Herzegovina", "BW": "Botswana", "BV": "Bouvet Island",
    "BR": "Brazil", "IO": "British Indian Ocean Territory", "BN": "Brunei Darussalam",
    "BG": "Bulgaria", "BF": "Burkina Faso", "BI": "Burundi", "KH": "Cambodia",
    "CM": "Cameroon", "CA": "Canada", "CV": "Cape Verde", "KY": "Cayman Islands",
    "CF": "Central African Republic", "TD": "Chad", "CL": "Chile",
    "CN": "People's Republic of China", "CX": "Christmas Island",
    "CC": "Cocos (Keeling) Islands", "CO": "Colombia", "KM": "Comoros",
    "CG": "Republic of the Congo", "CD": "Democratic Republic of the Congo",
    "CK": "Cook Islands", "CR": "Costa Rica", "CI": "Cote d'Ivoire", "HR": "Croatia",
    "CU": "Cuba", "CW": "Curaçao", "CY": "Cyprus", "CZ": "Czech Republic",
    "DK": "Denmark", "DJ": "Djibouti", "DM": "Dominica", "DO": "Dominican Republic",
    "EC": "Ecuador", "EG": "Egypt", "SV": "El Salvador", "GQ": "Equatorial Guinea",
    "ER": "Eritrea", "EE": "Estonia", "ET": "Ethiopia", "SZ": "Eswatini",
    "FK": "Falkland Islands (Malvinas)", "FO": "Faroe Islands", "FJ": "Fiji",
    "FI": "Finland", "FR": "France", "GF": "French Guiana", "PF": "French Polynesia",
    "TF": "French Southern Territories", "GA": "Gabon", "GM": "Republic of The Gambia",
    "GE": "Georgia", "DE": "Germany", "GH": "Ghana", "GI": "Gibraltar", "GR": "Greece",
    "GL": "Greenland", "GD": "Grenada", "GP": "Guadeloupe", "GU": "Guam",
    "GT": "Guatemala", "GG": "Guernsey", "GN": "Guinea", "GW": "Guinea-Bissau",
    "GY": "Guyana", "HT": "Haiti", "HM": "Heard Island and McDonald Islands",
    "VA": "Holy See (Vatican City State)", "HN": "Honduras", "HK": "Hong Kong",
    "HU": "Hungary", "IS": "Iceland", "IN": "India", "ID": "Indonesia",
    "IR": "Islamic Republic of Iran", "IQ": "Iraq", "IE": "Ireland", "IM": "Isle of Man",
    "IL": "Israel", "IT": "Italy", "JM": "Jamaica", "JP": "Japan", "JE": "Jersey",
    "JO": "Jordan", "KZ": "Kazakhstan", "KE": "Kenya", "KI": "Kiribati",
    "KP": "North Korea", "KR": "South Korea", "XK": "Kosovo", "KW": "Kuwait",
    "KG": "Kyrgyzstan", "LA": "Lao People's Democratic Republic", "LV": "Latvia",
    "LB": "Lebanon", "LS": "Lesotho", "LR": "Liberia", "LY": "Libya",
    "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg", "MO": "Macao",
    "MG": "Madagascar", "MW": "Malawi", "MY": "Malaysia", "MV": "Maldives", "ML": "Mali",
    "MT": "Malta", "MH": "Marshall Islands", "MQ": "Martinique", "MR": "Mauritania",
    "MU": "Mauritius", "YT": "Mayotte", "MX": "Mexico",
    "FM": "Micronesia, Federated States of", "MD": "Moldova, Republic of", "MC": "Monaco",
    "MN": "Mongolia", "ME": "Montenegro", "MS": "Montserrat", "MA": "Morocco",
    "MZ": "Mozambique", "MM": "Myanmar", "NA": "Namibia", "NR": "Nauru", "NP": "Nepal",
    "NL": "Netherlands", "NC": "New Caledonia", "NZ": "New Zealand", "NI": "Nicaragua",
    "NE": "Niger", "NG": "Nigeria", "NU": "Niue", "NF": "Norfolk Island",
    "MK": "North Macedonia", "MP": "Northern Mariana Islands", "NO": "Norway",
    "OM": "Oman", "PK": "Pakistan", "PW": "Palau", "PS": "State of Palestine",
    "PA": "Panama", "PG": "Papua New Guinea", "PY": "Paraguay", "PE": "Peru",
    "PH": "Philippines", "PN": "Pitcairn", "PL": "Poland", "PT": "Portugal",
    "PR": "Puerto Rico", "QA": "Qatar", "RE": "Reunion", "RO": "Romania",
    "RU": "Russian Federation", "RW": "Rwanda", "BL": "Saint Barthélemy",
    "SH": "Saint Helena", "KN": "Saint Kitts and Nevis", "LC": "Saint Lucia",
    "MF": "Saint Martin (French part)", "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines", "WS": "Samoa", "SM": "San Marino",
    "ST": "Sao Tome and Principe", "SA": "Saudi Arabia", "SN": "Senegal", "RS": "Serbia",
    "SC": "Seychelles", "SL": "Sierra Leone", "SG": "Singapore",
    "SX": "Sint Maarten (Dutch part)", "SK": "Slovakia", "SI": "Slovenia",
    "SB": "Solomon Islands", "SO": "Somalia", "ZA": "South Africa",
    "GS": "South Georgia and the South Sandwich Islands", "SS": "South Sudan",
    "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan", "SR": "Suriname",
    "SJ": "Svalbard and Jan Mayen", "SE": "Sweden", "CH": "Switzerland",
    "SY": "Syrian Arab Republic", "TW": "Taiwan, Province of China",
    "TJ": "Tajikistan", "TZ": "United Republic of Tanzania", "TH": "Thailand",
    "TL": "Timor-Leste", "TG": "Togo", "TK": "Tokelau", "TO": "Tonga",
    "TT": "Trinidad and Tobago", "TN": "Tunisia", "TR": "Türkiye",
    "TM": "Turkmenistan", "TC": "Turks and Caicos Islands", "TV": "Tuvalu",
    "UG": "Uganda", "UA": "Ukraine", "AE": "United Arab Emirates",
    "GB": "United Kingdom", "US": "United States of America",
    "UM": "United States Minor Outlying Islands", "UY": "Uruguay", "UZ": "Uzbekistan",
    "VU": "Vanuatu", "VE": "Venezuela", "VN": "Vietnam",
    "VG": "Virgin Islands, British", "VI": "Virgin Islands, U.S.",
    "WF": "Wallis and Futuna", "EH": "Western Sahara", "YE": "Yemen",
    "ZM": "Zambia", "ZW": "Zimbabwe"
  };

  /**
   * Convert an ISO 3166-1 alpha-2 country code to an HTML string with a flag icon and full
   * country name, matching how Stash displays countries on performer pages.
   * Uses the flag-icons CSS library (fi fi-{code}) already loaded by Stash.
   * Country names match the i18n-iso-countries English locale used by Stash.
   * @param {string} countryCode - Two-letter ISO country code (e.g., "US")
   * @returns {string} HTML string with flag icon span and country name (e.g., '<span class="fi fi-us"></span> United States of America')
   */
  function getCountryDisplay(countryCode) {
    if (!countryCode) return "";
    const code = countryCode.toUpperCase().trim();
    const name = COUNTRY_NAMES[code] || code.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
    const flagClass = `fi fi-${code.toLowerCase().replace(/[^a-z]/g, "")}`;
    return `<span class="${flagClass}"></span> ${name}`;
  }

  function getGenderDisplay(gender) {
    if (!gender) return "";
    return (ALL_GENDERS.find(g => g.value === gender) || { label: gender }).label;
  }

  // ============================================
  // GRAPHQL QUERIES
  // ============================================

  async function graphqlQuery(query, variables = {}) {
    // Use Stash's Apollo client when available (preferred method for Stash plugins)
    // This ensures authentication is handled automatically and avoids Apollo context errors
    if (
      typeof PluginApi !== "undefined" &&
      PluginApi.utils &&
      PluginApi.utils.StashService &&
      typeof PluginApi.utils.StashService.getClient === "function" &&
      PluginApi.libraries &&
      PluginApi.libraries.Apollo
    ) {
      try {
        const { gql } = PluginApi.libraries.Apollo;
        const client = PluginApi.utils.StashService.getClient();
        const doc = gql(query);
        const isMutation = doc.definitions.some(
          (def) => def.kind === "OperationDefinition" && def.operation === "mutation"
        );
        const result = isMutation
          ? await client.mutate({ mutation: doc, variables })
          : await client.query({ query: doc, variables, fetchPolicy: "no-cache" });
        return result.data;
      } catch (apolloError) {
        // Fall back to direct fetch when Apollo client is unavailable or in an invalid
        // state (e.g., clearStore called during an in-progress query/mutation)
        console.warn("[HotOrNot] Apollo client error, falling back to fetch:", apolloError?.message || apolloError);
      }
    }
    // Fallback: direct fetch (for environments where PluginApi is not available)
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors) {
      console.error("[HotOrNot] GraphQL error:", result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  const PERFORMER_FRAGMENT = `
    id
    name
    image_path
    rating100
    details
    custom_fields
    birthdate
    ethnicity
    country
    gender
    scene_count
  `;

  const IMAGE_FRAGMENT = `
    id
    rating100
    paths {
      thumbnail
      image
    }
  `;

  // Reusable GraphQL query templates (avoids duplicating the same query 6+ times)
  const FIND_PERFORMERS_QUERY = `
    query FindPerformers($performer_filter: PerformerFilterType, $filter: FindFilterType) {
      findPerformers(performer_filter: $performer_filter, filter: $filter) {
        count
        performers {
          ${PERFORMER_FRAGMENT}
        }
      }
    }
  `;

  // ============================================
  // URL FILTER PARSING
  // ============================================

  /**
   * Parse filter criteria from URL query parameters
   * Stash encodes filter criteria in the 'c' parameter as JSON
   * @returns {Array} Array of filter criteria objects
   */
  function parseUrlFilterCriteria() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      // Use getAll() to support multiple filter criteria (multiple c= parameters)
      const criteriaParams = urlParams.getAll('c');
      
      if (!criteriaParams || criteriaParams.length === 0) {
        console.log('[HotOrNot] No filter criteria found in URL (no "c" parameter)');
        return [];
      }
      
      console.log(`[HotOrNot] Found ${criteriaParams.length} filter parameter(s) in URL:`, criteriaParams);
      
      const allParsedCriteria = [];
      
      // Parse each criterion parameter separately
      for (const criteriaParam of criteriaParams) {
        // The 'c' parameter contains encoded JSON criteria
        // Try to decode and parse it
        const decoded = decodeURIComponent(criteriaParam);
        console.log('[HotOrNot] Decoded filter criteria:', decoded);
        
        // Stash uses a custom encoding format for criteria
        // It can be a JSON array or individual criteria strings
        // Try parsing as JSON first
        try {
          const criteria = JSON.parse(decoded);
          const result = Array.isArray(criteria) ? criteria : [criteria];
          console.log('[HotOrNot] Parsed criteria as JSON:', result);
          allParsedCriteria.push(...result);
        } catch (e) {
          // If not valid JSON, it might be the newer Stash encoding
          // Stash may encode criteria with parentheses instead of curly braces
          // Format: ("type":"tags","value":("items":[...],"depth":0),"modifier":"INCLUDES")
          
          // FIRST: Normalize ALL parentheses to curly braces before any splitting
          // This must happen before splitting because the split pattern ),(
          // also appears inside array elements like: [("id":"1"),("id":"2")]
          //
          // NOTE: This is safe because we only reach this code if standard JSON.parse failed
          // at line 125. If the input had properly quoted strings with parentheses (e.g.,
          // "label":"Action (2023)"), it would have parsed successfully in the first attempt.
          // Stash only uses parentheses to replace structural braces, not within string values.
          let normalized = decoded.trim();
          normalized = normalized.replace(/\(/g, '{');
          normalized = normalized.replace(/\)/g, '}');
          
          // Try parsing the normalized string as JSON
          try {
            const criteria = JSON.parse(normalized);
            const result = Array.isArray(criteria) ? criteria : [criteria];
            console.log('[HotOrNot] Parsed normalized criteria as JSON:', result);
            allParsedCriteria.push(...result);
          } catch (parseErr) {
            // If still not valid JSON, try splitting on },{ pattern
            // (only after normalization to avoid splitting inside arrays)
            const delimiter = '|||SPLIT|||';
            const withDelimiter = normalized.replace(/\}\s*,?\s*\{/g, '}' + delimiter + '{');
            const criteriaStrings = withDelimiter.split(delimiter);
            
            for (const criteriaStr of criteriaStrings) {
              try {
                const criterion = JSON.parse(criteriaStr.trim());
                if (criterion && criterion.type) {
                  allParsedCriteria.push(criterion);
                }
              } catch (splitParseErr) {
                console.warn('[HotOrNot] Could not parse criterion:', criteriaStr, splitParseErr);
              }
            }
          }
        }
      }
      
      console.log('[HotOrNot] Total parsed criteria:', allParsedCriteria);
      return allParsedCriteria;
    } catch (e) {
      console.warn('[HotOrNot] Error parsing URL filter criteria:', e);
      return [];
    }
  }

  /**
   * Extract a simple value from a potentially nested criterion value object.
   * Stash URL criteria can have values in different formats:
   * - Simple: "FEMALE" or 50
   * - Nested: { "value": "FEMALE" } or { "value": 50, "value2": 100 }
   * @param {*} value - Value to extract from
   * @returns {*} The extracted simple value, or the original if already simple
   */
  function extractSimpleValue(value) {
    if (value === undefined || value === null) {
      return value;
    }
    // If it's an object with a "value" property, extract it
    // Note: We use !== undefined rather than hasOwnProperty because:
    // - If value.value is null, we want to return null (filter should not apply)
    // - If value.value is undefined, the property doesn't exist, so return original
    if (typeof value === 'object' && !Array.isArray(value) && value.value !== undefined) {
      return value.value;
    }
    // If it's an array, return it as-is (for multi-value filters)
    if (Array.isArray(value)) {
      return value;
    }
    // Otherwise return the value as-is
    return value;
  }

  /**
   * Safely parse an integer value, returning a default if parsing fails
   * Handles nested value objects from URL criteria (e.g., { "value": 50 })
   * @param {*} value - Value to parse
   * @param {number} defaultValue - Default value if parsing fails (default: 0)
   * @returns {number} Parsed integer or default value
   */
  function safeParseInt(value, defaultValue = 0) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    // Extract from nested object if needed
    const simpleValue = extractSimpleValue(value);
    if (simpleValue === undefined || simpleValue === null) {
      return defaultValue;
    }
    const parsed = parseInt(simpleValue, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Normalize gender value to valid GraphQL GenderEnum format.
   * Converts human-readable formats (e.g., "Transgender Female", "transgender female")
   * to GraphQL enum format (e.g., "TRANSGENDER_FEMALE").
   * Valid GenderEnum values: MALE, FEMALE, TRANSGENDER_MALE, TRANSGENDER_FEMALE, INTERSEX, NON_BINARY
   * @param {string} value - Gender value to normalize
   * @returns {string} Normalized gender value in GraphQL enum format
   */
  function normalizeGenderValue(value) {
    if (!value || typeof value !== 'string') {
      return value;
    }
    
    // Convert to uppercase and replace spaces and hyphens with underscores
    const normalized = value.toUpperCase().replace(/[\s-]+/g, '_');
    
    // Validate against known GenderEnum values
    const validGenders = new Set([
      'MALE',
      'FEMALE',
      'TRANSGENDER_MALE',
      'TRANSGENDER_FEMALE',
      'INTERSEX',
      'NON_BINARY'
    ]);
    
    if (validGenders.has(normalized)) {
      return normalized;
    }
    
    // If not valid, log a warning and return the original value
    // This allows the GraphQL API to reject it with a clear error message
    console.warn(`[HotOrNot] Invalid gender value "${value}" - valid values are: ${Array.from(validGenders).join(', ')}`);
    return value;
  }

  /**
   * Create a numeric filter object with support for value2 (BETWEEN modifier)
   * @param {*} value - Value to parse (can be a number or an object with value and value2)
   * @param {string} modifier - The filter modifier (e.g., 'BETWEEN', 'GREATER_THAN')
   * @param {string} defaultModifier - Default modifier if none provided
   * @returns {Object} Filter object with value, modifier, and optionally value2
   */
  function createNumericFilterObject(value, modifier, defaultModifier) {
    const filterObj = {
      value: safeParseInt(value, 0),
      modifier: modifier || defaultModifier
    };
    // Handle BETWEEN modifier which requires value2
    // value can be an object like { "value": 20, "value2": 30 }
    if (typeof value === 'object' && !Array.isArray(value) && value.value2 !== undefined) {
      filterObj.value2 = safeParseInt(value.value2, 0);
    }
    return filterObj;
  }

  /**
   * Build a filter object for IS_NULL or NOT_NULL modifiers.
   * These modifiers don't carry a value - the modifier alone defines the filter.
   * GraphQL still requires the value field, so we supply appropriate defaults.
   * @param {string} type - The criterion type (e.g., 'rating100', 'gender')
   * @param {string} modifier - 'IS_NULL' or 'NOT_NULL'
   * @returns {Object|null} GraphQL filter object or null if type is unknown
   */
  function buildNullModifierFilter(type, modifier) {
    // Numeric criterion types -> IntCriterionInput (value: Int! required)
    const NUMERIC_FIELDS = {
      'rating': 'rating100',
      'rating100': 'rating100',
      'age': 'age',
      'scene_count': 'scene_count',
      'image_count': 'image_count',
      'gallery_count': 'gallery_count',
      'o_counter': 'o_counter'
    };

    // String / date criterion types -> StringCriterionInput (value: String! required)
    const STRING_FIELDS = {
      'ethnicity': 'ethnicity',
      'country': 'country',
      'hair_color': 'hair_color',
      'eye_color': 'eye_color',
      'name': 'name',
      'alias': 'aliases',
      'aliases': 'aliases',
      'details': 'details',
      'career_length': 'career_length',
      'tattoos': 'tattoos',
      'piercings': 'piercings',
      'url': 'url',
      'birthdate': 'birthdate',
      'death_date': 'death_date',
      'created_at': 'created_at',
      'updated_at': 'updated_at'
    };

    if (NUMERIC_FIELDS[type]) {
      return { [NUMERIC_FIELDS[type]]: { value: 0, modifier } };
    }

    if (STRING_FIELDS[type]) {
      return { [STRING_FIELDS[type]]: { value: "", modifier } };
    }

    // GenderCriterionInput – value is optional in the schema
    if (type === 'gender') {
      return { gender: { modifier } };
    }

    // HierarchicalMultiCriterionInput – value is optional
    if (type === 'tags') {
      return { tags: { value: [], modifier, depth: 0 } };
    }
    if (type === 'studios') {
      return { studios: { value: [], modifier, depth: 0 } };
    }

    // StashIDCriterionInput
    if (type === 'stash_id' || type === 'stash_id_endpoint') {
      return { stash_id_endpoint: { modifier } };
    }

    console.warn(`[HotOrNot] Unknown criterion type for ${modifier} modifier: ${type}`);
    return null;
  }

  /**
   * Convert a single criterion from URL format to GraphQL PerformerFilterType format
   * @param {Object} criterion - Single criterion object from URL
   * @returns {Object|null} GraphQL filter object or null if not applicable
   */
  function convertCriterionToFilter(criterion) {
    if (!criterion || !criterion.type) {
      return null;
    }

    const { type, value, modifier } = criterion;
    
    // Handle IS_NULL and NOT_NULL modifiers early - these don't require a value
    // The modifier alone determines the filter behavior
    if (modifier === 'IS_NULL' || modifier === 'NOT_NULL') {
      return buildNullModifierFilter(type, modifier);
    }

    // ---- Lookup-table-driven filters ----
    // String filters: type -> { field, defaultModifier }
    const STRING_FILTERS = {
      'ethnicity':     { field: 'ethnicity',     defaultModifier: 'EQUALS' },
      'country':       { field: 'country',       defaultModifier: 'EQUALS' },
      'hair_color':    { field: 'hair_color',    defaultModifier: 'EQUALS' },
      'eye_color':     { field: 'eye_color',     defaultModifier: 'EQUALS' },
      'name':          { field: 'name',          defaultModifier: 'INCLUDES' },
      'alias':         { field: 'aliases',       defaultModifier: 'INCLUDES' },
      'aliases':       { field: 'aliases',       defaultModifier: 'INCLUDES' },
      'details':       { field: 'details',       defaultModifier: 'INCLUDES' },
      'career_length': { field: 'career_length', defaultModifier: 'INCLUDES' },
      'tattoos':       { field: 'tattoos',       defaultModifier: 'INCLUDES' },
      'piercings':     { field: 'piercings',     defaultModifier: 'INCLUDES' },
      'url':           { field: 'url',           defaultModifier: 'INCLUDES' },
      'birthdate':     { field: 'birthdate',     defaultModifier: 'EQUALS' },
      'death_date':    { field: 'death_date',    defaultModifier: 'EQUALS' },
      'created_at':    { field: 'created_at',    defaultModifier: 'GREATER_THAN' },
      'updated_at':    { field: 'updated_at',    defaultModifier: 'GREATER_THAN' }
    };

    // Numeric filters: type -> { field, defaultModifier }
    const NUMERIC_FILTERS = {
      'rating':        { field: 'rating100',     defaultModifier: 'GREATER_THAN' },
      'rating100':     { field: 'rating100',     defaultModifier: 'GREATER_THAN' },
      'age':           { field: 'age',           defaultModifier: 'EQUALS' },
      'scene_count':   { field: 'scene_count',   defaultModifier: 'GREATER_THAN' },
      'image_count':   { field: 'image_count',   defaultModifier: 'GREATER_THAN' },
      'gallery_count': { field: 'gallery_count', defaultModifier: 'GREATER_THAN' },
      'o_counter':     { field: 'o_counter',     defaultModifier: 'GREATER_THAN' }
    };

    // Handle string filters via lookup table
    if (STRING_FILTERS[type]) {
      if (value) {
        const extracted = extractSimpleValue(value);
        if (extracted) {
          const { field, defaultModifier } = STRING_FILTERS[type];
          return { [field]: { value: extracted, modifier: modifier || defaultModifier } };
        }
      }
      return null;
    }

    // Handle numeric filters via lookup table
    if (NUMERIC_FILTERS[type]) {
      if (value != null) {
        const { field, defaultModifier } = NUMERIC_FILTERS[type];
        return { [field]: createNumericFilterObject(value, modifier, defaultModifier) };
      }
      return null;
    }

    // Map URL criterion types to GraphQL filter fields
    // The filter structure varies based on the criterion type
    switch (type) {
      case 'tags':
      case 'studios': {
        // Tags/Studios share identical filter structure; `type` is used as the
        // computed property key so the result is { tags: {...} } or { studios: {...} }.
        if (value && value.items && value.items.length > 0) {
          const ids = value.items.map(item =>
            (typeof item === 'object' && item !== null && 'id' in item) ? item.id : item
          );
          return {
            [type]: {
              value: ids,
              modifier: modifier || 'INCLUDES',
              depth: value.depth || 0
            }
          };
        }
        break;
      }
        
      case 'gender':
        // Gender filter
        // Extract simple value from potential nested object (e.g., { "value": "FEMALE" } -> "FEMALE")
        // Also handles array format (e.g., ["Female"] -> "Female" for EQUALS modifier)
        if (value) {
          let genderValue = extractSimpleValue(value);
          if (genderValue) {
            const effectiveModifier = modifier || 'EQUALS';
            // Use value_list for array-based modifiers (INCLUDES, EXCLUDES, etc.)
            // Use value for single-value modifiers (EQUALS, NOT_EQUALS)
            const useValueList = ARRAY_BASED_MODIFIERS.has(effectiveModifier);
            
            if (useValueList) {
              // Convert genderValue to array format for value_list field
              const genderArray = Array.isArray(genderValue) ? genderValue : [genderValue];
              // Normalize each gender value to valid GraphQL enum format
              const normalizedArray = genderArray.map(g => normalizeGenderValue(g));
              return {
                gender: {
                  value_list: normalizedArray,
                  modifier: effectiveModifier
                }
              };
            } else {
              // For single-value modifiers, extract first element if genderValue is an array
              if (Array.isArray(genderValue)) {
                genderValue = genderValue.length > 0 ? genderValue[0] : null;
              }
              if (genderValue) {
                // Normalize single gender value to valid GraphQL enum format
                const normalizedValue = normalizeGenderValue(genderValue);
                return {
                  gender: {
                    value: normalizedValue,
                    modifier: effectiveModifier
                  }
                };
              }
            }
          }
        }
        break;
        
      case 'favorite':
      case 'filter_favorites':
        // Favorite filter
        if (value != null) {
          const favValue = extractSimpleValue(value);
          return {
            filter_favorites: favValue === true || favValue === 'true'
          };
        }
        break;
        
      case 'stash_id':
      case 'stash_id_endpoint':
        // Stash ID filter - performer has a stash ID at a specific endpoint
        // Note: This filter intentionally does NOT use extractSimpleValue() because
        // the value itself is expected to be an object with stash_id and/or endpoint properties
        if (value && typeof value === 'object') {
          const stashIdFilter = {};
          if (value.stash_id) {
            stashIdFilter.stash_id = value.stash_id;
          }
          if (value.endpoint) {
            stashIdFilter.endpoint = value.endpoint;
          }
          if (Object.keys(stashIdFilter).length > 0) {
            stashIdFilter.modifier = modifier || 'NOT_NULL';
            return {
              stash_id_endpoint: stashIdFilter
            };
          }
        }
        break;
        
      case 'is_missing':
        // Is missing filter
        if (value) {
          const missingValue = extractSimpleValue(value);
          if (missingValue) {
            return {
              is_missing: missingValue
            };
          }
        }
        break;

      case 'custom_fields': {
        // Custom fields filter - supports filtering by any free-form custom field
        // URL format: {"type":"custom_fields","value":[{"field":"hotornot_stats","modifier":"IS_NULL"}]}
        // GraphQL expects: { custom_fields: [{ field: "...", modifier: "...", value: [...] }] }
        if (value && Array.isArray(value) && value.length > 0) {
          const customFieldCriteria = value
            .filter(item => item && item.field)
            .map(item => {
              const criterion = {
                field: item.field,
                modifier: item.modifier || 'EQUALS'
              };
              // Only include value if present (IS_NULL/NOT_NULL don't need values)
              if (item.value !== undefined && item.value !== null) {
                criterion.value = Array.isArray(item.value) ? item.value : [item.value];
              }
              return criterion;
            });

          if (customFieldCriteria.length > 0) {
            return { custom_fields: customFieldCriteria };
          }
        }
        break;
      }

      default:
        console.log(`[HotOrNot] Unknown criterion type: ${type}`);
        return null;
    }
    
    return null;
  }

  /**
   * Parse URL filters and convert them to GraphQL PerformerFilterType format
   * @returns {Object} GraphQL performer filter object
   */
  function getUrlPerformerFilter() {
    const criteria = parseUrlFilterCriteria();
    const filter = {};
    
    console.log('[HotOrNot] Converting', criteria.length, 'criteria to performer filter');
    
    for (const criterion of criteria) {
      const filterPart = convertCriterionToFilter(criterion);
      if (filterPart) {
        console.log('[HotOrNot] Converted criterion:', criterion, 'to filter part:', filterPart);
        // Merge the filter part into the main filter
        // Concatenate array-valued fields (e.g., custom_fields) instead of overwriting
        for (const [key, val] of Object.entries(filterPart)) {
          if (Array.isArray(val) && Array.isArray(filter[key])) {
            filter[key] = filter[key].concat(val);
          } else {
            filter[key] = val;
          }
        }
      } else {
        console.log('[HotOrNot] Could not convert criterion:', criterion);
      }
    }
    
    console.log('[HotOrNot] Final performer filter:', filter);
    return filter;
  }

  async function updatePerformerRating(performerId, newRating, performerObj = null, won = null, ratingChange = 0) {
    const mutation = `
      mutation UpdatePerformerCustomFields($id: ID!, $rating: Int!, $fields: Map) {
        performerUpdate(input: {
          id: $id,
          rating100: $rating,
          custom_fields: {
            partial: $fields
          }
        }) {
          id
          rating100
          custom_fields
        }
      }
    `;
  
    const variables = {
      id: performerId,
      rating: Math.max(1, Math.min(100, Math.round(newRating)))
    };
    
    // Update stats if performer object provided (won can be true/false/null)
    // won=true: winner with full stats, won=false: loser with full stats, won=null: participation only (no win/loss)
    // Check for won !== undefined to handle all three cases (true, false, null)
    if (performerObj && battleType === "performers" && won !== undefined) {
      const currentStats = parsePerformerEloData(performerObj);
      
      // Update stats based on match outcome, including rating change for recovery tracking
      const newStats = updatePerformerStats(currentStats, won, ratingChange);
      
      // Save stats as JSON string in custom field
      variables.fields = {
        hotornot_stats: JSON.stringify(newStats)
      };
    }
    
    return await graphqlQuery(mutation, variables);
  }


  // ============================================
  // RATING LOGIC
  // ============================================

  /**
   * Create a default (empty) stats object.
   * @param {number} [totalMatches=0] - Override for total_matches
   * @returns {Object} Default stats with all fields initialised
   */
  function defaultStats(totalMatches = 0) {
    return {
      total_matches: totalMatches,
      wins: 0,
      losses: 0,
      draws: 0,
      current_streak: 0,
      best_streak: 0,
      worst_streak: 0,
      last_match: null,
      recent_results: 0,
      last_rating_change: 0,
      tournament_wins: 0
    };
  }

  /**
   * Parse ELO match data from performer custom_fields
   * @param {Object} performer - Performer object from GraphQL
   * @returns {Object} stats - ELO statistics object with matches, wins, losses, etc.
   */
  function parsePerformerEloData(performer) {
    if (!performer || !performer.custom_fields) {
      return defaultStats();
    }
    
    // Check for Approach 2 stats (comprehensive tracking)
    if (performer.custom_fields.hotornot_stats) {
      try {
        const stats = JSON.parse(performer.custom_fields.hotornot_stats);
        return {
          total_matches: stats.total_matches || 0,
          wins: stats.wins || 0,
          losses: stats.losses || 0,
          draws: stats.draws || 0,
          current_streak: stats.current_streak || 0,
          best_streak: stats.best_streak || 0,
          worst_streak: stats.worst_streak || 0,
          last_match: stats.last_match || null,
          recent_results: stats.recent_results || 0,
          last_rating_change: stats.last_rating_change || 0,
          tournament_wins: stats.tournament_wins || 0
        };
      } catch (e) {
        console.warn(`[HotOrNot] Failed to parse hotornot_stats for performer ${performer.id}:`, e);
      }
    }
    
    // Fallback to Approach 1 (match count only) for backward compatibility
    const eloMatches = performer.custom_fields.elo_matches;
    if (eloMatches) {
      const matches = parseInt(eloMatches, 10);
      return defaultStats(isNaN(matches) ? 0 : matches);
    }
    
    return defaultStats();
  }

  /**
   * Update performer stats after a match
   * @param {Object} currentStats - Current stats object from parsePerformerEloData
   * @param {boolean|null|string} won - True if performer won, false if lost, null for participation-only (no win/loss tracking), "draw" for skipped/drawn matches
   * @param {number} [ratingChange=0] - Rating change from this match (positive for gains, negative for losses)
   * @returns {Object} Updated stats object
   */
  function updatePerformerStats(currentStats, won, ratingChange = 0) {
    // Base stats that always update
    const newStats = {
      total_matches: currentStats.total_matches + 1,
      last_match: new Date().toISOString(),
      last_rating_change: ratingChange,
      tournament_wins: currentStats.tournament_wins
    };
    
    // If won is null, this is participation-only tracking
    // Only increment match count and timestamp, don't track win/loss or streaks
    if (won === null) {
      newStats.wins = currentStats.wins;
      newStats.losses = currentStats.losses;
      newStats.draws = currentStats.draws || 0;
      newStats.current_streak = currentStats.current_streak;
      newStats.best_streak = currentStats.best_streak;
      newStats.worst_streak = currentStats.worst_streak;
      newStats.recent_results = currentStats.recent_results || 0;
      return newStats;
    }
    
    // Handle draw (skip) - counts as a tie, resets streak
    if (won === "draw") {
      newStats.wins = currentStats.wins;
      newStats.losses = currentStats.losses;
      newStats.draws = (currentStats.draws || 0) + 1;
      // A draw resets the current streak to 0 (neither winning nor losing)
      newStats.current_streak = 0;
      newStats.best_streak = currentStats.best_streak;
      newStats.worst_streak = currentStats.worst_streak;
      // For trend tracking, draws count as 0 (loss) since they don't indicate a clear victory
      let recentResults = currentStats.recent_results || 0;
      recentResults = (recentResults << 1) & 0x3FF; // Shift left, add 0 for draw, keep only 10 bits
      newStats.recent_results = recentResults;
      return newStats;
    }
    
    // Track win/loss
    newStats.wins = won ? currentStats.wins + 1 : currentStats.wins;
    newStats.losses = won ? currentStats.losses : currentStats.losses + 1;
    newStats.draws = currentStats.draws || 0;
    
    // Calculate current streak
    if (won) {
      // Win: increment positive streak or start new positive streak
      newStats.current_streak = currentStats.current_streak >= 0 
        ? currentStats.current_streak + 1 
        : 1;
    } else {
      // Loss: decrement negative streak or start new negative streak
      newStats.current_streak = currentStats.current_streak <= 0 
        ? currentStats.current_streak - 1 
        : -1;
    }
    
    // Update best/worst streaks
    if (newStats.current_streak > 0) {
      newStats.best_streak = Math.max(currentStats.best_streak, newStats.current_streak);
      newStats.worst_streak = currentStats.worst_streak;
    } else {
      newStats.best_streak = currentStats.best_streak;
      newStats.worst_streak = Math.min(currentStats.worst_streak, newStats.current_streak);
    }
    
    // Update recent results bitmask for trend tracking
    // Each bit represents a match outcome: 1=win, 0=loss
    // Least significant bit is the most recent match
    let recentResults = currentStats.recent_results || 0;
    recentResults = (recentResults << 1) | (won ? 1 : 0); // Shift left and add new result
    recentResults = recentResults & 0x3FF; // Keep only 10 bits (0x3FF = 1023)
    newStats.recent_results = recentResults;
    
    return newStats;
  }

  /**
   * Record a tournament win for the champion performer.
   * Fetches fresh stats from the server to avoid overwriting match updates,
   * then increments tournament_wins.
   * @param {Object} champion - The tournament winner performer object
   */
  async function recordTournamentWin(champion) {
    if (!champion || !champion.id) return;

    try {
      // Fetch fresh performer data to get current stats (match updates during the tournament)
      const freshQuery = `
        query FindPerformer($id: ID!) {
          findPerformer(id: $id) {
            id
            custom_fields
          }
        }
      `;
      const freshResult = await graphqlQuery(freshQuery, { id: champion.id });
      const freshPerformer = freshResult.findPerformer;
      if (!freshPerformer) {
        console.warn("[HotOrNot] Could not fetch fresh performer data for tournament win recording");
        return;
      }

      const currentStats = parsePerformerEloData(freshPerformer);
      const updatedStats = {
        total_matches: currentStats.total_matches,
        wins: currentStats.wins,
        losses: currentStats.losses,
        draws: currentStats.draws,
        current_streak: currentStats.current_streak,
        best_streak: currentStats.best_streak,
        worst_streak: currentStats.worst_streak,
        last_match: currentStats.last_match,
        recent_results: currentStats.recent_results,
        last_rating_change: currentStats.last_rating_change,
        tournament_wins: (currentStats.tournament_wins || 0) + 1
      };

      const mutation = `
        mutation UpdatePerformerTournamentWins($id: ID!, $fields: Map) {
          performerUpdate(input: {
            id: $id,
            custom_fields: {
              partial: $fields
            }
          }) {
            id
            custom_fields
          }
        }
      `;

      await graphqlQuery(mutation, {
        id: champion.id,
        fields: { hotornot_stats: JSON.stringify(updatedStats) }
      });
      console.log(`[HotOrNot] Recorded tournament win for ${champion.name} (${updatedStats.tournament_wins} total)`);
    } catch (e) {
      console.error("[HotOrNot] Failed to record tournament win:", e);
    }
  }

  /**
   * Get confidence level based on match count.
   * Returns an object with emoji, label, and match count.
   * @param {Object} stats - Stats object from parsePerformerEloData
   * @returns {Object} Confidence indicator with emoji, label, and matches
   */
  function getConfidenceLevel(stats) {
    const matches = stats.total_matches || 0;
    if (matches < 10) {
      return { emoji: "⚡", label: "New", matches };
    } else if (matches < 30) {
      return { emoji: "📊", label: "Growing", matches };
    } else {
      return { emoji: "✅", label: "Established", matches };
    }
  }

  /**
   * Calculate rating confidence interval based on match count.
   * More matches = narrower confidence interval (more reliable rating).
   * @param {number} rating - Current rating (1-100)
   * @param {number} matchCount - Number of matches played
   * @returns {Object} Object with low, high bounds and match count
   */
  function getRatingConfidenceInterval(rating, matchCount) {
    const matches = matchCount || 0;
    const baseUncertainty = 15;
    const uncertainty = Math.round(baseUncertainty / Math.sqrt(Math.max(1, matches)));
    
    return {
      low: Math.max(1, rating - uncertainty),
      high: Math.min(100, rating + uncertainty),
      matches: matches
    };
  }

  /**
   * Calculate skip/draw rate for a performer.
   * High skip rate indicates a "controversial" performer users have trouble deciding on.
   * @param {Object} stats - Stats object from parsePerformerEloData
   * @returns {number} Skip rate as decimal (0-1)
   */
  function getSkipRate(stats) {
    if (!stats || stats.total_matches === 0) return 0;
    return (stats.draws || 0) / stats.total_matches;
  }

  /**
   * Check if a performer is "controversial" based on skip rate.
   * Controversial performers are skipped more than 30% of the time.
   * @param {Object} stats - Stats object from parsePerformerEloData
   * @returns {boolean} True if performer is controversial
   */
  function isControversialPerformer(stats) {
    return getSkipRate(stats) > 0.3;
  }

  // Constants for streak-based adjustments
  const STREAK_THRESHOLD_MODERATE = 3;  // Streak length to trigger moderate bonus
  const STREAK_THRESHOLD_STRONG = 5;    // Streak length to trigger strong bonus
  const STREAK_RATING_MULTIPLIER = 2;   // Rating points adjustment per streak count
  const BIG_LOSS_THRESHOLD = 4;         // Rating point loss that triggers recovery matchmaking boost
  const BIG_LOSS_WEIGHT_MODERATE = 2.0;  // Weight boost for moderate big loss (4-5 points)
  const BIG_LOSS_WEIGHT_STRONG = 2.5;    // Weight boost for strong big loss (6-7 points)
  const BIG_LOSS_WEIGHT_SEVERE = 3.0;    // Weight boost for severe big loss (8+ points)

  /**
   * Calculate streak-based weight modifier for matchmaking.
   * Performers on streaks (hot or cold) get a weight bonus to give 
   * opportunities to continue or break their streaks.
   * @param {Object} stats - Stats object from parsePerformerEloData
   * @returns {number} Weight multiplier (1.0 = no bonus, higher = more likely to be selected)
   */
  function getStreakWeight(stats) {
    const streak = stats.current_streak || 0;
    const absStreak = Math.abs(streak);
    
    // No bonus for performers without significant streaks
    if (absStreak < STREAK_THRESHOLD_MODERATE) {
      return 1.0;
    }
    
    // Strong streak bonus (5+): 1.5x weight
    // Moderate streak bonus (3-4): 1.3x weight
    // This gives streaking performers slightly higher chance to be selected
    // so their streak can either continue or be broken
    if (absStreak >= STREAK_THRESHOLD_STRONG) {
      return 1.5;
    } else {
      return 1.3;
    }
  }

  /**
   * Get a streak indicator icon based on current streak.
   * @param {number} streak - Current streak (positive = winning, negative = losing)
   * @returns {string} Icon string or empty string if no significant streak
   */
  function getStreakIcon(streak) {
    if (streak >= STREAK_THRESHOLD_MODERATE) return "🔥"; // Hot streak
    if (streak <= -STREAK_THRESHOLD_MODERATE) return "❄️"; // Cold streak
    return "";
  }

  /**
   * Get performance trend from recent results bitmask.
   * Compares recent win rate to overall win rate.
   * @param {Object} stats - Stats object from parsePerformerEloData
   * @returns {Object} Object with trend string and emoji
   */
  function getPerformanceTrend(stats) {
    if (!stats.recent_results || stats.total_matches < 5) {
      return { trend: "new", emoji: "⚡", label: "New" };
    }
    
    // Count wins in recent results using Brian Kernighan's bit counting algorithm
    let recentWins = 0;
    let n = stats.recent_results;
    while (n) {
      recentWins++;
      n &= n - 1; // Clear the least significant set bit
    }
    
    const recentMatches = Math.min(10, stats.total_matches);
    const recentWinRate = recentWins / recentMatches;
    const overallWinRate = stats.wins / stats.total_matches;
    
    if (recentWinRate > overallWinRate + 0.2) {
      return { trend: "rising", emoji: "📈", label: "Rising" };
    }
    if (recentWinRate < overallWinRate - 0.2) {
      return { trend: "falling", emoji: "📉", label: "Falling" };
    }
    return { trend: "stable", emoji: "📊", label: "Stable" };
  }

  /**
   * Adjust rating difference based on scene count ratio between two performers.
   * When the loser has more scenes, the effective rating gap is increased, making
   * the win a bigger "upset" and worth more points. When the winner has more scenes,
   * the gap shrinks (expected result against a less-proven performer).
   * Each doubling of the scene count ratio adjusts the effective diff by up to 2 points,
   * capped at ±6 to prevent extreme swings.
   * @param {number} baseDiff - Raw rating difference (loserRating - winnerRating)
   * @param {number|null} winnerSceneCount - Winner's scene count (null if unavailable)
   * @param {number|null} loserSceneCount - Loser's scene count (null if unavailable)
   * @returns {number} Adjusted rating difference
   */
  function getSceneAdjustedDiff(baseDiff, winnerSceneCount, loserSceneCount) {
    if (!winnerSceneCount && !loserSceneCount) return baseDiff;

    const winScenes = Math.max(1, winnerSceneCount || 1);
    const losScenes = Math.max(1, loserSceneCount || 1);

    // Positive when loser has more scenes (upset against proven performer)
    const sceneRatio = Math.log2(losScenes / winScenes);

    // Cap adjustment at ±6 rating points to keep changes reasonable
    const adjustment = Math.max(-6, Math.min(6, sceneRatio * 2));

    return baseDiff + adjustment;
  }

  /**
   * Calculate K-factor based on match count (experience) and scene count.
   * Calibration mode uses full USCF/FIDE K-factors and skips scene dampening
   * for unrestricted rating movement during binary search placement.
   * @param {number} currentRating - Current ELO rating
   * @param {number} matchCount - Number of matches played
   * @param {string} mode - Current game mode ("swiss", "calibration", or "tournament")
   * @param {number} sceneCount - Number of scenes the performer is in (performers only)
   * @returns {number} K-factor value
   */
  function getKFactor(currentRating, matchCount = null, mode = "swiss", sceneCount = null) {
    let baseKFactor;
    
    // Calibration mode uses full USCF/FIDE K-factors for unrestricted rating movement.
    // This lets performers reach their true rating faster during binary search placement.
    const isCalibration = mode === "calibration";

    if (matchCount !== null && matchCount !== undefined) {
      if (isCalibration) {
        // Full USCF/FIDE K-factors — no reduction for calibration
        if (matchCount < 10) {
          baseKFactor = 32;
        } else if (matchCount < 30) {
          baseKFactor = 24;
        } else {
          baseKFactor = 16;
        }
      } else {
        // Swiss/tournament: Reduced K-factor ranges for slower, stable rating changes
        if (matchCount < 10) {
          baseKFactor = 16;
        } else if (matchCount < 30) {
          baseKFactor = 12;
        } else {
          baseKFactor = 8;
        }
      }
    } else {
      // Fallback to rating-based heuristic (legacy behavior)
      // Items near the default rating (50) are likely less established
      // Items far from 50 have likely had more comparisons
      const distanceFromDefault = Math.abs(currentRating - 50);
      
      if (isCalibration) {
        // Full K-factors for calibration fallback
        if (distanceFromDefault < 10) {
          baseKFactor = 24;
        } else if (distanceFromDefault < 25) {
          baseKFactor = 20;
        } else {
          baseKFactor = 16;
        }
      } else {
        if (distanceFromDefault < 10) {
          baseKFactor = 14;
        } else if (distanceFromDefault < 25) {
          baseKFactor = 10;
        } else {
          baseKFactor = 8;
        }
      }
    }
    
    // Apply scene count weighting for performers (Swiss/tournament only)
    // Calibration skips this — performers need full movement to converge quickly
    if (!isCalibration && sceneCount !== null && sceneCount !== undefined && sceneCount > 0) {
      let sceneMultiplier = 1.0;
      
      if (sceneCount >= 100) {
        sceneMultiplier = 0.6;
      } else if (sceneCount >= 50) {
        sceneMultiplier = 0.7;
      } else if (sceneCount >= 20) {
        sceneMultiplier = 0.85;
      } else if (sceneCount >= 10) {
        sceneMultiplier = 0.9;
      }
      
      baseKFactor = Math.max(4, Math.round(baseKFactor * sceneMultiplier));
    }
    
    return baseKFactor;
  }

  /**
   * Apply diminishing returns for rating gains at higher ratings.
   * Makes it progressively harder to reach 100 - the closer you are to 100,
   * the less points you gain from a win.
   * @param {number} currentRating - Current rating (1-100)
   * @param {number} baseGain - Base rating gain calculated from ELO formula
   * @returns {number} Adjusted gain with diminishing returns applied
   */
  function applyDiminishingReturns(currentRating, baseGain) {
    if (baseGain <= 0) return baseGain;
    
    // Calculate how close we are to the ceiling (100)
    // The multiplier decreases as we approach 100
    // At rating 50: multiplier = 1.0 (full gain)
    // At rating 75: multiplier = 0.25
    // At rating 90: multiplier = 0.04
    // At rating 95: multiplier = 0.01
    const distanceFromCeiling = 100 - currentRating;
    
    // Use a quadratic curve for smooth diminishing returns
    // Formula: multiplier = (distance / 50)^2, clamped between 0 and 1
    // This creates a smooth curve that gets progressively steeper near 100
    const multiplier = Math.min(1, Math.pow(distanceFromCeiling / 50, 2));
    
    // Ensure at least 1 point can be gained if baseGain > 0 and not at the absolute ceiling
    const adjustedGain = Math.round(baseGain * multiplier);
    
    // At rating 100, no more gains possible
    if (currentRating >= 100) return 0;
    
    // Otherwise ensure at least 1 point gain when baseGain > 0
    return Math.max(1, adjustedGain);
  }

  async function handleComparison(winnerId, loserId, winnerCurrentRating, loserCurrentRating, loserRank = null, winnerObj = null, loserObj = null) {
    const winnerRating = winnerCurrentRating || 50;
    const loserRating = loserCurrentRating || 50;
    
    const ratingDiff = loserRating - winnerRating;
    
    // Fetch fresh performer data to ensure we have current stats
    // This prevents stats from being overwritten when performers have consecutive matches
    let freshWinnerObj = winnerObj;
    let freshLoserObj = loserObj;
    
    if (battleType === "performers") {
      // Fetch both performers in parallel for better performance
      const [fetchedWinner, fetchedLoser] = await Promise.all([
        (winnerObj && winnerId) ? fetchPerformerById(winnerId) : Promise.resolve(null),
        (loserObj && loserId) ? fetchPerformerById(loserId) : Promise.resolve(null)
      ]);
      
      freshWinnerObj = fetchedWinner || winnerObj;
      freshLoserObj = fetchedLoser || loserObj;
    }
    
    // Parse match counts from custom fields (only for performers)
    let winnerMatchCount = null;
    let loserMatchCount = null;
    // Extract scene counts for K-factor weighting (performers only)
    let winnerSceneCount = null;
    let loserSceneCount = null;
    
    if (battleType === "performers" && freshWinnerObj) {
      const winnerStats = parsePerformerEloData(freshWinnerObj);
      winnerMatchCount = winnerStats.total_matches;
      winnerSceneCount = freshWinnerObj.scene_count || null;
    }
    if (battleType === "performers" && freshLoserObj) {
      const loserStats = parsePerformerEloData(freshLoserObj);
      loserMatchCount = loserStats.total_matches;
      loserSceneCount = freshLoserObj.scene_count || null;
    }
    
    // Adjust rating diff using scene counts so that beating a more "proven"
    // performer (higher scene count) is treated as a bigger upset and worth more
    const adjustedRatingDiff = getSceneAdjustedDiff(ratingDiff, winnerSceneCount, loserSceneCount);
    
    // True ELO with zero-sum property
    // Both performers change by the same amount to maintain rating pool integrity
    const expectedWinner = 1 / (1 + Math.pow(10, adjustedRatingDiff / 40));
    
    // Use individual K-factors but average them for the match
    // This maintains fairness while preserving zero-sum property
    const winnerK = getKFactor(winnerRating, winnerMatchCount, currentMode, winnerSceneCount);
    const loserK = getKFactor(loserRating, loserMatchCount, currentMode, loserSceneCount);
    const avgK = (winnerK + loserK) / 2;
    
    // Calculate single rating change for zero-sum (winner gains what loser loses)
    const baseChange = Math.max(0, Math.round(avgK * (1 - expectedWinner)));
    
    // Calibration mode uses asymmetric rating changes:
    // Winners rise aggressively toward the defeated performer's level,
    // while losers are cushioned to prevent dropping lower than they deserve.
    // Swiss/tournament mode stays zero-sum with diminishing returns.
    let winnerGain, loserLoss;
    if (currentMode === "calibration") {
      if (baseChange <= 0) {
        winnerGain = 0;
        loserLoss = 0;
      } else {
        // Soft ceiling dampening: full gain below rating 80, then linear taper
        // to 15% at rating 100. Prevents too many performers clustering at 100.
        const ceilingFactor = winnerRating < 80 ? 1.0 : Math.max(0.15, (100 - winnerRating) / 20);
        winnerGain = Math.max(1, Math.round(baseChange * ceilingFactor));

        // Loser drops at 40% rate — prioritizes winner rising over loser falling
        loserLoss = Math.max(1, Math.round(baseChange * 0.4));
      }
    } else {
      winnerGain = applyDiminishingReturns(winnerRating, baseChange);
      loserLoss = winnerGain; // Zero-sum: loser loses exactly what winner gains
    }
    
    let newWinnerRating = Math.min(100, Math.max(1, winnerRating + winnerGain));
    let newLoserRating = Math.min(100, Math.max(1, loserRating - loserLoss));
    
    // Ensure the winner moves to at least the same ranking as the loser (or higher)
    // If the ELO movement alone doesn't achieve this, adjust the ratings to ensure
    // the winner ranks above the loser after a direct head-to-head victory
    if (newWinnerRating < newLoserRating) {
      // The winner beat the loser head-to-head, so they should rank higher
      // Set winner's rating to 1 point above loser's new rating
      // If that would exceed 100, also reduce the loser's rating to make room
      if (newLoserRating === 100) {
        // Loser is at ceiling, so reduce loser by 1 to make room for winner
        newLoserRating = 99;
        newWinnerRating = 100;
      } else {
        newWinnerRating = newLoserRating + 1;
      }
    }
    
    const winnerChange = newWinnerRating - winnerRating;
    const loserChange = newLoserRating - loserRating;
    
    // All participants get full stats tracked
    const shouldTrackWinner = battleType === "performers" && !!freshWinnerObj;
    const shouldTrackLoser = battleType === "performers" && !!freshLoserObj;
    
    // Update items in Stash
    const updatePromises = [];
    
    // Winner updates
    if (winnerChange !== 0 || shouldTrackWinner) {
      updatePromises.push(updateItemRating(winnerId, newWinnerRating, shouldTrackWinner ? freshWinnerObj : null, shouldTrackWinner ? true : null, winnerChange));
    }
    
    // Loser updates
    if (loserChange !== 0 || shouldTrackLoser) {
      updatePromises.push(updateItemRating(loserId, newLoserRating, shouldTrackLoser ? freshLoserObj : null, shouldTrackLoser ? false : null, loserChange));
    }
    
    // Wait for all rating updates to complete before returning
    // This prevents race conditions where the next pair is loaded before ratings are saved
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
    
    return { newWinnerRating, newLoserRating, winnerChange, loserChange };
  }
  
  /**
   * Handle skip as an ELO draw between two items.
   * In standard ELO, a draw gives both players a score of 0.5 (instead of 1 for win, 0 for loss).
   * Rating change = K * (0.5 - Expected)
   * - If higher-rated item draws with lower-rated: higher loses points, lower gains
   * - If equally-rated items draw: no change
   * @param {Object} leftItem - Left item in the comparison
   * @param {Object} rightItem - Right item in the comparison
   */
  async function handleSkip(leftItem, rightItem) {
    if (!leftItem || !rightItem) {
      console.log("[HotOrNot] Skip: Missing items, no rating update");
      return;
    }
    
    const leftRating = leftItem.rating100 || 50;
    const rightRating = rightItem.rating100 || 50;
    
    // Fetch fresh performer data to ensure we have current stats
    let freshLeftItem = leftItem;
    let freshRightItem = rightItem;
    
    if (battleType === "performers") {
      const [fetchedLeft, fetchedRight] = await Promise.all([
        fetchPerformerById(leftItem.id),
        fetchPerformerById(rightItem.id)
      ]);
      freshLeftItem = fetchedLeft || leftItem;
      freshRightItem = fetchedRight || rightItem;
    }
    
    // Parse match counts for K-factor calculation
    let leftMatchCount = null;
    let rightMatchCount = null;
    let leftSceneCount = null;
    let rightSceneCount = null;
    
    if (battleType === "performers" && freshLeftItem) {
      const leftStats = parsePerformerEloData(freshLeftItem);
      leftMatchCount = leftStats.total_matches;
      leftSceneCount = freshLeftItem.scene_count || null;
    }
    if (battleType === "performers" && freshRightItem) {
      const rightStats = parsePerformerEloData(freshRightItem);
      rightMatchCount = rightStats.total_matches;
      rightSceneCount = freshRightItem.scene_count || null;
    }
    
    // Calculate expected scores for both items
    // Rating diff from left's perspective: (rightRating - leftRating)
    // Adjust for scene counts so draws between performers with different scene
    // counts still reflect the "proven-ness" of each performer
    const ratingDiffLeft = getSceneAdjustedDiff(
      rightRating - leftRating, leftSceneCount, rightSceneCount
    );
    const expectedLeft = 1 / (1 + Math.pow(10, ratingDiffLeft / 40));
    const expectedRight = 1 - expectedLeft;
    
    // Get K-factors for both items
    const leftK = getKFactor(leftRating, leftMatchCount, currentMode, leftSceneCount);
    const rightK = getKFactor(rightRating, rightMatchCount, currentMode, rightSceneCount);
    
    // Draw gives score of 0.5 to both
    // Change = K * (0.5 - Expected)
    // If Expected > 0.5 (favorite), you lose rating for drawing
    // If Expected < 0.5 (underdog), you gain rating for drawing
    let leftChange = Math.round(leftK * (0.5 - expectedLeft));
    let rightChange = Math.round(rightK * (0.5 - expectedRight));
    
    // Ensure there's a minimum effect when there's a significant rating difference
    // If ratings differ by at least 5 points, ensure at least a 1-point change
    // This prevents "skip does nothing" when there's a noticeable rating gap
    const ratingDiff = Math.abs(leftRating - rightRating);
    if (ratingDiff >= 5 && leftChange === 0 && rightChange === 0) {
      // Higher rated performer should lose 1 point, lower rated gains 1 point
      if (leftRating > rightRating) {
        leftChange = -1;
        rightChange = 1;
      } else {
        leftChange = 1;
        rightChange = -1;
      }
    }
    
    const newLeftRating = Math.min(100, Math.max(1, leftRating + leftChange));
    const newRightRating = Math.min(100, Math.max(1, rightRating + rightChange));
    
    console.log(`[HotOrNot] Skip (Draw): Left ${leftRating} -> ${newLeftRating} (${leftChange >= 0 ? '+' : ''}${leftChange}), Right ${rightRating} -> ${newRightRating} (${rightChange >= 0 ? '+' : ''}${rightChange})`);
    
    // Update ratings and stats for both items
    if (battleType === "performers") {
      // Update left item with draw stats
      if (leftChange !== 0 || freshLeftItem) {
        await updateItemRating(leftItem.id, newLeftRating, freshLeftItem, "draw", leftChange);
      }
      // Update right item with draw stats
      if (rightChange !== 0 || freshRightItem) {
        await updateItemRating(rightItem.id, newRightRating, freshRightItem, "draw", rightChange);
      }
    } else {
      // For images, only update if rating changed
      if (leftChange !== 0) {
        await updateItemRating(leftItem.id, newLeftRating);
      }
      if (rightChange !== 0) {
        await updateItemRating(rightItem.id, newRightRating);
      }
    }
    
    return { 
      leftRating: newLeftRating, 
      rightRating: newRightRating,
      leftChange,
      rightChange
    };
  }
  


  // ============================================
  // PERFORMER FUNCTIONS
  // ============================================

async function fetchPerformerCount(performerFilter = {}) {
    const countQuery = `
      query FindPerformers($performer_filter: PerformerFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: { per_page: 0 }) {
          count
        }
      }
    `;
    const countResult = await graphqlQuery(countQuery, { performer_filter: performerFilter });
    return countResult.findPerformers.count;
  }

  function getPerformerFilter() {
    // Start with URL filters from the current page (cached when modal opens)
    const urlFilter = cachedUrlFilter || {};
    const filter = { ...urlFilter };
    
    // Apply default filters only when no other filters are selected
    // Check if urlFilter is empty (no user-applied filters)
    const hasUserFilters = Object.keys(urlFilter).length > 0;
    
    if (!hasUserFilters) {
      // Exclude male performers by default
      filter.gender = {
        value_list: ["MALE"],
        modifier: "EXCLUDES"
      };
      
      // Exclude performers with missing default image
      // Use NOT wrapper to invert the is_missing filter
      filter.NOT = {
        is_missing: "image"
      };
    }
    
    return filter;
  }

  async function fetchRandomPerformers(count = 2) {
  const performerFilter = getPerformerFilter();
  const totalPerformers = await fetchPerformerCount(performerFilter);
  if (totalPerformers < 2) {
    throw new Error("Not enough performers for comparison. You need at least 2 non-male performers.");
  }

  const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
    performer_filter: performerFilter,
    filter: {
      per_page: Math.min(100, totalPerformers),
      sort: "random"
    }
  });

  const allPerformers = result.findPerformers.performers || [];
  
  if (allPerformers.length < 2) {
    throw new Error("Not enough performers for comparison. You need at least 2 performers.");
  }

  const shuffled = allPerformers.sort(() => Math.random() - 0.5);
  const performer1 = shuffled[0];
  const performer2 = shuffled[1];
  return [performer1, performer2];
}

  /**
   * Fetch the latest performer data by ID to get current stats
   * @param {string} performerId - ID of the performer to fetch
   * @returns {Object|null} Performer object with latest data from database, or null if not found
   */
  async function fetchPerformerById(performerId) {
    // Validate performerId is a valid non-empty string
    if (!performerId?.trim?.()) {
      return null;
    }
    
    const performerQuery = `
      query FindPerformer($id: ID!) {
        findPerformer(id: $id) {
          ${PERFORMER_FRAGMENT}
        }
      }
    `;
    
    try {
      const result = await graphqlQuery(performerQuery, { id: performerId });
      return result.findPerformer || null;
    } catch (error) {
      console.error(`[HotOrNot] Error fetching performer ${performerId}:`, error);
      return null;
    }
  }

  /**
   * Calculate a weight for performer selection based on last match time and match count.
   * Performers with fewer matches and older last matches get higher weights (more likely to be selected).
   * Returns a weight between 0.1 and 3.0 to prioritize undersampled performers.
   * @param {Object} performer - Performer object with custom_fields
   * @returns {number} Weight value between 0.1 and 3.0
   */
  function getRecencyWeight(performer) {
    const stats = parsePerformerEloData(performer);
    
    // Calculate match count weight component
    // Performers with fewer matches get higher weights
    // 0 matches: weight = 3.0 (highest priority - never been matched)
    // 1-5 matches: weight = 2.0 (high priority)
    // 6-15 matches: weight = 1.5 (moderate priority)
    // 16-30 matches: weight = 1.0 (normal priority)
    // 30+ matches: weight = 0.5 (low priority - well established)
    let matchCountWeight;
    if (stats.total_matches === 0) {
      matchCountWeight = 3.0;
    } else if (stats.total_matches <= 5) {
      matchCountWeight = 2.0;
    } else if (stats.total_matches <= 15) {
      matchCountWeight = 1.5;
    } else if (stats.total_matches <= 30) {
      matchCountWeight = 1.0;
    } else {
      matchCountWeight = 0.5;
    }
    
    // Calculate recency weight component
    let recencyWeight = 1.0;
    
    if (stats.last_match) {
      try {
        const lastMatchDate = new Date(stats.last_match);
        
        // Check for invalid date
        if (!isNaN(lastMatchDate.getTime())) {
          const lastMatchTime = lastMatchDate.getTime();
          const now = Date.now();
          const hoursSinceMatch = (now - lastMatchTime) / (1000 * 60 * 60);
          
          // Weight calculation:
          // 0-1 hours ago: weight = 0.1 (very unlikely)
          // 1-6 hours ago: weight = 0.3 (less likely)
          // 6-24 hours ago: weight = 0.6 (moderately likely)
          // 24+ hours ago: weight = 1.0 (full probability)
          
          if (hoursSinceMatch < 1) {
            recencyWeight = 0.1;
          } else if (hoursSinceMatch < 6) {
            recencyWeight = 0.3;
          } else if (hoursSinceMatch < 24) {
            recencyWeight = 0.6;
          } else {
            recencyWeight = 1.0;
          }
        }
      } catch (e) {
        // If date parsing fails, use default recency weight
        console.warn(`[HotOrNot] Failed to parse last_match for performer ${performer.id}:`, e);
      }
    }
    
    // Calculate streak weight component
    // Performers on streaks get a bonus to give opportunities for streak continuation/breaking
    const streakWeight = getStreakWeight(stats);
    
    // Calculate big loss recovery weight component
    // Performers who just had a big rating drop get a boost to come back into matches
    // sooner, giving them a chance to recover their position
    let bigLossRecoveryWeight = 1.0;
    const lastChange = stats.last_rating_change || 0;
    if (lastChange <= -BIG_LOSS_THRESHOLD) {
      // Scale the boost based on how big the loss was
      const lossSize = -lastChange;
      if (lossSize >= 8) {
        bigLossRecoveryWeight = BIG_LOSS_WEIGHT_SEVERE;
      } else if (lossSize >= 6) {
        bigLossRecoveryWeight = BIG_LOSS_WEIGHT_STRONG;
      } else {
        bigLossRecoveryWeight = BIG_LOSS_WEIGHT_MODERATE;
      }
    }
    
    // Combine weights: multiply all factors together
    // This ensures match count, recency, streak, and big loss recovery all contribute
    // to the final selection probability
    return matchCountWeight * recencyWeight * streakWeight * bigLossRecoveryWeight;
  }

  /**
   * Select a weighted random item from an array based on weights.
   * @param {Array} items - Array of items to choose from
   * @param {Array} weights - Array of weights (same length as items)
   * @returns {Object|null} Selected item, or null if validation fails
   */
  function weightedRandomSelect(items, weights) {
    // Input validation
    if (!items || !weights || items.length === 0 || weights.length === 0) {
      console.error("[HotOrNot] weightedRandomSelect called with empty arrays");
      return null;
    }
    
    if (items.length !== weights.length) {
      console.error("[HotOrNot] weightedRandomSelect: items and weights arrays have different lengths");
      return null;
    }
    
    // Validate that all weights are numeric
    if (!weights.every(w => typeof w === 'number' && !isNaN(w))) {
      console.error("[HotOrNot] weightedRandomSelect: weights array contains non-numeric values");
      return null;
    }
    
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    // Handle edge case of all zero or negative weights
    if (totalWeight <= 0) {
      console.error("[HotOrNot] Total weight is zero or negative - this indicates a logic error");
      return items[Math.floor(Math.random() * items.length)];
    }
    
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }
    
    // Fallback to last item if rounding errors occur
    return items[items.length - 1];
  }

  // Swiss mode: fetch two performers with similar ratings
  async function fetchSwissPairPerformers() {
    const performerFilter = getPerformerFilter();

    // Get all performers for accurate ranking
    const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];
    
    if (performers.length < 2) {
      // Fallback to random if not enough rated performers
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }

    // Calculate weights once and cache them with indices
    const performersWithWeights = performers.map((p, idx) => ({
      performer: p,
      weight: getRecencyWeight(p),
      index: idx
    }));
    
    // Pick a random performer, weighted by recency to avoid repetition
    const weights = performersWithWeights.map(pw => pw.weight);
    const selected1 = weightedRandomSelect(performersWithWeights, weights);
    
    // Fallback to pure random if weighted selection fails
    if (!selected1) {
      console.warn("[HotOrNot] Weighted selection failed, falling back to random");
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }
    
    const performer1 = selected1.performer;
    const randomIndex = selected1.index;
    const rating1 = performer1.rating100 || 50;

    // 10% "Sanity Check" - randomly pair regardless of rating
    // This helps detect performers stuck in incorrect rating silos
    // by occasionally testing them against performers from different rating tiers
    const isRandomSanityCheck = Math.random() < 0.10;
    
    if (isRandomSanityCheck) {
      // Pick any random performer (excluding performer1)
      let otherPerformers = performersWithWeights.filter(pw => pw.performer.id !== performer1.id);
      if (otherPerformers.length > 0) {
        const randomOpponent = otherPerformers[Math.floor(Math.random() * otherPerformers.length)];
        console.log('[HotOrNot] Sanity check pairing: random matchup regardless of rating');
        return { 
          performers: [performer1, randomOpponent.performer], 
          ranks: [randomIndex + 1, randomOpponent.index + 1] 
        };
      }
    }

    // Get streak-adjusted target rating for opponent selection
    // If performer is on a hot streak, look for opponents ABOVE their rating
    // If performer is on a cold streak, look for opponents BELOW their rating
    // This helps accelerate rating convergence and makes streaks more interesting
    const stats1 = parsePerformerEloData(performer1);
    const streak1 = stats1.current_streak || 0;
    let targetRating = rating1;
    
    if (Math.abs(streak1) >= STREAK_THRESHOLD_MODERATE) {
      // Streak bonus/penalty: up to ±10 rating points based on streak magnitude
      const maxStreakAdjustment = 10;
      const streakAdjustment = Math.min(Math.abs(streak1) * STREAK_RATING_MULTIPLIER, maxStreakAdjustment);
      if (streak1 > 0) {
        // Hot streak: look for slightly tougher opponents
        targetRating = rating1 + streakAdjustment;
        console.log(`[HotOrNot] Hot streak (${streak1}): targeting opponents near rating ${targetRating} (+${streakAdjustment})`);
      } else {
        // Cold streak: look for slightly easier opponents
        targetRating = rating1 - streakAdjustment;
        console.log(`[HotOrNot] Cold streak (${streak1}): targeting opponents near rating ${targetRating} (-${streakAdjustment})`);
      }
    }

    // Find performers within adaptive rating window (tighter for larger pools)
    // Window is centered on targetRating (which may be streak-adjusted)
    const matchWindow = performers.length > 50 ? 10 : performers.length > 20 ? 15 : 25;
    let similarPerformersWithWeights = performersWithWeights.filter(pw => {
      if (pw.performer.id === performer1.id) return false;
      const rating = pw.performer.rating100 || 50;
      return Math.abs(rating - targetRating) <= matchWindow;
    });

    let performer2;
    let performer2Index;
    if (similarPerformersWithWeights.length > 0) {
      // Pick from similar-rated performers, using cached weights
      const similarWeights = similarPerformersWithWeights.map(pw => pw.weight);
      const selected2 = weightedRandomSelect(similarPerformersWithWeights, similarWeights);
      
      // Fallback to pure random if weighted selection fails
      if (!selected2) {
        console.warn("[HotOrNot] Weighted selection for performer2 failed, falling back to random");
        const randomSimilar = similarPerformersWithWeights[Math.floor(Math.random() * similarPerformersWithWeights.length)];
        performer2 = randomSimilar.performer;
        performer2Index = randomSimilar.index;
      } else {
        performer2 = selected2.performer;
        performer2Index = selected2.index;
      }
    } else {
      // No similar performers within window, pick closest to targetRating with recency weighting
      let otherPerformersWithWeights = performersWithWeights.filter(pw => pw.performer.id !== performer1.id);

      // Sort by rating similarity to targetRating (which may be streak-adjusted)
      otherPerformersWithWeights.sort((a, b) => {
        const diffA = Math.abs((a.performer.rating100 || 50) - targetRating);
        const diffB = Math.abs((b.performer.rating100 || 50) - targetRating);
        return diffA - diffB;
      });
      
      // Apply weighted selection to the top 3 closest performers (if available)
      const closestCount = Math.min(3, otherPerformersWithWeights.length);
      const closestPerformers = otherPerformersWithWeights.slice(0, closestCount);
      const closestWeights = closestPerformers.map(pw => pw.weight);
      const selected2 = weightedRandomSelect(closestPerformers, closestWeights);
      
      if (selected2) {
        performer2 = selected2.performer;
        performer2Index = selected2.index;
      } else {
        // Ultimate fallback - just pick the closest
        console.warn("[HotOrNot] Weighted selection for closest performer failed, using rating-based fallback");
        performer2 = otherPerformersWithWeights[0].performer;
        performer2Index = otherPerformersWithWeights[0].index;
      }
    }

    return { 
      performers: [performer1, performer2], 
      ranks: [randomIndex + 1, performer2Index + 1] 
    };
  }

  // ============================================
  // IMAGE FUNCTIONS
  // ============================================

  async function fetchImageCount() {
    const countQuery = `
      query FindImages {
        findImages(filter: { per_page: 0 }) {
          count
        }
      }
    `;
    const countResult = await graphqlQuery(countQuery);
    return countResult.findImages.count;
  }

  async function fetchRandomImages(count = 2) {
    const totalImages = await fetchImageCount();
    if (totalImages < 2) {
      throw new Error("Not enough images for comparison. You need at least 2 images.");
    }

    const imagesQuery = `
      query FindRandomImages($filter: FindFilterType) {
        findImages(filter: $filter) {
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: Math.min(100, totalImages),
        sort: "random"
      }
    });

    const allImages = result.findImages.images || [];
    
    if (allImages.length < 2) {
      throw new Error("Not enough images returned from query.");
    }

    const shuffled = allImages.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  }

  // Swiss mode: fetch two images with similar ratings
  async function fetchSwissPairImages() {
    // For large image pools (>1000), use sampling for performance
    // For smaller pools, still get all for accurate ranking
    const totalImages = await fetchImageCount();
    const useSampling = totalImages > 1000;
    const sampleSize = useSampling ? Math.min(500, totalImages) : totalImages;
    
    const imagesQuery = `
      query FindImagesByRating($filter: FindFilterType) {
        findImages(filter: $filter) {
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    // Get images - either all or a random sample
    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: sampleSize,
        sort: useSampling ? "random" : "rating",
        direction: useSampling ? undefined : "DESC"
      }
    });

    const images = result.findImages.images || [];
    
    if (images.length < 2) {
      // Fallback to random if not enough rated images
      return { images: await fetchRandomImages(2), ranks: [null, null] };
    }

    // Pick a random image, then find one with similar rating
    const randomIndex = Math.floor(Math.random() * images.length);
    const image1 = images[randomIndex];
    const rating1 = image1.rating100 || 50;

    // Find images within adaptive rating window (tighter for larger pools)
    const matchWindow = images.length > 50 ? 10 : images.length > 20 ? 15 : 25;
    const similarImages = images.filter(s => {
      if (s.id === image1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= matchWindow;
    });

    let image2;
    let image2Index;
    if (similarImages.length > 0) {
      // Pick random from similar-rated images
      image2 = similarImages[Math.floor(Math.random() * similarImages.length)];
      image2Index = images.findIndex(s => s.id === image2.id);
    } else {
      // No similar images, pick closest
      const otherImages = images.filter(s => s.id !== image1.id);
      otherImages.sort((a, b) => {
        const diffA = Math.abs((a.rating100 || 50) - rating1);
        const diffB = Math.abs((b.rating100 || 50) - rating1);
        return diffA - diffB;
      });
      image2 = otherImages[0];
      image2Index = images.findIndex(s => s.id === image2.id);
    }

    return { 
      images: [image1, image2], 
      // When using sampling, ranks are not meaningful (don't represent true position)
      ranks: useSampling ? [null, null] : [randomIndex + 1, image2Index + 1] 
    };
  }

  async function updateImageRating(imageId, newRating) {
    const mutation = `
      mutation ImageUpdate($input: ImageUpdateInput!) {
        imageUpdate(input: $input) {
          id
          rating100
        }
      }
    `;
    
    try {
      await graphqlQuery(mutation, {
        input: {
          id: imageId,
          rating100: Math.max(1, Math.min(100, Math.round(newRating)))
        }
      });
      console.log(`[HotOrNot] Updated image ${imageId} rating to ${newRating}`);
    } catch (e) {
      console.error(`[HotOrNot] Failed to update image ${imageId} rating:`, e);
    }
  }

  // ============================================
  // WRAPPER FUNCTIONS (Dispatch based on battleType)
  // ============================================

  async function fetchSwissPair() {
    if (battleType === "performers") {
      return await fetchSwissPairPerformers();
    } else {
      return await fetchSwissPairImages();
    }
  }

  // ============================================
  // CALIBRATION MODE — Binary-search placement against anchors
  // ============================================

  /**
   * Calculate confidence for a performer based on match count.
   * confidence = 1 - (1 / sqrt(matches + 1))
   * At 0 matches = 0.0, 3 matches ≈ 0.5, 15 matches ≈ 0.75, approaches 1.0 asymptotically
   * @param {number} matchCount - Number of matches played
   * @returns {number} Confidence value between 0 and 1
   */
  function getConfidence(matchCount) {
    return 1 - (1 / Math.sqrt((matchCount || 0) + 1));
  }

  /**
   * Format confidence as a percentage string with emoji indicator.
   * @param {number} confidence - Confidence value between 0 and 1
   * @returns {string} Formatted confidence like "📊 42%" or "💎 95%"
   */
  function formatConfidence(confidence) {
    const pct = Math.round(confidence * 100);
    if (pct >= 90) return `💎 ${pct}%`;
    if (pct >= 70) return `📈 ${pct}%`;
    if (pct >= 50) return `📊 ${pct}%`;
    return `🔍 ${pct}%`;
  }

  /**
   * Fetch a pair for calibration mode.
   * Picks the least-confident performer as the "target" and finds an anchor
   * performer near the binary-search midpoint of the target's estimated range.
   * @returns {Object} { performers, ranks, coverageInfo }
   */
  async function fetchCalibrationPairPerformers() {
    const performerFilter = getPerformerFilter();

    const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
      performer_filter: performerFilter,
      filter: { per_page: -1, sort: "rating", direction: "DESC" }
    });

    const performers = result.findPerformers.performers || [];

    if (performers.length < 2) {
      return { performers: await fetchRandomPerformers(2), ranks: [null, null], coverageInfo: null };
    }

    // Parse stats for all performers and compute confidence
    const withStats = performers.map((p, idx) => {
      const stats = parsePerformerEloData(p);
      return {
        performer: p,
        index: idx,
        matchCount: stats.total_matches,
        confidence: getConfidence(stats.total_matches),
        rating: p.rating100 || 50
      };
    });

    // If we have a current calibration target and haven't exceeded max steps, continue with it
    if (calibrationTarget && calibrationStep < CALIBRATION_MAX_STEPS) {
      const targetEntry = withStats.find(ws => ws.performer.id === calibrationTarget.id);
      if (targetEntry) {
        // Find an anchor near the binary-search midpoint
        const midpoint = Math.round((calibrationLow + calibrationHigh) / 2);
        const anchor = findAnchorNearRating(withStats, midpoint, calibrationTarget.id);
        if (anchor) {
          return {
            performers: [targetEntry.performer, anchor.performer],
            ranks: [targetEntry.index + 1, anchor.index + 1],
            coverageInfo: buildCoverageInfo(withStats)
          };
        }
      }
    }

    // Pick the least confident performer as the new calibration target
    // Among those with confidence < 0.75, pick randomly (weighted by low confidence)
    const uncertain = withStats.filter(ws => ws.confidence < CALIBRATION_HIGH_CONFIDENCE);
    let target;

    if (uncertain.length > 0) {
      // Weight by inverse confidence — less confident = more likely to be picked
      const weights = uncertain.map(ws => 1 - ws.confidence + CALIBRATION_MIN_WEIGHT);
      target = weightedRandomSelect(uncertain, weights);
    } else {
      // All performers are reasonably confident — pick one at random for maintenance
      target = withStats[Math.floor(Math.random() * withStats.length)];
    }

    calibrationTarget = target.performer;
    calibrationLow = 1;
    calibrationHigh = 100;
    calibrationStep = 0;

    // Find an anchor near the target's current rating (starting point of binary search)
    const midpoint = target.rating;
    const anchor = findAnchorNearRating(withStats, midpoint, target.performer.id);

    if (!anchor) {
      // Fallback: just pick any other performer
      const others = withStats.filter(ws => ws.performer.id !== target.performer.id);
      const fallback = others[Math.floor(Math.random() * others.length)];
      return {
        performers: [target.performer, fallback.performer],
        ranks: [target.index + 1, fallback.index + 1],
        coverageInfo: buildCoverageInfo(withStats)
      };
    }

    return {
      performers: [target.performer, anchor.performer],
      ranks: [target.index + 1, anchor.index + 1],
      coverageInfo: buildCoverageInfo(withStats)
    };
  }

  /**
   * Find an anchor performer near a given target rating.
   * Prefers well-established performers (high confidence) as anchors.
   * @param {Array} withStats - Array of { performer, confidence, rating, ... }
   * @param {number} targetRating - Rating to search near
   * @param {string} excludeId - ID to exclude (the calibration target)
   * @returns {Object|null} Best anchor entry
   */
  function findAnchorNearRating(withStats, targetRating, excludeId) {
    // Find performers near the target rating, preferring high-confidence ones
    const candidates = withStats
      .filter(ws => ws.performer.id !== excludeId)
      .map(ws => ({
        ...ws,
        distance: Math.abs(ws.rating - targetRating),
        anchorScore: ws.confidence * CALIBRATION_CONFIDENCE_WEIGHT - Math.abs(ws.rating - targetRating)
      }))
      .sort((a, b) => b.anchorScore - a.anchorScore);

    // From top candidates, pick randomly among the best 3
    const topCandidates = candidates.slice(0, Math.min(CALIBRATION_TOP_CANDIDATES, candidates.length));
    if (topCandidates.length === 0) return null;
    return topCandidates[Math.floor(Math.random() * topCandidates.length)];
  }

  /**
   * Build coverage information for the calibration dashboard.
   * @param {Array} withStats - Array of performer stats
   * @returns {Object} { total, rated, avgConfidence, highConfidence, lowConfidence }
   */
  function buildCoverageInfo(withStats) {
    const total = withStats.length;
    const rated = withStats.filter(ws => ws.matchCount > 0).length;
    const avgConfidence = total > 0
      ? withStats.reduce((sum, ws) => sum + ws.confidence, 0) / total
      : 0;
    const highConfidence = withStats.filter(ws => ws.confidence >= CALIBRATION_HIGH_CONFIDENCE).length;
    const lowConfidence = withStats.filter(ws => ws.confidence < CALIBRATION_LOW_CONFIDENCE).length;
    return { total, rated, avgConfidence, highConfidence, lowConfidence };
  }

  async function fetchCalibrationPair() {
    return await fetchCalibrationPairPerformers();
  }

  // ============================================
  // TOURNAMENT MODE — Bracket-based single elimination
  // ============================================

  /**
   * Generate proper tournament seed order so that top seeds are placed on
   * opposite halves of the bracket (e.g. seed 1 and seed 2 can only meet
   * in the final). Uses standard recursive bracket seeding.
   * @param {number} numPlayers - Number of players (should be a power of 2)
   * @returns {Array} Array of seed numbers in bracket position order
   */
  function getProperSeedOrder(numPlayers) {
    const rounds = Math.ceil(Math.log2(numPlayers));
    let seeds = [1];
    for (let round = 1; round <= rounds; round++) {
      const newSeeds = [];
      const roundSize = Math.pow(2, round);
      for (let i = 0; i < seeds.length; i++) {
        newSeeds.push(seeds[i]);
        newSeeds.push(roundSize + 1 - seeds[i]);
      }
      seeds = newSeeds;
    }
    return seeds;
  }

  /**
   * Generate a seeded single-elimination bracket.
   * Performers are seeded by current rating (highest = seed 1).
   * @param {Array} performers - Array of performer objects sorted by rating DESC
   * @returns {Array} Array of rounds, each round is an array of matches
   *   Match: { seed1: performerObj, seed2: performerObj, winner: null }
   */
  function generateBracket(performers) {
    const n = performers.length;
    const rounds = Math.ceil(Math.log2(n));
    const bracket = [];

    // Generate proper seeding order for standard tournament bracket.
    // This ensures seed 1 and seed 2 are on opposite halves and can
    // only meet in the final (standard NCAA-style bracket seeding).
    const seedOrder = getProperSeedOrder(n);

    // First round: pair using proper seed order
    const firstRound = [];
    for (let i = 0; i < seedOrder.length; i += 2) {
      const idx1 = seedOrder[i] - 1;
      const idx2 = seedOrder[i + 1] - 1;
      firstRound.push({
        seed1: performers[idx1],
        seed2: idx2 < n ? performers[idx2] : null,
        winner: idx2 >= n ? performers[idx1] : null
      });
    }
    bracket.push(firstRound);

    // Generate empty subsequent rounds
    let matchesInRound = Math.ceil(firstRound.length / 2);
    for (let r = 1; r < rounds; r++) {
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({ seed1: null, seed2: null, winner: null });
      }
      bracket.push(round);
      matchesInRound = Math.ceil(matchesInRound / 2);
    }

    return bracket;
  }

  /**
   * Advance a tournament winner to the next round's bracket slot.
   * @param {Object} winner - The winning performer
   * @param {number} roundIdx - Current round index
   * @param {number} matchIdx - Current match index within the round
   */
  function advanceTournamentWinner(winner, roundIdx, matchIdx) {
    const nextRound = roundIdx + 1;
    if (nextRound >= tournamentBracket.length) return; // Final already

    const nextMatchIdx = Math.floor(matchIdx / 2);
    const isTopSlot = matchIdx % 2 === 0;

    if (isTopSlot) {
      tournamentBracket[nextRound][nextMatchIdx].seed1 = winner;
    } else {
      tournamentBracket[nextRound][nextMatchIdx].seed2 = winner;
    }
  }

  /**
   * Fetch the next pair for tournament mode.
   * Returns the current match in the bracket, or signals tournament completion.
   * @returns {Object} { performers, ranks, isVictory, tournamentInfo }
   */
  async function fetchTournamentPairPerformers() {
    if (!tournamentBracket || tournamentRound >= tournamentBracket.length) {
      return { performers: [], ranks: [null, null], isVictory: true, tournamentInfo: null };
    }

    const currentRoundMatches = tournamentBracket[tournamentRound];

    // Skip matches that already have a winner (byes) and advance to next unplayed
    while (tournamentMatchIndex < currentRoundMatches.length) {
      const match = currentRoundMatches[tournamentMatchIndex];
      if (match.winner) {
        // Auto-advance bye winners
        advanceTournamentWinner(match.winner, tournamentRound, tournamentMatchIndex);
        tournamentMatchIndex++;
        continue;
      }
      if (match.seed1 && match.seed2) {
        // Found a playable match
        const totalRounds = tournamentBracket.length;
        const roundNames = [];
        for (let r = 0; r < totalRounds; r++) {
          if (r === totalRounds - 1) roundNames.push("Final");
          else if (r === totalRounds - 2) roundNames.push("Semifinal");
          else if (r === totalRounds - 3) roundNames.push("Quarterfinal");
          else roundNames.push(`Round ${r + 1}`);
        }

        return {
          performers: [match.seed1, match.seed2],
          ranks: [
            match.seed1.tournamentSeed ? `Seed #${match.seed1.tournamentSeed}` : null,
            match.seed2.tournamentSeed ? `Seed #${match.seed2.tournamentSeed}` : null
          ],
          isVictory: false,
          tournamentInfo: {
            round: tournamentRound,
            roundName: roundNames[tournamentRound] || `Round ${tournamentRound + 1}`,
            matchIndex: tournamentMatchIndex,
            matchesInRound: currentRoundMatches.length,
            totalRounds: totalRounds,
            bracket: tournamentBracket,
            size: tournamentSize
          }
        };
      }
      tournamentMatchIndex++;
    }

    // All matches in this round are done — advance to next round
    tournamentRound++;
    tournamentMatchIndex = 0;

    // Check if tournament is complete
    if (tournamentRound >= tournamentBracket.length) {
      // Tournament complete — find the champion (winner of the last match)
      const finalRound = tournamentBracket[tournamentBracket.length - 1];
      const champion = finalRound[0]?.winner;
      return {
        performers: champion ? [champion] : [],
        ranks: [1],
        isVictory: true,
        tournamentInfo: {
          bracket: tournamentBracket,
          champion: champion,
          size: tournamentSize
        }
      };
    }

    // Recurse to find the next playable match in the new round
    return await fetchTournamentPairPerformers();
  }

  async function fetchTournamentPair() {
    return await fetchTournamentPairPerformers();
  }

  /**
   * Fetch a pair for King of the Hill mode.
   * The current king stays on one side and faces a random challenger.
   * If no king exists yet, the top-rated performer becomes the first king.
   * @returns {Object} { performers, ranks, kothInfo }
   */
  async function fetchKothPairPerformers() {
    const performerFilter = getPerformerFilter();

    const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];

    if (performers.length < 2) {
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }

    // If no king yet, pick the top-rated performer as the first king
    if (!kothKing) {
      kothKing = performers[0];
      kothStreak = 0;
      console.log(`[HotOrNot] KOTH: ${kothKing.name} is the first king (rating ${kothKing.rating100 || 50})`);
    }

    // Refresh the king's data to get latest rating
    const freshKing = performers.find(p => p.id === kothKing.id);
    if (freshKing) {
      kothKing = freshKing;
    }

    const kingRank = performers.findIndex(p => p.id === kothKing.id) + 1;

    // Pick a challenger — weighted toward performers within a reasonable rating window,
    // but allow upsets by occasionally picking from further away
    const eligible = performers.filter(p => p.id !== kothKing.id);
    if (eligible.length === 0) {
      return { performers: [kothKing], ranks: [kingRank], kothInfo: { streak: kothStreak } };
    }

    // Weight challengers: closer ratings get higher weight, but everyone has a chance
    const kingRating = kothKing.rating100 || 50;
    const challengerWeights = eligible.map(p => {
      const diff = Math.abs((p.rating100 || 50) - kingRating);
      // Inverse-distance weighting: nearby performers are more likely challengers
      // but add a floor so distant performers still have a chance
      return Math.max(0.1, 1.0 / (1 + diff / 15));
    });

    const totalWeight = challengerWeights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    let challengerIdx = 0;
    for (let i = 0; i < challengerWeights.length; i++) {
      roll -= challengerWeights[i];
      if (roll <= 0) {
        challengerIdx = i;
        break;
      }
    }

    const challenger = eligible[challengerIdx];
    const challengerRank = performers.findIndex(p => p.id === challenger.id) + 1;

    return {
      performers: [kothKing, challenger],
      ranks: [kingRank, challengerRank],
      kothInfo: {
        streak: kothStreak,
        bestStreak: kothBestStreak,
        bestKing: kothBestKing,
        dethroned: kothDethroned
      }
    };
  }

  async function fetchKothPair() {
    return await fetchKothPairPerformers();
  }

  async function updateItemRating(itemId, newRating, itemObj = null, won = null, ratingChange = 0) {
    if (battleType === "performers") {
      return await updatePerformerRating(itemId, newRating, itemObj, won, ratingChange);
    } else {
      return await updateImageRating(itemId, newRating);
    }
  }

  // UI COMPONENTS
  // ============================================

  function createPerformerCard(performer, side, rank = null, streak = null) {
    // Performer name
    const name = performer.name || `Performer #${performer.id}`;
    
    // Performer image - use their profile image
    const imagePath = performer.image_path || null;
    
    // Performer metadata
    const birthdate = performer.birthdate || null;
    const ethnicity = performer.ethnicity || null;
    const country = performer.country || null;
    const sceneCount = performer.scene_count || 0;
    const stashRating = performer.rating100 ? `${performer.rating100}/100` : "Unrated";
    
    // Parse stats for enhanced display
    const stats = parsePerformerEloData(performer);
    const confidence = getConfidenceLevel(stats);
    const rating = performer.rating100 || 50;
    const ratingInterval = getRatingConfidenceInterval(rating, stats.total_matches);
    
    // Build confidence and stats display
    let statsDisplay = '';
    if (stats.total_matches > 0) {
      const winRate = ((stats.wins / stats.total_matches) * 100).toFixed(0);
      const streakIcon = getStreakIcon(stats.current_streak);
      statsDisplay = `
        <div class="hon-meta-item hon-stats-inline">
          <strong>Matches:</strong> ${stats.total_matches} 
          <span class="hon-confidence-badge" title="${confidence.label} performer">${confidence.emoji}</span>
        </div>
        <div class="hon-meta-item">
          <strong>Win Rate:</strong> ${winRate}% ${streakIcon}
        </div>
      `;
    } else {
      statsDisplay = `
        <div class="hon-meta-item hon-stats-inline">
          <strong>Matches:</strong> 0 
          <span class="hon-confidence-badge" title="${confidence.label} performer">${confidence.emoji}</span>
        </div>
      `;
    }
    
    // Enhanced rating display with confidence interval if enough matches
    let enhancedRating = stashRating;
    if (stats.total_matches >= 5 && performer.rating100) {
      enhancedRating = `${rating} (${ratingInterval.low}-${ratingInterval.high})`;
    }
    
    // Handle numeric ranks and string ranks
    let rankDisplay = '';
    if (rank !== null && rank !== undefined) {
      if (typeof rank === 'number') {
        rankDisplay = `<span class="hon-performer-rank hon-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="hon-performer-rank hon-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge (currently unused)
    let streakBadgeDisplay = '';
    if (streak !== null && streak > 0) {
      streakBadgeDisplay = `<div class="hon-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    // Tournament wins badge — show past tournament victories on the card
    const tournamentWins = performer.tournamentWins || stats.tournament_wins;
    let tournamentBadgeDisplay = '';
    if (currentMode === "tournament" && tournamentWins > 0) {
      tournamentBadgeDisplay = `<div class="hon-tournament-wins-badge">🏆 ${tournamentWins}x champion</div>`;
    }

    return `
      <div class="hon-performer-card hon-scene-card" data-performer-id="${performer.id}" data-side="${side}" data-rating="${Math.max(1, Math.min(100, performer.rating100 || 50))}">
        <div class="hon-performer-image-container hon-scene-image-container" data-performer-url="/performers/${performer.id}">
          ${imagePath 
            ? `<img class="hon-performer-image hon-scene-image" src="${imagePath}" alt="${name}" loading="lazy" />`
            : `<div class="hon-performer-image hon-scene-image hon-no-image">No Image</div>`
          }
          ${streakBadgeDisplay}
          ${tournamentBadgeDisplay}
          <div class="hon-click-hint">Click to open performer</div>
        </div>
        
        <div class="hon-performer-body hon-scene-body" data-winner="${performer.id}">
          <div class="hon-performer-info hon-scene-info">
            <div class="hon-performer-title-row hon-scene-title-row">
              <h3 class="hon-performer-title hon-scene-title">${name}</h3>
              ${rankDisplay}
            </div>
            
            <div class="hon-performer-meta hon-scene-meta">
              ${birthdate ? `<div class="hon-meta-item"><strong>Birthdate:</strong> ${birthdate}</div>` : ''}
              ${ethnicity ? `<div class="hon-meta-item"><strong>Ethnicity:</strong> ${ethnicity}</div>` : ''}
              ${country ? `<div class="hon-meta-item"><strong>Country:</strong> ${getCountryDisplay(country)}</div>` : ''}
              ${performer.gender ? `<div class="hon-meta-item"><strong>Gender:</strong> ${getGenderDisplay(performer.gender)}</div>` : ''}
              <div class="hon-meta-item"><strong>Scenes:</strong> ${sceneCount}</div>
              <div class="hon-meta-item"><strong>Rating:</strong> ${enhancedRating}</div>
              ${statsDisplay}
            </div>
          </div>
          
          <div class="hon-choose-btn">
            ✓ Choose This Performer
          </div>
        </div>
      </div>
    `;
  }

  function createImageCard(image, side, rank = null, streak = null) {
    // Image paths
    const imagePath = image.paths && image.paths.image ? image.paths.image : null;
    const thumbnailPath = image.paths && image.paths.thumbnail ? image.paths.thumbnail : null;
    
    // Handle numeric ranks and string ranks
    let rankDisplay = '';
    if (rank !== null && rank !== undefined) {
      if (typeof rank === 'number') {
        rankDisplay = `<span class="hon-image-rank hon-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="hon-image-rank hon-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge (currently unused)
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="hon-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="hon-image-card hon-scene-card" data-image-id="${image.id}" data-side="${side}" data-rating="${Math.max(1, Math.min(100, image.rating100 || 50))}">
        <div class="hon-image-image-container hon-scene-image-container" data-image-url="/images/${image.id}">
          ${thumbnailPath 
            ? `<img class="hon-image-image hon-scene-image" src="${thumbnailPath}" alt="Image #${image.id}" loading="lazy" />`
            : `<div class="hon-image-image hon-scene-image hon-no-image">No Image</div>`
          }
          ${streakDisplay}
          ${rankDisplay ? `<div class="hon-image-rank-overlay">${rankDisplay}</div>` : ''}
          <div class="hon-click-hint">Click to open image</div>
        </div>
        
        <div class="hon-image-body hon-scene-body" data-winner="${image.id}">
          <div class="hon-choose-btn">
            ✓ Choose This Image
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // PERFORMER STATS MODAL
  // ============================================

  /**
   * Escape HTML special characters to prevent XSS
   * @param {string} unsafe - Unsafe string that may contain HTML
   * @returns {string} HTML-safe string
   */
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Fetch all performers with stats and ratings
   */
  async function fetchAllPerformerStats() {
    const performerFilter = getPerformerFilter();

    const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    return result.findPerformers.performers || [];
  }

  /**
   * Build grouped leaderboard table HTML from sorted performer data
   * @param {Array} performersWithStats - Sorted array of performer stat objects
   * @param {string} leaderboardColgroup - Colgroup HTML for table column widths
   * @returns {string} HTML string of grouped table sections
   */
  function buildGroupedLeaderboardHTML(performersWithStats, leaderboardColgroup) {
    // Group performers by 250 (1-250, 251-500, etc.)
    const groupedPerformers = [];
    for (let i = 0; i < performersWithStats.length; i += 250) {
      const group = performersWithStats.slice(i, i + 250);
      const startRank = i + 1;
      const endRank = Math.min(i + 250, performersWithStats.length);
      groupedPerformers.push({ startRank, endRank, performers: group });
    }

    return groupedPerformers.map((group, groupIndex) => {
      const groupRows = group.performers.map((p, idx) => {
        const winRate = p.total_matches > 0 ? ((p.wins / p.total_matches) * 100).toFixed(1) : "N/A";
        const streakDisplay = p.current_streak > 0
          ? `<span class="hon-stats-positive">+${p.current_streak}</span>`
          : p.current_streak < 0
            ? `<span class="hon-stats-negative">${p.current_streak}</span>`
            : "0";

        const safeName = escapeHtml(p.name);

        return `
          <tr>
            <td class="hon-stats-rank">#${group.startRank + idx}</td>
            <td class="hon-stats-name">
              <a href="/performers/${escapeHtml(p.id)}" target="_blank">${safeName}</a>
            </td>
            <td class="hon-stats-rating">${p.rating}</td>
            <td>${p.total_matches}</td>
            <td class="hon-stats-positive">${p.wins}</td>
            <td class="hon-stats-negative">${p.losses}</td>
            <td class="hon-stats-neutral">${p.draws || 0}</td>
            <td>${winRate}${winRate !== "N/A" ? "%" : ""}</td>
            <td>${streakDisplay}</td>
            <td class="hon-stats-positive">${p.best_streak}</td>
            <td class="hon-stats-negative">${p.worst_streak}</td>
            <td class="hon-stats-trophies">${p.tournament_wins ? "🏆 " + p.tournament_wins : "0"}</td>
          </tr>
        `;
      }).join("");

      return `
        <div class="hon-rank-group">
          <div class="hon-rank-group-header" data-group="${groupIndex}" role="button" aria-expanded="false" aria-controls="rank-group-${groupIndex}" aria-label="Toggle ranks ${group.startRank} to ${group.endRank} group">
            <span class="hon-group-toggle">▶</span>
            <span class="hon-rank-group-title">Ranks ${group.startRank}-${group.endRank}</span>
            <span class="hon-rank-group-count">(${group.performers.length} performers)</span>
          </div>
          <div class="hon-rank-group-content collapsed" data-group="${groupIndex}" id="rank-group-${groupIndex}">
            <table class="hon-stats-table" role="table" aria-label="Ranks ${group.startRank}-${group.endRank} statistics">
              ${leaderboardColgroup}
              <tbody>
                ${groupRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join("");
  }

  /**
   * Create stats breakdown modal content
   * @returns {{ html: string, performersWithStats: Array, leaderboardColgroup: string }} Modal content and data for sorting
   */
  function createStatsModalContent(performers) {
    if (!performers || performers.length === 0) {
      return { html: '<div class="hon-stats-empty">No performer stats available</div>', performersWithStats: [], leaderboardColgroup: "" };
    }

    // Parse stats for each performer
    const performersWithStats = performers.map((p, idx) => {
      const stats = parsePerformerEloData(p);
      const winRate = stats.total_matches > 0 ? (stats.wins / stats.total_matches) * 100 : -1;
      return {
        rank: idx + 1,
        name: p.name || `Performer #${p.id}`,
        id: p.id,
        rating: ((p.rating100 || 50) / 10).toFixed(1),
        win_rate: winRate,
        ...stats
      };
    });

    // Calculate totals and averages
    const totalMatches = performersWithStats.reduce((sum, p) => sum + p.total_matches, 0);
    const performerCount = performers.length;
    const avgMatches = performerCount > 0 ? (totalMatches / performerCount).toFixed(1) : '0.0';
    const avgRating = performerCount > 0 
      ? ((performers.reduce((sum, p) => sum + (p.rating100 || 50), 0) / performerCount) / 10).toFixed(1) 
      : '5.0';

    // Calculate rating distribution for bar graph (100 individual rating values: 0.1, 0.2, 0.3, ..., 10.0)
    // Create 100 buckets for granular distribution
    const ratingBuckets = Array(100).fill(0);
    performersWithStats.forEach(p => {
      const ratingValue = parseFloat(p.rating); // Rating is 0.0-10.0
      // Map rating to bucket index (0-99)
      // Rating 0.1 goes into bucket 0 (displayed as 0.1)
      // Rating 10.0 goes into bucket 99 (displayed as 10.0)
      // Use Math.round to handle floating point precision, then subtract 1 to align with display labels
      const bucketIndex = Math.max(0, Math.min(99, Math.round(ratingValue * 10) - 1));
      ratingBuckets[bucketIndex]++;
    });
    
    // Calculate group totals for the 10 rating ranges (0-1, 1-2, ..., 9-10)
    const groupTotals = [];
    for (let i = 0; i < 10; i++) {
      const groupBuckets = ratingBuckets.slice(i * 10, (i + 1) * 10);
      groupTotals.push(groupBuckets.reduce((sum, count) => sum + count, 0));
    }
    
    // Use group totals for the header bar scaling (shows totals per 10s)
    const maxGroupTotal = Math.max(...groupTotals, 1);
    // Use individual bucket max for expanded view scaling
    const maxBucketCount = Math.max(...ratingBuckets, 1);
    
    // Group buckets into 10 collapsible groups (0.1-1.0, 1.1-2.0, ..., 9.1-10.0)
    const barGraphGroups = [];
    for (let groupIndex = 0; groupIndex < 10; groupIndex++) {
      const startRating = (groupIndex * 10 + 1) / 10; // 0.1, 1.1, 2.1, ..., 9.1
      const endRating = groupIndex + 1; // 1, 2, 3, ..., 10
      
      // Get buckets for this group (10 buckets per group)
      const groupBuckets = ratingBuckets.slice(groupIndex * 10, (groupIndex + 1) * 10);
      const groupTotal = groupTotals[groupIndex];
      
      // Calculate percentage for the group header bar (scaled to max group total)
      const groupPercentage = (groupTotal / maxGroupTotal) * 100;
      
      // Create individual bars for this group (scaled to max bucket count for detail view)
      const barsInGroup = groupBuckets.map((count, bucketIndexInGroup) => {
        const bucketIndex = groupIndex * 10 + bucketIndexInGroup;
        const percentage = (count / maxBucketCount) * 100;
        const rangeStart = ((bucketIndex + 1) / 10).toFixed(1);
        const displayRange = `${rangeStart}`;
        
        return `
          <div class="hon-bar-container">
            <div class="hon-bar-label">${displayRange}</div>
            <div class="hon-bar-wrapper">
              <div class="hon-bar" style="width: ${percentage}%">
                <span class="hon-bar-count">${count}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      barGraphGroups.push(`
        <div class="hon-bar-group">
          <div class="hon-bar-group-header" data-group="bar-${groupIndex}" role="button" aria-expanded="false" aria-controls="bar-group-${groupIndex}" aria-label="Toggle ratings ${startRating.toFixed(1)} to ${endRating}.0 group">
            <span class="hon-group-toggle">▶</span>
            <span class="hon-bar-group-label">${startRating.toFixed(1)}-${endRating}.0</span>
            <div class="hon-bar-group-bar-wrapper">
              <div class="hon-bar-group-bar" style="width: ${groupPercentage}%">
                <span class="hon-bar-group-bar-count">${groupTotal}</span>
              </div>
            </div>
          </div>
          <div class="hon-bar-group-content collapsed" data-group="bar-${groupIndex}" id="bar-group-${groupIndex}">
            ${barsInGroup}
          </div>
        </div>
      `);
    }
    
    const barGraphHTML = barGraphGroups.join('');

    // Column widths for consistent alignment between header and body tables
    const leaderboardColgroup = `
      <colgroup>
        <col style="width: 6%">
        <col style="width: 19%">
        <col style="width: 7%">
        <col style="width: 8%">
        <col style="width: 7%">
        <col style="width: 7%">
        <col style="width: 7%">
        <col style="width: 9%">
        <col style="width: 7%">
        <col style="width: 7%">
        <col style="width: 7%">
        <col style="width: 9%">
      </colgroup>
    `;

    const groupedTableHTML = buildGroupedLeaderboardHTML(performersWithStats, leaderboardColgroup);

    return {
      html: `
      <div class="hon-stats-modal-content">
        <h2 class="hon-stats-title">📊 Performer Statistics</h2>
        
        <div class="hon-stats-summary">
          <div class="hon-stats-summary-item">
            <span class="hon-stats-summary-label">Total Performers:</span>
            <span class="hon-stats-summary-value">${performers.length}</span>
          </div>
          <div class="hon-stats-summary-item">
            <span class="hon-stats-summary-label">Total Matches:</span>
            <span class="hon-stats-summary-value">${totalMatches}</span>
          </div>
          <div class="hon-stats-summary-item">
            <span class="hon-stats-summary-label">Average Matches/Performer:</span>
            <span class="hon-stats-summary-value">${avgMatches}</span>
          </div>
          <div class="hon-stats-summary-item">
            <span class="hon-stats-summary-label">Average Rating:</span>
            <span class="hon-stats-summary-value">${avgRating}/10</span>
          </div>
        </div>

        <div class="hon-stats-tabs">
          <button class="hon-stats-tab active" data-tab="graph">📊 Distribution</button>
          <button class="hon-stats-tab" data-tab="leaderboard">📋 Leaderboard</button>
        </div>

        <div class="hon-stats-tab-content">
          <div class="hon-stats-tab-panel active" data-panel="graph">
            <div class="hon-bar-graph">
              <h3 class="hon-bar-graph-title">Rating Distribution</h3>
              <div class="hon-bar-graph-content">
                ${barGraphHTML}
              </div>
            </div>
          </div>

          <div class="hon-stats-tab-panel" data-panel="leaderboard">
            <div class="hon-stats-table-container">
              <table class="hon-stats-table hon-stats-table-header" role="table" aria-label="Performer statistics breakdown">
                ${leaderboardColgroup}
                <thead>
                  <tr>
                    <th scope="col" aria-label="Rank position" data-sort-key="rank" class="hon-sortable">Rank <span class="hon-sort-indicator hon-sort-asc">▲</span></th>
                    <th scope="col" aria-label="Performer name" class="hon-stats-name hon-sortable" data-sort-key="name">Performer <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Current rating" data-sort-key="rating" class="hon-sortable">Rating <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Total matches played" data-sort-key="total_matches" class="hon-sortable">Matches <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Total wins" data-sort-key="wins" class="hon-sortable">Wins <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Total losses" data-sort-key="losses" class="hon-sortable">Losses <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Total draws (skips)" data-sort-key="draws" class="hon-sortable">Draws <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Win rate percentage" data-sort-key="win_rate" class="hon-sortable">Win Rate <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Current win or loss streak" data-sort-key="current_streak" class="hon-sortable">Streak <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Best winning streak" data-sort-key="best_streak" class="hon-sortable">Best <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Worst losing streak" data-sort-key="worst_streak" class="hon-sortable">Worst <span class="hon-sort-indicator"></span></th>
                    <th scope="col" aria-label="Tournament titles won" data-sort-key="tournament_wins" class="hon-sortable">Titles <span class="hon-sort-indicator"></span></th>
                  </tr>
                </thead>
              </table>
              <div class="hon-rank-groups">
                ${groupedTableHTML}
              </div>
            </div>
          </div>
        </div>
      </div>
    `,
      performersWithStats,
      leaderboardColgroup
    };
  }

  /**
   * Open stats modal
   */
  async function openStatsModal() {
    const existingStatsModal = document.getElementById("hon-stats-modal");
    if (existingStatsModal) {
      existingStatsModal.remove();
    }

    const statsModal = document.createElement("div");
    statsModal.id = "hon-stats-modal";
    statsModal.className = "hon-stats-modal";
    statsModal.innerHTML = `
      <div class="hon-modal-backdrop"></div>
      <div class="hon-stats-modal-dialog">
        <button class="hon-modal-close">✕</button>
        <div class="hon-stats-loading">Loading stats...</div>
      </div>
    `;

    document.body.appendChild(statsModal);

    // Close handlers
    statsModal.querySelector(".hon-modal-backdrop").addEventListener("click", () => {
      statsModal.remove();
    });
    statsModal.querySelector(".hon-modal-close").addEventListener("click", () => {
      statsModal.remove();
    });

    // Fetch and display stats
    try {
      const performers = await fetchAllPerformerStats();
      const { html: content, performersWithStats, leaderboardColgroup } = createStatsModalContent(performers);
      const dialog = statsModal.querySelector(".hon-stats-modal-dialog");
      dialog.innerHTML = `
        <button class="hon-modal-close">✕</button>
        ${content}
      `;

      // Re-attach close handler after updating content
      dialog.querySelector(".hon-modal-close").addEventListener("click", () => {
        statsModal.remove();
      });

      // Attach tab switching handlers
      const tabButtons = dialog.querySelectorAll(".hon-stats-tab");
      const tabPanels = dialog.querySelectorAll(".hon-stats-tab-panel");
      
      tabButtons.forEach(button => {
        button.addEventListener("click", () => {
          const tabName = button.dataset.tab;
          
          // Update active tab button
          tabButtons.forEach(btn => btn.classList.remove("active"));
          button.classList.add("active");
          
          // Update active tab panel
          tabPanels.forEach(panel => {
            if (panel.dataset.panel === tabName) {
              panel.classList.add("active");
            } else {
              panel.classList.remove("active");
            }
          });
        });
      });

      // Helper function to attach expand/collapse handlers to collapsible groups
      const attachCollapseHandlers = (headerSelector, contentSelector) => {
        const headers = dialog.querySelectorAll(headerSelector);
        headers.forEach(header => {
          header.addEventListener("click", () => {
            const groupIndex = header.dataset.group;
            const content = dialog.querySelector(`${contentSelector}[data-group="${groupIndex}"]`);
            const toggle = header.querySelector(".hon-group-toggle");
            
            if (content && content.classList.contains("collapsed")) {
              content.classList.remove("collapsed");
              header.setAttribute("aria-expanded", "true");
              toggle.textContent = "▼";
            } else if (content) {
              content.classList.add("collapsed");
              header.setAttribute("aria-expanded", "false");
              toggle.textContent = "▶";
            }
          });
        });
      };

      // Attach expand/collapse handlers for rank groups and bar graph groups
      attachCollapseHandlers(".hon-rank-group-header", ".hon-rank-group-content");
      attachCollapseHandlers(".hon-bar-group-header", ".hon-bar-group-content");

      // Sortable leaderboard headers
      let currentSortKey = "rank";
      let currentSortDir = "asc";

      const sortHeaders = dialog.querySelectorAll(".hon-sortable");
      sortHeaders.forEach(th => {
        th.addEventListener("click", () => {
          const sortKey = th.dataset.sortKey;
          if (currentSortKey === sortKey) {
            currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
          } else {
            currentSortKey = sortKey;
            // Default descending for numeric columns, ascending for name
            currentSortDir = sortKey === "name" ? "asc" : "desc";
          }

          // Sort from the original array each time (independent of previous sorts)
          const sorted = performersWithStats.slice().sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];

            // Handle string comparison for name
            if (sortKey === "name") {
              valA = (valA || "").toLowerCase();
              valB = (valB || "").toLowerCase();
              const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
              return currentSortDir === "asc" ? cmp : -cmp;
            }

            // Numeric comparison — push N/A win rates (value -1) to the end
            valA = parseFloat(valA);
            valB = parseFloat(valB);
            if (isNaN(valA)) valA = currentSortDir === "asc" ? Infinity : -Infinity;
            if (isNaN(valB)) valB = currentSortDir === "asc" ? Infinity : -Infinity;
            if (sortKey === "win_rate") {
              if (valA < 0) valA = currentSortDir === "asc" ? Infinity : -Infinity;
              if (valB < 0) valB = currentSortDir === "asc" ? Infinity : -Infinity;
            }
            return currentSortDir === "asc" ? valA - valB : valB - valA;
          });

          // Rebuild the grouped table HTML
          const rankGroups = dialog.querySelector(".hon-rank-groups");
          if (rankGroups) {
            rankGroups.innerHTML = buildGroupedLeaderboardHTML(sorted, leaderboardColgroup);
            // Re-attach expand/collapse handlers for new rank groups
            attachCollapseHandlers(".hon-rank-group-header", ".hon-rank-group-content");
          }

          // Update sort indicators on all headers
          sortHeaders.forEach(header => {
            const indicator = header.querySelector(".hon-sort-indicator");
            indicator.textContent = "";
            indicator.classList.remove("hon-sort-asc", "hon-sort-desc");
          });
          const activeIndicator = th.querySelector(".hon-sort-indicator");
          if (currentSortDir === "asc") {
            activeIndicator.textContent = "▲";
            activeIndicator.classList.add("hon-sort-asc");
          } else {
            activeIndicator.textContent = "▼";
            activeIndicator.classList.add("hon-sort-desc");
          }
        });
      });
    } catch (error) {
      console.error("[HotOrNot] Error loading stats:", error);
      const dialog = statsModal.querySelector(".hon-stats-modal-dialog");
      dialog.innerHTML = `
        <button class="hon-modal-close">✕</button>
        <div class="hon-stats-error">Failed to load performer statistics. Please try again later.</div>
      `;
      
      dialog.querySelector(".hon-modal-close").addEventListener("click", () => {
        statsModal.remove();
      });
    }
  }

  function createMainUI() {
    const itemType = battleType === "performers" ? "performers" : "images";
    
    // For images, hide mode selection (only use Swiss mode)
    const showModeToggle = battleType !== "images";
    const modeToggleHTML = showModeToggle ? `
          <div class="hon-mode-toggle">
            <button class="hon-mode-btn ${currentMode === 'swiss' ? 'active' : ''}" data-mode="swiss">
              <span class="hon-mode-icon">⚖️</span>
              <span class="hon-mode-title">Swiss</span>
              <span class="hon-mode-desc">Fair matchups</span>
            </button>
            <button class="hon-mode-btn ${currentMode === 'calibration' ? 'active' : ''}" data-mode="calibration" title="Finds each performer's true rating using binary search. Focuses on the least-confident performers first and narrows their rating range in up to 10 steps.">
              <span class="hon-mode-icon">📐</span>
              <span class="hon-mode-title">Calibration</span>
              <span class="hon-mode-desc">Smart ranking</span>
            </button>
            <button class="hon-mode-btn ${currentMode === 'tournament' ? 'active' : ''}" data-mode="tournament">
              <span class="hon-mode-icon">⚔️</span>
              <span class="hon-mode-title">Tournament</span>
              <span class="hon-mode-desc">Bracket battle</span>
            </button>
            <button class="hon-mode-btn ${currentMode === 'koth' ? 'active' : ''}" data-mode="koth" title="One performer defends the throne against a series of challengers. Track how long they can hold the crown!">
              <span class="hon-mode-icon">👑</span>
              <span class="hon-mode-title">King of the Hill</span>
              <span class="hon-mode-desc">Defend the throne</span>
            </button>
          </div>
    ` : '';

    // Stats button for performers
    const statsButtonHTML = battleType === "performers" ? `
          <button id="hon-stats-btn" class="btn btn-primary hon-stats-button">
            📊 View All Stats
          </button>
    ` : '';
    
    return `
      <div id="hotornot-container" class="hon-container">
        <div class="hon-header">
          <h1 class="hon-title">🔥 HotOrNot</h1>
          <p class="hon-subtitle">Compare ${itemType} head-to-head to build your rankings</p>
          ${modeToggleHTML}
          ${statsButtonHTML}
        </div>

        <div id="hon-tournament-setup" class="hon-performer-selection" style="display: none;">
          <h3 class="hon-selection-title">⚔️ Set Up Tournament</h3>
          <p class="hon-selection-subtitle">Choose bracket size — performers are randomly selected and seeded by rating</p>
          <div class="hon-tournament-sizes">
            <button class="hon-tournament-size-btn" data-size="8">
              <span class="hon-size-number">8</span>
              <span class="hon-size-label">7 matches</span>
            </button>
            <button class="hon-tournament-size-btn" data-size="16">
              <span class="hon-size-number">16</span>
              <span class="hon-size-label">15 matches</span>
            </button>
            <button class="hon-tournament-size-btn" data-size="32">
              <span class="hon-size-number">32</span>
              <span class="hon-size-label">31 matches</span>
            </button>
          </div>
        </div>

        <div id="hon-calibration-dashboard" class="hon-calibration-dashboard" style="display: none;"></div>

        <div id="hon-tournament-bracket-display" class="hon-bracket-display" style="display: none;"></div>

        <div id="hon-koth-status" class="hon-koth-status" style="display: none;"></div>

        <div class="hon-content">
          <div id="hon-comparison-area" class="hon-comparison-area">
            <div class="hon-loading">Loading...</div>
          </div>
          <div class="hon-actions">
            <button id="hon-skip-btn" class="btn btn-secondary">Skip (Get New Pair)</button>
            <button id="hon-undo-btn" class="btn btn-secondary hon-undo-btn" style="display: none;" disabled>↩ Undo Last Battle</button>
            <div class="hon-keyboard-hint">
              <span>← Left Arrow</span> to choose left · 
              <span>→ Right Arrow</span> to choose right · 
              <span>Space</span> to skip
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // NEW MODE UI FUNCTIONS
  // ============================================

  /**
   * Generate the tournament setup HTML with size selection buttons.
   * @returns {string} HTML string for the tournament setup panel
   */
  function getTournamentSetupHTML() {
    return `
      <h3 class="hon-selection-title">⚔️ Set Up Tournament</h3>
      <p class="hon-selection-subtitle">Choose bracket size — performers are randomly selected and seeded by rating</p>
      <div class="hon-tournament-sizes">
        <button class="hon-tournament-size-btn" data-size="8">
          <span class="hon-size-number">8</span>
          <span class="hon-size-label">7 matches</span>
        </button>
        <button class="hon-tournament-size-btn" data-size="16">
          <span class="hon-size-number">16</span>
          <span class="hon-size-label">15 matches</span>
        </button>
        <button class="hon-tournament-size-btn" data-size="32">
          <span class="hon-size-number">32</span>
          <span class="hon-size-label">31 matches</span>
        </button>
      </div>
    `;
  }

  /**
   * Show tournament size selection UI.
   */
  function showTournamentSetup() {
    const setupContainer = document.getElementById("hon-tournament-setup");
    const comparisonArea = document.getElementById("hon-comparison-area");
    const actionsEl = document.querySelector(".hon-actions");
    const bracketDisplay = document.getElementById("hon-tournament-bracket-display");

    // Restore original setup HTML (may have been replaced by loading/error state)
    if (setupContainer) {
      setupContainer.innerHTML = getTournamentSetupHTML();
      setupContainer.style.display = "block";
    }
    if (comparisonArea) comparisonArea.style.display = "none";
    if (actionsEl) actionsEl.style.display = "none";
    if (bracketDisplay) bracketDisplay.style.display = "none";

    // Hide other mode-specific panels
    hideCalibrationDashboard();

    // Attach size button handlers (fresh elements from innerHTML)
    if (setupContainer) {
      setupContainer.querySelectorAll(".hon-tournament-size-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const size = parseInt(btn.dataset.size);
          await initTournament(size);
        });
      });
    }
  }

  /**
   * Initialize a tournament with the given bracket size.
   * @param {number} size - Number of performers (8, 16, or 32)
   */
  async function initTournament(size) {
    const setupContainer = document.getElementById("hon-tournament-setup");
    if (setupContainer) {
      setupContainer.innerHTML = '<div class="hon-loading">Seeding bracket...</div>';
    }

    try {
      const performerFilter = getPerformerFilter();
      const result = await graphqlQuery(FIND_PERFORMERS_QUERY, {
        performer_filter: performerFilter,
        filter: { per_page: size, sort: "random" }
      });

      let performers = result.findPerformers.performers || [];

      if (performers.length < size) {
        if (performers.length < 4) {
          if (setupContainer) {
            setupContainer.innerHTML = '<div class="hon-error">Not enough performers for a tournament. Need at least 4.</div>';
            setupContainer.style.display = "block";
          }
          return;
        }
        // Adjust to nearest power of 2
        size = Math.pow(2, Math.floor(Math.log2(performers.length)));
        performers = performers.slice(0, size);
      }

      // Sort by rating for seeding (highest rated = seed 1)
      // Past tournament winners get a small tiebreaker boost for seeding
      performers.sort((a, b) => {
        const ratingDiff = (b.rating100 || 0) - (a.rating100 || 0);
        if (ratingDiff !== 0) return ratingDiff;
        // Tiebreaker: more tournament wins = higher seed
        const aStats = parsePerformerEloData(a);
        const bStats = parsePerformerEloData(b);
        return (bStats.tournament_wins || 0) - (aStats.tournament_wins || 0);
      });

      // Assign seed numbers and load tournament win history
      for (let i = 0; i < performers.length; i++) {
        performers[i].tournamentSeed = i + 1;
        const stats = parsePerformerEloData(performers[i]);
        performers[i].tournamentWins = stats.tournament_wins || 0;
      }

      tournamentSize = size;
      tournamentPerformers = performers;
      tournamentBracket = generateBracket(performers);
      tournamentRound = 0;
      tournamentMatchIndex = 0;
      tournamentSetupDone = true;

      // Hide setup, show comparison area
      if (setupContainer) setupContainer.style.display = "none";
      const comparisonArea = document.getElementById("hon-comparison-area");
      const actionsEl = document.querySelector(".hon-actions");
      if (comparisonArea) comparisonArea.style.display = "";
      if (actionsEl) actionsEl.style.display = "";

      loadNewPair();
    } catch (error) {
      console.error("[HotOrNot] Error initializing tournament:", error);
      if (setupContainer) {
        setupContainer.innerHTML = `<div class="hon-error">Error setting up tournament: ${error.message}</div>`;
      }
    }
  }


  /**
   * Update the calibration coverage dashboard.
   * @param {Object} coverageInfo - { total, rated, avgConfidence, highConfidence, lowConfidence }
   */
  function updateCalibrationDashboard(coverageInfo) {
    const dashboard = document.getElementById("hon-calibration-dashboard");
    if (!dashboard || !coverageInfo) return;

    dashboard.style.display = "block";
    const pct = Math.round(coverageInfo.avgConfidence * 100);
    const ratedPct = coverageInfo.total > 0 ? Math.round((coverageInfo.rated / coverageInfo.total) * 100) : 0;

    // Determine calibration target info
    let targetInfo = "";
    if (calibrationTarget) {
      const targetStats = parsePerformerEloData(calibrationTarget);
      const conf = getConfidence(targetStats.total_matches);
      const safeName = escapeHtml(calibrationTarget.name);
      const rangeInfo = calibrationStep > 0
        ? ` · Rating range: ${calibrationLow}–${calibrationHigh}`
        : "";
      targetInfo = `
        <div class="hon-cal-target">
          <span class="hon-cal-target-label">Calibrating:</span>
          <strong>${safeName}</strong>
          <span class="hon-cal-target-conf" title="Confidence reflects how reliable this performer's rating is based on matches played. Higher = more reliable.">${formatConfidence(conf)}</span>
          <span class="hon-cal-step" title="Each step is one comparison to narrow the rating range. May finish early if the range converges to within ±5 points.">Step ${calibrationStep + 1}/${CALIBRATION_MAX_STEPS}${rangeInfo}</span>
        </div>
      `;
    }

    // Show last convergence result if available
    let lastResultInfo = "";
    if (calibrationLastResult) {
      lastResultInfo = `<div class="hon-cal-last-result">${calibrationLastResult}</div>`;
    }

    dashboard.innerHTML = `
      <div class="hon-cal-stats">
        <div class="hon-cal-stat" title="Number of performers who have at least one match recorded.">
          <span class="hon-cal-stat-value">${coverageInfo.rated}/${coverageInfo.total}</span>
          <span class="hon-cal-stat-label">Rated (${ratedPct}%)</span>
        </div>
        <div class="hon-cal-stat" title="Average confidence across all performers. Based on match count: more matches = higher confidence. 75%+ is well-established.">
          <span class="hon-cal-stat-value">${pct}%</span>
          <span class="hon-cal-stat-label">Avg Confidence</span>
        </div>
        <div class="hon-cal-stat" title="Performers with 75%+ confidence (roughly 15+ matches). These have reliable ratings.">
          <span class="hon-cal-stat-value">${coverageInfo.highConfidence}</span>
          <span class="hon-cal-stat-label">High Confidence</span>
        </div>
        <div class="hon-cal-stat" title="Performers below 50% confidence (fewer than ~3 matches). These are prioritized for calibration.">
          <span class="hon-cal-stat-value">${coverageInfo.lowConfidence}</span>
          <span class="hon-cal-stat-label">Need Rating</span>
        </div>
      </div>
      ${lastResultInfo}
      ${targetInfo}
    `;
  }

  /**
   * Update the tournament bracket display with a side-by-side bracket layout.
   * Left half of the bracket flows left→center, right half flows right→center,
   * with the final match in the center (NCAA March Madness style).
   * @param {Object} tournamentInfo - Tournament state info
   */
  function updateTournamentBracketDisplay(tournamentInfo) {
    const bracketDisplay = document.getElementById("hon-tournament-bracket-display");
    if (!bracketDisplay || !tournamentInfo) return;

    bracketDisplay.style.display = "block";

    const { bracket, round, roundName, matchIndex, matchesInRound, totalRounds } = tournamentInfo;

    /**
     * Render a single match box.
     * @param {Object} match - Match object with seed1, seed2, winner
     * @param {boolean} isActive - Whether this match is currently being played
     * @returns {string} HTML string
     */
    function renderMatchHTML(match, isActive) {
      const seed1Label = match.seed1 && match.seed1.tournamentSeed ? `(${match.seed1.tournamentSeed}) ` : "";
      const seed2Label = match.seed2 && match.seed2.tournamentSeed ? `(${match.seed2.tournamentSeed}) ` : "";
      const name1 = match.seed1 ? `${seed1Label}${match.seed1.name}` : "—";
      const name2 = !match.seed2 ? "—" : !match.seed2.name ? "BYE" : `${seed2Label}${match.seed2.name}`;
      const winnerClass1 = match.winner && match.seed1 && match.winner.id === match.seed1.id ? "hon-bracket-winner" : "";
      const winnerClass2 = match.winner && match.seed2 && match.winner.id === match.seed2.id ? "hon-bracket-winner" : "";
      const loserClass1 = match.winner && match.seed1 && match.winner.id !== match.seed1.id ? "hon-bracket-loser" : "";
      const loserClass2 = match.winner && match.seed2 && match.winner.id !== match.seed2.id ? "hon-bracket-loser" : "";

      return `
        <div class="hon-bracket-match ${isActive ? "hon-bracket-match-active" : ""}">
          <div class="hon-bracket-slot ${winnerClass1} ${loserClass1}">${name1}</div>
          <div class="hon-bracket-slot ${winnerClass2} ${loserClass2}">${name2}</div>
        </div>
      `;
    }

    /**
     * Get a human-readable label for a round.
     * @param {number} r - Round index (0-based)
     * @param {number} total - Total number of rounds
     * @returns {string} Round label
     */
    function getRoundLabel(r, total) {
      if (r === total - 1) return "Final";
      if (r === total - 2) return "Semi";
      if (r === total - 3) return "Quarter";
      return `R${r + 1}`;
    }

    /**
     * Render a wing's round column with matches grouped into pairs for connector lines.
     * @param {Array} matches - Array of match objects for this wing's half of the round
     * @param {number} r - Round index
     * @param {number} globalOffset - Offset to convert local index to global match index
     * @param {boolean} isCurrentRound - Whether this is the active round
     * @param {string} roundLabel - Label for the round
     * @param {boolean} isLastInWing - Whether this is the last column in the wing (no outgoing connectors)
     * @returns {string} HTML string
     */
    function renderRoundColumn(matches, r, globalOffset, isCurrentRound, roundLabel, isLastInWing) {
      let html = `<div class="hon-bracket-round-col ${isCurrentRound ? "hon-bracket-current" : ""}">
        <div class="hon-bracket-round-label">${roundLabel}</div>
        <div class="hon-bracket-matchups">`;

      // Group matches into pairs (each pair feeds into one match in the next round)
      for (let m = 0; m < matches.length; m += 2) {
        const hasPairPartner = m + 1 < matches.length;
        if (hasPairPartner) {
          html += `<div class="hon-bracket-pair${isLastInWing ? "" : " hon-bracket-pair-conn"}">`;
        }

        const match1 = matches[m];
        const isActive1 = isCurrentRound && (globalOffset + m) === matchIndex;
        html += renderMatchHTML(match1, isActive1);

        if (hasPairPartner) {
          const match2 = matches[m + 1];
          const isActive2 = isCurrentRound && (globalOffset + m + 1) === matchIndex;
          html += renderMatchHTML(match2, isActive2);
          html += `</div>`;
        }
      }

      html += `</div></div>`;
      return html;
    }

    const finalRoundIdx = bracket.length - 1;

    // Fallback for brackets with fewer than 2 rounds
    if (bracket.length < 2) {
      bracketDisplay.innerHTML = `
        <div class="hon-bracket-header">
          <span class="hon-bracket-round">${roundName}</span>
          <span class="hon-bracket-progress">Match ${matchIndex + 1} of ${matchesInRound}</span>
        </div>`;
      return;
    }

    let bracketHTML = `
      <div class="hon-bracket-header">
        <span class="hon-bracket-round">${roundName}</span>
        <span class="hon-bracket-progress">Match ${matchIndex + 1} of ${matchesInRound}</span>
      </div>
      <div class="hon-bracket-wings">
    `;

    // LEFT WING — first half of each round's matches (except the final)
    bracketHTML += `<div class="hon-bracket-wing hon-bracket-left">`;
    for (let r = 0; r < finalRoundIdx; r++) {
      const roundMatches = bracket[r];
      const halfCount = Math.ceil(roundMatches.length / 2);
      const leftMatches = roundMatches.slice(0, halfCount);
      const isCurrentRound = r === round;
      const roundLabel = getRoundLabel(r, bracket.length);
      const isLastInWing = r === finalRoundIdx - 1;

      bracketHTML += renderRoundColumn(leftMatches, r, 0, isCurrentRound, roundLabel, isLastInWing);
    }
    bracketHTML += `</div>`;

    // CENTER — Final match
    const finalMatch = bracket[finalRoundIdx][0];
    const isFinalCurrent = round === finalRoundIdx;
    const isFinalActive = isFinalCurrent && matchIndex === 0;
    bracketHTML += `
      <div class="hon-bracket-center ${isFinalCurrent ? "hon-bracket-current" : ""}">
        <div class="hon-bracket-round-label">🏆 Final</div>
        <div class="hon-bracket-matchups">
          ${renderMatchHTML(finalMatch, isFinalActive)}
        </div>
      </div>
    `;

    // RIGHT WING — second half of each round's matches, displayed in reverse
    // order so later rounds are closest to center
    bracketHTML += `<div class="hon-bracket-wing hon-bracket-right">`;
    for (let r = finalRoundIdx - 1; r >= 0; r--) {
      const roundMatches = bracket[r];
      const halfCount = Math.ceil(roundMatches.length / 2);
      const rightMatches = roundMatches.slice(halfCount);
      const isCurrentRound = r === round;
      const roundLabel = getRoundLabel(r, bracket.length);
      const isLastInWing = r === finalRoundIdx - 1;

      bracketHTML += renderRoundColumn(rightMatches, r, halfCount, isCurrentRound, roundLabel, isLastInWing);
    }
    bracketHTML += `</div>`;

    bracketHTML += `</div>`;
    bracketDisplay.innerHTML = bracketHTML;
  }

  /**
   * Show tournament victory screen with final bracket.
   * @param {Object} champion - The tournament winner
   * @param {Object} tournamentInfo - Tournament metadata
   */
  function showTournamentVictory(champion, tournamentInfo) {
    const comparisonArea = document.getElementById("hon-comparison-area");
    const actionsEl = document.querySelector(".hon-actions");
    if (actionsEl) actionsEl.style.display = "none";

    if (!comparisonArea) return;

    // Update local tournament wins count before rendering so badge shows correctly
    if (champion) {
      champion.tournamentWins = (champion.tournamentWins || 0) + 1;
    }

    const name = champion ? champion.name : "Unknown";
    const imagePath = champion ? champion.image_path : null;
    const totalWins = champion ? champion.tournamentWins : 0;
    const winsText = totalWins > 0 ? ` (${totalWins} total win${totalWins > 1 ? "s" : ""})` : "";

    comparisonArea.innerHTML = `
      <div class="hon-victory-screen">
        <div class="hon-victory-crown">🏆</div>
        <h2 class="hon-victory-title">TOURNAMENT CHAMPION!</h2>
        <div class="hon-victory-scene">
          ${imagePath
            ? `<img class="hon-victory-image" src="${imagePath}" alt="${name}" />`
            : `<div class="hon-victory-image hon-no-image">No Image</div>`
          }
        </div>
        <h3 class="hon-victory-name">${name}</h3>
        <p class="hon-victory-stats">
          Won the ${tournamentInfo?.size || "?"}-performer tournament!${winsText}
        </p>
        <button id="hon-new-tournament" class="btn btn-primary">New Tournament</button>
      </div>
    `;

    // Update bracket display to show completed bracket
    if (tournamentInfo) {
      updateTournamentBracketDisplay({
        bracket: tournamentInfo.bracket,
        round: tournamentInfo.bracket.length,
        roundName: "Complete",
        matchIndex: 0,
        matchesInRound: 0,
        totalRounds: tournamentInfo.bracket.length
      });
    }

    // Record tournament win in performer stats
    if (champion) {
      recordTournamentWin(champion);
    }

    // Attach new tournament button
    const newBtn = comparisonArea.querySelector("#hon-new-tournament");
    if (newBtn) {
      newBtn.addEventListener("click", () => {
        resetTournamentState();
        if (actionsEl) actionsEl.style.display = "";
        loadNewPair();
      });
    }
  }

  /**
   * Hide mode-specific UI panels.
   */
  function hideTournamentSetup() {
    const el = document.getElementById("hon-tournament-setup");
    if (el) el.style.display = "none";
  }

  function hideCalibrationDashboard() {
    const el = document.getElementById("hon-calibration-dashboard");
    if (el) el.style.display = "none";
  }

  function hideTournamentBracket() {
    const el = document.getElementById("hon-tournament-bracket-display");
    if (el) el.style.display = "none";
  }

  function hideKothStatus() {
    const el = document.getElementById("hon-koth-status");
    if (el) el.style.display = "none";
  }

  /**
   * Update the King of the Hill status display showing the current king,
   * their defense streak, and the history of dethroned kings.
   * @param {Object} kothInfo - KOTH state info
   */
  function updateKothStatus(kothInfo) {
    const statusEl = document.getElementById("hon-koth-status");
    if (!statusEl) return;
    statusEl.style.display = "";

    const king = kothKing;
    const kingName = king ? escapeHtml(king.name) : "—";
    const kingRating = king ? (king.rating100 || 50) : "—";
    const streak = kothInfo.streak || 0;
    const bestStreak = kothInfo.bestStreak || 0;
    const bestKingName = kothInfo.bestKing ? escapeHtml(kothInfo.bestKing.name) : "—";
    const dethroned = kothInfo.dethroned || [];

    // Streak flame icons
    let streakIcon = "";
    if (streak >= 10) streakIcon = "🔥🔥🔥";
    else if (streak >= 5) streakIcon = "🔥🔥";
    else if (streak >= 3) streakIcon = "🔥";

    let html = `
      <div class="hon-koth-header">
        <span class="hon-koth-crown">👑</span>
        <span class="hon-koth-king-name">${kingName}</span>
        <span class="hon-koth-king-rating">(${kingRating})</span>
      </div>
      <div class="hon-koth-stats">
        <span class="hon-koth-streak">${streakIcon} Defense streak: <strong>${streak}</strong></span>
        <span class="hon-koth-best">Session best: <strong>${bestStreak}</strong>${bestStreak > 0 ? ` (${bestKingName})` : ""}</span>
      </div>
    `;

    if (dethroned.length > 0) {
      html += `<div class="hon-koth-history">`;
      html += `<span class="hon-koth-history-label">Fallen kings:</span> `;
      // Show last 5 dethroned kings
      const recent = dethroned.slice(-5).reverse();
      html += recent.map(d =>
        `<span class="hon-koth-fallen">${escapeHtml(d.name)} <small>(${d.streak} win${d.streak !== 1 ? "s" : ""})</small></span>`
      ).join(" → ");
      html += `</div>`;
    }

    statusEl.innerHTML = html;
  }

  /**
   * Show the "dethroned" screen when the king loses in KOTH mode.
   * @param {Object} oldKing - The performer who was dethroned
   * @param {Object} newKing - The challenger who won
   * @param {number} streak - How many challengers the old king defeated
   */
  function showKothDethroned(oldKing, newKing, streak) {
    const comparisonArea = document.getElementById("hon-comparison-area");
    if (!comparisonArea) return;

    const oldName = oldKing ? escapeHtml(oldKing.name) : "Unknown";
    const newName = newKing ? escapeHtml(newKing.name) : "Unknown";
    const oldImage = oldKing ? oldKing.image_path : null;
    const newImage = newKing ? newKing.image_path : null;
    const streakText = streak > 0
      ? `Defended the throne ${streak} time${streak !== 1 ? "s" : ""}!`
      : "Dethroned on the first challenge!";

    comparisonArea.innerHTML = `
      <div class="hon-koth-dethroned">
        <div class="hon-koth-dethroned-old">
          ${oldImage
            ? `<img class="hon-koth-dethroned-img" src="${oldImage}" alt="${oldName}" />`
            : `<div class="hon-koth-dethroned-img hon-no-image">No Image</div>`
          }
          <div class="hon-koth-dethroned-label">👑 ${oldName}</div>
          <div class="hon-koth-dethroned-streak">${streakText}</div>
        </div>
        <div class="hon-koth-dethroned-arrow">⚔️ Dethroned by</div>
        <div class="hon-koth-dethroned-new">
          ${newImage
            ? `<img class="hon-koth-dethroned-img" src="${newImage}" alt="${newName}" />`
            : `<div class="hon-koth-dethroned-img hon-no-image">No Image</div>`
          }
          <div class="hon-koth-dethroned-label">👑 ${newName}</div>
          <div class="hon-koth-dethroned-sublabel">New King!</div>
        </div>
      </div>
    `;
  }

  async function loadNewPair(retryCount = 0) {
    disableChoice = false;
    const comparisonArea = document.getElementById("hon-comparison-area");
    if (!comparisonArea) return;

    // Tournament mode: show setup if bracket not initialized
    if (currentMode === "tournament" && !tournamentSetupDone) {
      showTournamentSetup();
      return;
    }

    // Only show loading on first load (when empty or already showing loading)
    if (!comparisonArea.querySelector('.hon-vs-container')) {
      comparisonArea.innerHTML = '<div class="hon-loading">Loading...</div>';
    }

    // Hide mode-specific panels that aren't relevant to the current mode
    if (currentMode !== "calibration") hideCalibrationDashboard();
    if (currentMode !== "tournament") hideTournamentBracket();
    if (currentMode !== "tournament" || tournamentSetupDone) hideTournamentSetup();
    if (currentMode !== "koth") hideKothStatus();

    try {
      let items;
      let ranks = [null, null];
      
      // Images always use Swiss mode
      if (battleType === "images" || currentMode === "swiss") {
        const swissResult = await fetchSwissPair();
        items = swissResult.performers || swissResult.images;
        ranks = swissResult.ranks;
      } else if (currentMode === "calibration") {
        const calibrationResult = await fetchCalibrationPair();
        items = calibrationResult.performers;
        ranks = calibrationResult.ranks;

        // Update calibration dashboard
        if (calibrationResult.coverageInfo) {
          updateCalibrationDashboard(calibrationResult.coverageInfo);
        }
      } else if (currentMode === "tournament") {
        const tournamentResult = await fetchTournamentPair();

        // Check for tournament completion
        if (tournamentResult.isVictory) {
          const champion = tournamentResult.tournamentInfo?.champion;
          showTournamentVictory(champion, tournamentResult.tournamentInfo);
          return;
        }

        items = tournamentResult.performers;
        ranks = tournamentResult.ranks;

        // Update bracket display
        if (tournamentResult.tournamentInfo) {
          updateTournamentBracketDisplay(tournamentResult.tournamentInfo);
        }
      } else if (currentMode === "koth") {
        const kothResult = await fetchKothPair();
        items = kothResult.performers;
        ranks = kothResult.ranks;

        // Update KOTH status display
        if (kothResult.kothInfo) {
          updateKothStatus(kothResult.kothInfo);
        }
      }
      
      if (items.length < 2) {
        if (battleType === "performers" && retryCount < MAX_LOAD_RETRIES) {
          console.warn(`[HotOrNot] Not enough performers, auto-retrying (${retryCount + 1}/${MAX_LOAD_RETRIES})...`);
          return loadNewPair(retryCount + 1);
        }
        const itemType = battleType === "performers" ? "performers" : "images";
        comparisonArea.innerHTML =
          `<div class="hon-error">Not enough ${itemType} available for comparison.</div>`;
        return;
      }

      currentPair.left = items[0];
      currentPair.right = items[1];
      currentRanks.left = ranks[0];
      currentRanks.right = ranks[1];

      comparisonArea.innerHTML = `
        <div class="hon-vs-container">
          ${(battleType === "performers" ? createPerformerCard : createImageCard)(items[0], "left", ranks[0], null)}
          <div class="hon-vs-divider">
            <span class="hon-vs-text">VS</span>
          </div>
          ${(battleType === "performers" ? createPerformerCard : createImageCard)(items[1], "right", ranks[1], null)}
        </div>
      `;

      // Attach event listeners to scene body (for choosing)
      comparisonArea.querySelectorAll(".hon-scene-body").forEach((body) => {
        body.addEventListener("click", handleChooseItem);
      });

      // Attach click-to-open (for thumbnail only)
      comparisonArea.querySelectorAll(".hon-scene-image-container").forEach((container) => {
        const itemUrl = container.dataset.performerUrl || container.dataset.imageUrl;
        
        container.addEventListener("click", () => {
          if (itemUrl) {
            window.open(itemUrl, "_blank");
          }
        });
      });

      // Attach hover preview to entire card
      comparisonArea.querySelectorAll(".hon-scene-card").forEach((card) => {
        const video = card.querySelector(".hon-hover-preview");
        if (!video) return;
        
        card.addEventListener("mouseenter", () => {
          video.currentTime = 0;
          video.muted = false;
          video.volume = 0.5;
          video.play().catch(() => {});
        });
        
        card.addEventListener("mouseleave", () => {
          video.pause();
          video.currentTime = 0;
        });
      });
      
      // Update skip button state (disabled during active tournament)
      const skipBtn = document.querySelector("#hon-skip-btn");
      if (skipBtn) {
        const isActiveTournament = currentMode === "tournament" && tournamentSetupDone;
        skipBtn.disabled = isActiveTournament;
        skipBtn.style.opacity = isActiveTournament ? "0.5" : "1";
        skipBtn.style.cursor = isActiveTournament ? "not-allowed" : "pointer";
      }

      // Show undo button when there is a previous battle to revert
      const undoBtn = document.querySelector("#hon-undo-btn");
      if (undoBtn) {
        if (previousBattle) {
          undoBtn.style.display = "";
          undoBtn.disabled = false;
          undoBtn.textContent = "↩ Undo Last Battle";
        } else {
          undoBtn.style.display = "none";
        }
      }
    } catch (error) {
      if (battleType === "performers" && retryCount < MAX_LOAD_RETRIES && error.message && error.message.includes("Not enough")) {
        console.warn(`[HotOrNot] ${error.message} Auto-retrying (${retryCount + 1}/${MAX_LOAD_RETRIES})...`);
        return loadNewPair(retryCount + 1);
      }
      console.error("[HotOrNot] Error loading items:", error);
      comparisonArea.innerHTML = `
        <div class="hon-error">
          Error loading items: ${error.message}<br>
          <button class="btn btn-primary" onclick="location.reload()">Retry</button>
        </div>
      `;
    }
  }

  /**
   * Save the current battle state before a choice is processed (for undo support).
   * Captures a deep copy of both items, ranks, and mode state.
   */
  function saveBattleState() {
    previousBattle = {
      left: structuredClone(currentPair.left),
      right: structuredClone(currentPair.right),
      ranks: { left: currentRanks.left, right: currentRanks.right },
      mode: currentMode,
      // Calibration state
      calibrationTarget: calibrationTarget ? structuredClone(calibrationTarget) : null,
      calibrationLow: calibrationLow,
      calibrationHigh: calibrationHigh,
      calibrationStep: calibrationStep,
      // Tournament state
      tournamentBracket: tournamentBracket ? structuredClone(tournamentBracket) : null,
      tournamentRound: tournamentRound,
      tournamentMatchIndex: tournamentMatchIndex,
      // KOTH state
      kothKing: kothKing ? structuredClone(kothKing) : null,
      kothStreak: kothStreak,
      kothBestStreak: kothBestStreak,
      kothBestKing: kothBestKing ? structuredClone(kothBestKing) : null,
      kothDethroned: structuredClone(kothDethroned),
    };
  }

  /**
   * Restore a performer's rating and stats to a pre-battle snapshot.
   * @param {string} performerId - The performer's ID
   * @param {number} oldRating - The rating to restore
   * @param {string|null} oldStats - Serialised hotornot_stats JSON string (or null if none)
   */
  async function restorePerformerState(performerId, oldRating, oldStats) {
    const mutation = `
      mutation RestorePerformerState($id: ID!, $rating: Int!, $fields: Map) {
        performerUpdate(input: {
          id: $id,
          rating100: $rating,
          custom_fields: {
            partial: $fields
          }
        }) {
          id
          rating100
          custom_fields
        }
      }
    `;

    const fields = oldStats !== null && oldStats !== undefined
      ? { hotornot_stats: oldStats }
      : {};

    return await graphqlQuery(mutation, {
      id: performerId,
      rating: Math.max(1, Math.min(100, Math.round(oldRating))),
      fields
    });
  }

  /**
   * Undo the last battle: restore both items to their pre-battle state and
   * re-show the same pair so the user can re-vote.
   */
  async function undoLastBattle() {
    if (!previousBattle) return;

    const undo = previousBattle;
    previousBattle = null;

    const undoBtn = document.getElementById("hon-undo-btn");
    if (undoBtn) {
      undoBtn.disabled = true;
      undoBtn.textContent = "↩ Reverting...";
    }

    try {
      if (battleType === "performers") {
        const leftStats = undo.left.custom_fields && undo.left.custom_fields.hotornot_stats
          ? undo.left.custom_fields.hotornot_stats : null;
        const rightStats = undo.right.custom_fields && undo.right.custom_fields.hotornot_stats
          ? undo.right.custom_fields.hotornot_stats : null;
        await Promise.all([
          restorePerformerState(undo.left.id, undo.left.rating100 || 50, leftStats),
          restorePerformerState(undo.right.id, undo.right.rating100 || 50, rightStats)
        ]);
      } else if (battleType === "images") {
        await Promise.all([
          updateImageRating(undo.left.id, undo.left.rating100 || 50),
          updateImageRating(undo.right.id, undo.right.rating100 || 50)
        ]);
      }

      // Restore mode state
      currentMode = undo.mode;

      // Restore calibration state
      if (undo.calibrationTarget !== undefined) {
        calibrationTarget = undo.calibrationTarget;
        calibrationLow = undo.calibrationLow;
        calibrationHigh = undo.calibrationHigh;
        calibrationStep = undo.calibrationStep;
      }

      // Restore tournament state
      if (undo.tournamentBracket !== undefined) {
        tournamentBracket = undo.tournamentBracket;
        tournamentRound = undo.tournamentRound;
        tournamentMatchIndex = undo.tournamentMatchIndex;
      }

      // Restore KOTH state
      if (undo.kothKing !== undefined) {
        kothKing = undo.kothKing;
        kothStreak = undo.kothStreak;
        kothBestStreak = undo.kothBestStreak;
        kothBestKing = undo.kothBestKing;
        kothDethroned = undo.kothDethroned;
      }

      // Restore the pair objects (with original ratings)
      currentPair.left = undo.left;
      currentPair.right = undo.right;
      currentRanks.left = undo.ranks.left;
      currentRanks.right = undo.ranks.right;

      // Re-render the comparison area with the same pair
      const comparisonArea = document.getElementById("hon-comparison-area");
      if (comparisonArea) {
        comparisonArea.innerHTML = `
          <div class="hon-vs-container">
            ${(battleType === "performers" ? createPerformerCard : createImageCard)(undo.left, "left", undo.ranks.left, null)}
            <div class="hon-vs-divider">
              <span class="hon-vs-text">VS</span>
            </div>
            ${(battleType === "performers" ? createPerformerCard : createImageCard)(undo.right, "right", undo.ranks.right, null)}
          </div>
        `;

        comparisonArea.querySelectorAll(".hon-scene-body").forEach((body) => {
          body.addEventListener("click", handleChooseItem);
        });

        comparisonArea.querySelectorAll(".hon-scene-image-container").forEach((container) => {
          const itemUrl = container.dataset.performerUrl || container.dataset.imageUrl;
          container.addEventListener("click", () => {
            if (itemUrl) window.open(itemUrl, "_blank");
          });
        });
      }

      // Update mode toggle button states
      const modal = document.getElementById("hon-modal");
      if (modal) {
        modal.querySelectorAll(".hon-mode-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.mode === currentMode);
        });
      }

      disableChoice = false;

      // Hide undo button — user can only undo one battle at a time
      if (undoBtn) {
        undoBtn.disabled = true;
        undoBtn.style.display = "none";
      }

      console.log("[HotOrNot] Battle undone successfully");
    } catch (err) {
      console.error("[HotOrNot] Error undoing battle:", err);
      // Restore previousBattle so the user can try again
      previousBattle = undo;
      if (undoBtn) {
        undoBtn.disabled = false;
        undoBtn.textContent = "↩ Undo Last Battle";
      }
    }
  }

  /**
   * Get the winner and loser items from the current pair based on the chosen winner ID.
   * Reads from the module-scoped `currentPair` state variable.
   * @param {string} winnerId - ID of the winner
   * @returns {{ winnerItem: Object, loserItem: Object }} Winner and loser objects
   */
  function getWinnerLoserItems(winnerId) {
    const isLeftWinner = winnerId === currentPair.left.id;
    return {
      winnerItem: isLeftWinner ? currentPair.left : currentPair.right,
      loserItem: isLeftWinner ? currentPair.right : currentPair.left
    };
  }

  /**
   * Show winner/loser visual feedback, rating animation, and schedule next pair load.
   * @param {HTMLElement} winnerCard - Winner card element
   * @param {HTMLElement|null} loserCard - Loser card element (may be null)
   * @param {number} winnerRating - Winner's old rating
   * @param {number} newWinnerRating - Winner's new rating
   * @param {number} winnerChange - Winner's rating change
   * @param {number} loserRating - Loser's old rating
   * @param {number} newLoserRating - Loser's new rating
   * @param {number} loserChange - Loser's rating change
   */
  function showResultAndLoadNext(winnerCard, loserCard, winnerRating, newWinnerRating, winnerChange, loserRating, newLoserRating, loserChange) {
    winnerCard.classList.add("hon-winner");
    if (loserCard) loserCard.classList.add("hon-loser");

    showRatingAnimation(winnerCard, winnerRating, newWinnerRating, winnerChange, true);
    if (loserCard) {
      showRatingAnimation(loserCard, loserRating, newLoserRating, loserChange, false);
    }

    setTimeout(() => {
      loadNewPair();
    }, 1500);
  }

  async function handleChooseItem(event) {
    if(disableChoice) return;
    disableChoice = true;
    // Save state BEFORE processing so the user can undo if they made a mistake
    saveBattleState();
    const body = event.currentTarget;
    const winnerId = body.dataset.winner;
    const winnerCard = body.closest(".hon-scene-card");
    const loserId = winnerId === currentPair.left.id ? currentPair.right.id : currentPair.left.id;
    
    const winnerRating = parseInt(winnerCard.dataset.rating) || 50;
    const loserCard = document.querySelector(`.hon-scene-card[data-performer-id="${loserId}"], .hon-scene-card[data-image-id="${loserId}"]`);
    const loserRating = parseInt(loserCard?.dataset.rating) || 50;

    const { winnerItem, loserItem } = getWinnerLoserItems(winnerId);

    // Handle calibration mode — update binary search bounds after each match
    if (currentMode === "calibration") {
      let { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
      );

      // Update binary search bounds for the calibration target
      if (calibrationTarget) {
        const anchorRating = Math.max(1, Math.min(100, calibrationTarget.id === winnerId ? loserRating : winnerRating));
        if (calibrationTarget.id === winnerId) {
          // Target won — they're at least as good as the anchor, raise lower bound
          calibrationLow = Math.max(calibrationLow, anchorRating);
        } else {
          // Target lost — they're below the anchor, lower upper bound
          calibrationHigh = Math.min(calibrationHigh, anchorRating);
        }
        calibrationStep++;

        // Check if calibration is done (converged or max steps reached)
        if (calibrationStep >= CALIBRATION_MAX_STEPS || (calibrationHigh - calibrationLow) <= CALIBRATION_CONVERGENCE_THRESHOLD) {
          const targetName = escapeHtml(calibrationTarget.name);
          const finalRating = Math.max(1, Math.min(100, Math.round((calibrationLow + calibrationHigh) / 2)));

          if ((calibrationHigh - calibrationLow) <= CALIBRATION_CONVERGENCE_THRESHOLD) {
            calibrationLastResult = `✅ ${targetName} converged at step ${calibrationStep}/${CALIBRATION_MAX_STEPS} — rating narrowed to ${calibrationLow}–${calibrationHigh}, final rating: ${finalRating}`;
          } else {
            calibrationLastResult = `✅ ${targetName} finished all ${CALIBRATION_MAX_STEPS} steps — rating set to ${finalRating}`;
          }

          // Override the target's rating with the calibration midpoint.
          // The ELO changes during calibration were for pairing guidance only;
          // the binary search midpoint is the true calibrated rating.
          const targetId = calibrationTarget.id;
          const targetIsWinner = (targetId === winnerId);
          const preCalibrationRating = targetIsWinner ? winnerRating : loserRating;

          if (battleType === "performers") {
            await updatePerformerRatingSimple(targetId, finalRating);
          } else {
            await updateImageRating(targetId, finalRating);
          }
          console.log(`[HotOrNot] Calibration finalized ${targetName} rating: ${preCalibrationRating} → ${finalRating}`);

          // Update animation values to show the calibrated final rating
          if (targetIsWinner) {
            newWinnerRating = finalRating;
            winnerChange = finalRating - preCalibrationRating;
          } else {
            newLoserRating = finalRating;
            loserChange = finalRating - preCalibrationRating;
          }

          // Reset target — next loadNewPair will pick a new performer to calibrate
          calibrationTarget = null;
          calibrationStep = 0;
          calibrationLow = 1;
          calibrationHigh = 100;
        }
      }

      showResultAndLoadNext(winnerCard, loserCard, winnerRating, newWinnerRating, winnerChange, loserRating, newLoserRating, loserChange);
      return;
    }

    // Handle tournament mode — record winner in bracket and advance
    if (currentMode === "tournament") {
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
      );

      // Update local performer objects with new ratings so the bracket
      // carries current values into subsequent rounds
      winnerItem.rating100 = newWinnerRating;
      loserItem.rating100 = newLoserRating;

      // Record winner in bracket
      if (tournamentBracket && tournamentRound < tournamentBracket.length) {
        const match = tournamentBracket[tournamentRound][tournamentMatchIndex];
        if (match) {
          match.winner = winnerItem;
          // Advance winner to next round
          advanceTournamentWinner(winnerItem, tournamentRound, tournamentMatchIndex);
          tournamentMatchIndex++;
        }
      }

      showResultAndLoadNext(winnerCard, loserCard, winnerRating, newWinnerRating, winnerChange, loserRating, newLoserRating, loserChange);
      return;
    }

    // Handle King of the Hill mode — king defends against challengers
    if (currentMode === "koth" && kothKing) {
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
      );

      if (winnerId === kothKing.id) {
        // King defended successfully
        kothStreak++;
        if (kothStreak > kothBestStreak) {
          kothBestStreak = kothStreak;
          kothBestKing = structuredClone(kothKing);
        }
        // Refresh king's rating
        kothKing.rating100 = newWinnerRating;
        console.log(`[HotOrNot] KOTH: ${kothKing.name} defends! Streak: ${kothStreak}`);

        showResultAndLoadNext(winnerCard, loserCard, winnerRating, newWinnerRating, winnerChange, loserRating, newLoserRating, loserChange);
      } else {
        // King dethroned!
        const oldKing = structuredClone(kothKing);
        const oldStreak = kothStreak;

        // Record the dethroned king in history
        kothDethroned.push({ name: oldKing.name, streak: oldStreak, id: oldKing.id });

        // The challenger becomes the new king
        kothKing = structuredClone(winnerItem);
        kothKing.rating100 = newWinnerRating;
        kothStreak = 0;

        console.log(`[HotOrNot] KOTH: ${oldKing.name} dethroned after ${oldStreak} wins! New king: ${kothKing.name}`);

        // Show rating animation, then show dethroned screen before loading next pair
        winnerCard.classList.add("hon-winner");
        if (loserCard) loserCard.classList.add("hon-loser");
        showRatingAnimation(winnerCard, winnerRating, newWinnerRating, winnerChange, true);
        if (loserCard) showRatingAnimation(loserCard, loserRating, newLoserRating, loserChange, false);

        setTimeout(() => {
          showKothDethroned(oldKing, kothKing, oldStreak);
          // Update KOTH status with new king info
          updateKothStatus({
            streak: kothStreak,
            bestStreak: kothBestStreak,
            bestKing: kothBestKing,
            dethroned: kothDethroned
          });

          // Auto-continue after showing dethroned screen
          setTimeout(() => {
            loadNewPair();
          }, 2500);
        }, 1500);
      }
      return;
    }

    // Swiss mode (default for both performers and images)
    const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
      winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
    );

    showResultAndLoadNext(winnerCard, loserCard, winnerRating, newWinnerRating, winnerChange, loserRating, newLoserRating, loserChange);
  }

  function showRatingAnimation(card, oldRating, newRating, change, isWinner) {
    // Clamp values to valid rating range
    const clampedOld = Math.max(1, Math.min(100, oldRating));
    const clampedNew = Math.max(1, Math.min(100, newRating));
    const clampedChange = clampedNew - clampedOld;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = `hon-rating-overlay ${isWinner ? 'hon-rating-winner' : 'hon-rating-loser'}`;
    
    const ratingDisplay = document.createElement("div");
    ratingDisplay.className = "hon-rating-display";
    ratingDisplay.textContent = clampedOld;
    
    const changeDisplay = document.createElement("div");
    changeDisplay.className = "hon-rating-change";
    changeDisplay.textContent = clampedChange >= 0 ? `+${clampedChange}` : `${clampedChange}`;
    
    overlay.appendChild(ratingDisplay);
    overlay.appendChild(changeDisplay);
    card.appendChild(overlay);

    // Animate the rating counting
    let currentDisplay = clampedOld;
    const step = clampedChange >= 0 ? 1 : -1;
    const totalSteps = Math.abs(clampedChange);
    let stepCount = 0;

    if (totalSteps > 0) {
      const interval = setInterval(() => {
        stepCount++;
        currentDisplay += step;
        ratingDisplay.textContent = currentDisplay;
        
        if (stepCount >= totalSteps) {
          clearInterval(interval);
          ratingDisplay.textContent = clampedNew;
        }
      }, 50);
    }

    // Remove overlay after animation
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  }

  // ============================================
  // PERFORMER PAGE RANK BADGE
  // ============================================

  /**
   * Fetch the battle rank for a performer by comparing their rating to all performers.
   * @param {string} performerId - The ID of the performer
   * @returns {Promise<{rank: number, total: number, rating: number}|null>} Rank info or null on error
   */
  async function getPerformerBattleRank(performerId) {
    try {
      const performersQuery = `
        query FindPerformersByRating($filter: FindFilterType) {
          findPerformers(filter: $filter) {
            count
            performers {
              id
              rating100
              custom_fields
            }
          }
        }
      `;

      // Get ALL performers sorted by rating descending (highest first)
      const result = await graphqlQuery(performersQuery, {
        filter: {
          per_page: -1, // Get all
          sort: "rating",
          direction: "DESC"
        }
      });

      const performers = result.findPerformers.performers || [];
      const total = performers.length;

      if (total === 0) {
        return null;
      }

      // Find the performer's position in the sorted list
      const index = performers.findIndex(p => p.id === performerId);
      if (index === -1) {
        return null;
      }

      const performer = performers[index];
      
      // Parse match stats from custom_fields
      const stats = parsePerformerEloData(performer);
      
      return {
        rank: index + 1,
        total: total,
        rating: performer.rating100 || 0,
        stats: stats
      };
    } catch (error) {
      console.error("[HotOrNot] Error fetching performer battle rank:", error);
      return null;
    }
  }

  /**
   * Create the battle rank badge element with match stats
   * @param {number} rank - The performer's rank
   * @param {number} total - Total number of performers
   * @param {number} rating - The performer's rating100
   * @param {Object} stats - Match statistics (wins, losses, draws, current_streak, etc.)
   * @returns {HTMLElement} The badge element
   */
  function createBattleRankBadge(rank, total, rating, stats = null) {
    const badge = document.createElement("div");
    badge.className = "hon-battle-rank-badge";
    badge.id = "hon-battle-rank-badge";
    
    // Determine rank tier for styling
    const percentile = ((total - rank + 1) / total) * 100;
    let tierClass = "";
    let tierEmoji = "";
    
    if (percentile >= 95) {
      tierClass = "hon-rank-legendary";
      tierEmoji = "👑";
    } else if (percentile >= 80) {
      tierClass = "hon-rank-gold";
      tierEmoji = "🥇";
    } else if (percentile >= 60) {
      tierClass = "hon-rank-silver";
      tierEmoji = "🥈";
    } else if (percentile >= 40) {
      tierClass = "hon-rank-bronze";
      tierEmoji = "🥉";
    } else {
      tierClass = "hon-rank-default";
      tierEmoji = "🔥";
    }
    
    // Note: Tier-based color classes removed for better readability
    // The tier emoji still indicates ranking percentile
    
    // Build match stats HTML if stats are available and performer has played matches
    let matchStatsHTML = '';
    let winRate = null;
    const hasMatchStats = stats && stats.total_matches > 0;
    
    if (hasMatchStats) {
      // Calculate win rate once for both display and tooltip
      winRate = ((stats.wins / stats.total_matches) * 100).toFixed(1);
      
      // Format current streak with color indicator
      let streakDisplay = '';
      if (stats.current_streak > 0) {
        streakDisplay = `<span class="hon-streak-positive">W${stats.current_streak}</span>`;
      } else if (stats.current_streak < 0) {
        streakDisplay = `<span class="hon-streak-negative">L${Math.abs(stats.current_streak)}</span>`;
      }
      
      matchStatsHTML = `
        <span class="hon-match-stats">
          <span class="hon-stats-record">
            <span class="hon-wins">${stats.wins}W</span>
            <span class="hon-losses">${stats.losses}L</span>
            <span class="hon-draws">${stats.draws}D</span>
          </span>
          <span class="hon-win-rate">${winRate}%</span>
          ${streakDisplay}
        </span>
      `;
    }
    
    badge.innerHTML = `
      <span class="hon-rank-emoji">${tierEmoji}</span>
      <span class="hon-rank-text">Battle Rank #${rank}</span>
      <span class="hon-rank-total">of ${total}</span>
      ${matchStatsHTML}
    `;
    
    // Build comprehensive tooltip
    let tooltipText = `Battle Rank #${rank} of ${total} performers (Rating: ${rating}/100)`;
    if (hasMatchStats) {
      tooltipText += `\n\nMatch Stats:`;
      tooltipText += `\n• Record: ${stats.wins}W - ${stats.losses}L - ${stats.draws}D`;
      tooltipText += `\n• Win Rate: ${winRate}%`;
      tooltipText += `\n• Total Matches: ${stats.total_matches}`;
      if (stats.current_streak !== 0) {
        const streakType = stats.current_streak > 0 ? 'Winning' : 'Losing';
        tooltipText += `\n• Current Streak: ${streakType} ${Math.abs(stats.current_streak)}`;
      }
      if (stats.best_streak > 0) {
        tooltipText += `\n• Best Streak: ${stats.best_streak}`;
      }
      if (stats.worst_streak < 0) {
        tooltipText += `\n• Worst Streak: ${Math.abs(stats.worst_streak)}`;
      }
    }
    badge.title = tooltipText;
    
    return badge;
  }

  /**
   * Inject the battle rank badge into the performer detail page.
   * Looks for the rating stars section and adds the badge next to it.
   */
  async function injectBattleRankBadge() {
    // Skip injection if the user has disabled the battle rank badge in Stash settings
    if (!await isBattleRankBadgeEnabled()) {
      return;
    }
    // Use compare-and-set pattern with global flag to prevent concurrent injections
    // This handles both same-plugin races and cross-plugin races
    // In JavaScript's single-threaded event loop, this synchronous block before any await is atomic
    if (window._honBadgeInjectionInProgress || badgeInjectionInProgress) {
      return;
    }
    // Set flags immediately after check - atomic in JS single-threaded event loop
    window._honBadgeInjectionInProgress = true;
    badgeInjectionInProgress = true;
    
    try {
      const performerId = getPerformerIdFromUrl();
      if (!performerId) {
        return;
      }

      // Check if badge already exists (another plugin or previous call may have added it)
      const existingBadge = document.getElementById("hon-battle-rank-badge");
      if (existingBadge) {
        return;
      }

      // Fetch the performer's battle rank
      const rankInfo = await getPerformerBattleRank(performerId);
      if (!rankInfo) {
        console.log("[HotOrNot] Could not fetch battle rank for performer");
        return;
      }

      // Double-check badge doesn't exist after async fetch (another call may have completed)
      if (document.getElementById("hon-battle-rank-badge")) {
        return;
      }

      // Create the badge with stats
      const badge = createBattleRankBadge(rankInfo.rank, rankInfo.total, rankInfo.rating, rankInfo.stats);

      // Find the best place to inject the badge
      // Try to find the rating stars container first (next to star rating)
      const ratingContainer = document.querySelector(".rating-stars") ||
                             document.querySelector(".rating-number") ||
                             document.querySelector("[class*='rating']");
      
      if (ratingContainer && ratingContainer.parentElement) {
        // Insert badge next to the rating
        ratingContainer.parentElement.appendChild(badge);
        console.log(`[HotOrNot] Injected battle rank badge: #${rankInfo.rank} of ${rankInfo.total}`);
        return;
      }

      // Alternative: Find performer detail header area
      const detailHeader = document.querySelector(".performer-head") ||
                          document.querySelector(".detail-header") ||
                          document.querySelector(".performer-meta") ||
                          document.querySelector(".detail-container h2")?.parentElement;
      
      if (detailHeader) {
        detailHeader.appendChild(badge);
        console.log(`[HotOrNot] Injected battle rank badge into header: #${rankInfo.rank} of ${rankInfo.total}`);
        return;
      }

      // Last resort: Find performer name and insert after it
      const performerName = document.querySelector("h2") || document.querySelector("h1");
      if (performerName && performerName.parentElement) {
        performerName.parentElement.insertBefore(badge, performerName.nextSibling);
        console.log(`[HotOrNot] Injected battle rank badge after name: #${rankInfo.rank} of ${rankInfo.total}`);
      }
    } finally {
      window._honBadgeInjectionInProgress = false;
      badgeInjectionInProgress = false;
    }
  }

  // ============================================
  // MODAL & NAVIGATION
  // ============================================

  /**
   * Extract performer ID from a single performer page URL.
   * Returns the performer ID if on /performers/{id} page, null otherwise.
   * @returns {string|null} Performer ID or null
   */
  function getPerformerIdFromUrl() {
    const path = window.location.pathname;
    // Match /performers/{id} where {id} is a numeric performer ID (one or more digits)
    // Matches paths like /performers/123, /performers/123/, /performers/123/scenes, etc.
    // Uses (?:\/|$) to match either a trailing slash or end of string after the ID
    const match = path.match(/^\/performers\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  /**
   * Check if we're on a single performer page (/performers/{id})
   * @returns {boolean} True if on a single performer page
   */
  function isOnSinglePerformerPage() {
    return getPerformerIdFromUrl() !== null;
  }

  function shouldShowButton() {
    const path = window.location.pathname;
    // Show on /performers or /images listing pages
    if (path === '/performers' || path === '/performers/' || path === '/images' || path === '/images/') {
      return true;
    }
    // Also show on individual performer pages (/performers/{id})
    if (isOnSinglePerformerPage()) {
      return true;
    }
    return false;
  }

  /**
   * Attempt to inject the 🔥 HotOrNot button into Stash's top navigation bar.
   * Tries several common Stash navbar CSS selectors in order of preference.
   * @returns {boolean} True if the button was successfully injected, false if no navbar was found.
   */
function addNavbarButton() {
    if (document.getElementById("hon-nav-btn")) return true;

    // Try multiple selectors for Stash's navbar container (right-side area)
    const navbarSelectors = [
      ".top-nav .ms-auto",
      ".navbar .ms-auto",
      ".navbar-buttons",
      ".top-nav",
      ".navbar"
    ];

    let navbarContainer = null;
    for (const selector of navbarSelectors) {
      const found = document.querySelector(selector);
      if (found) {
        navbarContainer = found;
        break;
      }
    }

    if (!navbarContainer) return false;

    const btn = document.createElement("button");
    btn.id = "hon-nav-btn";
    btn.innerHTML = "🔥";
    btn.title = "HotOrNot";
    btn.className = "hon-nav-btn";
    btn.addEventListener("click", openRankingModal);
    navbarContainer.appendChild(btn);
    return true;
  }

  /**
   * Add the HotOrNot launch button to the UI.
   * Attempts navbar injection first; falls back to the original fixed floating button
   * when no Stash navbar container can be located.
   */
function addFloatingButton() {
    const existingNavBtn = document.getElementById("hon-nav-btn");
    const existingFloatBtn = document.getElementById("hon-floating-btn");

    // If navbar button already present, ensure no floating button
    if (existingNavBtn) {
      if (existingFloatBtn) existingFloatBtn.remove();
      return;
    }

    // Try to inject into navbar first
    if (addNavbarButton()) {
      if (existingFloatBtn) existingFloatBtn.remove();
      return;
    }

    // Fall back to floating button (original behaviour)
    if (!shouldShowButton()) {
      if (existingFloatBtn) existingFloatBtn.remove();
      return;
    }

    // Don't add duplicate
    if (existingFloatBtn) return;

    const btn = document.createElement("button");
    btn.id = "hon-floating-btn";
    btn.innerHTML = "🔥";
    btn.title = "HotOrNot";

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
      btn.style.boxShadow = "0 6px 20px rgba(13, 110, 253, 0.6)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 15px rgba(13, 110, 253, 0.4)";
    });

    btn.addEventListener("click", openRankingModal);

    document.body.appendChild(btn);
  }

  async function openRankingModal() {
    // Detect if we're on performers or images page
    const path = window.location.pathname;
    if (path === '/images' || path === '/images/') {
      battleType = "images";
      // For images, always use Swiss mode
      currentMode = "swiss";
      // Images don't use URL filters
      cachedUrlFilter = null;
    } else {
      battleType = "performers";
      // Check if we're on a single performer page (only relevant for performers)
      const singlePerformerId = getPerformerIdFromUrl();
      // When on a single performer page, use calibration mode to find their rating
      if (singlePerformerId) {
        currentMode = "calibration";
        // No URL filters when on single performer page
        cachedUrlFilter = null;
        console.log(`[HotOrNot] On single performer page, auto-launching calibration with performer ID: ${singlePerformerId}`);
      } else {
        // Always refresh URL filters when modal opens to capture current state
        // This ensures we get the latest filters from the URL, including any changes
        // made since the last location event or page load
        cachedUrlFilter = getUrlPerformerFilter();
        
        // Log cached filter for debugging
        if (cachedUrlFilter && Object.keys(cachedUrlFilter).length > 0) {
          console.log('[HotOrNot] Using URL filters for performers:', cachedUrlFilter);
        } else {
          console.log('[HotOrNot] No URL filters detected');
        }
      }
    }
    
    // Get performer ID again after battleType is set (only check for performers)
    const singlePerformerId = battleType === "performers" ? getPerformerIdFromUrl() : null;
    
    const existingModal = document.getElementById("hon-modal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "hon-modal";
    modal.innerHTML = `
      <div class="hon-modal-backdrop"></div>
      <div class="hon-modal-content">
        <button class="hon-modal-close">✕</button>
        ${createMainUI()}
      </div>
    `;

    document.body.appendChild(modal);

    // Mode toggle buttons (only shown for performers)
    modal.querySelectorAll(".hon-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Images always stay in Swiss mode
        if (battleType === "images") return;
        
        const newMode = btn.dataset.mode;
        if (newMode !== currentMode) {
          currentMode = newMode;
          
          // Reset all mode-specific state when switching modes
          resetAllModeState();
          // Clear undo state on mode change (previous battle is no longer valid)
          previousBattle = null;
          
          // Update button states
          modal.querySelectorAll(".hon-mode-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === currentMode);
          });
          
          // Re-show actions (skip button) in case it was hidden
          const actionsEl = document.querySelector(".hon-actions");
          if (actionsEl) actionsEl.style.display = "";
          
          // Hide all mode-specific panels
          hideTournamentSetup();
          hideCalibrationDashboard();
          hideTournamentBracket();
          hideKothStatus();
          
          // Load new pair in new mode
          loadNewPair();
        }
      });
    });

    // Skip button
    const skipBtn = modal.querySelector("#hon-skip-btn");
    if (skipBtn) {
      skipBtn.addEventListener("click", async () => {
        // In tournament mode, skip is disabled (must pick a winner)
        if (currentMode === "tournament" && tournamentSetupDone) {
          return;
        }
        if(disableChoice) return
        disableChoice = true;
        // Apply ELO draw rating changes for skips in Swiss and calibration modes
        // KOTH skips just fetch a new challenger — no draw penalty (king stays)
        if ((currentMode === "swiss" || currentMode === "calibration") && currentPair.left && currentPair.right) {
          await handleSkip(currentPair.left, currentPair.right);
        }
        loadNewPair();
      });
    }

    // Stats button (performers only)
    const statsBtn = modal.querySelector("#hon-stats-btn");
    if (statsBtn) {
      statsBtn.addEventListener("click", () => {
        openStatsModal();
      });
    }

    // Undo button
    const undoBtn = modal.querySelector("#hon-undo-btn");
    if (undoBtn) {
      undoBtn.addEventListener("click", () => {
        undoLastBattle();
      });
    }

    // If on a single performer page, auto-start calibration for that performer
    if (singlePerformerId) {
      const performer = await fetchPerformerById(singlePerformerId);
      if (performer) {
        console.log(`[HotOrNot] Fetched performer for calibration:`, performer.name);
        // Set the performer as the calibration target so calibration mode
        // focuses on rating this specific performer
        calibrationTarget = performer;
        calibrationStep = 0;
        calibrationLow = 1;
        calibrationHigh = 100;
      } else {
        console.error(`[HotOrNot] Could not fetch performer with ID: ${singlePerformerId}. Performer may have been deleted, access restricted, or ID is invalid.`);
      }
      // Load initial comparison (calibration mode is already set)
      loadNewPair();
    } else {
      // Load initial comparison
      loadNewPair();
    }

    // Close handlers
    modal.querySelector(".hon-modal-backdrop").addEventListener("click", closeRankingModal);
    modal.querySelector(".hon-modal-close").addEventListener("click", closeRankingModal);
    
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeRankingModal();
        document.removeEventListener("keydown", escHandler);
      }
    });

    // Keyboard shortcuts for choosing
    document.addEventListener("keydown", async function keyHandler(e) {
      const modal = document.getElementById("hon-modal");
      if (!modal) {
        document.removeEventListener("keydown", keyHandler);
        return;
      }

      if (e.key === "ArrowLeft" && currentPair.left) {
        const leftBody = modal.querySelector('.hon-scene-card[data-side="left"] .hon-scene-body');
        if (leftBody) leftBody.click();
      }
      if (e.key === "ArrowRight" && currentPair.right) {
        const rightBody = modal.querySelector('.hon-scene-card[data-side="right"] .hon-scene-body');
        if (rightBody) rightBody.click();
      }
      if (e.key === " " || e.code === "Space") {
        const activeElement = document.activeElement;
        if (activeElement.tagName !== "INPUT" && activeElement.tagName !== "TEXTAREA") {
          e.preventDefault();
          // Don't skip during tournament (must pick a winner)
          if (currentMode === "tournament" && tournamentSetupDone) {
            return;
          }
          if(disableChoice) return;
          disableChoice = true;
          // Apply ELO draw rating changes for skips in Swiss and calibration modes
          // KOTH skips just fetch a new challenger — no draw penalty (king stays)
          if ((currentMode === "swiss" || currentMode === "calibration") && currentPair.left && currentPair.right) {
            await handleSkip(currentPair.left, currentPair.right);
          }
          loadNewPair();
        }
      }
    });
  }

  function closeRankingModal() {
    const modal = document.getElementById("hon-modal");
    if (modal) modal.remove();
    // Clear undo state when modal closes
    previousBattle = null;
    // Reset all mode state
    resetAllModeState();
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log("[HotOrNot] Initialized");
    
    addFloatingButton();
    
    // Inject battle rank badge if on a single performer page
    if (isOnSinglePerformerPage()) {
      // Delay slightly to ensure the page has rendered
      setTimeout(() => injectBattleRankBadge(), 500);
    }

    // Watch for SPA navigation
    const observer = new MutationObserver(() => {
      addFloatingButton();
      // Also try to inject badge when DOM changes on performer pages
      if (isOnSinglePerformerPage() && !document.getElementById("hon-battle-rank-badge")) {
        injectBattleRankBadge();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    // Listen for location changes to update cached filters
    // This ensures filters are always up-to-date when users navigate or change filters
    if (typeof PluginApi !== 'undefined' && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", (e) => {
        console.log("[HotOrNot] Page changed:", e.detail.data.location.pathname);
        
        const path = e.detail.data.location.pathname;

        // Invalidate plugin config cache when navigating away from Settings,
        // so the badge respects any changes the user made.
        if (path !== '/settings') {
          pluginConfigCache = null;
        }

        // Update cached filter when on performers page
        if (path === '/performers' || path === '/performers/') {
          // Parse current filters from URL
          const newFilter = getUrlPerformerFilter();
          
          // Only update cache if modal is not currently open
          // (if modal is open, it should continue using the filters it was opened with)
          const modalOpen = document.getElementById("hon-modal") !== null;
          if (!modalOpen) {
            cachedUrlFilter = newFilter;
            if (newFilter && Object.keys(newFilter).length > 0) {
              console.log('[HotOrNot] Updated cached filters:', newFilter);
            } else {
              console.log('[HotOrNot] Cleared cached filters (no filters active)');
            }
          }
        }
        
        // Inject battle rank badge when navigating to a single performer page
        if (isOnSinglePerformerPage()) {
          // Delay to allow the page to render
          setTimeout(() => injectBattleRankBadge(), 500);
        }
      });
    }
  }

  // ============================================
  // PERFORMER CARD STAR RATING WIDGET
  // (Integrated from rating plugin)
  // ============================================
  
  // Local cache for ratings to ensure UI stays in sync across React re-renders
  // Map<performerId, { rating100: number|null, timestamp: number }>
  const ratingsCache = new Map();
  
  // Cache TTL in milliseconds (5 minutes) - after this, we'll re-fetch from server
  const RATINGS_CACHE_TTL = 5 * 60 * 1000;
  
  /**
   * Get a rating from the local cache
   * @param {string} performerId - Performer ID
   * @returns {number|null|undefined} Cached rating, or undefined if not cached or expired
   */
  function getCachedRatingForWidget(performerId) {
    const cached = ratingsCache.get(performerId);
    if (!cached) return undefined;
    
    // Check if cache entry is still valid
    if (Date.now() - cached.timestamp > RATINGS_CACHE_TTL) {
      ratingsCache.delete(performerId);
      return undefined;
    }
    
    return cached.rating100;
  }
  
  /**
   * Set a rating in the local cache
   * @param {string} performerId - Performer ID
   * @param {number|null} rating100 - Rating value
   */
  function setCachedRatingForWidget(performerId, rating100) {
    ratingsCache.set(performerId, {
      rating100,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update performer rating via GraphQL (simple version for star widget)
   * @param {string} performerId - The performer's ID
   * @param {number} rating100 - Rating value (0-100)
   * @returns {Promise<Object>} Updated performer data
   */
  async function updatePerformerRatingSimple(performerId, rating100) {
    const mutation = `
      mutation UpdatePerformerRating($id: ID!, $rating: Int!) {
        performerUpdate(input: {
          id: $id,
          rating100: $rating
        }) {
          id
          rating100
        }
      }
    `;

    const result = await graphqlQuery(mutation, {
      id: performerId,
      rating: Math.max(0, Math.min(100, Math.round(rating100)))
    });

    const updatedRating = result.performerUpdate.rating100;
    
    // Update the local cache so React re-renders use the correct value
    setCachedRatingForWidget(performerId, updatedRating);
    
    console.log(`[HotOrNot] Updated performer ${performerId} rating to ${updatedRating}`);
    
    // Dispatch custom event so all rating widgets for this performer can update
    document.dispatchEvent(new CustomEvent("performer:rating:updated", {
      detail: { performerId, rating100: updatedRating }
    }));
    
    return result.performerUpdate;
  }
  
  /**
   * Get performer rating by ID
   * Uses local cache for recently updated ratings to ensure UI consistency
   * @param {string} performerId - The performer's ID
   * @returns {Promise<number|null>} Rating value or null if not rated
   */
  async function getPerformerRatingForWidget(performerId) {
    // Check the cache first
    const cachedRating = getCachedRatingForWidget(performerId);
    if (cachedRating !== undefined) {
      return cachedRating;
    }
    
    const query = `
      query GetPerformerRating($id: ID!) {
        findPerformer(id: $id) {
          id
          rating100
        }
      }
    `;

    const result = await graphqlQuery(query, { id: performerId });
    const rating = result.findPerformer ? result.findPerformer.rating100 : null;
    
    // Cache the fetched rating
    setCachedRatingForWidget(performerId, rating);
    
    return rating;
  }
  
  /**
   * Get multiple performer ratings in a single request
   * Uses local cache for recently updated ratings to ensure UI consistency
   * @param {string[]} performerIds - Array of performer IDs
   * @returns {Promise<Map<string, number|null>>} Map of performer ID to rating
   */
  async function getMultiplePerformerRatingsForWidget(performerIds) {
    if (performerIds.length === 0) {
      return new Map();
    }

    const ratings = new Map();
    const uncachedIds = [];
    
    // First, check the cache for each performer
    for (const id of performerIds) {
      const cachedRating = getCachedRatingForWidget(id);
      if (cachedRating !== undefined) {
        ratings.set(id, cachedRating);
      } else {
        uncachedIds.push(id);
      }
    }
    
    // If all ratings were cached, return immediately
    if (uncachedIds.length === 0) {
      return ratings;
    }

    // Build a query that fetches only uncached performers
    // GraphQL aliases allow us to query the same field multiple times with different arguments
    const aliasedQueries = uncachedIds.map((id, index) => 
      `p${index}: findPerformer(id: "${id}") { id rating100 }`
    ).join("\n");

    const query = `query GetMultiplePerformerRatings { ${aliasedQueries} }`;

    try {
      const result = await graphqlQuery(query, {});
      
      uncachedIds.forEach((id, index) => {
        const performer = result[`p${index}`];
        const rating = performer ? performer.rating100 : null;
        ratings.set(id, rating);
        // Cache the fetched rating
        setCachedRatingForWidget(id, rating);
      });
      
      return ratings;
    } catch (err) {
      console.error("[HotOrNot] Error fetching multiple ratings:", err);
      // Log which performers couldn't be fetched
      if (uncachedIds.length > 0) {
        console.warn(`[HotOrNot] Failed to fetch ratings for performers: ${uncachedIds.join(", ")}`);
      }
      // Return what we have from cache (may be partial)
      return ratings;
    }
  }

  /**
   * Create a star rating widget
   * @param {number|null} currentRating - Current rating100 value (0-100) or null
   * @param {string} performerId - Performer ID for updates
   * @returns {HTMLElement} Star rating container element
   */
  function createStarRatingWidget(currentRating, performerId) {
    const container = document.createElement("div");
    container.className = "hon-star-rating";
    container.dataset.performerId = performerId;
    // Store the current rating in dataset so it can be updated
    container.dataset.currentRating = currentRating !== null ? currentRating : "";

    // Convert rating100 to 10-star scale (0-100 -> 0-10)
    const starValue = currentRating !== null ? currentRating / 10 : 0;
    const fullStars = Math.floor(starValue);
    const hasHalfStar = starValue - fullStars >= 0.5;

    // Create 10 stars
    for (let i = 1; i <= 10; i++) {
      const star = document.createElement("span");
      star.className = "hon-star";
      star.dataset.value = i;

      if (i <= fullStars) {
        star.classList.add("hon-star-filled");
        star.innerHTML = "★";
      } else if (i === fullStars + 1 && hasHalfStar) {
        star.classList.add("hon-star-half");
        star.innerHTML = "★";
      } else {
        star.classList.add("hon-star-empty");
        star.innerHTML = "☆";
      }

      // Click handler for rating
      star.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const newStarValue = parseInt(star.dataset.value);
        const newRating100 = newStarValue * 10; // Convert back to rating100
        
        try {
          await updatePerformerRatingSimple(performerId, newRating100);
          // Update the stored rating in dataset
          container.dataset.currentRating = newRating100;
          updateStarWidgetDisplay(container, newRating100);
          showStarRatingFeedback(container);
          // Update any native Stash rating displays on the card
          const parentCard = findParentCardForWidget(container);
          updateNativeRatingDisplayOnCard(parentCard, newRating100);
        } catch (err) {
          console.error("[HotOrNot] Failed to update rating:", err);
          showStarRatingError(container);
        }
      });

      // Hover effects
      star.addEventListener("mouseenter", () => {
        previewStarWidgetHover(container, parseInt(star.dataset.value));
      });

      container.appendChild(star);
    }

    // Reset hover preview when mouse leaves - use stored rating from dataset
    container.addEventListener("mouseleave", () => {
      const storedRating = container.dataset.currentRating;
      const ratingValue = storedRating !== "" ? parseInt(storedRating) : null;
      updateStarWidgetDisplay(container, ratingValue);
    });

    // Prevent card click when interacting with rating
    container.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return container;
  }

  /**
   * Update star display based on rating
   * @param {HTMLElement} container - Star rating container
   * @param {number|null} rating100 - Rating value (0-100) or null
   */
  function updateStarWidgetDisplay(container, rating100) {
    const stars = container.querySelectorAll(".hon-star");
    const starValue = rating100 !== null ? rating100 / 10 : 0;
    const fullStars = Math.floor(starValue);
    const hasHalfStar = starValue - fullStars >= 0.5;

    stars.forEach((star, index) => {
      const value = index + 1;
      star.classList.remove("hon-star-filled", "hon-star-half", "hon-star-empty", "hon-star-preview");

      if (value <= fullStars) {
        star.classList.add("hon-star-filled");
        star.innerHTML = "★";
      } else if (value === fullStars + 1 && hasHalfStar) {
        star.classList.add("hon-star-half");
        star.innerHTML = "★";
      } else {
        star.classList.add("hon-star-empty");
        star.innerHTML = "☆";
      }
    });
  }

  /**
   * Preview star hover state
   * @param {HTMLElement} container - Star rating container
   * @param {number} hoverValue - Star value being hovered (1-10)
   */
  function previewStarWidgetHover(container, hoverValue) {
    const stars = container.querySelectorAll(".hon-star");
    stars.forEach((star, index) => {
      const value = index + 1;
      star.classList.remove("hon-star-preview");
      if (value <= hoverValue) {
        star.classList.add("hon-star-preview");
        star.innerHTML = "★";
      } else {
        // Reset non-hovered stars to empty state
        star.innerHTML = "☆";
      }
    });
  }

  /**
   * Show brief feedback after rating update
   * @param {HTMLElement} container - Star rating container
   */
  function showStarRatingFeedback(container) {
    // Add visual feedback to the container
    container.classList.add("hon-feedback-success");
    setTimeout(() => {
      container.classList.remove("hon-feedback-success");
    }, 500);
  }

  /**
   * Show error feedback after failed rating update
   * @param {HTMLElement} container - Star rating container
   */
  function showStarRatingError(container) {
    // Add visual feedback to the container
    container.classList.add("hon-feedback-error");
    setTimeout(() => {
      container.classList.remove("hon-feedback-error");
    }, 1000);
  }

  /**
   * Extract performer ID from a performer card element
   * @param {HTMLElement} card - Performer card element
   * @returns {string|null} Performer ID or null
   */
  function getPerformerIdFromCard(card) {
    // Try getting from card's link href (e.g., /performers/123)
    const link = card.querySelector("a[href*='/performers/']");
    if (link) {
      const href = link.getAttribute("href");
      const match = href.match(/\/performers\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    // Try data attributes
    if (card.dataset.performerId) {
      return card.dataset.performerId;
    }

    return null;
  }

  /**
   * Update Stash's native rating display elements on the card
   * This ensures all rating displays are synchronized after a rating change
   * @param {HTMLElement} card - Performer card element
   * @param {number} rating100 - New rating value (0-100)
   */
  function updateNativeRatingDisplayOnCard(card, rating100) {
    if (!card) return;
    
    // Find and update any native Stash rating elements on the card
    // Look for common Stash rating element patterns
    const ratingSelectors = [
      ".rating-number",
      ".rating-value",
      ".rating-display",
      "[class*='rating'][class*='number']",
      "[class*='rating'][class*='value']"
    ];
    
    // Try specific selectors first for better performance
    let ratingElements = [];
    for (const selector of ratingSelectors) {
      const found = card.querySelectorAll(selector);
      if (found.length > 0) {
        ratingElements = Array.from(found);
        break;
      }
    }
    
    // Fallback to broader selector if no specific elements found
    if (ratingElements.length === 0) {
      ratingElements = Array.from(card.querySelectorAll("[class*='rating']"));
    }
    
    ratingElements.forEach(el => {
      // Skip our plugin's rating widget
      if (el.classList.contains("hon-star-rating") || 
          el.closest(".hon-star-rating")) {
        return;
      }
      
      // Update the text content if it contains a valid rating number (0-100)
      const text = el.textContent.trim();
      // Match numbers that could be ratings (1-3 digits, standalone or at start/end)
      const match = text.match(/^(\d{1,3})$|^(\d{1,3})\/|\/(\d{1,3})$/);
      if (match) {
        // Get the matched number (from any of the capture groups)
        const matchedNumber = match[1] || match[2] || match[3];
        const numericValue = parseInt(matchedNumber, 10);
        // Only update if the number is in valid rating range
        if (numericValue >= 0 && numericValue <= 100) {
          el.textContent = text.replace(matchedNumber, rating100.toString());
        }
      }
    });
  }

  /**
   * Find the parent card element containing the rating widget
   * @param {HTMLElement} container - The rating widget container
   * @returns {HTMLElement|null} The parent card element or null
   */
  function findParentCardForWidget(container) {
    // Walk up the DOM tree to find the performer card
    let element = container.parentElement;
    while (element) {
      // Check for common card class names first (fast)
      if (element.classList.contains("performer-card") ||
          element.classList.contains("card")) {
        return element;
      }
      // Check for direct link as child (faster than querySelector)
      const children = element.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.tagName === "A" && 
            child.href && 
            child.href.includes("/performers/")) {
          return element;
        }
      }
      element = element.parentElement;
    }
    return null;
  }

  /**
   * Check if rating widget already exists on card
   * @param {HTMLElement} card - Performer card element
   * @returns {boolean} True if widget exists
   */
  function hasStarRatingWidget(card) {
    return card.querySelector(".hon-star-rating") !== null;
  }

  /**
   * Inject rating widget into performer card
   * @param {HTMLElement} card - Performer card element
   * @param {number|null} rating - Pre-fetched rating value (optional)
   */
  async function injectStarRatingWidget(card, rating = undefined) {
    if (hasStarRatingWidget(card)) {
      return;
    }

    const performerId = getPerformerIdFromCard(card);
    if (!performerId) {
      console.warn("[HotOrNot] Could not get performer ID from card");
      return;
    }

    try {
      // Fetch current rating from API if not provided
      if (rating === undefined) {
        rating = await getPerformerRatingForWidget(performerId);
      }
      
      // Create and inject the widget
      const ratingWidget = createStarRatingWidget(rating, performerId);
      
      // Find the best place to inject (after the image, before other content)
      const cardContent = card.querySelector(".performer-card-content") || 
                         card.querySelector(".card-section") ||
                         card.querySelector(".card-body") ||
                         card;
      
      // Try to insert at the beginning of the card content
      if (cardContent.firstChild) {
        cardContent.insertBefore(ratingWidget, cardContent.firstChild);
      } else {
        cardContent.appendChild(ratingWidget);
      }

      // Mark card as processed
      card.dataset.honRatingProcessed = "true";
    } catch (err) {
      console.error("[HotOrNot] Error injecting rating widget:", err);
    }
  }

  /**
   * Process all performer cards on the page for star rating widgets
   */
  async function processPerformerCardsForRating() {
    // Various selectors for performer cards in Stash UI
    const cardSelectors = [
      ".performer-card",
      "[class*='PerformerCard']",
      ".card.performer",
      ".grid-item.performer"
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    // Alternative: look for cards that have performer links
    if (cards.length === 0) {
      const allCards = document.querySelectorAll(".card");
      cards = Array.from(allCards).filter(card => {
        const link = card.querySelector("a[href*='/performers/']");
        return link !== null;
      });
    }

    // Filter to only unprocessed cards
    const unprocessedCards = cards.filter(card => !card.dataset.honRatingProcessed);
    if (unprocessedCards.length === 0) {
      return;
    }

    // Collect performer IDs for batch query
    const cardIdMap = new Map(); // performerId -> card
    for (const card of unprocessedCards) {
      const performerId = getPerformerIdFromCard(card);
      if (performerId) {
        cardIdMap.set(performerId, card);
      }
    }

    const performerIds = Array.from(cardIdMap.keys());
    if (performerIds.length === 0) {
      return;
    }

    try {
      // Fetch all ratings in a single batch query
      const ratings = await getMultiplePerformerRatingsForWidget(performerIds);
      
      // Inject widgets for each card in parallel
      const widgetPromises = Array.from(cardIdMap.entries()).map(([performerId, card]) => {
        const rating = ratings.get(performerId);
        return injectStarRatingWidget(card, rating);
      });
      await Promise.all(widgetPromises);
    } catch (err) {
      console.error("[HotOrNot] Error processing cards in batch:", err);
      // Fallback to individual processing (also parallelized)
      await Promise.all(unprocessedCards.map(card => injectStarRatingWidget(card)));
    }
  }

  /**
   * Check if we're on the performers list page
   * @returns {boolean} True if on performers list page
   */
  function isPerformersListPage() {
    const path = window.location.pathname;
    return path === "/performers" || path === "/performers/" || path.startsWith("/performers?");
  }

  // Debounce timeout for star rating processing
  let starRatingProcessingTimeout = null;

  /**
   * Initialize star rating widgets
   */
  async function initStarRatingWidgets() {
    if (!(await isStarRatingWidgetEnabled())) {
      console.log("[HotOrNot] Star rating widget disabled via settings");
      return;
    }
    console.log("[HotOrNot] Star rating widgets initialized");

    // Global event listener for rating updates (event delegation pattern)
    // This avoids memory leaks from per-widget listeners
    document.addEventListener("performer:rating:updated", (e) => {
      const { performerId, rating100 } = e.detail;
      // Find all rating widgets for this performer
      const widgets = document.querySelectorAll(`.hon-star-rating[data-performer-id="${performerId}"]`);
      widgets.forEach((container) => {
        container.dataset.currentRating = rating100 !== null ? rating100 : "";
        updateStarWidgetDisplay(container, rating100);
        // Update native Stash rating displays on the associated card
        const parentCard = findParentCardForWidget(container);
        updateNativeRatingDisplayOnCard(parentCard, rating100);
      });
    });

    // Initial processing if on performers list page
    if (isPerformersListPage()) {
      // Delay to allow Stash UI to render
      setTimeout(() => {
        processPerformerCardsForRating();
      }, 1000);
    }

    // Watch for DOM changes (SPA navigation, lazy loading, etc.)
    const ratingObserver = new MutationObserver(() => {
      if (!isPerformersListPage()) {
        return;
      }

      // Debounce processing
      clearTimeout(starRatingProcessingTimeout);
      starRatingProcessingTimeout = setTimeout(() => {
        processPerformerCardsForRating();
      }, 500);
    });

    ratingObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for Stash navigation events if PluginApi is available
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", () => {
        if (isPerformersListPage()) {
          // Delay to allow UI to render
          setTimeout(() => {
            processPerformerCardsForRating();
          }, 500);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init();
      initStarRatingWidgets();
    });
  } else {
    init();
    initStarRatingWidgets();
  }
})();