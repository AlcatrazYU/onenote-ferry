# OneNote Ferry 1.0.1

A maintenance release. Nothing changes in how notebooks are converted or kept up to date: notes converted with 1.0.1 are the same, byte for byte, as with 1.0.0.

## Changes

- The release files are now built on GitHub from this repository, with a build provenance record you can check: `gh attestation verify main.js --repo AlcatrazYU/onenote-ferry`.
- The code that reads the converted notebook data and OneDrive's answers now states the shape of what it reads, as the Obsidian community directory's review asks.
- A guide for reporting problems and contributing: [CONTRIBUTING.md](https://github.com/AlcatrazYU/onenote-ferry/blob/main/CONTRIBUTING.md).

## Release assets

This release includes the Obsidian plugin assets:

- `main.js`
- `manifest.json`
- `styles.css`
