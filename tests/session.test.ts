// The import window's state (src/plugin/session.ts), run in Node with a small stand-in for
// Obsidian (tests/support) and a pretend worker: ticking notebooks and sections, adding sections
// to a notebook imported before, folders that are not ours, the target folder, and what happens
// when the window is closed or the import has started. Notebooks are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { DownloadNotebook, DownloadSection } from '../src/core/download.ts';
import type { ScannedPage } from '../src/core/sync.ts';

register('./support/hooks.mjs', import.meta.url);
const { ImportSession } = await import('../src/plugin/session.ts');
const { cleanFolder, folderProblem } = await import('../src/plugin/settings.ts');
interface Node { name: string, path: string, parent: Node | null, children?: Node[] }
const { TFile, TFolder } = await import('./support/obsidian.mjs' as string) as {
	TFile: new (name: string, parent: Node) => Node,
	TFolder: new (name: string, parent: Node | null) => Node & { children: Node[] },
};

/**
 * A vault holding these files (and the folders above them) and these empty folders; a file's time
 * is its `modified` property, if any, unless `mtimes` gives another (the user edited it).
 */
function fakeApp(files: Record<string, string>, folders: string[] = [], failRead = false, mtimes: Record<string, number> = {}) {
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
		const file = new TFile(path.slice(cut + 1), parent) as Node & { stat?: { mtime: number, size: number } };
		const modified = /\nmodified: (\S+)\n/.exec(files[path]!)?.[1];
		file.stat = { mtime: mtimes[path] ?? (modified ? Date.parse(modified) : 0), size: files[path]!.length };
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
	/** Pages of each section by its path (none when not given), and sections whose reading fails. */
	pages: Record<string, ScannedPage[]> = {};
	failing = new Set<string>();
	scanned = 0;
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
				try {
					resolve(make());
				}
				catch (error) {
					reject(error as Error);
				}
			}, 5);
		});
	}
	open(input: string) {
		return this.answer(() => ({ notebooks: structuredClone(this.downloads[input] ?? []) }));
	}
	locked(input: string) {
		return this.answer(() => this.lockedPaths[input] ?? []);
	}
	scan(input: string, section: DownloadSection) {
		this.scanned++;
		return this.answer(() => {
			if (this.failing.has(section.path)) throw new Error('cannot parse');
			// By download and path (`input:path`), else by path.
			return structuredClone(this.pages[`${input}:${section.path}`] ?? this.pages[section.path] ?? []);
		});
	}
	close() {
		return this.answer(() => undefined);
	}
}

const DEFAULTS = { folder: 'T', boxMarkers: true, keepFontColor: true, imageAltText: false };

/** A table of contents of ours, with how far its import got (§11.5 item 47). */
const toc = (status: 'importing' | 'complete' | 'failed', name = 'Tides') => `---\ntitle: "${name}"\nonenote-import: ${status}\n---\n\n# ${name}\n`;

async function session(files: Record<string, string>, downloads: Record<string, DownloadNotebook[]>, options: { folders?: string[], folder?: string, locked?: Record<string, string[]>, failRead?: boolean, pages?: Record<string, ScannedPage[]>, failing?: string[], mtimes?: Record<string, number> } = {}) {
	const client = new FakeClient(downloads);
	client.lockedPaths = options.locked ?? {};
	client.pages = options.pages ?? {};
	client.failing = new Set(options.failing ?? []);
	const s = new ImportSession(fakeApp(files, options.folders, options.failRead, options.mtimes), client as never, { ...DEFAULTS, folder: options.folder ?? 'T' }, 'zh-Hans');
	await s.add(Object.keys(downloads));
	await settled(s);
	return { s, client };
}

