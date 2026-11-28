// Reads a notebook packaged by OneNote for Windows (`.onepkg`, a Microsoft Cabinet archive, its
// data usually LZX compressed) and unpacks it as it reads (§11.5 item 73): one data block of at
// most 32 KB at a time, through the LZX window (at most 2 MB), each block handed on to the entries
// it holds. A section in a package can be over a gigabyte; it never has to fit in memory.
//
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/cabinet at commit fa9444a, which
// ported it from OfficeIMO (MIT); there the whole archive and each whole folder were read into
// memory. See THIRD_PARTY_LICENSES.md.

import type { RandomAccessFile } from './zip.ts';

export class CabFormatError extends Error {}

const COMPRESSION_NONE = 0x0000;
const COMPRESSION_MSZIP = 0x0001;
const COMPRESSION_LZX = 0x0003;
const COMPRESSION_MASK = 0x000f;
const FLAG_PREVIOUS_CABINET = 0x0001;
const FLAG_NEXT_CABINET = 0x0002;
const FLAG_RESERVE_PRESENT = 0x0004;
const UTF_NAME_ATTRIBUTE = 0x0080;
const MAX_ENTRIES = 65536;

/** A file in the archive: its path inside it (`/` between folders), size, and where it lies in its folder's data. */
export interface CabEntry {
	path: string;
	size: number;
	folder: number;
	offset: number;
}

interface Folder {
	dataOffset: number;
	blockCount: number;
	compression: number;
}

