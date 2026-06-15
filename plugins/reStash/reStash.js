(function () {
  "use strict";

  // ============================================
  // RESTASH PLUGIN
  // Displays scenes sorted by restash_score custom field.
  // Regular custom-field filtering is broken in Stash so this plugin
  // fetches all scenes via GraphQL and sorts/filters in-browser.
  // ============================================

  const PLUGIN_PREFIX = "[ReStash]";

  // How many scenes to load per GraphQL page (can be overridden in plugin settings)
  const DEFAULT_PAGE_SIZE = 250;

  // Custom field key names
  const CF_SCORE = "restash_score";
  const CF_RAW = "restash_raw";
  const CF_COMPONENTS = "restash_components";
  const CF_UPDATED = "restash_updated";

  // Apollo failure flag — after first failure fall back to direct fetch
  let apolloFailed = false;

  // ============================================
  // GRAPHQL HELPERS
  // ============================================

  /**
   * Return the GraphQL endpoint URL, respecting any <base> tag for sub-path deployments.
   * @returns {string}
   */
  function getGraphQLUrl() {
    const baseEl = document.querySelector("base");
    let base = baseEl ? baseEl.getAttribute("href") : "/";
    if (!base.endsWith("/")) base += "/";
    return `${base}graphql`;
  }

  /**
   * Execute a GraphQL query/mutation through the Stash Apollo client when available,
   * falling back to a direct fetch.
   * @param {string} query
   * @param {Object} variables
   * @returns {Promise<Object>} data field of the GraphQL response
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
        if (!client || !gql) throw new Error("Apollo client or gql not available");
        const doc = gql(query);
        const isMutation = doc.definitions.some(
          (d) => d.kind === "OperationDefinition" && d.operation === "mutation"
        );
        const result = isMutation
          ? await client.mutate({ mutation: doc, variables })
          : await client.query({ query: doc, variables, fetchPolicy: "no-cache" });
        return result.data;
      } catch (err) {
        apolloFailed = true;
        console.warn(`${PLUGIN_PREFIX} Apollo unavailable, switching to direct fetch:`, err?.message || err);
      }
    }

    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`${PLUGIN_PREFIX} GraphQL request failed: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      console.error(`${PLUGIN_PREFIX} GraphQL errors:`, result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  // ============================================
  // PLUGIN SETTINGS
  // ============================================

  /**
   * Load plugin configuration from Stash settings.
   * @returns {Promise<{pageSize: number, minScore: number}>}
   */
  async function loadPluginConfig() {
    try {
      const data = await graphqlQuery(`
        query {
          configuration {
            plugins
          }
        }
      `);
      const cfg = (data?.configuration?.plugins?.reStash) || {};
      return {
        pageSize: parseInt(cfg.pageSize, 10) || DEFAULT_PAGE_SIZE,
        minScore: parseFloat(cfg.minScore) || 0,
      };
    } catch (err) {
      console.warn(`${PLUGIN_PREFIX} Could not load plugin config, using defaults:`, err?.message || err);
      return { pageSize: DEFAULT_PAGE_SIZE, minScore: 0 };
    }
  }

  // ============================================
  // SCENE FETCHING
  // ============================================

  const SCENE_FIELDS = `
    id
    title
    date
    paths {
      screenshot
    }
    studio {
      name
    }
    performers {
      name
    }
    custom_fields
  `;

  /**
   * Fetch one page of scenes from the GraphQL API.
   * @param {number} page - 1-based page number
   * @param {number} pageSize
   * @returns {Promise<{scenes: Array, count: number}>}
   */
  async function fetchScenePage(page, pageSize) {
    const query = `
      query FetchScenesPage($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            ${SCENE_FIELDS}
          }
        }
      }
    `;
    const variables = {
      filter: {
        per_page: pageSize,
        page: page,
      },
    };
    const data = await graphqlQuery(query, variables);
    return {
      scenes: data.findScenes.scenes || [],
      count: data.findScenes.count || 0,
    };
  }

  /**
   * Fetch ALL scenes and return only those that have a restash_score.
   * Shows progress via a callback.
   * @param {number} pageSize
   * @param {function(number, number): void} onProgress - called with (loaded, total)
   * @returns {Promise<Array>}
   */
  async function fetchAllScoredScenes(pageSize, onProgress) {
    const firstPage = await fetchScenePage(1, pageSize);
    const total = firstPage.count;
    let allScenes = [...firstPage.scenes];

    if (onProgress) onProgress(allScenes.length, total);

    const totalPages = Math.ceil(total / pageSize);
    for (let p = 2; p <= totalPages; p++) {
      const { scenes } = await fetchScenePage(p, pageSize);
      allScenes = allScenes.concat(scenes);
      if (onProgress) onProgress(allScenes.length, total);
    }

    // Filter to scenes that have a restash_score
    return allScenes.filter((scene) => {
      const fields = parseCustomFields(scene.custom_fields);
      return fields[CF_SCORE] !== undefined && fields[CF_SCORE] !== null;
    });
  }

  // ============================================
  // CUSTOM FIELD PARSING
  // ============================================

  /**
   * Parse the custom_fields value returned by Stash's GraphQL.
   * The value can be a JSON string, a plain object, or null/undefined.
   * @param {*} raw
   * @returns {Object}
   */
  function parseCustomFields(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  /**
   * Parse a JSON-encoded component breakdown string.
   * @param {*} raw
   * @returns {Object|null}
   */
  function parseComponents(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  // ============================================
  // HTML HELPERS
  // ============================================

  /**
   * Escape a string for safe insertion into HTML.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Format a date string to a short locale date.
   * @param {string|null} dateStr
   * @returns {string}
   */
  function formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return dateStr;
    }
  }

  /**
   * Return a CSS class name based on the restash_score value.
   * @param {number} score
   * @returns {string}
   */
  function scoreColorClass(score) {
    if (score >= 70) return "rs-score-high";
    if (score >= 40) return "rs-score-mid";
    return "rs-score-low";
  }

  /**
   * Build the HTML for a single component bar in the breakdown.
   * @param {string} name
   * @param {number} value
   * @returns {string}
   */
  function componentBarHtml(name, value) {
    const pct = Math.min(Math.abs(value) * 100, 100).toFixed(1);
    const sign = value >= 0 ? "positive" : "negative";
    const label = value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
    return `
      <div class="rs-comp-row">
        <span class="rs-comp-name">${escapeHtml(name)}</span>
        <div class="rs-comp-bar-wrap">
          <div class="rs-comp-bar rs-comp-bar-${sign}" style="width:${pct}%"></div>
        </div>
        <span class="rs-comp-value rs-comp-value-${sign}">${label}</span>
      </div>`;
  }

  /**
   * Build the full HTML for a scene card.
   * @param {Object} scene - scene object from GraphQL
   * @param {number} rank - 1-based rank
   * @returns {string}
   */
  function sceneCardHtml(scene, rank) {
    const fields = parseCustomFields(scene.custom_fields);
    const score = fields[CF_SCORE];
    const raw = fields[CF_RAW];
    const updated = fields[CF_UPDATED];
    const components = parseComponents(fields[CF_COMPONENTS]);

    const title = scene.title || `Scene #${scene.id}`;
    const studio = scene.studio?.name || "";
    const performers = (scene.performers || []).map((p) => p.name).join(", ");
    const date = formatDate(scene.date);
    const updatedStr = formatDate(updated);
    const thumb = scene.paths?.screenshot || "";
    const colorClass = scoreColorClass(score);

    let compsHtml = "";
    if (components && typeof components === "object") {
      const entries = Object.entries(components).filter(
        ([k]) => !["n_events", "fresh_d"].includes(k)
      );
      compsHtml = `
        <div class="rs-components" id="rs-comp-${scene.id}" style="display:none;">
          ${entries.map(([k, v]) => componentBarHtml(k, Number(v))).join("")}
        </div>
        <button class="rs-toggle-comp" data-scene="${escapeHtml(scene.id)}">▸ Components</button>`;
    }

    return `
      <div class="rs-scene-card" data-scene-id="${escapeHtml(scene.id)}">
        <div class="rs-rank">#${rank}</div>
        ${thumb ? `<a href="/scenes/${escapeHtml(scene.id)}" target="_blank" class="rs-thumb-link">
          <img class="rs-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(title)}" loading="lazy" />
        </a>` : `<div class="rs-thumb rs-thumb-missing"></div>`}
        <div class="rs-info">
          <a class="rs-title" href="/scenes/${escapeHtml(scene.id)}" target="_blank">${escapeHtml(title)}</a>
          <div class="rs-meta">
            ${studio ? `<span class="rs-studio">${escapeHtml(studio)}</span>` : ""}
            ${performers ? `<span class="rs-performers">${escapeHtml(performers)}</span>` : ""}
            ${date !== "—" ? `<span class="rs-date">${date}</span>` : ""}
          </div>
          ${compsHtml}
        </div>
        <div class="rs-scores">
          <div class="rs-score ${colorClass}" title="restash_score">${score}</div>
          ${raw !== undefined ? `<div class="rs-raw" title="restash_raw">raw: ${Number(raw).toFixed(4)}</div>` : ""}
          ${updated ? `<div class="rs-updated" title="restash_updated">↻ ${updatedStr}</div>` : ""}
        </div>
      </div>`;
  }

  // ============================================
  // MODAL
  // ============================================

  let modalOpen = false;

  /**
   * Remove the ReStash modal if it exists.
   */
  function closeModal() {
    const existing = document.getElementById("rs-modal");
    if (existing) existing.remove();
    modalOpen = false;
  }

  /**
   * Open the main ReStash modal.
   */
  async function openModal() {
    if (modalOpen) {
      closeModal();
      return;
    }
    modalOpen = true;

    // Build skeleton modal
    const modal = document.createElement("div");
    modal.id = "rs-modal";
    modal.innerHTML = `
      <div class="rs-backdrop"></div>
      <div class="rs-dialog">
        <div class="rs-header">
          <span class="rs-header-title">📊 ReStash — Scored Scenes</span>
          <div class="rs-header-controls">
            <label class="rs-sort-label">Sort:
              <select id="rs-sort-select">
                <option value="score-desc" selected>Score ↓</option>
                <option value="score-asc">Score ↑</option>
                <option value="raw-desc">Raw ↓</option>
                <option value="raw-asc">Raw ↑</option>
                <option value="updated-desc">Updated ↓</option>
                <option value="title-asc">Title A–Z</option>
              </select>
            </label>
            <label class="rs-filter-label">Min score:
              <input id="rs-min-score" type="number" min="0" max="100" value="0" style="width:4em;" />
            </label>
            <button id="rs-apply-btn" class="rs-btn">Apply</button>
            <button id="rs-reload-btn" class="rs-btn rs-btn-secondary" title="Reload from Stash">↻</button>
            <button id="rs-close-btn" class="rs-btn rs-btn-close">✕</button>
          </div>
        </div>
        <div id="rs-status" class="rs-status">Loading scenes…</div>
        <div id="rs-content" class="rs-content"></div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on backdrop click
    modal.querySelector(".rs-backdrop").addEventListener("click", closeModal);
    modal.querySelector("#rs-close-btn").addEventListener("click", closeModal);

    // Component toggle delegation
    modal.addEventListener("click", (e) => {
      const btn = e.target.closest(".rs-toggle-comp");
      if (!btn) return;
      const id = btn.dataset.scene;
      const comp = document.getElementById(`rs-comp-${id}`);
      if (!comp) return;
      const visible = comp.style.display !== "none";
      comp.style.display = visible ? "none" : "block";
      btn.textContent = visible ? "▸ Components" : "▾ Components";
    });

    // Sort / filter controls
    let cachedScenes = null;

    function applySortFilter() {
      if (!cachedScenes) return;
      const sort = document.getElementById("rs-sort-select").value;
      const minScore = parseFloat(document.getElementById("rs-min-score").value) || 0;
      renderScenes(cachedScenes, sort, minScore);
    }

    modal.querySelector("#rs-apply-btn").addEventListener("click", applySortFilter);

    modal.querySelector("#rs-sort-select").addEventListener("change", applySortFilter);

    modal.querySelector("#rs-reload-btn").addEventListener("click", async () => {
      cachedScenes = null;
      document.getElementById("rs-status").textContent = "Reloading…";
      document.getElementById("rs-content").innerHTML = "";
      cachedScenes = await loadScenes();
      applySortFilter();
    });

    /**
     * Sort and filter scenes, then render cards.
     * @param {Array} scenes
     * @param {string} sort
     * @param {number} minScore
     */
    function renderScenes(scenes, sort, minScore) {
      const sortedFiltered = scenes
        .filter((s) => {
          const f = parseCustomFields(s.custom_fields);
          return (f[CF_SCORE] || 0) >= minScore;
        })
        .slice()
        .sort((a, b) => {
          const fa = parseCustomFields(a.custom_fields);
          const fb = parseCustomFields(b.custom_fields);
          switch (sort) {
            case "score-desc": return (fb[CF_SCORE] || 0) - (fa[CF_SCORE] || 0);
            case "score-asc": return (fa[CF_SCORE] || 0) - (fb[CF_SCORE] || 0);
            case "raw-desc": return (Number(fb[CF_RAW]) || 0) - (Number(fa[CF_RAW]) || 0);
            case "raw-asc": return (Number(fa[CF_RAW]) || 0) - (Number(fb[CF_RAW]) || 0);
            case "updated-desc": {
              const da = fa[CF_UPDATED] ? new Date(fa[CF_UPDATED]).getTime() : 0;
              const db = fb[CF_UPDATED] ? new Date(fb[CF_UPDATED]).getTime() : 0;
              return db - da;
            }
            case "title-asc":
              return (a.title || "").localeCompare(b.title || "");
            default:
              return (fb[CF_SCORE] || 0) - (fa[CF_SCORE] || 0);
          }
        });

      const statusEl = document.getElementById("rs-status");
      const contentEl = document.getElementById("rs-content");

      statusEl.textContent = `${sortedFiltered.length} scored scene${sortedFiltered.length !== 1 ? "s" : ""}`;

      if (sortedFiltered.length === 0) {
        contentEl.innerHTML = `<div class="rs-empty">No scenes found with a ${CF_SCORE} value${minScore > 0 ? ` ≥ ${minScore}` : ""}.</div>`;
        return;
      }

      contentEl.innerHTML = sortedFiltered.map((s, i) => sceneCardHtml(s, i + 1)).join("");
    }

    /**
     * Load all scored scenes, updating the status bar as pages arrive.
     * @returns {Promise<Array>}
     */
    async function loadScenes() {
      const cfg = await loadPluginConfig();
      const statusEl = document.getElementById("rs-status");
      let allScored;
      try {
        allScored = await fetchAllScoredScenes(cfg.pageSize, (loaded, total) => {
          if (statusEl) {
            statusEl.textContent = `Fetching scenes… ${loaded} / ${total}`;
          }
        });
      } catch (err) {
        console.error(`${PLUGIN_PREFIX} Failed to load scenes:`, err);
        if (statusEl) {
          statusEl.textContent = `Error: ${err.message}`;
        }
        return [];
      }
      return allScored;
    }

    // Kick off loading
    cachedScenes = await loadScenes();
    // Modal may have been closed while we were loading
    if (!document.getElementById("rs-modal")) return;
    const cfg = await loadPluginConfig();
    document.getElementById("rs-min-score").value = cfg.minScore || 0;
    applySortFilter();
  }

  // ============================================
  // NAVBAR BUTTON
  // ============================================

  /**
   * Inject a "📊 ReStash" button into Stash's main navigation bar.
   * @returns {boolean} true if successfully injected
   */
  function addNavbarButton() {
    if (document.getElementById("rs-nav-btn")) return true;

    const navTarget = document.querySelector(".navbar-nav");
    if (!navTarget) return false;

    const container = document.createElement("div");
    container.className = "col-4 col-sm-3 col-md-2 col-lg-auto nav-link";
    container.innerHTML = `
      <a href="javascript:void(0);" id="rs-nav-btn" class="minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center" title="ReStash">
        <span class="rs-nav-icon d-block d-xl-inline mb-2 mb-xl-0" aria-hidden="true">📊</span>
        <span>ReStash</span>
      </a>
    `;
    container.querySelector("#rs-nav-btn").addEventListener("click", openModal);
    navTarget.appendChild(container);
    return true;
  }

  /**
   * Add the ReStash launch button to the UI.
   * Tries navbar first, falls back to a floating button.
   */
  function addLaunchButton() {
    if (addNavbarButton()) return;

    if (document.getElementById("rs-floating-btn")) return;

    const btn = document.createElement("button");
    btn.id = "rs-floating-btn";
    btn.innerHTML = "📊";
    btn.title = "ReStash";
    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  let buttonTimeout = null;

  /**
   * Attempt to inject the launch button, retrying until the navbar is available.
   */
  function tryAddButton() {
    if (document.getElementById("rs-nav-btn") || document.getElementById("rs-floating-btn")) return;
    addLaunchButton();
    if (!document.getElementById("rs-nav-btn")) {
      // Navbar not rendered yet — retry
      clearTimeout(buttonTimeout);
      buttonTimeout = setTimeout(tryAddButton, 500);
    }
  }

  /**
   * Plugin entry point.
   */
  function init() {
    console.log(`${PLUGIN_PREFIX} Plugin initialized`);
    tryAddButton();

    // Re-inject on SPA navigation (navbar can be re-rendered)
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", () => {
        clearTimeout(buttonTimeout);
        buttonTimeout = setTimeout(tryAddButton, 300);
      });
    }

    // MutationObserver as a fallback to catch navbar renders
    const observer = new MutationObserver(() => {
      if (!document.getElementById("rs-nav-btn")) {
        clearTimeout(buttonTimeout);
        buttonTimeout = setTimeout(tryAddButton, 200);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
