# Public sample files

Real OneNote files published by others under open licenses, used by `npm run test:samples`
(`run.check.ts`). None of them comes from the maintainer's own notes.

| Folder | Source | License |
|---|---|---|
| `interop/` | [OfficeDev/Interop-TestSuites](https://github.com/OfficeDev/Interop-TestSuites), commit `fe87ed3253de01804a2ae6e1d0015943da6023f8`: `FileSyncandWOPI/Source/MS-ONESTORE/TestSuite/Resources/` and `FileSyncandWOPI/Setup/SUT/` (`InvalidData.one`, `FileSyncWOPI_OneNoteWithODB.one`). `LargeData.one` (11 MB) is left out to keep the repository small. | MIT, see `interop/LICENSE` |
| `aspose/` | [aspose-note-foss/Aspose.Note-FOSS-for-Python](https://github.com/aspose-note-foss/Aspose.Note-FOSS-for-Python), commit `0fd1cf7bcadb279a6dd73ddcba3d5241376badd3`: `testfiles/` | MIT, see `aspose/LICENSE` |
| `../../parser/test-data/` | The test data of the Joplin OneNote parser (see `parser/UPSTREAM.md`) | MPL-2.0 (`onenote-2016/` from Interop-TestSuites, MIT) |

`AlternativePackaging.one` and `parser/test-data/single-page/` are in the format OneDrive downloads use;
the rest are desktop files (the format OneNote for Windows saves and exports).

`expected/` holds the converted output of every sample (as `.md.txt`, so that Obsidian does not index
it as notes). After a reviewed change to the output, rewrite it with `UPDATE=1 npm run test:samples`.
