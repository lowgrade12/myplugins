# Missing Scenes Plugin - Custom Version

This directory contains setup instructions and a bug fix for the Missing Scenes plugin.

## Setup Instructions

### Step 1: Download the Original Plugin

Download the plugin files from the source repository:

```bash
# Navigate to your plugins directory
cd plugins/missingScenes

# Download the plugin files using curl or wget
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missingScenes.yml
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missing_scenes.py
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missing-scenes.js
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missing-scenes-core.js
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missing-scenes-browse.js
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/missing-scenes.css
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/log.py
curl -O https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes/stashbox_api.py
```

Or clone the entire stash-plugins repository:

```bash
git clone https://github.com/carrotwaxr/stash-plugins.git
cp -r stash-plugins/plugins/missingScenes/* /path/to/your/stash/plugins/missingScenes/
```

### Step 2: Apply the Bug Fix

After downloading the plugin, apply the bug fix for the `Scene.Update.Post` hook error.

#### The Issue

The plugin crashes with this error when the hook is triggered:

```
AttributeError: 'NoneType' object has no attribute 'get'
scene_id = scene_input.get("id")
```

#### The Fix

Edit `missing_scenes.py` and find the function `handle_scene_update_hook` (around line 2170).

Add the following null check at the beginning of the function, right after the docstring:

```python
def handle_scene_update_hook(scene_input, plugin_settings):
    """Handle Scene.Update.Post hook - cleanup Whisparr when scene is tagged.
    ...existing docstring...
    """
    # FIX: Guard against None scene_input to prevent AttributeError
    if scene_input is None:
        log.LogDebug("Hook received no scene data, skipping")
        return {"success": True, "message": "No scene data provided"}

    # ... rest of the existing function code ...
```

You can also apply the patch file included in this directory:

```bash
cd plugins/missingScenes
patch -p0 < fix_null_check.patch
```

### Step 3: Restart Stash

After applying the fix, restart Stash or reload the plugins for the changes to take effect.

## Alternative: Disable the Hook

If you don't need automatic Whisparr cleanup, you can simply disable the hook in the plugin settings:

1. Go to Settings > Plugins > Missing Scenes
2. Set "Auto-cleanup Whisparr" to disabled

## Plugin Source

Original plugin: https://github.com/carrotwaxr/stash-plugins/tree/main/plugins/missingScenes

## Files in This Directory

- `README.md` - This setup guide
- `fix_null_check.patch` - Patch file for the bug fix
- `download_plugin.sh` - Helper script to download plugin files
