# Reset Store Debounce

Stash resets its whole Apollo store (`client.resetStore()`) every time a scan finishes. Each reset refetches every active query, briefly blanks the page, and makes the plugin loader drop and re-add plugin scripts. When many scans finish close together (identify, Whisparr imports, Quick Scan, plugin jobs), you see the page refresh over and over.

This plugin wraps `client.resetStore` so that calls arriving within **2 s** of each other result in **one** real reset (trailing debounce). A steady stream of calls still resets at least every **10 s**. Every caller gets a promise that settles when that one reset finishes. `clearStore` is not touched, and Stash itself is not modified.

## Trade-off

After a scan finishes, data on the page refreshes up to about **2 s later** than before (up to 10 s during a long burst). Anything else in Stash that calls `resetStore()` is delayed the same way.

## Install

Install **Reset Store Debounce** from this repository's plugin source and reload the page. No settings. The console shows `[resetStoreDebounce] installed` at debug level once the wrapper is in place. The plugin installs once per page; re-running the script does nothing.

To turn it off, disable the plugin and reload.

## Manual test plan

1. Open Stash with the plugin enabled, then open DevTools on the **Network** tab (filter: `graphql`) and the **Console**.
2. Confirm the wrapper is installed:
   ```js
   PluginApi.utils.StashService.getClient().resetStore.__resetStoreDebounced__ // true
   ```
3. Call `resetStore()` 5 times, 150 ms apart:
   ```js
   const c = PluginApi.utils.StashService.getClient();
   const t0 = performance.now();
   const ps = [];
   for (let i = 0; i < 5; i++) {
     ps.push(c.resetStore());
     await new Promise((r) => setTimeout(r, 150));
   }
   await Promise.all(ps);
   console.log("all settled after", Math.round(performance.now() - t0), "ms");
   ```
4. Expect:
   - **One** burst of GraphQL refetches about 2 s after the last call, not five.
   - The page blanks/redraws once at most, not five times.
   - All five promises settle together (logged time ≈ 600 ms + 2000 ms).
5. Optional: run a Quick Scan or Identify on many scenes and confirm the page refreshes in a few spaced-out steps instead of continuously.
