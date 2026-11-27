# Where the parser comes from

The crates `parser`, `parser-utils` and `parser-macros`, the `test-data` folder, `LICENSE` and the
starting `Cargo.lock` come from the npm package `@joplin/onenote-converter` version 3.7.4
(Joplin repository commit `898d2999f93fbedf0ce5f6626feb63e1a732ce0a`), which is based on
Markus Siemens' [onenote.rs](https://github.com/msiemens/onenote.rs). They are licensed under the
Mozilla Public License 2.0 (see `LICENSE`).

Not included: Joplin's HTML renderer (`renderer`), its build tools and its npm packaging.

`ferry` is OneNote Ferry's own crate (also MPL-2.0): it turns a parsed section into the JSON the
TypeScript core reads, as a native `dump` binary and as WebAssembly.

## Changes made to the upstream code

1. `parser/src/onenote/table.rs`, `parser/src/onenote/outline.rs`: a table cell that holds a group
   of outlines (object type 0x60019) no longer fails the whole page; the group is flattened into
   the cell. Reported upstream in laurent22/joplin#16569.
2. `parser/src/one/property_set/embedded_file_container.rs`: an embedded file container that has
   no data is read as an empty file instead of failing the whole page. Reported upstream in
   laurent22/joplin#17178.
3. `parser/src/onenote/mod.rs`: adds `Parser::parse_toc_names`, which reads the ordered entry names
   of a `.onetoc2` table of contents.
4. `parser-utils/src/reader.rs`, `parser-utils/src/file_api/api.rs`,
   `parser-utils/src/file_api/native_driver.rs`, `parser-utils/src/file_api/wasm_driver.rs`: a new
   `FileHandle::seek_to` keeps the read buffer when seeking to a position inside it, instead of
   discarding it and reading the same block again. Parsing results are unchanged. On a 1.7 GB
   section the WebAssembly build makes about 137 times fewer file reads (739,634 down to 5,393).

5. `parser/src/local_onestore/objects/revision_manifest_list.rs`, `objects/revision.rs`,
   `objects/object_space.rs`, `file_node/file_node.rs` (desktop files only): an object space's
   content now comes from its current revision, the last one assigned revision role 0x1 in the
   default context (by its manifest start or by a later role declaration), and the revisions it
   builds on. Before, the first revision with a root was used, which in files with page history is
   often an old version or the version history itself: such pages failed with "unexpected object
   type: 0x20046" and were dropped, or an old version of the page was converted. Checked against the
   expectations in the Aspose.Note FOSS test suite (see `tests/samples`); files in the OneDrive
   download format use other code and are unchanged.

6. `parser-utils/node_functions.js` (the WebAssembly build's file access): `fileReader` can read a
   section stored uncompressed inside a zip in place. When the caller has registered
   `globalThis.__ONENOTE_FERRY_RANGES__.set(name, { file, offset, length })`, parsing `name` reads
   that byte range of `file`. Other paths are read as before. Checked on a 17.5 GB OneDrive
   download: sections read in place give the same JSON and attachment bytes as copies of them.

7. `parser/src/local_onestore/file_structure/file_node_list_fragment.rs` (desktop files only): a
   file node list fragment stops at its chunk terminator. The bytes after it, up to the reference
   to the next fragment, are padding, but they were read as more nodes when the transaction log
   counted more nodes than the fragment holds. A 1.3 GB section exported by OneNote for Windows
   failed with "unexpected property type: 0x0" (or with nodes of unknown types); it now reads
   (15 pages, 542 attachments). The public samples give the same JSON as before.

8. `parser/src/onestore/object_space.rs`, `parser/src/local_onestore/objects/object_space.rs`,
   `parser/src/onenote/page.rs` (desktop files only): a page also tells the GUID its page history
   gives it (`Page::history_link_target_id`), when every older revision agrees on one GUID and it is
   not the page's current one. OneNote for Windows gives each page a new GUID, in a new revision,
   when it exports a section or notebook; the history keeps the GUID that OneNote, OneDrive and
   links to the page use. In a 1.3 GB section exported by OneNote for Windows all 15 pages had a new
   GUID, and their history held the GUIDs the same pages have in the OneDrive download. Files in
   the OneDrive download format have no history here and are unchanged; the public samples give the
   same JSON as before. (`ferry` uses it as the page's id unless two pages of a section would share
   one.)

Changes 4, 5, 7 and 8 are marked in the code with comments that start with "OneNote Ferry patch"; changes 2 and 3
and the table part of change 1 carry comments that explain them, and the outline part of change 1
only makes `parse_outline_item` visible to the crate. Change 6 carries a comment starting with
"OneNote Ferry". To see every change, compare this folder with
the files of the npm package named above.
