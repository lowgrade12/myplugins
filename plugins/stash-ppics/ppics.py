import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from downloader import Downloader
from scraper import PPics
from stash import Stash


PLUGIN_DIR = Path(__file__).resolve().parent
CACHE_DIR = PLUGIN_DIR / "assets" / "cache"
STATE_DIR = PLUGIN_DIR / "state" / "imports"
HISTORY_FILE = PLUGIN_DIR / "state" / "import-history.json"
RUNTIME_FILE = PLUGIN_DIR / "state" / "runtime.json"
SESSION_RESET_FILE = PLUGIN_DIR / "state" / "session-reset.json"

DEFAULT_SEARCH_LIMIT = 20
IMPORTER_TAG = "PornPics Importer"
LEGACY_IMPORTER_TAG = "PPics"


def log(message):
    print(message, file=sys.stderr, flush=True)


def write_json_atomic(
    path,
    payload,
    retries=12,
    retry_delay=0.035
):
    path = Path(path)
    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    content = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2
    )

    temp = path.with_name(
        path.name
        + "."
        + uuid.uuid4().hex
        + ".tmp"
    )

    try:
        temp.write_text(
            content,
            encoding="utf-8"
        )

        last_error = None

        for attempt in range(retries):
            try:
                os.replace(
                    str(temp),
                    str(path)
                )

                return

            except PermissionError as error:
                last_error = error

            except OSError as error:
                # WinError 5 and WinError 32 can occur for a very short time
                # while Stash is serving the progress JSON to the browser.
                if getattr(
                    error,
                    "winerror",
                    None
                ) not in (
                    5,
                    32
                ):
                    raise

                last_error = error

            if attempt < retries - 1:
                time.sleep(
                    retry_delay
                    * (
                        attempt + 1
                    )
                )

        if last_error:
            raise last_error

        raise OSError(
            "Could not replace JSON cache file."
        )

    finally:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass


def write_cache(request_id, payload):
    write_json_atomic(
        CACHE_DIR / (request_id + ".json"),
        payload
    )


def write_progress(
    request_id,
    phase,
    message,
    current=None,
    total=None,
    detail=None,
    completed=None,
    bytes_done=None
):
    if not request_id:
        return

    payload = {
        "phase": phase,
        "message": message,
        "updated_at": time.time()
    }

    if current is not None:
        payload["current"] = current

    if total is not None:
        payload["total"] = total

    if detail:
        payload["detail"] = detail

    if completed is not None:
        payload["completed"] = completed

    if bytes_done is not None:
        payload["bytes_done"] = bytes_done

    try:
        write_json_atomic(
            CACHE_DIR / (
                request_id
                + ".progress.json"
            ),
            payload,
            retries=8,
            retry_delay=0.025
        )

    except OSError as error:
        # Progress reporting is best-effort. If Stash or the browser has the
        # JSON file open for a moment on Windows, skip this single update
        # instead of failing the entire import.
        log(
            "PPics: skipped one progress update because the cache file "
            "was temporarily locked: "
            + str(error)
        )




def clear_cache_files():
    CACHE_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    removed = 0

    for path in CACHE_DIR.iterdir():
        if not path.is_file():
            continue

        try:
            path.unlink()
            removed += 1
        except OSError:
            pass

    return removed


def ensure_cache_for_stash_process():
    current_parent_pid = os.getppid()
    previous_parent_pid = None

    if RUNTIME_FILE.exists():
        try:
            runtime = json.loads(
                RUNTIME_FILE.read_text(
                    encoding="utf-8"
                )
            )

            previous_parent_pid = runtime.get(
                "parent_pid"
            )
        except Exception:
            previous_parent_pid = None

    if (
        str(previous_parent_pid)
        == str(current_parent_pid)
    ):
        return False

    write_json_atomic(
        RUNTIME_FILE,
        {
            "parent_pid": current_parent_pid,
            "seen_at": time.time()
        }
    )

    removed = clear_cache_files()

    log(
        "PPics: new Stash process detected; cleared "
        + str(removed)
        + " cached file(s)"
    )

    return True


def get_session_reset_token():
    if SESSION_RESET_FILE.exists():
        try:
            data = json.loads(
                SESSION_RESET_FILE.read_text(
                    encoding="utf-8"
                )
            )

            token = str(
                data.get("token") or ""
            ).strip()

            if token:
                return token
        except Exception:
            pass

    return rotate_session_reset_token()


def rotate_session_reset_token():
    token = uuid.uuid4().hex

    write_json_atomic(
        SESSION_RESET_FILE,
        {
            "token": token,
            "updated_at": time.time()
        }
    )

    return token


def existing_path_from_image(image):
    if not isinstance(image, dict):
        return None

    for visual_file in image.get(
        "visual_files"
    ) or []:
        path = str(
            visual_file.get("path") or ""
        ).strip()

        if (
            path
            and os.path.isfile(path)
        ):
            return path

    return None


def validate_history_image(
    stash,
    source_url,
    image_history,
    allow_lookup
):
    if not isinstance(
        image_history,
        dict
    ):
        image_history = {}

    stored_path = str(
        image_history.get("path") or ""
    ).strip()

    stored_exists = bool(
        stored_path
        and os.path.isfile(
            stored_path
        )
    )

    # Lightweight result-list checks may trust an existing local file. The
    # deep scene check also verifies that Stash still has a live image record.
    if stored_exists and not allow_lookup:
        return image_history

    image = None
    image_id = image_history.get(
        "id"
    )

    if image_id:
        try:
            image = stash.find_image_by_id(
                image_id
            )
        except Exception:
            image = None

    if not image and source_url:
        try:
            image = stash.find_image_by_url(
                source_url
            )
        except Exception:
            image = None

    current_path = existing_path_from_image(
        image
    )

    if current_path:
        updated = dict(
            image_history
        )

        updated["id"] = image.get(
            "id"
        )
        updated["path"] = current_path

        galleries = image.get(
            "galleries"
        ) or []

        if galleries:
            updated["gallery_id"] = galleries[
                0
            ].get("id")
        else:
            updated["gallery_id"] = None

        return updated

    if allow_lookup:
        return None

    if stored_exists:
        return image_history

    if image_history and not stored_path:
        return image_history

    return None


def history_path_for_source(history, source_url):
    if not isinstance(history, dict):
        return None

    images = history.get("images")

    if not isinstance(images, dict):
        return None

    entry = images.get(source_url)

    if not isinstance(entry, dict):
        return None

    path = str(
        entry.get("path") or ""
    ).strip()

    if path and os.path.isfile(path):
        return path

    return None


