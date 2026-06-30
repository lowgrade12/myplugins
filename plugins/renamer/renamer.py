from stashapi.stashapp import StashInterface
from stashapi import log
from config_parser import Config
from file_manager import StashFile
import pathlib

SCENES_DIRECTORY = pathlib.Path("/data/scenes")


def _is_in_scenes_directory(file_path: pathlib.Path) -> bool:
    """Return True if the file is inside /data/scenes/."""
    try:
        file_path.resolve().relative_to(SCENES_DIRECTORY)
        return True
    except ValueError:
        return False


SCENE_FRAGMENT = """
id
title
code
date
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

    input_data = args["hookContext"].get("input", {})
    title_is_changing = "title" in input_data

    for file in scene["files"]:
        file_path = pathlib.Path(file["path"])
        if _is_in_scenes_directory(file_path) and not title_is_changing:
            log.info(f"File {file_path} is in /data/scenes/ and title is not changing, skipping.")
            continue
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
                log.info(f"File {file_path} is in /data/scenes/, skipping.")
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
                    log.info(f"File {file_path} is in /data/scenes/, skipping.")
                    continue
                stash_file = StashFile(stash, config, scene, file)
                stash_file.rename_file()
            except ValueError:
                # File is not within the filter directory, skip
                log.debug(f"File {file_path} is not within filter directory {filter_path}, skipping.")
                continue
