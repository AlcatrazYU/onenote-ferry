//! SHA-1 of attachment bytes, as lowercase hex. Natively it is computed in Rust; in WebAssembly it
//! is handed to Node's crypto, which is many times faster there (the bytes are passed as a view).

#[cfg(not(target_arch = "wasm32"))]
pub fn sha1_hex(data: &[u8]) -> String {
    sha1_smol::Sha1::from(data).digest().to_string()
}

#[cfg(target_arch = "wasm32")]
mod js {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(module = "/js/hash.js")]
    extern "C" {
        #[wasm_bindgen(js_name = sha1Hex)]
        pub fn sha1_hex(data: &[u8]) -> String;
    }
}

#[cfg(target_arch = "wasm32")]
pub fn sha1_hex(data: &[u8]) -> String {
    js::sha1_hex(data)
}
