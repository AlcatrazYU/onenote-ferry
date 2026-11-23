# Third-party licenses

OneNote Ferry is released under the MIT License (see `LICENSE`). It includes code adapted from the projects below, which keep their own licenses.

## Obsidian Importer

- Source: https://github.com/obsidianmd/obsidian-importer (commit `fa9444a188459f227b07ec121ad03d26bd6b301a`)
- Used in: `src/core/model.ts`, `src/core/markdown.ts`, `src/core/adapter.ts` (`liftHyperlinkFields`), `src/core/render/inline.ts`, `src/core/render/page.ts`, `src/core/render/ink-svg.ts` (adapted and extended; each file says what it was adapted from)
- License: MIT

```
MIT License

Copyright (c) 2023 Obsidian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Joplin OneNote converter (onenote.rs)

- Source: npm package `@joplin/onenote-converter` 3.7.4 (https://github.com/laurent22/joplin, `packages/onenote-converter`, commit `898d2999f93fbedf0ce5f6626feb63e1a732ce0a`), based on https://github.com/msiemens/onenote.rs
- Used in: `parser/parser`, `parser/parser-utils`, `parser/parser-macros`, `parser/test-data` (with the changes listed in `parser/UPSTREAM.md`)
- License: Mozilla Public License 2.0, full text in `parser/LICENSE`. The files keep that license; their source is published in this repository.
- `parser/test-data/onenote-2016` carries its own license file.

