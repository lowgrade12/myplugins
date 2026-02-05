#!/bin/bash
# Download script for Missing Scenes plugin
# Run this from your Stash plugins/missingScenes directory

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR"

BASE_URL="https://raw.githubusercontent.com/carrotwaxr/stash-plugins/main/plugins/missingScenes"

echo "Downloading Missing Scenes plugin files to: $PLUGIN_DIR"
cd "$PLUGIN_DIR"

# List of files to download
FILES=(
    "missingScenes.yml"
    "missing_scenes.py"
    "missing-scenes.js"
    "missing-scenes-core.js"
    "missing-scenes-browse.js"
    "missing-scenes.css"
    "log.py"
    "stashbox_api.py"
)

# Download each file
for file in "${FILES[@]}"; do
    echo "Downloading $file..."
    if curl -L --fail -o "$file" "$BASE_URL/$file" 2>&1; then
        echo "  ✓ Downloaded $file"
    else
        echo "  ✗ Failed to download $file"
        exit 1
    fi
done

echo ""
echo "Download complete!"
echo ""
echo "Next steps:"
echo "1. Apply the bug fix: patch -p0 < fix_null_check.patch"
echo "2. Restart Stash to load the plugin"
