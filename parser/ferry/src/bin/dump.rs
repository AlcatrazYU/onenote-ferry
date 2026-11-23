//! Native command line, same interface as OneNote Ferry's original converter:
//!
//!   dump <section.one> <out.json> <assets_dir>   (assets_dir "-" = write no assets)
//!   dump --toc <notebook.onetoc2>

use ferry::dump::{AssetSink, dump_section, toc_names};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == "--toc" {
        match toc_names(&args[2]) {
            Ok(names) => {
                println!("{}", serde_json::to_string(&names).unwrap());
                return;
            }
            Err(e) => {
                eprintln!("TOC_ERROR: {e}");
                std::process::exit(3);
            }
        }
    }
    if args.len() < 4 {
        eprintln!("Usage: {} <section.one> <out.json> <assets_dir>", args[0]);
        std::process::exit(2);
    }
    let sink = if args[3] == "-" {
        AssetSink::Discard
    } else {
        std::fs::create_dir_all(&args[3]).expect("cannot create assets dir");
        AssetSink::Folder(args[3].clone())
    };
    let dumped = match dump_section(&args[1], sink) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("PARSE_ERROR: {e}");
            std::process::exit(3);
        }
    };
    std::fs::write(&args[2], serde_json::to_vec(&dumped.json).unwrap()).expect("cannot write json");
    eprintln!("{}", dumped.summary());
}
