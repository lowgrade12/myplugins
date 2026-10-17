# Reference plugins

Original plugins that plugins in `plugins/` were built from. They are kept here for reference and are **not** published to the plugin source (`build_site.sh` only packages `plugins/`).

| Original | Built into |
|----------|------------|
| [`whisparr-bridge`](whisparr-bridge) | [`plugins/whisparrUpdate`](../plugins/whisparrUpdate) |
| [`stashSetStashboxFavoritePerformers`](stashSetStashboxFavoritePerformers) | [`plugins/setStashboxFavorites`](../plugins/setStashboxFavorites) |

Don't install an original alongside the plugin built from it: both hook the same updates, so every sync would run twice.
