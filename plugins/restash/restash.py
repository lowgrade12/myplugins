from __future__ import annotations
import json
import pathlib
import sys

import algorithm
import config
import missing
import models
import rating_model
import ratings_backup
import report
import state
import stash_io
import writer
from stashapi import log   # stashapp-tools logging → drives Stash progress bar


def _resolve_plugin_id() -> str:
    """Stash assigns a plugin its id from the basename of its YAML manifest. Derive
    that from the manifest sitting next to this file, so a side-by-side install in a
    differently-named folder/manifest reads ITS OWN settings rather than another
    install's. Falls back to "restash" if no manifest is found."""
    here = pathlib.Path(__file__).parent
    ymls = sorted(here.glob("*.yml")) + sorted(here.glob("*.yaml"))
    return ymls[0].stem if ymls else "restash"


PLUGIN_ID = _resolve_plugin_id()
DORMANT_FAVORITE_DAYS = 90.0


# --- Plugin management (disable/re-enable other plugins) ---
#
# Plugins Restash disables are recorded in a file BEFORE the mutation, so a run
# that is cancelled or crashes mid-way still leaves a record; the next scoring task
# (Dry Run / Recompute All / Quick Refresh) re-enables everything listed there.

_PLUGINS_WITH_STATUS_QUERY = """
query { plugins { id enabled } }
"""

_SET_PLUGINS_ENABLED = """
mutation SetPluginsEnabled($enabledMap: BoolMap!) {
  setPluginsEnabled(enabledMap: $enabledMap)
}
"""

SCORING_MODES = ("dry", "full", "refresh")


def _disabled_plugins_path() -> pathlib.Path:
    return pathlib.Path(__file__).parent / ".restash_disabled_plugins.json"


