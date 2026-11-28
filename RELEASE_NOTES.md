# OneNote Ferry 1.1.2

Two fixes to notebooks' contents pages. Pages and attachments are converted exactly as with 1.1.1.

## Fixes

- A check for updates that updated or reconverted some sections of a notebook no longer drops what the notebook's contents page and the conversion report said about its sections that could not be converted: a password protected section, one whose conversion failed, or one that did not download completely. Before, they were then listed as if they had been imported. A notebook an earlier version updated gets these marks back the next time a check for updates updates or reconverts one of its sections.
- A notebook's contents page no longer begins with a note saying that sections are sorted by name. They have been listed in the order OneNote shows them since 1.0.0 (since 1.1.1 for notebooks imported directly from OneDrive). A contents page you already have loses the note the next time a check for updates rewrites it.

## Requirements

- Obsidian 1.13 or later, on a computer (not on phones or tablets). With an older Obsidian, Obsidian offers OneNote Ferry 1.0.1 instead.

## Release assets

This release includes the Obsidian plugin assets:

- `main.js`
- `manifest.json`
- `styles.css`
