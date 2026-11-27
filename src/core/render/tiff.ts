// TIF pictures as PNG (§11.5 item 77): Obsidian cannot show TIF. The TIF files OneNote keeps are
// uncompressed 8-bit pictures (photos and screenshots pasted in), so they are read here as they
// are and written again as PNG, without loss. Anything else (compressed, tiled, several pages,
// other bit depths) is left as it was.

/** A TIF picture as PNG with the same pixels; undefined for a TIF of another kind, or not a TIF. */
export async function tiffToPng(bytes: Uint8Array): Promise<Uint8Array | undefined> {
	const image = readTiff(bytes);
	return image && await encodePng(image);
}

interface Pixels {
	width: number;
	height: number;
	/** 1 (grey), 3 (RGB) or 4 (RGBA), 8 bits each, rows one after another. */
	channels: 1 | 3 | 4;
	data: Uint8Array;
}

const FIELD_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

function readTiff(b: Uint8Array): Pixels | undefined {
	if (b.length < 8) return undefined;
	const little = b[0] === 0x49 && b[1] === 0x49;
	if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return undefined;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const u16 = (at: number) => view.getUint16(at, little);
	const u32 = (at: number) => view.getUint32(at, little);
	if (u16(2) !== 42) return undefined;
	const ifd = u32(4);
	if (ifd + 2 > b.length) return undefined;
	const count = u16(ifd);
	if (ifd + 2 + count * 12 + 4 > b.length) return undefined;
	// One page only: a second one would be lost.
	if (u32(ifd + 2 + count * 12) !== 0) return undefined;
	const tags = new Map<number, number[]>();
	for (let i = 0; i < count; i++) {
		const at = ifd + 2 + i * 12;
		const tag = u16(at), type = u16(at + 2), n = u32(at + 4);
		const size = FIELD_SIZES[type];
		if (!size || (type !== 3 && type !== 4)) continue;
		const start = size * n <= 4 ? at + 8 : u32(at + 8);
		if (start + size * n > b.length) return undefined;
		tags.set(tag, Array.from({ length: n }, (_, k) => (type === 3 ? u16(start + 2 * k) : u32(start + 4 * k))));
	}
	const one = (tag: number, fallback?: number) => tags.get(tag)?.[0] ?? fallback;
	const width = one(256), height = one(257);
	const compression = one(259, 1), photometric = one(262), samples = one(277, 1), planar = one(284, 1);
	const bits = tags.get(258) ?? [1];
	const offsets = tags.get(273), counts = tags.get(279);
	const rowsPerStrip = Math.min(one(278, height ?? 0)!, height ?? 0);
	if (!width || !height || compression !== 1 || planar !== 1 || !offsets || !counts || offsets.length !== counts.length) return undefined;
	// Turned or mirrored (Orientation other than 1): left as TIF, rather than written another way round (§11.5 item 79).
	if (one(274, 1) !== 1) return undefined;
	if (bits.length !== samples || bits.some(bit => bit !== 8)) return undefined;
	let channels: 1 | 3 | 4;
	if (samples === 1 && (photometric === 0 || photometric === 1)) channels = 1;
	else if (photometric === 2 && samples === 3) channels = 3;
	else if (photometric === 2 && samples === 4 && [0, 1, 2].includes(tags.get(338)?.[0] ?? -1)) channels = 4;
	else return undefined;
	const rowBytes = width * channels;
	if (!(rowsPerStrip > 0) || offsets.length !== Math.ceil(height / rowsPerStrip)) return undefined;
	const data = new Uint8Array(rowBytes * height);
	let at = 0;
	for (const [i, offset] of offsets.entries()) {
		const length = Math.min(counts[i]!, rowBytes * Math.min(rowsPerStrip, height - i * rowsPerStrip));
		if (offset + length > b.length || length !== rowBytes * Math.min(rowsPerStrip, height - i * rowsPerStrip)) return undefined;
		data.set(b.subarray(offset, offset + length), at);
		at += length;
	}
	if (channels === 1 && photometric === 0) for (let i = 0; i < data.length; i++) data[i] = 255 - data[i]!;
	// A fourth sample of no stated use (extra sample 0, often padding) is not transparency, and an
	// alpha channel that is opaque everywhere adds nothing: both left out.
	if (channels === 4) {
		const unspecified = tags.get(338)?.[0] === 0;
		let opaque = true;
		if (!unspecified) for (let i = 3; i < data.length && opaque; i += 4) opaque = data[i] === 255;
		if (unspecified || opaque) {
			const rgb = new Uint8Array(width * height * 3);
			for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
				rgb[q] = data[p]!;
				rgb[q + 1] = data[p + 1]!;
				rgb[q + 2] = data[p + 2]!;
			}
			return { width, height, channels: 3, data: rgb };
		}
		// Premultiplied alpha (extra sample 1) would change in the undoing: kept as TIF.
		if (tags.get(338)?.[0] === 1) return undefined;
	}
	return { width, height, channels, data };
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc(parts: Uint8Array[]): number {
	let c = 0xffffffff;
	for (const part of parts) for (const byte of part) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const name = new TextEncoder().encode(type);
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(name, 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc([name, data]));
	return out;
}

/** PNG of the pixels, each row filtered by the difference from the pixel to its left (filter 1). */
async function encodePng(image: Pixels): Promise<Uint8Array> {
	const { width, height, channels, data } = image;
	const rowBytes = width * channels;
	const filtered = new Uint8Array((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		const from = y * rowBytes, to = y * (rowBytes + 1);
		filtered[to] = 1;
		for (let x = 0; x < rowBytes; x++) filtered[to + 1 + x] = (data[from + x]! - (x >= channels ? data[from + x - channels]! : 0)) & 0xff;
	}
	const stream = new Blob([filtered]).stream().pipeThrough(new CompressionStream('deflate'));
	const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8;
	header[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
	const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
