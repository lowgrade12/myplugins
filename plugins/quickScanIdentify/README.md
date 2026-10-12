# Quick Scan & Identify

Configure **Directory A** and **Directory B** under Stash's **Settings > Plugins**, using the paths as seen by the Stash server. The two tasks in **Plugin Tasks** each selectively scan the configured path, wait for that job to finish, and then identify the same path.

Scan tasks use Stash's configured scan defaults. These plugin tasks do not add hooks, modify Stash settings, or replace the built-in Scan and Identify controls.
