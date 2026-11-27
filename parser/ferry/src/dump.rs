//! Turns a parsed OneNote section (desktop or OneDrive/FSSHTTPB format) into the JSON that
//! OneNote Ferry's TypeScript core reads. Each attachment is named by the SHA-1 of its bytes plus
//! its extension, and depending on `AssetSink` is written to a folder, kept for reading later, or
//! only counted.

use parser::Parser;
use parser::contents::{Content, EmbeddedObject, EmbeddedFile, Image, Ink, NoteTag, OutlineElement, OutlineItem, RichText, Table};
use parser::page::{Page, PageContent};
use parser::property::common::ColorRef;
use parser::property::rich_text::ParagraphStyling;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;

/// Where attachment bytes go while a section is dumped.
pub enum AssetSink {
    /// Name and count them only (used to detect changed sections).
    Discard,
    /// Write each once into this folder, named `<sha1>.<ext>`.
    Folder(String),
    /// Keep a handle to each, so its bytes can be read later by name (WebAssembly).
    Keep,
}

/// Something an attachment's bytes can be read from again. Cloning shares the parsed data.
#[derive(Clone)]
pub enum AssetSource {
    Image(Image),
    File(EmbeddedFile),
}

impl AssetSource {
    pub fn read(&self) -> Result<Vec<u8>, String> {
        let mut reader = match self {
            AssetSource::Image(i) => i.read().map_err(|e| e.to_string())?.ok_or_else(|| "image has no data".to_string())?,
            AssetSource::File(f) => f.read().map_err(|e| e.to_string())?,
        };
        let mut data = Vec::new();
        reader.read_to_end(&mut data).map_err(|e| e.to_string())?;
        Ok(data)
    }
}

pub struct Ctx {
    sink: AssetSink,
    written: HashSet<String>,
    assets: usize,
    asset_bytes: u64,
    ink: usize,
    unknown: usize,
    errors: Vec<String>,
    /// Attachments by name, filled when the sink is `Keep`.
    pub kept: HashMap<String, AssetSource>,
}

fn color(c: Option<ColorRef>) -> Value {
    match c {
        Some(ColorRef::Manual { r, g, b }) => json!(format!("#{:02x}{:02x}{:02x}", r, g, b)),
        _ => Value::Null,
    }
}

fn clean_ext(ext: Option<&str>, fallback: &str) -> String {
    let e = ext.unwrap_or(fallback).trim().trim_start_matches('.').to_lowercase();
    let e: String = e.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    if e.is_empty() { fallback.to_string() } else { e }
}

fn ext_of(name: &str) -> Option<&str> {
    let n = name.rsplit(['/', '\\']).next().unwrap_or(name);
    n.rfind('.').map(|i| &n[i + 1..]).filter(|e| !e.is_empty() && e.len() <= 8)
}

fn save(ctx: &mut Ctx, mut reader: Box<dyn Read>, ext: &str, source: AssetSource) -> Value {
    let mut data = Vec::new();
    if let Err(e) = reader.read_to_end(&mut data) {
        ctx.errors.push(format!("asset read failed: {e}"));
        return Value::Null;
    }
    if data.is_empty() {
        return Value::Null;
    }
    let hash = crate::hash::sha1_hex(&data);
    let name = format!("{hash}.{ext}");
    let dir = match &ctx.sink {
        AssetSink::Folder(dir) => dir.clone(),
        AssetSink::Discard | AssetSink::Keep => {
            // Name the asset; keep a handle to it when asked; write nothing.
            if ctx.written.insert(name.clone()) {
                ctx.assets += 1;
                ctx.asset_bytes += data.len() as u64;
                if let AssetSink::Keep = ctx.sink {
                    ctx.kept.insert(name.clone(), source);
                }
            }
            return json!({ "asset": name, "size": data.len() });
        }
    };
    if !ctx.written.contains(&name) {
        let path = Path::new(&dir).join(&name);
        if !path.exists() {
            if let Err(e) = std::fs::write(&path, &data) {
                ctx.errors.push(format!("asset write failed: {e}"));
                return Value::Null;
            }
        }
        ctx.written.insert(name.clone());
        ctx.assets += 1;
        ctx.asset_bytes += data.len() as u64;
    }
    json!({ "asset": name, "size": data.len() })
}

fn tags(list: &[NoteTag]) -> Value {
    Value::Array(
        list.iter()
            .filter_map(|t| {
                let def = t.definition()?;
                Some(json!({
                    "shape": format!("{:?}", def.shape()),
                    "checkable": def.shape().is_checkable(),
                    "completed": t.item_status().completed(),
                    "label": def.label(),
                }))
            })
            .collect(),
    )
}

