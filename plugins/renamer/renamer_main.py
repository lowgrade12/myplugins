from stashapi.stashapp import StashInterface
import json
import sys

from config_parser import Config
from renamer import rename_scene, rename_scenes_for_studio, rename_all_scenes, rename_scenes_in_directory

STASH_DATA = json.loads(sys.stdin.read())

ARGS = STASH_DATA["args"]
ACTION = ARGS.get("action")

stash = StashInterface(STASH_DATA["server_connection"])
stash_config = stash.get_configuration()

config = Config(stash_config["plugins"].get("renamer", {}))

if "hookContext" in ARGS:
    hook_data = ARGS["hookContext"]
    hook_type = hook_data.get("type")

    if hook_type == "Scene.Update.Post":
        rename_scene(stash, config, ARGS)
    elif hook_type == "Studio.Update.Post":
        studio_id = hook_data.get("id")
        input_data = hook_data.get("input", {})
        if "name" in input_data and studio_id:
            rename_scenes_for_studio(stash, config, studio_id)
elif ACTION == "rename-all":
    rename_all_scenes(stash, config)
elif ACTION == "rename-directory":
    rename_scenes_in_directory(stash, config)
