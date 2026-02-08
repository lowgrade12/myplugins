# PerformerRating Plugin

A plugin for [Stash](https://stashapp.cc/) that displays and allows inline editing of performer ratings directly on performer cards in the main performers grid.

## Features

### Star Rating Widget
- **5-star visual display** with filled, half-filled, and empty states
- **Click-to-rate** - Click any star to set the rating
- **Hover preview** - See what rating you're about to set before clicking
- **Real-time updates** - Changes are saved immediately to Stash

### Rating Slider
- **Precision control** - Slider allows setting exact rating values (0-100)
- **Live preview** - Stars and value update in real-time while dragging
- **Saves on release** - Rating is saved when you release the slider

### Rating Value Display
- Shows numeric rating (0-100)
- Visual feedback on save (green flash for success, red shake for error)

### Smart Caching
- **Local cache** for ratings to ensure UI consistency during React re-renders
- **Batch fetching** - Multiple performer ratings are fetched in a single GraphQL query
- **5-minute TTL** - Cache entries expire after 5 minutes for fresh data

### Native Rating Sync
- Updates Stash's native rating displays when you change a rating
- All rating widgets for the same performer stay synchronized

## Installation

1. Download the `/plugins/rating/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Navigate to the Performers page to see the rating widgets on each card

## Usage

### Setting a Rating

**Using Stars:**
1. Hover over the stars to preview the rating
2. Click a star to set the rating (1 star = 20, 5 stars = 100)

**Using Slider:**
1. Drag the slider to the desired value
2. Release to save the rating

### Rating Scale

| Stars | Rating100 | Description |
|-------|-----------|-------------|
| ☆☆☆☆☆ | 0 | Not rated |
| ★☆☆☆☆ | 20 | 1 star |
| ★★☆☆☆ | 40 | 2 stars |
| ★★★☆☆ | 60 | 3 stars |
| ★★★★☆ | 80 | 4 stars |
| ★★★★★ | 100 | 5 stars |

Half stars are displayed for intermediate values (e.g., 50 = 2.5 stars).

## Visual Appearance

The widget is designed to fit seamlessly into the Stash UI:
- **Dark theme compatible** - Uses semi-transparent dark background
- **Light theme support** - Automatically adjusts for light color schemes
- **Responsive design** - Scales appropriately on smaller screens
- **Hover effects** - Stars and slider thumb grow slightly on hover

## Technical Details

### DOM Injection
The plugin automatically detects performer cards using multiple selector strategies:
- `.performer-card`
- `[class*='PerformerCard']`
- `.card.performer`
- `.grid-item.performer`
- Cards with `/performers/` links

### Event Handling
- **Mutation Observer** - Watches for DOM changes to inject widgets into new cards
- **Debounced processing** - Prevents excessive updates during rapid DOM changes
- **Global event delegation** - Listens for `performer:rating:updated` events to sync widgets

### GraphQL Integration
- Uses Stash's GraphQL API for all rating operations
- `performerUpdate` mutation for saving ratings
- `findPerformer` query for fetching individual ratings
- Batch query using GraphQL aliases for multiple performers

## Requirements

- Stash v0.27 or later
- Works on the `/performers` page

## Compatibility

This plugin works alongside other Stash plugins, including:
- **HotOrNot** - Ratings set by HotOrNot will be reflected in the PerformerRating widgets
- Other plugins that modify performer ratings

## License

See [LICENCE](../../LICENCE) for details.
