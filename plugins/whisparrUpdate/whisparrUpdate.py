#!/usr/bin/env python3
#
# Whisparr Update Plugin
#
# Inspired by whisparr-bridge
# Original: https://github.com/lowgrade12/myplugins/tree/main/reference/whisparr-bridge
#

import json, sys, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from stashapi.stashapp import StashInterface
from stashapi import log

SCENE_FRAGMENT = """
id
title
stash_ids { endpoint stash_id }
"""

# ---------- HTTP helpers ----------
# Without a timeout a hung or unreachable Whisparr blocks the hook process
# (and the Stash update that triggered it) indefinitely.
HTTP_TIMEOUT = 30

def http_get_json(url, api_key):
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Api-Key": api_key},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            raw = r.read().decode("utf-8", "ignore")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = (e.read() or b"").decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, str(e)

def http_post_json(url, body, api_key):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            raw = r.read().decode("utf-8", "ignore")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = (e.read() or b"").decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, str(e)

def http_put_json(url, body, api_key):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            raw = r.read().decode("utf-8", "ignore")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = (e.read() or b"").decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, str(e)

def http_delete(url, api_key):
    req = urllib.request.Request(
        url,
        headers={"X-Api-Key": api_key},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return r.status, r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"").decode("utf-8", "ignore")
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, str(e)

def is_already_exists_error(status, resp):
    """Check if the response indicates the item already exists.
    
    Whisparr may return:
    - 409 Conflict for duplicates
    - 400 Bad Request with MovieExistsValidator error code
    
    Returns tuple: (is_exists_error: bool, existing_movie_id: int or None)
    """
    if status == 409:
        return True, None
    
    if status == 400:
        # Response could be a list of errors, a dict, or a string
        errors = resp if isinstance(resp, list) else [resp] if isinstance(resp, dict) else []
        for error in errors:
            if isinstance(error, dict):
                error_code = error.get("errorCode", "")
                if error_code == "MovieExistsValidator":
                    # Try to extract existing movie ID from error response if available
                    existing_id = error.get("existingMovieId")
                    return True, existing_id
    
    return False, None

def lookup_movie_by_stashid(whisparr_url, api_key, stashdb_id):
    """Lookup a movie in Whisparr by its StashDB ID.
    
    First tries using the stashId query parameter. If that returns multiple
    movies (indicating the API doesn't support filtering), falls back to
    fetching all movies and filtering by foreignId.
    
    Returns the movie dict if found, None otherwise.
    """
    # First, try the stashId query parameter
    url = f"{whisparr_url}/api/v3/movie?stashId={stashdb_id}"
    status, resp = http_get_json(url, api_key)
    
    if status == 200:
        if isinstance(resp, list):
            if len(resp) == 1:
                # Perfect - API returned exactly one movie
                log.debug(f"Whisparr lookup by stashId returned 1 movie: id={resp[0].get('id')}")
                return resp[0]
            elif len(resp) > 1:
                # When stashId parameter is unsupported, API returns all movies - filter by foreignId
                log.debug(f"Whisparr lookup returned {len(resp)} movies, filtering by foreignId")
                for movie in resp:
                    if movie.get("foreignId") == stashdb_id:
                        log.debug(f"Found matching movie by foreignId: id={movie.get('id')}")
                        return movie
                log.debug(f"No movie found with foreignId={stashdb_id}")
                return None
            else:
                # Empty list
                return None
        elif isinstance(resp, dict) and resp.get("id"):
            # Single movie dict response
            return resp
    
    return None

def refresh_movie(whisparr_url, api_key, movie_id):
    """Trigger a metadata refresh for a movie in Whisparr.
    
    Uses the /api/v3/command endpoint with RefreshMovie command.
    Returns True if successful, False otherwise.
    """
    url = f"{whisparr_url}/api/v3/command"
    body = {
        "name": "RefreshMovie",
        "movieIds": [movie_id]
    }
    
    status, resp = http_post_json(url, body, api_key)
    return status in (200, 201)

def unmonitor_movie(whisparr_url, api_key, movie_id):
    """Set an existing movie in Whisparr to unmonitored.

    Whisparr's movie PUT replaces the whole record, so the current movie is
    fetched and sent back with only monitored changed.
    Returns True if the movie was changed, False if it was already
    unmonitored or the update failed.
    """
    url = f"{whisparr_url}/api/v3/movie/{movie_id}"
    status, movie = http_get_json(url, api_key)
    if status != 200 or not isinstance(movie, dict):
        log.error(f"Whisparr: cannot load movie id={movie_id}: {status} {movie}")
        return False

    if not movie.get("monitored"):
        log.debug(f"Whisparr: movie id={movie_id} already unmonitored")
        return False

    movie["monitored"] = False
    status, resp = http_put_json(url, movie, api_key)
    if status not in (200, 202):
        log.error(f"Whisparr: failed to unmonitor movie id={movie_id}: {status} {resp}")
        return False
    return True

