# OneNote Ferry 1.0.0

The first release. OneNote Ferry turns every page of a OneNote notebook into a Markdown note in your Obsidian vault, and brings in what you change in OneNote later. It runs inside Obsidian on your computer and does not need OneNote for Windows, so it works on a Mac as well.

## Where notebooks come from

- **Straight from your OneDrive.** Sign in to your Microsoft account in your browser; the plugin asks only to read your files. Later updates download only the files that changed.
- **A notebook folder downloaded from the OneDrive website**: the zip file, or the folder after unzipping it. No account is needed.
- **A OneNote for Windows export**: a notebook (`.onepkg`) or a section (`.one`).

## What is converted

- Text formatting and font colors, highlights in their own colors, headings, numbered lists, tables, OneNote tags (as task boxes or callouts), equations (as LaTeX) and web links. Whatever Markdown can express is written in Markdown, so the notes stay easy to edit.
- Links between pages, rewritten to open the matching note in Obsidian.
- The original pictures and attachments, printouts (a PDF printout shows the original PDF), and the text on printout pages in a folded box you can search.
- Handwriting and highlighter, drawn as pictures where they were written.
- A folder and a contents page for each notebook and section, with pages and sections in OneNote's order.
- A report in the folder you import into: what was converted, and anything that could not be, with the reason.

## Keeping notes up to date

Run `Check for OneNote updates` from the command palette, or choose the same source again in the import window:

- Pages you changed in OneNote are replaced with the new version, and the copy they replace goes into a `_previous versions` folder first.
- Pages you changed only in Obsidian are left alone.
- If you changed the same page in both, OneNote's version goes in, your Obsidian version is kept in `_previous versions`, and the window tells you before you update.
- Nothing in your vault is deleted: pages and sections removed in OneNote stay, listed on their contents page.

## Requirements

- Obsidian 1.11.5 or later, on a computer (not on phones or tablets).
- A Microsoft account only to import from OneDrive.

The interface is in English, Simplified Chinese, Japanese and Korean. Contents pages, notices and folder names written into your notes can be in English, Simplified Chinese, Traditional Chinese, Japanese or Korean.

## Known limitations

- The free layout of a page (exact positions, fonts and sizes) is not reproduced. Text boxes follow reading order.
- OneNote does not record where a picture sits inside a text box, so handwriting and highlighter on such a picture are placed by estimate. When the estimate is uncertain, the picture is kept as it is, with a folded copy that shows the estimate.
- Password-protected sections cannot be read. Remove the password in OneNote, then import again.
- Only notebooks in your own OneDrive are listed, not those shared with you. A work or school account may need its administrator's approval before you can sign in.
- OneNote Ferry is developed and tested on macOS. Windows and Linux are not verified yet.

Less common cases are listed in [docs/requirements.md](docs/requirements.md) (in Chinese).

## Release assets

This release includes the Obsidian plugin assets:

- `main.js`
- `manifest.json`
- `styles.css`
