(function () {
  "use strict";

  const PLUGIN_PREFIX = "[TranslateRetitle]";
  const BUTTON_ATTR = "data-translate-retitle-button";
  const BULK_BUTTON_ATTR = "data-translate-retitle-bulk-button";
  const BULK_WRAPPER_ATTR = "data-translate-retitle-bulk-wrapper";
  const ROUTE_POLL_MS = 750;
  const TARGET_LANGUAGE = "en";
  const TRANSLATE_MAX_CHARS = 1200;

  let processing = false;
  let lastPathname = "";
  let observerStarted = false;

  function logError(message, error) {
    console.error(`${PLUGIN_PREFIX} ${message}`, error);
  }

  function normalizeSpace(value) {
    return String(value || "").trim();
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getLabeledField(labelText) {
    const labels = Array.from(document.querySelectorAll("label"));
    const targetLabel = labels.find((label) => normalizeSpace(label.textContent).toLowerCase() === labelText);
    if (!targetLabel) {
      return null;
    }

    const forId = targetLabel.getAttribute("for");
    if (forId) {
      return document.getElementById(forId);
    }

    return targetLabel.closest(".form-group, .input-group, .row")?.querySelector("input, textarea") || targetLabel.parentElement?.querySelector("input, textarea") || null;
  }

  function getDetailsField() {
    const selectors = [
      "textarea[name='details']",
      "textarea#details",
      ".detail-container textarea",
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const match = candidates.find(isVisible);
      if (match) {
        return match;
      }
    }

    return getLabeledField("details");
  }

  function getTitleField() {
    const selectors = [
      "input[name='title']",
      "input#title",
      "input[placeholder='Title']",
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const match = candidates.find(isVisible);
      if (match) {
        return match;
      }
    }

    return getLabeledField("title");
  }

  function getCodeField() {
    const selectors = [
      "input[name='code']",
      "input#code",
      "input[placeholder='Code']",
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const match = candidates.find(isVisible);
      if (match) {
        return match;
      }
    }

    return getLabeledField("code");
  }

  function getFields() {
    const detailsField = getDetailsField();
    const titleField = getTitleField();
    const codeField = getCodeField();

    if (!detailsField || !titleField || !codeField) {
      return null;
    }

    return { detailsField, titleField, codeField };
  }

  function getFieldContainer(field) {
    if (!field) {
      return null;
    }

    return field.closest(".form-group, .row, .form-floating, .mb-3") || field.closest(".input-group")?.parentElement || field.parentElement || null;
  }

  function splitForTranslate(text) {
    const paragraphs = text.split("\n");
    const chunks = [];
    let current = "";

    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n${paragraph}` : paragraph;
      if (candidate.length > TRANSLATE_MAX_CHARS && current) {
        chunks.push(current);
        current = paragraph;
      } else if (candidate.length > TRANSLATE_MAX_CHARS) {
        const words = paragraph.split(" ");
        let wordChunk = "";
        for (const word of words) {
          const wordCandidate = wordChunk ? `${wordChunk} ${word}` : word;
          if (wordCandidate.length > TRANSLATE_MAX_CHARS && wordChunk) {
            chunks.push(wordChunk);
            wordChunk = word;
          } else {
            wordChunk = wordCandidate;
          }
        }
        if (wordChunk) {
          chunks.push(wordChunk);
        }
        current = "";
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks.filter((chunk) => normalizeSpace(chunk));
  }

  async function translateChunk(text) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", TARGET_LANGUAGE);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);

    const response = await fetch(url.toString(), {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Translation request failed: ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      throw new Error("Unexpected translation response format.");
    }

    const translated = payload[0]
      .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
      .join("")
      .trim();

    if (!translated) {
      throw new Error("Translation service returned empty content.");
    }

    return translated;
  }

  async function translateText(text) {
    const chunks = splitForTranslate(text);
    if (!chunks.length) {
      return "";
    }

    const translatedChunks = [];
    for (const chunk of chunks) {
      const translated = await translateChunk(chunk);
      translatedChunks.push(translated);
    }

    return translatedChunks.join("\n");
  }

  async function graphqlQuery(query, variables = {}) {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors[0]?.message || "GraphQL error.");
    }

    if (!payload.data) {
      throw new Error("GraphQL response missing data.");
    }

    return payload.data;
  }

  async function getSceneForBulkWorkflow(sceneId) {
    const query = `
      query FindSceneForTranslateRetitle($id: ID!) {
        findScene(id: $id) {
          id
          title
          details
          code
        }
      }
    `;
    const data = await graphqlQuery(query, { id: sceneId });
    return data.findScene || null;
  }

  async function updateSceneForBulkWorkflow(sceneId, title, details) {
    const mutation = `
      mutation SceneUpdateForTranslateRetitle($input: SceneUpdateInput!) {
        sceneUpdate(input: $input) {
          id
        }
      }
    `;
    await graphqlQuery(mutation, {
      input: {
        id: sceneId,
        title,
        details,
      },
    });
  }

  function setFieldValue(field, value) {
    const prototype = Object.getPrototypeOf(field);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    const previousValue = field.value;

    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    if (field._valueTracker) {
      field._valueTracker.setValue(previousValue);
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function showToast(message, variant = "success") {
    const existing = document.querySelector("[data-translate-retitle-toast]");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.setAttribute("data-translate-retitle-toast", "true");
    toast.className = "toast show";
    toast.style.position = "fixed";
    toast.style.right = "1rem";
    toast.style.bottom = "1rem";
    toast.style.zIndex = "1080";
    toast.style.padding = "0.6rem 0.8rem";
    toast.style.maxWidth = "24rem";
    toast.style.borderRadius = "0.35rem";
    toast.style.background = variant === "error" ? "#a12622" : "#0f5132";
    toast.style.color = "#fff";
    toast.textContent = message;

    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 5000);
  }

  async function runWorkflow(button) {
    if (processing) {
      return;
    }

    const fields = getFields();
    if (!fields) {
      showToast("Open an edit form with Title, Details, and Code first.", "error");
      return;
    }

    const title = normalizeSpace(fields.titleField.value);
    const details = normalizeSpace(fields.detailsField.value);
    const code = normalizeSpace(fields.codeField.value);

    if (!title) {
      showToast("Title is empty.", "error");
      return;
    }

    if (!details) {
      showToast("Details are empty.", "error");
      return;
    }

    if (!code) {
      showToast("Code is empty.", "error");
      return;
    }

    const composedDetails = `${title}\n\n${details}`;

    processing = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Translating…";

    try {
      const translatedDetails = await translateText(composedDetails);
      if (!translatedDetails) {
        throw new Error("Translation returned no content.");
      }

      setFieldValue(fields.detailsField, translatedDetails);
      setFieldValue(fields.titleField, code);
      fields.titleField.focus();

      showToast("Details translated and title replaced with code.");
    } catch (error) {
      logError("Workflow failed.", error);
      showToast(`Automation failed: ${error.message || "Unknown error"}`, "error");
    } finally {
      processing = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function findInjectionTarget(fields) {
    const preferredTargets = [
      getFieldContainer(fields.codeField),
      getFieldContainer(fields.titleField),
      getFieldContainer(fields.detailsField),
    ];

    for (const target of preferredTargets) {
      if (target && isVisible(target)) {
        return target;
      }
    }

    return (
      document.querySelector(".detail-header") ||
      document.querySelector(".detail-container") ||
      null
    );
  }

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary btn-sm";
    button.setAttribute(BUTTON_ATTR, "true");
    button.textContent = "Translate + Retitle";
    button.title = "Translate details to English and replace title with code";
    button.addEventListener("click", () => runWorkflow(button));
    return button;
  }

  function getSelectedSceneIds() {
    const checkedBoxes = Array.from(document.querySelectorAll(".scene-card .card-check:checked"));
    const ids = new Set();

    for (const checkbox of checkedBoxes) {
      const card = checkbox.closest(".scene-card");
      if (!card) {
        continue;
      }

      const link = card.querySelector("a.scene-card-link[href*='/scenes/'], a[href*='/scenes/']");
      const href = link?.getAttribute("href") || "";
      const match = href.match(/\/scenes\/([^/?#]+)/);
      const sceneId = normalizeSpace(match?.[1] || "");
      if (sceneId) {
        ids.add(sceneId);
      }
    }

    return Array.from(ids);
  }

  function createBulkButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary btn-sm";
    button.setAttribute(BULK_BUTTON_ATTR, "true");
    button.title = "Translate details to English and replace title with code for selected scenes";
    button.addEventListener("click", () => runBulkWorkflow(button));
    return button;
  }

  function hasSceneSelectionControls() {
    return Boolean(document.querySelector(".scene-card .card-check"));
  }

  async function runBulkWorkflow(button) {
    if (processing) {
      return;
    }

    const sceneIds = getSelectedSceneIds();
    if (!sceneIds.length) {
      showToast("Select at least one scene first.", "error");
      return;
    }

    const confirmed = window.confirm(`Translate + retitle ${sceneIds.length} selected scene${sceneIds.length === 1 ? "" : "s"}?`);
    if (!confirmed) {
      return;
    }

    processing = true;
    button.disabled = true;
    const originalText = button.textContent;

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (let i = 0; i < sceneIds.length; i += 1) {
        const sceneId = sceneIds[i];
        button.textContent = `Translating ${i + 1}/${sceneIds.length}…`;

        try {
          const scene = await getSceneForBulkWorkflow(sceneId);
          if (!scene) {
            failed += 1;
            continue;
          }

          const title = normalizeSpace(scene.title);
          const details = normalizeSpace(scene.details);
          const code = normalizeSpace(scene.code);
          if (!title || !details || !code) {
            skipped += 1;
            continue;
          }

          const composedDetails = `${title}\n\n${details}`;
          const translatedDetails = await translateText(composedDetails);
          if (!translatedDetails) {
            failed += 1;
            continue;
          }

          await updateSceneForBulkWorkflow(sceneId, code, translatedDetails);
          updated += 1;
        } catch (error) {
          failed += 1;
          logError(`Bulk workflow failed for scene ${sceneId}.`, error);
        }
      }

      const summary = `Done. Updated ${updated}/${sceneIds.length} scene${sceneIds.length === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}${failed ? `, failed ${failed}` : ""}.`;
      showToast(summary, failed ? "error" : "success");
    } finally {
      processing = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function ensureButton() {
    const fields = getFields();
    if (!fields) {
      return;
    }

    const target = findInjectionTarget(fields);
    if (!target || target.querySelector(`[${BUTTON_ATTR}]`)) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.style.marginTop = "0.5rem";
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "flex-end";
    wrapper.appendChild(createButton());

    target.appendChild(wrapper);
  }

  function ensureBulkButton() {
    const hasSelectionUi = hasSceneSelectionControls();
    const selectedCount = getSelectedSceneIds().length;
    const existing = document.querySelector(`[${BULK_BUTTON_ATTR}]`);
    const existingWrapper = document.querySelector(`[${BULK_WRAPPER_ATTR}]`);

    if (!hasSelectionUi) {
      if (existingWrapper) {
        existingWrapper.remove();
      }
      return;
    }

    let button = existing;
    if (!button) {
      const wrapper = document.createElement("div");
      wrapper.style.position = "fixed";
      wrapper.style.right = "1rem";
      wrapper.style.bottom = "4.5rem";
      wrapper.style.zIndex = "1080";
      wrapper.style.display = "flex";
      wrapper.style.gap = "0.5rem";
      wrapper.setAttribute(BULK_WRAPPER_ATTR, "true");

      button = createBulkButton();
      wrapper.appendChild(button);
      document.body.appendChild(wrapper);
    }

    const buttonLabel = selectedCount ? `Translate Selected (${selectedCount})` : "Translate Selected Scenes";
    if (button.textContent !== buttonLabel) {
      button.textContent = buttonLabel;
    }

    const shouldDisable = processing || !selectedCount;
    if (button.disabled !== shouldDisable) {
      button.disabled = shouldDisable;
    }
  }

  function onRouteOrDomChange() {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
    }
    ensureButton();
    ensureBulkButton();
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
