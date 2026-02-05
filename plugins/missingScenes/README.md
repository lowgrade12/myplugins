# Missing Scenes Plugin - Custom Version

This directory contains the complete Missing Scenes plugin with a bug fix already applied.

## Pre-Applied Bug Fix

This version includes a fix for the `Scene.Update.Post` hook error where the plugin would crash with:

```
AttributeError: 'NoneType' object has no attribute 'get'
scene_id = scene_input.get("id")
```

The fix adds a null check at the beginning of the `handle_scene_update_hook` function in `missing_scenes.py` to guard against `None` scene data.

## Setup

The plugin files are already included in this directory. Simply install them with your Stash plugins and restart Stash.

## Alternative: Disable the Hook

If you don't need automatic Whisparr cleanup, you can simply disable the hook in the plugin settings:

1. Go to Settings > Plugins > Missing Scenes
2. Set "Auto-cleanup Whisparr" to disabled

## Plugin Source

Original plugin: https://github.com/carrotwaxr/stash-plugins/tree/main/plugins/missingScenes

## Files in This Directory

- `missingScenes.yml` - Plugin manifest
- `missing_scenes.py` - Main plugin Python code (with bug fix applied)
- `missing-scenes.js` - Main JavaScript UI code
- `missing-scenes-core.js` - Core JavaScript functionality
- `missing-scenes-browse.js` - Browse functionality JavaScript
- `missing-scenes.css` - Plugin CSS styles
- `log.py` - Logging utility
- `stashbox_api.py` - StashDB/Stash-Box API utilities
- `README.md` - This documentation
- `fix_null_check.patch` - Original patch file (kept for reference)
- `download_plugin.sh` - Original download script (kept for reference)