fn run_json(text: String, s: Option<&ParagraphStyling>, href: Option<String>, latex: Option<String>) -> Value {
    json!({
        "text": text,
        "bold": s.map(|s| s.bold()).unwrap_or(false),
        "italic": s.map(|s| s.italic()).unwrap_or(false),
        "underline": s.map(|s| s.underline()).unwrap_or(false),
        "strike": s.map(|s| s.strikethrough()).unwrap_or(false),
        "sup": s.map(|s| s.superscript()).unwrap_or(false),
        "sub": s.map(|s| s.subscript()).unwrap_or(false),
        "highlight": color(s.and_then(|s| s.highlight())),
        "color": color(s.and_then(|s| s.font_color())),
        "link": s.map(|s| s.hyperlink()).unwrap_or(false),
        "href": href,
        "latex": latex,
        // Font size in half points: where text sits on the page is not stored, its size lets it be estimated.
        "size": s.and_then(|s| s.font_size()),
    })
}

fn rich(ctx: &mut Ctx, rt: &RichText) -> Value {
    let fmts = rt.text_run_formatting();
    let idx = rt.text_run_indices();
    let use_segments = fmts.iter().any(|f| f.math_formatting()) || !rt.embedded_objects().is_empty();
    let runs: Vec<Value> = if use_segments {
        // Math / ink paragraphs: rely on the library's segmentation (it builds LaTeX).
        let fallback = if idx.is_empty() { fmts.first() } else { None };
        rt.text_segments()
            .iter()
            .map(|seg| {
                run_json(
                    seg.text().to_string(),
                    seg.style().or(fallback),
                    seg.hyperlink().map(|h| h.href.clone()),
                    seg.math().map(|m| m.latex.clone()),
                )
            })
            .collect()
    } else {
        // Raw runs, exactly as stored: text split at TextRunIndex (UTF-16 offsets),
        // run i formatted by TextRunFormatting[i]. Hyperlink field codes stay in the
        // text and are lifted by the Markdown writer.
        let units: Vec<u16> = rt.text().encode_utf16().collect();
        let n = std::cmp::max(1, idx.len() + 1);
        let mut start = 0usize;
        (0..n)
            .map(|i| {
                let mut end = if i < idx.len() { std::cmp::min(units.len(), idx[i] as usize) } else { units.len() };
                if end < start {
                    end = start;
                }
                let text = String::from_utf16_lossy(&units[start..end]);
                start = end;
                run_json(text, fmts.get(i), None, None)
            })
            .collect()
    };
    let inks: Vec<Value> = rt
        .embedded_objects()
        .iter()
        .filter_map(|o| match o {
            EmbeddedObject::Ink(c) => Some(c.ink()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|i| ink(ctx, i))
        .collect();
    let style = rt.paragraph_style();
    json!({
        "type": "rich",
        "runs": runs,
        "styleId": style.style_id(),
        "tags": tags(rt.note_tags()),
        "inks": inks,
        // How tall the paragraph is laid out: its font size (half points), the space before and after it, a fixed line spacing.
        "para": {
            "size": style.font_size(),
            "before": rt.paragraph_space_before(),
            "after": rt.paragraph_space_after(),
            "lineExact": rt.paragraph_line_spacing_exact(),
        },
    })
}

fn image(ctx: &mut Ctx, img: &Image) -> Value {
    let ext = clean_ext(img.extension().or_else(|| img.image_filename().and_then(ext_of)), "png");
    let asset = match img.read() {
        Ok(Some(r)) => save(ctx, r, &ext, AssetSource::Image(img.clone())),
        Ok(None) => Value::Null,
        Err(e) => {
            ctx.errors.push(format!("image read failed: {e}"));
            Value::Null
        }
    };
    json!({
        "type": "image",
        "asset": asset,
        "fileName": img.image_filename(),
        "alt": img.alt_text(),
        "x": img.offset_horizontal(), "y": img.offset_vertical(), "w": img.layout_max_width(), "h": img.layout_max_height(),
        "background": img.is_background(),
        "href": img.hyperlink_url(),
        "ocr": img.text(),
        // Printouts keep the whole XPS/PDF and show one page of it.
        "page": img.displayed_page_number(),
    })
}

fn embedded(ctx: &mut Ctx, f: &EmbeddedFile) -> Value {
    let ext = clean_ext(ext_of(f.filename()), "bin");
    let asset = match f.read() {
        Ok(r) => save(ctx, r, &ext, AssetSource::File(f.clone())),
        Err(e) => {
            ctx.errors.push(format!("file read failed: {e}"));
            Value::Null
        }
    };
    if asset.is_null() {
        ctx.errors.push(format!("embedded file has no data: {}", f.filename()));
    }
    json!({
        "type": "file",
        "asset": asset,
        "fileName": f.filename(),
        "x": f.offset_horizontal(), "y": f.offset_vertical(), "w": f.layout_max_width(),
    })
}

fn ink(ctx: &mut Ctx, ink: &Ink) -> Value {
    ctx.ink += 1;
    fn strokes(ink: &Ink, out: &mut Vec<Value>) {
        for s in ink.ink_strokes() {
            let pts: Vec<Value> = s.path().iter().map(|p| json!([p.x(), p.y()])).collect();
            out.push(json!({ "points": pts, "width": s.width(), "height": s.height(), "color": s.color(), "transparency": s.transparency(), "tip": s.pen_tip() }));
        }
        for g in ink.child_groups() {
            strokes(g, out);
        }
    }
    let mut out = Vec::new();
    strokes(ink, &mut out);
    let bbox = ink.bounding_box().map(|b| json!([b.x(), b.y(), b.width(), b.height()]));
    json!({ "type": "ink", "strokes": out, "bbox": bbox, "x": ink.offset_horizontal(), "y": ink.offset_vertical() })
}

fn table(ctx: &mut Ctx, t: &Table) -> Value {
    let rows: Vec<Value> = t
        .contents()
        .iter()
        .map(|row| {
            Value::Array(
                row.contents()
                    .iter()
                    .map(|cell| Value::Array(cell.contents().iter().map(|e| element(ctx, e)).collect()))
                    .collect(),
            )
        })
        .collect();
    json!({ "type": "table", "rows": rows })
}

fn content(ctx: &mut Ctx, c: &Content) -> Value {
    match c {
        Content::RichText(rt) => rich(ctx, rt),
        Content::Table(t) => table(ctx, t),
        Content::Image(i) => image(ctx, i),
        Content::EmbeddedFile(f) => embedded(ctx, f),
        Content::Ink(i) => ink(ctx, i),
        _ => {
            ctx.unknown += 1;
            json!({ "type": "unknown" })
        }
    }
}

fn element(ctx: &mut Ctx, e: &OutlineElement) -> Value {
    let contents: Vec<Value> = e.contents().iter().map(|c| content(ctx, c)).collect();
    let list = e.list_contents().first().map(|l| json!({ "format": l.list_format().iter().collect::<String>() }));
    let children: Vec<Value> = e.children().iter().map(|i| item(ctx, i)).collect();
    json!({ "type": "element", "level": e.child_level(), "list": list, "contents": contents, "children": children })
}

fn item(ctx: &mut Ctx, i: &OutlineItem) -> Value {
    match i {
        OutlineItem::Element(e) => element(ctx, e),
        OutlineItem::Group(g) => {
            let items: Vec<Value> = g.outlines().iter().map(|i| item(ctx, i)).collect();
            json!({ "type": "group", "level": g.child_level(), "items": items })
        }
    }
}

fn page(ctx: &mut Ctx, p: &Page) -> Value {
    let contents: Vec<Value> = p
        .contents()
        .iter()
        .map(|c| match c {
            PageContent::Outline(o) => {
                let items: Vec<Value> = o.items().iter().map(|i| item(ctx, i)).collect();
                json!({ "type": "outline", "x": o.offset_horizontal(), "y": o.offset_vertical(), "w": o.layout_max_width(), "h": o.layout_max_height(), "bySize": o.is_layout_size_set_by_user(), "items": items })
            }
            PageContent::Image(i) => image(ctx, i),
            PageContent::EmbeddedFile(f) => embedded(ctx, f),
            PageContent::Ink(i) => ink(ctx, i),
            #[allow(unreachable_patterns)]
            _ => {
                ctx.unknown += 1;
                json!({ "type": "unknown" })
            }
        })
        .collect();
    json!({
        "id": p.link_target_id(),
        "title": p.title_text(),
        "level": p.level(),
        "created": p.created_time().unix_timestamp(),
        "updated": p.updated_time().unix_timestamp(),
        "contents": contents,
    })
}

/// Result of dumping one section.
pub struct Dumped {
    pub json: Value,
    pub ctx: Ctx,
}

impl Dumped {
    /// One-line summary, as the command line prints it.
    pub fn summary(&self) -> String {
        format!(
            "OK pages={} assets={} bytes={} ink={} unknown={} errors={}",
            self.json["pages"].as_array().map(|p| p.len()).unwrap_or(0),
            self.ctx.assets, self.ctx.asset_bytes, self.ctx.ink, self.ctx.unknown,
            self.json["errors"].as_array().map(|e| e.len()).unwrap_or(0)
        )
    }
}

/// Parses the section at `path` and builds its JSON. Fails only when the section cannot be parsed.
pub fn dump_section(path: &str, sink: AssetSink) -> Result<Dumped, String> {
    let mut ctx = Ctx { sink, written: HashSet::new(), assets: 0, asset_bytes: 0, ink: 0, unknown: 0, errors: vec![], kept: HashMap::new() };
    let mut parser = Parser::new();
    let section = parser.parse_section(path).map_err(|e| e.to_string())?;
    let mut pages = Vec::new();
    for series in section.page_series() {
        for e in series.errors() {
            ctx.errors.push(format!("page series: {e}"));
        }
        for p in series.pages() {
            pages.push(page(&mut ctx, p));
        }
    }
    let json = json!({
        "name": section.display_name(),
        "pages": pages,
        "stats": { "assets": ctx.assets, "assetBytes": ctx.asset_bytes, "ink": ctx.ink, "unknown": ctx.unknown },
        "errors": ctx.errors,
    });
    Ok(Dumped { json, ctx })
}

/// Section names listed in a `.onetoc2` table of contents (empty in OneDrive downloads).
pub fn toc_names(path: &str) -> Result<Vec<String>, String> {
    Parser::new().parse_toc_names(path).map_err(|e| e.to_string())
}