def remove_movie(whisparr_url, api_key, movie_id):
    """Remove a movie from Whisparr, keeping its files, and add an import
    exclusion so import lists don't add it back.

    deleteFiles is always false: the files are the user's Stash library.
    """
    status, resp = http_delete(
        f"{whisparr_url}/api/v3/movie/{movie_id}?deleteFiles=false&addImportExclusion=true",
        api_key,
    )
    if status not in (200, 204):
        log.error(f"Whisparr: failed to remove movie id={movie_id}: {status} {resp}")
        return False
    return True

def add_exclusion(whisparr_url, api_key, stashdb_id, title):
    """Exclude a scene that isn't in Whisparr, so import lists never add it."""
    body = {"foreignId": stashdb_id, "movieTitle": title, "type": "scene"}
    status, resp = http_post_json(f"{whisparr_url}/api/v3/exclusions", body, api_key)
    if status in (200, 201):
        return True
    # Already excluded is fine; Whisparr rejects the duplicate with a 400.
    if status == 400 and "exclu" in json.dumps(resp).lower():
        log.debug(f"Whisparr: {stashdb_id} already excluded")
        return True
    log.error(f"Whisparr: failed to exclude {stashdb_id}: {status} {resp}")
    return False

def remove_on_match(whisparr_url, api_key, stashdb_id, title):
    """The scene is in Stash, so Whisparr has nothing left to download:
    remove it (or, if Whisparr never had it, just exclude it)."""
    try:
        existing = find_by_stashid(whisparr_url, api_key, stashdb_id)
    except RuntimeError as e:
        log.error(str(e))
        return
    if existing:
        if remove_movie(whisparr_url, api_key, existing["id"]):
            log.info(f"Whisparr: removed movie id={existing['id']} (files kept, import excluded)")
    elif add_exclusion(whisparr_url, api_key, stashdb_id, title):
        log.info(f"Whisparr: excluded {stashdb_id} from import lists")

def load_plugin_settings(stash: StashInterface) -> dict:
    """Return this plugin's settings using the manifest name."""
    try:
        stash_config = stash.get_configuration()
    except Exception as e:
        log.error(f"get_configuration failed: {e}")
        return {}

    plugins = (stash_config or {}).get("plugins") or {}
    settingname = "whisparrUpdate"
    cfg = plugins.get(settingname)
    if not isinstance(cfg, dict):
        log.error(f"Plugin settings not found under '{settingname}'.")
        return {}

    return cfg

def stash_ids_may_have_changed(hook: dict) -> bool:
    """Return True if this hook's update could have changed the scene's stash_ids."""
    fields = hook.get("inputFields")
    if fields is not None:
        return "stash_ids" in fields
    # Scan-triggered hooks carry no input at all, and a scan never changes
    # stash IDs. Older Stash versions don't send inputFields; fall back to
    # processing those updates as before.
    return hook.get("input") is not None

# ---------- main ----------
# ---------- Operations for other plugins' UI ----------
# Cherry Pick's "Not in your library" cards call this plugin through Stash's
# runPluginOperation, so the Whisparr URL and API key stay in this plugin's
# settings on the server. args.mode picks the operation:
#   status: {"stash_ids": [...]} -> {"<stash_id>": {"id", "monitored",
#           "hasFile"} or null}
#   add:    {"stash_id", "title"} -> the scene added (or, already in
#           Whisparr, set monitored), with a search started
# The answer goes to stdout as Stash's plugin output: {"output": ...}.

STATUS_MAX_IDS = 50
STATUS_WORKERS = 8

def movie_state(movie):
    """The fields a card shows for a Whisparr movie, or None."""
    if not isinstance(movie, dict):
        return None
    return {
        "id": movie.get("id"),
        "monitored": bool(movie.get("monitored")),
        "hasFile": bool(movie.get("hasFile")),
    }

def find_by_stashid(whisparr_url, api_key, stashdb_id):
    """The movie with this StashDB id, or None. Unlike
    lookup_movie_by_stashid, never falls back to listing every movie: on a
    library of 100,000+ scenes that download is far too big for a card."""
    status, resp = http_get_json(
        f"{whisparr_url}/api/v3/movie?stashId={urllib.parse.quote(stashdb_id)}",
        api_key,
    )
    if status != 200 or not isinstance(resp, list):
        raise RuntimeError(f"Whisparr lookup failed: {status} {resp}")
    for movie in resp:
        if movie.get("foreignId") == stashdb_id or movie.get("stashId") == stashdb_id:
            return movie
    return None

