# DuplicateChecker

Adds a **"🔍 Find Duplicate Scenes"** button to individual **performer** and **studio** pages in Stash. Clicking the button scans your library for duplicate scenes and shows only the duplicates relevant to that performer or studio.

## Features

- One-click duplicate detection scoped to a performer or studio
- Shows each duplicate group side-by-side with thumbnail, title, date, duration, file path, size, and resolution
- Direct "Open Scene" links for quick review
- "View All Duplicates in Stash" link to open Stash's native duplicate checker
- Configurable phash distance and duration tolerance via plugin settings
- Works with Stash's built-in `findDuplicateScenes` GraphQL query — no extra scanning required

## Requirements

- Stash v0.27 or later
- Scenes must have been scanned with **fingerprinting enabled** for phash-based matching to work

## How It Works

1. When you click the button on a performer or studio page, the plugin calls Stash's `findDuplicateScenes` GraphQL query to retrieve all duplicate groups in your library.
2. The results are filtered client-side to keep only groups containing at least one scene belonging to the current performer or studio.
3. Filtered results are displayed in a modal with scene details and file information.

> **Note on performance:** The query scans the entire library for duplicates before filtering. On very large libraries this may take a few seconds. The loading indicator will remain visible until the scan completes.

## Settings

| Setting | Description | Default |
|---|---|---|
| **Duration Multiplier** | Controls duration-matching strictness. `1.0` = exact duration required. Values below `1.0` (e.g. `0.9`) allow scenes within that fraction of each other's length to match. | `1.0` |
| **Phash Distance** | Perceptual hash distance threshold for visual similarity. `0` = exact match only. Higher values find more (but potentially less precise) duplicates. | `10` |

These can be adjusted in Stash under **Settings → Plugins → DuplicateChecker**.

## Installation

1. In Stash, go to **Settings → Plugins**.
2. Under **Available Plugins**, add this repository's plugin index URL.
3. Find **DuplicateChecker** and click **Install**.

## Limitations

- The plugin uses Stash's global duplicate-finding query and then filters client-side. It does **not** modify, merge, or delete any scenes.
- To merge or delete duplicates, use Stash's native **Scene Duplicate Checker** (`/sceneDuplicateChecker`), which the plugin links to directly.
- Results depend on Stash having generated phash fingerprints. If no duplicates are found, try running a scan with fingerprinting enabled in Stash settings.
