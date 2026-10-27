# Whisparr Update Plugin

> **Note**: This plugin is inspired by the [whisparr-bridge](https://github.com/lowgrade12/myplugins/tree/main/reference/whisparr-bridge) plugin.

A plugin for [Stash](https://stashapp.cc/) that automatically adds scenes to [Whisparr](https://github.com/Whisparr/Whisparr) when they are matched with StashDB. This enables automated scene management and downloading through Whisparr's integration.

## Features

### Automatic Scene Addition
- **Triggered on scene update** - When a scene receives a StashDB ID, it's automatically added to Whisparr
- **Uses existing metadata** - Scene title and StashDB ID are passed to Whisparr
- **Automatic defaults** - Uses Whisparr's first quality profile and root folder

### Duplicate Handling
- **Detects existing scenes** - Recognizes 409 Conflict and MovieExistsValidator errors
- **Automatic refresh** - When a scene already exists, triggers a metadata refresh instead
- **Unmonitor existing** - With "Monitor after add" off, scenes already in Whisparr are set to unmonitored so they aren't upgraded or re-downloaded
- **Remove once matched** - With "Remove from Whisparr once matched" on, a scene matched in Stash is removed from Whisparr instead (its files are kept) and added to Whisparr's import exclusions, so import lists don't add it back. A matched scene Whisparr never had is just excluded. Use this if you only use Whisparr to download scenes you don't have yet: it keeps the Whisparr library small, which keeps its daily refresh fast
- **Multiple lookup methods** - Uses stashId parameter and foreignId fallback to find existing movies

### Configurable Settings
- **Whisparr URL** - Point to your Whisparr instance
- **API Key** - Authenticate with Whisparr
- **StashDB endpoint match** - Customizable for different stashbox instances
- **Monitor setting** - Choose whether to monitor new scenes

### Add from other plugins (Cherry Pick)
- **Add and search** - Cherry Pick's "Not in your library" cards add a StashDB scene through this plugin: monitored, with a search started. A scene already in Whisparr is set monitored and searched for again. This always monitors, whatever "Monitor after add" says, since it is a request to download a scene you don't have.
- **Status** - The cards show whether Whisparr has each scene (Downloaded, Wanted, In Whisparr), looked up by StashDB id.
- Both run as plugin operations (`runPluginOperation` with `args.mode` = `add` or `status`), so the Whisparr URL and API key never leave the server.

## Installation

1. Download the `/plugins/whisparrUpdate/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Configure the plugin settings (Settings → Plugins → Whisparr Update)

## Configuration

### Required Settings

| Setting | Description | Example |
|---------|-------------|---------|
| **Whisparr URL** | Full URL to your Whisparr instance | `http://localhost:6969` |
| **Whisparr API Key** | API key from Whisparr (Settings → General) | `abcd1234...` |

### Optional Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **StashDB host match** | Substring to match in stash_id endpoints | `stashdb.org` |
| **Monitor after add** | Mark scenes as monitored when added. When off, scenes that already exist in Whisparr are also set to unmonitored | `true` |
| **Remove from Whisparr once matched** | Remove matched scenes from Whisparr (files kept) and add an import exclusion, instead of adding or unmonitoring them. Overrides "Monitor after add" | `false` |

## Usage

Once configured, the plugin works automatically:

1. **Match a scene** - Use Stash's tagger or scraper to match a scene with StashDB
2. **Automatic addition** - The plugin detects the new StashDB ID and adds the scene to Whisparr
3. **Duplicate handling** - If the scene already exists in Whisparr, a metadata refresh is triggered instead (and the scene is unmonitored if "Monitor after add" is off)

### Example Workflow

1. Import a new video file into Stash
2. Use the Scene Tagger to match it with StashDB
3. The plugin automatically:
   - Extracts the StashDB ID from the scene
   - Queries Whisparr for quality profiles and root folders
   - Adds the scene to Whisparr with the correct metadata
   - If already in Whisparr, unmonitors it (when "Monitor after add" is off) and triggers a refresh to sync metadata

## Hooks

| Hook | Trigger | Description |
|------|---------|-------------|
| `Add on scene update` | `Scene.Update.Post` | Triggered after any scene update to check for new StashDB IDs |

## Technical Details

### Whisparr API Integration

The plugin uses Whisparr's v3 API:
- `GET /api/v3/qualityprofile` - Fetch available quality profiles
- `GET /api/v3/rootfolder` - Fetch configured root folders
- `POST /api/v3/movie` - Add a new scene
- `GET /api/v3/movie?stashId=...` - Lookup existing movie by StashDB ID
- `GET /api/v3/movie/{id}` / `PUT /api/v3/movie/{id}` - Unmonitor an existing scene
- `DELETE /api/v3/movie/{id}?deleteFiles=false&addImportExclusion=true` - Remove a matched scene, keeping files
- `POST /api/v3/exclusions` - Exclude a matched scene Whisparr never had
- `POST /api/v3/command` - Trigger a RefreshMovie command

### Scene Payload

When adding a scene, the following payload is sent to Whisparr:
```json
{
  "title": "Scene Title",
  "qualityProfileId": 1,
  "rootFolderPath": "/data/videos",
  "monitored": true,
  "addOptions": {
    "monitor": "movieOnly",
    "searchForMovie": false
  },
  "foreignId": "stashdb-uuid-here",
  "stashId": "stashdb-uuid-here"
}
```

### Error Handling

- **409 Conflict** - Scene already exists, triggers refresh
- **400 MovieExistsValidator** - Scene already exists, triggers refresh
- **Missing settings** - Logs error and skips processing
- **API failures** - Logs detailed error information

## Requirements

- Stash v0.27 or later
- Whisparr v3 or later
- Python 3.x with stashapi library
- Scenes must have StashDB stash_ids

## Troubleshooting

### Scene not being added to Whisparr

1. **Check settings** - Verify Whisparr URL and API key are correct
2. **Check StashDB ID** - Scene must have a stash_id from a matching endpoint
3. **Check logs** - Enable debug logging to see detailed information
4. **Test Whisparr connection** - Verify you can access Whisparr's web UI

### "Missing Whisparr settings" error

Configure both the URL and API Key in Settings → Plugins → Whisparr Update.

### Scene shows as "already exists"

This is normal behavior - the plugin triggers a metadata refresh for existing scenes to keep them in sync. If "Monitor after add" is off, the scene is also set to unmonitored.

## License

See [LICENCE](../../LICENCE) for details.

## Credits

This plugin is inspired by the [whisparr-bridge](https://github.com/lowgrade12/myplugins/tree/main/reference/whisparr-bridge) plugin.
