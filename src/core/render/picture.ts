// What a picture's bytes are: type and size in pixels, read from the file header, and the bytes as
// base64 for a data URL. Only the formats a browser (and so Obsidian) can draw inside an SVG.

export interface PictureInfo {
	mime: string;
	width: number;
	height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b: Uint8Array, i: number) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** PNG, JPEG, GIF, BMP or WebP; undefined for anything else (TIFF, EMF, a document). */
export function pictureInfo(b: Uint8Array): PictureInfo | undefined {
	const ok = (mime: string, width: number, height: number) => (width > 0 && height > 0 ? { mime, width, height } : undefined);
	if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return ok('image/png', u32be(b, 16), u32be(b, 20));
	if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') return ok('image/gif', u16le(b, 6), u16le(b, 8));
	if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return ok('image/bmp', u32le(b, 18), Math.abs(u32le(b, 22) | 0));
	if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
		const kind = ascii(b, 12, 4);
		if (kind === 'VP8X') return ok('image/webp', 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
		if (kind === 'VP8 ') return ok('image/webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
		if (kind === 'VP8L') {
			const bits = u32le(b, 21);
			return ok('image/webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
		}
		return undefined;
	}
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = b[i + 1];
			if (marker === 0xff) {
				i++;
				continue;
			}
			// Start of frame (any coding except the DHT, JPG and DAC markers in that range).
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return ok('image/jpeg', u16be(b, i + 7), u16be(b, i + 5));
			}
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				i += 2;
				continue;
			}
			i += 2 + u16be(b, i + 2);
		}
	}
	return undefined;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without depending on Node's Buffer or the browser's btoa (the core runs in both). */
export function base64(bytes: Uint8Array): string {
	const parts: string[] = [];
	const CHUNK = 3 * 4096;
	for (let start = 0; start < bytes.length; start += CHUNK) {
		const end = Math.min(bytes.length, start + CHUNK);
		let out = '';
		for (let i = start; i < end; i += 3) {
			const a = bytes[i], b = i + 1 < end ? bytes[i + 1] : 0, c = i + 2 < end ? bytes[i + 2] : 0;
			const n = (a << 16) | (b << 8) | c;
			out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
				+ (i + 1 < end ? ALPHABET[(n >> 6) & 63] : '=') + (i + 2 < end ? ALPHABET[n & 63] : '=');
		}
		parts.push(out);
	}
	return parts.join('');
}
