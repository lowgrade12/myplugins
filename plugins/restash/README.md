# Restash

A freshness-scoring plugin for [Stash](https://github.com/stashapp/stash), forked from [Espionage9248/Restash](https://github.com/Espionage9248/Restash) (MIT License).

Restash reads the behavioural log Stash keeps for every Scene and Performer — plays, o-history, completion, library age — and computes a personalised **0–100 "freshness" score** written to `custom_fields`.

## Modifications from upstream

- **Available from this repo** — install via this plugin source URL
- **Hooks on scene and performer creation** — scores each new scene (and re-scores its performers) and each new performer immediately against the cached taste model
- **"Disable Other Plugins" task** — can disable all other plugins before running to prevent interference, then re-enable them after
- **Low write churn** — jitter re-rolls weekly and small score changes are not written, so a daily refresh touches a small fraction of the library
- **Scale-aware wildcards** — a fixed handful of wildcards per day is placed by rank just under the top real scenes, so they surface in a descending sort even in very large libraries
- **"Not in your library" on performer pages** — the performer's StashDB scenes you don't have, ranked by the score Restash would give each one, with a link to where to get it, a link to StashDB and, when the Whisparr Update plugin is enabled, a Whisparr button (add monitored and search; shows Downloaded / Wanted / In Whisparr). StashDB is asked on the server with the stash-box key from Stash's settings, so the key never reaches the browser. Turn it off with *Hide 'Not in your library' on performer pages*.
- **Rating model** — learns performer, studio and tag weights from your own scene ratings (ported from Cherry Pick's Your score) and uses them for each scene's taste term, so a scene you haven't watched — or one just created — is scored by how you rate scenes like it

## Install

Add this repository as a Stash plugin source:

1. **Settings → Plugins → Available Plugins → Add Source**
   - **Name:** `MyPlugins`
   - **Source URL:** `https://lowgrade12.github.io/myplugins/index.yml`
   - **Local Path:** (leave default or choose a name)
2. Find **Restash** and click **Install**
3. Install the Python dependency:
   ```bash
   pip install stashapp-tools
   ```
4. **Settings → Plugins → Reload Plugins**

## Requirements

- **Stash** v0.30+ (scene custom_fields support)
- **Python 3.11+**
- **stashapp-tools** ≥ 0.2.58

## Settings

| Setting | Default | Description |
|---|---|---|
| Taste half-life (days) | 120 | How fast older watch events fade |
| Cooldown period (days) | 14 | Post-watch suppression before rediscovery |
| Freshness strength | 0.8 | Multiplier on cooldown/rediscovery effect |
| Rediscovery max days | 180 | Days after cooldown where rediscovery reaches cap |
| Direct-evidence half-life (days) | 540 | Fade speed for per-scene direct watch evidence |
| Wildcard count | 20 | Low-confidence scenes promoted as wildcards each day (0 = off) |
| Wildcard placement rank | 50 | Wildcards take the scores of the real scenes ranked just below this many |
| Performer scene shrinkage K | 5.0 | Smoothing strength for sparse performer histories |
| Rating model weight | 1 | Share of each scene's taste term taken from the model fitted to your ratings (0 = off) |
| Blend manual ratings | off | Nudge taste model from manual ratings |
| Exclusion tag name | [Restash: Exclude] | Tag to exclude entities from scoring |
| Mirror to rating100 | off | Also write score to native rating (destructive) |
| Disable other plugins before run | off | Disable all other plugins during scoring tasks |
| Jitter period (days) | 7 | How often the ordering jitter is re-rolled (1 = daily) |
| Minimum score change to write | 3 | Skip writes for smaller score moves; wildcard changes always write (1 = write every change) |

## Tasks

| Task | Description |
|---|---|
| **Dry Run Report** | Scores everything, writes nothing, logs top-30 breakdown + tuning checks |
| **Recompute All** | Full rebuild + write scores to custom_fields |
| **Quick Refresh** | Daily re-score of everything from live watch data against the cached taste model (affinities not rebuilt) |
| **Clear Restash Data** | Remove all restash_* custom fields |
| **Backup Ratings** | Snapshot native rating100 values |
| **Restore Ratings** | Revert rating100 from backup |
| **Disable Other Plugins** | Manually disable all other plugins; the next Dry Run / Recompute All / Quick Refresh re-enables them |

## Tuning workflow

1. Run **Dry Run Report** and compare:
   - recently watched scenes appearing in top-30
   - dormant favorite scenes resurfacing in top-30
   - total misses in top-30
2. Tune in passes:
   - freshness curve: cooldown/freshness/rediscovery window
   - taste memory: taste half-life + direct-evidence half-life
   - exploration: wildcard count, placement rank and pool range
   - performer blend: performer term weights + shrinkage
3. Keep only changes that improve top-30 relevance while preserving rediscovery.
4. Run **Recompute All** to lock in a new baseline, then use **Quick Refresh** daily.

## Rating model

Recompute All fits an additive model to your own scene ratings: your average, plus a weight for each performer, studio (and parent studio) and tag, held back from extremes (ridge regression) so a performer with one rated scene doesn't swing far. Scenes you watched but never rated count at 0.3 weight, from how you watched them; a scene played for less than a tenth of its length counts as not watched. The model is then checked on ratings it didn't see — five 80/20 splits, each rating held out once — and is used only if its error beats guessing your average rating for every scene.

When used, its prediction takes **Rating model weight** of each scene's taste ("ingredients") term; the hand-weighted performer/tag/studio/quality blend takes the rest. Watch evidence, freshness, novelty, jitter and wildcards apply on top as before. Each scene's predicted stars are stored as `rating_pred` in `restash_components`.

Only ratings you set count. A rating equal to the scene's `restash_score` is Restash's mirror and is skipped; with **Mirror to rating100** on, the rating backup supplies your ratings instead. The model is cached with the taste model, so Quick Refresh and the new-scene hook reuse it; rate more scenes and run Recompute All to refit. On a 144k-scene library the fit and its check take about half a minute.

The Dry Run Report's **RATING MODEL** section shows how many ratings it learned from, its holdout mean absolute error against your average's, the share of predictions within half a star, and whether it is used.

## Hooks (automatic triggers)

- **Scene.Create.Post** — scores just the new scene: its raw score is computed from the cached taste model (rating model included) and placed against the library score distribution saved by the last Recompute All / Quick Refresh. The library is never re-read, so large scans stay cheap. If no valid cache exists yet, the scene is left for the next Quick Refresh.

  It then re-scores that scene's performers, so a performer created by the same scrape gets a score that reflects the scene.
- **Performer.Create.Post** — scores just the new performer from their own scenes' stored scores (usually none yet), the cached taste model, and the performer score distribution saved by the last Recompute All / Quick Refresh. A brand-new performer with no scenes lands mid-pack (favorites get the usual floor); their scene-based score arrives when a scene featuring them is created or on the next Quick Refresh.

Caches written before 0.7.0 lack the performer distribution: run Quick Refresh once after upgrading and performer hooks start working.

## Disabled-plugin recovery

Plugins that Restash disables are recorded in `.restash_disabled_plugins.json` before they are switched off. Every Dry Run / Recompute All / Quick Refresh re-enables everything in that file when it finishes, so plugins come back even after a cancelled or crashed run, or after the standalone **Disable Other Plugins** task.

## License

[MIT](https://github.com/Espionage9248/Restash/blob/main/LICENSE) © 2026 Espionage9248 (original), modifications by lowgrade12.