def load_import_history():
    if not HISTORY_FILE.exists():
        return {
            "version": 1,
            "images": {},
            "scenes": {}
        }

    try:
        data = json.loads(
            HISTORY_FILE.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        data = {}

    images = data.get("images")

    if not isinstance(images, dict):
        images = {}

    scenes = data.get("scenes")

    if not isinstance(scenes, dict):
        scenes = {}

    return {
        "version": 1,
        "images": images,
        "scenes": scenes
    }


def save_import_history(history):
    write_json_atomic(
        HISTORY_FILE,
        history
    )


def merge_import_history(
    manifest,
    updated_images
):
    history = load_import_history()
    images_history = history["images"]
    scenes_history = history["scenes"]
    now = time.time()

    result_by_url = {}

    for item in updated_images or []:
        source_url = str(
            item.get("source_url") or ""
        ).strip()

        if source_url:
            result_by_url[source_url] = item

    for scene in manifest.get("scenes") or []:
        scene_url = str(
            scene.get("url") or ""
        ).strip()

        if not scene_url:
            continue

        previous = scenes_history.get(
            scene_url
        )

        if not isinstance(previous, dict):
            previous = {}

        imported_urls = set(
            previous.get("image_urls") or []
        )

        gallery_id = previous.get(
            "gallery_id"
        )

        for entry in scene.get("images") or []:
            source_url = str(
                entry.get("source_url") or ""
            ).strip()

            result = result_by_url.get(
                source_url
            )

            if not source_url or not result:
                continue

            imported_urls.add(
                source_url
            )

            if result.get("gallery_id"):
                gallery_id = result.get(
                    "gallery_id"
                )

            images_history[source_url] = {
                "id": result.get("id"),
                "scene_url": scene_url,
                "gallery_id": result.get(
                    "gallery_id"
                ),
                "path": result.get("path"),
                "imported_at": now
            }

        scenes_history[scene_url] = {
            "title": scene.get("title"),
            "gallery_id": gallery_id,
            "image_urls": sorted(
                imported_urls
            ),
            "updated_at": now
        }

    history["images"] = images_history
    history["scenes"] = scenes_history

    save_import_history(
        history
    )


def import_status(
    stash,
    status_items,
    deep=False
):
    history = load_import_history()
    images_history = history["images"]
    scenes_history = history["scenes"]
    changed = False

    scene_result = {}
    image_result = {}

    for status_item in status_items or []:
        scene_url = str(
            status_item.get("scene_url") or ""
        ).strip()

        requested_urls = []

        for value in status_item.get(
            "image_urls"
        ) or []:
            image_url = str(
                value or ""
            ).strip()

            if (
                image_url
                and image_url not in requested_urls
            ):
                requested_urls.append(
                    image_url
                )

        scene_history = scenes_history.get(
            scene_url
        )

        if not isinstance(
            scene_history,
            dict
        ):
            scene_history = {}

        gallery_id = scene_history.get(
            "gallery_id"
        )

        known_urls = set(
            scene_history.get(
                "image_urls"
            ) or []
        )

        validated_urls = set()

        for source_url in list(
            known_urls
        ):
            old_entry = images_history.get(
                source_url
            )

            valid_entry = validate_history_image(
                stash,
                source_url,
                old_entry,
                allow_lookup=deep
            )

            if valid_entry:
                images_history[
                    source_url
                ] = valid_entry

                validated_urls.add(
                    source_url
                )

                if (
                    not gallery_id
                    and valid_entry.get(
                        "gallery_id"
                    )
                ):
                    gallery_id = valid_entry.get(
                        "gallery_id"
                    )

                if (
                    source_url in requested_urls
                ):
                    image_result[
                        source_url
                    ] = {
                        "imported": True,
                        "image_id": valid_entry.get(
                            "id"
                        ),
                        "gallery_id": valid_entry.get(
                            "gallery_id"
                        ),
                        "path": valid_entry.get(
                            "path"
                        )
                    }

                if valid_entry != old_entry:
                    changed = True

            else:
                if source_url in images_history:
                    images_history.pop(
                        source_url,
                        None
                    )

                changed = True

                if source_url in requested_urls:
                    image_result[
                        source_url
                    ] = {
                        "imported": False,
                        "image_id": None,
                        "gallery_id": None,
                        "path": None
                    }

        known_urls = validated_urls

        if deep:
            for image_url in requested_urls:
                if image_url in known_urls:
                    continue

                old_entry = images_history.get(
                    image_url
                )

                valid_entry = validate_history_image(
                    stash,
                    image_url,
                    old_entry,
                    allow_lookup=True
                )

                if valid_entry:
                    images_history[
                        image_url
                    ] = valid_entry

                    known_urls.add(
                        image_url
                    )

                    image_result[
                        image_url
                    ] = {
                        "imported": True,
                        "image_id": valid_entry.get(
                            "id"
                        ),
                        "gallery_id": valid_entry.get(
                            "gallery_id"
                        ),
                        "path": valid_entry.get(
                            "path"
                        )
                    }

                    if (
                        not gallery_id
                        and valid_entry.get(
                            "gallery_id"
                        )
                    ):
                        gallery_id = valid_entry.get(
                            "gallery_id"
                        )

                    changed = True

                else:
                    if image_url in images_history:
                        images_history.pop(
                            image_url,
                            None
                        )
                        changed = True

                    image_result[
                        image_url
                    ] = {
                        "imported": False,
                        "image_id": None,
                        "gallery_id": None,
                        "path": None
                    }

        imported_urls = []

        if requested_urls:
            for image_url in requested_urls:
                if image_url in known_urls:
                    imported_urls.append(
                        image_url
                    )

                if image_url not in image_result:
                    image_history = images_history.get(
                        image_url
                    )

                    if (
                        image_url in known_urls
                        and isinstance(
                            image_history,
                            dict
                        )
                    ):
                        image_result[
                            image_url
                        ] = {
                            "imported": True,
                            "image_id": image_history.get(
                                "id"
                            ),
                            "gallery_id": image_history.get(
                                "gallery_id"
                            ),
                            "path": image_history.get(
                                "path"
                            )
                        }
                    elif deep:
                        image_result[
                            image_url
                        ] = {
                            "imported": False,
                            "image_id": None,
                            "gallery_id": None,
                            "path": None
                        }

        if scene_url:
            if known_urls:
                scenes_history[
                    scene_url
                ] = {
                    "title": status_item.get(
                        "title"
                    )
                    or scene_history.get(
                        "title"
                    ),
                    "gallery_id": gallery_id,
                    "image_urls": sorted(
                        known_urls
                    ),
                    "updated_at": time.time()
                }
            else:
                if scene_url in scenes_history:
                    scenes_history.pop(
                        scene_url,
                        None
                    )
                    changed = True

            total_count = len(
                requested_urls
            )

            imported_count = (
                len(imported_urls)
                if requested_urls
                else len(known_urls)
            )

            scene_result[
                scene_url
            ] = {
                "known": imported_count > 0,
                "gallery_id": gallery_id,
                "imported_count": imported_count,
                "total_count": total_count,
                "complete": bool(
                    total_count
                    and imported_count
                    >= total_count
                )
            }

    if changed:
        history["images"] = images_history
        history["scenes"] = scenes_history

        save_import_history(
            history
        )

    return {
        "status": "ok",
        "mode": "import_status",
        "scenes": scene_result,
        "images": image_result
    }


def cleanup_old_files(directory, max_age_seconds):
    if not directory.exists():
        return

    cutoff = time.time() - max_age_seconds

    for path in directory.glob("*.json"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def parse_json_arg(args, name, default):
    raw = args.get(name)

    if raw is None:
        return default

    if isinstance(raw, (dict, list, bool, int, float)):
        return raw

    raw = str(raw).strip()

    if not raw:
        return default

    return json.loads(raw)


def unique_names(values):
    result = []
    seen = set()

    for value in values or []:
        name = str(value or "").strip()

        if not name:
            continue

        key = name.casefold()

        if key in seen:
            continue

        seen.add(key)
        result.append(name)

    return result


def short_stable_hash(value, length=8):
    raw = str(value or "").encode(
        "utf-8",
        errors="replace"
    )

    return hashlib.sha1(
        raw
    ).hexdigest()[:length]


def sanitize_component(value, max_length=100):
    original = str(value or "").strip()
    cleaned = re.sub(
        r'[<>:"/\\|?*\x00-\x1f]',
        "_",
        original
    )
    cleaned = re.sub(
        r"\s+",
        " ",
        cleaned
    ).strip(" .")

    changed = cleaned != original

    if not cleaned:
        cleaned = "Unknown"
        changed = True

    reserved = {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5",
        "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5",
        "LPT6", "LPT7", "LPT8", "LPT9"
    }

    base_name = cleaned.split(
        ".",
        1
    )[0].upper()

    if base_name in reserved:
        cleaned = "_" + cleaned
        changed = True

    if len(cleaned) > max_length:
        changed = True

    suffix = ""

    if changed:
        suffix = "~" + short_stable_hash(
            original or cleaned
        )

    keep = max(
        1,
        max_length - len(suffix)
    )

    cleaned = cleaned[:keep].rstrip(
        " ."
    )

    if not cleaned:
        cleaned = "Unknown"

    result = cleaned + suffix

    return result[:max_length].rstrip(
        " ."
    )


def safe_filename(filename, source_url, max_length=120):
    filename = str(
        filename or "image.jpg"
    ).strip()

    stem = Path(filename).stem or "image"
    suffix = Path(filename).suffix

    if len(suffix) > 12:
        suffix = suffix[:12]

    stem_limit = max(
        16,
        max_length - len(suffix)
    )

    safe_stem = sanitize_component(
        stem,
        max_length=stem_limit
    )

    result = safe_stem + suffix

    if len(result) <= max_length:
        return result

    hash_suffix = "~" + short_stable_hash(
        source_url or filename
    )

    keep = max(
        8,
        max_length - len(suffix) - len(hash_suffix)
    )

    return (
        safe_stem[:keep].rstrip(" .")
        + hash_suffix
        + suffix
    )


def safe_destination_path(
    scene_folder,
    filename,
    source_url,
    max_path_length=245
):
    scene_folder = Path(scene_folder)
    safe_name = safe_filename(
        filename,
        source_url
    )

    destination = scene_folder / safe_name

    if len(str(destination)) <= max_path_length:
        return destination

    suffix = Path(safe_name).suffix
    stem = Path(safe_name).stem
    hash_suffix = "~" + short_stable_hash(
        source_url or safe_name
    )

    available = (
        max_path_length
        - len(str(scene_folder))
        - 1
        - len(suffix)
        - len(hash_suffix)
    )

    if available < 12:
        raise RuntimeError(
            "The configured download folder is too deep for a safe Windows "
            "image path. Choose a shorter PornPics Importer download folder."
        )

    short_name = (
        stem[:available].rstrip(" .")
        + hash_suffix
        + suffix
    )

    return scene_folder / short_name


def normalized_absolute(path):
    return os.path.normcase(
        os.path.abspath(
            os.path.expanduser(path)
        )
    )


def is_within_path(child, parent):
    child_norm = normalized_absolute(child)
    parent_norm = normalized_absolute(parent)

    try:
        return os.path.commonpath(
            [child_norm, parent_norm]
        ) == parent_norm
    except ValueError:
        return False


def normalize_gender_mode(value):
    value = str(value or "").strip().casefold()

    aliases = {
        "women": "women",
        "women only": "women",
        "women_only": "women",
        "female": "women",
        "female only": "women",
        "female_only": "women",
        "men": "men",
        "men only": "men",
        "men_only": "men",
        "male": "men",
        "male only": "men",
        "male_only": "men",
        "women_first": "women_first",
        "both": "women_first",
        "all": "women_first",
        "women and men": "women_first",
        "women and men - women first": "women_first",
        "women and men, women first": "women_first",
        "women_and_men": "women_first",
        "female and male - female first": "women_first",
        "female and male, female first": "women_first",
        "female_and_male": "women_first"
    }

    return aliases.get(value, "women")


def boolean_setting(
    settings,
    key,
    default=False
):
    value = settings.get(
        key
    )

    if isinstance(
        value,
        bool
    ):
        return value

    if isinstance(
        value,
        str
    ):
        normalized = value.strip().casefold()

        if normalized in (
            "true",
            "1",
            "yes",
            "on"
        ):
            return True

        if normalized in (
            "false",
            "0",
            "no",
            "off",
            ""
        ):
            return False

    if value is None:
        return bool(
            default
        )

    return bool(
        value
    )


def get_environment(stash):
    environment = stash.get_plugin_environment()
    settings = environment.get("settings") or {}

    output_path = str(
        settings.get("outputPath") or ""
    ).strip()

    try:
        search_limit = int(
            settings.get("searchLimit") or 0
        )
    except (TypeError, ValueError):
        search_limit = 0

    if search_limit <= 0:
        search_limit = DEFAULT_SEARCH_LIMIT

    gender_mode = normalize_gender_mode(
        settings.get("genderMode")
    )

    image_library_paths = []

    for item in environment.get("stashes") or []:
        if item.get("excludeImage"):
            continue

        path = str(item.get("path") or "").strip()

        if path:
            image_library_paths.append(path)

    output_valid = False

    if output_path:
        for library_path in image_library_paths:
            if is_within_path(output_path, library_path):
                output_valid = True
                break

    return {
        "output_path": output_path,
        "search_limit": search_limit,
        "gender_mode": gender_mode,
        "skip_tags": boolean_setting(
            settings,
            "skipTags",
            False
        ),
        "skip_studio": boolean_setting(
            settings,
            "skipStudio",
            False
        ),
        "skip_performers": boolean_setting(
            settings,
            "skipPerformers",
            False
        ),
        "hide_age_verification_scenes": boolean_setting(
            settings,
            "hideAgeVerificationScenes",
            False
        ),
        "image_library_paths": image_library_paths,
        "output_valid": output_valid,
        "create_galleries_from_folders": bool(
            environment.get("create_galleries_from_folders")
        )
    }


def require_output_path(environment):
    output_path = environment.get("output_path") or ""

    if not output_path:
        raise RuntimeError(
            "PornPics Importer download folder is empty. "
            "Set it first in Settings > Plugins > PornPics Importer."
        )

    if not environment.get("output_valid"):
        library_text = ", ".join(
            environment.get("image_library_paths") or []
        )

        raise RuntimeError(
            "The PornPics Importer download folder must be inside a Stash "
            "library path that scans images. Current image library paths: "
            + library_text
        )

    return Path(output_path)


def gender_group(gender):
    gender = str(gender or "").upper()

    if gender in ("FEMALE", "TRANSGENDER_FEMALE"):
        return "woman"

    if gender in ("MALE", "TRANSGENDER_MALE"):
        return "man"

    return "other"


def performer_metadata(stash, names, gender_mode):
    items = []

    for name in unique_names(names):
        performer = stash.find_performer(name)

        items.append({
            "name": name,
            "id": performer.get("id") if performer else None,
            "gender": performer.get("gender") if performer else None,
            "image_path": performer.get("image_path") if performer else None,
            "gender_group": gender_group(
                performer.get("gender") if performer else None
            )
        })

    if gender_mode == "women":
        items = [
            item
            for item in items
            if item["gender_group"] == "woman"
        ]
    elif gender_mode == "men":
        items = [
            item
            for item in items
            if item["gender_group"] == "man"
        ]
    else:
        order = {
            "woman": 0,
            "man": 1,
            "other": 2
        }

        items.sort(
            key=lambda item: (
                order.get(item["gender_group"], 2),
                item["name"].casefold()
            )
        )

    return items



def performer_names_for_mode(
    stash,
    current_name,
    names,
    gender_mode
):
    result = []
    current_key = str(current_name or "").strip().casefold()

    if current_name:
        result.append(current_name)

    for name in unique_names(names):
        if str(name).strip().casefold() == current_key:
            continue

        if gender_mode == "women_first":
            result.append(name)
            continue

        performer = stash.find_performer(name)

        # Keep unmatched PornPics names in the review. This allows the user
        # to map them to an existing Stash performer. Gender filtering is
        # applied to exact matches automatically and mapped performers are
        # validated when the import is prepared.
        if not performer:
            result.append(name)
            continue

        group = gender_group(
            performer.get("gender")
        )

        if gender_mode == "women" and group == "woman":
            result.append(name)

        if gender_mode == "men" and group == "man":
            result.append(name)

    return unique_names(result)

def enrich_scene_details(stash, details, environment):
    details["performer_meta"] = performer_metadata(
        stash,
        details.get("performers") or [],
        environment.get("gender_mode") or "women"
    )

    details["gender_mode"] = environment.get("gender_mode")
    return details


def search_performer(
    pp,
    stash,
    performer,
    page=1,
    seed="",
    total_count=None,
    request_id=None
):
    environment = get_environment(stash)
    per_page = environment["search_limit"]

    write_progress(
        request_id,
        "connect",
        "Connecting to PornPics",
        detail="Preparing a randomized result page"
    )

    result = pp.get_scenes_page(
        name=performer,
        page=page,
        per_page=per_page,
        seed=seed,
        total_count=total_count
    )

    scenes = result.get("scenes") or []

    write_progress(
        request_id,
        "prepare_results",
        "Preparing scene previews",
        current=len(scenes),
        total=len(scenes)
    )

    return {
        "status": "ok",
        "mode": "search_performer",
        "performer": performer,
        "count": len(scenes),
        "scene_per_page": per_page,
        "gender_mode": environment["gender_mode"],
        "hide_age_verification_scenes": bool(
            environment.get(
                "hide_age_verification_scenes"
            )
        ),
        "page": result.get("page") or 1,
        "total_count": result.get("total_count"),
        "total_pages": result.get("total_pages"),
        "has_previous": bool(result.get("has_previous")),
        "has_next": bool(result.get("has_next")),
        "randomized_source_pages": bool(
            result.get("randomized_source_pages")
        ),
        "scenes": scenes
    }


def global_context_search(
    pp,
    query,
    search_type="all",
    request_id=None
):
    write_progress(
        request_id,
        "connect",
        "Searching PornPics",
        detail=(
            str(search_type or "all").title()
            + " · "
            + str(query or "")
        )
    )

    direct_target = pp.resolve_pornpics_url(
        query
    )

    if direct_target:
        write_progress(
            request_id,
            "prepare_results",
            "Opening PornPics URL",
            current=1,
            total=1
        )

        return {
            "status": "ok",
            "mode": "global_context_search",
            "query": query,
            "search_type": search_type,
            "results": [],
            "direct_target": direct_target
        }

    results = pp.resolve_contexts(
        query,
        search_type
    )

    write_progress(
        request_id,
        "prepare_results",
        "Preparing search results",
        current=len(results),
        total=len(results)
    )

    return {
        "status": "ok",
        "mode": "global_context_search",
        "query": query,
        "search_type": search_type,
        "results": results
    }


def search_context(
    pp,
    stash,
    context_type,
    context_value,
    context_label=None,
    context_url=None,
    page=1,
    seed="",
    total_count=None,
    request_id=None
):
    environment = get_environment(stash)
    per_page = environment["search_limit"]
    context_type = str(
        context_type or "performer"
    ).strip().lower()
    context_value = str(
        context_value or ""
    ).strip()
    context_label = str(
        context_label
        or context_value
    ).strip()

    write_progress(
        request_id,
        "connect",
        "Connecting to PornPics",
        detail=(
            context_type.title()
            + " · "
            + context_label
        )
    )

    result = pp.get_context_scenes_page(
        context_type=context_type,
        value=context_value,
        page=page,
        per_page=per_page,
        seed=seed,
        total_count=total_count,
        context_url=context_url
    )

    scenes = result.get("scenes") or []

    write_progress(
        request_id,
        "prepare_results",
        "Preparing scene previews",
        current=len(scenes),
        total=len(scenes)
    )

    return {
        "status": "ok",
        "mode": "search_context",
        "performer": context_label,
        "context_type": context_type,
        "context_value": context_value,
        "context_label": context_label,
        "context_url": context_url,
        "count": len(scenes),
        "scene_per_page": per_page,
        "gender_mode": environment["gender_mode"],
        "hide_age_verification_scenes": bool(
            environment.get(
                "hide_age_verification_scenes"
            )
        ),
        "page": result.get("page") or 1,
        "total_count": result.get("total_count"),
        "total_pages": result.get("total_pages"),
        "has_previous": bool(
            result.get("has_previous")
        ),
        "has_next": bool(
            result.get("has_next")
        ),
        "randomized_source_pages": bool(
            result.get("randomized_source_pages")
        ),
        "scenes": scenes
    }


def load_scene(pp, stash, scene_url, request_id=None):
    write_progress(
        request_id,
        "fetch_scene",
        "Loading PornPics scene",
        detail="Fetching gallery metadata and full-size image links"
    )

    details = pp.get_images(scene_url)

    if not details:
        raise RuntimeError(
            "The PornPics scene could not be loaded."
        )

    details["source_url"] = scene_url

    environment = get_environment(stash)

    details[
        "hide_age_verification_scenes"
    ] = bool(
        environment.get(
            "hide_age_verification_scenes"
        )
    )

    if details.get(
        "age_verification_required"
    ):
        details[
            "performer_meta"
        ] = []

        details[
            "gender_mode"
        ] = environment.get(
            "gender_mode"
        )

        return {
            "status": "ok",
            "mode": "scene",
            "scene": details
        }

    write_progress(
        request_id,
        "match_performers",
        "Matching performers in Stash",
        detail="Preparing performer and gender metadata"
    )

    details = enrich_scene_details(
        stash,
        details,
        environment
    )

    return {
        "status": "ok",
        "mode": "scene",
        "scene": details
    }


def group_selection(selection):
    grouped = {}

    for item in selection:
        scene_url = str(
            item.get("sceneUrl") or ""
        ).strip()

        if not scene_url:
            continue

        if scene_url not in grouped:
            grouped[scene_url] = {
                "scene_id": item.get("sceneId"),
                "scene_title": item.get("sceneTitle"),
                "scene_url": scene_url,
                "images": []
            }

        grouped[scene_url]["images"].append(item)

    return list(grouped.values())


def load_selected_scene_details(
    pp,
    selection,
    request_id=None,
    phase="gather"
):
    groups = group_selection(selection)
    result = []
    total = len(groups)

    for index, group in enumerate(groups, start=1):
        write_progress(
            request_id,
            phase,
            "Gathering scene data",
            current=index,
            total=total,
            detail=group.get("scene_title")
        )

        details = pp.get_images(group["scene_url"])

        if not details:
            raise RuntimeError(
                "A selected PornPics scene could not be loaded: "
                + group["scene_url"]
            )

        result.append({
            "scene_id": group.get("scene_id"),
            "scene_title": details.get("title") or group.get("scene_title"),
            "scene_url": group["scene_url"],
            "selected_images": group["images"],
            "details": details
        })

    return result


def importer_tag_status(stash):
    current = stash.find_tag(IMPORTER_TAG)

    if current:
        return {
            "name": IMPORTER_TAG,
            "exists": True,
            "id": current.get("id"),
            "aliases": current.get("aliases") or [],
            "legacy_migration": False
        }

    legacy = stash.find_tag(LEGACY_IMPORTER_TAG)

    if legacy:
        return {
            "name": IMPORTER_TAG,
            "exists": True,
            "id": legacy.get("id"),
            "aliases": legacy.get("aliases") or [],
            "legacy_migration": True
        }

    return {
        "name": IMPORTER_TAG,
        "exists": False,
        "id": None,
        "aliases": [],
        "legacy_migration": False
    }


def entity_status(stash, kind, names):
    result = []

    for name in unique_names(names):
        if kind == "tag" and name == IMPORTER_TAG:
            result.append(importer_tag_status(stash))
            continue

        item = None

        if kind == "performer":
            item = stash.find_performer(name)
        elif kind == "studio":
            item = stash.find_studio(name)
        elif kind == "tag":
            item = stash.find_tag(name)

        row = {
            "name": name,
            "exists": bool(item),
            "id": item.get("id") if item else None
        }

        if kind == "performer":
            row["gender"] = item.get("gender") if item else None
            row["image_path"] = item.get("image_path") if item else None
            row["gender_group"] = gender_group(
                item.get("gender") if item else None
            )

        if kind == "tag":
            row["aliases"] = item.get("aliases") if item else []

        result.append(row)

    return result


def canonical_image_url(details, selected):
    selected_url = str(
        selected.get("imageUrl")
        or selected.get("thumbnail")
        or ""
    ).strip()

    selected_name = Path(
        urlparse(selected_url).path
    ).name.casefold()

    for image in details.get("images") or []:
        full_url = str(image.get("url") or "").strip()
        thumb_url = str(image.get("thumbnail") or "").strip()

        full_name = Path(
            urlparse(full_url).path
        ).name.casefold()

        thumb_name = Path(
            urlparse(thumb_url).path
        ).name.casefold()

        if selected_name and selected_name in (full_name, thumb_name):
            if full_url:
                return full_url

    if "/460/" in selected_url:
        selected_url = selected_url.replace(
            "/460/",
            "/1280/"
        )

    return selected_url


def selected_image_preview(details, selected):
    source_url = canonical_image_url(details, selected)

    return {
        "key": selected.get("key"),
        "source_url": source_url,
        "thumbnail": selected.get("thumbnail") or source_url,
        "index": selected.get("index"),
        "source": selected.get("source")
    }


def preflight_import(
    pp,
    stash,
    performer_name,
    selection,
    request_id=None,
    context_type="performer",
    context_value=None
):
    environment = get_environment(stash)
    require_output_path(environment)

    context_type = str(
        context_type or "performer"
    ).strip().lower()

    context_value = str(
        context_value
        or performer_name
        or "PornPics"
    ).strip()

    current_performer = None

    if context_type == "performer":
        performer_name = str(
            performer_name
            or context_value
            or ""
        ).strip()

        if performer_name:
            current_performer = stash.find_performer(
                performer_name
            )
    else:
        performer_name = ""

    scenes = load_selected_scene_details(
        pp,
        selection,
        request_id=request_id,
        phase="gather"
    )

    performer_names = []

    if (
        performer_name
        and not environment.get(
            "skip_performers"
        )
    ):
        performer_names.append(
            performer_name
        )

    studio_names = []
    tag_names = []

    if not environment.get(
        "skip_tags"
    ):
        tag_names.append(
            IMPORTER_TAG
        )
    preview_scenes = []
    total = len(scenes)

    for index, scene in enumerate(scenes, start=1):
        details = scene["details"]

        if not environment.get(
            "skip_performers"
        ):
            performer_names.extend(
                performer_names_for_mode(
                    stash,
                    performer_name,
                    details.get("performers") or [],
                    environment.get("gender_mode") or "women"
                )
            )

        if (
            not environment.get(
                "skip_studio"
            )
            and details.get(
                "studio"
            )
        ):
            studio_names.append(
                details["studio"]
            )

        if not environment.get(
            "skip_tags"
        ):
            tag_names.extend(
                details.get("tags") or []
            )

        write_progress(
            request_id,
            "scene_match",
            "Searching Stash for matching video scenes",
            current=index,
            total=total,
            detail=scene.get("scene_title")
        )

        video_candidates = stash.find_scene_candidates(
            title=scene.get("scene_title"),
            performer_names=details.get("performers") or [],
            studio_name=details.get("studio"),
            limit=8
        )

        selected_images = [
            selected_image_preview(
                details,
                item
            )
            for item in (scene.get("selected_images") or [])
        ]

        preview_scenes.append({
            "scene_id": scene.get("scene_id"),
            "title": scene.get("scene_title"),
            "url": scene.get("scene_url"),
            "selected_count": len(selected_images),
            "selected_images": selected_images,
            "studio": details.get("studio"),
            "performers": unique_names(
                details.get("performers") or []
            ),
            "tags": unique_names(
                [IMPORTER_TAG] + (details.get("tags") or [])
            ),
            "scene_tags": (
                []
                if environment.get(
                    "skip_tags"
                )
                else unique_names(
                    details.get("tags") or []
                )
            ),
            "video_candidates": video_candidates
        })

    write_progress(
        request_id,
        "metadata_match",
        "Matching PornPics metadata in Stash",
        detail="Checking enabled metadata"
    )

    return {
        "status": "ok",
        "mode": "preflight_import",
        "performer": performer_name,
        "context_type": context_type,
        "context_value": context_value,
        "output_path": environment["output_path"],
        "search_limit": environment["search_limit"],
        "gender_mode": environment["gender_mode"],
        "skip_tags": bool(
            environment.get(
                "skip_tags"
            )
        ),
        "skip_studio": bool(
            environment.get(
                "skip_studio"
            )
        ),
        "skip_performers": bool(
            environment.get(
                "skip_performers"
            )
        ),
        "create_galleries_from_folders": environment[
            "create_galleries_from_folders"
        ],
        "entities": {
            "performers": entity_status(
                stash,
                "performer",
                performer_names
            ),
            "studios": entity_status(
                stash,
                "studio",
                studio_names
            ),
            "tags": entity_status(
                stash,
                "tag",
                tag_names
            )
        },
        "scenes": preview_scenes
    }


def validate_download_url(url):
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise RuntimeError(
            "Invalid image URL: " + url
        )

    host = parsed.netloc.lower()

    if not host.endswith("pornpics.com"):
        raise RuntimeError(
            "Unexpected image host. Download cancelled: "
            + host
        )


def approved_set(options, key):
    return {
        str(value or "").strip().casefold()
        for value in (options.get(key) or [])
        if str(value or "").strip()
    }


def normalized_mapping(options, key):
    raw = options.get(key) or {}
    result = {}

    if not isinstance(raw, dict):
        return result

    for source, destination in raw.items():
        source_key = str(source or "").strip().casefold()
        destination_value = str(destination or "").strip()

        if source_key and destination_value:
            result[source_key] = destination_value

    return result


def normalized_tag_mode(
    options
):
    mode = str(
        (
            options
            or {}
        ).get(
            "tag_mode"
        )
        or "custom"
    ).strip().lower()

    if mode not in (
        "none",
        "all",
        "custom"
    ):
        mode = "custom"

    return mode


def normalized_image_tag_assignments(
    options
):
    raw = options.get(
        "image_tag_assignments"
    ) or {}

    result = {}

    if not isinstance(
        raw,
        dict
    ):
        return result

    for scene_url, image_map in raw.items():
        scene_key = str(
            scene_url or ""
        ).strip().casefold()

        if (
            not scene_key
            or not isinstance(
                image_map,
                dict
            )
        ):
            continue

        normalized_images = {}

        for source_url, names in image_map.items():
            source_key = str(
                source_url or ""
            ).strip()

            if not source_key:
                continue

            normalized_names = []

            for name in names or []:
                value = str(
                    name or ""
                ).strip()

                if value:
                    normalized_names.append(
                        value
                    )

            normalized_images[
                source_key
            ] = unique_names(
                normalized_names
            )

        result[
            scene_key
        ] = normalized_images

    return result


def assigned_tag_names_for_image(
    assignments,
    scene_url,
    source_url
):
    scene_key = str(
        scene_url or ""
    ).strip().casefold()

    source_url = str(
        source_url or ""
    ).strip()

    scene_map = assignments.get(
        scene_key
    ) or {}

    if source_url in scene_map:
        return scene_map[
            source_url
        ]

    source_key = source_url.casefold()

    for candidate_url, names in scene_map.items():
        if str(
            candidate_url or ""
        ).casefold() == source_key:
            return names

    return []


def resolve_entities_for_scene(
    stash,
    performer_name,
    details,
    approvals,
    gender_mode="women",
    skip_performers=False,
    skip_studio=False,
    skip_tags=False
):
    create_performers = approved_set(
        approvals,
        "create_performers"
    )
    create_studios = approved_set(
        approvals,
        "create_studios"
    )
    create_tags = approved_set(
        approvals,
        "create_tags"
    )
    performer_aliases = normalized_mapping(
        approvals,
        "performer_aliases"
    )
    studio_aliases = normalized_mapping(
        approvals,
        "studio_aliases"
    )
    tag_aliases = normalized_mapping(
        approvals,
        "tag_aliases"
    )

    performer_ids = []

    if not skip_performers:
        performer_names = performer_names_for_mode(
            stash,
            performer_name,
            details.get("performers") or [],
            gender_mode
        )

        for name in performer_names:
            item = stash.find_performer(
                name
            )

            if not item:
                mapped_id = performer_aliases.get(
                    name.casefold()
                )

                if mapped_id:
                    item = stash.add_performer_alias(
                        mapped_id,
                        name
                    )

                    if item:
                        group = gender_group(
                            item.get("gender")
                        )

                        allowed = (
                            gender_mode == "women_first"
                            or (
                                gender_mode == "women"
                                and group == "woman"
                            )
                            or (
                                gender_mode == "men"
                                and group == "man"
                            )
                        )

                        if not allowed:
                            log(
                                "PPics: mapped performer '"
                                + name
                                + "' was skipped by the gender filter"
                            )
                            item = None
                        else:
                            log(
                                "PPics: mapped performer '"
                                + name
                                + "' to existing performer '"
                                + str(item.get("name"))
                                + "' and added it as an alias"
                            )

            if (
                not item
                and name.casefold()
                in create_performers
            ):
                item = stash.create_performer(
                    name
                )

                log(
                    "PPics: created performer '"
                    + name
                    + "'"
                )

            if (
                item
                and item["id"]
                not in performer_ids
            ):
                performer_ids.append(
                    item["id"]
                )

    studio_id = None

    if not skip_studio:
        studio_name = str(
            details.get("studio") or ""
        ).strip()

        if studio_name:
            studio = stash.find_studio(
                studio_name
            )

            if not studio:
                mapped_id = studio_aliases.get(
                    studio_name.casefold()
                )

                if mapped_id:
                    studio = stash.add_studio_alias(
                        mapped_id,
                        studio_name
                    )

                    if studio:
                        log(
                            "PPics: mapped studio '"
                            + studio_name
                            + "' to existing studio '"
                            + str(studio.get("name"))
                            + "' and added it as an alias"
                        )

            if (
                not studio
                and studio_name.casefold()
                in create_studios
            ):
                studio = stash.create_studio(
                    studio_name
                )

                log(
                    "PPics: created studio '"
                    + studio_name
                    + "'"
                )

            if studio:
                studio_id = studio[
                    "id"
                ]

    importer_tag = stash.find_tag(
        IMPORTER_TAG
    )

    if not importer_tag:
        legacy = stash.find_tag(
            LEGACY_IMPORTER_TAG
        )

        if legacy:
            importer_tag = (
                stash.migrate_legacy_importer_tag()
            )

            log(
                "PPics: migrated legacy PPics tag to PornPics Importer"
            )

    if (
        not importer_tag
        and (
            skip_tags
            or IMPORTER_TAG.casefold()
            in create_tags
        )
    ):
        importer_tag = stash.create_tag(
            IMPORTER_TAG
        )

        log(
            "PPics: created internal PornPics Importer marker tag"
        )

    importer_tag_id = None

    if importer_tag:
        importer_tag_id = importer_tag.get(
            "id"
        )

    gallery_tag_ids = []
    scene_tag_ids_by_name = {}

    if importer_tag_id:
        gallery_tag_ids.append(
            importer_tag_id
        )

    if not skip_tags:
        for name in unique_names(
            details.get("tags") or []
        ):
            tag = stash.find_tag(
                name
            )

            if not tag:
                mapped_id = tag_aliases.get(
                    name.casefold()
                )

                if mapped_id:
                    tag = stash.add_tag_alias(
                        mapped_id,
                        name
                    )

                    if tag:
                        log(
                            "PPics: mapped tag '"
                            + name
                            + "' to existing tag '"
                            + str(tag.get("name"))
                            + "' and added it as an alias"
                        )

            if (
                not tag
                and name.casefold()
                in create_tags
            ):
                tag = stash.create_tag(
                    name
                )

                log(
                    "PPics: created tag '"
                    + name
                    + "'"
                )

            if tag:
                tag_id = tag.get(
                    "id"
                )

                if tag_id:
                    scene_tag_ids_by_name[
                        name.casefold()
                    ] = tag_id

                    if tag_id not in gallery_tag_ids:
                        gallery_tag_ids.append(
                            tag_id
                        )

    return {
        "performer_ids": performer_ids,
        "studio_id": studio_id,
        "tag_ids": gallery_tag_ids,
        "importer_tag_id": importer_tag_id,
        "scene_tag_ids_by_name": scene_tag_ids_by_name
    }



def prepare_import(
    pp,
    stash,
    performer_name,
    selection,
    approvals,
    request_id=None,
    context_type="performer",
    context_value=None
):
    environment = get_environment(stash)
    output_root = require_output_path(environment)

    context_type = str(
        context_type or "performer"
    ).strip().lower()

    context_value = str(
        context_value
        or performer_name
        or "PornPics"
    ).strip()

    current_performer = None

    if context_type == "performer":
        performer_name = str(
            performer_name
            or context_value
            or ""
        ).strip()

        if performer_name:
            current_performer = stash.find_performer(
                performer_name
            )
    else:
        performer_name = ""

    write_progress(
        request_id,
        "gather",
        "Gathering PornPics scene data",
        detail="Preparing selected images for import"
    )

    scenes = load_selected_scene_details(
        pp,
        selection,
        request_id=request_id,
        phase="gather"
    )

    context_folder = sanitize_component(
        context_value,
        max_length=80
    )

    downloader = Downloader()
    import_history = load_import_history()
    source_registry = {}
    new_download_paths = []
    manifest_scenes = []
    downloaded_count = 0
    reused_count = 0
    downloaded_bytes = 0
    newly_created_files = []
    failed_downloads = []
    total_images = sum(
        len(scene.get("selected_images") or [])
        for scene in scenes
    )
    processed_images = 0

    scene_links = normalized_mapping(
        approvals,
        "scene_links"
    )
    covers = normalized_mapping(
        approvals,
        "covers"
    )
    organized = bool(
        approvals.get("organized")
    )

    tag_mode = normalized_tag_mode(
        approvals
    )

    if environment.get(
        "skip_tags"
    ):
        tag_mode = "none"

    image_tag_assignments = (
        normalized_image_tag_assignments(
            approvals
        )
    )

    try:
        for scene in scenes:
            details = scene["details"]
            scene_title = (
                details.get("title")
                or scene.get("scene_title")
                or "PornPics scene"
            )

            scene_folder = (
                output_root
                / context_folder
                / sanitize_component(
                    scene_title,
                    max_length=100
                )
            )

            image_entries = []

            for selected in scene.get("selected_images") or []:
                image_number = processed_images + 1

                source_url = canonical_image_url(
                    details,
                    selected
                )

                if not source_url:
                    raise RuntimeError(
                        "No full-size URL was found for a selected image."
                    )

                validate_download_url(source_url)

                write_progress(
                    request_id,
                    "download",
                    "Checking selected image",
                    current=image_number,
                    total=total_images,
                    detail=scene_title,
                    completed=processed_images,
                    bytes_done=downloaded_bytes
                )

                registered = source_registry.get(
                    source_url
                )

                if registered:
                    reused_count += 1
                    processed_images += 1

                    image_entries.append(
                        dict(registered)
                    )

                    write_progress(
                        request_id,
                        "download",
                        "Reusing selected image",
                        current=image_number,
                        total=total_images,
                        detail=scene_title,
                        completed=processed_images,
                        bytes_done=downloaded_bytes
                    )

                    continue

                existing_image = stash.find_image_by_url(
                    source_url
                )

                existing_live_path = existing_path_from_image(
                    existing_image
                )

                if existing_image and existing_live_path:
                    reused_count += 1
                    processed_images += 1

                    entry = {
                        "source_url": source_url,
                        "path": existing_live_path,
                        "existing_image_id": existing_image["id"]
                    }

                    source_registry[
                        source_url
                    ] = dict(entry)

                    image_entries.append(
                        entry
                    )

                    write_progress(
                        request_id,
                        "download",
                        "Reusing existing Stash image",
                        current=image_number,
                        total=total_images,
                        detail=scene_title,
                        completed=processed_images,
                        bytes_done=downloaded_bytes
                    )

                    continue

                historic_path = history_path_for_source(
                    import_history,
                    source_url
                )

                if historic_path:
                    reused_count += 1
                    processed_images += 1

                    entry = {
                        "source_url": source_url,
                        "path": historic_path,
                        "existing_image_id": None
                    }

                    source_registry[
                        source_url
                    ] = dict(entry)

                    image_entries.append(
                        entry
                    )

                    new_download_paths.append(
                        historic_path
                    )

                    write_progress(
                        request_id,
                        "download",
                        "Reusing existing downloaded file",
                        current=image_number,
                        total=total_images,
                        detail=scene_title,
                        completed=processed_images,
                        bytes_done=downloaded_bytes
                    )

                    continue

                filename = downloader.filename_from_url(
                    source_url
                )
                destination = safe_destination_path(
                    scene_folder,
                    filename,
                    source_url
                )

                write_progress(
                    request_id,
                    "download",
                    "Downloading full-size image",
                    current=image_number,
                    total=total_images,
                    detail=scene_title,
                    completed=processed_images,
                    bytes_done=downloaded_bytes
                )

                try:
                    result = downloader.download(
                        source_url,
                        destination
                    )

                    if result["downloaded"]:
                        downloaded_count += 1
                        downloaded_bytes += int(
                            result.get("size") or 0
                        )
                        newly_created_files.append(
                            destination
                        )
                    else:
                        reused_count += 1

                    new_download_paths.append(
                        str(destination)
                    )

                    entry = {
                        "source_url": source_url,
                        "path": str(destination),
                        "existing_image_id": None
                    }

                    source_registry[
                        source_url
                    ] = dict(entry)

                    image_entries.append(
                        entry
                    )

                    processed_images += 1

                    write_progress(
                        request_id,
                        "download",
                        "Image ready",
                        current=image_number,
                        total=total_images,
                        detail=scene_title,
                        completed=processed_images,
                        bytes_done=downloaded_bytes
                    )

                except Exception as error:
                    processed_images += 1

                    failed_downloads.append({
                        "key": selected.get("key"),
                        "sceneId": selected.get("sceneId"),
                        "sceneTitle": selected.get("sceneTitle") or scene_title,
                        "sceneUrl": selected.get("sceneUrl") or scene.get("scene_url"),
                        "imageUrl": source_url,
                        "thumbnail": selected.get("thumbnail") or source_url,
                        "index": selected.get("index"),
                        "source": selected.get("source") or "scene",
                        "error": str(error)
                    })

                    write_progress(
                        request_id,
                        "download",
                        "Skipping a failed image",
                        current=image_number,
                        total=total_images,
                        detail=(
                            scene_title
                            + " · "
                            + str(error)
                        ),
                        completed=processed_images,
                        bytes_done=downloaded_bytes
                    )

                    log(
                        "PPics: image download failed and was skipped: "
                        + source_url
                        + " · "
                        + str(error)
                    )

            scene_key = str(scene.get("scene_url") or "").casefold()

            manifest_scenes.append({
                "scene_id": scene.get("scene_id"),
                "title": scene_title,
                "url": scene.get("scene_url"),
                "date": details.get("date"),
                "details": details,
                "folder_path": str(scene_folder),
                "images": image_entries,
                "linked_scene_id": scene_links.get(scene_key),
                "cover_source_url": covers.get(scene_key),
                "organized": organized
            })

    except Exception:
        for path in newly_created_files:
            try:
                if path.exists():
                    path.unlink()
            except OSError:
                pass

        raise

    write_progress(
        request_id,
        "metadata",
        "Resolving Stash metadata",
        detail="Applying performer, studio and tag choices"
    )

    for scene in manifest_scenes:
        metadata = resolve_entities_for_scene(
            stash,
            performer_name,
            scene["details"],
            approvals,
            gender_mode=environment.get("gender_mode") or "women",
            skip_performers=bool(
                environment.get(
                    "skip_performers"
                )
            ),
            skip_studio=bool(
                environment.get(
                    "skip_studio"
                )
            ),
            skip_tags=bool(
                environment.get(
                    "skip_tags"
                )
                or tag_mode == "none"
            )
        )

        for entry in scene.get("images") or []:
            image_tag_ids = []

            importer_tag_id = metadata.get(
                "importer_tag_id"
            )

            if importer_tag_id:
                image_tag_ids.append(
                    importer_tag_id
                )

            if (
                not environment.get(
                    "skip_tags"
                )
                and tag_mode != "none"
            ):
                assigned_names = []

                if tag_mode == "all":
                    assigned_names = (
                        scene.get(
                            "details"
                        )
                        or {}
                    ).get(
                        "tags"
                    ) or []

                if tag_mode == "custom":
                    assigned_names = (
                        assigned_tag_names_for_image(
                            image_tag_assignments,
                            scene.get("url"),
                            entry.get("source_url")
                        )
                    )

                tag_map = (
                    metadata.get(
                        "scene_tag_ids_by_name"
                    )
                    or {}
                )

                for name in assigned_names:
                    tag_id = tag_map.get(
                        str(
                            name or ""
                        ).strip().casefold()
                    )

                    if (
                        tag_id
                        and tag_id
                        not in image_tag_ids
                    ):
                        image_tag_ids.append(
                            tag_id
                        )

            entry["tag_ids"] = image_tag_ids

        scene["metadata"] = metadata
        existing_gallery = stash.find_gallery_by_url(
            scene["url"]
        )
        gallery = None
        scene_ids = []

        if scene.get("linked_scene_id"):
            scene_ids.append(
                scene["linked_scene_id"]
            )

        if environment.get("create_galleries_from_folders"):
            if existing_gallery:
                log(
                    "PPics: existing gallery "
                    + str(existing_gallery.get("id"))
                    + " will be reconciled with the folder gallery after scan"
                )
        else:
            if existing_gallery:
                gallery = stash.update_gallery_metadata(
                    gallery=existing_gallery,
                    title=scene["title"],
                    url=scene["url"],
                    performer_ids=metadata["performer_ids"],
                    studio_id=metadata["studio_id"],
                    tag_ids=metadata["tag_ids"],
                    date=scene.get("date"),
                    scene_ids=scene_ids,
                    organized=organized
                )
            elif len(scene["images"]) > 1:
                gallery = stash.create_gallery(
                    title=scene["title"],
                    url=scene["url"],
                    performer_ids=metadata["performer_ids"],
                    studio_id=metadata["studio_id"],
                    tag_ids=metadata["tag_ids"],
                    date=scene.get("date"),
                    scene_ids=scene_ids,
                    organized=organized
                )

        scene["gallery_id"] = gallery.get("id") if gallery else None
        scene["folder_gallery_mode"] = bool(
            environment.get("create_galleries_from_folders")
        )

    write_progress(
        request_id,
        "manifest",
        "Saving import plan",
        detail="Preparing the Stash scan"
    )

    import_id = uuid.uuid4().hex
    manifest = {
        "import_id": import_id,
        "performer": performer_name,
        "context_type": context_type,
        "context_value": context_value,
        "output_path": str(output_root),
        "created_at": time.time(),
        "organized": organized,
        "tag_mode": tag_mode,
        "scenes": manifest_scenes
    }

    write_json_atomic(
        STATE_DIR / (import_id + ".json"),
        manifest
    )

    scan_job_id = None

    if new_download_paths:
        write_progress(
            request_id,
            "scan",
            "Starting the Stash scan",
            current=len(set(new_download_paths)),
            total=len(set(new_download_paths)),
            detail="New files are ready for indexing"
        )

        scan_job_id = stash.start_scan(
            list(dict.fromkeys(new_download_paths))
        )
    else:
        write_progress(
            request_id,
            "reuse",
            "Reusing existing Stash images",
            detail="No new files need to be scanned"
        )

    return {
        "status": "ok",
        "mode": "prepare_import",
        "import_id": import_id,
        "scan_job_id": scan_job_id,
        "downloaded": downloaded_count,
        "reused": reused_count,
        "files_for_scan": len(set(new_download_paths)),
        "output_path": str(output_root),
        "failed": failed_downloads,
        "failed_count": len(failed_downloads),
        "requested": total_images
    }


def same_path(first, second):
    if not first or not second:
        return False

    return normalized_absolute(first) == normalized_absolute(second)


def folder_galleries_for_scene(images, folder_path):
    galleries = {}

    for image in images:
        for gallery in image.get("galleries") or []:
            folder = gallery.get("folder") or {}
            gallery_folder_path = folder.get("path")

            if same_path(gallery_folder_path, folder_path):
                galleries[str(gallery["id"])] = gallery

    return list(galleries.values())


def is_safe_ppics_duplicate(gallery, scene_url, scene_title):
    if not gallery:
        return False

    folder = gallery.get("folder")

    if folder and folder.get("path"):
        return False

    urls = gallery.get("urls") or []

    if scene_url not in urls:
        return False

    gallery_title = str(
        gallery.get("title") or ""
    ).strip().casefold()

    wanted_title = str(
        scene_title or ""
    ).strip().casefold()

    if gallery_title and wanted_title and gallery_title != wanted_title:
        return False

    return True


def finalize_import(stash, import_id, request_id=None):
    manifest_path = STATE_DIR / (import_id + ".json")

    if not manifest_path.exists():
        raise RuntimeError(
            "PornPics Importer state was not found: " + import_id
        )

    manifest = json.loads(
        manifest_path.read_text(encoding="utf-8")
    )

    updated = []
    missing = []
    galleries_updated = 0
    duplicates_removed = 0
    gallery_results = []
    standalone_results = []
    linked_scene_results = []
    total_scenes = len(manifest.get("scenes") or [])

    for scene_index, scene in enumerate(
        manifest.get("scenes") or [],
        start=1
    ):
        write_progress(
            request_id,
            "finalize",
            "Applying Stash metadata",
            current=scene_index,
            total=total_scenes,
            detail=scene.get("title")
        )

        metadata = scene.get("metadata") or {}
        folder_path = scene.get("folder_path")
        scene_url = scene.get("url")
        scene_title = scene.get("title")
        selected_count = len(scene.get("images") or [])
        organized = bool(scene.get("organized"))
        linked_scene_id = scene.get("linked_scene_id")
        scene_ids = []

        if linked_scene_id:
            scene_ids.append(linked_scene_id)

        resolved = []

        for entry in scene.get("images") or []:
            source_url = entry.get("source_url")
            image = None
            existing_id = entry.get("existing_image_id")

            if existing_id:
                image = stash.find_image_by_id(existing_id)

            if not image and entry.get("path"):
                image = stash.find_image_by_path(entry["path"])

            if not image:
                missing.append({
                    "path": entry.get("path"),
                    "source_url": source_url
                })
                continue

            resolved.append({
                "entry": entry,
                "image": image
            })

        resolved_images = [
            item["image"]
            for item in resolved
        ]

        folder_galleries = folder_galleries_for_scene(
            resolved_images,
            folder_path
        )

        existing_url_gallery = stash.find_gallery_by_url(
            scene_url
        )

        target_gallery = None
        galleries_to_remove = []
        gallery_is_wanted = (
            selected_count > 1
            or existing_url_gallery is not None
        )

        if gallery_is_wanted:
            if folder_galleries:
                target_gallery = stash.find_gallery_by_id(
                    folder_galleries[0]["id"]
                )

                target_gallery = stash.update_gallery_metadata(
                    gallery=target_gallery,
                    title=scene_title,
                    url=scene_url,
                    performer_ids=metadata.get("performer_ids") or [],
                    studio_id=metadata.get("studio_id"),
                    tag_ids=metadata.get("tag_ids") or [],
                    date=scene.get("date"),
                    scene_ids=scene_ids,
                    organized=organized
                )

                galleries_updated += 1

                if (
                    existing_url_gallery
                    and str(existing_url_gallery.get("id"))
                    != str(target_gallery.get("id"))
                    and is_safe_ppics_duplicate(
                        existing_url_gallery,
                        scene_url,
                        scene_title
                    )
                ):
                    galleries_to_remove.append(
                        existing_url_gallery
                    )

            elif existing_url_gallery:
                target_gallery = stash.update_gallery_metadata(
                    gallery=existing_url_gallery,
                    title=scene_title,
                    url=scene_url,
                    performer_ids=metadata.get("performer_ids") or [],
                    studio_id=metadata.get("studio_id"),
                    tag_ids=metadata.get("tag_ids") or [],
                    date=scene.get("date"),
                    scene_ids=scene_ids,
                    organized=organized
                )

                galleries_updated += 1

            elif selected_count > 1:
                target_gallery = stash.create_gallery(
                    title=scene_title,
                    url=scene_url,
                    performer_ids=metadata.get("performer_ids") or [],
                    studio_id=metadata.get("studio_id"),
                    tag_ids=metadata.get("tag_ids") or [],
                    date=scene.get("date"),
                    scene_ids=scene_ids,
                    organized=organized
                )

                galleries_updated += 1

        else:
            galleries_to_remove.extend(folder_galleries)

        gallery_id = None

        if target_gallery:
            gallery_id = target_gallery.get("id")

            gallery_results.append({
                "id": gallery_id,
                "title": target_gallery.get("title") or scene_title,
                "linked_scene_id": linked_scene_id
            })

            if linked_scene_id:
                linked_scene_results.append({
                    "gallery_id": gallery_id,
                    "scene_id": linked_scene_id,
                    "title": scene_title
                })

        cover_image_id = None
        cover_source_url = str(
            scene.get("cover_source_url") or ""
        ).strip()

        for item in resolved:
            entry = item["entry"]
            image = item["image"]
            source_url = entry.get("source_url")

            try:
                result = stash.update_image_metadata(
                    image=image,
                    source_url=source_url,
                    performer_ids=metadata.get("performer_ids") or [],
                    studio_id=metadata.get("studio_id"),
                    tag_ids=entry.get("tag_ids") or [],
                    gallery_id=gallery_id,
                    organized=organized
                )

            except Exception as error:
                missing.append({
                    "path": entry.get("path"),
                    "source_url": source_url,
                    "error": str(error)
                })

                log(
                    "PPics: image metadata update failed and was skipped: "
                    + str(source_url)
                    + " · "
                    + str(error)
                )

                continue

            current_path = existing_path_from_image(
                image
            )

            if not current_path:
                candidate_path = str(
                    entry.get("path") or ""
                ).strip()

                if (
                    candidate_path
                    and os.path.isfile(
                        candidate_path
                    )
                ):
                    current_path = candidate_path

            image_result = {
                "id": result.get("id"),
                "title": result.get("title") or imageFilename(source_url),
                "source_url": source_url,
                "gallery_id": gallery_id,
                "path": current_path
            }

            updated.append(image_result)

            if not gallery_id:
                standalone_results.append(image_result)

            if (
                gallery_id
                and cover_source_url
                and str(source_url or "").strip() == cover_source_url
            ):
                cover_image_id = result.get("id")

        if target_gallery and cover_image_id:
            stash.set_gallery_cover(
                target_gallery["id"],
                cover_image_id
            )

        removed_ids = set()

        for gallery in galleries_to_remove:
            gallery_id_to_remove = str(
                gallery.get("id") or ""
            )

            if not gallery_id_to_remove:
                continue

            if gallery_id_to_remove in removed_ids:
                continue

            if (
                target_gallery
                and gallery_id_to_remove == str(target_gallery.get("id"))
            ):
                continue

            if stash.destroy_gallery(gallery_id_to_remove):
                removed_ids.add(gallery_id_to_remove)
                duplicates_removed += 1

                log(
                    "PPics: removed duplicate or automatic gallery "
                    + gallery_id_to_remove
                    + " for '"
                    + str(scene_title)
                    + "'"
                )

        if target_gallery:
            log(
                "PPics: using gallery "
                + str(target_gallery.get("id"))
                + " with PornPics metadata for '"
                + str(scene_title)
                + "'"
            )

    if not missing:
        try:
            manifest_path.unlink()
        except OSError:
            pass

    status = "ok"

    if missing:
        status = "partial"

    unique_galleries = {}

    for item in gallery_results:
        unique_galleries[str(item["id"])] = item

    unique_standalone = {}

    for item in standalone_results:
        unique_standalone[str(item["id"])] = item

    try:
        merge_import_history(
            manifest,
            updated
        )
    except Exception as error:
        log(
            "PPics: import history could not be updated: "
            + str(error)
        )

    return {
        "status": status,
        "mode": "finalize_import",
        "import_id": import_id,
        "updated": len(updated),
        "missing": missing,
        "scenes": total_scenes,
        "galleries_updated": galleries_updated,
        "duplicates_removed": duplicates_removed,
        "galleries": list(unique_galleries.values()),
        "standalone_images": list(unique_standalone.values()),
        "images": updated,
        "linked_video_scenes": linked_scene_results
    }


def imageFilename(url):
    try:
        return Path(urlparse(str(url or "")).path).name or "Image"
    except Exception:
        return "Image"


def main():
    raw = sys.stdin.read()

    if not raw.strip():
        print(json.dumps({
            "error": "No Stash plugin input was received."
        }))
        return

    data = json.loads(raw)
    args = data.get("args") or {}
    server_connection = data.get("server_connection")

    mode = str(
        args.get("mode") or ""
    ).strip()

    ensure_cache_for_stash_process()

    if mode == "clear_cache":
        removed = clear_cache_files()

        print(json.dumps({
            "output": {
                "message": (
                    "PornPics cache cleared. "
                    + str(removed)
                    + " cached file(s) removed."
                )
            }
        }))

        return

    if mode == "clear_session":
        token = rotate_session_reset_token()

        print(json.dumps({
            "output": {
                "message": (
                    "PornPics browser session data will be reset "
                    "the next time the PornPics UI communicates with the plugin."
                ),
                "session_reset_token": token
            }
        }))

        return

    request_id = str(
        args.get("request_id") or ""
    ).strip()

    if not request_id:
        raise ValueError(
            "No request_id was provided."
        )

    if not server_connection:
        raise ValueError(
            "No server_connection was received from Stash."
        )

    cleanup_old_files(CACHE_DIR, 3600)
    cleanup_old_files(STATE_DIR, 86400)

    pp = PPics()
    stash = Stash(server_connection)

    try:
        if mode == "global_context_search":
            query = str(
                args.get("query") or ""
            ).strip()

            search_type = str(
                args.get("search_type") or "all"
            ).strip().lower()

            if not query:
                raise ValueError(
                    "Enter a performer, studio or tag to search."
                )

            payload = global_context_search(
                pp,
                query,
                search_type=search_type,
                request_id=request_id
            )

        elif mode == "search_context":
            context_type = str(
                args.get("context_type") or "performer"
            ).strip().lower()

            context_value = str(
                args.get("context_value") or ""
            ).strip()

            context_label = str(
                args.get("context_label")
                or context_value
            ).strip()

            context_url = str(
                args.get("context_url") or ""
            ).strip()

            if not context_value:
                raise ValueError(
                    "No PornPics browse context was provided."
                )

            try:
                page = int(
                    args.get("page") or 1
                )
            except (TypeError, ValueError):
                page = 1

            seed = str(
                args.get("seed") or ""
            ).strip()

            total_count = args.get(
                "total_count"
            )

            payload = search_context(
                pp,
                stash,
                context_type=context_type,
                context_value=context_value,
                context_label=context_label,
                context_url=(
                    context_url or None
                ),
                page=page,
                seed=seed,
                total_count=total_count,
                request_id=request_id
            )

        elif mode == "search_performer":
            performer = str(
                args.get("performer") or ""
            ).strip()

            if not performer:
                raise ValueError(
                    "No performer was provided."
                )

            try:
                page = int(
                    args.get("page") or 1
                )
            except (TypeError, ValueError):
                page = 1

            seed = str(
                args.get("seed") or ""
            ).strip()

            total_count = args.get("total_count")

            payload = search_performer(
                pp,
                stash,
                performer,
                page=page,
                seed=seed,
                total_count=total_count,
                request_id=request_id
            )

        elif mode == "scene":
            scene_url = str(
                args.get("scene_url") or ""
            ).strip()

            if not scene_url:
                raise ValueError(
                    "No scene_url was provided."
                )

            payload = load_scene(
                pp,
                stash,
                scene_url,
                request_id=request_id
            )

        elif mode == "import_status":
            status_items = parse_json_arg(
                args,
                "status_json",
                []
            )

            deep_value = str(
                args.get("deep") or ""
            ).strip().lower()

            deep = deep_value in (
                "1",
                "true",
                "yes"
            )

            payload = import_status(
                stash,
                status_items,
                deep=deep
            )

        elif mode == "preflight_import":
            performer = str(
                args.get("performer") or ""
            ).strip()

            selection = parse_json_arg(
                args,
                "selection_json",
                []
            )

            if not selection:
                raise ValueError(
                    "No images are selected."
                )

            context_type = str(
                args.get("context_type") or "performer"
            ).strip().lower()

            context_value = str(
                args.get("context_value")
                or performer
                or ""
            ).strip()

            payload = preflight_import(
                pp,
                stash,
                performer,
                selection,
                request_id=request_id,
                context_type=context_type,
                context_value=context_value
            )

        elif mode == "prepare_import":
            performer = str(
                args.get("performer") or ""
            ).strip()

            selection = parse_json_arg(
                args,
                "selection_json",
                []
            )

            approvals = parse_json_arg(
                args,
                "create_json",
                {}
            )

            if not selection:
                raise ValueError(
                    "No images are selected."
                )

            context_type = str(
                args.get("context_type") or "performer"
            ).strip().lower()

            context_value = str(
                args.get("context_value")
                or performer
                or ""
            ).strip()

            payload = prepare_import(
                pp,
                stash,
                performer,
                selection,
                approvals,
                request_id=request_id,
                context_type=context_type,
                context_value=context_value
            )

        elif mode == "finalize_import":
            import_id = str(
                args.get("import_id") or ""
            ).strip()

            if not import_id:
                raise ValueError(
                    "No import_id was provided."
                )

            payload = finalize_import(
                stash,
                import_id,
                request_id=request_id
            )

        else:
            raise ValueError(
                "Unknown PPics mode: " + repr(mode)
            )

        payload["session_reset_token"] = (
            get_session_reset_token()
        )

        write_cache(
            request_id,
            payload
        )

        print(json.dumps({
            "output": {
                "request_id": request_id
            }
        }))

    except Exception as exc:
        error_payload = {
            "status": "error",
            "mode": mode,
            "error": str(exc),
            "session_reset_token": (
                get_session_reset_token()
            )
        }

        try:
            write_cache(
                request_id,
                error_payload
            )
        except Exception:
            pass

        log(
            "PPics ERROR: "
            + str(exc)
        )

        print(json.dumps({
            "error": str(exc)
        }))

        raise


if __name__ == "__main__":
    main()
