(function () {
  "use strict";

  // ============================================
  // DUPLICATE CHECKER PLUGIN
  // Adds "Find Duplicate Scenes" to performer and
  // studio pages, filtered to that context.
  // ============================================

  const PLUGIN_NAME = "[DuplicateChecker]";

  // Increment on every SPA navigation to cancel stale async work
  let navigationVersion = 0;

  // Whether Apollo client has permanently failed (avoid repeated errors)
  let apolloFailed = false;

  // Cached plugin settings
  let pluginConfigCache = null;

  // ============================================
  // GRAPHQL HELPERS
  // ============================================

  /**
   * Return the Stash GraphQL endpoint URL, respecting any custom base path.
   * @returns {string} Full URL to the /graphql endpoint
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
   * Execute a GraphQL query or mutation against the local Stash instance.
   * Prefers the Stash Apollo client when available; falls back to raw fetch.
   * @param {string} query - GraphQL query/mutation string
   * @param {Object} variables - Query variables
   * @returns {Promise<Object>} GraphQL response data
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
          `${PLUGIN_NAME} Apollo client unavailable, using direct fetch:`,
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
      throw new Error(`${PLUGIN_NAME} GraphQL request failed: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      console.error(`${PLUGIN_NAME} GraphQL error:`, result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  // ============================================
  // GRAPHQL QUERIES
  // ============================================

  const FIND_DUPLICATE_SCENES_QUERY = `
    query FindDuplicateScenes($duration_diff: Float, $distance: Int) {
      findDuplicateScenes(duration_diff: $duration_diff, distance: $distance) {
        id
        title
        date
        duration
        studio {
          id
          name
        }
        performers {
          id
          name
        }
        files {
          path
          size
          width
          height
          video_codec
          bit_rate
        }
        paths {
          screenshot
        }
      }
    }
  `;

  const FIND_PERFORMER_QUERY = `
    query FindPerformer($id: ID!) {
      findPerformer(id: $id) {
        id
        name
      }
    }
  `;

  const FIND_STUDIO_QUERY = `
    query FindStudio($id: ID!) {
      findStudio(id: $id) {
        id
        name
      }
    }
  `;

  const FIND_PLUGIN_CONFIG_QUERY = `
    query Configuration {
      configuration {
        plugins
      }
    }
  `;

  // ============================================
  // PLUGIN SETTINGS
  // ============================================

  /**
   * Fetch plugin settings from Stash configuration.
   * Returns cached values after the first successful fetch.
   * @returns {Promise<{durationDiff: number, distance: number}>}
   */
  async function getPluginConfig() {
    if (pluginConfigCache) return pluginConfigCache;

    try {
      const data = await graphqlQuery(FIND_PLUGIN_CONFIG_QUERY);
      const plugins = data?.configuration?.plugins;
      const config = plugins?.DuplicateChecker || {};
      pluginConfigCache = {
        durationDiff: typeof config.durationDiff === "number" ? config.durationDiff : 10,
        distance: typeof config.distance === "number" ? Math.round(config.distance) : 10,
      };
    } catch (err) {
      console.warn(`${PLUGIN_NAME} Could not load plugin config, using defaults:`, err);
      pluginConfigCache = { durationDiff: 10, distance: 10 };
    }

    return pluginConfigCache;
  }

  // ============================================
  // PAGE DETECTION
  // ============================================

  /**
   * Return the performer ID if the current URL is a single performer page.
   * Matches /performers/{id}, /performers/{id}/, /performers/{id}/scenes, etc.
   * @returns {string|null} Performer ID or null
   */
  function getPerformerIdFromUrl() {
    const match = window.location.pathname.match(/^\/performers\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  /**
   * Return the studio ID if the current URL is a single studio page.
   * Matches /studios/{id}, /studios/{id}/, /studios/{id}/scenes, etc.
   * @returns {string|null} Studio ID or null
   */
  function getStudioIdFromUrl() {
    const match = window.location.pathname.match(/^\/studios\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  /**
   * Return true when on a single performer detail page.
   * @returns {boolean}
   */
  function isOnSinglePerformerPage() {
    return getPerformerIdFromUrl() !== null;
  }

  /**
   * Return true when on a single studio detail page.
   * @returns {boolean}
   */
  function isOnSingleStudioPage() {
    return getStudioIdFromUrl() !== null;
  }

  // ============================================
  // DUPLICATE SCENE FETCHING & FILTERING
  // ============================================

  /**
   * Fetch all duplicate scene groups from Stash and filter to those that contain
   * at least one scene associated with the given performer ID.
   * @param {string} performerId
   * @returns {Promise<Array<Array<Object>>>} Filtered duplicate groups
   */
  async function findDuplicateScenesForPerformer(performerId) {
    const config = await getPluginConfig();
    const data = await graphqlQuery(FIND_DUPLICATE_SCENES_QUERY, {
      duration_diff: config.durationDiff,
      distance: config.distance,
    });

    const groups = data?.findDuplicateScenes || [];
    // Each group is an array of scene objects. Keep groups where at least one
    // scene has the target performer in its performers array.
    return groups.filter((group) =>
      group.some((scene) =>
        Array.isArray(scene.performers) &&
        scene.performers.some((p) => p.id === performerId)
      )
    );
  }

  /**
   * Fetch all duplicate scene groups from Stash and filter to those that contain
   * at least one scene associated with the given studio ID.
   * @param {string} studioId
   * @returns {Promise<Array<Array<Object>>>} Filtered duplicate groups
   */
  async function findDuplicateScenesForStudio(studioId) {
    const config = await getPluginConfig();
    const data = await graphqlQuery(FIND_DUPLICATE_SCENES_QUERY, {
      duration_diff: config.durationDiff,
      distance: config.distance,
    });

    const groups = data?.findDuplicateScenes || [];
    return groups.filter((group) =>
      group.some((scene) => scene.studio && scene.studio.id === studioId)
    );
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Format a file size in bytes to a human-readable string.
   * @param {number|null} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (!bytes) return "Unknown";
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  /**
   * Format a duration in seconds to HH:MM:SS or MM:SS.
   * @param {number|null} seconds
   * @returns {string}
   */
  function formatDuration(seconds) {
    if (!seconds) return "Unknown";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /**
   * Build the base Stash URL (scheme + host + optional base path).
   * @returns {string}
   */
  function getStashBaseUrl() {
    const baseEl = document.querySelector("base");
    let baseURL = baseEl ? baseEl.getAttribute("href") : "/";
    // Remove trailing slash so scene links come out as /scenes/123 not //scenes/123
    return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  }

  // ============================================
  // MODAL
  // ============================================

  /**
   * Build the HTML for a single scene card within a duplicate group.
   * @param {Object} scene
   * @param {string} stashBase
   * @returns {string} HTML string
   */
  function buildSceneCardHtml(scene, stashBase) {
    const title = scene.title || `Scene #${scene.id}`;
    const date = scene.date || "";
    const duration = formatDuration(scene.duration);
    const studio = scene.studio ? scene.studio.name : "No studio";
    const performers = Array.isArray(scene.performers) && scene.performers.length > 0
      ? scene.performers.map((p) => p.name).join(", ")
      : "No performers";
    const screenshot = scene.paths && scene.paths.screenshot
      ? scene.paths.screenshot
      : "";
    const sceneUrl = `${stashBase}/scenes/${scene.id}`;

    // Build file info rows
    const fileRows = Array.isArray(scene.files) && scene.files.length > 0
      ? scene.files.map((f) => {
          const path = f.path || "Unknown path";
          const size = formatFileSize(f.size);
          const resolution = f.width && f.height ? `${f.width}×${f.height}` : "";
          const codec = f.video_codec || "";
          const bitrate = f.bit_rate ? `${Math.round(f.bit_rate / 1000)} kbps` : "";
          const meta = [resolution, codec, bitrate].filter(Boolean).join(" · ");
          return `
            <div class="dc-file-row">
              <span class="dc-file-path" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
              <span class="dc-file-meta">${escapeHtml(size)}${meta ? " · " + escapeHtml(meta) : ""}</span>
            </div>
          `;
        }).join("")
      : `<div class="dc-file-row dc-file-no-info">No file info available</div>`;

    const thumbHtml = screenshot
      ? `<a href="${sceneUrl}" target="_blank" rel="noopener">
           <img class="dc-scene-thumb" src="${screenshot}" alt="${escapeHtml(title)}" loading="lazy" />
         </a>`
      : `<a href="${sceneUrl}" target="_blank" rel="noopener">
           <div class="dc-scene-thumb dc-scene-thumb-placeholder">No preview</div>
         </a>`;

    return `
      <div class="dc-scene-card">
        ${thumbHtml}
        <div class="dc-scene-info">
          <a class="dc-scene-title" href="${sceneUrl}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
          <div class="dc-scene-meta">
            ${date ? `<span class="dc-meta-item">${escapeHtml(date)}</span>` : ""}
            <span class="dc-meta-item">${escapeHtml(duration)}</span>
            <span class="dc-meta-item">${escapeHtml(studio)}</span>
          </div>
          <div class="dc-scene-performers" title="${escapeHtml(performers)}">${escapeHtml(performers)}</div>
          <div class="dc-file-list">${fileRows}</div>
          <a class="dc-open-btn" href="${sceneUrl}" target="_blank" rel="noopener">Open Scene ↗</a>
        </div>
      </div>
    `;
  }

  /**
   * Escape HTML special characters to prevent XSS when inserting user data via innerHTML.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Show a modal with the filtered duplicate scene groups.
   * @param {Array<Array<Object>>} groups - Filtered duplicate groups (each group is an array of scenes)
   * @param {string} contextLabel - Human-readable label, e.g. "Performer: Jane Doe"
   */
  function showDuplicatesModal(groups, contextLabel) {
    // Remove any existing modal
    const existing = document.getElementById("dc-modal");
    if (existing) existing.remove();

    const stashBase = getStashBaseUrl();
    const duplicateCheckerUrl = `${stashBase}/sceneDuplicateChecker`;

    let bodyHtml;
    if (groups.length === 0) {
      bodyHtml = `
        <div class="dc-empty">
          <p>No duplicate scenes found for <strong>${escapeHtml(contextLabel)}</strong>.</p>
          <p class="dc-empty-hint">
            Make sure Stash has scanned with fingerprinting enabled, or try adjusting the 
            Distance setting in the plugin configuration.
          </p>
          <a class="dc-checker-link" href="${duplicateCheckerUrl}" target="_blank" rel="noopener">
            View All Duplicates in Stash Duplicate Checker ↗
          </a>
        </div>
      `;
    } else {
      const groupsHtml = groups.map((group, i) => {
        const scenesHtml = group.map((scene) => buildSceneCardHtml(scene, stashBase)).join("");
        return `
          <div class="dc-group">
            <div class="dc-group-header">Duplicate Group ${i + 1} <span class="dc-group-count">(${group.length} scenes)</span></div>
            <div class="dc-group-scenes">${scenesHtml}</div>
          </div>
        `;
      }).join("");

      bodyHtml = `
        <div class="dc-results-header">
          <p class="dc-result-summary">
            Found <strong>${groups.length}</strong> duplicate group${groups.length !== 1 ? "s" : ""} 
            for <strong>${escapeHtml(contextLabel)}</strong>.
          </p>
          <a class="dc-checker-link" href="${duplicateCheckerUrl}" target="_blank" rel="noopener">
            View All Duplicates in Stash ↗
          </a>
        </div>
        <div class="dc-groups-list">${groupsHtml}</div>
      `;
    }

    const modal = document.createElement("div");
    modal.id = "dc-modal";
    modal.innerHTML = `
      <div class="dc-backdrop"></div>
      <div class="dc-dialog" role="dialog" aria-modal="true" aria-label="Duplicate Scenes">
        <div class="dc-dialog-header">
          <h2 class="dc-dialog-title">🔍 Duplicate Scenes</h2>
          <button class="dc-close" aria-label="Close">✕</button>
        </div>
        <div class="dc-dialog-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector(".dc-backdrop").addEventListener("click", closeModal);
    modal.querySelector(".dc-close").addEventListener("click", closeModal);

    // Close on Escape key
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", onKeydown);
      }
    };
    document.addEventListener("keydown", onKeydown);
  }

  /**
   * Show a modal with a loading spinner and status message.
   * @param {string} message - Status text to display
   * @returns {HTMLElement} The modal element (for later update/removal)
   */
  function showLoadingModal(message) {
    const existing = document.getElementById("dc-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "dc-modal";
    modal.innerHTML = `
      <div class="dc-backdrop"></div>
      <div class="dc-dialog dc-dialog-loading" role="dialog" aria-modal="true" aria-label="Loading">
        <button class="dc-close" aria-label="Close">✕</button>
        <div class="dc-loading-body">
          <div class="dc-spinner"></div>
          <p class="dc-loading-text">${escapeHtml(message)}</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".dc-close").addEventListener("click", () => modal.remove());
    modal.querySelector(".dc-backdrop").addEventListener("click", () => modal.remove());

    return modal;
  }

  /**
   * Show an error modal.
   * @param {string} message - Error message to display
   */
  function showErrorModal(message) {
    const existing = document.getElementById("dc-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "dc-modal";
    modal.innerHTML = `
      <div class="dc-backdrop"></div>
      <div class="dc-dialog dc-dialog-error" role="dialog" aria-modal="true" aria-label="Error">
        <div class="dc-dialog-header">
          <h2 class="dc-dialog-title">Error</h2>
          <button class="dc-close" aria-label="Close">✕</button>
        </div>
        <div class="dc-dialog-body">
          <p class="dc-error-text">${escapeHtml(message)}</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector(".dc-backdrop").addEventListener("click", closeModal);
    modal.querySelector(".dc-close").addEventListener("click", closeModal);
  }

  // ============================================
  // BUTTON INJECTION
  // ============================================

  /**
   * Find a suitable injection target in the Stash detail page header.
   * Tries several known Stash UI selectors.
   * @returns {HTMLElement|null}
   */
  function findInjectionTarget() {
    // Try the details/actions area where Stash renders Edit/Merge buttons
    return (
      document.querySelector(".detail-header-group .details-edit") ||
      document.querySelector(".details-edit") ||
      document.querySelector(".detail-header") ||
      document.querySelector(".performer-head") ||
      document.querySelector(".studio-details") ||
      document.querySelector(".detail-container") ||
      document.querySelector("h2")?.parentElement ||
      null
    );
  }

  /**
   * Handle the "Find Duplicate Scenes" button click for a performer page.
   * @param {string} performerId
   */
  async function handlePerformerButtonClick(performerId) {
    const navSnapshot = navigationVersion;

    const loadingModal = showLoadingModal("Scanning for duplicate scenes… This may take a moment on large libraries.");

    try {
      // Fetch performer name for the modal title
      let performerName = `Performer #${performerId}`;
      try {
        const nameData = await graphqlQuery(FIND_PERFORMER_QUERY, { id: performerId });
        if (nameData?.findPerformer?.name) {
          performerName = nameData.findPerformer.name;
        }
      } catch (e) {
        console.warn(`${PLUGIN_NAME} Could not fetch performer name:`, e);
      }

      if (navSnapshot !== navigationVersion) {
        loadingModal.remove();
        return;
      }

      const groups = await findDuplicateScenesForPerformer(performerId);

      if (navSnapshot !== navigationVersion) {
        loadingModal.remove();
        return;
      }

      loadingModal.remove();
      showDuplicatesModal(groups, `Performer: ${performerName}`);
    } catch (err) {
      console.error(`${PLUGIN_NAME} Error finding duplicates for performer ${performerId}:`, err);
      loadingModal.remove();
      showErrorModal(`Failed to fetch duplicates: ${err.message}`);
    }
  }

  /**
   * Handle the "Find Duplicate Scenes" button click for a studio page.
   * @param {string} studioId
   */
  async function handleStudioButtonClick(studioId) {
    const navSnapshot = navigationVersion;

    const loadingModal = showLoadingModal("Scanning for duplicate scenes… This may take a moment on large libraries.");

    try {
      // Fetch studio name for the modal title
      let studioName = `Studio #${studioId}`;
      try {
        const nameData = await graphqlQuery(FIND_STUDIO_QUERY, { id: studioId });
        if (nameData?.findStudio?.name) {
          studioName = nameData.findStudio.name;
        }
      } catch (e) {
        console.warn(`${PLUGIN_NAME} Could not fetch studio name:`, e);
      }

      if (navSnapshot !== navigationVersion) {
        loadingModal.remove();
        return;
      }

      const groups = await findDuplicateScenesForStudio(studioId);

      if (navSnapshot !== navigationVersion) {
        loadingModal.remove();
        return;
      }

      loadingModal.remove();
      showDuplicatesModal(groups, `Studio: ${studioName}`);
    } catch (err) {
      console.error(`${PLUGIN_NAME} Error finding duplicates for studio ${studioId}:`, err);
      loadingModal.remove();
      showErrorModal(`Failed to fetch duplicates: ${err.message}`);
    }
  }

  /**
   * Inject the "Find Duplicate Scenes" button into the current page if applicable.
   * Safe to call repeatedly — checks for existing button before injecting.
   */
  function injectButton() {
    // Guard: only inject on performer or studio detail pages
    const performerId = getPerformerIdFromUrl();
    const studioId = getStudioIdFromUrl();
    if (!performerId && !studioId) return;

    // Avoid injecting more than once per page load
    if (document.getElementById("dc-find-dupes-btn")) return;

    const target = findInjectionTarget();
    if (!target) return;

    const btn = document.createElement("button");
    btn.id = "dc-find-dupes-btn";
    btn.className = "dc-find-dupes-btn";
    btn.title = "Find duplicate scenes for this " + (performerId ? "performer" : "studio");
    btn.textContent = "🔍 Find Duplicate Scenes";

    btn.addEventListener("click", () => {
      if (performerId) {
        handlePerformerButtonClick(performerId);
      } else {
        handleStudioButtonClick(studioId);
      }
    });

    // Wrap in a container so the button doesn't break the header layout
    const wrapper = document.createElement("div");
    wrapper.className = "dc-btn-wrapper";
    wrapper.appendChild(btn);

    // Prefer inserting before existing action buttons, fall back to appending
    const firstBtn = target.querySelector("button, .btn, a.edit-button");
    if (firstBtn) {
      target.insertBefore(wrapper, firstBtn);
    } else {
      target.appendChild(wrapper);
    }

    console.log(`${PLUGIN_NAME} Injected button for ${performerId ? "performer" : "studio"} ${performerId || studioId}`);
  }

  // ============================================
  // INIT & NAVIGATION
  // ============================================

  // Debounce timer for MutationObserver-driven injection attempts
  let injectDebounceTimer = null;

  /**
   * Debounced injection: waits a short time after DOM mutations before attempting
   * button injection to allow Stash's React UI to finish rendering.
   */
  function scheduleInjectButton() {
    clearTimeout(injectDebounceTimer);
    injectDebounceTimer = setTimeout(() => {
      injectButton();
    }, 600);
  }

  /**
   * Main initialization. Sets up button injection and navigation listeners.
   */
  function init() {
    console.log(`${PLUGIN_NAME} Initialized`);

    // Initial injection attempt (handles page-load on a performer/studio page)
    setTimeout(injectButton, 800);

    // Watch for Stash SPA navigation (React Router changes)
    if (typeof PluginApi !== "undefined" && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", (e) => {
        navigationVersion++;
        pluginConfigCache = null; // Invalidate config cache on navigation

        const path = e.detail?.data?.location?.pathname || window.location.pathname;
        console.log(`${PLUGIN_NAME} Page changed:`, path);

        // Remove stale button from previous page
        const oldBtn = document.getElementById("dc-find-dupes-btn");
        if (oldBtn) oldBtn.parentElement?.remove();

        // Schedule injection on the new page
        scheduleInjectButton();
      });
    }

    // MutationObserver fallback: catches React re-renders and lazy-loaded content
    const observer = new MutationObserver(() => {
      // Only schedule if we are on a relevant page and the button is missing
      if ((isOnSinglePerformerPage() || isOnSingleStudioPage()) &&
          !document.getElementById("dc-find-dupes-btn")) {
        scheduleInjectButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================
  // BOOTSTRAP
  // ============================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
