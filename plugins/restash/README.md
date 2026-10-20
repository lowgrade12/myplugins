# Restash

A freshness-scoring plugin for [Stash](https://github.com/stashapp/stash), forked from [Espionage9248/Restash](https://github.com/Espionage9248/Restash) (MIT License).

Restash reads the behavioural log Stash keeps for every Scene and Performer — plays, o-history, completion, library age — and computes a personalised **0–100 "freshness" score** written to `custom_fields`.

## Modifications from upstream

- **Available from this repo** — install via this plugin source URL
- **Hook on scene creation** — scores each new scene immediately against the cached taste model
- **"Disable Other Plugins" task** — can disable all other plugins before running to prevent interference, then re-enable them after
- **Low write churn** — jitter re-rolls weekly and small score changes are not written, so a daily refresh touches a small fraction of the library

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
| Wildcard % | 1.0 | Library share promoted as wildcards daily |
| Performer scene shrinkage K | 5.0 | Smoothing strength for sparse performer histories |
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
   - exploration: wildcard share and pool/band ranges
   - performer blend: performer term weights + shrinkage
3. Keep only changes that improve top-30 relevance while preserving rediscovery.
4. Run **Recompute All** to lock in a new baseline, then use **Quick Refresh** daily.

## Hooks (automatic triggers)

- **Scene.Create.Post** — scores just the new scene: its raw score is computed from the cached taste model and placed against the library score distribution saved by the last Recompute All / Quick Refresh. Nothing else is re-read or rewritten, so large scans stay cheap. If no valid cache exists yet, the scene is left for the next Quick Refresh.

New performers have no scenes yet, so they're scored by the next Quick Refresh.

## Disabled-plugin recovery

Plugins that Restash disables are recorded in `.restash_disabled_plugins.json` before they are switched off. Every Dry Run / Recompute All / Quick Refresh re-enables everything in that file when it finishes, so plugins come back even after a cancelled or crashed run, or after the standalone **Disable Other Plugins** task.

## License

[MIT](https://github.com/Espionage9248/Restash/blob/main/LICENSE) © 2026 Espionage9248 (original), modifications by lowgrade12.
