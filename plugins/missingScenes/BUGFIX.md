# Missing Scenes Plugin - Bug Fix

## Issue
The plugin throws an error when the `Scene.Update.Post` hook is triggered:

```
AttributeError: 'NoneType' object has no attribute 'get'
scene_id = scene_input.get("id")
```

## Root Cause
The hook handler function `handle_scene_update_hook` receives `None` for the `scene_input` parameter when the hook context doesn't include input data. The code attempts to call `.get("id")` on `None`, causing the crash.

## Fix
Apply this patch to your `missing_scenes.py` file at approximately line 2176.

### Before (broken code):
```python
def handle_scene_update_hook(scene_input, plugin_settings):
    """Handle Scene.Update.Post hook..."""
    # Check if auto-cleanup is enabled
    if not plugin_settings.get("enableAutoCleanup", False):
        log.LogDebug("Auto-cleanup is disabled, skipping")
        return {"success": True, "message": "Auto-cleanup disabled"}
    
    # ... more code ...
    
    # Get the scene ID from the hook input
    scene_id = scene_input.get("id")  # <-- CRASH HERE when scene_input is None
```

### After (fixed code):
```python
def handle_scene_update_hook(scene_input, plugin_settings):
    """Handle Scene.Update.Post hook..."""
    
    # FIX: Guard against None scene_input
    if scene_input is None:
        log.LogDebug("Hook received no scene data, skipping")
        return {"success": True, "message": "No scene data provided"}
    
    # Check if auto-cleanup is enabled
    if not plugin_settings.get("enableAutoCleanup", False):
        log.LogDebug("Auto-cleanup is disabled, skipping")
        return {"success": True, "message": "Auto-cleanup disabled"}
    
    # ... rest of the function unchanged ...
    
    # Get the scene ID from the hook input (now safe)
    scene_id = scene_input.get("id")
```

## How to Apply

1. Open `<your_stash_directory>/plugins/missingScenes/missing_scenes.py`
2. Find the function `handle_scene_update_hook` (around line 2170)
3. Add the null check at the beginning of the function, right after the docstring
4. Save the file
5. Restart Stash or reload plugins

## Alternative: Disable the Hook
If you don't need automatic Whisparr cleanup, you can disable the hook in the plugin settings:
- Go to Settings > Plugins > Missing Scenes
- Set "Auto-cleanup Whisparr" to disabled
