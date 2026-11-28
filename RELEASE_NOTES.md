# OneNote Ferry 1.1.1

A fix for notebooks imported directly from OneDrive. Pages, folders and attachments are converted exactly as with 1.1.0.

## Fix

- When you import notebooks directly from OneDrive, or check them for updates, each notebook's contents page now lists its sections in the order OneNote shows them. Before, it listed them by name. Imports from a folder downloaded from the OneDrive website, a zip or a `.onepkg` already used OneNote's order.
- A notebook you imported from OneDrive before gets the new order the next time a check for updates updates or reconverts one of its sections. Nothing else in it changes.
- The import window still lists OneDrive sections by name.

## Requirements

- Obsidian 1.13 or later, on a computer (not on phones or tablets). With an older Obsidian, Obsidian offers OneNote Ferry 1.0.1 instead.

## Release assets

This release includes the Obsidian plugin assets:

- `main.js`
- `manifest.json`
- `styles.css`
