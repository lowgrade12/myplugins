# Quick Scan & Identify

Configure **Directory A** and **Directory B** under Stash's **Settings > Plugins**, using the paths as seen by the Stash server. The two tasks in **Plugin Tasks** each queue a selective Scan followed by Identify for the same path, then return immediately and let Stash's queue handle execution.

The **Scan & Identify A** and **Scan & Identify B** buttons in the main navigation launch the scan-and-identify sequence directly without opening the Plugin Tasks page, showing popups, or adding messages to the page. Monitor progress in Stash's task queue; launch errors are logged to the browser console.

Identify uses the sources and options saved with **Set as default** in Stash's built-in **Identify** dialog. If no Identify defaults are saved, it uses the first configured Stash-box endpoint with conservative options (skip ambiguous matches and single-name performers, do not mark scenes organized). Without a source, the plugin reports a configuration error before queuing a scan.

Both older Stash versions using `includeMalePerformers` and newer versions using `performerGenders` are supported when loading Identify defaults.

The plugin does not check job IDs or scan status, poll for completion, or log successful launches. Actual request or configuration errors are still reported. Scan and Identify appear as separate jobs; Identify remains queued even if the scan fails or is cancelled. To stop the sequence, cancel both jobs in Stash's queue. Path-based Identify processes unorganized scenes, following Stash's built-in behavior.

Scan tasks use Stash's configured scan defaults. These plugin tasks do not add hooks, modify Stash settings, or replace the built-in Scan and Identify controls.
