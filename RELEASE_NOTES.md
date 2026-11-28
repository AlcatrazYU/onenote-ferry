# OneNote Ferry 1.1.0

OneNote Ferry now needs Obsidian 1.13 or later. Notes are converted exactly as with 1.0.1.

## Changes

- The plugin's settings now appear in Obsidian's settings search, and the settings page uses Obsidian's current layout.
- When a notebook exported by OneNote for Windows (`.onepkg`) is damaged, or is not a notebook export at all, the import window, the section's contents page and the conversion report now say so in your language and tell you to export the notebook again. Before, they showed a technical message in English.
- The `Clear` button of the download cache now also appears when the cache holds only what checks for updates kept of your sections (page titles and times), for example after you imported a folder downloaded from the OneDrive website. Before, it appeared only after an import from OneDrive.
- Small code changes asked for by the Obsidian community directory's review.

## Requirements

- Obsidian 1.13 or later, on a computer (not on phones or tablets). With an older Obsidian, Obsidian offers OneNote Ferry 1.0.1 instead.

## Release assets

This release includes the Obsidian plugin assets:

- `main.js`
- `manifest.json`
- `styles.css`
