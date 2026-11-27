# Building and the Command Line

This page is for people who want to build OneNote Ferry from source, run its tests, or convert notebooks without Obsidian. Installing the plugin from Obsidian's Community plugins needs none of this.

## Building the plugin

You need Node.js 22.18 or later, and, for the parser, Rust with [wasm-pack](https://rustwasm.github.io/wasm-pack/).

```bash
npm install
npm run build:parser
npm test
node scripts/build-plugin.mjs --install "<your vault>/.obsidian/plugins/onenote-ferry"
```

`npm run build:parser` compiles the OneNote parser (in `parser/`) to WebAssembly. The last command builds `main.js` and copies the plugin into a vault; reload the plugin in Obsidian afterwards.

## Command line

The command line version converts notebooks the same way the plugin does. It reads downloads and exports only; it does not sign in to OneDrive.

```bash
node src/cli/main.ts <download or export> <output folder> [options]
```

`<download or export>` is the zip from the OneDrive website, the folder after unzipping it (or one notebook folder in it), or a notebook (`.onepkg`) or section (`.one`) exported by OneNote for Windows.

| Option | What it does |
| --- | --- |
| `--only "A\|B"` | Convert only these notebooks (exact names) |
| `--language <code>` | Language of contents pages, notices and folder names: `en`, `zh-Hans`, `zh-Hant`, `ja` or `ko` (default: the system's language), or `auto` to read each notebook's own language from its text |
| `--no-box-markers` | No position comments before text boxes |
| `--image-text` | Write the text pictures carry (alt text, text OneNote recognized) below them |
| `--no-links` | Leave links between pages as they are |

To update an earlier conversion from a newer download:

```bash
node src/cli/main.ts sync <newer download> <output folder>
```

Without `--apply`, it only lists what would change. With `--apply`, it updates the output folder in place: pages OneNote changed are replaced, and their earlier versions go to the previous versions folder; nothing is deleted. `--new` also adds sections not converted before, and `--restore-deleted` writes back pages deleted from the output folder.

`node src/cli/main.ts plan <newer download> <output folder>` lists, per section, what is new, changed, unchanged or gone, and changes nothing.

## Where things are

- `src/core`: the conversion, shared by the plugin and the command line.
- `src/plugin`: the Obsidian plugin (import window, settings, OneDrive sign-in and download).
- `src/node`: reading downloads, exports and the OneDrive copy from disk.
- `src/cli`: the command line.
- `parser`: the OneNote parser, adapted from Joplin's (see [parser/UPSTREAM.md](../parser/UPSTREAM.md)).
- `tests`: unit tests (`npm test`) and sample files with their expected output (`npm run test:samples`).

The full scope and its decisions are described in [requirements.md](requirements.md) (in Chinese).
