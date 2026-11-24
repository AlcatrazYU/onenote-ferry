// The import window's state (src/plugin/session.ts), run in Node with a small stand-in for
// Obsidian (tests/support) and a pretend worker: ticking notebooks and sections, adding sections
// to a notebook imported before, folders that are not ours, the target folder, and what happens
// when the window is closed or the import has started. Notebooks are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { DownloadNotebook } from '../src/core/download.ts';

register('./support/hooks.mjs', import.meta.url);
const { ImportSession } = await import('../src/plugin/session.ts');
const { cleanFolder, folderProblem } = await import('../src/plugin/settings.ts');
interface Node { name: string, path: string, parent: Node | null, children?: Node[] }
const { TFile, TFolder } = await import('./support/obsidian.mjs' as string) as {
	TFile: new (name: string, parent: Node) => Node,
	TFolder: new (name: string, parent: Node | null) => Node & { children: Node[] },
};

/** A vault holding these files (and the folders above them) and these empty folders. */
function fakeApp(files: Record<string, string>, folders: string[] = [], failRead = false) {
	const root = new TFolder('', null);
	const byPath = new Map<string, Node>([['', root]]);
	const folder = (path: string): Node & { children: Node[] } => {
		const known = byPath.get(path);
		if (known) return known as Node & { children: Node[] };
		const cut = path.lastIndexOf('/');
		const parent = cut < 0 ? root : folder(path.slice(0, cut));
		const made = new TFolder(cut < 0 ? path : path.slice(cut + 1), parent);
		parent.children.push(made);
		byPath.set(path, made);
		return made;
	};
	for (const path of folders) folder(path);
	for (const path of Object.keys(files)) {
		const cut = path.lastIndexOf('/');
		const parent = folder(path.slice(0, cut));
		const file = new TFile(path.slice(cut + 1), parent);
		parent.children.push(file);
		byPath.set(path, file);
	}
	const isFolder = (node: Node | undefined) => !!node && 'children' in node && Array.isArray(node.children);
	return {
		vault: {
			getRoot: () => root,
			getFolderByPath: (path: string) => isFolder(byPath.get(path)) ? byPath.get(path) : null,
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
			getFileByPath: (path: string) => byPath.has(path) && !isFolder(byPath.get(path)) ? byPath.get(path) : null,
			read: async (file: Node) => {
				if (failRead) throw new Error('EACCES: permission denied');
				return files[file.path] ?? '';
			},
		},
	} as never;
}

const notebook = (name: string, sections = ['A'], path = name): DownloadNotebook => ({
	name, path, sections: sections.map(label => ({ path: `${path}/${label}.one`, notebook: name, groups: [], label, size: 10 })),
});

/** A worker that answers after a moment: downloads by their path. */
class FakeClient {
	running = false;
	starts = 0;
	lockedPaths: Record<string, string[]> = {};
	private readonly waiting = new Set<(error: Error) => void>();
	private readonly downloads: Record<string, DownloadNotebook[]>;
	constructor(downloads: Record<string, DownloadNotebook[]>) {
		this.downloads = downloads;
	}
	async start() {
		this.stop();
		this.running = true;
		this.starts++;
	}
	stop() {
		this.running = false;
		for (const reject of this.waiting) reject(new Error('stopped'));
		this.waiting.clear();
	}
	private answer<T>(make: () => T): Promise<T> {
		if (!this.running) return Promise.reject(new Error('not running'));
		return new Promise<T>((resolve, reject) => {
			this.waiting.add(reject);
			setTimeout(() => {
				if (!this.waiting.delete(reject)) return;
				resolve(make());
			}, 5);
		});
	}
	open(input: string) {
		return this.answer(() => ({ notebooks: structuredClone(this.downloads[input] ?? []) }));
	}
	locked(input: string) {
		return this.answer(() => this.lockedPaths[input] ?? []);
	}
	close() {
		return this.answer(() => undefined);
	}
}

const DEFAULTS = { folder: 'T', boxMarkers: true, keepFontColor: true, imageAltText: false };

