# Restash

A freshness-scoring plugin for [Stash](https://github.com/stashapp/stash), forked from [Espionage9248/Restash](https://github.com/Espionage9248/Restash) (MIT License).

Restash reads the behavioural log Stash keeps for every Scene and Performer — plays, o-history, completion, library age — and computes a personalised **0–100 "freshness" score** written to `custom_fields`.

## Modifications from upstream

- **Available from this repo** — install via this plugin source URL
- **Hooks on Scene/Performer creation** — automatically scores new entities when they're added
- **"Disable Other Plugins" task** — can disable all other plugins before running to prevent interference, then re-enable them after

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

## Tasks

| Task | Description |
|---|---|
| **Dry Run Report** | Scores everything, writes nothing, logs top-30 breakdown + tuning checks |
| **Recompute All** | Full rebuild + write scores to custom_fields |
| **Quick Refresh** | Fast daily re-score from cached taste model; also scores newly added scenes immediately |
| **Clear Restash Data** | Remove all restash_* custom fields |
| **Backup Ratings** | Snapshot native rating100 values |
| **Restore Ratings** | Revert rating100 from backup |
| **Disable Other Plugins** | Manually disable all other plugins |

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

- **Scene.Create.Post** — runs a refresh when a new scene is created
- **Performer.Create.Post** — runs a refresh when a new performer is created

## License

[MIT](https://github.com/Espionage9248/Restash/blob/main/LICENSE) © 2026 Espionage9248 (original), modifications by lowgrade12.
