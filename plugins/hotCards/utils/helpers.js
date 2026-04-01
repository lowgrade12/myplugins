(function () {
  "use strict";

  const _hc = window._hotCards = window._hotCards || {};

  /** General */

  function getRandomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function getFixedBackgroundOpacity(opacity) {
    return parseFloat((1 - opacity / 100).toFixed(1));
  }

  /** Elements */

  function waitForClass(className, callback) {
    const checkInterval = 100; // ms
    const maxRetries = 100; // Timeout after 10 seconds
    let retryCount = 0;
    let intervalId;
    // Capture pathname at start so we can cancel if SPA navigation occurs via pushState/replaceState
    const startPathname = window.location.pathname;

    function checkElements() {
      // Cancel if the URL path changed (SPA navigation that bypasses popstate)
      if (window.location.pathname !== startPathname) {
        clearAll();
        return;
      }
      const elements = document.getElementsByClassName(className);
      if (elements.length > 0) {
        clearAll();
        callback();
      } else if (retryCount >= maxRetries) {
        clearAll();
        console.info(
          `Element with class "${className}" not found within timeout period`
        );
      }
      retryCount++;
    }

    function clearAll() {
      clearInterval(intervalId);
      removeEventListeners();
    }

    function clear() {
      console.info(
        `Element with class "${className}" search cancelled due to page change`
      );
      clearAll();
    }

    function addEventListeners() {
      document.addEventListener("visibilitychange", clear);
      window.addEventListener("beforeunload", clear);
      window.addEventListener("popstate", clear);
    }

    function removeEventListeners() {
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("beforeunload", clear);
      window.removeEventListener("popstate", clear);
    }

    // Start the interval and add event listeners
    intervalId = setInterval(checkElements, checkInterval);
    addEventListeners();
  }

  function waitForImageLoad(imageEl, callback, retries = 0) {
    const maxRetries = 50; // Give up after 5 seconds to prevent infinite recursion
    if (imageEl.complete) return callback(imageEl);
    if (retries >= maxRetries) return;
    setTimeout(waitForImageLoad, 100, imageEl, callback, retries + 1);
  }

  function createElementFromHTML(htmlString) {
    const div = document.createElement("div");
    div.innerHTML = htmlString.trim();
    return div.firstChild;
  }

  function isCardInitialized(element, type) {
    return element.querySelector(`div>.${type}-card`);
  }

  /** History */

  const pathChangeCallbacks = [];
  let pathChangeInitialized = false;

  /**
   * Register a callback to be invoked on any path change
   * (pushState, replaceState, or popstate).
   * History methods are only wrapped once regardless of how many callbacks are registered.
   * @param {Function} callback - Function to invoke whenever the URL path changes.
   */
  function onPathChange(callback) {
    pathChangeCallbacks.push(callback);

    if (pathChangeInitialized) return;
    pathChangeInitialized = true;

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function () {
        const result = original.apply(this, arguments);
        pathChangeCallbacks.forEach((cb) => cb());
        return result;
      };
    });

    window.addEventListener("popstate", function () {
      pathChangeCallbacks.forEach((cb) => cb());
    });
  }

  /** Path Change Listener */

  function registerPathChangeListener(pattern, callback) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);

    function checkURL() {
      if (_hc.checkConfigurationRefresh) {
        _hc.checkConfigurationRefresh().then(() => {
          if (regex.test(window.location.pathname)) callback();
        });
      } else {
        if (regex.test(window.location.pathname)) callback();
      }
    }

    onPathChange(checkURL);

    // Initial check
    checkURL();
  }

  // Export shared references for other hotCards files
  _hc.getRandomInt = getRandomInt;
  _hc.getFixedBackgroundOpacity = getFixedBackgroundOpacity;
  _hc.waitForClass = waitForClass;
  _hc.waitForImageLoad = waitForImageLoad;
  _hc.createElementFromHTML = createElementFromHTML;
  _hc.isCardInitialized = isCardInitialized;
  _hc.onPathChange = onPathChange;
  _hc.registerPathChangeListener = registerPathChangeListener;
})();