interface Layout {
	folders: Folder[];
	entries: CabEntry[];
	dataReserve: number;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Whether these bytes start a Cabinet archive (`MSCF`). */
export const isCabinet = (head: Uint8Array) => head.length >= 4 && head[0] === 0x4d && head[1] === 0x53 && head[2] === 0x43 && head[3] === 0x46;

async function readAt(file: RandomAccessFile, offset: number, length: number, what: string): Promise<Uint8Array> {
	if (offset < 0 || length < 0 || offset + length > file.size) throw new CabFormatError(`The package ends inside ${what}.`);
	const bytes = await file.read(offset, length);
	if (bytes.length < length) throw new CabFormatError(`The package ends inside ${what}.`);
	return bytes;
}

/**
 * A name in the package. OneNote writes names in UTF-8 without the flag that says so, so a name
 * without it is read as UTF-8 too when it is valid UTF-8, and byte by byte only when it is not.
 */
function cString(data: Uint8Array, offset: number, utf8: boolean): { value: string, next: number } {
	let end = offset;
	while (end < data.length && data[end] !== 0) end++;
	if (end >= data.length) throw new CabFormatError('A name in the package is not terminated.');
	const bytes = data.subarray(offset, end);
	if (utf8) return { value: new TextDecoder().decode(bytes), next: end + 1 };
	try {
		return { value: new TextDecoder('utf-8', { fatal: true }).decode(bytes), next: end + 1 };
	} catch {
		return { value: String.fromCharCode(...bytes), next: end + 1 };
	}
}

/** The archive's folders and files, read from its header (everything before the first data block). */
async function layout(file: RandomAccessFile): Promise<Layout> {
	const fixed = await readAt(file, 0, 36, 'its header');
	if (!isCabinet(fixed)) throw new CabFormatError('This is not a Cabinet archive.');
	const declaredSize = u32(fixed, 8);
	const filesOffset = u32(fixed, 16);
	const folderCount = u16(fixed, 26);
	const fileCount = u16(fixed, 28);
	const flags = u16(fixed, 30);
	if (declaredSize > file.size || folderCount < 1 || fileCount > MAX_ENTRIES || filesOffset >= file.size) {
		throw new CabFormatError('The package header holds sizes or counts that cannot be.');
	}
	// The header, the folder table and the file table all lie before the first data block.
	let headerEnd = Math.min(file.size, Math.max(filesOffset + 64 * 1024, 64 * 1024));
	let head = await readAt(file, 0, headerEnd, 'its header');
	let offset = 36, folderReserve = 0, dataReserve = 0;
	if ((flags & FLAG_RESERVE_PRESENT) !== 0) {
		const headerReserve = u16(head, offset);
		folderReserve = head[offset + 2]!;
		dataReserve = head[offset + 3]!;
		offset += 4 + headerReserve;
	}
	for (const flag of [FLAG_PREVIOUS_CABINET, FLAG_NEXT_CABINET]) {
		if ((flags & flag) === 0) continue;
		offset = cString(head, offset, false).next;
		offset = cString(head, offset, false).next;
	}
	const folders: Folder[] = [];
	for (let i = 0; i < folderCount; i++) {
		if (offset + 8 > head.length) throw new CabFormatError('The package ends inside its folder table.');
		folders.push({ dataOffset: u32(head, offset), blockCount: u16(head, offset + 4), compression: u16(head, offset + 6) });
		offset += 8 + folderReserve;
	}
	// The file table may be longer than what was read: read up to the first data block.
	const firstData = Math.min(...folders.map(folder => folder.dataOffset));
	if (firstData > headerEnd && firstData <= file.size) {
		headerEnd = firstData;
		head = await readAt(file, 0, headerEnd, 'its file table');
	}
	const entries: CabEntry[] = [];
	offset = filesOffset;
	for (let i = 0; i < fileCount; i++) {
		if (offset + 16 > head.length) throw new CabFormatError('The package ends inside its file table.');
		const size = u32(head, offset), folderOffset = u32(head, offset + 4), folder = u16(head, offset + 8), attributes = u16(head, offset + 14);
		const { value, next } = cString(head, offset + 16, (attributes & UTF_NAME_ATTRIBUTE) !== 0);
		if (folder >= folders.length) throw new CabFormatError('A file in the package lies in a folder it does not have (or in another archive).');
		entries.push({ path: value.replace(/\\/g, '/'), size, folder, offset: folderOffset });
		offset = next;
	}
	return { folders, entries, dataReserve };
}

/** The files in an archive (names and sizes only; nothing is unpacked). */
export async function readCabIndex(file: RandomAccessFile): Promise<CabEntry[]> {
	return (await layout(file)).entries;
}

function checksum(data: Uint8Array, seed: number): number {
	let sum = seed >>> 0;
	let i = 0;
	for (; i + 4 <= data.length; i += 4) sum ^= u32(data, i);
	let rest = 0;
	for (; i < data.length; i++) rest = (rest << 8) | data[i];
	return (sum ^ rest) >>> 0;
}

/**
 * Unpacks the archive's files, in the order their data lies, handing each piece of a file's data
 * on as it comes (`write` is called with consecutive pieces of one file; a file of no size gets one
 * empty piece). `wanted` picks the files (all by default); folders holding none are skipped.
 */
export async function extractCab(file: RandomAccessFile, write: (entry: CabEntry, piece: Uint8Array) => Promise<void>, wanted: (entry: CabEntry) => boolean = () => true): Promise<void> {
	const { folders, entries, dataReserve } = await layout(file);
	for (const [index, folder] of folders.entries()) {
		const mine = entries.filter(entry => entry.folder === index && wanted(entry)).sort((a, b) => a.offset - b.offset);
		if (!mine.length) continue;
		for (const entry of mine) if (entry.size === 0) await write(entry, new Uint8Array(0));
		const needed = Math.max(...mine.map(entry => entry.offset + entry.size));
		const kind = folder.compression & COMPRESSION_MASK;
		if (kind === COMPRESSION_MSZIP) throw new CabFormatError('This package uses MSZIP compression, which is not read here.');
		if (kind !== COMPRESSION_NONE && kind !== COMPRESSION_LZX) throw new CabFormatError('This package uses a compression this reader does not know.');
		const lzx = kind === COMPRESSION_LZX ? new LzxDecoder((folder.compression >> 8) & 0x1f) : undefined;
		let at = folder.dataOffset, position = 0;
		for (let block = 0; block < folder.blockCount && position < needed; block++) {
			const header = await readAt(file, at, 8 + dataReserve, 'a data block');
			const declared = u32(header, 0), packed = u16(header, 4), expanded = u16(header, 6);
			const payload = await readAt(file, at + 8 + dataReserve, packed, 'a data block');
			if (declared !== 0) {
				// The checksum covers the payload, then the sizes and the reserve.
				const sum = checksum(header.subarray(4), checksum(payload, 0));
				if (sum !== declared) throw new CabFormatError('A data block of the package is damaged (its checksum does not match).');
			}
			let data: Uint8Array;
			if (lzx) data = lzx.frame(payload, expanded);
			else {
				if (packed !== expanded) throw new CabFormatError('An uncompressed data block of the package has inconsistent sizes.');
				data = payload;
			}
			// Hand the block on to the files it holds.
			const end = position + data.length;
			for (const entry of mine) {
				const from = Math.max(entry.offset, position), to = Math.min(entry.offset + entry.size, end);
				if (from < to) await write(entry, data.subarray(from - position, to - position));
			}
			position = end;
			at += 8 + dataReserve + packed;
		}
		if (position < needed) throw new CabFormatError('The package ends before the data of its files.');
	}
}

// LZX ([MS-PATCH] LZX DELTA, as Cabinet archives use it): Huffman-coded literals and matches into a
// sliding window, in frames of 32 KB (one data block each), with x86 call translation undone per frame.

const LITERAL_SYMBOLS = 256;
const PRIMARY_LENGTH_SYMBOLS = 8;
const LENGTH_TREE_SYMBOLS = 249;
const ALIGNED_TREE_SYMBOLS = 8;
const PRETREE_SYMBOLS = 20;
const MAXIMUM_PATH_LENGTH = 16;
const VERBATIM_BLOCK = 1;
const ALIGNED_OFFSET_BLOCK = 2;
const UNCOMPRESSED_BLOCK = 3;
const MAXIMUM_TRANSLATED_FRAMES = 32768;

const corrupt = (message: string) => new CabFormatError(`The package's compressed data is damaged: ${message}`);

class BitReader {
	private next = 0;
	private word = 0;
	private bits = 0;
	private readonly data: Uint8Array;

