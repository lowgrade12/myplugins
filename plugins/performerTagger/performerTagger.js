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
   * @returns {Promise<Object>} Performer object with tags, hair_color, ethnicity, birthdate, height_cm, fake_tits
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
          career_length
          height_cm
          fake_tits
        }
      }
    `,
      { id: performerId }
    );
    if (!result.findPerformer) {
      return { tags: [], hair_color: null, ethnicity: null, birthdate: null, career_length: null, height_cm: null, fake_tits: null };
    }
    const performer = result.findPerformer;
    // Pre-populate tag ID cache
    performer.tags.forEach((t) => tagIdCache.set(t.name.toLowerCase(), t.id));
    return performer;
  }

  // Days per year used for age calculation
  const DAYS_PER_YEAR = 365.25;

  /**
   * Parse a Stash career_length string (e.g. "2010 - 2020", "2010 -", "2010-2020")
   * and return the numeric start and end years.
   * Only 4-digit sequences are considered; formats like "2010 - present" yield no end year.
   * @param {string} careerLength
   * @returns {{ startYear: number|null, endYear: number|null }}
   */
  function parseCareerYears(careerLength) {
    if (!careerLength) return { startYear: null, endYear: null };
    const years = String(careerLength).match(/\d{4}/g);
    if (!years || years.length === 0) return { startYear: null, endYear: null };
    const startYear = parseInt(years[0], 10);
    const endYear = years.length >= 2 ? parseInt(years[years.length - 1], 10) : null;
    return { startYear, endYear };
  }

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

    // Ethnicity — check "caucasian" before "asian" to avoid the false-positive
    // where "caucasian".includes("asian") === true.
    if (performer.ethnicity) {
      const eth = String(performer.ethnicity).toLowerCase();
      let tagName = null;
      if (eth.includes("caucasian") || eth.includes("white")) tagName = "Caucasian";
      else if (eth.includes("asian")) tagName = "Asian";
      else if (eth.includes("latina") || eth.includes("hispanic")) tagName = "Latina";
      else if (eth.includes("black") || eth.includes("african") || eth.includes("ebony")) tagName = "Ebony";
      else if (eth.includes("mixed") || eth.includes("biracial")) tagName = "Mixed";
      if (tagName) derived.push({ tagName, categoryName: "Ethnicity" });
    }

    // Age Range from birthdate
    // For retired performers (career_length has both a start and end year) the age is
    // assessed at the midpoint of their career rather than today, so a performer who
    // worked in their 20s/30s is not mis-tagged as MILF/Mature based on current age.
    // Active performers (end year missing) and performers with no career_length still
    // use the current date as the reference.
    // If the midpoint calculation produces an age below 18 (e.g. due to a performer
    // whose career_length data pre-dates their legal adult content), we fall back to
    // the current date so the performer still receives an age tag.
    if (performer.birthdate) {
      const birth = new Date(performer.birthdate);
      if (!isNaN(birth.getTime())) {
        let referenceDate = new Date();
        if (performer.career_length) {
          const { startYear, endYear } = parseCareerYears(performer.career_length);
          if (startYear && endYear && endYear > startYear) {
            // Retired performer: assess age at the midpoint of their career
            const midYear = Math.round((startYear + endYear) / 2);
            const midDate = new Date(Date.UTC(midYear, 6, 1)); // UTC July 1st avoids local-timezone skew; July is the year's midpoint
            const midAgeMs = midDate.getTime() - birth.getTime();
            const midAge = Math.floor(midAgeMs / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR));
            // Only use the midpoint if it yields a valid adult age; otherwise fall through
            // to the current-date calculation below so we never skip the age tag entirely.
            if (midAge >= 18) {
              referenceDate = midDate;
            }
          }
        }
        const ageMs = referenceDate.getTime() - birth.getTime();
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

    // Body Type from height — suggest Petite for shorter performers.
    // Only applied when the Body Type category has no existing tags.
    // Threshold: <= 160 cm (approx 5'3").
    if (performer.height_cm && performer.height_cm > 0) {
      if (performer.height_cm <= 160) {
        derived.push({ tagName: "Petite", categoryName: "Body Type" });
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
   * @returns {Promise<{savedTagIds: Set<string>, suggestedTagIds: Set<string>}>}
   *   savedTagIds: IDs actually persisted to Stash (use for pill active state)
   *   suggestedTagIds: IDs that would have been applied (for UI hints even on failure)
   */
  async function autoApplyDerivedTags(performerId, performer, currentTagIds) {
    const derived = deriveTagsFromPerformerData(performer);
    if (derived.length === 0) {
      return { savedTagIds: currentTagIds, suggestedTagIds: currentTagIds };
    }

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
    if (toApply.length === 0) {
      return { savedTagIds: currentTagIds, suggestedTagIds: currentTagIds };
    }

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
      try {
        await updatePerformerTagIds(performerId, Array.from(newTagIds));
        console.log(
          `[PerformerTagger] Auto-applied ${newTagIds.size - currentTagIds.size} tag(s) to performer ${performerId}`
        );
        return { savedTagIds: newTagIds, suggestedTagIds: newTagIds };
      } catch (err) {
        console.error("[PerformerTagger] Auto-apply mutation failed:", err);
        // Return current (unchanged) as saved, but pass newTagIds as suggestions
        // so the panel can still visually indicate what was attempted.
        return { savedTagIds: currentTagIds, suggestedTagIds: newTagIds };
      }
    }

    return { savedTagIds: newTagIds, suggestedTagIds: newTagIds };
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
  // BATCH TAG TASK
  // ============================================

  const BATCH_PAGE_SIZE = 100;

  /**
   * Fetch one page of performers with the fields needed for auto-tagging.
   * @param {number} page - 1-based page number
   * @returns {Promise<{count: number, performers: Array}>}
   */
  async function fetchPerformerPage(page) {
    const result = await graphqlQuery(
      `
      query FindPerformersBatch($filter: FindFilterType) {
        findPerformers(filter: $filter) {
          count
          performers {
            id
            name
            hair_color
            ethnicity
            birthdate
            career_length
            height_cm
            fake_tits
            tags { id name }
          }
        }
      }
    `,
      { filter: { page, per_page: BATCH_PAGE_SIZE, sort: "id", direction: "ASC" } }
    );
    return result.findPerformers;
  }

  /**
   * Run the batch tag task over all performers.
   * For each performer, auto-applies tags derived from their Stash data fields,
   * skipping any category that already has at least one tag set.
   * @param {function} onProgress - Called with progress state after each performer
   * @param {AbortSignal} signal - Abort signal for user cancellation
   * @returns {Promise<{processed: number, total: number, tagged: number, skipped: number, errors: number}>}
   */
  async function batchTagPerformers(onProgress, signal) {
    let processed = 0;
    let tagged = 0;
    let skipped = 0;
    let errors = 0;

    const processPerformers = async (performers, total) => {
      for (const performer of performers) {
        if (signal.aborted) return;
        try {
          // Pre-populate tag ID cache so autoApplyDerivedTags can detect existing categories
          performer.tags.forEach((t) => tagIdCache.set(t.name.toLowerCase(), t.id));
          const currentTagIds = new Set(performer.tags.map((t) => t.id));
          const { savedTagIds } = await autoApplyDerivedTags(performer.id, performer, currentTagIds);
          if (savedTagIds.size > currentTagIds.size) {
            tagged++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(`[PerformerTagger] Batch error for performer ${performer.id}:`, err);
          errors++;
        }
        processed++;
        onProgress({ processed, total, tagged, skipped, errors });
      }
    };

    // Fetch first page to get total count
    const first = await fetchPerformerPage(1);
    const total = first.count;
    const totalPages = Math.ceil(total / BATCH_PAGE_SIZE);
    onProgress({ processed, total, tagged, skipped, errors });

    await processPerformers(first.performers, total);

    for (let page = 2; page <= totalPages; page++) {
      if (signal.aborted) break;
      const data = await fetchPerformerPage(page);
      await processPerformers(data.performers, total);
    }

    return { processed, total, tagged, skipped, errors };
  }

  // ============================================
  // BATCH MODAL UI
  // ============================================

  let batchAbortController = null;

  /**
   * Build the batch task modal overlay element.
   * @returns {HTMLElement}
   */
  function buildBatchModal() {
    const overlay = document.createElement("div");
    overlay.id = "pt-batch-overlay";
    overlay.className = "pt-batch-overlay";

    const dialog = document.createElement("div");
    dialog.className = "pt-batch-dialog";

    const title = document.createElement("h3");
    title.className = "pt-batch-title";
    title.textContent = "Batch Tag Performers";
    dialog.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "pt-batch-desc";
    desc.textContent =
      "Scanning all performers and auto-applying tags based on their hair color, ethnicity, age and breast data. " +
      "Only applies tags in categories that have no existing tags set on the performer.";
    dialog.appendChild(desc);

    const progressWrap = document.createElement("div");
    progressWrap.className = "pt-batch-progress-wrap";
    const progressBar = document.createElement("div");
    progressBar.className = "pt-batch-progress-bar";
    progressBar.id = "pt-batch-bar";
    progressWrap.appendChild(progressBar);
    dialog.appendChild(progressWrap);

    const status = document.createElement("div");
    status.className = "pt-batch-status";
    status.id = "pt-batch-status";
    status.textContent = "Starting…";
    dialog.appendChild(status);

    const stats = document.createElement("div");
    stats.className = "pt-batch-stats";
    stats.id = "pt-batch-stats";
    dialog.appendChild(stats);

    const btnRow = document.createElement("div");
    btnRow.className = "pt-batch-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pt-batch-btn pt-batch-cancel";
    cancelBtn.id = "pt-batch-cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      if (batchAbortController) {
        batchAbortController.abort();
      }
      overlay.remove();
      batchAbortController = null;
    });

    btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    return overlay;
  }

  /**
   * Update progress display inside the batch modal.
   * @param {HTMLElement} overlay
   * @param {{processed: number, total: number, tagged: number, skipped: number, errors: number}} progress
   */
  function updateBatchModal(overlay, { processed, total, tagged, skipped, errors }) {
    const bar = overlay.querySelector("#pt-batch-bar");
    const statusEl = overlay.querySelector("#pt-batch-status");
    const statsEl = overlay.querySelector("#pt-batch-stats");
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (statusEl) {
      statusEl.textContent =
        total > 0
          ? `Processing ${processed} / ${total} performers (${pct}%)`
          : "Counting performers…";
    }
    if (statsEl) {
      statsEl.textContent =
        `Tagged: ${tagged}  ·  Skipped: ${skipped}` +
        (errors > 0 ? `  ·  Errors: ${errors}` : "");
    }
  }

  /**
   * Finalise the batch modal after completion or cancellation.
   * @param {HTMLElement} overlay
   * @param {{processed: number, total: number, tagged: number, skipped: number, errors: number}} result
   * @param {boolean} cancelled
   */
  function finaliseBatchModal(overlay, result, cancelled) {
    const statusEl = overlay.querySelector("#pt-batch-status");
    const cancelBtn = overlay.querySelector("#pt-batch-cancel-btn");

    if (statusEl) {
      statusEl.textContent = cancelled
        ? `Cancelled after ${result.processed} of ${result.total} performers.`
        : `Done! Processed all ${result.processed} performers.`;
    }

    if (cancelBtn) {
      // Clone node (shallow — no children) to strip the old Cancel listener, then wire up Close
      const closeBtn = cancelBtn.cloneNode(false);
      closeBtn.textContent = "Close";
      closeBtn.className = "pt-batch-btn pt-batch-close";
      closeBtn.addEventListener("click", () => {
        overlay.remove();
        batchAbortController = null;
      });
      cancelBtn.replaceWith(closeBtn);
    }
  }

  /**
   * Start the batch tag operation and show the progress modal.
   * Debounces so only one run can be active at a time.
   */
  async function startBatchTag() {
    if (batchAbortController) return;

    batchAbortController = new AbortController();
    const { signal } = batchAbortController;

    const overlay = buildBatchModal();
    document.body.appendChild(overlay);

    let lastResult = { processed: 0, total: 0, tagged: 0, skipped: 0, errors: 0 };
    let cancelled = false;

    try {
      const result = await batchTagPerformers((progress) => {
        if (signal.aborted) return;
        lastResult = progress;
        updateBatchModal(overlay, progress);
      }, signal);
      lastResult = result;
      cancelled = signal.aborted;
    } catch (err) {
      console.error("[PerformerTagger] Batch task error:", err);
      const statusEl = overlay.querySelector("#pt-batch-status");
      if (statusEl) statusEl.textContent = "Error: " + (err.message || "Unknown error");
      cancelled = true;
    }

    batchAbortController = null;
    finaliseBatchModal(overlay, lastResult, cancelled);
  }

  // ============================================
  // BATCH BUTTON — PERFORMERS LIST PAGE
  // ============================================

  let batchButtonTimeout = null;

  /**
   * Check if the current page is the performers list.
   * @returns {boolean}
   */
  function isOnPerformerListPage() {
    return /^\/performers\/?$/.test(window.location.pathname);
  }

  /**
   * Find a suitable DOM anchor to attach the Batch Tag button.
   * Tries several selectors used across different Stash versions/themes.
   * @returns {HTMLElement|null}
   */
  function findBatchButtonTarget() {
    return (
      document.querySelector(".performers-page .operations-list") ||
      document.querySelector(".performers-page .filter-options .btn-toolbar") ||
      document.querySelector(".performers-page .grid-header") ||
      document.querySelector(".performers-page header") ||
      document.querySelector(".performers-page") ||
      document.querySelector("main") ||
      document.querySelector("#root") ||
      null
    );
  }

  /**
   * Inject the "Batch Tag" button into the performers list page toolbar.
   * Skips silently if the button already exists or no suitable target is found.
   */
  function injectBatchButton() {
    if (!isOnPerformerListPage()) return;
    if (document.getElementById("pt-batch-trigger")) return;

    const target = findBatchButtonTarget();
    if (!target) return;

    const btn = document.createElement("button");
    btn.id = "pt-batch-trigger";
    btn.className = "pt-batch-trigger";
    btn.textContent = "⚡ Batch Tag";
    btn.title = "Auto-apply attribute tags to all performers based on their Stash data fields";
    btn.addEventListener("click", () => startBatchTag());
    target.appendChild(btn);
    console.log("[PerformerTagger] Batch Tag button injected");
  }

  /** Number of times the batch button injection has been retried on the current page. */
  let batchButtonRetries = 0;
  // Up to 8 retries at 500 ms, 1000 ms, … capped at 3000 ms — total ceiling ~16 s.
  // This covers slow React renders without retrying indefinitely.
  const BATCH_BUTTON_MAX_RETRIES = 8;

  /**
   * Try to inject the batch button, retrying at increasing intervals if the target
   * DOM element is not yet present (React can be slow to render the page structure).
   */
  function injectBatchButtonWithRetry() {
    batchButtonRetries = 0;

    function attempt() {
      if (!isOnPerformerListPage()) return;
      if (document.getElementById("pt-batch-trigger")) return;

      injectBatchButton();

      // If the button still isn't there, schedule a retry
      if (!document.getElementById("pt-batch-trigger") && batchButtonRetries < BATCH_BUTTON_MAX_RETRIES) {
        batchButtonRetries++;
        const delay = Math.min(500 * batchButtonRetries, 3000);
        clearTimeout(batchButtonTimeout);
        batchButtonTimeout = setTimeout(attempt, delay);
      }
    }

    attempt();
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
  // TOAST NOTIFICATION
  // ============================================

  /**
   * Show a brief toast notification inside the plugin panel.
   * @param {HTMLElement} panel - The panel element to attach the toast to
   * @param {string} message - Message text
   * @param {"success"|"error"} type - Visual style
   */
  function showToast(panel, message, type) {
    const existing = panel.querySelector(".pt-toast");
    if (existing) {
      existing.remove();
    }
    const toast = document.createElement("div");
    toast.className = `pt-toast pt-toast-${type}`;
    toast.textContent = message;
    panel.appendChild(toast);
    // Trigger animation by forcing a reflow before adding the visible class
    void toast.offsetWidth;
    toast.classList.add("pt-toast-visible");
    setTimeout(() => {
      toast.classList.remove("pt-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // PANEL UI
  // ============================================

  /**
   * Collect all currently active pill tag IDs from the panel.
   * @param {HTMLElement} panel - The panel element
   * @returns {string[]} Array of tag IDs that are currently active
   */
  function getActivePillTagIds(panel) {
    const ids = [];
    panel.querySelectorAll(".pt-pill.pt-pill-active").forEach((pill) => {
      const cachedId = tagIdCache.get(pill.dataset.tagName.toLowerCase());
      if (cachedId) {
        ids.push(cachedId);
      }
    });
    return ids;
  }

  /**
   * Handle the Save button click: persist all currently active pills to the performer.
   * @param {HTMLElement} saveBtn - The save button element
   * @param {HTMLElement} panel - The panel element
   * @param {string} performerId - Performer ID
   */
  async function handleSaveClick(saveBtn, panel, performerId) {
    if (saveBtn.disabled) {
      return;
    }
    saveBtn.disabled = true;
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving…";

    try {
      // Collect IDs for all currently active pills
      const activePillIds = getActivePillTagIds(panel);

      // Fetch the performer's current tags fresh to avoid clobbering unrelated tags
      const currentTags = await getPerformerTags(performerId);
      const currentSet = new Set(currentTags.map((t) => t.id));

      // Build a merged set: existing tags that are NOT in our pill groups, plus the active pills
      const ourPillTagNames = new Set(
        DEFAULT_TAG_GROUPS.flatMap((g) => g.tags.map((t) => t.toLowerCase()))
      );
      // Build a reverse lookup (id -> name) once from the cache
      const idToName = new Map([...tagIdCache.entries()].map(([name, id]) => [id, name]));
      // Remove previously quick-tagged entries for categories managed by this panel,
      // then add only the ones the user has selected right now.
      const mergedIds = new Set();
      currentSet.forEach((id) => {
        // Keep tags that are not managed by this panel
        const name = idToName.get(id);
        if (!name || !ourPillTagNames.has(name)) {
          mergedIds.add(id);
        }
      });
      activePillIds.forEach((id) => mergedIds.add(id));

      await updatePerformerTagIds(performerId, Array.from(mergedIds));

      saveBtn.textContent = "✓ Saved";
      showToast(panel, `Saved ${activePillIds.length} tag(s) to performer.`, "success");
      console.log(`[PerformerTagger] Saved ${activePillIds.length} tag(s) to performer ${performerId}`);
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error("[PerformerTagger] Save failed:", err);
      saveBtn.textContent = "✗ Error";
      showToast(panel, "Save failed — check the console for details.", "error");
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Handle the Auto Tag button click: re-run auto-tagging from performer data.
   * @param {HTMLElement} btn - The auto-tag button element
   * @param {HTMLElement} panel - The panel element
   * @param {string} performerId - Performer ID
   */
  async function handleAutoTagClick(btn, panel, performerId) {
    if (btn.disabled) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Running…";

    try {
      const performer = await getPerformerFull(performerId);
      const currentTagIds = new Set(performer.tags.map((t) => t.id));
      const { savedTagIds, suggestedTagIds } = await autoApplyDerivedTags(
        performerId,
        performer,
        currentTagIds
      );

      const activeIds = savedTagIds.size >= suggestedTagIds.size
        ? savedTagIds  // save succeeded — use what was actually persisted
        : suggestedTagIds; // save failed — still reflect what was attempted in UI
      syncPillStates(panel, activeIds);

      const added = savedTagIds.size - currentTagIds.size;
      if (added > 0) {
        showToast(panel, `Auto-applied ${added} tag(s) from performer data.`, "success");
      } else if (suggestedTagIds.size > savedTagIds.size) {
        syncPillStates(panel, suggestedTagIds);
        showToast(panel, "Auto-save failed — click Save to apply the highlighted tags.", "error");
      } else {
        showToast(panel, "No new tags to apply — all categories already tagged.", "success");
      }

      btn.textContent = "✓ Done";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error("[PerformerTagger] Auto Tag failed:", err);
      btn.textContent = "✗ Error";
      showToast(panel, "Auto Tag failed — check the console for details.", "error");
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    }
  }

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

    const headerRight = document.createElement("div");
    headerRight.className = "pt-header-right";

    const saveBtn = document.createElement("button");
    saveBtn.className = "pt-save-btn";
    saveBtn.setAttribute("aria-label", "Save quick-tag selections to performer");
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSaveClick(saveBtn, panel, performerId);
    });

    const autoTagBtn = document.createElement("button");
    autoTagBtn.className = "pt-autotag-btn";
    autoTagBtn.setAttribute("aria-label", "Auto-apply tags from performer data fields");
    autoTagBtn.textContent = "⚡ Auto Tag";
    autoTagBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAutoTagClick(autoTagBtn, panel, performerId);
    });

    const toggle = document.createElement("button");
    toggle.className = "pt-toggle";
    toggle.setAttribute("aria-label", "Toggle quick-tag panel");
    toggle.textContent = startCollapsed ? "▸" : "▾";
    // Prevent toggle button clicks from bubbling to the header handler (avoid double-toggle)
    toggle.addEventListener("click", (e) => e.stopPropagation());

    headerRight.appendChild(autoTagBtn);
    headerRight.appendChild(saveBtn);
    headerRight.appendChild(toggle);
    header.appendChild(title);
    header.appendChild(headerRight);
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

    // Clicking the header (anywhere except the buttons) expands/collapses the panel.
    // The save/autoTag/toggle buttons already call e.stopPropagation() so they
    // will not bubble up to this handler.
    header.addEventListener("click", () => {
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
      const { savedTagIds, suggestedTagIds } = await autoApplyDerivedTags(
        performerId,
        performer,
        activeTagIds
      );
      if (navVersion !== navigationVersion) return;

      // Use saved IDs for pill active state; suggestedTagIds may differ only on save failure.
      activeTagIds = savedTagIds;
      const autoSaveFailed = suggestedTagIds.size > savedTagIds.size;

      const collapsed = await shouldStartCollapsed();
      if (navVersion !== navigationVersion) return;

      const panel = buildPanel(performerId, activeTagIds, collapsed);
      panel.dataset.performerId = performerId;

      // Sync active pill states now that the tag cache has fresh data
      syncPillStates(panel, activeTagIds);

      const target = findInjectionTarget();
      target.appendChild(panel);

      // If auto-save failed, mark the suggested pills as active anyway (visual hint)
      // and show a toast so the user knows to use the Save button.
      const originalTagCount = performer.tags.length;
      if (autoSaveFailed) {
        syncPillStates(panel, suggestedTagIds);
        showToast(
          panel,
          "Auto-save failed — click Save to apply the highlighted tags.",
          "error"
        );
      } else if (suggestedTagIds.size > originalTagCount) {
        // Auto-save ran and added new tags — let the user know.
        const added = suggestedTagIds.size - originalTagCount;
        showToast(panel, `Auto-applied ${added} tag(s) from performer data.`, "success");
      }

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

    // Inject batch button if we start on the performers list
    if (isOnPerformerListPage()) {
      setTimeout(() => injectBatchButtonWithRetry(), 800);
    }

    // MutationObserver — handles React re-renders that swap out DOM nodes
    const observer = new MutationObserver(() => {
      if (isOnSinglePerformerPage()) {
        // Debounce to avoid hammering on rapid DOM changes
        clearTimeout(processingTimeout);
        processingTimeout = setTimeout(() => {
          const existing = document.getElementById("pt-panel");
          if (!existing) {
            injectPanel();
          }
        }, 600);
      } else if (isOnPerformerListPage()) {
        clearTimeout(batchButtonTimeout);
        batchButtonTimeout = setTimeout(() => injectBatchButtonWithRetry(), 600);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Stash SPA navigation events (preferred over MutationObserver for navigation)
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", (e) => {
        navigationVersion++;
        clearTimeout(processingTimeout);
        clearTimeout(batchButtonTimeout);
        injectionInProgress = false; // Reset flag on navigation
        batchButtonRetries = 0; // Reset retry counter on navigation
        pluginConfigCache = null; // Refresh settings on each navigation

        console.log("[PerformerTagger] Page changed:", e.detail.data.location.pathname);

        // Remove any existing panel immediately — it belongs to the old page
        const existing = document.getElementById("pt-panel");
        if (existing) {
          existing.remove();
        }

        // Abort any running batch task when navigating away
        if (batchAbortController) {
          batchAbortController.abort();
          batchAbortController = null;
        }
        const batchOverlay = document.getElementById("pt-batch-overlay");
        if (batchOverlay) {
          batchOverlay.remove();
        }

        if (isOnSinglePerformerPage()) {
          setTimeout(() => injectPanel(), 500);
        } else if (isOnPerformerListPage()) {
          setTimeout(() => injectBatchButtonWithRetry(), 800);
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
