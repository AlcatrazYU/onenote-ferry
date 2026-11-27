use std::rc::Rc;

use crate::onenote::notebook::Notebook;
use crate::onenote::section::{Section, SectionEntry, SectionGroup};
use crate::onestore::{OneStore, OneStoreType, parse_onestore};
use parser_utils::errors::{ErrorKind, Result};
use parser_utils::{fs_driver, log, reader::Reader};

pub(crate) mod content;
pub(crate) mod embedded_file;
pub(crate) mod iframe;
pub(crate) mod image;
pub(crate) mod ink;
pub(crate) mod list;
pub(crate) mod note_tag;
pub(crate) mod notebook;
pub(crate) mod outline;
pub(crate) mod page;
pub(crate) mod page_content;
pub(crate) mod page_series;
pub(crate) mod rich_text;
pub(crate) mod section;
pub(crate) mod table;
pub(crate) mod text_region;

/// The OneNote file parser.
pub struct Parser;

impl Parser {
    /// Create a new OneNote file parser.
    pub fn new() -> Parser {
        Parser {}
    }

    /// Parse a OneNote notebook.
    ///
    /// The `path` argument must point to a `.onetoc2` file. This will parse the
    /// table of contents of the notebook as well as all contained
    /// sections from the folder that the table of contents file is in.
    pub fn parse_notebook(&mut self, path: String) -> Result<Notebook> {
        log!("Parsing notebook: {:?}", path);
        let data = fs_driver().open_file(&path)?;
        let store = parse_onestore(&mut Reader::try_from(data)?)?;

        if store.get_type() != OneStoreType::TableOfContents {
            return Err(ErrorKind::NotATocFile { file: path }.into());
        }

        let base_dir = fs_driver().get_dir_name(&path);
        let sections = notebook::parse_toc(store.data_root())?
            .iter()
            .map(|name| fs_driver().join(&base_dir, name))
            .filter(|p| !p.contains("OneNote_RecycleBin"))
            .filter(|p| fs_driver().exists(p).unwrap_or(false))
            .map(|p| {
                let is_dir = fs_driver().is_directory(&p)?;
                if !is_dir {
                    self.parse_section(&p).map(SectionEntry::Section)
                } else {
                    self.parse_section_group(p).map(SectionEntry::SectionGroup)
                }
            })
            .collect::<Result<_>>()?;

        Ok(Notebook { entries: sections })
    }

    /// Read only the ordered entry names (section files and group folders) of a table of contents.
    pub fn parse_toc_names(&mut self, path: &str) -> Result<Vec<String>> {
        let data = fs_driver().open_file(path)?;
        let store = parse_onestore(&mut Reader::try_from(data)?)?;
        if store.get_type() != OneStoreType::TableOfContents {
            return Err(ErrorKind::NotATocFile { file: path.to_string() }.into());
        }
        notebook::parse_toc(store.data_root())
    }

    /// OneNote Ferry patch: `parse_toc_names` for a table of contents in memory. Tables of contents
    /// stored in OneDrive often begin with an empty table in the desktop format and hold the real
    /// one, in the format OneDrive downloads use, after it; when the beginning gives no names, they
    /// are read from where that second one starts.
    pub fn parse_toc_names_from_data(&mut self, data: &[u8]) -> Result<Vec<String>> {
        let first = Self::toc_names_in(data);
        if matches!(&first, Ok(names) if !names.is_empty()) {
            return first;
        }
        match packaged_store_after_start(data) {
            Some(at) => Self::toc_names_in(&data[at..]),
            None => first,
        }
    }

    fn toc_names_in(data: &[u8]) -> Result<Vec<String>> {
        let store = parse_onestore(&mut Reader::from(data))?;
        if store.get_type() != OneStoreType::TableOfContents {
            return Err(ErrorKind::NotATocFile { file: "(table of contents)".to_string() }.into());
        }
        notebook::parse_toc(store.data_root())
    }

    /// Parse a OneNote section file.
    ///
    /// The `path` argument must point to a `.one` file that contains a
    /// OneNote section.
    pub fn parse_section(&mut self, path: &str) -> Result<Section> {
        log!("Parsing section: {:?}", path);
        let file = fs_driver().open_file(path)?;
        self.parse_section_from_reader(Reader::try_from(file)?, path)
    }

    /// Parses low-level OneStore data. Exported for debugging purposes.
    pub fn parse_onestore_raw(&mut self, path: &str) -> Result<Rc<dyn OneStore>> {
        log!("Parsing OneStore: {:?}", path);
        let file = fs_driver().open_file(path)?;
        parse_onestore(&mut Reader::try_from(file)?)
    }

    /// Parse a OneNote section file from a byte array.
    /// The [path] is used to provide debugging information and determine
    /// the name of the section file.
    pub fn parse_section_from_data(&mut self, data: &[u8], path: &str) -> Result<Section> {
        self.parse_section_from_reader(Reader::from(data), path)
    }

    fn parse_section_from_reader(&mut self, mut reader: Reader, path: &str) -> Result<Section> {
        let store = parse_onestore(&mut reader)?;

        if store.get_type() != OneStoreType::Section {
            return Err(ErrorKind::NotASectionFile {
                file: String::from(path),
            }
            .into());
        }

        let filename = fs_driver()
            .get_file_name(path)
            .expect("file without file name");
        section::parse_section(store, filename)
    }

    fn parse_section_group(&mut self, path: String) -> Result<SectionGroup> {
        let display_name = fs_driver()
            .get_file_name(path.as_str())
            .expect("file without file name");

        if let Ok(entries) = fs_driver().read_dir(&path) {
            for entry in entries {
                let ext = fs_driver().get_file_extension(&entry);
                if ext == ".onetoc2" {
                    return self.parse_notebook(entry).map(|group| SectionGroup {
                        display_name,
                        entries: group.entries,
                    });
                }
            }
        }

        Err(ErrorKind::TocFileMissing { dir: path }.into())
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

/// OneNote Ferry patch: where a store in the format OneDrive downloads use begins after the start of
/// `data`: its file type GUID, then 48 bytes on, the GUID of that format ([MS-ONESTORE] 2.8).
fn packaged_store_after_start(data: &[u8]) -> Option<usize> {
    const FILE_TYPE: [u8; 16] = [0xE4, 0x52, 0x5C, 0x7B, 0x8C, 0xD8, 0xA7, 0x4D, 0xAE, 0xB1, 0x53, 0x78, 0xD0, 0x29, 0x96, 0xD3];
    const PACKAGING: [u8; 16] = [0x2F, 0xE9, 0x8D, 0x63, 0xD4, 0xA6, 0xC1, 0x4B, 0x9A, 0x36, 0xB3, 0xFC, 0x25, 0x11, 0xA5, 0xB7];
    (1..data.len().saturating_sub(64)).find(|&at| data[at..at + 16] == FILE_TYPE && data[at + 48..at + 64] == PACKAGING)
}