	constructor(data: Uint8Array) {
		this.data = data;
	}

	get remainingBytes(): number {
		this.aligned();
		return this.data.length - this.next;
	}

	readBits(count: number): number {
		let value = 0, remaining = count;
		while (remaining > 0) {
			if (this.bits === 0) this.load();
			const take = Math.min(remaining, this.bits);
			value = ((value << take) | ((this.word >> (this.bits - take)) & ((1 << take) - 1))) >>> 0;
			this.bits -= take;
			remaining -= take;
		}
		return value;
	}

	readBit(): number {
		if (this.bits === 0) this.load();
		this.bits--;
		return (this.word >> this.bits) & 1;
	}

	/** Uncompressed blocks start on a 16-bit boundary, after 1 to 16 bits of padding even when already aligned. */
	alignToWord(): void {
		if (this.bits === 0) this.load();
		this.bits = 0;
	}

	readRawByte(): number {
		this.aligned();
		this.ensure(1);
		return this.data[this.next++];
	}

	readRawUInt32(): number {
		this.aligned();
		this.ensure(4);
		const value = u32(this.data, this.next);
		this.next += 4;
		return value;
	}

	rawBytes(count: number): Uint8Array {
		this.aligned();
		this.ensure(count);
		const bytes = this.data.subarray(this.next, this.next + count);
		this.next += count;
		return bytes;
	}

	private load(): void {
		if (this.next > this.data.length - 2) throw corrupt('the bit stream ends inside a word.');
		this.word = this.data[this.next] | (this.data[this.next + 1] << 8);
		this.next += 2;
		this.bits = 16;
	}

	private aligned(): void {
		if (this.bits !== 0) throw corrupt('byte data does not start on a word boundary.');
	}

	private ensure(count: number): void {
		if (this.next > this.data.length - count) throw corrupt('the byte data ends early.');
	}
}

class HuffmanTree {
	private readonly counts: Int32Array;
	private readonly firstCodes: Int32Array;
	private readonly firstSymbols: Int32Array;
	private readonly symbols: Int32Array;

	private constructor(counts: Int32Array, firstCodes: Int32Array, firstSymbols: Int32Array, symbols: Int32Array) {
		this.counts = counts;
		this.firstCodes = firstCodes;
		this.firstSymbols = firstSymbols;
		this.symbols = symbols;
	}

