// The user's OneDrive as the plugin sees it: finding notebooks (Documents, then a search for
// tables of contents), listing a notebook's files, and planning the local copy. Graph is a
// stand-in answering from a made-up drive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRemoteNotebooks, folderChildren, folderPath, GraphError, notebookFiles, notebooksInFolder, planCopy } from '../src/core/onedrive.ts';
import type { DriveItem, GraphGet, LocalFile, RemoteFile } from '../src/core/onedrive.ts';

const notebook = (id: string, name: string, parent: string, path: string): DriveItem =>
	({ id, name, package: { type: 'oneNote' }, folder: {}, eTag: `"{${id}},1"`, lastModifiedDateTime: '2026-11-26T00:00:00Z', parentReference: { id: parent, path: `/drive/root:${path}` } });
const folder = (id: string, name: string, parent: string): DriveItem => ({ id, name, folder: {}, parentReference: { id: parent } });
const file = (id: string, name: string, parent: string, size = 100, version = 1): DriveItem => ({ id, name, file: {}, size, eTag: `"{${id}},${version}"`, parentReference: { id: parent } });

/** A Graph that answers listed paths (ignoring the query) and items by ID, counting requests. */
function drive(items: DriveItem[], listings: Record<string, DriveItem[][]>) {
	const requests: string[] = [];
	const graph: GraphGet = async path => {
		requests.push(path);
		const bare = path.replace(/\?.*$/, '');
		const pages = listings[bare];
		if (pages && path.endsWith('?page=2')) return { value: pages[1] };
		if (pages) return { value: pages[0], ...(pages.length > 1 ? { '@odata.nextLink': `${bare}?page=2` } : {}) };
		const match = bare.match(/^\/me\/drive\/items\/([^/]+)$/);
		if (match) {
			const found = items.find(item => item.id === decodeURIComponent(match[1]!));
			if (found) return found;
			throw new GraphError(404, 'itemNotFound');
		}
		const children = bare.match(/^\/me\/drive\/items\/([^/]+)\/children$/);
		if (children) return { value: items.filter(item => item.parentReference?.id === decodeURIComponent(children[1]!)) };
		throw new GraphError(404, 'itemNotFound', path);
	};
	return { graph, requests };
}

const DOCS = 'docs';
const nbA = notebook('A', 'Alpha', DOCS, '/学习/文档');
const nbB = notebook('B', 'Beta', DOCS, '/学习/文档');
const nbC = notebook('C', 'Gamma', 'elsewhere', '/学习/新建文件夹');
const groupC = folder('C-g', 'Group', 'C');
const recycleA = folder('A-r', 'OneNote_RecycleBin', 'A');
const plain = folder('X', 'Exported notebook', 'root');
const ITEMS = [nbA, nbB, nbC, groupC, recycleA, plain, folder('elsewhere', '新建文件夹', 'root'), file('A-toc', 'Open Notebook.onetoc2', 'A')];

test('notebooks are found in Documents and, through their tables of contents, anywhere else', async () => {
	const { graph, requests } = drive(ITEMS, {
		'/me/drive/special/documents/children': [[nbA, folder('D', 'Not a notebook', DOCS)], [nbB]],
		"/me/drive/root/search(q='onetoc2')": [[
			file('t1', 'Open Notebook.onetoc2', 'A'),
			file('t2', 'Open Notebook.onetoc2', 'C-g'),
			file('t3', 'ノートブックを開く.onetoc2', 'A-r'),
			file('t4', 'Open Notebook.onetoc2', 'X'),
			file('t5', 'notes.txt', 'X'),
			{ ...file('t6', 'gone.onetoc2', 'B'), deleted: {} },
		]],
	});
	const found = await findRemoteNotebooks(graph);
	assert.deepEqual(found.map(n => [n.id, n.name, n.folder]), [['A', 'Alpha', '学习/文档'], ['B', 'Beta', '学习/文档'], ['C', 'Gamma', '学习/新建文件夹']]);
	// Two pages of Documents, one search, and only the folders not known yet (C's group, C, A's bin, X, X's parent).
	assert.equal(requests.filter(r => r.includes('special/documents')).length, 2);
	assert.equal(requests.filter(r => r.includes('search(')).length, 1);
	assert.ok(!requests.some(r => r.startsWith('/me/drive/items/A?')), 'a notebook found in Documents is not asked about again');
});

