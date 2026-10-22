from __future__ import annotations
import hashlib
import json
import os
import tempfile

# v2: the per-scene `base` cache is gone (refresh re-scores every scene from live
# data); the file now holds the taste model plus what the new-scene hook needs to
# place one scene in the library: library context + the raw-score distribution.
STATE_FORMAT_VERSION = 2

# Settings that feed the cached affinity model. Changing any of these invalidates
# the cache; refresh recomputes everything else from live data, so the rest are
# NOT listed here.
BASE_AFFECTING_FIELDS = (
    "taste_half_life_days", "o_event_value", "play_event_value",
    "abandonment_penalty", "completion_floor", "abandonment_completion_max",
    "direct_scale", "direct_half_life_days", "confidence_events",
    "ingredient_w_perf", "ingredient_w_tag", "ingredient_w_studio",
    "ingredient_w_quality", "satiation_threshold", "satiation_floor",
    "satiation_window_days", "respect_manual_ratings", "favorite_affinity_bonus",
    "perf_scenes_shrinkage_k", "scene_rating_weight", "rating_model_weight",
)


def settings_fingerprint(settings) -> str:
    payload = {f: getattr(settings, f) for f in BASE_AFFECTING_FIELDS}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def default_state_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "restash_state.json")


def save_state(path: str, *, settings, affinities: dict, context: dict,
               raw_quantiles: list, written_at: str,
               perf_quantiles: list | None = None,
               perf_scenes_prior: float | None = None,
               ratings_fit: dict | None = None) -> None:
    """Write the cache atomically (temp file in the same dir + os.replace) so a
    run dying mid-write cannot corrupt it."""
    state = {
        "format_version": STATE_FORMAT_VERSION,
        "written_at": written_at,
        "settings_fingerprint": settings_fingerprint(settings),
        "affinities": affinities,
        "context": context,
        "raw_quantiles": raw_quantiles,
        # performer-hook inputs; absent in caches written before 0.7.0
        "perf_quantiles": perf_quantiles or [],
        "perf_scenes_prior": perf_scenes_prior,
        # the rating model with its holdout result; absent before 0.8.0
        "rating_model": ratings_fit,
    }
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".restash_state.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(state, fh)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_state(path: str) -> dict | None:
    """Return the parsed cache, or None if missing/unreadable/corrupt."""
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def is_valid(state: dict | None, settings) -> tuple[bool, str]:
    """(usable?, reason). Usable only if present, current format, matching
    base-affecting settings, and structurally complete."""
    if state is None:
        return False, "no cache file (missing or unreadable)"
    if state.get("format_version") != STATE_FORMAT_VERSION:
        return False, (f"cache format_version {state.get('format_version')} != "
                       f"{STATE_FORMAT_VERSION}")
    if not all(k in state for k in ("affinities", "context", "raw_quantiles")):
        return False, "cache missing affinities/context/raw_quantiles"
    if state.get("settings_fingerprint") != settings_fingerprint(settings):
        return False, "base-affecting settings changed since cache was written"
    return True, "ok"


def has_performer_inputs(state: dict) -> bool:
    """Whether the cache can score a single performer (written by 0.7.0+)."""
    return bool(state.get("perf_quantiles")) and state.get("perf_scenes_prior") is not None
