from stashapi.stashapp import StashInterface
import json
import sys

from config_parser import Config
from renamer import configure_sorted_directory, hook_may_affect_names, rename_scene, rename_scenes_for_studio, rename_all_scenes, rename_scenes_in_directory

STASH_DATA = json.loads(sys.stdin.read())

ARGS = STASH_DATA["args"]
ACTION = ARGS.get("action")

# Scene and studio update hooks fire for every edit (ratings, tags, play
# counts, other plugins' batch jobs). Exit before connecting to Stash when the
# update can't affect any file or folder name.
if "hookContext" in ARGS and not hook_may_affect_names(ARGS["hookContext"]):
    sys.exit(0)

stash = StashInterface(STASH_DATA["server_connection"])
stash_config = stash.get_configuration()

config = Config(stash_config["plugins"].get("renamer", {}))
configure_sorted_directory(config)

if "hookContext" in ARGS:
    hook_data = ARGS["hookContext"]
    hook_type = hook_data.get("type")

    if hook_type == "Scene.Update.Post":
        rename_scene(stash, config, ARGS)
    elif hook_type == "Studio.Update.Post":
        studio_id = hook_data.get("id")
        if studio_id:
            rename_scenes_for_studio(stash, config, studio_id)
elif ACTION == "rename-all":
    rename_all_scenes(stash, config)
elif ACTION == "rename-directory":
    rename_scenes_in_directory(stash, config)
