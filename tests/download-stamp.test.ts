// How a download is on disk (downloadStamp, src/node/download.ts), used to tell one that changed
// while the import window was hidden (§11.5 item 83). Files are made up in a temporary folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadStamp } from '../src/node/download.ts';

test('a folder: its sections and tables of contents count, other files do not; gone, there is none', () => {
	const root = mkdtempSync(join(tmpdir(), 'ferry-stamp-'));
	try {
		const folder = join(root, 'Harbour');
		mkdirSync(join(folder, 'Tides', 'Group'), { recursive: true });
		writeFileSync(join(folder, 'Tides', 'Spring.one'), 'spring');
		writeFileSync(join(folder, 'Tides', 'Open Notebook.onetoc2'), 'toc');
		writeFileSync(join(folder, 'Tides', 'Group', 'Summer.ONE'), 'summer');
		writeFileSync(join(folder, 'notes.txt'), 'a note');
		const first = downloadStamp(folder);
		assert.equal(typeof first, 'string');
		assert.equal(downloadStamp(folder), first, 'the same when nothing changed');

		writeFileSync(join(folder, 'notes.txt'), 'another note');
		assert.equal(downloadStamp(folder), first, 'a file that is not OneNote\'s does not count');

		const section = downloadStamp(folder, 'Tides/Spring.one');
		const other = downloadStamp(folder, 'Tides/Group/Summer.ONE');
		writeFileSync(join(folder, 'Tides', 'Spring.one'), 'spring, changed');
		assert.notEqual(downloadStamp(folder), first, 'a section changed');
		assert.notEqual(downloadStamp(folder, 'Tides/Spring.one'), section);
		assert.equal(downloadStamp(folder, 'Tides/Group/Summer.ONE'), other, 'the other section did not change');

		// Same size, another time: changed too.
		const before = downloadStamp(folder);
		utimesSync(join(folder, 'Tides', 'Open Notebook.onetoc2'), new Date(2020, 0, 1), new Date(2020, 0, 1));
		assert.notEqual(downloadStamp(folder), before);

		writeFileSync(join(folder, 'Tides', 'Autumn.one'), 'autumn');
		assert.notEqual(downloadStamp(folder), before, 'a section added');
		assert.equal(downloadStamp(folder, 'Tides/Winter.one'), undefined, 'a section that is not there');

		rmSync(folder, { recursive: true });
		assert.equal(downloadStamp(folder), undefined, 'gone');
	}
	finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a zip or an export: the whole file, for itself and for each of its sections', () => {
	const root = mkdtempSync(join(tmpdir(), 'ferry-stamp-'));
	try {
		const zip = join(root, 'Harbour.zip');
		writeFileSync(zip, 'not really a zip');
		const first = downloadStamp(zip);
		assert.equal(downloadStamp(zip, 'Tides/Spring.one'), first);
		writeFileSync(zip, 'not really a zip either');
		assert.notEqual(downloadStamp(zip), first);
		assert.equal(downloadStamp(zip, 'Tides/Spring.one'), downloadStamp(zip));
		rmSync(zip);
		assert.equal(downloadStamp(zip), undefined);
	}
	finally {
		rmSync(root, { recursive: true, force: true });
	}
});
