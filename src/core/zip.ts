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

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * An entry's name. With the UTF-8 flag it is UTF-8. Without it, the format says the DOS code page,
 * but macOS (Finder's Compress, `zip`) and others write UTF-8 there too: bytes that are valid
 * UTF-8 are read as UTF-8 (DOS code page names are almost never valid UTF-8 beyond ASCII). An
 * Info-ZIP Unicode path field (0x7075) that matches the name's checksum wins over both.
 */
function decodeName(bytes: Uint8Array, utf8: boolean, extra?: Uint8Array): string {
	if (extra) {
		for (let e = 0; e + 4 <= extra.length;) {
			const id = u16(extra, e), length = u16(extra, e + 2);
			if (id === 0x7075 && length >= 5 && extra[e + 4] === 1 && u32(extra, e + 5) === crc32(bytes)) {
				try {
					return STRICT_UTF8.decode(extra.subarray(e + 9, e + 4 + length));
				}
				catch {
					// fall through to the name itself
				}
			}
			e += 4 + length;
		}
	}
	if (utf8) return new TextDecoder('utf-8').decode(bytes);
	try {
		return STRICT_UTF8.decode(bytes);
	}
	catch {
		return Array.from(bytes, b => (b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80])).join('');
	}
}

let CRC_TABLE: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
	if (!CRC_TABLE) {
		CRC_TABLE = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			CRC_TABLE[n] = c >>> 0;
		}
	}
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
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
		// ZIP64 sizes and offset, in this order, for the fields that overflowed.
		const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
		const name = decodeName(directory.subarray(at + 46, at + 46 + nameLength), (flags & 0x800) !== 0, extra);
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

const DESCRIPTOR = 0x08074b50;
const SCAN_CHUNK = 8 * 1024 * 1024;

export interface ScannedZip {
	/** Entries whose data is all there. */
	entries: ZipEntry[];
	/** The entry the file ends inside, when it ends inside one (a cut-off download). */
	cutOff?: string;
	/** Where the walk lost its way (no next entry where one should start), when it did. */
	lostAt?: number;
}

/** Whether a zip record starts at `at`, or the file ends there. */
async function recordStartsAt(file: RandomAccessFile, at: number): Promise<boolean> {
	if (at === file.size) return true;
	if (at + 4 > file.size) return false;
	const signature = u32(await file.read(at, 4), 0);
	return signature === LOCAL || signature === CENTRAL || signature === ZIP64_EOCD || signature === EOCD;
}

/**
 * For a zip without a central directory (a download that stopped part way): walks the entries
 * from the start of the file, one local header after another, and keeps those whose data is
 * complete. OneDrive writes zips as a stream: each entry's data is followed by a data descriptor,
 * and for some entries the sizes are only there. Where an entry ends is checked by finding the
 * next record right after its descriptor, whatever the descriptor's form (with or without its
 * signature, 32- or 64-bit sizes), so a wrong guess never silently drops the rest.
 */
export async function scanZipEntries(file: RandomAccessFile): Promise<ScannedZip> {
	const entries: ZipEntry[] = [];
	let at = 0;
	while (at + 30 <= file.size) {
		const header = await file.read(at, 30);
		if (u32(header, 0) !== LOCAL) {
			if (await recordStartsAt(file, at)) return { entries };
			return { entries, lostAt: at };
		}
		const flags = u16(header, 6);
		const method = u16(header, 8);
		let crc32 = u32(header, 14);
		let compressedSize = u32(header, 18);
		let size = u32(header, 22);
		const nameLength = u16(header, 26);
		const extraLength = u16(header, 28);
		const variable = await file.read(at + 30, nameLength + extraLength);
		const extra = variable.subarray(nameLength);
		const name = decodeName(variable.subarray(0, nameLength), (flags & 0x800) !== 0, extra.length === extraLength ? extra : undefined);
		if (variable.length < nameLength + extraLength) return { entries, cutOff: name || undefined };
		for (let e = 0; e + 4 <= extra.length;) {
			const id = u16(extra, e), length = u16(extra, e + 2);
			// In a local header the ZIP64 field holds both sizes (zero when a descriptor follows).
			if (id === 0x0001 && length >= 16) {
				if (size === 0xffffffff) size = u64(extra, e + 4);
				if (compressedSize === 0xffffffff) compressedSize = u64(extra, e + 12);
			}
			e += 4 + length;
		}
		const dataStart = at + 30 + nameLength + extraLength;
		const descriptor = (flags & 0x08) !== 0;
		const sizesKnown = !descriptor || (compressedSize !== 0 && compressedSize !== 0xffffffff);
		if (sizesKnown) {
			const end = dataStart + compressedSize;
			if (end > file.size) return { entries, cutOff: name };
			if (!descriptor) {
				entries.push({ name, method, compressedSize, size, crc32, headerOffset: at });
				at = end;
				continue;
			}
			// The descriptor's form, from where the next record starts.
			const signed = end + 4 <= file.size && u32(await file.read(end, 4), 0) === DESCRIPTOR;
			const lengths = signed ? [16, 24] : [12, 20];
			let next: number | undefined;
			for (const length of lengths) {
				if (await recordStartsAt(file, end + length)) {
					next = end + length;
					break;
				}
			}
			if (next === undefined) {
				// The data is whole, but what follows is not where a record should be.
				entries.push({ name, method, compressedSize, size, crc32, headerOffset: at });
				return end + Math.min(...lengths) > file.size ? { entries } : { entries, lostAt: end };
			}
			const fields = await file.read(end + (signed ? 4 : 0), 4);
			if (fields.length === 4) crc32 = u32(fields, 0);
			entries.push({ name, method, compressedSize, size, crc32, headerOffset: at });
			at = next;
			continue;
		}
		// Sizes only in the descriptor: look for the one whose size equals the distance from the data's start.
		const found = await findDescriptor(file, dataStart);
		if (!found) return { entries, cutOff: name };
		entries.push({ name, method, compressedSize: found.compressedSize, size: found.size, crc32: found.crc32, headerOffset: at });
		at = found.next;
	}
	// The file ends here, or inside the next entry's header (whose name is not there to report).
	return { entries };
}

async function findDescriptor(file: RandomAccessFile, dataStart: number): Promise<{ next: number, crc32: number, compressedSize: number, size: number } | undefined> {
	const LONGEST = 24;
	for (let chunkStart = dataStart; chunkStart < file.size; chunkStart += SCAN_CHUNK) {
		// Overlap chunks by a descriptor's length so one split across two chunks is still seen.
		const chunk = await file.read(chunkStart, Math.min(SCAN_CHUNK + LONGEST, file.size - chunkStart));
		for (let i = 0; i + 16 <= chunk.length && i < SCAN_CHUNK; i++) {
			if (chunk[i] !== 0x50 || chunk[i + 1] !== 0x4b || chunk[i + 2] !== 0x07 || chunk[i + 3] !== 0x08) continue;
			const end = chunkStart + i;
			const distance = end - dataStart;
			// 32-bit sizes (16 bytes in all) or ZIP64 sizes (24 bytes), confirmed by the record that follows.
			if (u32(chunk, i + 8) === distance && await recordStartsAt(file, end + 16)) {
				return { next: end + 16, crc32: u32(chunk, i + 4), compressedSize: distance, size: u32(chunk, i + 12) };
			}
			if (i + 24 <= chunk.length && u64(chunk, i + 8) === distance && await recordStartsAt(file, end + 24)) {
				return { next: end + 24, crc32: u32(chunk, i + 4), compressedSize: distance, size: u64(chunk, i + 16) };
			}
		}
	}
	return undefined;
}
