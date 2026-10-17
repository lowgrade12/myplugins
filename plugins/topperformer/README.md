# TopPerformer Plugin

A plugin for [Stash](https://stashapp.cc/) that displays the performer with the highest number of appearances for each studio directly on studio cards.

## Features

### Top Performer Display
- **Crown icon (👑)** to highlight the top performer
- **Performer name** displayed prominently
- **Scene count** showing how many scenes they appear in for that studio

### Smart Caching
- **5-minute cache** for top performer data
- Prevents repeated API calls for the same studio
- Cache is per-studio for efficient memory usage

### Gender Filtering
- **Excludes male performers** from the top performer calculation
- Focuses on primary performers for accurate studio representation

### Batch Processing
- **Parallel API calls** for multiple studios on the same page
- Error handling with fallback to individual processing
- Non-blocking operation that doesn't slow page load

### Page Detection
- **Automatic activation** on the Studios page
- **Works on the home page** if studios are displayed
- **Intelligently disabled** on scene-related pages where studio cards appear in a different context

## Installation

1. Download the `/plugins/topperformer/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Navigate to the Studios page to see the top performer on each studio card

## Usage

Simply browse the Studios page. The plugin automatically:
1. Detects studio cards on the page
2. Counts scene appearances per performer for each studio
3. Aggregates performer appearances (excluding male performers)
4. Displays the top performer on each card

## Visual Appearance

The widget appears at the bottom of each studio card:
```
👑 Performer Name (45 scenes)
```

Styled to match the Stash UI with:
- Crown emoji indicator
- Performer name (bold)
- Scene count in parentheses

## Technical Details

### Scene Fetching
- Studios with up to 500 scenes: all scenes are counted exactly in one request
- Larger studios: the 25 performers in the studio with the most scenes overall are checked, each with an exact scene count for this studio, in one request
- Results are cached for 30 minutes per browser session

### Card Detection
The plugin detects studio cards using:
- `.studio-card`
- `[class*='StudioCard']`
- `.card.studio`
- `.grid-item.studio`
- Cards with `/studios/` links

### Page Filtering
The plugin is **enabled** only on:
- `/studios` - Studio listing page
- `/` - Home page (if studio cards are displayed)

This allowlist approach prevents the widget from appearing on unrelated pages (scenes, performers, tags, etc.) where studio links may exist in other contexts.

### Performance
- Up to 4 studios are looked up at a time, so large studio pages don't flood Stash with queries
- **Mutation Observer** watches for DOM changes (lazy loading, pagination)

## Requirements

- Stash v0.27 or later
- Works on the `/studios` page and home page

## Limitations

- For studios with more than 500 scenes, the top performer is chosen from the 25 most prolific performers in that studio (by total scenes), so a performer with few scenes elsewhere could in rare cases be missed
- Gender filtering only excludes "MALE" - other genders are included
- Cache expires after 30 minutes; recent changes may take that long to show

## License

See [LICENCE](../../LICENCE) for details.
