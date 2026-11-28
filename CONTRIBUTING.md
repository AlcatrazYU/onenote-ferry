# Contributing to OneNote Ferry

Thank you for helping. Reports of pages that do not convert as expected help the most, because everyone's notebooks are different.

## Reporting a problem

[Open an issue](https://github.com/AlcatrazYU/onenote-ferry/issues) and say:

- your system (macOS, Windows or Linux), your Obsidian version and the OneNote Ferry version (Settings, Community plugins);
- where the notebook came from: your OneDrive, a notebook folder downloaded from the OneDrive website (the zip file or the unzipped folder), or a OneNote for Windows export (`.onepkg` or `.one`);
- what the page looks like in OneNote and what you got in Obsidian. A screenshot of each helps.

The conversion report in the folder you imported into (`_conversion report.md`, or its name in your language) lists what could not be converted and why; include the lines about the page.

Please do not attach private notes. A small notebook made only to show the problem is best: OneNote Ferry's own tests use made-up text for the same reason.

## Changing the code

For anything larger than a small fix, open an issue first, so that we can agree on the approach before you spend time on it.

How to build the plugin, run the tests and use the command line version is described in [docs/development.md](docs/development.md). Before you send a pull request:

- run `npm run typecheck`, `npm test` and `npm run test:samples`, and add a test for what you changed;
- use made-up text in tests, never text from real notes;
- keep interface text in all four interface languages (`src/plugin/i18n.ts`), and text written into notes in all five note languages (`src/core/strings.ts`);
- do not use dash characters (U+2013, U+2014, U+2015) in public text: a test checks for them;
- write commit messages as [Conventional Commits](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`).

## Releases

Releases are made by the maintainer. Pushing a version tag runs the [release workflow](.github/workflows/release.yml): GitHub tests and builds the plugin, records build provenance for `main.js`, `manifest.json` and `styles.css`, and publishes them. To check that a release file was built from this repository:

```bash
gh attestation verify main.js --repo AlcatrazYU/onenote-ferry
```

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE) of this project.
