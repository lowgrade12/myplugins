#!/usr/bin/env python3
import json, sys, urllib.request, urllib.error
from stashapi.stashapp import StashInterface
from stashapi import log

SCENE_FRAGMENT = """
id
title
stash_ids { endpoint stash_id }
"""

# ---------- HTTP helpers ----------
def http_get_json(url, api_key):
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Api-Key": api_key},
        method="GET",
    )
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode("utf-8", "ignore")
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw

def http_post_json(url, body, api_key):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
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

def is_already_exists_error(status, resp):
    """Check if the response indicates the item already exists.
    
    Whisparr may return:
    - 409 Conflict for duplicates
    - 400 Bad Request with MovieExistsValidator error code
    """
    if status == 409:
        return True
    
    if status == 400:
        # Response could be a list of errors, a dict, or a string
        errors = resp if isinstance(resp, list) else [resp] if isinstance(resp, dict) else []
        for error in errors:
            if isinstance(error, dict):
                error_code = error.get("errorCode", "")
                if error_code == "MovieExistsValidator":
                    return True
    
    return False

def lookup_movie_by_stashid(whisparr_url, api_key, stashdb_id):
    """Lookup a movie in Whisparr by its StashDB ID.
    
    Returns the movie dict if found, None otherwise.
    """
    url = f"{whisparr_url}/api/v3/movie?stashId={stashdb_id}"
    status, resp = http_get_json(url, api_key)
    
    if status == 200:
        # Response is a list of movies matching the stashId
        if isinstance(resp, list) and resp:
            return resp[0]  # Return first match
        # Response might be a single movie dict
        if isinstance(resp, dict) and resp.get("id"):
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
        "movieId": movie_id
    }
    
    status, resp = http_post_json(url, body, api_key)
    return status in (200, 201)

def load_plugin_settings(stash: StashInterface) -> dict:
    """Return this plugin's settings using the manifest name."""
    try:
        stash_config = stash.get_configuration()
    except Exception as e:
        log.error(f"get_configuration failed: {e}")
        return {}

    plugins = (stash_config or {}).get("plugins") or {}
    settingname = "whisparr-bridge"
    cfg = plugins.get(settingname)
    if not isinstance(cfg, dict):
        log.error(f"Plugin settings not found under '{settingname}'.")
        return {}

    return cfg

# ---------- main ----------
def main():
    STASH_DATA = json.loads(sys.stdin.read())
    ARGS = STASH_DATA.get("args") or {}
    hook = ARGS.get("hookContext") or {}
    scene_id = hook.get("id")
    if not scene_id:
        log.info("No scene id in hook; exit.")
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
    elif is_already_exists_error(status, resp):
        log.info(f"Whisparr: item already exists (status {status}), attempting refresh...")
        # Lookup the existing movie by stashId to get its Whisparr ID
        existing_movie = lookup_movie_by_stashid(whisparr_url, whisparr_key, stashdb_id)
        movie_id = existing_movie.get("id") if existing_movie else None
        if movie_id:
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
