// Sections in the order OneNote shows them (§11.5 item 76): each folder's table of contents
// (`.onetoc2`) lists its sections and section groups; the parser reads it (tocNames). Here a table
// is stood in for by a JSON list of the names, read by a stand-in for the parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNotebooks, orderByTables, tableFiles } from '../src/core/download.ts';
import type { DownloadFile } from '../src/core/download.ts';
import { openDownload } from '../src/node/download.ts';
import { makeCab } from './cab-writer.ts';
import { makeZip } from './zip-writer.ts';

const table = (names: string[]) => new TextEncoder().encode(JSON.stringify(names));
const tocNames = (data: Uint8Array): string[] => JSON.parse(new TextDecoder().decode(data));
const order = (sections: { groups: string[], label: string }[]) => sections.map(section => [...section.groups, section.label].join('/'));

// A notebook whose names sort otherwise than OneNote shows them: sections, a group with its own table, and a group without one.
const FILES: DownloadFile[] = [
	{ path: 'Tides/Open Notebook.onetoc2', size: 1 },
	{ path: 'Tides/Spring.one', size: 1 },
	{ path: 'Tides/Autumn.one', size: 1 },
	{ path: 'Tides/Week 10.one', size: 1 },
	{ path: 'Tides/Week 2.one', size: 1 },
	{ path: 'Tides/Archive/Open Notebook.onetoc2', size: 1 },
	{ path: 'Tides/Archive/Old.one', size: 1 },
	{ path: 'Tides/Archive/Older.one', size: 1 },
	{ path: 'Tides/Bay/North.one', size: 1 },
	{ path: 'Tides/Bay/East.one', size: 1 },
];

test('each folder of a notebook has its table of contents found', () => {
	const [notebook] = findNotebooks(FILES, 'Download');
	assert.deepEqual(Object.fromEntries(tableFiles(notebook!, FILES)), { '': 'Tides/Open Notebook.onetoc2', 'Archive': 'Tides/Archive/Open Notebook.onetoc2' });
});

test('sections follow their tables; sections before groups; what a table leaves out after it, by name, groups kept apart', () => {
	const [notebook] = findNotebooks(FILES, 'Download');
	assert.deepEqual(order(notebook!.sections), ['Autumn', 'Spring', 'Week 2', 'Week 10', 'Archive/Old', 'Archive/Older', 'Bay/East', 'Bay/North']);
	const tables: Record<string, string[]> = {
		'': ['Week 10.one', 'spring.one', 'OneNote_RecycleBin', 'Bay', 'Archive'],
		'Archive': ['Older.one', 'Old.one'],
	};
	orderByTables(notebook!, groups => tables[groups.join('\u0000')]);
	// Autumn and Week 2 are not listed: after the listed sections, by name. Bay has no table of its own: its sections by name.
	assert.deepEqual(order(notebook!.sections), ['Week 10', 'Spring', 'Autumn', 'Week 2', 'Bay/East', 'Bay/North', 'Archive/Older', 'Archive/Old']);
});

test('a name the table writes with ^ and another character (a full-width colon as ^7) is still found', () => {
	const files: DownloadFile[] = [
		{ path: 'Tides/Open Notebook.onetoc2', size: 1 },
		{ path: 'Tides/Study (0.1) Tides.one', size: 1 },
		{ path: 'Tides/Study (0.2) Notes\uff1aMoon.one', size: 1 },
		{ path: 'Tides/Study (0.3) Waves.one', size: 1 },
		{ path: 'Tides/Renamed.one', size: 1 },
	];
	const [notebook] = findNotebooks(files, 'Download');
	orderByTables(notebook!, () => ['Study (0.1) Tides.one', 'Study (0.2) Notes^7Moon.one', 'Study (0.3) Waves.one', 'Old name.one']);
	// The renamed section's old name matches nothing: it goes after the listed ones.
	assert.deepEqual(order(notebook!.sections), ['Study (0.1) Tides', 'Study (0.2) Notes\uff1aMoon', 'Study (0.3) Waves', 'Renamed']);
});

test('no table, or an empty one: the order by name stays', () => {
	const [notebook] = findNotebooks(FILES, 'Download');
	const before = order(notebook!.sections);
	orderByTables(notebook!, () => undefined);
	assert.deepEqual(order(notebook!.sections), before);
	orderByTables(notebook!, () => []);
	assert.deepEqual(order(notebook!.sections), before);
});

test('a folder, a zip and a packaged notebook all come in their tables\' order; one that cannot be read keeps the order by name', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ferry-order-'));
	try {
		const files: [string, Uint8Array][] = [
			['Tides/Open Notebook.onetoc2', table(['Spring.one', 'Archive', 'Autumn.one'])],
			['Tides/Autumn.one', new Uint8Array(4)],
			['Tides/Spring.one', new Uint8Array(4)],
			['Tides/Archive/Open Notebook.onetoc2', table(['Older.one', 'Old.one'])],
			['Tides/Archive/Old.one', new Uint8Array(4)],
			['Tides/Archive/Older.one', new Uint8Array(4)],
		];
		const expected = ['Spring', 'Autumn', 'Archive/Older', 'Archive/Old'];
		for (const [path, data] of files) {
			mkdirSync(join(dir, 'folder', ...path.split('/').slice(0, -1)), { recursive: true });
			writeFileSync(join(dir, 'folder', ...path.split('/')), data);
		}
		writeFileSync(join(dir, 'Tides.zip'), makeZip(files.map(([name, data], i) => ({ name, data, ...(i % 2 ? {} : { deflate: true }) }))));
		writeFileSync(join(dir, 'Tides.onepkg'), makeCab(files.map(([path, data]) => ({ path: path.replace(/^Tides\//, ''), data })), { lzx: true }));
		for (const input of ['folder', 'Tides.zip', 'Tides.onepkg']) {
			const download = await openDownload(join(dir, input), join(dir, `tmp-${input}`), true, tocNames);
			assert.deepEqual(order(download.notebooks[0]!.sections), expected, input);
			download.close();
		}
		// A parser that cannot read the tables: the order by name, nothing lost.
		const unread = await openDownload(join(dir, 'Tides.zip'), join(dir, 'tmp-unread'), true, () => { throw new Error('unreadable'); });
		assert.deepEqual(order(unread.notebooks[0]!.sections), ['Autumn', 'Spring', 'Archive/Old', 'Archive/Older']);
		unread.close();
	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
