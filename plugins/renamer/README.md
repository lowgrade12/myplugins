# Renamer Plugin

A plugin for [Stash](https://stashapp.cc/) that automatically renames scene files and directories based on customizable templates using scene metadata.

## Features

- **Automatic Renaming**: Rename files and directories when scenes are updated in Stash
- **Template-Based Naming**: Use variables like `$title$`, `$studio_name$`, `$date$` to create custom naming patterns
- **Optional Sections**: Use curly braces `{...}` to include sections only when all variables within them have values
- **Related File Support**: Automatically rename associated files (e.g., `.funscript`, `.vtt`, `.srt`)
- **Duplicate Handling**: Automatic suffixing when files with the same name already exist
- **Dry Run Mode**: Preview changes without actually renaming files
- **Bulk Renaming**: Rename all scenes at once via the task interface

## Installation

1. Download the `/plugins/renamer/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Configure the plugin settings (Settings → Plugins → Renamer)

## Configuration

### Settings Overview

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `Rename unorganized scenes` | Boolean | `false` | When disabled, only scenes marked as "Organized" will be renamed |
| `Rename/move files with the same name but different extensions` | Boolean | `true` | Rename related files (e.g., `.funscript`, `.vtt`) alongside the main video file |
| `Rename directory` | Boolean | `true` | Rename the parent directory to match the new file name (stem only) |
| `Default directory path format` | String | `""` | Template for the destination directory path |
| `Default file name format` | String | `""` | Template for the new file name |
| `Dry Run` | Boolean | `false` | Log what would happen without actually renaming files |
| `Duplicate file suffix` | String | `" ($index$)"` | Suffix appended when a file with the same name exists |
| `Remove extra spaces from file name` | Boolean | `false` | Collapse multiple consecutive spaces into a single space |
| `Allow unsafe characters` | Boolean | `false` | Allow characters that may cause issues on some filesystems (`<>:"/\|?*`) |

### Behavior Details

#### Rename Unorganized Scenes
When **disabled** (default), the plugin only processes scenes that have been marked as "Organized" in Stash. This is useful for ensuring you only rename scenes that have been properly tagged and curated.

When **enabled**, all scenes will be renamed regardless of their organized status.

#### Rename Directory
When **enabled**, the parent directory of the file will be renamed to match the file's stem (filename without extension). For example:
- File renamed to: `My Scene Title.mp4`
- Parent directory renamed to: `My Scene Title`

**Note**: This renames the immediate parent directory, not the entire path structure.

#### Duplicate Handling
When a file with the target name already exists, the plugin appends the duplicate suffix. The `$index$` variable in the suffix is replaced with an incrementing number:
- First file: `My Scene.mp4`
- Duplicate: `My Scene (1).mp4`
- Second duplicate: `My Scene (2).mp4`

## Template Variables

Use these variables in your `Default directory path format` and `Default file name format` settings. Variables are enclosed in dollar signs: `$variable_name$`.

### Scene Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$scene_id$` | Stash scene ID | `42` |
| `$title$` | Scene title | `My Awesome Scene` |
| `$date$` | Scene date (full) | `2024-01-15` |
| `$year$` | Year from scene date | `2024` |
| `$month$` | Month from scene date | `01` |
| `$studio_name$` | Studio name | `ExampleStudio` |
| `$studio_code$` | Scene code/ID from studio | `ES-123` |
| `$parent_studio_chain$` | Full studio hierarchy | `ParentStudio/ChildStudio` |
| `$director$` | Director name | `John Doe` |

### File Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$ext$` | File extension | `mp4` |
| `$format$` | Video format/container | `MP4` |
| `$width$` | Video width in pixels | `1920` |
| `$height$` | Video height in pixels | `1080` |
| `$video_codec$` | Video codec | `h264` |
| `$audio_codec$` | Audio codec | `aac` |
| `$index$` | Duplicate index (for suffix) | `1` |

## Optional Sections

Wrap parts of your template in curly braces `{...}` to make them optional. If any variable within the braces has no value, the entire section is removed.

**Example:**
```
$title${ - $studio_name$}{ ($year$)}.$ext$
```

This produces:
- With all data: `My Scene - ExampleStudio (2024).mp4`
- Without studio: `My Scene (2024).mp4`
- Without year: `My Scene - ExampleStudio.mp4`
- With only title: `My Scene.mp4`

## Configuration Examples

### Example 1: Simple Title-Based Naming

Rename files to just the scene title:

```
Default file name format: $title$.$ext$
```

**Result:** `My Awesome Scene.mp4`

---

### Example 2: Studio and Title Organization

Organize files into studio folders with title-based names:

```
Default directory path format: /media/videos/$studio_name$
Default file name format: $title$.$ext$
```

**Result:** `/media/videos/ExampleStudio/My Awesome Scene.mp4`

---

### Example 3: Date-Based Organization

Organize files by year and month:

```
Default directory path format: /media/videos/$year$/$month$
Default file name format: $date$ - $title$.$ext$
```

**Result:** `/media/videos/2024/01/2024-01-15 - My Awesome Scene.mp4`

---

### Example 4: Full Studio Hierarchy

Use the complete parent studio chain for deep organization:

```
Default directory path format: /media/videos/$parent_studio_chain$
Default file name format: $title${ - $studio_code$}.$ext$
```

**Result:** `/media/videos/ParentNetwork/SubStudio/My Awesome Scene - SS-123.mp4`

---

### Example 5: Resolution-Based Organization

Organize by video resolution:

```
Default directory path format: /media/videos/$height$p
Default file name format: $title$ ($height$p).$ext$
```

**Result:** `/media/videos/1080p/My Awesome Scene (1080p).mp4`

---

### Example 6: Comprehensive Naming with Fallbacks

Use optional sections for flexible naming:

```
Default file name format: $title${ [$studio_code$]}{ - $studio_name$}{ ($year$)} [$height$p].$ext$
```

**Possible results:**
- Full metadata: `My Scene [SC-123] - ExampleStudio (2024) [1080p].mp4`
- Missing studio code: `My Scene - ExampleStudio (2024) [1080p].mp4`
- Missing all optional: `My Scene [1080p].mp4`

---

### Example 7: Testing with Dry Run

Before making actual changes, enable dry run mode to see what would happen:

1. Set `Dry Run: true`
2. Configure your naming templates
3. Run the "Rename scenes" task
4. Check the Stash logs to see proposed renames
5. When satisfied, set `Dry Run: false`

## Hooks

The plugin responds to the following Stash hook:

| Hook | Description |
|------|-------------|
| `Scene.Update.Post` | Triggered after a scene is updated, automatically renames the scene's files |

## Tasks

| Task | Description |
|------|-------------|
| `Rename scenes` | Batch rename all scene files based on your configuration |

## Troubleshooting

### Files Not Being Renamed

1. **Check "Organized" status**: By default, only scenes marked as "Organized" are renamed. Either mark your scenes as organized or enable "Rename unorganized scenes".

2. **Empty templates**: If both `Default directory path format` and `Default file name format` are empty, no renaming occurs.

3. **Same path**: If the calculated new path matches the current path, no renaming occurs.

### Duplicate Files

When the target filename already exists, the plugin automatically appends the duplicate suffix (default: ` ($index$)`). Check your logs for warnings about duplicate files.

### Unsafe Characters

By default, the plugin removes these characters from filenames: `< > : " / \ | ? *`

If you need these characters (e.g., for certain network paths), enable "Allow unsafe characters", but be aware this may cause issues on some filesystems.

### Checking Logs

Enable debug logging in Stash to see detailed information about rename operations:
- What files are being considered
- What the new paths would be
- Whether dry run is enabled
- Any errors that occur

## Requirements

- Stash v0.27 or later
- Python 3.x (for plugin execution)
- stashapi library

## License

See [LICENCE](../../LICENCE) for details.
