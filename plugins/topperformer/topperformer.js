(function () {
  "use strict";

  // ============================================
  // TOP PERFORMER PLUGIN
  // Displays the performer with the highest number of appearances for a studio
  // ============================================

  // Navigation version counter — incremented on every page change.
  // Async functions capture this before awaiting and abort if it changed.
  let navigationVersion = 0;

  // Cache for top performers to avoid repeated API calls
  // Map<studioId, { performerName: string, sceneCount: number, timestamp: number }>
  const topPerformerCache = new Map();

  // Cache TTL in milliseconds (30 minutes)
  const CACHE_TTL = 30 * 60 * 1000;

  // ============================================
  // GRAPHQL HELPERS
  // ============================================

  // Track whether Apollo client has failed (skip after first failure to reduce noise)
  let apolloFailed = false;

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

  async function graphqlQuery(query, variables = {}) {
    // Use Stash's Apollo client when available (preferred method for Stash plugins)
    // This ensures authentication is handled automatically and avoids Apollo context errors
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
        // Permanently switch to direct fetch after first Apollo failure to avoid
        // repeated errors (e.g., clearStore race, version mismatch, invariant violations)
        apolloFailed = true;
        console.warn("[TopPerformer] Apollo client unavailable, using direct fetch for all queries:", apolloError?.message || apolloError);
      }
    }
    // Fallback: direct fetch (for environments where PluginApi is not available)
    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`[TopPerformer] GraphQL request failed: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      console.error("[TopPerformer] GraphQL error:", result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  // Studios with at most this many scenes are counted exactly from their
  // scenes in one request. Bigger studios check the most prolific performers
  // that appear in the studio with exact per-performer counts instead of
  // downloading thousands of scenes (the old 1000-scene sample was also
  // biased, not random).
  const EXACT_SCENE_LIMIT = 500;
  const CANDIDATE_COUNT = 25;
  // Fetch at most this many studios at once so a studio list page doesn't
  // fire 40+ heavy queries simultaneously.
  const MAX_CONCURRENT_STUDIOS = 4;
  const SESSION_CACHE_KEY = "topperformer:v2";
  const SESSION_CACHE_TTL = 30 * 60 * 1000;

  function readSessionCache(studioId) {
    try {
      const all = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || "{}");
      const entry = all[studioId];
      if (entry && Date.now() - entry.timestamp < SESSION_CACHE_TTL) {
        return entry;
      }
    } catch (e) {
      // sessionStorage unavailable or corrupt - ignore
    }
    return null;
  }

  function writeSessionCache(studioId, value) {
    try {
      const all = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || "{}");
      all[studioId] = value;
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(all));
    } catch (e) {
      // ignore quota / availability errors
    }
  }

  /**
   * Count non-male performer appearances across all of a (small) studio's scenes.
   * @param {string} studioId
   * @returns {Promise<{name: string, count: number}|null>}
   */
  async function topPerformerFromScenes(studioId) {
    const query = `
      query TopPerformerScenes($scene_filter: SceneFilterType) {
        findScenes(scene_filter: $scene_filter, filter: { per_page: -1 }) {
          scenes {
            performers { id name gender }
          }
        }
      }
    `;
    const result = await graphqlQuery(query, {
      scene_filter: { studios: { value: [studioId], modifier: "INCLUDES" } }
    });
    const counts = new Map();
    for (const scene of result.findScenes.scenes || []) {
      for (const performer of scene.performers || []) {
        if (performer.gender === "MALE") continue;
        const entry = counts.get(performer.id) || { name: performer.name, count: 0 };
        entry.count++;
        counts.set(performer.id, entry);
      }
    }
    let top = null;
    for (const entry of counts.values()) {
      if (!top || entry.count > top.count) top = entry;
    }
    return top;
  }

  /**
   * For large studios: take the performers in the studio with the most scenes
   * overall, then count each one's scenes in this studio exactly (one request).
   * @param {string} studioId
   * @returns {Promise<{name: string, count: number}|null>}
   */
  async function topPerformerFromCandidates(studioId) {
    const candidateQuery = `
      query TopPerformerCandidates($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          performers { id name gender }
        }
      }
    `;
    const candidates = await graphqlQuery(candidateQuery, {
      performer_filter: { studios: { value: [studioId], modifier: "INCLUDES" } },
      filter: { per_page: CANDIDATE_COUNT, sort: "scenes_count", direction: "DESC" }
    });
    const performers = (candidates.findPerformers.performers || [])
      .filter((p) => p.gender !== "MALE" && /^\d+$/.test(String(p.id)));
    if (performers.length === 0) return null;

    // IDs are numeric (checked above), so they can be inlined safely.
    const studio = /^\d+$/.test(String(studioId)) ? studioId : null;
    if (!studio) return null;
    const aliases = performers.map((p, i) => `
      c${i}: findScenes(
        scene_filter: {
          studios: { value: ["${studio}"], modifier: INCLUDES }
          performers: { value: ["${p.id}"], modifier: INCLUDES }
        }
        filter: { per_page: 0 }
      ) { count }`).join("\n");
    const counts = await graphqlQuery(`query TopPerformerCounts { ${aliases} }`);

    let top = null;
    performers.forEach((p, i) => {
      const count = counts[`c${i}`] ? counts[`c${i}`].count : 0;
      if (!top || count > top.count) top = { name: p.name, count };
    });
    return top && top.count > 0 ? top : null;
  }

  /**
   * Get the top (non-male) performer for a studio by scene appearances.
   * @param {string} studioId - The studio's ID
   * @returns {Promise<{name: string, count: number}|null>} Top performer info or null
   */
  async function getTopPerformerForStudio(studioId) {
    // Check caches first (in-memory, then this browser session)
    const cached = topPerformerCache.get(studioId) || readSessionCache(studioId);
    if (cached && Date.now() - cached.timestamp < SESSION_CACHE_TTL) {
      return cached.performerName ? { name: cached.performerName, count: cached.sceneCount } : null;
    }

    try {
      const countResult = await graphqlQuery(`
        query StudioSceneCount($scene_filter: SceneFilterType) {
          findScenes(scene_filter: $scene_filter, filter: { per_page: 0 }) { count }
        }
      `, { scene_filter: { studios: { value: [studioId], modifier: "INCLUDES" } } });
      const sceneCount = countResult.findScenes.count || 0;

      const topPerformer = sceneCount === 0
        ? null
        : sceneCount <= EXACT_SCENE_LIMIT
          ? await topPerformerFromScenes(studioId)
          : await topPerformerFromCandidates(studioId);

      const entry = {
        performerName: topPerformer ? topPerformer.name : null,
        sceneCount: topPerformer ? topPerformer.count : 0,
        timestamp: Date.now()
      };
      topPerformerCache.set(studioId, entry);
      writeSessionCache(studioId, entry);
      return topPerformer;
    } catch (err) {
      console.error("[TopPerformer] Error fetching top performer for studio:", studioId, err);
      return null;
    }
  }

  /**
   * Get top performers for multiple studios in parallel
   * @param {string[]} studioIds - Array of studio IDs
   * @returns {Promise<Map<string, {name: string, count: number}>>} Map of studio ID to top performer info
   */
  async function getTopPerformersForStudios(studioIds) {
    const results = new Map();
    const uncachedIds = [];

    // Check cache first
    for (const studioId of studioIds) {
      const cached = topPerformerCache.get(studioId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        if (cached.performerName) {
          results.set(studioId, { name: cached.performerName, count: cached.sceneCount });
        }
      } else {
        uncachedIds.push(studioId);
      }
    }

    // Fetch uncached studios with a small worker pool
    let next = 0;
    async function worker() {
      while (next < uncachedIds.length) {
        const studioId = uncachedIds[next++];
        try {
          const topPerformer = await getTopPerformerForStudio(studioId);
          if (topPerformer) results.set(studioId, topPerformer);
        } catch (err) {
          console.warn("[TopPerformer] Failed to fetch top performer for studio:", studioId, err);
        }
      }
    }
    const workers = Math.min(MAX_CONCURRENT_STUDIOS, uncachedIds.length);
    await Promise.all(Array.from({ length: workers }, worker));

    return results;
  }

  // ============================================
  // STUDIO CARD DETECTION & INJECTION
  // ============================================

  /**
   * Extract studio ID from a studio card element
   * @param {HTMLElement} card - Studio card element
   * @returns {string|null} Studio ID or null
   */
  function getStudioIdFromCard(card) {
    // Try getting from card's link href (e.g., /studios/123)
    const link = card.querySelector("a[href*='/studios/']");
    if (link) {
      const href = link.getAttribute("href");
      const match = href.match(/\/studios\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    // Try data attributes
    if (card.dataset.studioId) {
      return card.dataset.studioId;
    }

    return null;
  }

  /**
   * Check if top performer widget already exists on card
   * @param {HTMLElement} card - Studio card element
   * @returns {boolean} True if widget exists
   */
  function hasTopPerformerWidget(card) {
    return card.querySelector(".tp-top-performer") !== null;
  }

  /**
   * Create the top performer display element
   * @param {string} performerName - Name of the top performer
   * @param {number} sceneCount - Number of scenes
   * @returns {HTMLElement} The top performer element
   */
  function createTopPerformerElement(performerName, sceneCount) {
    const container = document.createElement("div");
    container.className = "tp-top-performer";
    
    const icon = document.createElement("span");
    icon.className = "tp-icon";
    icon.innerHTML = "👑"; // Crown emoji for top performer
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "tp-name";
    nameSpan.textContent = performerName;
    
    const countSpan = document.createElement("span");
    countSpan.className = "tp-count";
    countSpan.textContent = `(${sceneCount} scenes)`;
    
    container.appendChild(icon);
    container.appendChild(nameSpan);
    container.appendChild(countSpan);
    
    return container;
  }

  /**
   * Inject top performer widget into studio card
   * @param {HTMLElement} card - Studio card element
   * @param {{name: string, count: number}|null} topPerformer - Pre-fetched top performer info
   */
  async function injectTopPerformerWidget(card, topPerformer = undefined) {
    if (hasTopPerformerWidget(card)) {
      return;
    }

    const studioId = getStudioIdFromCard(card);
    if (!studioId) {
      console.warn("[TopPerformer] Could not get studio ID from card");
      return;
    }

    try {
      // Fetch top performer if not provided
      if (topPerformer === undefined) {
        topPerformer = await getTopPerformerForStudio(studioId);
      }

      if (!topPerformer) {
        // No performers found for this studio
        card.dataset.tpProcessed = "true";
        return;
      }

      // Create and inject the widget
      const widget = createTopPerformerElement(topPerformer.name, topPerformer.count);

      // Find the best place to inject (in the card content area)
      const cardContent = card.querySelector(".studio-card-content") ||
                          card.querySelector(".card-section") ||
                          card.querySelector(".card-body") ||
                          card;

      // Try to insert at the end of the card content
      cardContent.appendChild(widget);

      // Mark card as processed
      card.dataset.tpProcessed = "true";
    } catch (err) {
      console.error("[TopPerformer] Error injecting widget:", err);
    }
  }

  /**
   * Process all studio cards on the page
   */
  async function processStudioCards() {
    // Capture navigation version to detect stale work after awaits
    const navVersion = navigationVersion;

    // Various selectors for studio cards in Stash UI
    const cardSelectors = [
      ".studio-card",
      "[class*='StudioCard']",
      ".card.studio",
      ".grid-item.studio"
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    // Alternative: look for cards that have studio links
    if (cards.length === 0) {
      const allCards = document.querySelectorAll(".card");
      cards = Array.from(allCards).filter(card => {
        const link = card.querySelector("a[href*='/studios/']");
        return link !== null;
      });
    }

    // Filter to only unprocessed cards
    const unprocessedCards = cards.filter(card => !card.dataset.tpProcessed);
    if (unprocessedCards.length === 0) {
      return;
    }

    // Collect studio IDs for batch query
    const cardIdMap = new Map(); // studioId -> card
    for (const card of unprocessedCards) {
      const studioId = getStudioIdFromCard(card);
      if (studioId) {
        cardIdMap.set(studioId, card);
      }
    }

    const studioIds = Array.from(cardIdMap.keys());
    if (studioIds.length === 0) {
      return;
    }

    try {
      // Fetch top performers for all studios
      const topPerformers = await getTopPerformersForStudios(studioIds);
      // Abort if user navigated away during the fetch
      if (navVersion !== navigationVersion) return;
      // Inject widgets for each card
      for (const [studioId, card] of cardIdMap.entries()) {
        const topPerformer = topPerformers.get(studioId);
        await injectTopPerformerWidget(card, topPerformer || null);
      }
    } catch (err) {
      console.error("[TopPerformer] Error processing cards in batch:", err);
      // Fallback to individual processing
      for (const card of unprocessedCards) {
        await injectTopPerformerWidget(card);
      }
    }
  }

  // ============================================
  // PAGE DETECTION
  // ============================================

  /**
   * Check if we're on a page where studio cards are expected.
   * Uses an allowlist approach to prevent the plugin from appearing on unrelated pages.
   * @returns {boolean} True if we should process studio cards
   */
  function shouldProcessStudios() {
    const path = window.location.pathname;

    // Studios listing page (pathname doesn't include query params)
    if (path === "/studios" || path === "/studios/") {
      return true;
    }

    // Home page - may show studio cards in recommendations
    if (path === "/" || path === "") {
      return true;
    }

    return false;
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  // Debounce timeout for mutation observer
  let processingTimeout = null;

  /**
   * Initialize the plugin
   */
  function init() {
    console.log("[TopPerformer] Plugin initialized");

    // Initial processing if on a page with potential studios
    if (shouldProcessStudios()) {
      // Delay to allow Stash UI to render
      setTimeout(() => {
        processStudioCards();
      }, 1000);
    }

    // Watch for DOM changes (SPA navigation, lazy loading, etc.)
    const observer = new MutationObserver((mutations) => {
      // Only process on allowed pages (studios listing or home page)
      if (!shouldProcessStudios()) {
        return;
      }

      // Debounce processing
      clearTimeout(processingTimeout);
      processingTimeout = setTimeout(() => {
        processStudioCards();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for Stash navigation events if PluginApi is available
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", (e) => {
        // Increment navigation version to invalidate any in-flight async work
        navigationVersion++;
        // Cancel any pending debounced processing from the previous page
        clearTimeout(processingTimeout);

        if (shouldProcessStudios()) {
          console.log("[TopPerformer] Page changed:", e.detail.data.location.pathname);
          // Delay to allow UI to render
          setTimeout(() => {
            processStudioCards();
          }, 500);
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
