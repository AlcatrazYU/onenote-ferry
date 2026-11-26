// The local copy of a OneDrive notebook: laid out as the website's zip (the reader opens it as any
// download), fetching only what changed, following renames, moves and deletions, one window at a
// time. A made-up drive answers Graph; a local server stands in for the download host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphError } from '../src/core/onedrive.ts';
import type { DriveItem, GraphGet, RemoteNotebook } from '../src/core/onedrive.ts';
import { openDownload } from '../src/node/download.ts';
import { copiedNotebooks, CopyBusy, NoSpace, updateCopy } from '../src/node/mirror.ts';
import type { UpdateCopyOptions } from '../src/node/mirror.ts';

interface RemoteItem { id: string, name: string, parent: string, folder?: boolean, body?: Uint8Array, version?: number }

function content(text: string): Uint8Array {
	return new TextEncoder().encode(text.repeat(500));
}

async function setup() {
	const items = new Map<string, RemoteItem>();
	const add = (item: RemoteItem) => items.set(item.id, { version: 1, ...item });
	add({ id: 's1', name: 'One.one', parent: 'N', body: content('one ') });
	add({ id: 'toc', name: 'Open Notebook.onetoc2', parent: 'N', body: content('toc ') });
	add({ id: 'g', name: 'Group', parent: 'N', folder: true });
	add({ id: 's2', name: 'Two.one', parent: 'g', body: content('two ') });
	const eTag = (item: RemoteItem) => `"{${item.id}},${item.version}"`;
	let failing = new Set<string>();
	const downloads: string[] = [];
	const server = createServer((req, res) => {
		const id = decodeURIComponent(String(req.url).slice('/f/'.length));
		const item = items.get(id);
		if (!item?.body || failing.has(id)) {
			res.writeHead(500);
			res.end();
			return;
		}
		downloads.push(id);
		res.writeHead(200, { 'Content-Length': item.body.length, ETag: eTag(item) });
		res.end(item.body);
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const toDrive = (item: RemoteItem): DriveItem => ({ id: item.id, name: item.name, parentReference: { id: item.parent }, ...(item.folder ? { folder: {} } : { file: {}, size: item.body!.length, eTag: eTag(item) }) });
	const graph: GraphGet = async path => {
		const children = path.match(/^\/me\/drive\/items\/([^/?]+)\/children/);
		if (children) return { value: [...items.values()].filter(item => item.parent === decodeURIComponent(children[1]!)).map(toDrive) };
		throw new GraphError(404, 'itemNotFound', path);
	};
	const root = mkdtempSync(join(tmpdir(), 'ferry-copy-'));
	const notebook: RemoteNotebook = { id: 'N', name: 'Ferry Sample', folder: '文档' };
	const options = (extra: Partial<UpdateCopyOptions> = {}): UpdateCopyOptions => ({
		graph,
		fetch,
		root,
		notebook,
		link: async id => {
			const item = items.get(id)!;
			return { url: `${base}/f/${encodeURIComponent(id)}`, size: item.body!.length, eTag: eTag(item) };
		},
		sleep: async () => undefined,
		free: () => 10 * 1024 ** 4,
		...extra,
	});
	return {
		items, add, root, notebook, options, downloads,
		fail: (ids: string[]) => failing = new Set(ids),
		done: async () => {
			rmSync(root, { recursive: true, force: true });
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
		},
	};
}

test('the first copy is laid out as the website\'s zip, and the reader opens it as a download', async () => {
	const s = await setup();
	try {
		const result = await updateCopy(s.options());
		assert.equal(result.downloaded, 3);
		assert.equal(result.folder, join(s.root, 'N', 'Ferry Sample'));
		assert.deepEqual(new Uint8Array(readFileSync(join(result.folder, 'Group', 'Two.one'))), s.items.get('s2')!.body);
		const state = JSON.parse(readFileSync(join(s.root, 'N', 'state.json'), 'utf8'));
		assert.deepEqual(Object.keys(state.files).sort(), ['s1', 's2', 'toc']);
		assert.ok(state.synced);
		// Nothing of the plugin's own files is inside the notebook's folder.
		assert.ok(!existsSync(join(result.folder, 'state.json')));
		const download = await openDownload(result.folder, join(s.root, 'tmp'), true);
		try {
			assert.deepEqual(download.notebooks.map(n => [n.name, n.sections.map(x => [x.groups.join('/'), x.label])]), [['Ferry Sample', [['', 'One'], ['Group', 'Two']]]]);
		}
		finally {
			download.close();
		}
	}
	finally {
		await s.done();
	}
});

test('progress is counted in sections, as the import counts them: a table of contents comes along uncounted', async () => {
	const s = await setup();
	try {
		const seen: { sections: number, totalSections: number, current?: string }[] = [];
		// One section chosen, with the tables of contents (as an import asks).
		await updateCopy(s.options({ only: new Set(['s2', 'toc']), concurrency: 1, onProgress: p => seen.push({ sections: p.sections, totalSections: p.totalSections, current: p.current }) }));
		assert.deepEqual(new Set(seen.map(p => p.totalSections)), new Set([1]));
		assert.equal(seen.at(-1)!.sections, 1);
		assert.ok(seen.every(p => p.current === undefined || p.current === 'Group/Two.one'), 'the table of contents is not named as arriving');
		// Brought up to date whole, the section already there counts as in place from the start.
		const all: { sections: number, totalSections: number }[] = [];
		await updateCopy(s.options({ onProgress: p => all.push({ sections: p.sections, totalSections: p.totalSections }) }));
		assert.deepEqual(all[0], { sections: 1, totalSections: 2 });
		assert.deepEqual(all.at(-1), { sections: 2, totalSections: 2 });
	}
	finally {
		await s.done();
	}
});

test('unchanged in OneDrive: nothing is fetched again', async () => {
	const s = await setup();
	try {
		await updateCopy(s.options());
		s.downloads.length = 0;
		const again = await updateCopy(s.options());
		assert.equal(again.downloaded, 0);
		assert.equal(again.same, 3);
		assert.deepEqual(s.downloads, []);
	}
	finally {
		await s.done();
	}
});

test('changed, renamed, moved and deleted in OneDrive: the copy follows, fetching only the changed', async () => {
	const s = await setup();
	try {
		const first = await updateCopy(s.options());
		s.downloads.length = 0;
		// Changed: a new version of One. Renamed only: Two to Second (same version). Deleted: the table of contents.
		s.items.get('s1')!.body = content('one, changed ');
		s.items.get('s1')!.version = 2;
		s.items.get('s2')!.name = 'Second.one';
		s.items.delete('toc');
		const result = await updateCopy(s.options());
		assert.deepEqual([result.downloaded, result.moved, result.removed], [1, 1, 1]);
		assert.deepEqual(s.downloads, ['s1']);
		assert.ok(existsSync(join(first.folder, 'Group', 'Second.one')));
		assert.ok(!existsSync(join(first.folder, 'Group', 'Two.one')));
		assert.ok(!existsSync(join(first.folder, 'Open Notebook.onetoc2')));
		assert.deepEqual(new Uint8Array(readFileSync(join(first.folder, 'One.one'))), s.items.get('s1')!.body);
	}
	finally {
		await s.done();
	}
});

test('a notebook renamed in OneDrive: its folder in the copy is renamed, nothing fetched again', async () => {
	const s = await setup();
	try {
		await updateCopy(s.options());
		s.downloads.length = 0;
		const result = await updateCopy(s.options({ notebook: { ...s.notebook, name: 'Ferry Sample 2' } }));
		assert.equal(result.folder, join(s.root, 'N', 'Ferry Sample 2'));
		assert.ok(!existsSync(join(s.root, 'N', 'Ferry Sample')));
		assert.deepEqual(s.downloads, []);
		assert.deepEqual(copiedNotebooks(s.root).map(n => n.name), ['Ferry Sample 2']);
	}
	finally {
		await s.done();
	}
});

test('a file that cannot be fetched is reported; the others arrive and the copy is usable', async () => {
	const s = await setup();
	try {
		s.fail(['s2']);
		const result = await updateCopy(s.options());
		assert.equal(result.downloaded, 2);
		assert.deepEqual(result.failed.map(f => [f.path, f.problem]), [['Group/Two.one', 'unreachable']]);
		// Next time it is fetched.
		s.fail([]);
		const again = await updateCopy(s.options());
		assert.deepEqual([again.downloaded, again.same], [1, 2]);
	}
	finally {
		await s.done();
	}
});

test('one window at a time; a lock left long ago is taken over', async () => {
	const s = await setup();
	try {
		mkdirSync(join(s.root, 'N'), { recursive: true });
		writeFileSync(join(s.root, 'N', 'lock'), '{}');
		await assert.rejects(updateCopy(s.options()), CopyBusy);
		const old = (Date.now() - 60 * 60 * 1000) / 1000;
		utimesSync(join(s.root, 'N', 'lock'), old, old);
		assert.equal((await updateCopy(s.options())).downloaded, 3);
		assert.ok(!existsSync(join(s.root, 'N', 'lock')), 'released at the end');
	}
	finally {
		await s.done();
	}
});

test('not enough disk space: nothing is fetched, and it says how much is needed', async () => {
	const s = await setup();
	try {
		await assert.rejects(updateCopy(s.options({ free: () => 1000 })), (error: unknown) => error instanceof NoSpace && error.free === 1000);
		assert.deepEqual(s.downloads, []);
	}
	finally {
		await s.done();
	}
});

test('a record edited by hand cannot make the copy remove anything outside it', async () => {
	const s = await setup();
	try {
		await updateCopy(s.options());
		const outside = join(s.root, 'keep-me.txt');
		writeFileSync(outside, 'not the copy\'s');
		const statePath = join(s.root, 'N', 'state.json');
		const state = JSON.parse(readFileSync(statePath, 'utf8'));
		state.files.evil = { path: '../../keep-me.txt', size: 13, eTag: '"x"' };
		writeFileSync(statePath, JSON.stringify(state));
		await updateCopy(s.options());
		assert.ok(existsSync(outside));
	}
	finally {
		await s.done();
	}
});
