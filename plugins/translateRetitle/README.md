# Translate Retitle

Manual-use Stash UI plugin for edit forms with **Title**, **Details**, and **Code** fields.

## What it does

When you click **Translate + Retitle**, it:

1. Reads current Title, Details, and Code values
2. Builds details as:
   - Title
   - blank line
   - existing details
3. Translates that text to English
4. Replaces Details with the translated result
5. Replaces Title with Code

## Notes

- This plugin is **manual only** and never runs automatically.
- It does **not** auto-save; review the result and save in Stash as normal.
- The button is injected near the edit fields instead of the native save actions.
- Translation uses `https://translate.googleapis.com/translate_a/single`.
