// Reads the table of contents of a zip file (including ZIP64, which OneDrive uses for large
// downloads) through random access, so a section stored in it can be read in place.
// Read only; no decompression here.

/** A file opened for reading at any position. */
export interface RandomAccessFile {
	readonly size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
	/** Path inside the zip, `/`-separated, as stored (UTF-8 names are decoded as UTF-8). */
	name: string;
	/** 0: stored (not compressed); 8: deflated. */
	method: number;
	compressedSize: number;
	size: number;
	crc32: number;
	/** Where the entry's local header starts. */
	headerOffset: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, i: number) => u32(b, i) + u32(b, i + 4) * 2 ** 32;

/** The DOS code page names in zips without the UTF-8 flag use; only its ASCII half is common in practice. */
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function decodeName(bytes: Uint8Array, utf8: boolean): string {
	if (utf8) return new TextDecoder('utf-8').decode(bytes);
	return Array.from(bytes, b => (b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80])).join('');
}

export class ZipFormatError extends Error {}

/** The entries listed in the zip's central directory. Throws ZipFormatError when there is none (a cut-off download). */
export async function readZipDirectory(file: RandomAccessFile): Promise<ZipEntry[]> {
	// The end record sits in the last 22 bytes, plus a comment of up to 65535 bytes.
	const tailLength = Math.min(file.size, 22 + 65535);
	const tail = await file.read(file.size - tailLength, tailLength);
	let end = -1;
	for (let i = tail.length - 22; i >= 0; i--) {
		if (u32(tail, i) === EOCD) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new ZipFormatError('no end of central directory record');
	let count = u16(tail, end + 10);
	let directorySize = u32(tail, end + 12);
	let directoryOffset = u32(tail, end + 16);
	const endOffset = file.size - tailLength + end;
	if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
		const locator = await file.read(endOffset - 20, 20);
		if (u32(locator, 0) !== ZIP64_LOCATOR) throw new ZipFormatError('ZIP64 end record locator missing');
		const record = await file.read(u64(locator, 8), 56);
		if (u32(record, 0) !== ZIP64_EOCD) throw new ZipFormatError('ZIP64 end record missing');
		count = u64(record, 32);
		directorySize = u64(record, 40);
		directoryOffset = u64(record, 48);
	}
	if (directoryOffset + directorySize > file.size) throw new ZipFormatError('central directory outside the file');
	const directory = await file.read(directoryOffset, directorySize);
	const entries: ZipEntry[] = [];
	let at = 0;
	for (let n = 0; n < count; n++) {
		if (at + 46 > directory.length || u32(directory, at) !== CENTRAL) throw new ZipFormatError(`central directory entry ${n} is damaged`);
		const flags = u16(directory, at + 8);
		const method = u16(directory, at + 10);
		const crc32 = u32(directory, at + 16);
		let compressedSize = u32(directory, at + 20);
		let size = u32(directory, at + 24);
		const nameLength = u16(directory, at + 28);
		const extraLength = u16(directory, at + 30);
		const commentLength = u16(directory, at + 32);
		let headerOffset = u32(directory, at + 42);
		const name = decodeName(directory.subarray(at + 46, at + 46 + nameLength), (flags & 0x800) !== 0);
		// ZIP64 sizes and offset, in this order, for the fields that overflowed.
		const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
		for (let e = 0; e + 4 <= extra.length;) {
			const id = u16(extra, e), length = u16(extra, e + 2);
			if (id === 0x0001) {
				let p = e + 4;
				if (size === 0xffffffff) { size = u64(extra, p); p += 8; }
				if (compressedSize === 0xffffffff) { compressedSize = u64(extra, p); p += 8; }
				if (headerOffset === 0xffffffff) { headerOffset = u64(extra, p); p += 8; }
			}
			e += 4 + length;
		}
		entries.push({ name, method, compressedSize, size, crc32, headerOffset });
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** Where an entry's data starts (after its local header, whose name and extra field may differ from the directory's). */
export async function entryDataOffset(file: RandomAccessFile, entry: ZipEntry): Promise<number> {
	const header = await file.read(entry.headerOffset, 30);
	if (header.length < 30 || u32(header, 0) !== LOCAL) throw new ZipFormatError(`local header of ${entry.name} is damaged`);
	return entry.headerOffset + 30 + u16(header, 26) + u16(header, 28);
}
