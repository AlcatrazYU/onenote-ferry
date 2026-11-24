// Builds zips for tests, the way different writers lay them out (OneDrive, macOS, ZIP64...).

import { deflateRawSync } from 'node:zlib';

export interface Entry {
	name: string;
	data: Uint8Array;
	/** Write the UTF-8 flag (default yes); false writes the name's bytes without it. */
	utf8Flag?: boolean;
	/** The name's raw bytes, when they are not its UTF-8 form. */
	rawName?: Uint8Array;
	/** An Info-ZIP Unicode path field naming the entry. */
	unicodePath?: string;
	deflate?: boolean;
}
export interface Layout {
	/**
	 * Where sizes go when a descriptor follows the data: 'after' only in the descriptor (local
	 * sizes zero), 'both' in the local header and the descriptor (as OneDrive writes most entries).
	 */
	descriptors?: 'after' | 'both';
	/** Write descriptors without their signature (allowed by the format). */
	unsignedDescriptors?: boolean;
	/** ZIP64: 'all' fields (as for files over 4 GB), or 'offset' only (as for small files late in a large download). */
	zip64?: 'all' | 'offset';
}

export const bytes = (text: string) => new TextEncoder().encode(text);

export function crc32(data: Uint8Array): number {
	let c = ~0;
	for (const b of data) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

class Writer {
	readonly parts: Uint8Array[] = [];
	length = 0;
	bytes(b: Uint8Array) { this.parts.push(b); this.length += b.length; }
	private n(value: number, size: number) {
		const b = new Uint8Array(size);
		for (let i = 0; i < size; i++) b[i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
		this.bytes(b);
	}
	u16(v: number) { this.n(v, 2); }
	u32(v: number) { this.n(v, 4); }
	u64(v: number) { this.n(v, 8); }
	done() { return Uint8Array.from(Buffer.concat(this.parts)); }
}

/** A zip written the way the layout asks. */
export function makeZip(entries: Entry[], layout: Layout = {}): Uint8Array {
	const w = new Writer();
	const descriptor = layout.descriptors !== undefined;
	const records: { e: Entry, name: Uint8Array, offset: number, crc: number, stored: Uint8Array, flags: number, extra: Uint8Array }[] = [];
	for (const e of entries) {
		const name = e.rawName ?? bytes(e.name);
		const stored = e.deflate ? Uint8Array.from(deflateRawSync(e.data)) : e.data;
		const flags = (e.utf8Flag === false || e.rawName ? 0 : 0x800) | (descriptor ? 0x08 : 0);
		const extra = new Writer();
		if (e.unicodePath) {
			const path = bytes(e.unicodePath);
			extra.u16(0x7075); extra.u16(5 + path.length); extra.bytes(Uint8Array.of(1)); extra.u32(crc32(name)); extra.bytes(path);
		}
		const record = { e, name, offset: w.length, crc: crc32(e.data), stored, flags, extra: extra.done() };
		records.push(record);
		const sizesHere = !descriptor || layout.descriptors === 'both';
		const localZip64 = layout.zip64 === 'all';
		w.u32(0x04034b50); w.u16(45); w.u16(flags); w.u16(e.deflate ? 8 : 0); w.u16(0); w.u16(0);
		w.u32(sizesHere ? record.crc : 0);
		if (localZip64) { w.u32(0xffffffff); w.u32(0xffffffff); }
		else { w.u32(sizesHere ? stored.length : 0); w.u32(sizesHere ? e.data.length : 0); }
		w.u16(name.length); w.u16((localZip64 ? 20 : 0) + record.extra.length);
		w.bytes(name);
		// Local ZIP64 field: uncompressed size, then compressed size.
		if (localZip64) { w.u16(0x0001); w.u16(16); w.u64(sizesHere ? e.data.length : 0); w.u64(sizesHere ? stored.length : 0); }
		w.bytes(record.extra);
		w.bytes(stored);
		if (descriptor) {
			if (!layout.unsignedDescriptors) w.u32(0x08074b50);
			w.u32(record.crc);
			if (localZip64) { w.u64(stored.length); w.u64(e.data.length); }
			else { w.u32(stored.length); w.u32(e.data.length); }
		}
	}
	const directoryStart = w.length;
	for (const { e, name, offset, crc, stored, flags, extra } of records) {
		const allZip64 = layout.zip64 === 'all', offsetZip64 = layout.zip64 !== undefined;
		w.u32(0x02014b50); w.u16(45); w.u16(45); w.u16(flags); w.u16(e.deflate ? 8 : 0); w.u16(0); w.u16(0); w.u32(crc);
		if (allZip64) { w.u32(0xffffffff); w.u32(0xffffffff); } else { w.u32(stored.length); w.u32(e.data.length); }
		const zip64Length = allZip64 ? 24 : offsetZip64 ? 8 : 0;
		w.u16(name.length); w.u16((zip64Length ? 4 + zip64Length : 0) + extra.length); w.u16(0); w.u16(0); w.u16(0); w.u32(0);
		w.u32(offsetZip64 ? 0xffffffff : offset);
		w.bytes(name);
		// Central ZIP64 field: only the fields that overflowed, in this order: size, compressed size, offset.
		if (zip64Length) {
			w.u16(0x0001); w.u16(zip64Length);
			if (allZip64) { w.u64(e.data.length); w.u64(stored.length); }
			w.u64(offset);
		}
		w.bytes(extra);
	}
	const directorySize = w.length - directoryStart;
	if (layout.zip64) {
		const record = w.length;
		w.u32(0x06064b50); w.u64(44); w.u16(45); w.u16(45); w.u32(0); w.u32(0); w.u64(entries.length); w.u64(entries.length); w.u64(directorySize); w.u64(directoryStart);
		w.u32(0x07064b50); w.u32(0); w.u64(record); w.u32(1);
		w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(0xffff); w.u16(0xffff); w.u32(0xffffffff); w.u32(0xffffffff); w.u16(0);
	}
	else {
		w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(entries.length); w.u16(entries.length); w.u32(directorySize); w.u32(directoryStart); w.u16(0);
	}
	return w.done();
}
