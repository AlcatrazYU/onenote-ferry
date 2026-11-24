// Reading zips: the table of contents (ZIP64 included), names, and what can be saved from a
// download that stopped part way. The zips are built here, with invented contents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { entryDataOffset, readZipDirectory, scanZipEntries, ZipFormatError } from '../src/core/zip.ts';
import type { RandomAccessFile, ZipEntry } from '../src/core/zip.ts';
import { bytes, crc32, makeZip } from './zip-writer.ts';
import type { Entry, Layout } from './zip-writer.ts';

function memoryFile(data: Uint8Array): RandomAccessFile {
	return { size: data.length, async read(offset, length) { return data.slice(offset, offset + length); } };
}

const SAMPLE: Entry[] = [
	{ name: 'Documents/Ferry notes/Open Notebook.onetoc2', data: bytes('toc') },
	{ name: 'Documents/Ferry notes/Timetables.one', data: bytes('first section, invented'.repeat(40)) },
	{ name: 'Documents/Ferry notes/渡口/River crossings.one', data: bytes('second section, invented'.repeat(60)), deflate: true },
];

/** Each entry's name and data as stored (deflated entries stay deflated). */
async function stored(zip: Uint8Array, entries: ZipEntry[]) {
	const file = memoryFile(zip);
	return Promise.all(entries.map(async e => [e.name, e.method, Buffer.from(await file.read(await entryDataOffset(file, e), e.compressedSize)).toString('hex')]));
}
const expected = (list: Entry[]) => list.map(e => [e.name, e.deflate ? 8 : 0, Buffer.from(e.deflate ? deflateRawSync(e.data) : e.data).toString('hex')]);
const sizes = (entries: ZipEntry[]) => entries.map(e => [e.name, e.size, e.compressedSize, e.crc32]);
const expectedSizes = (list: Entry[]) => list.map(e => [e.name, e.data.length, (e.deflate ? deflateRawSync(e.data) : e.data).length, crc32(e.data)]);

const LAYOUTS: Layout[] = [
	{}, { descriptors: 'after' }, { descriptors: 'both' }, { descriptors: 'both', unsignedDescriptors: true },
	{ zip64: 'all' }, { zip64: 'offset' }, { descriptors: 'after', zip64: 'all' }, { descriptors: 'both', zip64: 'all' },
];

for (const layout of LAYOUTS) {
	const label = JSON.stringify(layout);

	test(`the table of contents gives each entry's sizes, checksum and data (${label})`, async () => {
		const zip = makeZip(SAMPLE, layout);
		const entries = await readZipDirectory(memoryFile(zip));
		assert.deepEqual(sizes(entries), expectedSizes(SAMPLE));
		assert.deepEqual(await stored(zip, entries), expected(SAMPLE));
	});

	test(`a download cut off part way keeps the entries that arrived whole (${label})`, async () => {
		const zip = makeZip(SAMPLE, layout);
		const whole = await readZipDirectory(memoryFile(zip));
		// Cut inside the third entry's data: no central directory, two entries whole.
		const cut = zip.slice(0, (await entryDataOffset(memoryFile(zip), whole[2])) + 10);
		await assert.rejects(readZipDirectory(memoryFile(cut)), ZipFormatError);
		const scanned = await scanZipEntries(memoryFile(cut));
		assert.equal(scanned.cutOff, SAMPLE[2].name);
		assert.equal(scanned.lostAt, undefined);
		assert.deepEqual(sizes(scanned.entries), expectedSizes(SAMPLE.slice(0, 2)));
		assert.deepEqual(await stored(cut, scanned.entries), expected(SAMPLE.slice(0, 2)));
		// Cut inside the central directory: every entry is whole.
		const directoryStart = Buffer.from(zip).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		const all = await scanZipEntries(memoryFile(zip.slice(0, directoryStart + 10)));
		assert.deepEqual(sizes(all.entries), expectedSizes(SAMPLE));
		assert.equal(all.cutOff, undefined);
	});
}

test('a descriptor signature inside the data, with the wrong size, is not taken for the end', async () => {
	const tricky: Entry[] = [
		{ name: 'a.one', data: Uint8Array.from([...bytes('xx'), 0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4, 9, 0, 0, 0, 9, 0, 0, 0, ...bytes('tail of the data')]) },
		{ name: 'b.one', data: bytes('next') },
	];
	const zip = makeZip(tricky, { descriptors: 'after' });
	const scanned = await scanZipEntries(memoryFile(zip.slice(0, zip.length - 10)));
	assert.deepEqual(scanned.entries.map(e => [e.name, e.size]), [['a.one', tricky[0].data.length], ['b.one', 4]]);
});

test('a descriptor that crosses the scan\'s 8 MB chunk is still found', async () => {
	// The scan reads 8 MB chunks from the data's start: data 6 bytes short of that puts the
	// 16-byte descriptor across the first chunk's end.
	const name = 'big.one';
	const big = new Uint8Array(8 * 1024 * 1024 - 6).fill(0x41);
	const zip = makeZip([{ name, data: big }, { name: 'after.one', data: bytes('after') }], { descriptors: 'after' });
	const scanned = await scanZipEntries(memoryFile(zip.slice(0, zip.length - 5)));
	assert.deepEqual(scanned.entries.map(e => [e.name, e.size]), [[name, big.length], ['after.one', 5]]);
});

test('names: UTF-8 with or without the flag, the DOS code page, and the Unicode path field', async () => {
	const zip = makeZip([
		{ name: 'flagged/渡口.one', data: bytes('a') },
		{ name: 'unflagged/渡口.one', data: bytes('b'), utf8Flag: false },
		{ name: 'dos', rawName: Uint8Array.from([...bytes('Caf'), 0x82, ...bytes('.one')]), data: bytes('c') },
		{ name: 'dos2', rawName: Uint8Array.from([...bytes('x'), 0x82, ...bytes('.one')]), unicodePath: 'unicode/渡し場.one', data: bytes('d') },
	]);
	assert.deepEqual((await readZipDirectory(memoryFile(zip))).map(e => e.name), ['flagged/渡口.one', 'unflagged/渡口.one', 'Café.one', 'unicode/渡し場.one']);
	assert.deepEqual((await scanZipEntries(memoryFile(zip))).entries.map(e => e.name), ['flagged/渡口.one', 'unflagged/渡口.one', 'Café.one', 'unicode/渡し場.one']);
});