def _load_disabled_record() -> list[str]:
    try:
        data = json.loads(_disabled_plugins_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [str(pid) for pid in data] if isinstance(data, list) else []


def _save_disabled_record(plugin_ids: list[str]) -> None:
    path = _disabled_plugins_path()
    if plugin_ids:
        path.write_text(json.dumps(sorted(set(plugin_ids))), encoding="utf-8")
    else:
        path.unlink(missing_ok=True)


def _get_plugins_status(stash) -> dict[str, bool]:
    """Retrieve a map of plugin ID → enabled status ({} if the query fails)."""
    try:
        result = stash.call_GQL(_PLUGINS_WITH_STATUS_QUERY)
        plugins = (result or {}).get("plugins") or []
        return {p["id"]: p.get("enabled", True) for p in plugins if p.get("id")}
    except Exception as exc:   # noqa: BLE001
        log.warning(f"[Restash] Could not read the plugin list: {exc}")
        return {}


def _set_plugins_enabled(stash, enabled_map: dict[str, bool]) -> bool:
    """Update the enabled state for the given plugins."""
    try:
        stash.call_GQL(_SET_PLUGINS_ENABLED, {"enabledMap": enabled_map})
        return True
    except Exception as exc:
        log.error(f"[Restash] Failed to update plugin enabled state: {exc}")
        return False


def _disable_other_plugins(stash) -> None:
    """Disable all enabled plugins except this one, recording them for re-enable."""
    status = _get_plugins_status(stash)
    to_disable = [pid for pid, enabled in status.items()
                  if pid != PLUGIN_ID and enabled]
    if not to_disable:
        log.info("[Restash] No other plugins to disable.")
        return
    _save_disabled_record(_load_disabled_record() + to_disable)
    if _set_plugins_enabled(stash, {pid: False for pid in to_disable}):
        log.info(f"[Restash] Disabled {len(to_disable)} other plugin(s): "
                 f"{', '.join(to_disable)}. They are re-enabled when the next "
                 f"Dry Run / Recompute All / Quick Refresh finishes.")


def _restore_disabled_plugins(stash) -> None:
    """Re-enable every plugin Restash recorded as disabled — by this run, by the
    standalone Disable Other Plugins task, or by an earlier run that died before
    cleaning up. Plugins since re-enabled by hand or uninstalled are skipped; the
    record is kept if re-enabling fails so the next run retries."""
    recorded = _load_disabled_record()
    if not recorded:
        return
    status = _get_plugins_status(stash)
    if not status:
        log.warning(f"[Restash] Could not re-enable {len(recorded)} plugin(s) "
                    f"({', '.join(recorded)}); will retry on the next scoring run.")
        return
    to_enable = [pid for pid in recorded if status.get(pid) is False]
    if to_enable and not _set_plugins_enabled(stash, {pid: True for pid in to_enable}):
        return
    _save_disabled_record([])
    if to_enable:
        log.info(f"[Restash] Re-enabled {len(to_enable)} plugin(s): "
                 f"{', '.join(to_enable)}")


# --- Input parsing ---

def parse_input(payload: dict):
    """Pull the bits Stash actually sends: the server connection and the task
    `args` (mode + any defaultArgs / dev overrides). Plugin SETTINGS are NOT in
    the payload — Stash delivers them only via the configuration query — so they
    are resolved later in run() against the live connection."""
    args = payload.get("args") or {}
    mode = args.get("mode") or "dry"
    conn = payload.get("server_connection") or {}
    return mode, conn, args


def build_settings(plugin_cfg: dict | None, args: dict) -> config.Settings:
    """Layer settings: dataclass defaults < Stash plugin settings < payload-arg
    overrides (write_limit / scene_ids — used for targeted and dev runs)."""
    settings = config.Settings.from_plugin_settings(plugin_cfg)
    if "write_limit" in args:
        settings.write_limit = int(args["write_limit"])
    if "scene_ids" in args:
        settings.write_only_scene_ids = tuple(str(i) for i in args["scene_ids"])
    return settings


# --- Hook handling ---

HOOK_TYPES = ("Scene.Create.Post", "Performer.Create.Post")


def _handle_hook(payload: dict) -> int:
    """Score new entities against the cached taste model and cached library score
    distributions — a handful of targeted reads and writes, never a library
    re-read, so a scan importing thousands of scenes stays cheap.

    Scene.Create.Post scores the new scene, then re-scores its performers (a scrape
    usually links performers right as the scene is created). Performer.Create.Post
    scores the new performer. Without a valid cache nothing is scored and the next
    Quick Refresh / Recompute All picks the entities up."""
    hook_context = (payload.get("args") or {}).get("hookContext") or {}
    hook_type = hook_context.get("type", "")
    entity_id = str(hook_context.get("id") or "")
    if hook_type not in HOOK_TYPES or not entity_id:
        log.debug(f"[Restash] hook: ignoring {hook_type or 'unknown'} event.")
        return 0
    kind = hook_type.split(".")[0].lower()

    stash = stash_io.connect(payload.get("server_connection") or {})
    settings = build_settings(stash_io.fetch_plugin_settings(stash, PLUGIN_ID), {})
    st = state.load_state(state.default_state_path())
    ok, reason = state.is_valid(st, settings)
    if not ok:
        log.info(f"[Restash] hook: {kind} {entity_id} not scored ({reason}); the next "
                 f"Quick Refresh / Recompute All will include it.")
        return 0

    if (settings.mirror_to_rating100
            and not ratings_backup.backup_exists(ratings_backup.default_backup_path())):
        # Never overwrite rating100 without a backup; the next scoring run creates
        # one and mirrors these entities then.
        settings.mirror_to_rating100 = False
    exclude_id = stash_io.resolve_tag_id(stash, settings.exclude_tag_name)
    now = stash_io.utcnow()

    failed = 0
    if kind == "scene":
        scene_failed, performer_ids = _hook_score_scene(stash, settings, st, entity_id,
                                                        exclude_id, now)
        failed += scene_failed
    else:
        performer_ids = [entity_id]
    failed += _hook_score_performers(stash, settings, st, performer_ids, exclude_id, now)
    return 1 if failed else 0


def _hook_score_scene(stash, settings, st, scene_id, exclude_id, now) -> tuple[int, list]:
    """Score one new scene. Returns (failed writes, its performer ids to re-score)."""
    scene = stash_io.fetch_scene(stash, scene_id)
    if scene is None or not scene.has_file:
        log.info(f"[Restash] hook: scene {scene_id} missing or has no file; skipped.")
        return 0, []
    if exclude_id is not None and exclude_id in scene.tag_ids:
        return 0, []

    scene_ratings, _ = _manual_ratings(
        settings,
        live_scene={scene.id: scene.rating100} if scene.rating100 is not None else {},
        live_perf={})
    sc = algorithm.score_scenes([scene], settings, now, now.strftime("%Y-%m-%d"),
                                aff=st["affinities"], scene_ratings=scene_ratings,
                                context=st["context"], wildcards=False,
                                ratings_fit=rating_model.usable(st.get("rating_model"))
                                )[scene.id]
    sc.percentile = algorithm.percentile_from_quantiles(sc.raw, st["raw_quantiles"])
    sc.restash_score = algorithm.to_restash_score(sc.percentile)

    kw = ({"current_ratings": {scene.id: scene.rating100}}
          if settings.mirror_to_rating100 else {})
    stats = writer.write_scores(stash, "scene", {scene.id: sc},
                                {scene.id: scene.custom_fields}, settings,
                                _iso_now(now), **kw)
    log.info(f"[Restash] hook: scored new scene {scene.id} → {sc.restash_score}.")
    return stats["failed"], scene.performer_ids


def _hook_score_performers(stash, settings, st, performer_ids, exclude_id, now) -> int:
    """Score the given performers from their own scenes' stored scores plus the
    cached taste model, prior and performer score distribution. Returns failed
    writes."""
    if not performer_ids:
        return 0
    if not state.has_performer_inputs(st):
        log.info(f"[Restash] hook: performer(s) {', '.join(performer_ids)} not scored "
                 f"(cache predates performer scoring); run Quick Refresh once.")
        return 0

    performers, scenes = [], {}
    for pid in performer_ids:
        p = stash_io.fetch_performer(stash, pid)
        if p is None or (exclude_id is not None and exclude_id in p.tag_ids):
            continue
        performers.append(p)
        for s in stash_io.fetch_performer_scenes(stash, pid):
            if s.has_file and not (exclude_id is not None and exclude_id in s.tag_ids):
                scenes[s.id] = s
    if not performers:
        return 0

    scores = algorithm.score_performers(
        performers, list(scenes.values()),
        _stored_scene_scores(scenes.values(), st["raw_quantiles"]),
        st["affinities"], settings, now,
        prior=st["perf_scenes_prior"], quantiles=st["perf_quantiles"])
    kw = ({"current_ratings": {p.id: p.rating100 for p in performers}}
          if settings.mirror_to_rating100 else {})
    stats = writer.write_scores(stash, "performer", scores,
                                {p.id: p.custom_fields for p in performers}, settings,
                                _iso_now(now), **kw)
    for p in performers:
        log.info(f"[Restash] hook: scored performer {p.id} ({p.name}) → "
                 f"{scores[p.id].restash_score}.")
    return stats["failed"]


def _stored_scene_scores(scenes, quantiles) -> dict:
    """SceneScore stand-ins built from each scene's stored restash_raw, placed in
    the cached scene distribution (raw is pre-wildcard, so promotions can't leak
    into a performer's best-material term). Unscored scenes are left out."""
    out = {}
    for s in scenes:
        try:
            raw = float(s.custom_fields.get("restash_raw"))
        except (TypeError, ValueError):
            continue
        pct = algorithm.percentile_from_quantiles(raw, quantiles)
        out[s.id] = models.SceneScore(id=s.id, raw=raw,
                                      restash_score=algorithm.to_restash_score(pct),
                                      percentile=pct, n_events=0, wildcard=False)
    return out


def _iso_now(now) -> str:
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


# --- Main run logic ---

def run(payload: dict) -> int:
    # Check if this is a hook trigger
    args = payload.get("args") or {}
    if "hookContext" in args:
        return _handle_hook(payload)
    # The UI's "Not in your library" row (restash-ui.js), via runPluginOperation:
    # reads only, and answers on stdout, so none of the task setup below runs.
    if args.get("mode") == "missing":
        stash = stash_io.connect(payload.get("server_connection") or {})
        settings = build_settings(stash_io.fetch_plugin_settings(stash, PLUGIN_ID), {})
        return missing.run_op(stash, settings, args)

    mode, conn, args = parse_input(payload)
    stash = stash_io.connect(conn)
    caps = stash_io.ensure_schema(stash)
    plugin_cfg = stash_io.fetch_plugin_settings(stash, PLUGIN_ID)
    if payload.get("plugin_config"):
        plugin_cfg = {**plugin_cfg, **payload["plugin_config"]}
    settings = build_settings(plugin_cfg, args)
    log.info(f"[Restash] schema OK (scene custom_fields, "
             f"remove={caps['custom_fields_remove']}). mode={mode} "
             f"plugin_id={PLUGIN_ID} mirror={settings.mirror_to_rating100} "
             f"respect_ratings={settings.respect_manual_ratings}")

    # Handle disable-plugins mode standalone
    if mode == "disable-plugins":
        _disable_other_plugins(stash)
        return 0

    # Optionally disable other plugins before scoring tasks
    scoring = mode in SCORING_MODES
    if scoring and settings.disable_plugins_before_run:
        _disable_other_plugins(stash)

    try:
        if mode == "dry":
            return _run_dry(stash, settings)
        if mode == "full":
            return _run_full(stash, settings)
        if mode == "clear":
            return _run_clear(stash, settings)
        if mode == "refresh":
            return _run_refresh(stash, settings)
        if mode == "backup-ratings":
            return ratings_backup.run_backup(stash, settings)
        if mode == "restore-ratings":
            return ratings_backup.run_restore(stash, settings)
        log.error(f"[Restash] unknown mode '{mode}'.")
        return 1
    finally:
        # Re-enable whatever Restash disabled, whether by this run's setting, a
        # standalone Disable Other Plugins task, or an earlier interrupted run.
        if scoring:
            _restore_disabled_plugins(stash)


def _dry_run_report_path() -> pathlib.Path:
    return pathlib.Path(__file__).parent / "restash_dry_run.txt"


def _run_dry(stash, settings: config.Settings) -> int:
    now = stash_io.utcnow()
    date_seed = now.strftime("%Y-%m-%d")

    log.progress(0.05)
    scenes = stash_io.fetch_scenes(stash)
    log.info(f"[Restash] read {len(scenes)} scenes.")
    log.progress(0.45)
    performers = stash_io.fetch_performers(stash)
    log.info(f"[Restash] read {len(performers)} performers.")
    log.progress(0.60)

    exclude_id = stash_io.resolve_tag_id(stash, settings.exclude_tag_name)
    scenes, performers = stash_io.filter_excluded(scenes, performers, exclude_id)
    log.info(f"[Restash] scoring {len(scenes)} scenes / {len(performers)} performers "
             f"(exclude tag id={exclude_id}).")

    favorites = {p.id for p in performers if p.favorite}
    scene_ratings, perf_ratings = _manual_ratings(
        settings,
        live_scene={s.id: s.rating100 for s in scenes if s.rating100 is not None},
        live_perf={p.id: p.rating100 for p in performers if p.rating100 is not None})

    champions = algorithm.champion_bonuses(performers, now, settings)
    aff = algorithm.build_affinities(scenes, now, settings, favorites, perf_ratings,
                                     champions)
    fitted = _fit_rating_model(scenes, settings)
    log.progress(0.75)
    scene_scores = algorithm.score_scenes(scenes, settings, now, date_seed,
                                          favorites, perf_ratings, aff,
                                          scene_ratings=scene_ratings,
                                          ratings_fit=rating_model.usable(fitted))
    log.progress(0.85)
    performer_scores = algorithm.score_performers(performers, scenes, scene_scores,
                                                 aff, settings, now)
    log.progress(0.95)

    titles = {s.id: s.title for s in scenes}
    names = {p.id: p.name for p in performers}
    diag_rows, diag_summary = _watched_diagnostic(scenes, scene_scores, settings)
    tuning_checks = _top30_tuning_checks(scenes, performers, scene_scores, settings)
    summary = report.format_summary(len(scene_scores), len(performer_scores),
                                    would_write=len(scene_scores) + len(performer_scores),
                                    skipped=0)

    report_path = _dry_run_report_path()
    report_path.write_text(
        "\n\n".join([
            report.format_scene_report(scene_scores, titles, top_n=30),
            report.format_performer_report(performer_scores, names, top_n=30),
            report.format_rating_model(fitted, settings.rating_model_weight),
            report.format_top30_tuning_checks(tuning_checks, DORMANT_FAVORITE_DAYS),
            report.format_watched_diagnostic(diag_rows, diag_summary, top_n=20),
            summary,
        ]),
        encoding="utf-8",
    )

    for line in summary.splitlines():
        log.info(line)
    log.info(f"[Restash] full report saved → {report_path}")
    log.progress(1.0)
    return 0


def _run_full(stash, settings: config.Settings) -> int:
    return _score_and_write(stash, settings, cached_aff=None, cached_fit=None)


def _run_refresh(stash, settings: config.Settings) -> int:
    """Re-score every scene and performer from live data against the CACHED taste
    model: plays/o-events since the last Recompute All count immediately and new
    scenes are included, while affinities stay stable until the next Recompute
    All. Falls back to a full recompute if the cache is missing or stale."""
    st = state.load_state(state.default_state_path())
    ok, reason = state.is_valid(st, settings)
    if not ok:
        log.info(f"[Restash] refresh: cache unusable ({reason}); running full recompute.")
        return _run_full(stash, settings)
    return _score_and_write(stash, settings, cached_aff=st["affinities"],
                            cached_fit=st.get("rating_model"))


def _score_and_write(stash, settings: config.Settings, cached_aff: dict | None,
                     cached_fit: dict | None) -> int:
    label = "full" if cached_aff is None else "refresh"
    now = stash_io.utcnow()
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    date_seed = now.strftime("%Y-%m-%d")

    log.progress(0.05)
    scenes = stash_io.fetch_scenes(stash)
    performers = stash_io.fetch_performers(stash)
    log.info(f"[Restash] read {len(scenes)} scenes / {len(performers)} performers.")
    log.progress(0.45)

    exclude_id = stash_io.resolve_tag_id(stash, settings.exclude_tag_name)
    kept_scenes, kept_performers = stash_io.filter_excluded(scenes, performers, exclude_id)
    kept_scene_ids = {s.id for s in kept_scenes}
    kept_perf_ids = {p.id for p in kept_performers}
    log.info(f"[Restash] scoring {len(kept_scenes)} scenes / {len(kept_performers)} "
             f"performers (exclude tag id={exclude_id}).")

    favorites = {p.id for p in kept_performers if p.favorite}
    scene_ratings, perf_ratings = _manual_ratings(
        settings,
        live_scene={s.id: s.rating100 for s in kept_scenes if s.rating100 is not None},
        live_perf={p.id: p.rating100 for p in kept_performers if p.rating100 is not None})

    if cached_aff is None:
        champions = algorithm.champion_bonuses(kept_performers, now, settings)
        log.info(f"[Restash] HotOrNot champions as a taste prior: {len(champions)}.")
        aff = algorithm.build_affinities(kept_scenes, now, settings, favorites, perf_ratings,
                                         champions)
        fitted = _fit_rating_model(kept_scenes, settings)
    else:
        aff = cached_aff
        fitted = cached_fit
    context = algorithm.library_context(kept_scenes)
    scene_scores = algorithm.score_scenes(kept_scenes, settings, now, date_seed,
                                          favorites, perf_ratings, aff,
                                          scene_ratings=scene_ratings, context=context,
                                          ratings_fit=rating_model.usable(fitted))
    performer_scores = algorithm.score_performers(kept_performers, kept_scenes,
                                                  scene_scores, aff, settings, now)
    log.progress(0.70)

    state.save_state(state.default_state_path(), settings=settings, affinities=aff,
                     context=context,
                     raw_quantiles=algorithm.raw_quantiles(
                         [sc.raw for sc in scene_scores.values()]),
                     perf_quantiles=algorithm.raw_quantiles(
                         [ps.raw for ps in performer_scores.values()]),
                     perf_scenes_prior=next(
                         (ps.components["scenes_prior"]
                          for ps in performer_scores.values()), None),
                     ratings_fit=fitted, written_at=now_iso)
    log.info("[Restash] wrote taste-model cache to restash_state.json." if label == "full"
             else "[Restash] updated library distribution in restash_state.json.")

    targeted = bool(settings.write_only_scene_ids)
    if targeted:
        target = set(settings.write_only_scene_ids)
        scene_scores = {sid: sc for sid, sc in scene_scores.items() if sid in target}
        performer_scores = {}
        log.info(f"[Restash] targeted write — {len(scene_scores)} of {len(target)} "
                 f"requested scene id(s) in corpus; performers skipped.")

    existing_scene_cf = {s.id: s.custom_fields for s in kept_scenes}
    existing_perf_cf = {p.id: p.custom_fields for p in kept_performers}
    if settings.mirror_to_rating100:
        _ensure_rating_backup(
            {s.id: s.rating100 for s in scenes if s.rating100 is not None},
            {p.id: p.rating100 for p in performers if p.rating100 is not None})
        scene_kw = {"current_ratings": {s.id: s.rating100 for s in kept_scenes}}
        perf_kw = {"current_ratings": {p.id: p.rating100 for p in kept_performers}}
    else:
        scene_kw = perf_kw = {}
    s_stats = writer.write_scores(stash, "scene", scene_scores, existing_scene_cf,
                                  settings, now_iso, **scene_kw)
    p_stats = writer.write_scores(stash, "performer", performer_scores, existing_perf_cf,
                                  settings, now_iso, **perf_kw)
    log.progress(0.90)

    if targeted:
        drop_scene_ids, drop_perf_ids = [], []
    else:
        drop_scene_ids = [s.id for s in scenes
                          if s.id not in kept_scene_ids and _has_restash(s.custom_fields)]
        drop_perf_ids = [p.id for p in performers
                         if p.id not in kept_perf_ids and _has_restash(p.custom_fields)]
    cleared = (writer.clear_scores(stash, "scene", drop_scene_ids, settings)
               + writer.clear_scores(stash, "performer", drop_perf_ids, settings))

    log.info(f"[Restash] {label}: scenes written={s_stats['written']} "
             f"skipped={s_stats['skipped']}; performers written={p_stats['written']} "
             f"skipped={p_stats['skipped']}; excluded cleared={cleared}.")
    s_failed, p_failed = s_stats.get("failed", 0), p_stats.get("failed", 0)
    if s_failed or p_failed:
        log.error(f"[Restash] {s_failed} scene + {p_failed} performer update(s) were "
                  f"rejected by the server (those IDs were NOT written); re-run to retry.")
    clear_failed = (len(drop_scene_ids) + len(drop_perf_ids)) - cleared
    if clear_failed:
        log.error(f"[Restash] {clear_failed} excluded-entity clear(s) were rejected by "
                  f"the server (restash_* keys remain on those IDs); re-run to retry.")
    if settings.write_limit and not targeted:
        log.info(f"[Restash] write_limit={settings.write_limit} active — capped writes "
                 f"(scenes would_write={s_stats['would_write']}, "
                 f"performers would_write={p_stats['would_write']}).")
    log.progress(1.0)
    return 1 if (s_failed or p_failed or clear_failed) else 0


def _run_clear(stash, settings: config.Settings) -> int:
    log.progress(0.05)
    scenes = stash_io.fetch_scenes(stash)
    performers = stash_io.fetch_performers(stash)
    s_ids = [s.id for s in scenes if _has_restash(s.custom_fields)]
    p_ids = [p.id for p in performers if _has_restash(p.custom_fields)]
    log.progress(0.60)
    n = (writer.clear_scores(stash, "scene", s_ids, settings)
         + writer.clear_scores(stash, "performer", p_ids, settings))
    log.info(f"[Restash] clear: removed restash_* from {n} entities "
             f"({len(s_ids)} scenes, {len(p_ids)} performers). Other fields untouched.")
    failed = (len(s_ids) + len(p_ids)) - n
    if failed:
        log.error(f"[Restash] {failed} clear(s) were rejected by the server "
                  f"(restash_* keys remain on those IDs); re-run to retry.")
    log.progress(1.0)
    return 1 if failed else 0


def _has_restash(custom_fields: dict) -> bool:
    return any(k in (custom_fields or {}) for k in writer.RESTASH_KEYS)


def _ensure_rating_backup(scene_ratings: dict, perf_ratings: dict) -> None:
    """Before the first destructive mirror write, ensure a rating backup exists."""
    path = ratings_backup.default_backup_path()
    if ratings_backup.backup_exists(path):
        return
    written_at = stash_io.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    ratings_backup.write_backup(path, scenes=scene_ratings, performers=perf_ratings,
                                written_at=written_at, rotate=False)
    log.warning(f"[Restash] mirrorToRating100 is ON and no rating backup existed — "
                f"auto-created one ({len(scene_ratings)} scene + {len(perf_ratings)} "
                f"performer rating(s)) at {path} before overwriting rating100. Use "
                f"'Restore Ratings' to revert.")


def _manual_ratings(settings, *, live_scene: dict, live_perf: dict):
    """Source the manual-rating prior as (scene_ratings, perf_ratings)."""
    if not settings.respect_manual_ratings:
        return {}, {}
    if settings.mirror_to_rating100:
        backup = ratings_backup.load_backup(ratings_backup.default_backup_path())
        if backup is not None:
            return dict(backup.get("scenes", {})), dict(backup.get("performers", {}))
    return live_scene, live_perf


def _fit_rating_model(scenes, settings) -> dict | None:
    """Fit the rating model on the user's own scene ratings (None when its weight
    is 0). With the rating100 mirror on, live ratings are Restash's, so the rating
    backup supplies the user's; a rating equal to a scene's stored restash_score
    is left out either way."""
    if settings.rating_model_weight <= 0:
        return None
    backup = None
    if settings.mirror_to_rating100:
        loaded = ratings_backup.load_backup(ratings_backup.default_backup_path())
        if loaded is not None:
            backup = {str(k): v for k, v in (loaded.get("scenes") or {}).items()}
    fitted = rating_model.fit_library(scenes, backup)
    cv = fitted["cv"]
    if cv:
        log.info(f"[Restash] rating model: {fitted['n_rated']} own ratings, holdout MAE "
                 f"{cv['mae_model']:.3f} vs {cv['mae_base']:.3f} for your average — "
                 f"{'used' if fitted['usable'] else 'not used'}.")
    else:
        log.info(f"[Restash] rating model: {fitted['n_rated']} own ratings; needs "
                 f"{rating_model.MIN_RATED} before it is used.")
    return fitted


def _watched_diagnostic(scenes, scene_scores, settings, top_n: int = 20):
    """Gather read-only diagnostics for watched scenes (n_events>0)."""
    rows = []
    penalty = penalty_high_comp = resume_zero = resume_zero_penalty = 0
    for s in scenes:
        sc = scene_scores.get(s.id)
        if sc is None or sc.n_events == 0:
            continue
        events = algorithm.extract_events(s, settings)
        fired = any(e.kind == "penalty" for e in events)
        comp = algorithm.completion_factor(s.play_duration, s.play_count,
                                           s.file_duration, settings.completion_floor)
        if fired:
            penalty += 1
            if comp >= 0.70:
                penalty_high_comp += 1
        if s.resume_time == 0.0:
            resume_zero += 1
            if fired:
                resume_zero_penalty += 1
        rows.append({
            "title": s.title or s.id, "score": sc.restash_score,
            "n_events": sc.n_events, "fresh": sc.components.get("fresh"),
            "fresh_d": sc.components.get("fresh_d"), "direct": sc.components.get("direct"),
            "confidence": sc.components.get("confidence"), "completion": comp,
            "resume_time": s.resume_time, "file_duration": s.file_duration,
            "penalty": fired, "play_count": s.play_count, "o_counter": s.o_counter,
        })
    rows.sort(key=lambda r: r["direct"] if r["direct"] is not None else 0.0,
              reverse=True)
    summary = {"watched": len(rows), "penalty": penalty,
               "penalty_high_completion": penalty_high_comp,
               "resume_zero": resume_zero, "resume_zero_penalty": resume_zero_penalty}
    return rows[:top_n], summary


def _top30_tuning_checks(scenes, performers, scene_scores, settings) -> dict:
    scene_by_id = {s.id: s for s in scenes}
    favorite_perf_ids = {p.id for p in performers if p.favorite}
    ranked = sorted(scene_scores.values(), key=lambda s: s.restash_score, reverse=True)[:30]

    recently_watched = 0
    dormant_favorites = 0
    total_misses = 0
    for sc in ranked:
        scene = scene_by_id.get(sc.id)
        fresh_d = sc.components.get("fresh_d")
        watched = sc.n_events > 0
        has_favorite_perf = bool(scene and set(scene.performer_ids) & favorite_perf_ids)

        if watched and isinstance(fresh_d, float) and fresh_d < settings.cooldown_days:
            recently_watched += 1
        if (watched and has_favorite_perf and isinstance(fresh_d, float)
                and fresh_d >= DORMANT_FAVORITE_DAYS):
            dormant_favorites += 1
        if not watched and not has_favorite_perf:
            total_misses += 1

    return {
        "recently_watched_top30": recently_watched,
        "dormant_favorites_top30": dormant_favorites,
        "total_misses_top30": total_misses,
    }


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    return run(payload)


if __name__ == "__main__":
    sys.exit(main())
