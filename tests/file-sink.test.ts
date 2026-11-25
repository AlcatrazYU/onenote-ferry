// The command line's output on disk (src/node/file-sink.ts): it writes, moves and copies inside its
// folder only, whatever a path says, keeps file times when it copies, and never overwrites by moving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSink } from '../src/node/file-sink.ts';

function folders() {
	const base = mkdtempSync(join(tmpdir(), 'onenote-ferry-test-'));
	const root = join(base, 'output');
	return { base, root, sink: fileSink(root), done: () => rmSync(base, { recursive: true, force: true }) };
}

test('nothing reaches outside the output folder, whatever the path says', async () => {
	const { base, sink, done } = folders();
	try {
		await sink.writeText('Notebook/Page.md', 'invented');
		writeFileSync(join(base, 'beside.md'), 'not ours');
		for (const path of ['../beside.md', 'Notebook/../../beside.md', '../../x.md']) {
			await assert.rejects(sink.writeText(path, 'x'), /Outside the output folder/, path);
			await assert.rejects(sink.writeBinary(path, new Uint8Array([1])), /Outside the output folder/, path);
			await assert.rejects(sink.move('Notebook/Page.md', path), /Outside the output folder/, path);
			await assert.rejects(sink.copy('Notebook/Page.md', path), /Outside the output folder/, path);
			await assert.rejects(sink.appendText(path, 'x'), /Outside the output folder/, path);
			assert.equal(await sink.readText(path), undefined, path);
		}
		await assert.rejects(sink.move('../beside.md', 'Notebook/Taken.md'), /Outside the output folder/);
		assert.ok(existsSync(join(base, 'beside.md')));
		assert.equal(await sink.readText('Notebook/Page.md'), 'invented');
	}
	finally {
		done();
	}
});

test('moving never overwrites; copying keeps the file time and never overwrites', async () => {
	const { sink, done } = folders();
	try {
		const when = new Date('2024-01-02T03:04:05.000Z');
		await sink.writeText('A/One.md', 'one', when);
		await sink.writeText('A/Two.md', 'two');
		await assert.rejects(sink.move('A/One.md', 'A/Two.md'));
		await assert.rejects(sink.copy('A/One.md', 'A/Two.md'));
		assert.equal(await sink.readText('A/Two.md'), 'two');
		await sink.copy('A/One.md', 'B/One.md');
		assert.equal((await sink.stat('B/One.md'))?.mtime, when.getTime());
		await sink.move('A', 'C/A');
		assert.deepEqual((await sink.listFiles('C')).sort(), ['C/A/One.md', 'C/A/Two.md']);
		assert.equal(await sink.exists('A'), false);
	}
	finally {
		done();
	}
});

test('nothing is written onto a symbolic link; a folder the user linked from elsewhere is written into', async () => {
	const { base, root, sink, done } = folders();
	try {
		await sink.writeText('Notebook/Section/Page.md', 'invented');
		mkdirSync(join(base, 'elsewhere'));
		symlinkSync(join(base, 'elsewhere'), join(root, 'Notebook', 'Section', 'Linked'));
		symlinkSync(join(base, 'elsewhere', 'target.md'), join(root, 'Notebook', 'Section', 'Link.md'));
		await assert.rejects(sink.writeText('Notebook/Section/Link.md', 'x'), /symbolic link/);
		assert.ok(!existsSync(join(base, 'elsewhere', 'target.md')));
		await sink.writeText('Notebook/Section/Linked/New.md', 'x');
		assert.ok(existsSync(join(base, 'elsewhere', 'New.md')));
	}
	finally {
		done();
	}
});
