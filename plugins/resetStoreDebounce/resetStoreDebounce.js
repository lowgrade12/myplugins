(function () {
  "use strict";

  // Plugin scripts can be re-run (the loader drops and re-adds script tags
  // after a store reset), so only ever install once per page.
  if (window.__resetStoreDebounceLoaded__) return;
  window.__resetStoreDebounceLoaded__ = true;

  // Stash calls client.resetStore() on every ScanCompleteSubscribe event.
  // Calls within WAIT_MS of each other become one reset; a steady stream of
  // calls still resets at least every MAX_WAIT_MS.
  const WAIT_MS = 2000;
  const MAX_WAIT_MS = 10000;
  const POLL_MS = 50;
  const POLL_LIMIT_MS = 30000;

  function install(client) {
    if (client.resetStore.__resetStoreDebounced__) return;

    const original = client.resetStore;
    let timer = null;
    let firstCallAt = 0;
    let waiters = [];

    function flush() {
      clearTimeout(timer);
      timer = null;
      firstCallAt = 0;
      const batch = waiters;
      waiters = [];

      let result;
      try {
        result = Promise.resolve(original.call(client));
      } catch (err) {
        result = Promise.reject(err);
      }
      result.then(
        (value) => batch.forEach((w) => w.resolve(value)),
        (err) => batch.forEach((w) => w.reject(err))
      );
    }

    function debouncedResetStore() {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        const now = Date.now();
        if (!firstCallAt) firstCallAt = now;
        clearTimeout(timer);
        const delay = Math.min(WAIT_MS, firstCallAt + MAX_WAIT_MS - now);
        timer = setTimeout(flush, Math.max(0, delay));
      });
    }

    debouncedResetStore.__resetStoreDebounced__ = true;
    debouncedResetStore.flush = flush;
    client.resetStore = debouncedResetStore;
    console.debug("[resetStoreDebounce] installed");
  }

  function getClient() {
    try {
      return window.PluginApi?.utils?.StashService?.getClient?.() || null;
    } catch (err) {
      return null;
    }
  }

  function tryInstall() {
    const client = getClient();
    if (!client || typeof client.resetStore !== "function") return false;
    install(client);
    return true;
  }

  if (tryInstall()) return;

  const startedAt = Date.now();
  const poll = setInterval(() => {
    if (tryInstall()) {
      clearInterval(poll);
    } else if (Date.now() - startedAt > POLL_LIMIT_MS) {
      clearInterval(poll);
      console.warn("[resetStoreDebounce] Apollo client not found; not installed");
    }
  }, POLL_MS);
})();