	static readonly empty = new HuffmanTree(new Int32Array(MAXIMUM_PATH_LENGTH + 1), new Int32Array(MAXIMUM_PATH_LENGTH + 1), new Int32Array(MAXIMUM_PATH_LENGTH + 1), new Int32Array(0));

	static create(lengths: Uint8Array, allowEmpty: boolean, name: string): HuffmanTree {
		const counts = new Int32Array(MAXIMUM_PATH_LENGTH + 1);
		for (const length of lengths) {
			if (length > MAXIMUM_PATH_LENGTH) throw corrupt(`the ${name} tree has an invalid code length.`);
			if (length !== 0) counts[length]++;
		}
		let total = 0;
		for (const count of counts) total += count;
		if (total === 0) {
			if (allowEmpty) return HuffmanTree.empty;
			throw corrupt(`the ${name} tree is empty.`);
		}
		if (total === 1) throw corrupt(`the ${name} tree has a single symbol.`);
		const firstCodes = new Int32Array(MAXIMUM_PATH_LENGTH + 1);
		const firstSymbols = new Int32Array(MAXIMUM_PATH_LENGTH + 1);
		let code = 0, symbol = 0;
		for (let length = 1; length <= MAXIMUM_PATH_LENGTH; length++) {
			code = (code + counts[length - 1]) << 1;
			firstCodes[length] = code;
			firstSymbols[length] = symbol;
			if (code + counts[length] > 1 << length) throw corrupt(`the ${name} tree is oversubscribed.`);
			symbol += counts[length];
		}
		const symbols = new Int32Array(total);
		const next = firstSymbols.slice();
		for (let s = 0; s < lengths.length; s++) {
			const length = lengths[s];
			if (length !== 0) symbols[next[length]++] = s;
		}
		return new HuffmanTree(counts, firstCodes, firstSymbols, symbols);
	}

	decode(reader: BitReader): number {
		if (this.symbols.length === 0) throw corrupt('an empty tree is used.');
		let code = 0;
		for (let length = 1; length <= MAXIMUM_PATH_LENGTH; length++) {
			code = (code << 1) | reader.readBit();
			const offset = code - this.firstCodes[length];
			if (offset >= 0 && offset < this.counts[length]) return this.symbols[this.firstSymbols[length] + offset];
		}
		throw corrupt('a code is not in its tree.');
	}
}

/** Decodes one folder's LZX stream, a frame (one data block) at a time, into a window of its own size. */
class LzxDecoder {
	private readonly windowSize: number;
	private readonly mask: number;
	private readonly window: Uint8Array;
	private readonly positionBase: Int32Array;
	private readonly footerBits: Int32Array;
	private readonly mainLengths: Uint8Array;
	private readonly lengthLengths = new Uint8Array(LENGTH_TREE_SYMBOLS);
	private mainTree = HuffmanTree.empty;
	private lengthTree = HuffmanTree.empty;
	private alignedTree = HuffmanTree.empty;
	private r0 = 1;
	private r1 = 1;
	private r2 = 1;
	/** Bytes decoded so far in this folder. */
	private position = 0;
	private frames = 0;
	private blockType = 0;
	private blockRemaining = 0;
	private headerRead = false;
	private translationSize = 0;
	private needsPadding = false;
	private paddingPending = false;

	constructor(windowBits: number) {
		if (windowBits < 15 || windowBits > 21) throw new CabFormatError('The package uses an LZX window size this reader does not know.');
		this.windowSize = 1 << windowBits;
		this.mask = this.windowSize - 1;
		this.window = new Uint8Array(this.windowSize);
		const bases: number[] = [], bits: number[] = [];
		for (let slot = 0, base = 0; base < this.windowSize; slot++) {
			const footer = slot < 4 ? 0 : slot < 36 ? (slot >> 1) - 1 : 17;
			bases.push(base);
			bits.push(footer);
			base += 1 << footer;
		}
		this.positionBase = Int32Array.from(bases);
		this.footerBits = Int32Array.from(bits);
		this.mainLengths = new Uint8Array(LITERAL_SYMBOLS + PRIMARY_LENGTH_SYMBOLS * this.positionBase.length);
	}

