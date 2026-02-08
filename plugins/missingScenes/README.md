# Missing Scenes Plugin

Discover scenes from StashDB that you don't have locally. View missing scenes for performers, studios, and tags, with optional Whisparr integration for automated downloading and cleanup.

## Features

### Scene Discovery
- **Performer-based search** - Find all StashDB scenes featuring a specific performer that you don't have
- **Studio-based search** - Find all StashDB scenes from a specific studio that you don't have
- **Tag-based search** - Find all StashDB scenes with a specific tag that you don't have
- **Paginated results** - Efficiently browse large result sets with cursor-based pagination
- **Sorting options** - Sort by date (newest/oldest first)

### Filtering Options
- **Favorite performers filter** - Only show scenes with your favorite performers
- **Favorite studios filter** - Only show scenes from your favorite studios
- **Favorite tags filter** - Only show scenes with your favorite tags
- **Configurable limits** - Set maximum number of favorites to use per filter type

### Content Filtering
- **Excluded tags** - Configure a comma-separated list of StashDB tag UUIDs to exclude from all results
- **Useful for** - Excluding content categories you're not interested in

### Whisparr Integration (Optional)
- **Add to Whisparr** - One-click button to add missing scenes to your Whisparr queue
- **Configurable settings** - Set quality profile, root folder, and search behavior
- **Auto-cleanup** - Automatically remove scenes from Whisparr when they get tagged in Stash
- **Unmonitor option** - Option to unmonitor instead of delete from Whisparr

### User Interface
- **Modal interface** - Non-intrusive modal that opens from performer/studio/tag pages
- **Scene cards** - Rich scene cards with thumbnails, titles, dates, and performers
- **StashDB links** - Direct links to scenes on StashDB
- **Load more** - Progressively load more results as needed

## Installation

1. Download the `/plugins/missingScenes/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Configure settings (Settings → Plugins → Missing Scenes)
4. Navigate to any performer, studio, or tag page to see the "Missing Scenes" button

## Configuration

### Stash-Box Settings

| Setting | Description |
|---------|-------------|
| **Stash-Box Endpoint** | Which stash-box to query (default: first configured, usually StashDB) |

### Whisparr Integration

| Setting | Description | Default |
|---------|-------------|---------|
| **Whisparr URL** | URL to your Whisparr instance | - |
| **Whisparr API Key** | API key from Whisparr settings | - |
| **Quality Profile ID** | Quality profile for new scenes | 1 |
| **Root Folder** | Root folder path for downloads | - |
| **Search on Add** | Automatically search when adding | true |

### Automation

| Setting | Description |
|---------|-------------|
| **Auto-cleanup Whisparr** | Remove from Whisparr when scene gets StashDB ID |
| **Unmonitor Instead of Delete** | Unmonitor scenes instead of deleting them |
| **Scan Path** | Path to scan for new downloaded scenes |

### StashDB API Settings (Advanced)

| Setting | Description | Default |
|---------|-------------|---------|
| **Request Delay** | Delay between paginated requests (seconds) | 0.5 |
| **Max Retries** | Retry count for failed requests | 3 |
| **Max Pages (Performer)** | Max pages for performer scene queries | 25 |
| **Max Pages (Studio)** | Max pages for studio scene queries | 25 |

### Content Filtering

| Setting | Description |
|---------|-------------|
| **Excluded Tags** | Comma-separated StashDB tag UUIDs to exclude |
| **Favorite Limit** | Max favorites to use per filter type | 100 |

## Usage

### Finding Missing Scenes

1. Navigate to a performer, studio, or tag page in Stash
2. Click the "Missing Scenes" button
3. Browse the results showing scenes you don't have locally
4. Optionally enable favorite filters to narrow results
5. Click "Load More" to see additional results

### Adding to Whisparr

1. Configure Whisparr settings in plugin configuration
2. Click "Add to Whisparr" on any scene card
3. The scene will be added to your Whisparr download queue

### Running Tasks

| Task | Description |
|------|-------------|
| **Scan for New Scenes** | Trigger a Stash scan on the configured scan path |
| **Cleanup Whisparr** | Remove scenes from Whisparr that are now tagged in Stash |

## Hooks

| Hook | Trigger | Description |
|------|---------|-------------|
| **Whisparr Auto-Cleanup** | `Scene.Update.Post` | Removes scene from Whisparr when it receives a StashDB ID |

## Technical Details

### API Rate Limiting
- Configurable delay between StashDB requests to avoid 429 errors
- Automatic retry with backoff for 503/504 errors
- Graceful handling of connection timeouts

### Caching
- In-memory cache for local stash_ids during pagination
- Efficient duplicate detection across paginated results

### Pre-Applied Bug Fix

This version includes a fix for the `Scene.Update.Post` hook error where the plugin would crash with:
```
AttributeError: 'NoneType' object has no attribute 'get'
```

## Requirements

- Stash v0.27 or later
- Python 3.x (for plugin execution)
- StashDB account (or other stash-box endpoint)
- Whisparr (optional, for download integration)

## Files in This Directory

| File | Description |
|------|-------------|
| `missingScenes.yml` | Plugin manifest |
| `missing_scenes.py` | Main plugin Python code |
| `missing-scenes.js` | Main JavaScript UI code |
| `missing-scenes-core.js` | Core JavaScript functionality |
| `missing-scenes-browse.js` | Browse functionality JavaScript |
| `missing-scenes.css` | Plugin CSS styles |
| `log.py` | Logging utility |
| `stashbox_api.py` | StashDB/Stash-Box API utilities |

## Plugin Source

Based on: https://github.com/carrotwaxr/stash-plugins/tree/main/plugins/missingScenes

## License

See [LICENCE](../../LICENCE) for details.
