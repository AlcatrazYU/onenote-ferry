//! OneNote Ferry's bridge to the OneNote parser.
//!
//! `dump` turns a section into the JSON the TypeScript core reads. Natively the `dump` binary
//! writes attachments to a folder; as WebAssembly (`wasm`), attachments stay in the parsed data
//! and are handed out one at a time by name. `profile` reads a picture's rows of pixels, for
//! lining up highlighter strokes with the text in screenshots.

pub mod dump;
mod hash;
pub mod profile;

#[cfg(target_arch = "wasm32")]
mod wasm;