test('a drive without a Documents folder still has its notebooks found', async () => {
	const { graph } = drive(ITEMS, { "/me/drive/root/search(q='onetoc2')": [[file('t2', 'Open Notebook.onetoc2', 'C-g')]] });
	assert.deepEqual((await findRemoteNotebooks(graph)).map(n => n.id), ['C']);
});

test('other errors are not taken for a missing Documents folder', async () => {
	const graph: GraphGet = async () => { throw new GraphError(401, 'InvalidAuthenticationToken'); };
	await assert.rejects(findRemoteNotebooks(graph), (error: unknown) => error instanceof GraphError && error.status === 401);
});

test('a chosen folder: the notebooks directly in it, or itself when it is one', async () => {
	const { graph } = drive([...ITEMS, notebook('E', 'Epsilon', 'X', '/Exported notebook')], {});
	assert.deepEqual((await notebooksInFolder(graph, 'X')).map(n => n.id), ['E']);
	assert.deepEqual((await notebooksInFolder(graph, 'C')).map(n => n.id), ['C']);
	const top = await folderChildren(graph, 'root');
	assert.deepEqual(top.folders, [{ id: 'X', name: 'Exported notebook' }, { id: 'elsewhere', name: '新建文件夹' }]);
	assert.deepEqual((await folderChildren(graph, 'X')).notebooks.map(n => n.id), ['E']);
});

test('a notebook\'s files: sections and tables of contents in it and its groups, not the recycle bin', async () => {
	const items = [
		file('s1', 'One.one', 'N', 10), file('toc', 'Open Notebook.onetoc2', 'N', 5), file('x', 'notes.txt', 'N'),
		folder('g', 'Group', 'N'), file('s2', 'Two.one', 'g', 20), file('gt', 'Open Notebook.onetoc2', 'g'),
		folder('gg', 'Inner', 'g'), file('s3', 'Three.one', 'gg', 30),
		folder('r', 'OneNote_RecycleBin', 'N'), file('s4', 'Deleted.one', 'r'),
		{ ...file('s5', 'Gone.one', 'N'), deleted: {} },
		{ id: 's6', name: 'No version.one', file: {}, parentReference: { id: 'N' } },
	];
	const { graph } = drive(items, {});
	const files = await notebookFiles(graph, 'N');
	assert.deepEqual(files.map(f => f.path).sort(), ['Group/Inner/Three.one', 'Group/Open Notebook.onetoc2', 'Group/Two.one', 'One.one', 'Open Notebook.onetoc2']);
	assert.deepEqual(files.find(f => f.id === 's2'), { id: 's2', path: 'Group/Two.one', size: 20, eTag: '"{s2},1"', modified: undefined });
});

test('folder paths are read as people see them', () => {
	assert.equal(folderPath({ path: '/drive/root:/%E5%AD%A6%E4%B9%A0/%E6%96%87%E6%A1%A3' }), '学习/文档');
	assert.equal(folderPath({ path: '/drive/root:' }), '');
	assert.equal(folderPath(undefined), '');
});

const remote = (id: string, path: string, size = 100, version = 1): RemoteFile => ({ id, path, size, eTag: `"{${id}},${version}"` });
const local = (path: string, size = 100, version = 1, id = ''): LocalFile => ({ path, size, eTag: `"{${id}},${version}"` });

test('the copy fetches only what is new, changed, missing or damaged', () => {
	const state: Record<string, LocalFile> = {
		same: local('Same.one', 100, 1, 'same'),
		changed: local('Changed.one', 100, 1, 'changed'),
		missing: local('Missing.one', 100, 1, 'missing'),
		damaged: local('Damaged.one', 100, 1, 'damaged'),
	};
	const disk: Record<string, number> = { 'Same.one': 100, 'Changed.one': 100, 'Damaged.one': 40 };
	const plan = planCopy([
		remote('same', 'Same.one'),
		remote('changed', 'Changed.one', 120, 2),
		remote('missing', 'Missing.one'),
		remote('damaged', 'Damaged.one'),
		remote('new', 'New.one'),
	], state, path => disk[path]);
	assert.deepEqual(plan.same.map(f => f.id), ['same']);
	assert.deepEqual(plan.download.map(f => f.id).sort(), ['changed', 'damaged', 'missing', 'new']);
	assert.deepEqual(plan.move, []);
	assert.deepEqual(plan.remove, []);
});

