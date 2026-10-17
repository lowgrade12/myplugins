from stashapi.stashapp import StashInterface
from stashapi import log
from config_parser import Config
from file_manager import StashFile
import pathlib

_sorted_directory = None


def configure_sorted_directory(config) -> None:
    """Read the "Sorted directory" setting (default /data/scenes)."""
    global _sorted_directory
    raw = (config.sorted_directory or "").strip()
    _sorted_directory = pathlib.Path(raw).resolve() if raw else None


def _is_in_scenes_directory(file_path: pathlib.Path) -> bool:
    """Return True if the file is inside the configured sorted directory."""
    if _sorted_directory is None:
        return False
    try:
        file_path.resolve().relative_to(_sorted_directory)
        return True
    except ValueError:
        return False


# Update-input fields that can change a renamed path. Stash sends the names of
# the fields included in an update as hookContext.inputFields. (The "input"
# object itself always contains every key, mostly null, so it can't be used to
# tell what changed.)
NAME_AFFECTING_SCENE_FIELDS = {
    "title", "code", "date", "director", "studio_id", "organized", "primary_file_id",
}
NAME_AFFECTING_STUDIO_FIELDS = {"name", "parent_id"}


def changed_fields(hook_context):
    """Return the set of fields this update touched, or None if unknown.

    None means Stash didn't say: scan-triggered hooks (a file was added or
    changed) and older Stash versions. Callers treat that as "may matter".
    """
    fields = hook_context.get("inputFields")
    return set(fields) if fields is not None else None


def hook_may_affect_names(hook_context) -> bool:
    fields = changed_fields(hook_context)
    if fields is None:
        return True
    hook_type = hook_context.get("type")
    if hook_type == "Scene.Update.Post":
        return bool(fields & NAME_AFFECTING_SCENE_FIELDS)
    if hook_type == "Studio.Update.Post":
        return bool(fields & NAME_AFFECTING_STUDIO_FIELDS)
    return True


SCENE_FRAGMENT = """
id
title
code
date
director
organized

studio {
    id
    name
    parent_studio {
        id
        name
    }
}

files {
    id
    path
    basename

    format
    width
    height
    duration
    video_codec
    audio_codec
}
"""

def rename_scene(stash: StashInterface, config: Config, args):
    log.debug(f"Checking scene with args: {args}")

    scene_id = args["hookContext"]["id"]
    scene = stash.find_scene(scene_id, fragment=SCENE_FRAGMENT)

    log.debug(f"Found scene: {scene}")

    if not config.rename_unorganized and not scene["organized"]:
        log.info("Scene is not marked as organized, ignoring scene.")
        return

    fields = changed_fields(args["hookContext"])
    # Unknown fields (scan-triggered hooks, older Stash) count as relevant.
    relevant_metadata_changing = fields is None or bool(fields & {"title", "studio_id"})

    for file in scene["files"]:
        file_path = pathlib.Path(file["path"])
        if _is_in_scenes_directory(file_path) and not relevant_metadata_changing:
            log.info(f"File {file_path} is in the sorted directory and no relevant metadata is changing, skipping.")
            continue
        stash_file = StashFile(stash, config, scene, file)
        stash_file.rename_file()

def rename_scenes_for_studio(stash: StashInterface, config: Config, studio_id: str):
    """Find all scenes belonging to the given studio and rename their files."""
    log.info(f"Renaming scenes for studio {studio_id}")

    scenes = stash.find_scenes(
        f={"studios": {"value": [studio_id], "modifier": "INCLUDES"}},
        fragment=SCENE_FRAGMENT,
    )

    for scene in scenes:
        if not config.rename_unorganized and not scene["organized"]:
            log.debug(f"Scene {scene['id']} is not marked as organized, skipping.")
            continue

        for file in scene["files"]:
            file_path = pathlib.Path(file["path"])
            stash_file = StashFile(stash, config, scene, file)
            stash_file.rename_file()


def rename_all_scenes(stash: StashInterface, config: Config):
    log.info("Checking all scenes")
    
    # Find all scenes and rename them
    scenes = stash.find_scenes(fragment=SCENE_FRAGMENT)
    
    for scene in scenes:
        if not config.rename_unorganized and not scene["organized"]:
            log.debug(f"Scene {scene['id']} is not marked as organized, skipping.")
            continue
            
        for file in scene["files"]:
            file_path = pathlib.Path(file["path"])
            if _is_in_scenes_directory(file_path):
                log.info(f"File {file_path} is in the sorted directory, skipping.")
                continue
            stash_file = StashFile(stash, config, scene, file)
            stash_file.rename_file()

def rename_scenes_in_directory(stash: StashInterface, config: Config):
    """Rename scenes whose files are within the specified directory filter."""
    directory_filter = config.directory_filter
    
    if not directory_filter:
        log.error("No directory filter specified. Please set the 'Directory filter' setting.")
        return
    
    filter_path = pathlib.Path(directory_filter).resolve()
    log.info(f"Renaming scenes in directory: {filter_path}")
    
    # Find all scenes and filter by directory
    scenes = stash.find_scenes(fragment=SCENE_FRAGMENT)
    
    for scene in scenes:
        if not config.rename_unorganized and not scene["organized"]:
            log.debug(f"Scene {scene['id']} is not marked as organized, skipping.")
            continue
            
        for file in scene["files"]:
            file_path = pathlib.Path(file["path"]).resolve()
            
            # Check if the file is within the filter directory
            # We use relative_to() which raises ValueError if the path is not relative to filter_path
            try:
                file_path.relative_to(filter_path)
                # File is within the filter directory, proceed with rename
                log.debug(f"File {file_path} is within filter directory {filter_path}")
                if _is_in_scenes_directory(file_path):
                    log.info(f"File {file_path} is in the sorted directory, skipping.")
                    continue
                stash_file = StashFile(stash, config, scene, file)
                stash_file.rename_file()
            except ValueError:
                # File is not within the filter directory, skip
                log.debug(f"File {file_path} is not within filter directory {filter_path}, skipping.")
                continue