/** Waits until the target folder has been looked at, the password check is done and updates compared. */
async function settled(s: InstanceType<typeof ImportSession>) {
	for (let i = 0; i < 400 && (s.checking || s.reading || s.checkingUpdates || s.downloads.some(d => d.state === 'ready' && !d.locked)); i++) await new Promise(r => setTimeout(r, 5));
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

test('a notebook imported before is updated: the section there is compared, one that failed is unfinished, the rest is new', async () => {
	const vault = {
		'T/Tides/_目录.md': toc('complete'),
		'T/Tides/Spring/_目录.md': toc('complete', 'Spring'),
		'T/Tides/Spring/Tide table.md': 'page',
		// A section that failed before: its contents page says so, so it is written again.
		'T/Tides/Summer/_目录.md': toc('failed', 'Summer'),
	};
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Summer', 'Autumn'])] });
	assert.deepEqual(states(s), ['same', 'unfinished', 'new']);
	assert.equal(s.choices[0]!.earlier?.language, 'zh-Hans');
	assert.equal(s.updating, true);
	assert.deepEqual(s.counts(), { notebooks: 0, sections: 0, unreadable: 0, bytes: 0 });
	assert.deepEqual(s.updateCounts(), { updated: 1, added: 1, restored: 0, bothEdited: 0 });
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
	assert.deepEqual(states(s), ['same', 'unfinished', 'occupied', 'occupied', 'new']);
	assert.deepEqual(s.updateCounts(), { updated: 1, added: 1, restored: 0, bothEdited: 0 });
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
	assert.deepEqual(states(s, 1), ['same', 'new']);
	assert.deepEqual(s.included().map(choice => choice.download.input), ['fresh']);
	assert.deepEqual(s.updateCounts(), { updated: 0, added: 1, restored: 0, bothEdited: 0 });
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

test('what decides is the folder: a section the report has and the folder does not is "no longer in the vault", unticked', async () => {
	const report = JSON.stringify({
		format: 1,
		notebooks: [{ notebook: 'Tides', dir: 'Tides', language: 'en', importedAt: new Date().toISOString(), source: 'a', options: {}, sections: [
			// Says Autumn was converted (its folder is not there) and leaves out Spring (whose folder is).
			{ groups: [], section: 'Autumn', dir: 'Tides/Autumn', report: { pageCount: 1, attachments: 0, pages: [] } },
		] }],
	});
	const vault = { 'T/_转换报告.json': report, 'T/Tides/_目录.md': toc('complete'), 'T/Tides/Spring/_目录.md': toc('complete', 'Spring'), 'T/Tides/Spring/Page.md': 'page' };
	const { s } = await session(vault, { a: [notebook('Tides', ['Spring', 'Autumn'])] });
	// Spring is there, though the report leaves it out; Autumn is not, though the report has it (§11.5 item 52.3).
	assert.deepEqual(states(s), ['same', 'missing']);
	assert.deepEqual(s.included(), []);
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
	assert.deepEqual(states(s), ['same']);
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

// Updates (§11.5 item 49): a notebook imported before, read again and compared with the vault.

const T1 = '2024-01-01T00:00:00.000Z', T2 = '2024-02-01T00:00:00.000Z';
/** A page as an import writes it (its properties), and as the download has it. */
const pageFile = (id: string, title: string, modified: string, order: number) =>
	`---\ntitle: ${JSON.stringify(title)}\nonenote-section: "S"\nonenote-order: ${order}\nonenote-level: 0\nmodified: ${modified}\nonenote-id: "${id}"\n---\n\ntext\n`;
const scanned = (id: string, title: string, modified: string): ScannedPage => ({ id, title, modified, level: 0 });
/** A section's contents page of ours listing its pages. */
const sectionToc = (name: string, titles: string[]) => `${toc('complete', name)}\n${titles.map(title => `- [${title}](<${title}.md>)`).join('\n')}\n`;

/** A notebook imported before: sections with pages, one the user deleted a page in, one the download no longer has; a report with a section left unticked and one imported that is not there now. */
function importedTides() {
	const report = JSON.stringify({
		format: 1,
		notebooks: [{ notebook: 'Tides', dir: 'Tides', language: 'zh-Hans', importedAt: new Date().toISOString(), source: 'a', options: {}, sections: [
			{ groups: [], section: 'Skipped', skipped: true },
			{ groups: [], section: 'Lost', dir: 'Tides/Lost', report: { pageCount: 1, attachments: 0, pages: [] } },
		] }],
	});
	const files = {
		'T/_转换报告.json': report,
		'T/Tides/_目录.md': toc('complete'),
		'T/Tides/Spring/_目录.md': sectionToc('Spring', ['One', 'Two']),
		'T/Tides/Spring/One.md': pageFile('{0A}', 'One', T1, 1),
		'T/Tides/Spring/Two.md': pageFile('{0B}', 'Two', T1, 2),
		'T/Tides/Summer/_目录.md': sectionToc('Summer', ['Sun']),
		'T/Tides/Summer/Sun.md': pageFile('{0C}', 'Sun', T1, 1),
		// Leaf was deleted in Obsidian: its contents page still lists it.
		'T/Tides/Autumn/_目录.md': sectionToc('Autumn', ['Leaf']),
		'T/Tides/Older/_目录.md': sectionToc('Older', ['Late']),
		'T/Tides/Older/Late.md': pageFile('{0E}', 'Late', T2, 1),
		'T/Tides/Winter/_目录.md': sectionToc('Winter', ['Ice']),
		'T/Tides/Winter/Ice.md': pageFile('{0F}', 'Ice', T1, 1),
	};
	const tides = notebook('Tides', ['Spring', 'Summer', 'Autumn', 'Older', 'Fresh', 'Skipped', 'Lost']);
	const pages = {
		// Two changed in OneNote.
		'Tides/Spring.one': [scanned('{0A}', 'One', T1), scanned('{0B}', 'Two', T2)],
		// Changed in OneNote, and edited in Obsidian since it was written.
		'Tides/Summer.one': [scanned('{0C}', 'Sun', T2)],
		'Tides/Autumn.one': [scanned('{0D}', 'Leaf', T1)],
		// Older in the download than in the vault.
		'Tides/Older.one': [scanned('{0E}', 'Late', T1)],
		'Tides/Fresh.one': [scanned('{10}', 'New', T1)],
		'Tides/Skipped.one': [scanned('{11}', 'Left', T1)],
		'Tides/Lost.one': [scanned('{12}', 'Gone', T1)],
	};
	return { files, tides, pages, mtimes: { 'T/Tides/Summer/Sun.md': Date.parse(T1) + 60_000 } };
}

test('a notebook imported before is read and compared: each section says what changed; changed, new and unfinished are ticked, the rest not', async () => {
	const { files, tides, pages, mtimes } = importedTides();
	const { s } = await session(files, { a: [tides] }, { pages, mtimes });
	assert.deepEqual(states(s), ['changed', 'changed', 'restorable', 'older', 'new', 'skipped', 'missing']);
	const [choice] = s.choices as [typeof s.choices[0]];
	assert.deepEqual(choice.notebook.sections.map(section => s.isChosen(choice, section)), [true, true, false, false, true, false, false]);
	assert.deepEqual(s.gone(choice).map(item => item.label), ['Winter']);
	assert.deepEqual(s.updateCounts(), { updated: 2, added: 1, restored: 0, bothEdited: 1 });
	assert.equal(s.ready, true);
	// Changed in OneNote and edited in Obsidian: said on the page.
	assert.deepEqual(s.itemOf(choice, choice.notebook.sections[1]!)!.modified.map(page => page.userEdited), [true]);
});

test('a page the user deleted comes back only when ticked; unticking its section takes it back out', async () => {
	const { files, tides, pages, mtimes } = importedTides();
	const { s } = await session(files, { a: [tides] }, { pages, mtimes });
	const [choice] = s.choices as [typeof s.choices[0]];
	const [spring, , autumn] = choice.notebook.sections as [DownloadSection, DownloadSection, DownloadSection];
	assert.deepEqual(s.deletedPages(choice, autumn).map(page => page.id), ['{0D}']);
	assert.equal(s.ticked(choice, autumn), false);
	s.setRestored(choice, autumn, '{0D}', true);
	assert.equal(s.isChosen(choice, autumn), true);
	assert.equal(s.ticked(choice, autumn), true);
	assert.equal(s.updateCounts().restored, 1);
	s.setSections(choice, [autumn], false);
	assert.equal(s.isRestored(choice, autumn, '{0D}'), false);
	assert.equal(s.updateCounts().restored, 0);
	// Ticking the section brings back all its deleted pages.
	s.setSections(choice, [autumn], true);
	assert.equal(s.isRestored(choice, autumn, '{0D}'), true);
	// Unticking a changed section: it is not updated.
	s.setSections(choice, [spring], false);
	assert.equal(s.updateCounts().updated, 1);
});

test('select all takes everything that can be ticked, including what is left unticked at first; deselect all takes nothing', async () => {
	const { files, tides, pages, mtimes } = importedTides();
	const { s } = await session(files, { a: [tides] }, { pages, mtimes });
	assert.equal(s.allChosen, false);
	s.selectAll(true);
	await settled(s);
	assert.equal(s.allChosen, true);
	assert.deepEqual(s.updateCounts(), { updated: 3, added: 3, restored: 1, bothEdited: 1 });
	s.selectAll(false);
	await settled(s);
	assert.deepEqual(s.included(), []);
	assert.equal(s.ready, false);
});

test('a new notebook next to one imported before is not ticked unasked; ticked, it is imported', async () => {
	const { files, tides, pages, mtimes } = importedTides();
	const { s } = await session(files, { a: [tides], b: [notebook('Ferry log', ['Deck'])] }, { pages, mtimes });
	assert.deepEqual(states(s, 1), ['free']);
	assert.equal(s.isChosen(s.choices[1]!, s.choices[1]!.notebook.sections[0]!), false);
	assert.deepEqual(s.counts(), { notebooks: 0, sections: 0, unreadable: 0, bytes: 0 });
	s.setSections(s.choices[1]!, s.choices[1]!.notebook.sections, true);
	await settled(s);
	assert.deepEqual(s.counts(), { notebooks: 1, sections: 1, unreadable: 0, bytes: 10 });
	assert.deepEqual(s.included().map(choice => choice.notebook.name), ['Tides', 'Ferry log']);
});

test('the vault\'s notebook of that name with no page in common is another notebook: nothing can be ticked', async () => {
	const files = { 'T/Tides/_目录.md': toc('complete'), 'T/Tides/Spring/_目录.md': sectionToc('Spring', ['One']), 'T/Tides/Spring/One.md': pageFile('{0A}', 'One', T1, 1) };
	const { s } = await session(files, { a: [notebook('Tides', ['Spring'])] }, { pages: { 'Tides/Spring.one': [scanned('{99}', 'Other', T1)] } });
	assert.deepEqual(states(s), ['different']);
	assert.deepEqual(s.included(), []);
});

test('a section that cannot be read is left as it is; sections are read once, whatever the target folder', async () => {
	const { files, tides, pages, mtimes } = importedTides();
	const { s, client } = await session(files, { a: [tides] }, { pages, mtimes, failing: ['Tides/Spring.one'] });
	assert.equal(states(s)[0], 'unreadable');
	assert.equal(s.isChosen(s.choices[0]!, s.choices[0]!.notebook.sections[0]!), false);
	const read = client.scanned;
	s.setFolder('Other');
	await settled(s);
	assert.equal(s.updating, false);
	s.setFolder('T');
	await settled(s);
	assert.equal(client.scanned, read);
	assert.equal(states(s)[1], 'changed');
});

test('a notebook named like the folders an update keeps its files in gets another name', async () => {
	const { s } = await session({}, { a: [notebook('_旧版本'), notebook('_sync log')] });
	assert.deepEqual(names(s), ['_旧版本 (2)', '_sync log (2)']);
});

test('two downloads of one notebook imported before: only the newer one updates it, the other is greyed, whatever the order or the folder typed meanwhile', async () => {
	const { files, mtimes } = importedTides();
	const spring = (time: string) => [scanned('{0A}', 'One', T1), scanned('{0B}', 'Two', time)];
	const T3 = '2024-03-01T00:00:00.000Z';
	for (const order of [['old', 'fresh'], ['fresh', 'old']]) {
		const tides = () => notebook('Tides', ['Spring']);
		const { s } = await session(files, Object.fromEntries(order.map(input => [input, [tides()]])), { mtimes, pages: { 'old:Tides/Spring.one': spring(T2), 'fresh:Tides/Spring.one': spring(T3) } });
		// Retyped while it compares: the names go back and forth.
		s.setFolder('Other');
		s.setFolder('T');
		await settled(s);
		const byInput = (input: string) => s.choices.find(choice => choice.download.input === input)!;
		assert.deepEqual(states(s, s.choices.indexOf(byInput('fresh'))), ['changed'], order.join());
		assert.deepEqual(states(s, s.choices.indexOf(byInput('old'))), ['duplicate'], order.join());
		assert.deepEqual(s.included().map(choice => choice.download.input), ['fresh'], order.join());
		assert.deepEqual(names(s), ['Tides', 'Tides'], order.join());
		s.selectAll(true);
		await settled(s);
		assert.deepEqual(s.included().map(choice => choice.download.input), ['fresh'], order.join());
	}
});

test('of two downloads of one notebook, the newer is told by the pages both have: a page the older one has and OneNote deleted since does not decide', async () => {
	const { files, mtimes } = importedTides();
	const T3 = '2024-03-01T00:00:00.000Z';
	const { s } = await session(files, { old: [notebook('Tides', ['Spring'])], fresh: [notebook('Tides', ['Spring'])] }, { mtimes, pages: {
		// The older download still has a page changed last of all, deleted in OneNote since.
		'old:Tides/Spring.one': [scanned('{0A}', 'One', T1), scanned('{0B}', 'Two', T1), scanned('{0C}', 'Late', T3)],
		'fresh:Tides/Spring.one': [scanned('{0A}', 'One', T1), scanned('{0B}', 'Two', T2)],
	} });
	assert.deepEqual(s.included().map(choice => choice.download.input), ['fresh']);
	assert.deepEqual(states(s, 0), ['duplicate']);
});

// OneDrive as a source (Internal-10 §22.1, §22.2): listed without downloading, downloaded when needed.

const { filesToFetch } = await import('../src/plugin/session.ts');

/** A OneDrive account with made-up notebooks: what is copied is recorded, nothing is downloaded. */
function fakeOneDrive(notebooks: { id: string, name: string, files: string[] }[], failing: string[] = []) {
	const copies: { notebook: string, only?: string[] }[] = [];
	const filesOf = (id: string) => notebooks.find(n => n.id === id)!.files.map((path, i) => ({ id: `${id}-${i}`, path, size: 10, eTag: '"1"' }));
	const access = {
		root: async () => '/copy',
		notebooks: async () => notebooks.map(n => ({ id: n.id, name: n.name, folder: '文档' })),
		files: async (id: string) => filesOf(id),
		copy: async (notebook: { name: string }, files: { path: string, id: string }[], only?: ReadonlySet<string>) => {
			copies.push({ notebook: notebook.name, only: only ? [...only].sort() : undefined });
			const failed = files.filter(file => failing.includes(file.path) && (!only || only.has(file.id))).map(file => ({ path: file.path, problem: 'unreachable' as const, detail: 'offline' }));
			return { folder: '', downloaded: 0, bytes: 0, moved: 0, removed: 0, same: 0, failed, plan: { download: [], move: [], remove: [], same: [] } };
		},
	};
	return { access, copies };
}

async function oneDriveSession(files: Record<string, string>, drive: ReturnType<typeof fakeOneDrive>, pages: Record<string, ScannedPage[]> = {}) {
	const client = new FakeClient({});
	client.pages = pages;
	const s = new ImportSession(fakeApp(files), client as never, DEFAULTS, 'zh-Hans');
	await s.addOneDrive(drive.access as never);
	await settled(s);
	return { s, client };
}

test('OneDrive: notebooks and sections are listed from OneDrive, none ticked, nothing downloaded', async () => {
	const drive = fakeOneDrive([
		{ id: 'n2', name: 'Tides', files: ['Spring.one', 'Open Notebook.onetoc2', 'Group/Summer.one', 'Group/Open Notebook.onetoc2'] },
		{ id: 'n1', name: 'Atlas', files: ['A.one'] },
		{ id: 'n3', name: 'Tides', files: ['X.one'] },
		{ id: 'n4', name: 'Empty', files: [] },
	]);
	const { s } = await oneDriveSession({}, drive);
	assert.equal(s.downloads[0]!.name, 'OneDrive');
	assert.equal(s.downloads[0]!.input, '/copy');
	assert.deepEqual(names(s), ['Atlas', 'Tides', 'Tides']);
	const tides = s.choices[1]!;
	assert.deepEqual(tides.notebook.sections.map(section => [section.groups.join('/'), section.label, section.path]), [['', 'Spring', 'n2/Tides/Spring.one'], ['Group', 'Summer', 'n2/Tides/Group/Summer.one']]);
	assert.deepEqual(s.included(), []);
	assert.deepEqual(drive.copies, []);
	// Ticked, two notebooks of one name are told apart, as with downloads.
	s.selectAll(true);
	await settled(s);
	assert.deepEqual(names(s), ['Atlas', 'Tides', 'Tides (2)']);
	assert.equal(s.counts().sections, 4);
	assert.deepEqual(drive.copies, [], 'ticking downloads nothing');
});

test('OneDrive: a notebook imported before is brought up to date whole before it is read; a section that could not be downloaded is not read from the copy', async () => {
	const { files, pages } = importedTides();
	const sections = ['Spring', 'Summer', 'Autumn', 'Older', 'Fresh', 'Skipped', 'Lost'];
	const drive = fakeOneDrive([{ id: 'n1', name: 'Tides', files: [...sections.map(name => `${name}.one`), 'Open Notebook.onetoc2'] }], ['Summer.one']);
	const oneDrivePages = Object.fromEntries(Object.entries(pages).map(([path, list]) => [`n1/${path}`, list]));
	const { s, client } = await oneDriveSession(files, drive, oneDrivePages);
	assert.deepEqual(drive.copies, [{ notebook: 'Tides', only: undefined }], 'the whole notebook, once');
	// Sections come sorted by name, as from a downloaded folder.
	const [choice] = s.choices as [typeof s.choices[0]];
	const byLabel = Object.fromEntries(choice.notebook.sections.map(section => [section.label, [s.sectionState(choice, section), s.isChosen(choice, section)]]));
	assert.deepEqual(byLabel, {
		Spring: ['changed', true], Summer: ['unreadable', false], Autumn: ['restorable', false], Older: ['older', false],
		Fresh: ['new', true], Skipped: ['skipped', false], Lost: ['missing', false],
	});
	assert.equal(client.scanned, 6, 'the section not downloaded is not read');
});

test('OneDrive: stopped while downloading, the result says what came down is kept (a stop is no failure)', async () => {
	const drive = fakeOneDrive([{ id: 'n1', name: 'Atlas', files: ['A.one', 'B.one'] }, { id: 'n2', name: 'Tides', files: ['C.one'] }]);
	const { s } = await oneDriveSession({}, drive);
	let copies = 0;
	// The first notebook's download is under way when the stop comes, and ends as a cancelled one does.
	(drive.access as any).copy = async (_notebook: unknown, _files: unknown, _only: unknown, signal: AbortSignal, onProgress?: (progress: object) => void) => {
		copies++;
		onProgress?.({ files: 0, totalFiles: 1, sections: 0, totalSections: 1, bytes: 5, totalBytes: 10 });
		s.requestStop();
		await new Promise((_resolve, reject) => {
			if (signal.aborted) reject(new Error('cancelled'));
			else signal.addEventListener('abort', () => reject(new Error('cancelled')));
		});
	};
	const going = new Set(s.choices.flatMap(choice => choice.notebook.sections));
	await (s as any).fetchChosen(s.choices, going);
	assert.equal(copies, 1, 'the next notebook is not begun');
	assert.equal(s.downloadsCut, true);
	assert.equal(s.downloading, undefined);
	assert.equal(s.notDownloaded, 0);
});

test('OneDrive: an import downloads the chosen sections and every table of contents, nothing else', () => {
	const files = ['Spring.one', 'Open Notebook.onetoc2', 'Group/Summer.one', 'Group/Open Notebook.onetoc2', 'Autumn.one'].map((path, i) => ({ id: `f${i}`, path, size: 1, eTag: '"1"' }));
	assert.deepEqual([...filesToFetch('n1/Tides', files, ['n1/Tides/Group/Summer.one'])].sort(), ['f1', 'f2', 'f3']);
});

test('OneDrive: the list kept from last time shows at once; OneDrive\'s answer then adds, removes and updates notebooks, keeping ticks', async () => {
	const remote = (id: string, name: string) => ({ id, name, folder: '文档' });
	const file = (id: string, path: string) => ({ id, path, size: 10, eTag: '"1"' });
	let release!: () => void;
	const asked = new Promise<void>(resolve => release = resolve);
	const kept: unknown[] = [];
	const access = {
		root: async () => '/copy',
		kept: async () => ({ root: '/copy', notebooks: [
			{ notebook: remote('a', 'Atlas'), files: [file('a1', 'One.one')] },
			{ notebook: remote('b', 'Bygone'), files: [file('b1', 'Old.one')] },
		] }),
		keep: async (_root: string, notebooks: unknown[]) => void kept.push(notebooks),
		notebooks: async () => {
			await asked;
			return [remote('a', 'Atlas'), remote('c', 'Cove')];
		},
		files: async (id: string) => id === 'a' ? [file('a1', 'One.one'), file('a2', 'Two.one')] : [file('c1', 'Bay.one')],
		copy: async () => assert.fail('nothing is downloaded'),
	};
	const client = new FakeClient({});
	const s = new ImportSession(fakeApp({}), client as never, DEFAULTS, 'zh-Hans');
	const adding = s.addOneDrive(access as never);
	await new Promise(r => setTimeout(r, 20));
	// Last time's list, at once: tickable, but nothing can start before OneDrive has answered.
	assert.deepEqual(names(s), ['Atlas', 'Bygone']);
	assert.equal(s.downloads[0]!.onedrive!.refreshing, true);
	s.setSections(s.choices[0]!, s.choices[0]!.notebook.sections, true);
	assert.equal(s.ready, false);
	release();
	await adding;
	await settled(s);
	assert.deepEqual(names(s), ['Atlas', 'Cove']);
	const atlas = s.choices[0]!;
	assert.deepEqual(atlas.notebook.sections.map(section => [section.label, s.isChosen(atlas, section)]), [['One', true], ['Two', false]]);
	assert.equal(s.ready, true);
	assert.equal(kept.length, 1, 'the new list is kept for next time');
});