def op_status(whisparr_url, api_key, args):
    ids = [i for i in (args.get("stash_ids") or []) if isinstance(i, str) and i]
    ids = list(dict.fromkeys(ids))[:STATUS_MAX_IDS]
    out = {}
    with ThreadPoolExecutor(max_workers=STATUS_WORKERS) as pool:
        found = pool.map(lambda i: find_by_stashid(whisparr_url, api_key, i), ids)
        for stashdb_id, movie in zip(ids, found):
            out[stashdb_id] = movie_state(movie)
    return out

def search_movie(whisparr_url, api_key, movie_id):
    status, resp = http_post_json(
        f"{whisparr_url}/api/v3/command",
        {"name": "MoviesSearch", "movieIds": [movie_id]},
        api_key,
    )
    if status not in (200, 201):
        raise RuntimeError(f"Whisparr search failed: {status} {resp}")

def monitor_movie(whisparr_url, api_key, movie):
    """Sets an existing movie monitored (a PUT of the whole record)."""
    if movie.get("monitored"):
        return movie
    movie = dict(movie, monitored=True)
    status, resp = http_put_json(
        f"{whisparr_url}/api/v3/movie/{movie['id']}", movie, api_key
    )
    if status not in (200, 202):
        raise RuntimeError(f"Whisparr monitor failed: {status} {resp}")
    return resp if isinstance(resp, dict) else movie

def op_add(whisparr_url, api_key, args):
    """Adds a scene the user does not have, monitored, and searches for it.
    Always monitored, whatever "Monitor after add" says: that setting is for
    scenes already in Stash, and this is a request to download one."""
    stashdb_id = args.get("stash_id")
    if not isinstance(stashdb_id, str) or not stashdb_id:
        raise ValueError("stash_id is required")
    existing = find_by_stashid(whisparr_url, api_key, stashdb_id)
    if existing:
        movie = monitor_movie(whisparr_url, api_key, existing)
        if not movie.get("hasFile"):
            search_movie(whisparr_url, api_key, movie["id"])
        log.info(f"Whisparr: monitored existing id={movie['id']} for {stashdb_id}")
        return {**movie_state(movie), "monitored": True, "added": False}

    s_qp, qps = http_get_json(f"{whisparr_url}/api/v3/qualityprofile", api_key)
    if s_qp != 200 or not isinstance(qps, list) or not qps:
        raise RuntimeError(f"Whisparr: cannot load quality profiles: {s_qp} {qps}")
    s_rf, rfs = http_get_json(f"{whisparr_url}/api/v3/rootfolder", api_key)
    if s_rf != 200 or not isinstance(rfs, list) or not rfs:
        raise RuntimeError(f"Whisparr: cannot load root folders: {s_rf} {rfs}")
    body = {
        "title": args.get("title") or "",
        "qualityProfileId": int(qps[0]["id"]),
        "rootFolderPath": rfs[0]["path"],
        "monitored": True,
        "addOptions": {"monitor": "movieOnly", "searchForMovie": True},
        "foreignId": stashdb_id,
        "stashId": stashdb_id,
    }
    status, resp = http_post_json(f"{whisparr_url}/api/v3/movie", body, api_key)
    if status not in (200, 201):
        raise RuntimeError(f"Whisparr add failed: {status} {resp}")
    log.info(f"Whisparr: added {stashdb_id} and started a search")
    return {**(movie_state(resp) or {}), "monitored": True, "hasFile": False, "added": True}

OPERATIONS = {"status": op_status, "add": op_add}

def run_operation(stash_data, args):
    """Runs args.mode and writes Stash's plugin output to stdout."""
    try:
        stash = StashInterface(stash_data["server_connection"])
        cfg = load_plugin_settings(stash)
        whisparr_url = (cfg.get("WHISPARR_URL") or "").rstrip("/")
        whisparr_key = cfg.get("WHISPARR_API_KEY") or ""
        if not whisparr_url or not whisparr_key:
            raise RuntimeError("Set the Whisparr URL and API key in Whisparr Update's settings.")
        result = {"ok": True, "result": OPERATIONS[args["mode"]](whisparr_url, whisparr_key, args)}
    except Exception as e:
        log.error(f"Whisparr Update {args.get('mode')}: {e}")
        result = {"ok": False, "error": str(e)}
    print(json.dumps({"output": result}))