test('renamed or moved only in OneDrive: moved in the copy; renamed and changed: fetched anew, the old one removed', () => {
	const state = { r: local('Old.one', 100, 1, 'r'), m: local('Moved.one', 100, 1, 'm'), rc: local('Before.one', 100, 1, 'rc') };
	const disk: Record<string, number> = { 'Old.one': 100, 'Moved.one': 100, 'Before.one': 100 };
	const plan = planCopy([remote('r', 'New.one'), remote('m', 'Group/Moved.one'), remote('rc', 'After.one', 110, 2)], state, path => disk[path]);
	assert.deepEqual(plan.move.map(m => [m.from, m.to.path]), [['Old.one', 'New.one'], ['Moved.one', 'Group/Moved.one']]);
	assert.deepEqual(plan.download.map(f => f.path), ['After.one']);
	assert.deepEqual(plan.remove, ['Before.one']);
});

test('deleted in OneDrive (or moved into its recycle bin): removed from the copy', () => {
	const state = { gone: local('Gone.one', 100, 1, 'gone'), kept: local('Kept.one', 100, 1, 'kept') };
	const disk: Record<string, number> = { 'Gone.one': 100, 'Kept.one': 100 };
	const plan = planCopy([remote('kept', 'Kept.one')], state, path => disk[path]);
	assert.deepEqual(plan.remove, ['Gone.one']);
	assert.deepEqual(plan.same.map(f => f.id), ['kept']);
});

test('a path another file takes over is not removed, and two sections swapping names do not lose each other', () => {
	// "A" was deleted and another section was renamed to "A": the place is not emptied, the renamed one moves there (replacing it).
	const state = { old: local('A.one', 100, 1, 'old'), other: local('B.one', 100, 1, 'other') };
	const disk: Record<string, number> = { 'A.one': 100, 'B.one': 100 };
	const plan = planCopy([remote('other', 'A.one')], state, path => disk[path]);
	assert.deepEqual(plan.remove, []);
	assert.deepEqual(plan.move.map(m => [m.from, m.to.path]), [['B.one', 'A.one']]);
	// Swapped names, same versions.
	const swap = planCopy([remote('x', 'B.one'), remote('y', 'A.one')], { x: local('A.one', 100, 1, 'x'), y: local('B.one', 100, 1, 'y') }, path => disk[path]);
	assert.deepEqual(swap.remove, []);
	assert.equal(swap.move.length + swap.download.length, 2);
});

test('a search hit inside a notebook found already is not asked about: its path says where it is', async () => {
	const inGroup = { ...file('t1', 'Open Notebook.onetoc2', 'A-g'), parentReference: { id: 'A-g', path: '/drive/root:/%E5%AD%A6%E4%B9%A0/%E6%96%87%E6%A1%A3/Alpha/Group' } };
	const inBin = { ...file('t2', 'Open Notebook.onetoc2', 'A-r'), parentReference: { id: 'A-r', path: '/drive/root:/学习/文档/Alpha/OneNote_RecycleBin' } };
	const elsewhere = { ...file('t3', 'Open Notebook.onetoc2', 'C-g'), parentReference: { id: 'C-g', path: '/drive/root:/学习/新建文件夹/Gamma/Group' } };
	const { graph, requests } = drive(ITEMS, {
		'/me/drive/special/documents/children': [[nbA]],
		"/me/drive/root/search(q='onetoc2')": [[inGroup, inBin, elsewhere]],
	});
	assert.deepEqual((await findRemoteNotebooks(graph)).map(n => n.id), ['A', 'C']);
	assert.deepEqual(requests.filter(r => r.startsWith('/me/drive/items/')).map(r => r.replace(/\?.*/, '')), ['/me/drive/items/C-g', '/me/drive/items/C']);
});