	/** Decodes the next data block (`expanded` bytes, at most 32 KB) and answers its bytes. */
	frame(chunk: Uint8Array, expanded: number): Uint8Array {
		const start = this.position, end = start + expanded;
		const reader = new BitReader(chunk);
		if (this.paddingPending) {
			if (reader.remainingBytes < 1) throw corrupt('the padding byte of an uncompressed block is missing.');
			reader.readRawByte();
			this.paddingPending = false;
		}
		while (this.position < end) {
			if (this.blockRemaining === 0) this.blockHeader(reader);
			if (this.blockType === UNCOMPRESSED_BLOCK) this.uncompressed(reader, end);
			else this.compressed(reader, end);
			if (this.blockRemaining === 0 && this.blockType === UNCOMPRESSED_BLOCK && this.needsPadding) {
				this.needsPadding = false;
				if (reader.remainingBytes > 0) reader.readRawByte();
				else this.paddingPending = true;
			}
		}
		if (this.position !== end) throw corrupt('a match crosses the end of a data block.');
		// The block's bytes, out of the window; the window keeps them untranslated for later matches.
		const out = new Uint8Array(expanded);
		for (let i = 0; i < expanded; i++) out[i] = this.window[(start + i) & this.mask]!;
		if (this.translationSize > 0 && this.frames < MAXIMUM_TRANSLATED_FRAMES) undoE8(out, start, this.translationSize);
		this.frames++;
		return out;
	}

	private put(byte: number): void {
		this.window[this.position & this.mask] = byte;
		this.position++;
	}

	private blockHeader(reader: BitReader): void {
		if (!this.headerRead) {
			this.headerRead = true;
			if (reader.readBits(1) !== 0) {
				const high = reader.readBits(16), low = reader.readBits(16);
				this.translationSize = ((high << 16) | low) >>> 0;
				if (this.translationSize > 0x7fffffff) throw corrupt('the call translation size is out of range.');
			}
		}
		this.blockType = reader.readBits(3);
		this.blockRemaining = (reader.readBits(16) << 8) | reader.readBits(8);
		if (this.blockRemaining === 0 || (this.blockType !== VERBATIM_BLOCK && this.blockType !== ALIGNED_OFFSET_BLOCK && this.blockType !== UNCOMPRESSED_BLOCK)) {
			throw corrupt('a block header has an invalid type or size.');
		}
		if (this.blockType === UNCOMPRESSED_BLOCK) {
			this.needsPadding = (this.blockRemaining & 1) !== 0;
			reader.alignToWord();
			this.r0 = reader.readRawUInt32();
			this.r1 = reader.readRawUInt32();
			this.r2 = reader.readRawUInt32();
			for (const offset of [this.r0, this.r1, this.r2]) this.checkOffset(offset);
			return;
		}
		if (this.blockType === ALIGNED_OFFSET_BLOCK) {
			const aligned = new Uint8Array(ALIGNED_TREE_SYMBOLS);
			for (let i = 0; i < aligned.length; i++) aligned[i] = reader.readBits(3);
			this.alignedTree = HuffmanTree.create(aligned, false, 'aligned offset');
		}
		pathLengths(reader, this.mainLengths, 0, LITERAL_SYMBOLS);
		pathLengths(reader, this.mainLengths, LITERAL_SYMBOLS, this.mainLengths.length);
		this.mainTree = HuffmanTree.create(this.mainLengths, false, 'main');
		pathLengths(reader, this.lengthLengths, 0, this.lengthLengths.length);
		this.lengthTree = HuffmanTree.create(this.lengthLengths, true, 'length');
	}

	private uncompressed(reader: BitReader, end: number): void {
		const count = Math.min(this.blockRemaining, end - this.position);
		const bytes = reader.rawBytes(count);
		for (let i = 0; i < count; i++) this.put(bytes[i]);
		this.blockRemaining -= count;
	}

