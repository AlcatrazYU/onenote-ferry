//! How dark each pixel row of a picture is, for lining up highlighter strokes with the rows of text
//! in a screenshot (OneNote Ferry §11.5 item 67). Only the row profile leaves this module: the
//! pixels are read row by row (PNG) or at a reduced scale (JPEG), so memory stays small.

/// Pictures larger than this are not read (they are treated as pictures whose rows are unknown).
const MAX_PIXELS: u64 = 40_000_000;
/// Pixels sampled across each row.
const SAMPLES: usize = 600;

/// `[width, height, paper, dark...]`: the size of the rows read, the paper's brightness (0 to 255),
/// and for each row the share of sampled pixels clearly darker than the paper.
pub fn row_profile(bytes: &[u8]) -> Option<Vec<f32>> {
    let rows = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        png_rows(bytes)?
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        jpeg_rows(bytes)?
    } else {
        return None;
    };
    profile(rows)
}

/// Brightness of sampled pixels, row by row, and the width they were sampled from.
struct Rows {
    width: usize,
    lum: Vec<Vec<u8>>,
}

fn sample_columns(width: usize) -> Vec<usize> {
    let n = width.min(SAMPLES);
    (0..n).map(|i| i * width / n).collect()
}

fn luminance(r: u8, g: u8, b: u8) -> u8 {
    ((r as u32 * 299 + g as u32 * 587 + b as u32 * 114) / 1000) as u8
}

fn png_rows(bytes: &[u8]) -> Option<Rows> {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().ok()?;
    let info = reader.info();
    let (width, height) = (info.width as usize, info.height as usize);
    if info.interlaced || width == 0 || (width as u64) * (height as u64) > MAX_PIXELS {
        return None;
    }
    let (color, _) = reader.output_color_type();
    let channels = color.samples();
    let columns = sample_columns(width);
    let mut lum = Vec::with_capacity(height);
    while let Ok(Some(row)) = reader.next_row() {
        let data = row.data();
        lum.push(
            columns
                .iter()
                .map(|&x| {
                    let p = &data[x * channels..x * channels + channels];
                    match channels {
                        1 | 2 => p[0],
                        _ => luminance(p[0], p[1], p[2]),
                    }
                })
                .collect(),
        );
    }
    (lum.len() == height).then_some(Rows { width, lum })
}

fn jpeg_rows(bytes: &[u8]) -> Option<Rows> {
    let mut decoder = jpeg_decoder::Decoder::new(bytes);
    decoder.read_info().ok()?;
    let info = decoder.info()?;
    if (info.width as u64) * (info.height as u64) > MAX_PIXELS {
        return None;
    }
    // Decoded at a reduced scale (the decoder picks 1/2, 1/4 or 1/8): rows of text stay rows.
    let target = SAMPLES.min(info.width as usize) as u16;
    let (width, height) = decoder.scale(target, (target as u32 * info.height as u32 / info.width.max(1) as u32).max(1) as u16).ok()?;
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let (width, height) = (width as usize, height as usize);
    let channels = match info.pixel_format {
        jpeg_decoder::PixelFormat::L8 => 1,
        jpeg_decoder::PixelFormat::RGB24 => 3,
        jpeg_decoder::PixelFormat::CMYK32 => 4,
        jpeg_decoder::PixelFormat::L16 => return None,
    };
    if pixels.len() < width * height * channels {
        return None;
    }
    let columns = sample_columns(width);
    let lum = (0..height)
        .map(|y| {
            columns
                .iter()
                .map(|&x| {
                    let p = &pixels[(y * width + x) * channels..(y * width + x) * channels + channels];
                    match channels {
                        1 => p[0],
                        3 => luminance(p[0], p[1], p[2]),
                        // Adobe CMYK is stored inverted: the ink is what is missing from white.
                        _ => luminance(p[0], p[1], p[2]).saturating_sub(255 - p[3]),
                    }
                })
                .collect()
        })
        .collect();
    Some(Rows { width, lum })
}

fn profile(rows: Rows) -> Option<Vec<f32>> {
    if rows.lum.is_empty() {
        return None;
    }
    // The paper: the median brightness of the pixels sampled.
    let mut histogram = [0u64; 256];
    let mut total = 0u64;
    for row in rows.lum.iter().step_by(2) {
        for &v in row.iter().step_by(2) {
            histogram[v as usize] += 1;
            total += 1;
        }
    }
    let mut seen = 0u64;
    let mut paper = 255u8;
    for (v, &n) in histogram.iter().enumerate() {
        seen += n;
        if seen * 2 >= total {
            paper = v as u8;
            break;
        }
    }
    let cut = paper as f32 * 0.6;
    let mut out = Vec::with_capacity(rows.lum.len() + 3);
    out.push(rows.width as f32);
    out.push(rows.lum.len() as f32);
    out.push(paper as f32);
    for row in &rows.lum {
        let dark = row.iter().filter(|&&v| (v as f32) < cut).count();
        out.push(dark as f32 / row.len().max(1) as f32);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::row_profile;

    /// A white grey-scale PNG, `width` by `height`, with the rows in `dark` black.
    fn png(width: u32, height: u32, dark: &[u32]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let pixels: Vec<u8> = (0..height)
                .flat_map(|y| std::iter::repeat(if dark.contains(&y) { 0 } else { 255 }).take(width as usize))
                .collect();
            writer.write_image_data(&pixels).unwrap();
        }
        out
    }

    #[test]
    fn rows_of_a_png() {
        let profile = row_profile(&png(80, 6, &[2, 3])).unwrap();
        assert_eq!(profile[..3], [80.0, 6.0, 255.0]);
        assert_eq!(profile[3..], [0.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn not_a_picture() {
        assert_eq!(row_profile(b"GIF89a"), None);
        assert_eq!(row_profile(&[0x89, b'P', b'N', b'G', 0, 0]), None);
    }
}
