# Quick Scan & Identify

Configure **Directory A** and **Directory B** under Stash's **Settings > Plugins**, using the paths as seen by the Stash server. The two tasks in **Plugin Tasks** each queue a selective scan and a short continuation task. Stash runs these in order; the continuation queues Identify for the same path only if the scan finished successfully.

The **Scan & Identify A** and **Scan & Identify B** buttons in the main navigation launch the scan-and-identify sequence directly without opening the Plugin Tasks page or showing an OK popup. Status or configuration errors appear below the clicked button; success is shown only after the scan and its identify continuation have been queued.

Identify uses the sources and options saved with **Set as default** in Stash's built-in **Identify** dialog. If no Identify defaults are saved, it uses the first configured Stash-box endpoint with conservative options (skip ambiguous matches and single-name performers, do not mark scenes organized). Without a source, the plugin reports a configuration error before queuing a scan.

Both older Stash versions using `includeMalePerformers` and newer versions using `performerGenders` are supported when loading Identify defaults.

The launcher finishes promptly so Stash's job queue can run the scan. Do not cancel it to start scanning. Scan and Identify appear as separate jobs; failed or cancelled scans do not trigger Identify. If you want to stop the sequence, cancel the queued continuation as well as the scan. Path-based Identify processes unorganized scenes, following Stash's built-in behavior.

Scan tasks use Stash's configured scan defaults. These plugin tasks do not add hooks, modify Stash settings, or replace the built-in Scan and Identify controls.
