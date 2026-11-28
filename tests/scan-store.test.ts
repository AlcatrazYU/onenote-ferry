// What checks for updates read, kept on disk across sessions (src/node/scan-store.ts, §11.5 item 90).
// Files are made up in a temporary folder; the pages are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readScans, scansFolder, writeScans } from '../src/node/scan-store.ts';
import type { KeptScan } from '../src/node/scan-store.ts';

const spring: KeptScan = { stamp: '10:1700000000000', pages: [{ id: '{0A}', title: 'Tides', modified: '2024-01-02T03:04:05.000Z', level: 0, fingerprint: 'f1' }] };
const summer: KeptScan = { stamp: '20:1700000000001', pages: [] };

test('kept for one download and read back; another download, version or format has none', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ferry-scans-'));
	try {
		const folder = scansFolder(root);
		assert.equal(folder, join(root, 'onenote-ferry', 'scans'));
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map(), 'nothing kept yet');
		await writeScans(folder, '/drive/Harbour.zip', '1.0.0', new Map([['Tides/Spring.one', spring], ['Tides/Summer.one', summer]]));
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map([['Tides/Spring.one', spring], ['Tides/Summer.one', summer]]));
		assert.deepEqual(await readScans(folder, '/drive/Other.zip', '1.0.0'), new Map(), 'another download');
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.1'), new Map(), 'another version of the plugin');
		// Written again: replaced whole, and no temporary file left.
		await writeScans(folder, '/drive/Harbour.zip', '1.0.0', new Map([['Tides/Summer.one', summer]]));
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map([['Tides/Summer.one', summer]]));
		const [file, ...others] = readdirSync(folder);
		assert.deepEqual(others, []);
		// Of another format, or not to be read: none.
		writeFileSync(join(folder, file!), JSON.stringify({ format: 2, version: '1.0.0', input: '/drive/Harbour.zip', sections: { 'Tides/Summer.one': summer } }));
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map());
		writeFileSync(join(folder, file!), '{"format":1,');
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map());
		// A section kept without its stamp or pages is left out, the others are read.
		writeFileSync(join(folder, file!), JSON.stringify({ format: 1, version: '1.0.0', input: '/drive/Harbour.zip', sections: { 'Tides/Spring.one': { pages: [] }, 'Tides/Summer.one': summer } }));
		assert.deepEqual(await readScans(folder, '/drive/Harbour.zip', '1.0.0'), new Map([['Tides/Summer.one', summer]]));
	}
	finally {
		rmSync(root, { recursive: true, force: true });
	}
});