	private compressed(reader: BitReader, end: number): void {
		while (this.blockRemaining > 0 && this.position < end) {
			const symbol = this.mainTree.decode(reader);
			if (symbol < LITERAL_SYMBOLS) {
				this.put(symbol);
				this.blockRemaining--;
				continue;
			}
			const header = symbol - LITERAL_SYMBOLS;
			const slot = header >> 3, lengthHeader = header & 7;
			if (slot >= this.positionBase.length) throw corrupt('a match has an invalid position slot.');
			let length = lengthHeader + 2;
			if (lengthHeader === 7) length += this.lengthTree.decode(reader);
			const offset = this.matchOffset(reader, slot);
			if (length > this.blockRemaining || length > end - this.position) throw corrupt('a match crosses a block or data block boundary.');
			if (offset === 0 || offset > this.windowSize || offset > this.position) throw corrupt('a match reaches outside the window.');
			// Byte by byte: a match may overlap what it writes.
			for (let i = 0; i < length; i++) this.put(this.window[(this.position - offset) & this.mask]);
			this.blockRemaining -= length;
		}
	}

	private matchOffset(reader: BitReader, slot: number): number {
		if (slot === 0) return this.r0;
		if (slot === 1) {
			const offset = this.r1;
			this.r1 = this.r0;
			this.r0 = offset;
			return offset;
		}
		if (slot === 2) {
			const offset = this.r2;
			this.r2 = this.r0;
			this.r0 = offset;
			return offset;
		}
		const bits = this.footerBits[slot];
		let footer: number;
		if (this.blockType === ALIGNED_OFFSET_BLOCK && bits >= 3) footer = (bits === 3 ? 0 : reader.readBits(bits - 3) << 3) | this.alignedTree.decode(reader);
		else footer = reader.readBits(bits);
		const formatted = this.positionBase[slot] + footer;
		if (formatted < 3) throw corrupt('a match has an invalid offset.');
		const offset = formatted - 2;
		this.checkOffset(offset);
		this.r2 = this.r1;
		this.r1 = this.r0;
		this.r0 = offset;
		return offset;
	}

	private checkOffset(offset: number): void {
		if (offset === 0 || offset > this.windowSize) throw corrupt('a repeated offset is outside the window.');
	}
}

function pathLengths(reader: BitReader, lengths: Uint8Array, start: number, end: number): void {
	const pre = new Uint8Array(PRETREE_SYMBOLS);
	for (let i = 0; i < pre.length; i++) pre[i] = reader.readBits(4);
	const pretree = HuffmanTree.create(pre, false, 'pretree');
	let cursor = start;
	while (cursor < end) {
		const code = pretree.decode(reader);
		if (code <= MAXIMUM_PATH_LENGTH) {
			lengths[cursor] = (lengths[cursor] - code + 17) % 17;
			cursor++;
			continue;
		}
		let repeat: number, value: number;
		if (code === 17) {
			repeat = reader.readBits(4) + 4;
			value = 0;
		}
		else if (code === 18) {
			repeat = reader.readBits(5) + 20;
			value = 0;
		}
		else if (code === 19) {
			repeat = reader.readBits(1) + 4;
			const delta = pretree.decode(reader);
			if (delta > MAXIMUM_PATH_LENGTH) throw corrupt('a repeated code length has an invalid delta.');
			value = (lengths[cursor] - delta + 17) % 17;
		}
		else throw corrupt('the pretree has an invalid symbol.');
		if (repeat > end - cursor) throw corrupt('repeated code lengths run past their tree.');
		for (let i = 0; i < repeat; i++) lengths[cursor++] = value;
	}
}

/** Undoes LZX's x86 call translation in one frame, which starts `frameStart` bytes into the folder. */
function undoE8(frame: Uint8Array, frameStart: number, fileSize: number): void {
	if (frameStart >= 0x40000000 || frame.length <= 10) return;
	const scanEnd = frame.length - 10;
	for (let i = 0; i < scanEnd; i++) {
		if (frame[i] !== 0xe8) continue;
		const cursor = frameStart + i;
		const value = frame[i + 1] | (frame[i + 2] << 8) | (frame[i + 3] << 16) | (frame[i + 4] << 24);
		if (value >= -cursor && value < fileSize) {
			const displacement = value >= 0 ? value - cursor : value + fileSize;
			frame[i + 1] = displacement;
			frame[i + 2] = displacement >> 8;
			frame[i + 3] = displacement >> 16;
			frame[i + 4] = displacement >> 24;
		}
		i += 4;
	}
}
