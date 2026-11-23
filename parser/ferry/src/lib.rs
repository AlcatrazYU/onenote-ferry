//! OneNote Ferry's bridge to the OneNote parser.
//!
//! `dump` turns a section into the JSON the TypeScript core reads. Natively the `dump` binary
//! writes attachments to a folder; as WebAssembly (`wasm`), attachments stay in the parsed data
//! and are handed out one at a time by name.

pub mod dump;
mod hash;

#[cfg(target_arch = "wasm32")]
mod wasm;
