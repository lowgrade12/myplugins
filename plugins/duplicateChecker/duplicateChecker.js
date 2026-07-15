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
   * Execute a GraphQL query or mutation against the local Stash instance via
   * direct fetch. Using the shared Stash Apollo client is intentionally avoided
   * because Stash calls clearStore() on navigation, which would kill any
   * in-flight plugin queries with an unhandled Invariant Violation.
   * @param {string} query - GraphQL query/mutation string
   * @param {Object} variables - Query variables
   * @returns {Promise<Object>} GraphQL response data
   */
  async function graphqlQuery(query, variables = {}) {
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
          duration
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

  const SCENE_DESTROY_MUTATION = `
    mutation SceneDestroy($id: ID!, $delete_file: Boolean, $delete_generated: Boolean) {
      sceneDestroy(input: { id: $id, delete_file: $delete_file, delete_generated: $delete_generated })
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
   * Build a scene card DOM element within a duplicate group, including a delete button.
   * @param {Object} scene
   * @param {string} stashBase
   * @returns {HTMLElement}
   */
  function buildSceneCard(scene, stashBase) {
    const title = scene.title || `Scene #${scene.id}`;
    const date = scene.date || "";
    const duration = formatDuration(scene.files?.[0]?.duration);
    const studio = scene.studio ? scene.studio.name : "No studio";
    const performers = Array.isArray(scene.performers) && scene.performers.length > 0
      ? scene.performers.map((p) => p.name).join(", ")
      : "No performers";
    const screenshot = scene.paths && scene.paths.screenshot
      ? scene.paths.screenshot
      : "";
    const sceneUrl = `${stashBase}/scenes/${scene.id}`;

    const card = document.createElement("div");
    card.className = "dc-scene-card";
    card.dataset.sceneId = scene.id;

    // Thumbnail wrapper (needed for checkbox overlay positioning)
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "dc-scene-thumb-wrap";

    const thumbLink = document.createElement("a");
    thumbLink.href = sceneUrl;
    thumbLink.target = "_blank";
    thumbLink.rel = "noopener";
    if (screenshot) {
      const img = document.createElement("img");
      img.className = "dc-scene-thumb";
      img.src = screenshot;
      img.alt = title;
      img.loading = "lazy";
      thumbLink.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "dc-scene-thumb dc-scene-thumb-placeholder";
      placeholder.textContent = "No preview";
      thumbLink.appendChild(placeholder);
    }
    thumbWrap.appendChild(thumbLink);

    // Checkbox overlay for bulk selection
    const checkLabel = document.createElement("label");
    checkLabel.className = "dc-scene-checkbox-label";
    checkLabel.title = "Select for bulk delete";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "dc-scene-checkbox";
    checkbox.dataset.sceneId = scene.id;
    const checkmark = document.createElement("span");
    checkmark.className = "dc-scene-checkmark";
    checkmark.setAttribute("aria-hidden", "true");
    checkmark.textContent = "✓";
    checkLabel.appendChild(checkbox);
    checkLabel.appendChild(checkmark);
    thumbWrap.appendChild(checkLabel);

    checkbox.addEventListener("change", () => {
      card.classList.toggle("dc-scene-card--selected", checkbox.checked);
    });

    card.appendChild(thumbWrap);

    // Info section
    const info = document.createElement("div");
    info.className = "dc-scene-info";

    const titleLink = document.createElement("a");
    titleLink.className = "dc-scene-title";
    titleLink.href = sceneUrl;
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    titleLink.textContent = title;
    info.appendChild(titleLink);

    const meta = document.createElement("div");
    meta.className = "dc-scene-meta";
    if (date) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "dc-meta-item";
      dateSpan.textContent = date;
      meta.appendChild(dateSpan);
    }
    const durSpan = document.createElement("span");
    durSpan.className = "dc-meta-item";
    durSpan.textContent = duration;
    meta.appendChild(durSpan);
    const studioSpan = document.createElement("span");
    studioSpan.className = "dc-meta-item";
    studioSpan.textContent = studio;
    meta.appendChild(studioSpan);
    info.appendChild(meta);

    const perfDiv = document.createElement("div");
    perfDiv.className = "dc-scene-performers";
    perfDiv.title = performers;
    perfDiv.textContent = performers;
    info.appendChild(perfDiv);

    const fileList = document.createElement("div");
    fileList.className = "dc-file-list";
    if (Array.isArray(scene.files) && scene.files.length > 0) {
      scene.files.forEach((f) => {
        const row = document.createElement("div");
        row.className = "dc-file-row";
        const pathSpan = document.createElement("span");
        pathSpan.className = "dc-file-path";
        pathSpan.title = f.path || "Unknown path";
        pathSpan.textContent = f.path || "Unknown path";
        const size = formatFileSize(f.size);
        const resolution = f.width && f.height ? `${f.width}×${f.height}` : "";
        const codec = f.video_codec || "";
        const bitrate = f.bit_rate ? `${Math.round(f.bit_rate / 1000)} kbps` : "";
        const metaStr = [resolution, codec, bitrate].filter(Boolean).join(" · ");
        const metaSpan = document.createElement("span");
        metaSpan.className = "dc-file-meta";
        metaSpan.textContent = size + (metaStr ? " · " + metaStr : "");
        row.appendChild(pathSpan);
        row.appendChild(metaSpan);
        fileList.appendChild(row);
      });
    } else {
      const noInfo = document.createElement("div");
      noInfo.className = "dc-file-row dc-file-no-info";
      noInfo.textContent = "No file info available";
      fileList.appendChild(noInfo);
    }
    info.appendChild(fileList);

    // Action buttons row
    const actions = document.createElement("div");
    actions.className = "dc-scene-actions";

    const openBtn = document.createElement("a");
    openBtn.className = "dc-open-btn";
    openBtn.href = sceneUrl;
    openBtn.target = "_blank";
    openBtn.rel = "noopener";
    openBtn.textContent = "Open Scene ↗";
    actions.appendChild(openBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "dc-delete-btn";
    deleteBtn.title = "Delete this scene";
    deleteBtn.textContent = "🗑 Delete";
    deleteBtn.addEventListener("click", () => handleDeleteScene(scene.id, card));
    actions.appendChild(deleteBtn);

    info.appendChild(actions);
    card.appendChild(info);

    return card;
  }

  /**
   * Handle deleting a scene. Prompts user for confirmation (and whether to delete
   * the underlying file), then calls the sceneDestroy mutation and removes the card.
   * If the group becomes empty or has only one scene left, removes the group element.
   * @param {string} sceneId
   * @param {HTMLElement} cardEl - The scene card DOM element
   */
  async function handleDeleteScene(sceneId, cardEl) {
    if (!window.confirm("Delete this scene from Stash?")) return;
    const deleteFile = window.confirm(
      "Also permanently delete the video file from disk?\n\nOK = yes, delete file · Cancel = keep file"
    );

    const deleteBtn = cardEl.querySelector(".dc-delete-btn");
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting…";
    }

    try {
      await graphqlQuery(SCENE_DESTROY_MUTATION, {
        id: sceneId,
        delete_file: deleteFile,
        delete_generated: true,
      });
      console.log(`${PLUGIN_NAME} Deleted scene ${sceneId}`);

      // Remove the card from the group
      const groupScenes = cardEl.closest(".dc-group-scenes");
      cardEl.remove();

      // If the group now has 0 or 1 scene, remove the entire group
      if (groupScenes) {
        const remaining = groupScenes.querySelectorAll(".dc-scene-card");
        if (remaining.length < 2) {
          const group = groupScenes.closest(".dc-group");
          if (group) group.remove();
        }
      }

      // Update the summary count
      const modal = document.getElementById("dc-modal");
      if (modal) {
        const groupsList = modal.querySelector(".dc-groups-list");
        if (groupsList) {
          const remainingGroups = groupsList.querySelectorAll(".dc-group").length;
          const summaryEl = modal.querySelector(".dc-result-summary");
          if (summaryEl) {
            const strong = summaryEl.querySelector("strong");
            if (strong) strong.textContent = String(remainingGroups);
          }

          // Sync bulk delete button count
          const bulkBtn = modal.querySelector(".dc-bulk-delete-btn");
          if (bulkBtn) {
            const checkedCount = groupsList.querySelectorAll(".dc-scene-checkbox:checked").length;
            bulkBtn.textContent = `🗑 Delete Selected (${checkedCount})`;
            bulkBtn.disabled = checkedCount === 0;
          }
        }
      }
    } catch (err) {
      console.error(`${PLUGIN_NAME} Failed to delete scene ${sceneId}:`, err);
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "🗑 Delete";
      }
      window.alert(`Failed to delete scene: ${err.message}`);
    }
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

    const modal = document.createElement("div");
    modal.id = "dc-modal";

    const backdrop = document.createElement("div");
    backdrop.className = "dc-backdrop";
    modal.appendChild(backdrop);

    const dialog = document.createElement("div");
    dialog.className = "dc-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Duplicate Scenes");
    modal.appendChild(dialog);

    const header = document.createElement("div");
    header.className = "dc-dialog-header";
    const titleEl = document.createElement("h2");
    titleEl.className = "dc-dialog-title";
    titleEl.textContent = "🔍 Duplicate Scenes";
    const closeBtn = document.createElement("button");
    closeBtn.className = "dc-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const body = document.createElement("div");
    body.className = "dc-dialog-body";
    dialog.appendChild(body);

    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dc-empty";

      const noResultsP = document.createElement("p");
      noResultsP.textContent = "No duplicate scenes found for ";
      const noResultsStrong = document.createElement("strong");
      noResultsStrong.textContent = contextLabel;
      noResultsP.appendChild(noResultsStrong);
      noResultsP.appendChild(document.createTextNode("."));
      empty.appendChild(noResultsP);

      const hintP = document.createElement("p");
      hintP.className = "dc-empty-hint";
      hintP.textContent = "Make sure Stash has scanned with fingerprinting enabled, or try adjusting the Distance setting in the plugin configuration.";
      empty.appendChild(hintP);

      const link = document.createElement("a");
      link.className = "dc-checker-link";
      link.href = duplicateCheckerUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View All Duplicates in Stash Duplicate Checker ↗";
      empty.appendChild(link);
      body.appendChild(empty);
    } else {
      // Results header
      const resultsHeader = document.createElement("div");
      resultsHeader.className = "dc-results-header";

      const summary = document.createElement("p");
      summary.className = "dc-result-summary";
      summary.appendChild(document.createTextNode("Found "));
      const countStrong = document.createElement("strong");
      countStrong.textContent = String(groups.length);
      summary.appendChild(countStrong);
      summary.appendChild(document.createTextNode(` duplicate group${groups.length !== 1 ? "s" : ""} for `));
      const labelStrong = document.createElement("strong");
      labelStrong.textContent = contextLabel;
      summary.appendChild(labelStrong);
      summary.appendChild(document.createTextNode("."));
      resultsHeader.appendChild(summary);

      const allLink = document.createElement("a");
      allLink.className = "dc-checker-link";
      allLink.href = duplicateCheckerUrl;
      allLink.target = "_blank";
      allLink.rel = "noopener";
      allLink.textContent = "View All Duplicates in Stash ↗";
      resultsHeader.appendChild(allLink);

      const bulkDeleteBtn = document.createElement("button");
      bulkDeleteBtn.className = "dc-bulk-delete-btn";
      bulkDeleteBtn.type = "button";
      bulkDeleteBtn.textContent = "🗑 Delete Selected (0)";
      bulkDeleteBtn.disabled = true;
      resultsHeader.appendChild(bulkDeleteBtn);

      body.appendChild(resultsHeader);

      const groupsList = document.createElement("div");
      groupsList.className = "dc-groups-list";

      groups.forEach((group, i) => {
        const groupEl = document.createElement("div");
        groupEl.className = "dc-group";

        const groupHeader = document.createElement("div");
        groupHeader.className = "dc-group-header";
        groupHeader.appendChild(document.createTextNode(`Duplicate Group ${i + 1} `));
        const countSpan = document.createElement("span");
        countSpan.className = "dc-group-count";
        countSpan.textContent = `(${group.length} scenes)`;
        groupHeader.appendChild(countSpan);

        const selectAllBtn = document.createElement("button");
        selectAllBtn.className = "dc-group-select-btn";
        selectAllBtn.type = "button";
        selectAllBtn.textContent = "Select All";
        groupHeader.appendChild(selectAllBtn);

        groupEl.appendChild(groupHeader);

        const scenesContainer = document.createElement("div");
        scenesContainer.className = "dc-group-scenes";
        group.forEach((scene) => {
          scenesContainer.appendChild(buildSceneCard(scene, stashBase));
        });
        groupEl.appendChild(scenesContainer);

        selectAllBtn.addEventListener("click", () => {
          const checkboxes = scenesContainer.querySelectorAll(".dc-scene-checkbox");
          const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every((cb) => cb.checked);
          const newState = !allChecked;
          checkboxes.forEach((cb) => {
            if (cb.checked !== newState) {
              cb.checked = newState;
              cb.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        });

        groupsList.appendChild(groupEl);
      });

      body.appendChild(groupsList);

      // Checkbox change event delegation — updates bulk delete button count and select-all text
      groupsList.addEventListener("change", (e) => {
        if (!e.target.classList.contains("dc-scene-checkbox")) return;
        const checkedCount = groupsList.querySelectorAll(".dc-scene-checkbox:checked").length;
        bulkDeleteBtn.textContent = `🗑 Delete Selected (${checkedCount})`;
        bulkDeleteBtn.disabled = checkedCount === 0;

        // Sync "Select All / Deselect All" text in each group header
        groupsList.querySelectorAll(".dc-group").forEach((grp) => {
          const btn = grp.querySelector(".dc-group-select-btn");
          const cbs = grp.querySelectorAll(".dc-scene-checkbox");
          if (btn && cbs.length > 0) {
            const allChecked = Array.from(cbs).every((cb) => cb.checked);
            btn.textContent = allChecked ? "Deselect All" : "Select All";
          }
        });
      });

      // Bulk delete handler
      bulkDeleteBtn.addEventListener("click", async () => {
        const checkedBoxes = Array.from(groupsList.querySelectorAll(".dc-scene-checkbox:checked"));
        if (checkedBoxes.length === 0) return;

        const sceneWord = checkedBoxes.length !== 1 ? "scenes" : "scene";
        if (!window.confirm(`Delete ${checkedBoxes.length} selected ${sceneWord} from Stash?`)) return;
        const deleteFile = window.confirm(
          "Also permanently delete the video files from disk?\n\nOK = yes, delete files · Cancel = keep files"
        );

        bulkDeleteBtn.disabled = true;
        bulkDeleteBtn.textContent = "Deleting…";

        let failed = 0;
        for (const cb of checkedBoxes) {
          const sceneId = cb.dataset.sceneId;
          const cardEl = cb.closest(".dc-scene-card");
          try {
            await graphqlQuery(SCENE_DESTROY_MUTATION, {
              id: sceneId,
              delete_file: deleteFile,
              delete_generated: true,
            });
            console.log(`${PLUGIN_NAME} Bulk deleted scene ${sceneId}`);
            if (cardEl) {
              const groupScenes = cardEl.closest(".dc-group-scenes");
              cardEl.remove();
              if (groupScenes) {
                const remaining = groupScenes.querySelectorAll(".dc-scene-card");
                if (remaining.length < 2) {
                  const group = groupScenes.closest(".dc-group");
                  if (group) group.remove();
                }
              }
            }
          } catch (err) {
            console.error(`${PLUGIN_NAME} Failed to bulk delete scene ${sceneId}:`, err);
            failed++;
          }
        }

        // Update summary count
        const remainingGroups = groupsList.querySelectorAll(".dc-group").length;
        const summaryEl = modal.querySelector(".dc-result-summary");
        if (summaryEl) {
          const strong = summaryEl.querySelector("strong");
          if (strong) strong.textContent = String(remainingGroups);
        }

        // Reset bulk delete button
        const remaining = groupsList.querySelectorAll(".dc-scene-checkbox:checked").length;
        bulkDeleteBtn.textContent = `🗑 Delete Selected (${remaining})`;
        bulkDeleteBtn.disabled = remaining === 0;

        if (failed > 0) {
          window.alert(`${failed} ${failed !== 1 ? "scenes" : "scene"} failed to delete. Check the console for details.`);
        }
      });
    }

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    backdrop.addEventListener("click", closeModal);
    closeBtn.addEventListener("click", closeModal);

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
   * Uses the same selectors as the missingScenes plugin so both buttons
   * appear in the same container.
   * @returns {HTMLElement|null}
   */
  function findInjectionTarget() {
    return (
      document.querySelector(".detail-header-buttons") ||
      document.querySelector('[class*="detail"] [class*="button"]')?.parentElement ||
      document.querySelector(".performer-head") ||
      document.querySelector(".studio-head") ||
      document.querySelector(".detail-header-group .details-edit") ||
      document.querySelector(".details-edit") ||
      document.querySelector(".detail-header") ||
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
    btn.className = "dc-find-dupes-btn btn btn-secondary";
    btn.type = "button";
    btn.title = "Find duplicate scenes for this " + (performerId ? "performer" : "studio");
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1em; height: 1em; margin-right: 0.5em;">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Find Duplicates
    `;

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

    // Prefer inserting right after the Missing Scenes button so both appear together
    const missingBtn = target.querySelector(".ms-search-button");
    if (missingBtn && missingBtn.nextSibling) {
      target.insertBefore(wrapper, missingBtn.nextSibling);
    } else if (missingBtn) {
      target.appendChild(wrapper);
    } else {
      // Fall back: insert before existing action buttons
      const firstBtn = target.querySelector("button, .btn, a.edit-button");
      if (firstBtn) {
        target.insertBefore(wrapper, firstBtn);
      } else {
        target.appendChild(wrapper);
      }
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

        // Remove stale button from previous page
        const oldBtn = document.getElementById("dc-find-dupes-btn");
        if (oldBtn) oldBtn.parentElement?.remove();

        // Schedule injection only on relevant pages
        if (isOnSinglePerformerPage() || isOnSingleStudioPage()) {
          const path = e.detail?.data?.location?.pathname || window.location.pathname;
          console.log(`${PLUGIN_NAME} Page changed:`, path);
          scheduleInjectButton();
        }
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
