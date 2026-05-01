(function () {
  "use strict";

  // Navigation version counter — incremented on every page change.
  // Async functions capture this before awaiting and abort if it changed.
  let navigationVersion = 0;

  // Flag to prevent concurrent panel injections on the same page.
  let injectionInProgress = false;

  // Track whether Apollo client has failed (skip after first failure to reduce noise)
  let apolloFailed = false;

  // In-memory caches (cleared on page reload but persist across SPA navigation).
  // Maps tag name (lowercase) -> tag ID
  const tagIdCache = new Map();
  // Maps category name (lowercase) -> parent tag ID
  const categoryIdCache = new Map();

  // ============================================
  // DEFAULT TAG GROUPS
  // ============================================

  // Each group has a category name (used as parent tag) and a list of tag names.
  // Users can customise their Stash tag hierarchy freely — this list only
  // governs which buttons appear in the quick-tag panel.
  const DEFAULT_TAG_GROUPS = [
    {
      category: "Hair Color",
      tags: ["Blonde", "Brunette", "Black Hair", "Red Hair", "Auburn", "Gray Hair"],
    },
    {
      category: "Body Type",
      tags: ["Petite", "Slim", "Athletic", "Curvy", "BBW", "Busty"],
    },
    {
      category: "Bust Size",
      tags: ["Small Bust", "Medium Bust", "Large Bust", "Natural Tits", "Enhanced"],
    },
    {
      category: "Ethnicity",
      tags: ["Asian", "Latina", "Ebony", "Caucasian", "Mixed"],
    },
    {
      category: "Age Range",
      tags: ["Teen (18+)", "20s", "30s", "MILF", "Mature"],
    },
  ];

  // ============================================
  // GRAPHQL HELPERS
  // ============================================

  /**
   * Get the GraphQL endpoint URL, respecting the base tag for subpath deployments.
   * @returns {string} The GraphQL endpoint URL
   */
  function getGraphQLUrl() {
    const baseEl = document.querySelector("base");
    let baseURL = baseEl ? baseEl.getAttribute("href") : "/";
    if (!baseURL.endsWith("/")) {
      baseURL += "/";
    }
    return `${baseURL}graphql`;
  }

  /**
   * Execute a GraphQL query or mutation.
   * Prefers Stash's Apollo client when available, falls back to direct fetch.
   * @param {string} query - GraphQL query/mutation string
   * @param {Object} variables - Query variables
   * @returns {Promise<Object>} Response data
   */
  async function graphqlQuery(query, variables = {}) {
    if (
      !apolloFailed &&
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
        if (!client || !gql) {
          throw new Error("Apollo client or gql not available");
        }
        const doc = gql(query);
        const isMutation = doc.definitions.some(
          (def) => def.kind === "OperationDefinition" && def.operation === "mutation"
        );
        const result = isMutation
          ? await client.mutate({ mutation: doc, variables })
          : await client.query({ query: doc, variables, fetchPolicy: "no-cache" });
        return result.data;
      } catch (apolloError) {
        apolloFailed = true;
        console.warn(
          "[PerformerTagger] Apollo client unavailable, using direct fetch:",
          apolloError?.message || apolloError
        );
      }
    }
    // Fallback: direct fetch
    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`[PerformerTagger] GraphQL request failed: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      console.error("[PerformerTagger] GraphQL error:", result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  // ============================================
  // PLUGIN CONFIG
  // ============================================

  let pluginConfigCache = null;

  /**
   * Fetch and cache the PerformerTagger plugin configuration from Stash settings.
   * @returns {Promise<Object>} Plugin config object
   */
  async function getPluginConfig() {
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
      const plugins = result.configuration.plugins || {};
      pluginConfigCache = plugins["performerTagger"] || {};
    } catch (e) {
      console.error("[PerformerTagger] Failed to fetch plugin config:", e);
      pluginConfigCache = {};
    }
    return pluginConfigCache;
  }

  /**
   * Check if the plugin panel is enabled in Stash settings.
   * @returns {Promise<boolean>}
   */
  async function isPanelEnabled() {
    const config = await getPluginConfig();
    return config.enabled !== false;
  }

  /**
   * Check if the panel should start collapsed.
   * @returns {Promise<boolean>}
   */
  async function shouldStartCollapsed() {
    const config = await getPluginConfig();
    return config.collapsed === true;
  }

  // ============================================
  // TAG MANAGEMENT
  // ============================================

  /**
   * Find a tag by exact name. Returns the tag ID or null if not found.
   * Results are cached to avoid repeated GraphQL calls.
   * @param {string} name - Tag name to search for
   * @returns {Promise<string|null>} Tag ID or null
   */
  async function findTagByName(name) {
    const cacheKey = name.toLowerCase();
    if (tagIdCache.has(cacheKey)) {
      return tagIdCache.get(cacheKey);
    }
    try {
      const result = await graphqlQuery(
        `
        query FindTagByName($name: String!) {
          findTags(
            tag_filter: { name: { value: $name, modifier: EQUALS } }
            filter: { per_page: 1 }
          ) {
            tags { id name }
          }
        }
      `,
        { name }
      );
      const tags = result.findTags ? result.findTags.tags : [];
      const tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase()) || null;
      const id = tag ? tag.id : null;
      tagIdCache.set(cacheKey, id);
      return id;
    } catch (e) {
      console.error(`[PerformerTagger] Error finding tag "${name}":`, e);
      return null;
    }
  }

  /**
   * Create a new tag with the given name and optional parent tag.
   * @param {string} name - Tag name
   * @param {string|null} parentId - Parent tag ID (for hierarchy)
   * @returns {Promise<string|null>} Newly created tag ID or null on failure
   */
  async function createTag(name, parentId = null) {
    try {
      const input = { name };
      if (parentId) {
        input.parent_ids = [parentId];
      }
      const result = await graphqlQuery(
        `
        mutation TagCreate($input: TagCreateInput!) {
          tagCreate(input: $input) {
            id
            name
          }
        }
      `,
        { input }
      );
      const id = result.tagCreate ? result.tagCreate.id : null;
      if (id) {
        tagIdCache.set(name.toLowerCase(), id);
        console.log(`[PerformerTagger] Created tag "${name}" (id: ${id})`);
      }
      return id;
    } catch (e) {
      console.error(`[PerformerTagger] Error creating tag "${name}":`, e);
      return null;
    }
  }

  /**
   * Find a tag by name, creating it if it doesn't exist.
   * @param {string} name - Tag name
   * @param {string|null} parentId - Parent tag ID for auto-created tags
   * @returns {Promise<string|null>} Tag ID or null
   */
  async function getOrCreateTag(name, parentId = null) {
    const existingId = await findTagByName(name);
    if (existingId) {
      return existingId;
    }
    return await createTag(name, parentId);
  }

  /**
   * Find or create a category (parent) tag.
   * Category tags serve as organisational parents in Stash's tag hierarchy.
   * @param {string} categoryName - Category display name
   * @returns {Promise<string|null>} Category tag ID or null
   */
  async function getOrCreateCategoryTag(categoryName) {
    const cacheKey = categoryName.toLowerCase();
    if (categoryIdCache.has(cacheKey)) {
      return categoryIdCache.get(cacheKey);
    }
    const id = await getOrCreateTag(categoryName, null);
    if (id) {
      categoryIdCache.set(cacheKey, id);
    }
    return id;
  }

  // ============================================
  // PERFORMER TAG OPERATIONS
  // ============================================

  /**
   * Fetch the current tags (id + name) for a performer.
   * Also pre-populates the tag ID cache with the returned tag names.
   * @param {string} performerId - Performer ID
   * @returns {Promise<{id: string, name: string}[]>} Array of tag objects
   */
  async function getPerformerTags(performerId) {
    const result = await graphqlQuery(
      `
      query FindPerformerTags($id: ID!) {
        findPerformer(id: $id) {
          id
          tags { id name }
        }
      }
    `,
      { id: performerId }
    );
    if (!result.findPerformer) {
      return [];
    }
    const tags = result.findPerformer.tags;
    // Pre-populate cache so pill states can be resolved without extra round-trips
    tags.forEach((t) => tagIdCache.set(t.name.toLowerCase(), t.id));
    return tags;
  }

  /**
   * Fetch performer tags AND raw data fields in a single query.
   * Used during panel injection to support auto-tagging from known performer attributes.
   * @param {string} performerId - Performer ID
   * @returns {Promise<Object>} Performer object with tags, hair_color, ethnicity, birthdate, fake_tits
   */
  async function getPerformerFull(performerId) {
    const result = await graphqlQuery(
      `
      query FindPerformerFull($id: ID!) {
        findPerformer(id: $id) {
          id
          tags { id name }
          hair_color
          ethnicity
          birthdate
          fake_tits
        }
      }
    `,
      { id: performerId }
    );
    if (!result.findPerformer) {
      return { tags: [], hair_color: null, ethnicity: null, birthdate: null, fake_tits: null };
    }
    const performer = result.findPerformer;
    // Pre-populate tag ID cache
    performer.tags.forEach((t) => tagIdCache.set(t.name.toLowerCase(), t.id));
    return performer;
  }

  // Days per year used for age calculation
  const DAYS_PER_YEAR = 365.25;

  /**
   * Derive tag suggestions from a performer's raw Stash data fields.
   * Maps hair_color, ethnicity, birthdate and fake_tits to matching tag names in DEFAULT_TAG_GROUPS.
   * @param {Object} performer - Performer data object from getPerformerFull
   * @returns {Array<{tagName: string, categoryName: string}>}
   */
  function deriveTagsFromPerformerData(performer) {
    const derived = [];

    // Hair Color
    if (performer.hair_color) {
      const hc = String(performer.hair_color).toLowerCase();
      let tagName = null;
      if (hc.includes("auburn")) tagName = "Auburn";
      else if (hc.includes("blonde") || hc.includes("blond")) tagName = "Blonde";
      else if (hc.includes("brunette") || hc.includes("brown")) tagName = "Brunette";
      else if (hc.includes("black")) tagName = "Black Hair";
      else if (hc.includes("red")) tagName = "Red Hair";
      else if (hc.includes("gray") || hc.includes("grey") || hc.includes("silver")) tagName = "Gray Hair";
      if (tagName) derived.push({ tagName, categoryName: "Hair Color" });
    }

    // Ethnicity
    if (performer.ethnicity) {
      const eth = String(performer.ethnicity).toLowerCase();
      let tagName = null;
      if (eth.includes("asian")) tagName = "Asian";
      else if (eth.includes("latina") || eth.includes("hispanic")) tagName = "Latina";
      else if (eth.includes("black") || eth.includes("african") || eth.includes("ebony")) tagName = "Ebony";
      else if (eth.includes("caucasian") || eth.includes("white")) tagName = "Caucasian";
      else if (eth.includes("mixed") || eth.includes("biracial")) tagName = "Mixed";
      if (tagName) derived.push({ tagName, categoryName: "Ethnicity" });
    }

    // Age Range from birthdate
    if (performer.birthdate) {
      const birth = new Date(performer.birthdate);
      if (!isNaN(birth.getTime())) {
        const ageMs = Date.now() - birth.getTime();
        const age = Math.floor(ageMs / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR));
        let tagName = null;
        if (age >= 18 && age < 20) tagName = "Teen (18+)";
        else if (age >= 20 && age < 30) tagName = "20s";
        else if (age >= 30 && age < 40) tagName = "30s";
        else if (age >= 40 && age < 50) tagName = "MILF";
        else if (age >= 50) tagName = "Mature";
        if (tagName) derived.push({ tagName, categoryName: "Age Range" });
      }
    }

    // Bust type from fake_tits field (Stash stores cup size string or empty for natural)
    if (performer.fake_tits !== null && performer.fake_tits !== undefined) {
      const ft = String(performer.fake_tits).toLowerCase().trim();
      if (ft === "" || ft === "no" || ft === "false" || ft === "natural") {
        derived.push({ tagName: "Natural Tits", categoryName: "Bust Size" });
      } else if (ft !== "" && ft !== "unknown") {
        // Any non-empty, non-natural value indicates enhancement
        derived.push({ tagName: "Enhanced", categoryName: "Bust Size" });
      }
    }

    return derived;
  }

  /**
   * Auto-apply tags derived from a performer's known Stash data fields.
   * Only applies a derived tag in a category if that category has no tags already set.
   * This prevents overriding existing user-set tags.
   * @param {string} performerId - Performer ID
   * @param {Object} performer - Performer data from getPerformerFull
   * @param {Set<string>} currentTagIds - Current tag IDs on the performer
   * @returns {Promise<Set<string>>} Updated set of tag IDs (may be unchanged)
   */
  async function autoApplyDerivedTags(performerId, performer, currentTagIds) {
    const derived = deriveTagsFromPerformerData(performer);
    if (derived.length === 0) return currentTagIds;

    // Determine which tag group categories already have at least one tag applied
    const categoriesWithTags = new Set();
    for (const group of DEFAULT_TAG_GROUPS) {
      for (const tagName of group.tags) {
        const cachedId = tagIdCache.get(tagName.toLowerCase());
        if (cachedId && currentTagIds.has(cachedId)) {
          categoriesWithTags.add(group.category);
          break;
        }
      }
    }

    // Only auto-apply in categories that have no existing tags
    const toApply = derived.filter((d) => !categoriesWithTags.has(d.categoryName));
    if (toApply.length === 0) return currentTagIds;

    console.log(
      "[PerformerTagger] Auto-applying tags from performer data:",
      toApply.map((d) => `${d.categoryName}: ${d.tagName}`).join(", ")
    );

    const newTagIds = new Set(currentTagIds);

    for (const { tagName, categoryName } of toApply) {
      const categoryId = await getOrCreateCategoryTag(categoryName);
      const tagId = await getOrCreateTag(tagName, categoryId);
      if (tagId) {
        newTagIds.add(tagId);
        tagIdCache.set(tagName.toLowerCase(), tagId);
      }
    }

    if (newTagIds.size > currentTagIds.size) {
      await updatePerformerTagIds(performerId, Array.from(newTagIds));
    }

    return newTagIds;
  }

  /**
   * Update the full tag list on a performer.
   * NOTE: performerUpdate replaces the entire tag list; always pass the full merged set.
   * @param {string} performerId - Performer ID
   * @param {string[]} tagIds - Complete new list of tag IDs
   * @returns {Promise<void>}
   */
  async function updatePerformerTagIds(performerId, tagIds) {
    await graphqlQuery(
      `
      mutation UpdatePerformerTags($id: ID!, $tag_ids: [ID!]) {
        performerUpdate(input: { id: $id, tag_ids: $tag_ids }) {
          id
          tags { id name }
        }
      }
    `,
      { id: performerId, tag_ids: tagIds }
    );
  }

  // ============================================
  // URL HELPERS
  // ============================================

  /**
   * Extract performer ID from a single performer page URL.
   * @returns {string|null} Performer ID or null
   */
  function getPerformerIdFromUrl() {
    const match = window.location.pathname.match(/^\/performers\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  /**
   * Check if the current page is a single performer detail page.
   * @returns {boolean}
   */
  function isOnSinglePerformerPage() {
    return getPerformerIdFromUrl() !== null;
  }

  // ============================================
  // PANEL UI
  // ============================================

  /**
   * Build the quick-tag panel DOM element.
   * The panel contains one row per tag group with pill-style toggle buttons.
   *
   * @param {string} performerId - Performer ID
   * @param {Set<string>} activeTagIds - Set of tag IDs currently on the performer
   * @param {boolean} startCollapsed - Whether to render the panel collapsed
   * @returns {HTMLElement} Panel element
   */
  function buildPanel(performerId, activeTagIds, startCollapsed) {
    const panel = document.createElement("div");
    panel.id = "pt-panel";
    panel.className = "pt-panel";

    // --- Header ---
    const header = document.createElement("div");
    header.className = "pt-header";

    const title = document.createElement("span");
    title.className = "pt-title";
    title.textContent = "Quick Tags";

    const toggle = document.createElement("button");
    toggle.className = "pt-toggle";
    toggle.setAttribute("aria-label", "Toggle quick-tag panel");
    toggle.textContent = startCollapsed ? "▸" : "▾";

    header.appendChild(title);
    header.appendChild(toggle);
    panel.appendChild(header);

    // --- Body ---
    const body = document.createElement("div");
    body.className = "pt-body";
    if (startCollapsed) {
      body.classList.add("pt-body-collapsed");
    }

    DEFAULT_TAG_GROUPS.forEach((group) => {
      const row = document.createElement("div");
      row.className = "pt-group";

      const label = document.createElement("span");
      label.className = "pt-group-label";
      label.textContent = group.category;
      row.appendChild(label);

      const pills = document.createElement("div");
      pills.className = "pt-pills";

      group.tags.forEach((tagName) => {
        const pill = document.createElement("button");
        pill.className = "pt-pill";
        pill.textContent = tagName;
        // Store metadata needed when the user clicks
        pill.dataset.tagName = tagName;
        pill.dataset.categoryName = group.category;
        pill.dataset.performerId = performerId;

        // Resolve the cached tag ID if we already know it — mark as active
        const cachedId = tagIdCache.get(tagName.toLowerCase());
        if (cachedId && activeTagIds.has(cachedId)) {
          pill.classList.add("pt-pill-active");
        }

        pill.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePillClick(pill, performerId);
        });

        pills.appendChild(pill);
      });

      row.appendChild(pills);
      body.appendChild(row);
    });

    panel.appendChild(body);

    // Collapse/expand toggle handler
    toggle.addEventListener("click", () => {
      const isCollapsed = body.classList.toggle("pt-body-collapsed");
      toggle.textContent = isCollapsed ? "▸" : "▾";
    });

    return panel;
  }

  /**
   * Handle a tag pill click: toggle the tag on the performer.
   * Auto-creates the tag (and its category parent) if it doesn't exist yet.
   * @param {HTMLElement} pill - The clicked pill button
   * @param {string} performerId - Performer ID
   */
  async function handlePillClick(pill, performerId) {
    if (pill.disabled) {
      return;
    }
    pill.disabled = true;
    pill.classList.add("pt-pill-loading");

    const tagName = pill.dataset.tagName;
    const categoryName = pill.dataset.categoryName;

    try {
      // Resolve or create the tag, using the category as parent
      const categoryId = await getOrCreateCategoryTag(categoryName);
      const tagId = await getOrCreateTag(tagName, categoryId);
      if (!tagId) {
        console.error(`[PerformerTagger] Could not resolve tag "${tagName}"`);
        return;
      }

      // Fetch the current tag list fresh from the server to avoid race conditions
      const currentTags = await getPerformerTags(performerId);
      const currentSet = new Set(currentTags.map((t) => t.id));

      let newSet;
      if (currentSet.has(tagId)) {
        // Tag is already set — remove it
        newSet = new Set(currentSet);
        newSet.delete(tagId);
        pill.classList.remove("pt-pill-active");
        console.log(`[PerformerTagger] Removed tag "${tagName}" from performer ${performerId}`);
      } else {
        // Tag is not set — add it
        newSet = new Set(currentSet);
        newSet.add(tagId);
        pill.classList.add("pt-pill-active");
        console.log(`[PerformerTagger] Added tag "${tagName}" to performer ${performerId}`);
      }

      await updatePerformerTagIds(performerId, Array.from(newSet));

      // Brief success flash
      pill.classList.add("pt-pill-success");
      setTimeout(() => pill.classList.remove("pt-pill-success"), 600);
    } catch (err) {
      console.error(`[PerformerTagger] Error toggling tag "${tagName}":`, err);
      pill.classList.add("pt-pill-error");
      setTimeout(() => pill.classList.remove("pt-pill-error"), 1000);
    } finally {
      pill.classList.remove("pt-pill-loading");
      pill.disabled = false;
    }
  }

  /**
   * Synchronise pill active states to match the given set of active tag IDs.
   * Called after refreshing performer tag data to keep the UI consistent.
   * @param {HTMLElement} panel - The panel element
   * @param {Set<string>} activeTagIds - Current tag IDs on the performer
   */
  function syncPillStates(panel, activeTagIds) {
    const pills = panel.querySelectorAll(".pt-pill");
    pills.forEach((pill) => {
      const tagName = pill.dataset.tagName;
      const cachedId = tagIdCache.get(tagName.toLowerCase());
      if (cachedId) {
        if (activeTagIds.has(cachedId)) {
          pill.classList.add("pt-pill-active");
        } else {
          pill.classList.remove("pt-pill-active");
        }
      }
    });
  }

  // ============================================
  // INJECTION
  // ============================================

  /**
   * Find the best DOM anchor to insert the tagger panel.
   * Tries several selectors used by different Stash versions.
   * @returns {HTMLElement|null}
   */
  function findInjectionTarget() {
    // Stash renders performer details inside a main detail area.
    // We look for the detail wrapper and append inside it, or fall back to body.
    return (
      document.querySelector(".detail-container") ||
      document.querySelector(".performer-body") ||
      document.querySelector(".performer-details") ||
      document.querySelector(".detail-header") ||
      document.querySelector(".performer-head") ||
      document.querySelector("main") ||
      document.body
    );
  }

  /**
   * Inject (or refresh) the quick-tag panel on a performer detail page.
   * Safe to call multiple times — skips if already injected or injection is in progress.
   */
  async function injectPanel() {
    const navVersion = navigationVersion;

    if (!isOnSinglePerformerPage()) {
      return;
    }

    // Skip if disabled in settings
    if (!(await isPanelEnabled())) {
      return;
    }
    if (navVersion !== navigationVersion) return;

    // Prevent concurrent injections
    if (injectionInProgress) {
      return;
    }
    injectionInProgress = true;

    try {
      const performerId = getPerformerIdFromUrl();
      if (!performerId) {
        return;
      }

      // If the panel is already present and belongs to the same performer, skip
      const existing = document.getElementById("pt-panel");
      if (existing && existing.dataset.performerId === performerId) {
        return;
      }
      // Remove stale panel from a previous performer
      if (existing) {
        existing.remove();
      }

      // Fetch performer tags and raw data fields (also pre-populates tagIdCache with tag names)
      const performer = await getPerformerFull(performerId);
      if (navVersion !== navigationVersion) return;

      let activeTagIds = new Set(performer.tags.map((t) => t.id));

      // Auto-apply tags derived from the performer's known Stash fields
      activeTagIds = await autoApplyDerivedTags(performerId, performer, activeTagIds);
      if (navVersion !== navigationVersion) return;

      const collapsed = await shouldStartCollapsed();
      if (navVersion !== navigationVersion) return;

      const panel = buildPanel(performerId, activeTagIds, collapsed);
      panel.dataset.performerId = performerId;

      // Sync active pill states now that the tag cache has fresh data
      syncPillStates(panel, activeTagIds);

      const target = findInjectionTarget();
      target.appendChild(panel);

      console.log(`[PerformerTagger] Injected quick-tag panel for performer ${performerId}`);
    } catch (err) {
      console.error("[PerformerTagger] Error injecting panel:", err);
    } finally {
      injectionInProgress = false;
    }
  }

  // ============================================
  // INITIALISATION
  // ============================================

  let processingTimeout = null;

  /**
   * Initialise the plugin: set up observers and navigation listeners.
   */
  function init() {
    console.log("[PerformerTagger] Plugin initialised");

    // Inject immediately if we start on a performer detail page
    if (isOnSinglePerformerPage()) {
      setTimeout(() => injectPanel(), 500);
    }

    // MutationObserver — handles React re-renders that swap out DOM nodes
    const observer = new MutationObserver(() => {
      if (!isOnSinglePerformerPage()) {
        return;
      }
      // Debounce to avoid hammering on rapid DOM changes
      clearTimeout(processingTimeout);
      processingTimeout = setTimeout(() => {
        const existing = document.getElementById("pt-panel");
        if (!existing) {
          injectPanel();
        }
      }, 600);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Stash SPA navigation events (preferred over MutationObserver for navigation)
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", (e) => {
        navigationVersion++;
        clearTimeout(processingTimeout);
        injectionInProgress = false; // Reset flag on navigation
        pluginConfigCache = null; // Refresh settings on each navigation

        console.log("[PerformerTagger] Page changed:", e.detail.data.location.pathname);

        // Remove any existing panel immediately — it belongs to the old page
        const existing = document.getElementById("pt-panel");
        if (existing) {
          existing.remove();
        }

        if (isOnSinglePerformerPage()) {
          setTimeout(() => injectPanel(), 500);
        }
      });
    }
  }

  // Start plugin
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
