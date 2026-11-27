//! WebAssembly interface for the TypeScript core.
//!
//! `parseSection(path)` parses one section (reading the file through Node's `fs`, on demand) and
//! returns a handle: its JSON once, then each attachment's bytes by name, one at a time, so that
//! attachments are never all copied out of the parsed data together.

use std::collections::HashMap;

use wasm_bindgen::prelude::*;

use crate::dump::{AssetSink, AssetSource, dump_section};

#[wasm_bindgen]
pub struct ParsedSection {
    json: String,
    assets: HashMap<String, AssetSource>,
}

#[wasm_bindgen]
impl ParsedSection {
    /// The section's JSON. Taken once: later calls return an empty string.
    #[wasm_bindgen(js_name = takeJson)]
    pub fn take_json(&mut self) -> String {
        std::mem::take(&mut self.json)
    }

    /// The bytes of the attachment named `key` in the JSON (`<sha1>.<ext>`).
    #[wasm_bindgen(js_name = readAsset)]
    pub fn read_asset(&self, key: &str) -> Result<Vec<u8>, JsError> {
        let source = self.assets.get(key).ok_or_else(|| JsError::new(&format!("no attachment named {key}")))?;
        source.read().map_err(|e| JsError::new(&e))
    }

    /// How dark each pixel row of the picture named `key` is (see profile.rs), or nothing when it
    /// cannot be read (not PNG or JPEG, too large, damaged).
    #[wasm_bindgen(js_name = rowProfile)]
    pub fn row_profile(&self, key: &str) -> Option<Vec<f32>> {
        let bytes = self.assets.get(key)?.read().ok()?;
        crate::profile::row_profile(&bytes)
    }

    #[wasm_bindgen(getter, js_name = assetCount)]
    pub fn asset_count(&self) -> usize {
        self.assets.len()
    }
}

/// Parsing holds about 1.6 times the section's size. Growing WebAssembly memory a little at a time
/// costs Node a bookkeeping pass (and often a garbage collection) per step, which made a 1.7 GB
/// section several times slower than it needed to be; so the memory is grown once, up front, by
/// allocating and freeing it. The allocator keeps it and later allocations reuse it.
const RESERVE_FACTOR: f64 = 1.5;

fn reserve_memory(bytes: u64) {
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut left = bytes;
    while left > 0 {
        let n = left.min(1 << 30) as usize;
        let mut chunk = Vec::new();
        if chunk.try_reserve_exact(n).is_err() {
            break;
        }
        chunks.push(chunk);
        left -= n as u64;
    }
}

#[wasm_bindgen(js_name = parseSection)]
pub fn parse_section(path: &str) -> Result<ParsedSection, JsError> {
    console_error_panic_hook::set_once();
    if let Ok(file) = parser_utils::fs_driver().open_file(path) {
        reserve_memory((file.byte_length() as f64 * RESERVE_FACTOR) as u64);
    }
    let dumped = dump_section(path, AssetSink::Keep).map_err(|e| JsError::new(&format!("PARSE_ERROR: {e}")))?;
    let json = serde_json::to_string(&dumped.json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(ParsedSection { json, assets: dumped.ctx.kept })
}

/// The names a notebook's table of contents (`.onetoc2`, its bytes) lists, in OneNote's order:
/// sections as `<name>.one`, section groups by their folder names. Empty when it cannot be read.
#[wasm_bindgen(js_name = tocNames)]
pub fn toc_names(data: &[u8]) -> Vec<String> {
    console_error_panic_hook::set_once();
    crate::dump::toc_names_from_data(data).unwrap_or_default()
}

/// Current WebAssembly memory in bytes. Memory never shrinks, so after a parse this is its peak.
#[wasm_bindgen(js_name = memoryBytes)]
pub fn memory_bytes() -> f64 {
    (core::arch::wasm32::memory_size(0) as f64) * 65536.0
}
