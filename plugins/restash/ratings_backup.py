from __future__ import annotations
import json
import os
import tempfile
from datetime import datetime, timezone

import stash_io
import writer
from stashapi import log

BACKUP_FORMAT_VERSION = 1


def default_backup_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "restash_ratings_backup.json")


def backup_exists(path: str) -> bool:
    return os.path.exists(path)


def collect_ratings(scenes, performers) -> tuple[dict, dict]:
    """id -> rating100 for entities with a non-null native rating. Scenes are light
    dicts (s['rating100']); performers are PerformerData objects (p.rating100)."""
    scene_r = {str(s["id"]): s["rating100"] for s in scenes
               if s.get("rating100") is not None}
    perf_r = {str(p.id): p.rating100 for p in performers
              if p.rating100 is not None}
    return scene_r, perf_r


def _rotate(path: str) -> str:
    """Rename an existing backup to a timestamped sibling. Returns the new path, or
    '' if there was nothing to rotate."""
    if not os.path.exists(path):
        return ""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    root, ext = os.path.splitext(path)
    rotated = f"{root}.{ts}{ext}"
    os.replace(path, rotated)
    return rotated


def write_backup(path: str, *, scenes: dict, performers: dict, written_at: str,
                 rotate: bool) -> str:
    """Atomically write the backup (temp file in same dir + os.replace). When
    rotate=True and a backup already exists, rename it to a timestamped sibling
    first. Returns the rotated-away path ('' if none)."""
    rotated = _rotate(path) if rotate else ""
    payload = {
        "format_version": BACKUP_FORMAT_VERSION,
        "written_at": written_at,
        "scenes": scenes,
        "performers": performers,
    }
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".restash_ratings.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return rotated


def load_backup(path: str) -> dict | None:
    """Parsed backup, or None if missing/unreadable/corrupt/structurally incomplete."""
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or "scenes" not in data or "performers" not in data:
        return None
    return data


def _restore_targets(backup_map: dict, current: dict) -> dict:
    """id -> target rating100 for a minimal restore: write each backed-up value that
    differs from the current value, and null any entity that currently has a
    non-null rating but is absent from the backup (clears mirror-applied ratings,
    per D15). Entities already at their target are omitted (no needless write)."""
    targets = {}
    for eid, val in backup_map.items():
        if current.get(eid) != val:
            targets[eid] = val
    for eid, cur in current.items():
        if cur is not None and eid not in backup_map:
            targets[eid] = None
    return targets


def run_backup(stash, settings) -> int:
    """Backup Ratings task: snapshot all non-null native ratings to the backup file,
    rotating any existing backup to a timestamped sibling first."""
    path = default_backup_path()
    scene_r, perf_r = collect_ratings(stash_io.fetch_scenes_light(stash),
                                      stash_io.fetch_performers(stash))
    written_at = stash_io.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    rotated = write_backup(path, scenes=scene_r, performers=perf_r,
                           written_at=written_at, rotate=True)
    if rotated:
        log.info(f"Restash backup: rotated previous backup -> {rotated}")
    log.info(f"Restash backup: saved {len(scene_r)} scene + {len(perf_r)} "
             f"performer rating(s) -> {path}")
    return 0


def run_restore(stash, settings) -> int:
    """Restore Ratings task: revert native rating100 to the exact backup snapshot --
    restore originals and null any rating added/mirrored since the backup."""
    path = default_backup_path()
    backup = load_backup(path)
    if backup is None:
        log.error(f"Restash restore: no usable backup at {path}; nothing to restore.")
        return 1
    scenes = stash_io.fetch_scenes_light(stash)
    performers = stash_io.fetch_performers(stash)
    s_targets = _restore_targets(backup.get("scenes", {}),
                                 {str(s["id"]): s.get("rating100") for s in scenes})
    p_targets = _restore_targets(backup.get("performers", {}),
                                 {str(p.id): p.rating100 for p in performers})
    s_stats = writer.write_ratings(stash, "scene", s_targets, settings)
    p_stats = writer.write_ratings(stash, "performer", p_targets, settings)
    restored = sum(1 for v in s_targets.values() if v is not None) + \
               sum(1 for v in p_targets.values() if v is not None)
    cleared = sum(1 for v in s_targets.values() if v is None) + \
              sum(1 for v in p_targets.values() if v is None)
    failed = s_stats["failed"] + p_stats["failed"]
    log.info(f"Restash restore: targeted {restored} rating restore(s) + {cleared} clear(s); {failed} rejected.")
    if failed:
        log.error(f"Restash: {failed} rating restore(s) were rejected by the server; "
                  f"re-run to retry.")
    return 1 if failed else 0
