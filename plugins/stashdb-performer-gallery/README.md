# StashDB Performer Gallery

Automatically download performer images from StashDB or other stash-boxes. Add the `[Stashbox Performer Gallery]` tag to a performer and it will create a gallery of images from that stash-box database.

## Features

- **Automatic gallery creation**: Creates galleries for tagged performers using images from StashDB
- **Profile image setting**: Apply the `[Set Profile Image]` tag to an image to set it as the profile image of that performer
- **URL scraper integration**: Optionally run stash scrapers on profile URLs to gather additional images
- **Tag removal**: Optionally remove the gallery tag from performers after their galleries are downloaded

## Setup

1. Configure the download path in plugin settings
2. Add the configured path as a library path in Stash settings
3. Tag performers with `[Stashbox Performer Gallery]` to trigger gallery creation

## Settings

| Setting | Description |
|---------|-------------|
| **Download parent folder** | Location for downloaded files. Must be a different folder from stash and covered by a library path. |
| **Run stash scrapers on profile urls** | When enabled, runs scrapers on performer profile URLs to gather additional images. |
| **Remove tag after galleries downloaded** | When enabled, removes the `[Stashbox Performer Gallery]` tag from performers after their galleries have been downloaded and linked. |

## Tasks

- **Process Performers**: Fetch performer images for all performers with the `[Stashbox Performer Gallery]` tag
- **Relink missing images**: Reprocess images that are missing gallery associations

## Hooks

- **Performer.Update.Post**: Triggers gallery download when a performer is updated with the gallery tag
- **Image.Create.Post**: Processes newly created images
- **Image.Update.Post**: Sets profile image when the `[Set Profile Image]` tag is applied

## Known Issues and Fixes

### Relink Missing Images Function - Potential Hang Causes

The original `relink_images` function had several issues that could cause it to hang:

1. **Pagination Bug**: The original code used the image counter (`i`) as both the page number and the progress counter. After processing 100 images, `i=100` was used as `page=100`, skipping pages 1-99 entirely. This was fixed by using separate `page` and `processed` counters.

2. **Infinite Loop Risk**: If `stash.find_images` returned no results for a page, the loop would continue indefinitely. Added a safety check to break the loop when no images are returned.

3. **No Request Timeouts**: API calls to Stash have no timeout configured, which could cause hangs if the server is slow or unresponsive.

4. **File I/O Blocking**: The `processImages` function opens and reads JSON files synchronously, which could block on slow storage or network mounts.

5. **Runaway Pagination Check**: Added a safety limit to prevent the pagination from exceeding expected bounds.

### Fixes Applied

- Proper pagination with separate page counter and processed image counter
- Safety checks to break loops when no data is returned
- Added logging for better debugging
- Added the `removeTagAfterDownload` setting to clean up tags after processing

## Credits

Based on the original [stashdb-performer-gallery](https://github.com/stashapp/CommunityScripts/tree/main/plugins/stashdb-performer-gallery) plugin from the Stash Community Scripts repository.
