(function () {
  "use strict";

  const PLUGIN_PREFIX = "[OHistoryBackfill]";
  const BUTTON_ATTR = "data-o-history-backfill-button";
  const OVERLAY_ID = "o-history-backfill-overlay";
  const ROUTE_POLL_MS = 750;

  let apolloFailed = false;
  let lastPathname = "";
  let observerStarted = false;

  const state = {
    sceneId: null,
    title: "",
    candidates: [],
    selected: new Set(),
    loading: false,
    saving: false,
    error: "",
  };

  function logError(message, error) {
    console.error(`${PLUGIN_PREFIX} ${message}`, error);
  }

  function getGraphQLUrl() {
    const baseEl = document.querySelector("base");
    let baseURL = baseEl ? baseEl.getAttribute("href") : "/";
    if (!baseURL.endsWith("/")) {
      baseURL += "/";
    }
    return `${baseURL}graphql`;
  }

  function getApolloClient() {
    if (
      apolloFailed ||
      typeof PluginApi === "undefined" ||
      !PluginApi.utils ||
      !PluginApi.utils.StashService ||
      typeof PluginApi.utils.StashService.getClient !== "function" ||
      !PluginApi.libraries ||
      !PluginApi.libraries.Apollo
    ) {
      return null;
    }

    try {
      const { gql } = PluginApi.libraries.Apollo;
      const client = PluginApi.utils.StashService.getClient();
      if (!client || !gql) {
        return null;
      }
      return { client, gql };
    } catch (error) {
      apolloFailed = true;
      console.warn(`${PLUGIN_PREFIX} Apollo unavailable, using direct fetch:`, error?.message || error);
      return null;
    }
  }

  async function graphqlQuery(query, variables = {}) {
    const apollo = getApolloClient();
    if (apollo) {
      try {
        const result = await apollo.client.query({
          query: apollo.gql(query),
          variables,
          fetchPolicy: "no-cache",
        });
        return result.data;
      } catch (error) {
        apolloFailed = true;
        console.warn(`${PLUGIN_PREFIX} Apollo query failed, using direct fetch:`, error?.message || error);
      }
    }

    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.errors) {
      console.error(`${PLUGIN_PREFIX} GraphQL error:`, result.errors);
      throw new Error(result.errors[0].message);
    }

    return result.data;
  }

  async function graphqlMutation(query, variables = {}, update) {
    const apollo = getApolloClient();
    if (apollo) {
      try {
        const result = await apollo.client.mutate({
          mutation: apollo.gql(query),
          variables,
          update,
        });
        return { data: result.data, usedApollo: true };
      } catch (error) {
        apolloFailed = true;
        console.warn(`${PLUGIN_PREFIX} Apollo mutation failed, using direct fetch:`, error?.message || error);
      }
    }

    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.errors) {
      console.error(`${PLUGIN_PREFIX} GraphQL error:`, result.errors);
      throw new Error(result.errors[0].message);
    }

    return { data: result.data, usedApollo: false };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeTimestamp(value) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return value;
    }
    return new Date(parsed).toISOString();
  }

  function formatTimestamp(value) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return value;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(parsed));
  }

  function getSceneIdFromPath() {
    const match = window.location.pathname.match(/^\/scenes\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isScenePage() {
    return Boolean(getSceneIdFromPath());
  }

  function getToolbarContainer() {
    return document.querySelector(".o-history .history-header h5 > span:last-child");
  }

  function getOverlay() {
    return document.getElementById(OVERLAY_ID);
  }

  function closeModal() {
    state.sceneId = null;
    state.title = "";
    state.candidates = [];
    state.selected = new Set();
    state.loading = false;
    state.saving = false;
    state.error = "";

    const overlay = getOverlay();
    if (overlay) {
      overlay.remove();
    }
  }

  function deriveCandidates(playHistory, oHistory) {
    const existing = new Set((oHistory || []).filter(Boolean).map(normalizeTimestamp));
    const seen = new Set();
    const candidates = [];

    for (const rawTime of playHistory || []) {
      if (!rawTime) {
        continue;
      }
      const time = normalizeTimestamp(rawTime);
      if (seen.has(time) || existing.has(time)) {
        continue;
      }
      seen.add(time);
      candidates.push(time);
    }

    return candidates.sort((a, b) => Date.parse(b) - Date.parse(a));
  }

  async function fetchSceneHistory(sceneId) {
    const query = `
      query OHistoryBackfillScene($id: ID!) {
        findScene(id: $id) {
          id
          title
          play_history
          o_history
        }
      }
    `;

    const data = await graphqlQuery(query, { id: sceneId });
    return data?.findScene || null;
  }

  function renderModal() {
    let overlay = getOverlay();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.className = "ohb-overlay";
      document.body.appendChild(overlay);
    }

    const selectedCount = state.selected.size;
    const disabledSave = state.loading || state.saving || selectedCount === 0;
    const candidateMarkup = state.candidates.length
      ? state.candidates.map((time) => `
          <label class="ohb-candidate">
            <input type="checkbox" data-ohb-time="${escapeHtml(time)}" ${state.selected.has(time) ? "checked" : ""} ${state.saving ? "disabled" : ""}>
            <span>${escapeHtml(formatTimestamp(time))}</span>
          </label>
        `).join("")
      : `<div class="ohb-empty">No unmatched watch dates found for this scene.</div>`;

    overlay.innerHTML = `
      <div class="ohb-backdrop" data-ohb-close="true"></div>
      <div class="ohb-modal" role="dialog" aria-modal="true" aria-labelledby="ohb-title">
        <div class="ohb-header">
          <div>
            <h3 id="ohb-title">Backfill O History</h3>
            <div class="ohb-subtitle">${escapeHtml(state.title || `Scene ${state.sceneId || ""}`)}</div>
          </div>
          <button type="button" class="ohb-close" data-ohb-close="true" aria-label="Close">×</button>
        </div>
        <div class="ohb-body">
          <p class="ohb-help">Select prior watch timestamps that should be added to this scene's O history.</p>
          ${state.error ? `<div class="ohb-error">${escapeHtml(state.error)}</div>` : ""}
          <div class="ohb-toolbar">
            <button type="button" class="btn btn-secondary btn-sm" data-ohb-action="select-all" ${state.loading || state.saving || !state.candidates.length ? "disabled" : ""}>Select all</button>
            <button type="button" class="btn btn-secondary btn-sm" data-ohb-action="clear" ${state.loading || state.saving || !selectedCount ? "disabled" : ""}>Clear</button>
            <span class="ohb-count">${selectedCount} selected</span>
          </div>
          ${state.loading ? `<div class="ohb-loading">Loading watch history…</div>` : `<div class="ohb-list">${candidateMarkup}</div>`}
        </div>
        <div class="ohb-footer">
          <button type="button" class="btn btn-secondary" data-ohb-close="true" ${state.saving ? "disabled" : ""}>Cancel</button>
          <button type="button" class="btn btn-primary" data-ohb-action="save" ${disabledSave ? "disabled" : ""}>Add selected dates</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll("[data-ohb-close='true']").forEach((element) => {
      element.addEventListener("click", () => closeModal());
    });

    overlay.querySelectorAll("[data-ohb-time]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const time = event.currentTarget.getAttribute("data-ohb-time");
        if (!time) {
          return;
        }
        if (event.currentTarget.checked) {
          state.selected.add(time);
        } else {
          state.selected.delete(time);
        }
        renderModal();
      });
    });

    const selectAll = overlay.querySelector("[data-ohb-action='select-all']");
    if (selectAll) {
      selectAll.addEventListener("click", () => {
        state.selected = new Set(state.candidates);
        renderModal();
      });
    }

    const clear = overlay.querySelector("[data-ohb-action='clear']");
    if (clear) {
      clear.addEventListener("click", () => {
        state.selected = new Set();
        renderModal();
      });
    }

    const save = overlay.querySelector("[data-ohb-action='save']");
    if (save) {
      save.addEventListener("click", () => saveSelectedDates());
    }
  }

  async function openModal(sceneId) {
    state.sceneId = sceneId;
    state.title = "";
    state.candidates = [];
    state.selected = new Set();
    state.loading = true;
    state.saving = false;
    state.error = "";
    renderModal();

    try {
      const scene = await fetchSceneHistory(sceneId);
      if (!scene) {
        throw new Error("Scene not found");
      }
      if (state.sceneId !== sceneId) {
        return;
      }

      state.title = scene.title || `Scene ${sceneId}`;
      state.candidates = deriveCandidates(scene.play_history, scene.o_history);
      state.selected = new Set(state.candidates);
    } catch (error) {
      if (state.sceneId !== sceneId) {
        return;
      }
      state.error = error?.message || "Failed to load scene history.";
      logError("Failed to load scene history.", error);
    } finally {
      if (state.sceneId !== sceneId) {
        return;
      }
      state.loading = false;
      renderModal();
    }
  }

  async function saveSelectedDates() {
    if (!state.sceneId || !state.selected.size || state.saving) {
      return;
    }

    const sceneId = state.sceneId;
    state.saving = true;
    state.error = "";
    renderModal();

    const times = Array.from(state.selected).sort((a, b) => Date.parse(a) - Date.parse(b));
    const mutation = `
      mutation OHistoryBackfillAddO($id: ID!, $times: [Timestamp!]) {
        sceneAddO(id: $id, times: $times) {
          count
          history
        }
      }
    `;

    try {
      const result = await graphqlMutation(
        mutation,
        { id: sceneId, times },
        (cache, mutationResult) => {
          const history = mutationResult.data?.sceneAddO?.history;
          if (!history) {
            return;
          }

          cache.modify({
            id: cache.identify({ __typename: "Scene", id: sceneId }),
            fields: {
              o_history() {
                return history;
              },
              o_counter() {
                return history.length;
              },
            },
          });
        }
      );

      if (state.sceneId === sceneId) {
        closeModal();
      }

      if (!result.usedApollo) {
        window.location.reload();
      }
    } catch (error) {
      if (state.sceneId !== sceneId) {
        return;
      }
      state.error = error?.message || "Failed to update O history.";
      state.saving = false;
      renderModal();
      logError("Failed to update O history.", error);
      return;
    }
  }

  function createButton(sceneId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary btn-sm ohb-button";
    button.setAttribute(BUTTON_ATTR, "true");
    button.textContent = "Backfill O";
    button.addEventListener("click", () => openModal(sceneId));
    return button;
  }

  function ensureButton() {
    if (!isScenePage()) {
      return;
    }

    const sceneId = getSceneIdFromPath();
    const container = getToolbarContainer();
    if (!sceneId || !container || container.querySelector(`[${BUTTON_ATTR}]`)) {
      return;
    }

    container.prepend(createButton(sceneId));
  }

  function removeDetachedModal() {
    if (state.sceneId && getSceneIdFromPath() !== state.sceneId) {
      closeModal();
    }
  }

  function onRouteOrDomChange() {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
      removeDetachedModal();
    }
    ensureButton();
  }

  function startObserver() {
    if (observerStarted) {
      return;
    }
    observerStarted = true;
    lastPathname = window.location.pathname;

    const observer = new MutationObserver(() => onRouteOrDomChange());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("popstate", onRouteOrDomChange);
    window.setInterval(onRouteOrDomChange, ROUTE_POLL_MS);
    onRouteOrDomChange();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
})();
