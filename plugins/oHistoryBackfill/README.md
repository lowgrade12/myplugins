# O History Backfill

Plugin for [Stash](https://stashapp.cc/) that lets you add scene O-history entries from existing watch history timestamps instead of using the current time.

## Features

- Adds a **Backfill O** button on individual scene pages
- Loads that scene's existing `play_history` and `o_history`
- Shows only watch timestamps that are not already present in O history
- Supports multi-select so you can add one or many previous watch dates at once
- Updates the scene's O history immediately after saving

## Installation

1. Add this repository as a Stash plugin source
2. Install **O History Backfill**
3. Reload plugins in Stash

## Usage

1. Open an individual scene page in Stash
2. In the **O history** section, click **Backfill O**
3. Select one or more watch timestamps
4. Click **Add selected dates**

## Requirements

- Stash build with `sceneAddO` GraphQL mutation support

## Notes

- This plugin does not run in bulk
- It only acts on the scene page you are currently viewing
- Existing O-history timestamps are excluded automatically to avoid duplicates
