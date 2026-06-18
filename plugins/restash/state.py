from __future__ import annotations
import hashlib
import json
import os
import tempfile

STATE_FORMAT_VERSION = 1

# Settings that feed the cached pre-freshness `base` and the affinity model.
# Changing any of these invalidates the cache; refresh recomputes everything else
# (freshness / novelty / jitter / wildcards), so those settings are NOT listed here.
BASE_AFFECTING_FIELDS = (
    "taste_half_life_days", "o_event_value", "play_event_value",
    "abandonment_penalty", "completion_floor", "abandonment_completion_max",
    "direct_scale", "direct_half_life_days", "confidence_events",
    "ingredient_w_perf", "ingredient_w_tag", "ingredient_w_studio",
    "ingredient_w_quality", "satiation_threshold", "satiation_floor",
    "satiation_window_days", "respect_manual_ratings", "favorite_affinity_bonus",
    "perf_scenes_shrinkage_k", "scene_rating_weight",
)


def settings_fingerprint(settings) -> str:
    payload = {f: getattr(settings, f) for f in BASE_AFFECTING_FIELDS}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def default_state_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "restash_state.json")


def save_state(path: str, *, settings, affinities: dict, scenes: dict,
               written_at: str) -> None:
    """Write the cache atomically (temp file in the same dir + os.replace) so a
    run dying mid-write cannot corrupt it."""
    state = {
        "format_version": STATE_FORMAT_VERSION,
        "written_at": written_at,
        "settings_fingerprint": settings_fingerprint(settings),
        "affinities": affinities,
        "scenes": scenes,
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


def default_lock_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        ".restash_running.lock")


def acquire_lock(path: str | None = None) -> None:
    """Create a lock file indicating a task is actively running."""
    path = path or default_lock_path()
    with open(path, "w") as fh:
        fh.write(str(os.getpid()))


def release_lock(path: str | None = None) -> None:
    """Remove the lock file when a task finishes."""
    path = path or default_lock_path()
    try:
        os.unlink(path)
    except OSError:
        pass


def is_task_running(path: str | None = None) -> bool:
    """Return True if the lock file exists and was created by a still-running process.
    If the lock file references a dead PID, it's stale — remove it and return False."""
    path = path or default_lock_path()
    if not os.path.exists(path):
        return False
    try:
        with open(path) as fh:
            pid_str = fh.read().strip()
        if pid_str:
            pid = int(pid_str)
            # Check if the process is still alive
            os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError):
        # PID is invalid or process no longer exists — stale lock
        try:
            os.unlink(path)
        except OSError:
            pass
        return False
    except PermissionError:
        # Process exists but we can't signal it (different user) — still running
        return True
    except OSError:
        return False


def default_disabled_plugins_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        ".restash_disabled_plugins.json")


def save_disabled_plugins(plugin_ids: list[str], path: str | None = None) -> None:
    """Persist the list of plugins we disabled so they can be restored after a crash."""
    path = path or default_disabled_plugins_path()
    with open(path, "w") as fh:
        json.dump(plugin_ids, fh)


def load_disabled_plugins(path: str | None = None) -> list[str]:
    """Load the list of plugins that were disabled by a previous (possibly crashed) run.
    Returns an empty list if no file exists or it's unreadable."""
    path = path or default_disabled_plugins_path()
    try:
        with open(path) as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return [str(pid) for pid in data]
    except (OSError, ValueError):
        pass
    return []


def clear_disabled_plugins(path: str | None = None) -> None:
    """Remove the persisted disabled-plugins file after successful re-enable."""
    path = path or default_disabled_plugins_path()
    try:
        os.unlink(path)
    except OSError:
        pass


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
    if "scenes" not in state or "affinities" not in state:
        return False, "cache missing scenes/affinities"
    if state.get("settings_fingerprint") != settings_fingerprint(settings):
        return False, "base-affecting settings changed since cache was written"
    return True, "ok"