/** A table of contents of ours, with how far its import got (§11.5 item 47). */
const toc = (status: 'importing' | 'complete' | 'failed', name = 'Tides') => `---\ntitle: "${name}"\nonenote-import: ${status}\n---\n\n# ${name}\n`;

async function session(files: Record<string, string>, downloads: Record<string, DownloadNotebook[]>, options: { folders?: string[], folder?: string, locked?: Record<string, string[]>, failRead?: boolean } = {}) {
	const client = new FakeClient(downloads);
	client.lockedPaths = options.locked ?? {};
	const s = new ImportSession(fakeApp(files, options.folders, options.failRead), client as never, { ...DEFAULTS, folder: options.folder ?? 'T' }, 'zh-Hans');
	await s.add(Object.keys(downloads));
	await settled(s);
	return { s, client };
}

/** Waits until the target folder has been looked at and the password check is done. */
async function settled(s: InstanceType<typeof ImportSession>) {
	for (let i = 0; i < 200 && (s.checking || s.reading || s.downloads.some(d => d.state === 'ready' && !d.locked)); i++) await new Promise(r => setTimeout(r, 5));
}

const names = (s: InstanceType<typeof ImportSession>) => s.choices.map(choice => choice.notebook.name);
const states = (s: InstanceType<typeof ImportSession>, i = 0) => s.choices[i]!.notebook.sections.map(section => s.sectionState(s.choices[i]!, section));

test('every section is ticked at first; ticking by section and by notebook; counts follow', async () => {
	const { s } = await session({}, { a: [notebook('Tides', ['Spring', 'Summer', 'Autumn'])] });
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 3, unreadable: 0, bytes: 30 });
	assert.equal(s.allChosen, true);
	const [choice] = s.choices as [typeof s.choices[0]];
	s.setSections(choice, [choice.notebook.sections[1]!], false);
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 2, unreadable: 0, bytes: 20 });
	assert.equal(s.allChosen, false);
	s.setSections(choice, choice.notebook.sections, false);
	assert.deepEqual(s.included(), []);
	assert.equal(s.ready, false);
	s.selectAll(true);
	assert.equal(s.counts().sections, 3);
});

test('"Name (2)" only while both notebooks of one name are wanted', async () => {
	const { s } = await session({}, { a: [notebook('Samples B')], b: [notebook('Samples B')] });
	assert.deepEqual(names(s), ['Samples B', 'Samples B (2)']);
	s.setSections(s.choices[0]!, s.choices[0]!.notebook.sections, false);
	await settled(s);
	assert.deepEqual(names(s), ['Samples B', 'Samples B']);
	s.setSections(s.choices[0]!, s.choices[0]!.notebook.sections, true);
	await settled(s);
	assert.deepEqual(names(s), ['Samples B', 'Samples B (2)']);
});

test('a notebook imported before: its sections there are "imported", the rest can be added', async () => {
	const vault = {
		'T/Tides/_目录.md': toc('complete'),
		'T/Tides/Spring/_目录.md': toc('complete', 'Spring'),
		'T/Tides/Spring/Tide table.md': 'page',
		// A section that failed before: its contents page says so, so it may be imported again.
		'T/Tides/Summer/_目录.md': toc('failed', 'Summer'),
	};
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Summer', 'Autumn'])] });
	assert.deepEqual(states(s), ['imported', 'free', 'free']);
	assert.equal(s.choices[0]!.earlier?.language, 'zh-Hans');
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 2, unreadable: 0, bytes: 20 });
	assert.equal(s.ready, true);
});

