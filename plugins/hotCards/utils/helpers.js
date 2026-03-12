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
  const maxRetries = 30; // Timeout after 3 seconds
  let retryCount = 0;
  let intervalId;

  function checkElements() {
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

function waitForImageLoad(imageEl, callback) {
  if (imageEl.complete) return callback(imageEl);
  setTimeout(waitForImageLoad, 100, imageEl, callback);
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
    checkConfigurationRefresh().then(() => {
      if (regex.test(window.location.pathname)) callback();
    });
  }

  onPathChange(checkURL);

  // Initial check
  checkURL();
}
