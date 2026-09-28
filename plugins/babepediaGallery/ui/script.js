(function () {
  "use strict";

  const PLUGIN_ID = "babepediaGallery";
  const TASK_NAME = "Open Babepedia";
  const CACHE_BASE = "/plugin/" + PLUGIN_ID + "/assets/cache";

  let babepediaActive = false;
  let currentPerformerName = null;
  let currentTargetPerformer = null;
  let currentBabepediaPerformer = null;
  let lastSearchQuery = "";
  let autoLoadedPerformerId = null;
  let activePerformerPageId = null;
  let injectScheduled = false;
  let observerStarted = false;
  const selectedUrls = new Set();

  function escapeHtml(value) {
    if (value === null || typeof value === "undefined") {
      value = "";
    }

    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function makeRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID().replace(/-/g, "");
    }

    return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
  }

  async function parseJsonResponse(response, action) {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        String(action || "Request")
        + " failed with HTTP "
        + String(response.status)
        + (body ? ": " + body.slice(0, 400) : ".")
      );
    }

    return response.json();
  }

  async function runTask(args) {
    const query = `
      mutation RunBabepedia(
        $plugin_id: ID!,
        $task_name: String!,
        $args_map: Map
      ) {
        runPluginTask(
          plugin_id: $plugin_id,
          task_name: $task_name,
          args_map: $args_map
        )
      }
    `;

    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        query: query,
        variables: {
          plugin_id: PLUGIN_ID,
          task_name: TASK_NAME,
          args_map: args
        }
      })
    });

    const result = await parseJsonResponse(response, "Babepedia task request");

    if (result.errors && result.errors.length) {
      throw new Error(result.errors.map(function (error) {
        return error.message;
      }).join(", "));
    }

    if (!result.data) {
      throw new Error("Stash returned no task data.");
    }

    return result.data.runPluginTask;
  }

  async function fetchCacheFile(url) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function waitForCache(requestId, timeoutMs, onProgress) {
    const started = Date.now();
    const maxWait = timeoutMs || 1800000;
    let lastSignature = "";

    while (Date.now() - started < maxWait) {
      const finalData = await fetchCacheFile(
        CACHE_BASE + "/" + encodeURIComponent(requestId) + ".json"
      );

      if (finalData) {
        if (finalData.status === "error") {
          throw new Error(finalData.error || "Babepedia task failed.");
        }

        if (finalData.status !== "pending") {
          return finalData;
        }
      }

      if (typeof onProgress === "function") {
        const progress = await fetchCacheFile(
          CACHE_BASE + "/" + encodeURIComponent(requestId) + ".progress.json"
        );

        if (progress) {
          const signature = JSON.stringify(progress);

          if (signature !== lastSignature) {
            lastSignature = signature;
            onProgress(progress);
          }
        }
      }

      await new Promise(function (resolve) {
        setTimeout(resolve, 450);
      });
    }

    throw new Error("Timeout while waiting for the Babepedia task.");
  }

  async function requestData(args, onProgress, timeoutMs) {
    const requestId = makeRequestId();
    const taskArgs = Object.assign({}, args, {
      request_id: requestId
    });

    await runTask(taskArgs);
    return waitForCache(requestId, timeoutMs || 1800000, onProgress);
  }

  async function queryJob(jobId) {
    const query = `
      query BabepediaFindJob($input: FindJobInput!) {
        findJob(input: $input) {
          id
          status
          description
          progress
          error
        }
      }
    `;

    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        query: query,
        variables: {
          input: {
            id: jobId
          }
        }
      })
    });

    const result = await parseJsonResponse(response, "Stash job lookup");

    if (result.errors && result.errors.length) {
      throw new Error(result.errors.map(function (error) {
        return error.message;
      }).join(", "));
    }

    return result.data ? result.data.findJob : null;
  }

  async function waitForJob(jobId, onUpdate) {
    const started = Date.now();
    const timeoutMs = 30 * 60 * 1000;

    while (Date.now() - started < timeoutMs) {
      const job = await queryJob(jobId);

      if (job) {
        if (typeof onUpdate === "function") {
          onUpdate(job);
        }

        if (job.status === "FINISHED") {
          return job;
        }

        if (job.status === "FAILED" || job.status === "CANCELLED") {
          throw new Error(job.error || "Stash scan did not finish successfully.");
        }
      }

      await new Promise(function (resolve) {
        setTimeout(resolve, 1000);
      });
    }

    throw new Error("Timeout while waiting for the Stash scan.");
  }

  function currentPerformerIdFromUrl() {
    const match = window.location.pathname.match(/^\/performers\/([^/]+)(?:\/|$)/);

    if (!match || !match[1]) {
      return null;
    }

    return match[1];
  }

  async function fetchPerformerById(performerId) {
    if (!performerId) {
      return null;
    }

    const query = `
      query BabepediaCurrentPerformer($id: ID!) {
        findPerformer(id: $id) {
          id
          name
        }
      }
    `;

    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        query: query,
        variables: {
          id: performerId
        }
      })
    });

    const result = await parseJsonResponse(response, "Current performer lookup");

    if (result.errors && result.errors.length) {
      throw new Error(result.errors.map(function (error) {
        return error.message;
      }).join(", "));
    }

    return result.data ? result.data.findPerformer : null;
  }

  async function currentPerformer() {
    const performerId = currentPerformerIdFromUrl();

    if (performerId) {
      try {
        const performer = await fetchPerformerById(performerId);

        if (performer && performer.name) {
          currentPerformerName = performer.name.trim();
          currentTargetPerformer = {
            id: performer.id,
            name: performer.name.trim()
          };
          return currentTargetPerformer;
        }
      } catch (error) {
        console.warn("[Babepedia] Could not load performer name from GraphQL", error);
      }
    }

    const selectors = [
      ".detail-header h2",
      ".detail-header h3",
      ".performer-head h2",
      ".performer-head h3",
      ".performer-name"
    ];

    for (let index = 0; index < selectors.length; index += 1) {
      const element = document.querySelector(selectors[index]);

      if (element && element.textContent && element.textContent.trim()) {
        currentPerformerName = element.textContent.trim();
        currentTargetPerformer = {
          id: performerId,
          name: currentPerformerName
        };
        return currentTargetPerformer;
      }
    }

    return null;
  }

  function performerTabsNav() {
    return document.querySelector("nav.nav.nav-tabs");
  }

  function nativeContentRoot() {
    const panes = document.querySelectorAll('[id^="performer-tabs-tabpane-"]');

    for (let index = 0; index < panes.length; index += 1) {
      const pane = panes[index];
      const parent = pane.parentElement;

      if (parent && parent.classList.contains("tab-content")) {
        return parent;
      }

      const closest = pane.closest(".tab-content");

      if (closest) {
        return closest;
      }
    }

    return null;
  }

  function hideNativePerformerContent(root) {
    if (root) {
      root.style.display = "none";
    }
  }

  function showNativePerformerContent(root) {
    if (root) {
      root.style.display = "";
    }
  }

  function ensureMount() {
    let mount = document.getElementById("babepedia-plugin-root");
    const nativeContent = nativeContentRoot();

    if (!nativeContent) {
      return mount;
    }

    if (!mount) {
      mount = document.createElement("div");
      mount.id = "babepedia-plugin-root";
      mount.className = "babepedia-plugin-root";
      mount.style.display = "none";
      nativeContent.insertAdjacentElement("beforebegin", mount);
    } else if (mount.nextElementSibling !== nativeContent) {
      nativeContent.insertAdjacentElement("beforebegin", mount);
    }

    if (babepediaActive) {
      hideNativePerformerContent(nativeContent);
      mount.style.display = "block";
    }

    return mount;
  }

  function contentRoot() {
    return ensureMount();
  }

  function setStatus(text, variant) {
    const root = contentRoot();

    if (!root) {
      return;
    }

    let box = root.querySelector(".babepedia-status");

    if (!box) {
      box = document.createElement("div");
      box.className = "babepedia-status";
      root.insertBefore(box, root.firstChild || null);
    }

    box.className = "babepedia-status" + (variant ? " babepedia-status-" + variant : "");
    box.textContent = text || "";
    box.style.display = text ? "block" : "none";
  }

  function activateBabepediaView() {
    babepediaActive = true;
    const nativeContent = nativeContentRoot();
    const mount = ensureMount();

    hideNativePerformerContent(nativeContent);

    if (mount) {
      mount.style.display = "block";
    }
  }

  function deactivateBabepediaView() {
    babepediaActive = false;
    const nativeContent = nativeContentRoot();
    const mount = document.getElementById("babepedia-plugin-root");

    showNativePerformerContent(nativeContent);

    if (mount) {
      mount.style.display = "none";
    }
  }

  function metadataRows(performer) {
    const rows = [];
    const labels = {
      birthdate: "Birthdate",
      country: "Country",
      ethnicity: "Ethnicity",
      eye_color: "Eye color",
      hair_color: "Hair color",
      height_cm: "Height",
      weight: "Weight",
      measurements: "Measurements",
      fake_tits: "Breast type",
      tattoos: "Tattoos",
      piercings: "Piercings"
    };

    Object.keys(labels).forEach(function (key) {
      const value = performer[key];

      if (value === null || typeof value === "undefined" || value === "") {
        return;
      }

      let display = String(value);

      if (key === "height_cm") {
        display += " cm";
      }

      if (key === "weight") {
        display += " kg";
      }

      rows.push(
        '<div class="babepedia-meta-row"><span class="babepedia-meta-label">'
        + escapeHtml(labels[key])
        + '</span><span class="babepedia-meta-value">'
        + escapeHtml(display)
        + "</span></div>"
      );
    });

    return rows.join("");
  }

  function selectionCountText() {
    return String(selectedUrls.size) + (selectedUrls.size === 1 ? " image selected" : " images selected");
  }

  function renderSearchResults(results) {
    const root = contentRoot();

    if (!root) {
      return;
    }

    const resultsHtml = (results || []).map(function (item) {
      return (
        '<button class="babepedia-result" data-url="'
        + escapeHtml(item.url)
        + '"><span class="babepedia-result-name">'
        + escapeHtml(item.name)
        + '</span><span class="babepedia-result-url">'
        + escapeHtml(item.url)
        + "</span></button>"
      );
    }).join("");

    root.innerHTML = ''
      + '<div class="babepedia-browser">'
      + '  <div class="babepedia-header">'
      + '    <div>'
      + '      <div class="babepedia-eyebrow">Babepedia importer</div>'
      + '      <h2>Search Babepedia</h2>'
      + '      <p class="babepedia-subtitle">Search a performer, open a profile, and import selected images into the current Stash performer.</p>'
      + '    </div>'
      + '  </div>'
      + '  <form class="babepedia-search-form">'
      + '    <input class="babepedia-search-input" name="query" placeholder="Search Babepedia performer" value="'
      + escapeHtml(lastSearchQuery)
      + '">'
      + '    <button class="babepedia-button babepedia-button-primary" type="submit">Search</button>'
      + '  </form>'
      + '  <div class="babepedia-target">Target performer: '
      + escapeHtml(currentTargetPerformer && currentTargetPerformer.name ? currentTargetPerformer.name : "Unknown")
      + '  </div>'
      + '  <div class="babepedia-results">'
      + (resultsHtml || '<div class="babepedia-empty">No performers found.</div>')
      + '  </div>'
      + '</div>';

    attachSearchForm();
    root.querySelectorAll(".babepedia-result").forEach(function (button) {
      button.addEventListener("click", function () {
        loadBabepediaPerformer(button.getAttribute("data-url"));
      });
    });
    setStatus("", "");
  }

  function renderPerformer(performer) {
    const root = contentRoot();

    if (!root || !performer) {
      return;
    }

    const aliases = (performer.aliases || []).length
      ? '<div class="babepedia-aliases">Also known as: ' + escapeHtml((performer.aliases || []).join(", ")) + '</div>'
      : "";

    const imagesHtml = (performer.images || []).map(function (image, index) {
      const checked = selectedUrls.has(image.url);
      return ''
        + '<article class="babepedia-card' + (checked ? ' babepedia-is-selected' : '') + '" data-url="' + escapeHtml(image.url) + '">'
        + '  <button class="babepedia-image-button" type="button" data-url="' + escapeHtml(image.url) + '">'
        + '    <img loading="lazy" src="' + escapeHtml(image.thumbnail || image.url) + '" alt="Babepedia image ' + String(index + 1) + '">'
        + '  </button>'
        + '  <label class="babepedia-select-row">'
        + '    <input class="babepedia-select" type="checkbox" data-url="' + escapeHtml(image.url) + '"' + (checked ? ' checked' : '') + '>'
        + '    <span>Select image ' + String(index + 1) + '</span>'
        + '  </label>'
        + '</article>';
    }).join("");

    root.innerHTML = ''
      + '<div class="babepedia-browser">'
      + '  <div class="babepedia-header">'
      + '    <div>'
      + '      <div class="babepedia-eyebrow">Babepedia performer</div>'
      + '      <h2>' + escapeHtml(performer.name || "Babepedia performer") + '</h2>'
      +        aliases
      + '      <p class="babepedia-subtitle"><a href="' + escapeHtml(performer.url) + '" target="_blank" rel="noopener noreferrer">Open on Babepedia</a></p>'
      + '    </div>'
      + '    <div class="babepedia-badge">' + escapeHtml(String((performer.images || []).length)) + ' images</div>'
      + '  </div>'
      + '  <form class="babepedia-search-form">'
      + '    <input class="babepedia-search-input" name="query" placeholder="Search another Babepedia performer" value="'
      + escapeHtml(lastSearchQuery)
      + '">'
      + '    <button class="babepedia-button babepedia-button-primary" type="submit">Search</button>'
      + '  </form>'
      + '  <div class="babepedia-target">Target performer: '
      + escapeHtml(currentTargetPerformer && currentTargetPerformer.name ? currentTargetPerformer.name : "Unknown")
      + '  </div>'
      + '  <div class="babepedia-layout">'
      + '    <aside class="babepedia-sidebar">'
      +        metadataRows(performer)
      + '    </aside>'
      + '    <section class="babepedia-main">'
      + '      <div class="babepedia-toolbar">'
      + '        <div class="babepedia-selection-count">' + escapeHtml(selectionCountText()) + '</div>'
      + '        <div class="babepedia-toolbar-actions">'
      + '          <button class="babepedia-button" type="button" data-action="select-all">Select all</button>'
      + '          <button class="babepedia-button" type="button" data-action="clear-selection">Clear</button>'
      + '          <button class="babepedia-button babepedia-button-primary" type="button" data-action="import">Import selected</button>'
      + '        </div>'
      + '      </div>'
      + '      <div class="babepedia-grid">'
      +         imagesHtml
      + '      </div>'
      + '    </section>'
      + '  </div>'
      + '</div>';

    attachSearchForm();
    attachPerformerActions();
    setStatus("", "");
  }

  function renderLanding() {
    renderSearchResults([]);
    setStatus("Open the Babepedia tab to search for a performer.", "info");
  }

  function attachSearchForm() {
    const root = contentRoot();

    if (!root) {
      return;
    }

    const form = root.querySelector(".babepedia-search-form");

    if (!form) {
      return;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const input = form.querySelector(".babepedia-search-input");
      runSearch(input ? input.value : "");
    });
  }

  function attachPerformerActions() {
    const root = contentRoot();

    if (!root) {
      return;
    }

    root.querySelectorAll(".babepedia-select").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const url = checkbox.getAttribute("data-url");

        if (!url) {
          return;
        }

        if (checkbox.checked) {
          selectedUrls.add(url);
        } else {
          selectedUrls.delete(url);
        }

        renderPerformer(currentBabepediaPerformer);
      });
    });

    root.querySelectorAll(".babepedia-image-button").forEach(function (button) {
      button.addEventListener("click", function () {
        const url = button.getAttribute("data-url");

        if (!url) {
          return;
        }

        if (selectedUrls.has(url)) {
          selectedUrls.delete(url);
        } else {
          selectedUrls.add(url);
        }

        renderPerformer(currentBabepediaPerformer);
      });
    });

    root.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        const action = button.getAttribute("data-action");

        if (action === "select-all") {
          selectedUrls.clear();
          (currentBabepediaPerformer.images || []).forEach(function (image) {
            if (image.url) {
              selectedUrls.add(image.url);
            }
          });
          renderPerformer(currentBabepediaPerformer);
          return;
        }

        if (action === "clear-selection") {
          selectedUrls.clear();
          renderPerformer(currentBabepediaPerformer);
          return;
        }

        if (action === "import") {
          importSelection();
        }
      });
    });
  }

  function formatProgress(progress) {
    const parts = [progress.message || "Working..."];

    if (typeof progress.current !== "undefined" && typeof progress.total !== "undefined") {
      parts.push("(" + String(progress.current) + "/" + String(progress.total) + ")");
    }

    if (progress.detail) {
      parts.push("· " + progress.detail);
    }

    return parts.join(" ");
  }

  async function runSearch(query) {
    query = String(query || "").trim();

    if (query.length < 2) {
      setStatus("Enter at least 2 characters to search Babepedia.", "warning");
      return;
    }

    lastSearchQuery = query;
    setStatus("Searching Babepedia…", "info");

    try {
      const data = await requestData({
        mode: "search_performer",
        query: query
      }, function (progress) {
        setStatus(formatProgress(progress), "info");
      }, 90000);

      const results = data.results || [];

      if (!results.length) {
        renderSearchResults([]);
        setStatus("No Babepedia performers matched that search.", "warning");
        return;
      }

      const exact = results.find(function (item) {
        return String(item.name || "").trim().toLowerCase() === query.toLowerCase();
      });

      if (exact) {
        await loadBabepediaPerformer(exact.url);
        return;
      }

      renderSearchResults(results);
      setStatus("Choose a Babepedia performer result.", "info");
    } catch (error) {
      console.error("[Babepedia] Search failed", error);
      setStatus(error.message || "Babepedia search failed.", "error");
    }
  }

  async function loadBabepediaPerformer(url) {
    const performerId = currentTargetPerformer && currentTargetPerformer.id ? currentTargetPerformer.id : currentPerformerIdFromUrl();

    if (!performerId) {
      setStatus("Could not determine the current Stash performer.", "error");
      return;
    }

    selectedUrls.clear();
    setStatus("Loading Babepedia performer…", "info");

    try {
      const data = await requestData({
        mode: "load_performer",
        url: url,
        performer_id: performerId
      }, function (progress) {
        setStatus(formatProgress(progress), "info");
      }, 180000);

      currentBabepediaPerformer = data.performer || null;

      if (data.target_performer) {
        currentTargetPerformer = data.target_performer;
      }

      if (!currentBabepediaPerformer) {
        throw new Error("Babepedia performer data was empty.");
      }

      renderPerformer(currentBabepediaPerformer);
      setStatus("Loaded Babepedia performer.", "success");
    } catch (error) {
      console.error("[Babepedia] Performer load failed", error);
      setStatus(error.message || "Babepedia performer load failed.", "error");
    }
  }

  async function importSelection() {
    if (!currentBabepediaPerformer || !currentBabepediaPerformer.url) {
      setStatus("Load a Babepedia performer first.", "warning");
      return;
    }

    if (!currentTargetPerformer || !currentTargetPerformer.id) {
      setStatus("Could not determine the active Stash performer.", "error");
      return;
    }

    const selection = Array.from(selectedUrls.values()).map(function (url) {
      return { url: url };
    });

    if (!selection.length) {
      setStatus("Select at least one Babepedia image to import.", "warning");
      return;
    }

    try {
      setStatus("Checking selected images…", "info");
      const preflight = await requestData({
        mode: "preflight_import",
        performer_id: currentTargetPerformer.id,
        performer_url: currentBabepediaPerformer.url,
        selection_json: JSON.stringify(selection)
      }, function (progress) {
        setStatus(formatProgress(progress), "info");
      }, 180000);

      const proceed = window.confirm(
        "Import "
        + String(preflight.selection_count || selection.length)
        + " Babepedia image(s) for "
        + String(currentTargetPerformer.name || "this performer")
        + "?\n\n"
        + "Existing in Stash: " + String(preflight.existing_count || 0)
        + "\nReusable local files: " + String(preflight.reusable_file_count || 0)
        + "\nNew downloads: " + String(preflight.new_count || 0)
      );

      if (!proceed) {
        setStatus("Import cancelled.", "info");
        return;
      }

      setStatus("Preparing import…", "info");
      const prepared = await requestData({
        mode: "prepare_import",
        performer_id: currentTargetPerformer.id,
        performer_url: currentBabepediaPerformer.url,
        selection_json: JSON.stringify(selection)
      }, function (progress) {
        setStatus(formatProgress(progress), "info");
      }, 1800000);

      if (prepared.scan_job_id) {
        setStatus("Waiting for the Stash scan…", "info");
        await waitForJob(prepared.scan_job_id, function (job) {
          const progress = typeof job.progress === "number"
            ? Math.round(job.progress * 100) + "%"
            : job.status;
          setStatus("Waiting for the Stash scan… " + progress, "info");
        });
      }

      setStatus("Finalizing imported metadata…", "info");
      const finalized = await requestData({
        mode: "finalize_import",
        import_id: prepared.import_id
      }, function (progress) {
        setStatus(formatProgress(progress), "info");
      }, 1800000);

      const message = [];
      message.push("Imported metadata for " + String(finalized.updated_count || 0) + " image(s).");

      if (prepared.failed_count) {
        message.push(String(prepared.failed_count) + " download(s) were skipped.");
      }

      if (finalized.missing_count) {
        message.push(String(finalized.missing_count) + " image(s) were not found after scan.");
      }

      if (finalized.performer_updated) {
        message.push("Performer metadata was updated.");
      }
      if (finalized.gallery_id) {
        message.push("Images were added to gallery \"" + String(finalized.gallery_title || finalized.gallery_id) + "\".");
      }

      setStatus(message.join(" "), "success");
    } catch (error) {
      console.error("[Babepedia] Import failed", error);
      setStatus(error.message || "Babepedia import failed.", "error");
    }
  }

  async function openForCurrentPerformer() {
    activateBabepediaView();
    renderLanding();

    const performer = await currentPerformer();

    if (!performer || !performer.name) {
      setStatus("Could not determine the active Stash performer.", "error");
      return;
    }

    if (autoLoadedPerformerId === performer.id && currentBabepediaPerformer) {
      renderPerformer(currentBabepediaPerformer);
      return;
    }

    autoLoadedPerformerId = performer.id;
    lastSearchQuery = performer.name;
    await runSearch(performer.name);
  }

  function scheduleInject() {
    if (injectScheduled) {
      return;
    }

    injectScheduled = true;
    window.requestAnimationFrame(function () {
      injectScheduled = false;
      inject();
    });
  }

  function startObserver() {
    if (observerStarted) {
      return;
    }

    observerStarted = true;

    if (window.history && !window.history.__babepediaPatched) {
      window.history.__babepediaPatched = true;

      ["pushState", "replaceState"].forEach(function (methodName) {
        const original = window.history[methodName];

        if (typeof original !== "function") {
          return;
        }

        window.history[methodName] = function () {
          const result = original.apply(this, arguments);
          window.dispatchEvent(new Event("babepedia:routechange"));
          return result;
        };
      });
    }

    window.addEventListener("popstate", scheduleInject);
    window.addEventListener("babepedia:routechange", scheduleInject);

    if (document.body) {
      const observer = new MutationObserver(function () {
        scheduleInject();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  function inject() {
    const performerId = currentPerformerIdFromUrl();

    if (!performerId) {
      activePerformerPageId = null;
      autoLoadedPerformerId = null;
      currentPerformerName = null;
      currentTargetPerformer = null;
      currentBabepediaPerformer = null;
      lastSearchQuery = "";
      selectedUrls.clear();
      deactivateBabepediaView();
      return;
    }

    if (activePerformerPageId !== performerId) {
      activePerformerPageId = performerId;
      autoLoadedPerformerId = null;
      currentPerformerName = null;
      currentTargetPerformer = null;
      currentBabepediaPerformer = null;
      lastSearchQuery = "";
      selectedUrls.clear();
    }

    ensureMount();

    if (document.getElementById("performer-tabs-tab-babepedia")) {
      return;
    }

    const tabs = performerTabsNav();

    if (!tabs) {
      return;
    }

    const tab = document.createElement("a");
    tab.id = "performer-tabs-tab-babepedia";
    tab.href = "#";
    tab.className = "nav-item nav-link";
    tab.innerText = "Babepedia";
    tab.addEventListener("click", function (event) {
      event.preventDefault();
      document.querySelectorAll("nav.nav-tabs .nav-link").forEach(function (item) {
        item.classList.remove("active");
      });
      tab.classList.add("active");
      openForCurrentPerformer();
    });

    const imagesTab = document.getElementById("performer-tabs-tab-images");

    if (imagesTab) {
      imagesTab.insertAdjacentElement("afterend", tab);
    } else {
      tabs.appendChild(tab);
    }
  }

  document.addEventListener("click", function (event) {
    const tabs = performerTabsNav();

    if (!tabs) {
      return;
    }

    const tab = event.target.closest(".nav-link");

    if (!tab || !tabs.contains(tab)) {
      return;
    }

    if (tab.id === "performer-tabs-tab-babepedia") {
      return;
    }

    deactivateBabepediaView();

    const babepediaTab = document.getElementById("performer-tabs-tab-babepedia");

    if (babepediaTab) {
      babepediaTab.classList.remove("active");
    }
  }, true);

  startObserver();
  scheduleInject();
})();