test('what our contents pages say decides: cut off half way can be imported again; a folder without one of ours is never written into', async () => {
	const vault = {
		// Cut off while the notebook was written (Obsidian quit): its contents page still says importing.
		'T/Tides/_目录.md': toc('importing'),
		'T/Tides/Spring/_目录.md': toc('complete', 'Spring'),
		'T/Tides/Spring/Tide table.md': 'page',
		// Cut off inside Summer: its contents page went in first and says so.
		'T/Tides/Summer/_目录.md': toc('importing', 'Summer'),
		'T/Tides/Summer/Low water.md': 'page',
		// Autumn was imported, then the user removed its contents page and wrote in its page.
		'T/Tides/Autumn/Equinox.md': 'page, with the user\'s own lines',
		// Winter: the user's own folder of that name, with a note called like our contents page.
		'T/Tides/Winter/_目录.md': 'my own index',
		'T/Tides/Winter/Ice.md': 'mine',
		// Spring 2: an empty folder (as a section cut off before anything was written leaves it).
	}, folders = ['T/Tides/Spring 2'];
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Summer', 'Autumn', 'Winter', 'Spring 2'])] }, { folders });
	assert.ok(!s.choices[0]!.blocked);
	assert.deepEqual(states(s), ['imported', 'free', 'occupied', 'occupied', 'free']);
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 2, unreadable: 0, bytes: 20 });
});

test('a folder of the notebook\'s name holding a note called like our contents page is still not ours', async () => {
	const { s } = await session({ 'T/Tides/_目录.md': 'my own index of Tides', 'T/Tides/Plans.md': 'mine' }, { a: [notebook('Tides')] });
	assert.equal(s.choices[0]!.blocked, true);
	assert.equal(s.ready, false);
});

test('our folder spelled in another case: the same folder on disk, so it cannot go there, and the window says why', async () => {
	const { s } = await session({ 'T/tides/_目录.md': toc('complete', 'tides'), 'T/tides/A/_目录.md': toc('complete', 'A'), 'T/tides/A/P.md': 'p' }, { a: [notebook('Tides')] });
	assert.equal(s.choices[0]!.blocked, true);
	assert.equal(s.choices[0]!.otherSpelling, true);
});

test('a notebook all imported already takes no name from a newer download of it: the new sections go into its folder', async () => {
	const vault = { 'T/Tides/_目录.md': toc('complete'), 'T/Tides/Spring/_目录.md': toc('complete', 'Spring'), 'T/Tides/Spring/P.md': 'p' };
	// The older download has Spring only (all imported); the newer one adds Summer.
	const { s } = await session(vault, { old: [notebook('Tides', ['Spring'], 'Tides')], fresh: [notebook('Tides', ['Spring', 'Summer'], 'Tides')] });
	assert.deepEqual(names(s), ['Tides', 'Tides']);
	assert.deepEqual(states(s, 1), ['imported', 'free']);
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 1, unreadable: 0, bytes: 10 });
});

test('the target folder that cannot be read: the window says so and nothing starts', async () => {
	const { s } = await session({ 'T/Tides/_目录.md': toc('complete') }, { a: [notebook('Tides')] }, { failRead: true });
	assert.equal(s.checking, false);
	assert.ok(s.folderError);
	assert.equal(s.ready, false);
});

test('a download removed while password-protected sections are looked for: the next one is still looked at', async () => {
	const client = new FakeClient({ a: [notebook('Tides')], b: [notebook('Ferry log', ['Locked', 'Open'])] });
	client.lockedPaths = { b: ['Ferry log/Locked.one'] };
	const s = new ImportSession(fakeApp({}), client as never, DEFAULTS, 'zh-Hans');
	await s.add(['a', 'b']);
	// findLocked is looking at "a" now; "a" goes.
	s.remove(s.downloads[0]!);
	await settled(s);
	assert.deepEqual([...s.downloads[0]!.locked ?? []], ['Ferry log/Locked.one']);
	assert.deepEqual(states(s), ['locked', 'free']);
});

test('what decides is the folder, not the report: a report that says otherwise changes nothing', async () => {
	const report = JSON.stringify({
		format: 1,
		notebooks: [{ notebook: 'Tides', dir: 'Tides', language: 'en', importedAt: new Date().toISOString(), source: 'a', options: {}, sections: [
			// Says Autumn was converted (its folder is not there) and leaves out Spring (whose folder is).
			{ groups: [], section: 'Autumn', dir: 'Tides/Autumn', report: { pageCount: 1, attachments: 0, pages: [] } },
		] }],
	});
	const vault = { 'T/_转换报告.json': report, 'T/Tides/_目录.md': toc('complete'), 'T/Tides/Spring/_目录.md': toc('complete', 'Spring'), 'T/Tides/Spring/Page.md': 'page' };
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Autumn'])] });
	assert.deepEqual(states(s), ['imported', 'free']);
	// The language is the one of its contents page, not the report's.
	assert.equal(s.choices[0]!.earlier?.language, 'zh-Hans');
});

