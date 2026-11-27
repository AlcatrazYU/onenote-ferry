// Notebooks packaged by OneNote for Windows (`.onepkg`, src/core/cab.ts, §11.5 item 73): listed from
// the package's index and unpacked block by block. Packages are built by tests/cab-writer.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CabFormatError, extractCab, isCabinet, readCabIndex } from '../src/core/cab.ts';
import type { CabEntry } from '../src/core/cab.ts';
import type { RandomAccessFile } from '../src/core/zip.ts';
import { makeCab } from './cab-writer.ts';

const memory = (bytes: Uint8Array): RandomAccessFile => ({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
const filled = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

async function unpack(bytes: Uint8Array, wanted?: (entry: CabEntry) => boolean): Promise<Map<string, Uint8Array>> {
	const pieces = new Map<string, number[]>();
	await extractCab(memory(bytes), async (entry, piece) => {
		if (!pieces.has(entry.path)) pieces.set(entry.path, []);
		pieces.get(entry.path)!.push(...piece);
	}, wanted);
	return new Map([...pieces].map(([path, data]) => [path, Uint8Array.from(data)]));
}

// A notebook as Windows packages it: its table of contents, a section, a section in a group; the
// middle one spans data blocks (over 32 KB), and its size is odd.
const FILES = [
	{ path: 'Open Notebook.onetoc2', data: filled(300, 1) },
	{ path: 'Spring.one', data: filled(70001, 2) },
	{ path: 'Group/Summer.one', data: filled(5000, 3) },
];

for (const lzx of [false, true]) {
	test(`a package ${lzx ? 'compressed with LZX' : 'stored as is'}: listed from its index, unpacked file by file, across data blocks`, async () => {
		const cab = makeCab(FILES, { lzx });
		assert.ok(isCabinet(cab));
		assert.deepEqual((await readCabIndex(memory(cab))).map(entry => [entry.path, entry.size]), FILES.map(file => [file.path, file.data.length]));
		const out = await unpack(cab);
		for (const file of FILES) assert.deepEqual(out.get(file.path), file.data, file.path);
		// Only the sections: the table of contents is left out.
		assert.deepEqual([...(await unpack(cab, entry => entry.path.endsWith('.one'))).keys()], ['Spring.one', 'Group/Summer.one']);
	});
}

test('names in UTF-8 without the flag that says so, as OneNote writes them: read as UTF-8', async () => {
	const files = [{ path: '打开笔记本.onetoc2', data: filled(40, 4) }, { path: '新しいセクション 1.one', data: filled(90, 5) }, { path: 'caf\u00e9.one', data: filled(10, 6) }];
	const bytes = makeCab(files, { unflaggedNames: true });
	assert.deepEqual((await readCabIndex(memory(bytes))).map(entry => entry.path), ['打开笔记本.onetoc2', '新しいセクション 1.one', 'café.one']);
	assert.deepEqual([...(await unpack(bytes)).keys()], ['打开笔记本.onetoc2', '新しいセクション 1.one', 'café.one']);
});

test('a damaged data block, or what is not a package: an error that says so', async () => {
	await assert.rejects(unpack(makeCab(FILES, { damage: true })), (error: Error) => error instanceof CabFormatError && /checksum/.test(error.message));
	await assert.rejects(readCabIndex(memory(new Uint8Array(40))), CabFormatError);
	assert.equal(isCabinet(new Uint8Array([0x50, 0x4b, 3, 4])), false);
});

// As a download (src/node/download.ts): a section exported on its own, and a packaged notebook,
// built from public sample sections.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDownload } from '../src/node/download.ts';

const SAMPLES = join(import.meta.dirname, 'samples', 'aspose');

test('a section exported on its own (.one) is a notebook of that section, named after it', async () => {
	const download = await openDownload(join(SAMPLES, 'SimpleTable.one'), join(tmpdir(), 'unused'), true);
	assert.deepEqual(download.notebooks.map(notebook => [notebook.name, notebook.sections.map(section => section.label)]), [['SimpleTable', ['SimpleTable']]]);
	assert.equal(await download.parserPath(download.notebooks[0]!.sections[0]!), join(SAMPLES, 'SimpleTable.one'));
	download.close();
});

test('a packaged notebook (.onepkg): its sections and groups listed, each section unpacked as it was', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ferry-onepkg-'));
	try {
		const table = readFileSync(join(SAMPLES, 'SimpleTable.one')), image = readFileSync(join(SAMPLES, 'ImageWithTag.one'));
		writeFileSync(join(dir, 'Tides.onepkg'), makeCab([
			{ path: 'Open Notebook.onetoc2', data: filled(100, 7) },
			{ path: 'Table.one', data: table },
			{ path: 'Pictures/Image.one', data: image },
		], { lzx: true }));
		const download = await openDownload(join(dir, 'Tides.onepkg'), join(dir, 'tmp'), true);
		const [notebook] = download.notebooks;
		assert.equal(notebook!.name, 'Tides');
		assert.deepEqual(notebook!.sections.map(section => [section.groups, section.label]), [[[], 'Table'], [['Pictures'], 'Image']]);
		assert.deepEqual(new Uint8Array(readFileSync(await download.parserPath(notebook!.sections[1]!))), new Uint8Array(image));
		assert.deepEqual(await download.head(notebook!.sections[0]!, 4), new Uint8Array(table.subarray(0, 4)));
		download.close();
	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a package naming a file outside its folder: that name is not listed, and nothing is unpacked', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ferry-onepkg-'));
	try {
		writeFileSync(join(dir, 'Bad.onepkg'), makeCab([{ path: 'Fine.one', data: filled(10, 1) }, { path: 'x/../../escape.one', data: filled(10, 2) }]));
		const download = await openDownload(join(dir, 'Bad.onepkg'), join(dir, 'tmp'), true);
		assert.deepEqual(download.notebooks.flatMap(notebook => notebook.sections.map(section => section.label)), ['Fine']);
		await assert.rejects(download.parserPath(download.notebooks[0]!.sections[0]!), /cannot be unpacked/);
		assert.equal(existsSync(join(dir, 'escape.one')), false);
		download.close();
	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
