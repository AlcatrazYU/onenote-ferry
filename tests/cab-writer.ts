// Builds Cabinet archives for tests (no tool on the development machine writes one): data stored
// as is, or as an LZX stream of uncompressed blocks, which takes the decoder through its window and
// across data blocks. Contents are invented.

/** A Cabinet checksum ([MS-CAB] 2.6), over the data and then the sizes, as the reader checks it. */
function checksum(data: Uint8Array, seed: number): number {
	let sum = seed >>> 0, i = 0;
	for (; i + 4 <= data.length; i += 4) sum ^= (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) >>> 0;
	let rest = 0;
	for (; i < data.length; i++) rest = (rest << 8) | data[i]!;
	return (sum ^ rest) >>> 0;
}

/** Bits written as LZX reads them: most significant first, in 16-bit little-endian words. */
class BitWriter {
	private readonly bytes: number[] = [];
	private word = 0;
	private bits = 0;

	write(value: number, count: number): void {
		for (let i = count - 1; i >= 0; i--) {
			this.word = (this.word << 1) | ((value >>> i) & 1);
			if (++this.bits === 16) this.flush();
		}
	}

	/** To the next word boundary (1 to 16 bits of padding, as uncompressed blocks require). */
	pad(): void {
		do this.write(0, 1); while (this.bits !== 0);
	}

	raw(data: ArrayLike<number>): void {
		for (let i = 0; i < data.length; i++) this.bytes.push(data[i]!);
	}

	private flush(): void {
		this.bytes.push(this.word & 0xff, (this.word >> 8) & 0xff);
		this.word = 0;
		this.bits = 0;
	}

	take(): Uint8Array {
		return Uint8Array.from(this.bytes.splice(0));
	}
}

/** An LZX stream holding `data` as one uncompressed block, cut into data blocks of 32 KB. */
function lzxBlocks(data: Uint8Array): { packed: Uint8Array, expanded: number }[] {
	const frames: { packed: Uint8Array, expanded: number }[] = [];
	const writer = new BitWriter();
	writer.write(0, 1); // no call translation
	writer.write(3, 3); // uncompressed block
	writer.write(data.length >>> 8, 16);
	writer.write(data.length & 0xff, 8);
	writer.pad();
	writer.raw([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); // repeated offsets
	for (let at = 0; at < data.length; at += 32768) {
		const piece = data.subarray(at, at + 32768);
		writer.raw(piece);
		if (at + 32768 >= data.length && data.length % 2 === 1) writer.raw([0]); // padding after an odd block
		frames.push({ packed: writer.take(), expanded: piece.length });
	}
	return frames;
}

export interface CabFile {
	path: string;
	data: Uint8Array;
}

/** A Cabinet archive of one folder holding the files in order; `lzx` compresses it (window 2^16). */
export function makeCab(files: CabFile[], options: { lzx?: boolean, damage?: boolean } = {}): Uint8Array {
	const all = new Uint8Array(files.reduce((n, file) => n + file.data.length, 0));
	let at = 0;
	for (const file of files) {
		all.set(file.data, at);
		at += file.data.length;
	}
	const frames = options.lzx ? lzxBlocks(all) : Array.from({ length: Math.ceil(all.length / 32768) }, (_, i) => {
		const piece = all.subarray(i * 32768, (i + 1) * 32768);
		return { packed: piece, expanded: piece.length };
	});
	const names = files.map(file => new TextEncoder().encode(file.path.replace(/\//g, '\\')));
	const fileTable = files.reduce((n, _, i) => n + 16 + names[i]!.length + 1, 0);
	const filesOffset = 36 + 8;
	const dataOffset = filesOffset + fileTable;
	const blocks = frames.map(frame => {
		const block = new Uint8Array(8 + frame.packed.length);
		const view = new DataView(block.buffer);
		view.setUint16(4, frame.packed.length, true);
		view.setUint16(6, frame.expanded, true);
		block.set(frame.packed, 8);
		view.setUint32(0, checksum(block.subarray(4, 8), checksum(frame.packed, 0)), true);
		return block;
	});
	if (options.damage) blocks[blocks.length - 1]![9] ^= 0xff;
	const size = dataOffset + blocks.reduce((n, block) => n + block.length, 0);
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	out.set([0x4d, 0x53, 0x43, 0x46]);
	view.setUint32(8, size, true);
	view.setUint32(16, filesOffset, true);
	out[24] = 3; out[25] = 1; // version 1.3
	view.setUint16(26, 1, true); // folders
	view.setUint16(28, files.length, true);
	view.setUint32(36, dataOffset, true);
	view.setUint16(40, blocks.length, true);
	view.setUint16(42, options.lzx ? 0x0003 | (16 << 8) : 0, true);
	let offset = filesOffset, folderOffset = 0;
	files.forEach((file, i) => {
		view.setUint32(offset, file.data.length, true);
		view.setUint32(offset + 4, folderOffset, true);
		view.setUint16(offset + 8, 0, true);
		view.setUint16(offset + 14, 0x80, true); // UTF-8 name
		out.set(names[i]!, offset + 16);
		offset += 16 + names[i]!.length + 1;
		folderOffset += file.data.length;
	});
	at = dataOffset;
	for (const block of blocks) {
		out.set(block, at);
		at += block.length;
	}
	return out;
}