test('a folder of the same name that is not ours: the notebook cannot go there', async () => {
	const { s } = await session({ 'T/Tides/my own note.md': 'mine' }, { a: [notebook('Tides', ['Spring']), notebook('Ferry log')] });
	assert.equal(s.choices[0]!.blocked, true);
	assert.deepEqual(states(s), ['blocked']);
	assert.deepEqual(s.included().map(choice => choice.notebook.name), ['Ferry log']);
});

test('what the user unticked stays unticked in another target folder; what was imported there becomes free', async () => {
	const vault = { 'T/Tides/_目录.md': toc('complete'), 'T/Tides/Spring/_目录.md': toc('complete', 'Spring'), 'T/Tides/Spring/P.md': 'p' };
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Summer', 'Autumn'])] });
	const [choice] = s.choices as [typeof s.choices[0]];
	s.setSections(choice, [choice.notebook.sections[2]!], false);
	s.setFolder('Other');
	await settled(s);
	assert.deepEqual(states(s), ['free', 'free', 'free']);
	assert.deepEqual(choice.notebook.sections.map(section => s.isChosen(choice, section)), [true, true, false]);
});

test('password-protected and cut-off sections cannot be ticked', async () => {
	const tides = notebook('Tides', ['Spring', 'Summer']);
	tides.sections[1]!.incomplete = true;
	const { s } = await session({}, { a: [tides, notebook('Ferry log', ['Locked', 'Open'])] }, { locked: { a: ['Ferry log/Locked.one'] } });
	assert.deepEqual(states(s, 0), ['free', 'incomplete']);
	assert.deepEqual(states(s, 1), ['locked', 'free']);
	// They go along with their notebook (a page says why they were not converted), so they are counted too.
	assert.deepEqual(s.counts(), { notebooks: 2, sections: 4, unreadable: 2, bytes: 40 });
});

test('the target folder is matched as the disk matches it, and a part that starts with a dot is refused', async () => {
	const { s } = await session({ 'OneNote/Tides/_目录.md': toc('complete'), 'OneNote/Tides/A/_目录.md': toc('complete', 'A'), 'OneNote/Tides/A/P.md': 'p' }, { a: [notebook('Tides')] }, { folder: 'onenote' });
	assert.deepEqual(states(s), ['imported']);
	assert.equal(cleanFolder(' OneNote / 2026 / '), 'OneNote/2026');
	assert.equal(cleanFolder('/'), '');
	assert.equal(cleanFolder('a\\b'), 'a/b');
	assert.equal(cleanFolder('./a//./b'), 'a/b');
	assert.equal(folderProblem(cleanFolder('../outside')), true);
	assert.equal(folderProblem(cleanFolder('Notes/.hidden')), true);
	assert.equal(folderProblem(cleanFolder('Notes/v1.2')), false);
	s.setFolder(cleanFolder('../outside'));
	await settled(s);
	assert.equal(s.ready, false);
});

test('nothing changes once the window is closed or the import has started', async () => {
	const client = new FakeClient({ a: [notebook('Tides')], b: [notebook('Ferry log')] });
	const s = new ImportSession(fakeApp({}), client as never, DEFAULTS, 'en');
	const adding = s.add(['a', 'b']);
	s.dispose();
	await adding;
	await s.findLocked();
	assert.equal(client.running, false, 'no worker started again for a closed window');

	const started = await session({}, { a: [notebook('Tides')], c: [notebook('Tides')] });
	started.s.remove(started.s.downloads[1]!);
	started.s.phase = 'running';
	await started.s.add(['c']);
	assert.deepEqual(names(started.s), ['Tides']);
	started.s.selectAll(false);
	assert.equal(started.s.counts().sections, 1);
});