def main():
    STASH_DATA = json.loads(sys.stdin.read())
    ARGS = STASH_DATA.get("args") or {}
    if ARGS.get("mode") in OPERATIONS:
        run_operation(STASH_DATA, ARGS)
        return
    hook = ARGS.get("hookContext") or {}
    scene_id = hook.get("id")
    if not scene_id:
        log.info("No scene id in hook; exit.")
        return

    # Scene.Update.Post fires for every scene edit (ratings, tags, play counts,
    # other plugins' batch jobs) and for scans. Only a change to stash_ids can
    # make a scene newly matchable, so skip everything else before touching
    # Stash or Whisparr.
    if not stash_ids_may_have_changed(hook):
        log.debug("stash_ids not changed in this update; skip.")
        return

    # Stash API client
    stash = StashInterface(STASH_DATA["server_connection"])

    plugin_cfg = load_plugin_settings(stash)
    if not plugin_cfg:
        return

    whisparr_url = (plugin_cfg.get("WHISPARR_URL") or "").rstrip("/")
    whisparr_key = plugin_cfg.get("WHISPARR_API_KEY") or ""
    match_substr = plugin_cfg.get("STASHDB_ENDPOINT_SUBSTR") or "stashdb.org"
    monitored = plugin_cfg.get("MONITORED", True)
    remove_matched = plugin_cfg.get("REMOVE_ON_MATCH", False)

    if not whisparr_url or not whisparr_key:
        log.error("Missing Whisparr settings (URL/API key).")
        return

    # Fetch scene
    try:
        scene = stash.find_scene(scene_id, fragment=SCENE_FRAGMENT)
    except Exception as e:
        log.error(f"find_scene failed: {e}")
        return

    if not scene:
        log.error(f"Scene {scene_id} not found.")
        return

    title = scene.get("title") or ""
    log.info(f"scene '{title}', id={scene_id}")

    # Extract matching StashDB id
    stashdb_id = None
    for sid in scene.get("stash_ids") or []:
        if match_substr in (sid.get("endpoint") or ""):
            stashdb_id = sid.get("stash_id")
            break

    if not stashdb_id:
        log.info("No matching StashDB id; skip.")
        return

    if remove_matched:
        remove_on_match(whisparr_url, whisparr_key, stashdb_id, title)
        return

    # Query Whisparr for defaults it requires
    s_qp, qps = http_get_json(f"{whisparr_url}/api/v3/qualityprofile", whisparr_key)
    if s_qp != 200 or not isinstance(qps, list) or not qps:
        log.error(f"Whisparr: cannot load quality profiles: {s_qp} {qps}")
        return
    quality_profile_id = int(qps[0]["id"])

    s_rf, rfs = http_get_json(f"{whisparr_url}/api/v3/rootfolder", whisparr_key)
    if s_rf != 200 or not isinstance(rfs, list) or not rfs:
        log.error(f"Whisparr: cannot load root folders: {s_rf} {rfs}")
        return
    root_folder_path = rfs[0]["path"]

    # Build add payload
    body = {
        "title": title,
        "qualityProfileId": quality_profile_id,
        "rootFolderPath": root_folder_path,
        "monitored": monitored,
        "addOptions": {
            "monitor": "movieOnly" if monitored else "none",
            "searchForMovie": False
        },
        "foreignId": stashdb_id,
        "stashId": stashdb_id
    }

    status, resp = http_post_json(f"{whisparr_url}/api/v3/movie", body, whisparr_key)
    if status in (200, 201):
        log.info(f"Whisparr add OK ({status})")
    else:
        is_exists, existing_id_from_error = is_already_exists_error(status, resp)
        if is_exists:
            log.info(f"Whisparr: item already exists (status {status}), attempting refresh...")
            
            # First try using the movie ID from the error response
            movie_id = existing_id_from_error
            
            # If not in error response, lookup the existing movie by stashId
            if not movie_id:
                existing_movie = lookup_movie_by_stashid(whisparr_url, whisparr_key, stashdb_id)
                movie_id = existing_movie.get("id") if existing_movie else None
            
            if movie_id:
                log.info(f"Whisparr: found existing movie id={movie_id} for stashId={stashdb_id}")
                # The scene is in Stash now, so with monitoring off there is
                # nothing left for Whisparr to download or upgrade.
                if not monitored and unmonitor_movie(whisparr_url, whisparr_key, movie_id):
                    log.info(f"Whisparr: unmonitored movie id={movie_id}")
                if refresh_movie(whisparr_url, whisparr_key, movie_id):
                    log.info(f"Whisparr: refreshed movie id={movie_id}")
                else:
                    log.error(f"Whisparr: failed to refresh movie id={movie_id}")
            else:
                log.info("Whisparr: could not lookup existing movie for refresh")
        else:
            log.error(f"Whisparr error {status}: {resp}")

if __name__ == "__main__":
    main()
