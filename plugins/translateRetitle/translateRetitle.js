(function () {
  "use strict";

  const PLUGIN_PREFIX = "[TranslateRetitle]";
  const BUTTON_ATTR = "data-translate-retitle-button";
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

  function onRouteOrDomChange() {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
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
