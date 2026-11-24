// Finding notebooks in a download, and converting them: sections in order, failures, password
// protection, cancelling. Notebooks, sections and text are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNotebooks, renameNotebook } from '../src/core/download.ts';
import type { DownloadFile, DownloadSection } from '../src/core/download.ts';
import { earlierNotebook, importNotebooks, scanNotebook } from '../src/core/importer.ts';
import type { ImportHost } from '../src/core/importer.ts';
import { zhHans } from '../src/core/strings.ts';
import { notebookToc } from '../src/core/write.ts';
import { element, memorySink, outline, pageJson, rich, run, sectionJson } from './helpers.ts';

const files = (...paths: string[]): DownloadFile[] => paths.map(path => ({ path, size: 1 }));
const layout = (notebooks: ReturnType<typeof findNotebooks>) => notebooks.map(n => [n.name, n.path, n.sections.map(s => [...s.groups, s.label].join('/'))]);

test('a folder of notebooks: sections by name, then section groups; the recycle bin and hidden folders left out', () => {
	const download = files(
		'Ferry log/Open Notebook.onetoc2', 'Ferry log/b.one', 'Ferry log/A.one',
		'Ferry log/Piers/Open Notebook.onetoc2', 'Ferry log/Piers/North.one', 'Ferry log/Piers/Old/West.one',
		'Ferry log/OneNote_RecycleBin/OneNote_DeletedPages.one', 'Ferry log/.cache/x.one',
		'Tides/Open Notebook.onetoc2', 'Tides/Spring.one',
	);
	assert.deepEqual(layout(findNotebooks(download, 'Documents')), [
		['Ferry log', 'Ferry log', ['A', 'b', 'Piers/North', 'Piers/Old/West']],
		['Tides', 'Tides', ['Spring']],
	]);
});

test('a zip of the Documents folder gives the same notebooks as the folder; a download that is one notebook is named after it', () => {
	const inner = ['Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one', 'Tides/Open Notebook.onetoc2', 'Tides/Spring.one'];
	const unzipped = layout(findNotebooks(files(...inner), 'Documents')).map(([name, , sections]) => [name, sections]);
	const zipped = layout(findNotebooks(files(...inner.map(path => `Documents/${path}`)), 'Documents')).map(([name, , sections]) => [name, sections]);
	assert.deepEqual(zipped, unzipped);
	assert.deepEqual(layout(findNotebooks(files('Open Notebook.onetoc2', 'A.one'), 'Ferry log')), [['Ferry log', '', ['A']]]);
	// Only section groups, no section of its own: its table of contents still marks it a notebook.
	assert.deepEqual(layout(findNotebooks(files('Docs/Ferry log/Open Notebook.onetoc2', 'Docs/Ferry log/Piers/North.one'), 'Docs')), [['Ferry log', 'Docs/Ferry log', ['Piers/North']]]);
});

const page = (title: string, text: string) => pageJson(title, [outline([element([rich([run(text)])])])]);

function host(behaviour: Record<string, 'ok' | 'fail' | 'locked'>, cancelAfter?: number) {
	const sink = memorySink();
	const seen: string[] = [];
	let converted = 0;
	const h: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			seen.push(section.path);
			const kind = behaviour[section.label] ?? 'ok';
			if (kind !== 'ok') throw new Error('PARSE_ERROR: invented failure');
			return { json: sectionJson(section.label, [page(`${section.label} page`, 'invented text')]), source: { async readAsset() { throw new Error('no assets'); } }, release() {} };
		},
		async isPasswordProtected(section) {
			return behaviour[section.label] === 'locked';
		},
		async listFolders() {
			return [...new Set([...sink.files.keys()].map(path => path.split('/')[0]))];
		},
		isCancelled: () => cancelAfter !== undefined && converted >= cancelAfter,
		onSectionDone() {
			converted++;
		},
	};
	return { host: h, sink, seen };
}

const NOTEBOOKS = () => findNotebooks(files(
	'Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one', 'Ferry log/B.one', 'Ferry log/C.one',
	'Tides/Open Notebook.onetoc2', 'Tides/Spring.one',
), 'Documents');
const OPTIONS = { languageFor: () => 'zh-Hans' as const, boxMarkers: true, keepFontColor: true, links: true };

test('every section is converted in order; a failure and a password-protected section get a page that says why', async () => {
	const { host: h, sink, seen } = host({ B: 'fail', C: 'locked' });
	const result = await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	assert.deepEqual(seen, ['Ferry log/A.one', 'Ferry log/B.one', 'Ferry log/C.one', 'Tides/Spring.one']);
	assert.equal(result.cancelled, false);
	assert.deepEqual(result.notebooks[0].sections.map(s => [s.section, !!s.failed, !!s.locked]), [['A', false, false], ['B', true, false], ['C', true, true]]);
	const toc = sink.files.get('Ferry log/_目录.md') as string;
	assert.match(toc, /- \[B\]\(<B\/_目录\.md>\)（转换失败）/);
	assert.match(toc, /- \[C\]\(<C\/_目录\.md>\)（有密码保护，未转换）/);
	assert.match(sink.files.get('Ferry log/C/_目录.md') as string, /这个分区设了密码/);
	assert.ok(sink.files.has('Tides/Spring/Spring page.md'));
});

test('cancelling stops between sections: what was written is whole, the rest is listed as not converted', async () => {
	const { host: h, sink, seen } = host({}, 1);
	const result = await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	assert.equal(result.cancelled, true);
	assert.deepEqual(seen, ['Ferry log/A.one']);
	const toc = sink.files.get('Ferry log/_目录.md') as string;
	assert.match(toc, /- \[A\]\(<A\/_目录\.md>\)\n/);
	assert.match(toc, /- B（未转换：导入已取消）\n- C（未转换：导入已取消）\n/);
	assert.ok(![...sink.files.keys()].some(path => path.startsWith('Tides/')), 'the next notebook is not started');
	assert.deepEqual(result.notStarted, [{ notebook: 'Tides', sections: 1 }]);
});

test('each notebook gets the marks of its own language', async () => {
	const { host: h, sink } = host({});
	await importNotebooks(NOTEBOOKS(), h, { ...OPTIONS, languageFor: notebook => (notebook.name === 'Tides' ? 'en' : 'zh-Hans') });
	assert.ok(sink.files.has('Ferry log/_目录.md'));
	assert.ok(sink.files.has('Tides/_contents.md'));
	assert.ok(sink.files.has('Tides/Spring/_contents.md'));
});

test('a failed section\'s page carries the parser\'s message', async () => {
	const { host: h, sink } = host({ B: 'fail' });
	await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	assert.match(sink.files.get('Ferry log/B/_目录.md') as string, /这个分区没能转换。解析器报告：PARSE_ERROR: invented failure/);
});

test('a password check that cannot be read leaves the section failed, and the import goes on', async () => {
	const { host: h, sink } = host({ B: 'fail' });
	h.isPasswordProtected = async () => {
		throw new Error('cannot read the section either');
	};
	const result = await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	assert.deepEqual(result.notebooks[0].sections.map(s => [s.section, !!s.failed, !!s.locked]), [['A', false, false], ['B', true, false], ['C', false, false]]);
	assert.ok(sink.files.has('Tides/Spring/Spring page.md'));
});

test('a section the download stopped inside is not parsed; its page says to download again', async () => {
	const { host: h, sink, seen } = host({});
	const notebooks = findNotebooks([...files('Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one'), { path: 'Ferry log/B.one', size: 0, incomplete: true }], 'Documents');
	const result = await importNotebooks(notebooks, h, OPTIONS);
	assert.deepEqual(seen, ['Ferry log/A.one']);
	assert.equal(result.notebooks[0].sections[1].failed, true);
	assert.equal(result.notebooks[0].sections[1].incomplete, true);
	// OneDrive downloads the folder that holds the notebooks, never one notebook (decision 41).
	const toc = sink.files.get('Ferry log/B/_目录.md') as string;
	assert.match(toc, /这个分区没有下载完整，请重新下载。/);
	assert.doesNotMatch(toc, /这本笔记本/);
});

test('every parsed section is released, and progress counts the sections', async () => {
	const { host: h } = host({ B: 'fail' });
	const released: string[] = [];
	const parse = h.parse;
	h.parse = async section => {
		const parsed = await parse(section);
		return { ...parsed, release: () => released.push(section.label) };
	};
	const progress: string[] = [];
	h.onProgress = p => progress.push(`${p.done}/${p.total} ${p.section.label}`);
	await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	// B cannot be parsed, so there is nothing to release for it.
	assert.deepEqual(released, ['A', 'C', 'Spring']);
	assert.deepEqual(progress, ['0/4 A', '1/4 B', '2/4 C', '3/4 Spring']);
});

test('cancelled sections are listed as text that cannot turn into Markdown structure', () => {
	const toc = notebookToc('NB', [{ groups: [], section: '# Notes', cancelled: true }, { groups: ['G'], section: '1. Intro', cancelled: true }], zhHans);
	assert.match(toc, /^- \\# Notes（未转换：导入已取消）$/m);
	assert.match(toc, /^\t- 1\\\. Intro（未转换：导入已取消）$/m);
});

test('the preview scan: pages, attachments, password-protected, failed and cut-off sections, and the language', async () => {
	const { host: h } = host({ B: 'fail', C: 'locked' });
	const withPicture = sectionJson('A', [
		pageJson('渡し場の時刻表', [outline([element([rich([run('毎日の出航時間と桟橋の場所を書いておきます。')])])])]),
		pageJson('二枚目', [{ type: 'image', asset: { asset: 'aa.png', size: 300 }, x: null, y: null, w: null }, { type: 'image', asset: { asset: 'aa.png', size: 300 }, x: null, y: null, w: null }, { type: 'file', asset: { asset: 'bb.pdf', size: 700 }, fileName: 'x.pdf', x: null, y: null, w: null }]),
	]);
	const parse = h.parse;
	h.parse = async section => (section.label === 'A' ? { json: withPicture, source: { async readAsset() { return new Uint8Array(); } }, release() {} } : parse(section));
	const notebook = findNotebooks([...files('Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one', 'Ferry log/B.one', 'Ferry log/C.one'), { path: 'Ferry log/D.one', size: 0, incomplete: true }], 'Documents')[0];
	const scan = await scanNotebook(notebook, h);
	assert.deepEqual(scan.sections.map(s => [s.section.label, s.pages, s.attachments, s.attachmentBytes, !!s.locked, !!s.error, !!s.incomplete]), [
		['A', 2, 2, 1000, false, false, false],
		['B', undefined, undefined, undefined, false, true, false],
		['C', undefined, undefined, undefined, true, false, false],
		['D', undefined, undefined, undefined, false, false, true],
	]);
	assert.equal(scan.language, 'ja');
	let calls = 0;
	const stopping = await scanNotebook(notebook, { ...h, isCancelled: () => calls++ >= 1 });
	assert.equal(stopping.sections.length, 1, 'stops when cancelled');
});

test('downloads: what macOS adds to a zip is left out; notebooks of one name are told apart', () => {
	assert.deepEqual(layout(findNotebooks(files(
		'Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one', 'Ferry log/._A.one',
		'__MACOSX/Ferry log/._A.one', '__MACOSX/Ferry log/._Open Notebook.onetoc2',
	), 'Documents')), [['Ferry log', 'Ferry log', ['A']]]);
	const twins = findNotebooks(files('School/Notes/Open Notebook.onetoc2', 'School/Notes/A.one', 'Work/Notes/Open Notebook.onetoc2', 'Work/Notes/B.one'), 'Docs');
	assert.deepEqual(layout(twins), [['Notes', 'School/Notes', ['A']], ['Notes (2)', 'Work/Notes', ['B']]]);
	assert.equal(twins[1].sections[0].notebook, 'Notes (2)');
});

test('sections can be converted elsewhere (the plugin\'s worker), given the section\'s folder and language', async () => {
	const { host: h, sink } = host({});
	const asked: string[] = [];
	h.convertSection = async (section, dir, language, options) => {
		asked.push(`${section.label} ${dir} ${language} ${options.boxMarkers}`);
		return { groups: section.groups, section: section.label };
	};
	await importNotebooks(NOTEBOOKS(), h, { ...OPTIONS, languageFor: notebook => (notebook.name === 'Tides' ? 'ja' : 'zh-Hans') });
	assert.deepEqual(asked, ['A Ferry log/A zh-Hans true', 'B Ferry log/B zh-Hans true', 'C Ferry log/C zh-Hans true', 'Spring Tides/Spring ja true']);
	assert.ok(sink.files.has('Tides/_目次.md'));
});

// Links between pages: a page "Index" links to the page "Tomato" of its section by page id.
const TOMATO = '{AAAAAAAA-0000-0000-0000-000000000001}';
const linkingSection = (notebook: string, label: string) => sectionJson(label, [
	pageJson('Tomato', [outline([element([rich([run('invented soup')])])])], { id: TOMATO }),
	pageJson('Index', [outline([element([rich([run('Tomato', { link: true, href: `onenote:https://x.example/${notebook}/${label}.one#Tomato&section-id={BBBBBBBB-0000-0000-0000-000000000002}&page-id=${TOMATO}&end` })])])])], { id: '{CCCCCCCC-0000-0000-0000-000000000003}' }),
]);

function linkingHost(sink = memorySink()) {
	const read: string[] = [];
	const readText = sink.readText.bind(sink);
	sink.readText = async path => {
		read.push(path);
		return readText(path);
	};
	const h: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			return { json: linkingSection(section.notebook, section.label), source: { async readAsset() { throw new Error('no assets'); } }, release() {} };
		},
		async isPasswordProtected() {
			return false;
		},
		async listFolders() {
			return [...new Set([...sink.files.keys()].map(path => path.split('/')[0]!))];
		},
	};
	return { host: h, sink, read };
}

test('a notebook whose name starts with "_" gets its links fixed like any other', async () => {
	const { host: h, sink } = linkingHost();
	await importNotebooks(findNotebooks(files('_Inbox/Open Notebook.onetoc2', '_Inbox/Soups.one'), 'Documents'), h, OPTIONS);
	assert.match(sink.files.get('_Inbox/Soups/Index.md') as string, /\[Tomato\]\(<Tomato\.md>\)/);
});

test('folders that are not notebooks (the user\'s own notes beside them) are never read', async () => {
	const { host: h, sink, read } = linkingHost();
	await sink.writeText('Diary/today.md', `---\nonenote-id: "${TOMATO}"\n---\n\ninvented diary\n`);
	await importNotebooks(findNotebooks(files('Recipes/Open Notebook.onetoc2', 'Recipes/Soups.one'), 'Documents'), h, OPTIONS);
	// Only whether it has a contents page of ours is looked up: none of its notes is read.
	assert.deepEqual(read.filter(path => path.startsWith('Diary/') && !/^Diary\/_[^/]+\.md$/.test(path)), []);
	assert.match(sink.files.get('Recipes/Soups/Index.md') as string, /\[Tomato\]\(<Tomato\.md>\)/);
});

test('a notebook imported again under another name links into itself, and keeps its OneNote name', async () => {
	const { host: h, sink } = linkingHost();
	const download = () => findNotebooks(files('Recipes/Open Notebook.onetoc2', 'Recipes/Soups.one'), 'Documents');
	await importNotebooks(download(), h, OPTIONS);
	const copy = download();
	renameNotebook(copy[0]!, 'Recipes (2)');
	const result = await importNotebooks(copy, h, OPTIONS);
	assert.equal(result.notebooks[0]!.originalName, 'Recipes');
	const index = sink.files.get('Recipes (2)/Soups/Index.md') as string;
	assert.match(index, /\[Tomato\]\(<Tomato\.md>\)/);
	assert.doesNotMatch(index, /\.\.\/\.\.\/Recipes\//);
});

test('only the sections chosen are converted; the others are listed as not imported', async () => {
	const { host: h, sink, seen } = host({});
	const progress: number[] = [];
	h.onProgress = p => progress.push(p.total);
	const result = await importNotebooks(NOTEBOOKS().slice(0, 1), h, { ...OPTIONS, chosen: section => section.label !== 'B' });
	assert.deepEqual(seen, ['Ferry log/A.one', 'Ferry log/C.one']);
	assert.deepEqual(progress, [2, 2]);
	assert.deepEqual(result.notebooks[0]!.sections.map(s => [s.section, !!s.skipped]), [['A', false], ['B', true], ['C', false]]);
	const toc = sink.files.get('Ferry log/_目录.md') as string;
	assert.match(toc, /- B（未导入）\n/);
	assert.match(toc, /- \[A\]\(<A\/_目录\.md>\)\n/);
	assert.ok(!sink.files.has('Ferry log/B/_目录.md'));
});

test('sections are added to a notebook imported before; what is there is never written again', async () => {
	const { host: h, sink, seen } = host({});
	const ferry = () => NOTEBOOKS().slice(0, 1);
	await importNotebooks(ferry(), h, { ...OPTIONS, chosen: section => section.label === 'A' });
	const pageA = sink.files.get('Ferry log/A/A page.md');
	sink.files.set('Ferry log/A/A page.md', `${pageA}\nThe user's own line.\n`);
	const earlier = await earlierNotebook(sink, 'Ferry log', ferry()[0]!);
	assert.deepEqual([...earlier!.sections.keys()], ['A']);
	assert.equal(earlier!.language, 'zh-Hans');
	seen.length = 0;
	const result = await importNotebooks(ferry(), h, { ...OPTIONS, languageFor: () => 'en', chosen: section => section.label === 'B', earlier: () => earlier });
	assert.deepEqual(seen, ['Ferry log/B.one']);
	assert.match(sink.files.get('Ferry log/A/A page.md') as string, /The user's own line\./);
	// Still in the notebook's language (Chinese), not the one asked for this time.
	assert.ok(sink.files.has('Ferry log/B/_目录.md'));
	const toc = sink.files.get('Ferry log/_目录.md') as string;
	assert.match(toc, /- \[A\]\(<A\/_目录\.md>\)\n- \[B\]\(<B\/_目录\.md>\)\n- C（未导入）\n/);
	assert.deepEqual(result.notebooks[0]!.sections.map(s => [s.section, !!s.earlier, !!s.skipped]), [['A', true, false], ['B', false, false], ['C', false, true]]);
});

test('a notebook has its contents page before its first section; a section cut off while it was written (no contents page of its own) may be imported again', async () => {
	const { host: h, sink } = host({});
	let atFirstSection: string | undefined;
	const parse = h.parse;
	h.parse = async section => {
		atFirstSection ??= sink.files.get('Ferry log/_目录.md') as string;
		return parse(section);
	};
	await importNotebooks(NOTEBOOKS().slice(0, 1), h, OPTIONS);
	assert.match(atFirstSection!, /onenote-import: importing\n[^]*- A（未导入）\n- B（未导入）\n- C（未导入）\n/);
	const toc = sink.files.get('Ferry log/_目录.md') as string;
	assert.match(toc, /onenote-import: complete\n/);
	assert.match(toc, /- \[A\]\(<A\/_目录\.md>\)\n- \[B\]\(<B\/_目录\.md>\)\n- \[C\]\(<C\/_目录\.md>\)\n/);
	// Cut off inside B (Obsidian quit): its contents page, written first, still says so.
	sink.files.set('Ferry log/B/_目录.md', ours('importing', 'B'));
	// C was imported, then the user removed its contents page: not ours any more, never written into.
	sink.files.delete('Ferry log/C/_目录.md');
	const earlier = await earlierNotebook(sink, 'Ferry log', NOTEBOOKS()[0]!);
	assert.deepEqual([...earlier!.sections.keys()], ['A']);
	assert.deepEqual([...earlier!.occupied], ['C']);
	// Adding to it: B is written again, C is not touched although it is chosen.
	sink.files.set('Ferry log/C/C page.md', 'the user\'s own words');
	const { host: again, seen } = host({});
	(again as { sink: unknown }).sink = sink;
	const result = await importNotebooks(NOTEBOOKS().slice(0, 1), again, { ...OPTIONS, earlier: () => earlier });
	assert.deepEqual(seen, ['Ferry log/B.one']);
	assert.equal(sink.files.get('Ferry log/C/C page.md'), 'the user\'s own words');
	assert.deepEqual(result.notebooks[0]!.sections.map(s => [s.section, !!s.earlier, !!s.skipped]), [['A', true, false], ['B', false, false], ['C', false, true]]);
});

test('links within a notebook are rewritten as its sections are written; the rest wait for the end, which gives the same pages', async () => {
	const A1 = '{AAAAAAAA-0000-0000-0000-0000000000A1}', B1 = '{BBBBBBBB-0000-0000-0000-0000000000B1}';
	const linkTo = (id: string, text: string) => rich([run(text, { link: true, href: `onenote:https://x.example/Ferry%20log/X.one#t&section-id={DDDDDDDD-0000-0000-0000-000000000001}&page-id=${id}&end` })]);
	const sink = memorySink();
	const snapshots: (string | undefined)[] = [];
	const h: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			const pages = section.label === 'A'
				? [pageJson('Index', [outline([element([linkTo(B1, 'to target')])])], { id: A1 })]
				: [pageJson('Target', [outline([element([linkTo(A1, 'back')])])], { id: B1 })];
			return { json: sectionJson(section.label, pages), source: { async readAsset() { throw new Error('no assets'); } }, release() {} };
		},
		async isPasswordProtected() {
			return false;
		},
		async listFolders() {
			return [...new Set([...sink.files.keys()].map(path => path.split('/')[0]!))];
		},
		async checkpoint() {
			snapshots.push(sink.files.get('Ferry log/A/Index.md') as string | undefined);
		},
	};
	const result = await importNotebooks(findNotebooks(files('Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one', 'Ferry log/B.one'), 'Documents'), h, OPTIONS);
	// After A: its link to B waits; after B, both links are rewritten already (before the pass at the end).
	assert.match(snapshots[0]!, /\(onenote:/);
	assert.match(snapshots[1]!, /\[to target\]\(<\.\.\/B\/Target\.md>\)/);
	assert.match(sink.files.get('Ferry log/B/Target.md') as string, /\[back\]\(<\.\.\/A\/Index\.md>\)/);
	assert.deepEqual({ ...result.links, unresolvedTargets: undefined }, { links: 2, resolved: 2, unresolved: 0, filesChanged: 2, unresolvedTargets: undefined });
});

test('two sections whose names give one folder, or a section named like a group, each keep a folder of their own', async () => {
	const { host: h, sink } = host({});
	const download = findNotebooks(files('NB/Open Notebook.onetoc2', 'NB/Plan.one', 'NB/plan.one', 'NB/G.one', 'NB/G/Inner.one'), 'Documents');
	await importNotebooks(download, h, OPTIONS);
	const folders = [...new Set([...sink.files.keys()].filter(path => path.endsWith('/_目录.md')).map(path => path.slice(0, -'/_目录.md'.length)))].sort();
	// The download lists "plan" before "Plan"; a section group's folder has no contents page of its own.
	assert.deepEqual(folders, ['NB', 'NB/G (2)', 'NB/G/Inner', 'NB/Plan (2)', 'NB/plan'].sort());
	const toc = sink.files.get('NB/_目录.md') as string;
	assert.match(toc, /\[G\]\(<G \(2\)\/_目录\.md>\)/);
	assert.match(toc, /\[Plan\]\(<Plan \(2\)\/_目录\.md>\)/);
});

const ours = (status: string, name: string) => `---\ntitle: "${name} 目录"\nonenote-import: ${status}\n---\n\n# ${name}\n`;

test('earlier sections: one that failed may be imported again; sections the download no longer has stay listed, by their own names', async () => {
	const sink = memorySink();
	await sink.writeText('Ferry log/_目录.md', ours('complete', 'Ferry log'));
	await sink.writeText('Ferry log/A/_目录.md', ours('failed', 'A'));
	await sink.writeText('Ferry log/Old/Gone： now/_目录.md', ours('complete', 'Gone: now'));
	await sink.writeText('Ferry log/Old/Gone： now/Page.md', 'page');
	const earlier = await earlierNotebook(sink, 'Ferry log', NOTEBOOKS()[0]!);
	assert.deepEqual([...earlier!.sections.entries()].map(([key, s]) => [key, s.groups, s.section]), [['Old/Gone: now', ['Old'], 'Gone: now']]);
	assert.deepEqual([...earlier!.occupied], []);
	// A contents page without our property, or none: not ours.
	await sink.writeText('Tides/_目录.md', 'my own index');
	assert.equal(await earlierNotebook(sink, 'Tides', NOTEBOOKS()[1]!), undefined, 'no contents page of ours: not ours');
});

test('a section whose writing fails half way is noted as failed (it may be imported again), and the import goes on', async () => {
	const { host: h, sink, seen } = host({});
	const writeText = sink.writeText.bind(sink);
	sink.writeText = async (path, text, modified) => {
		if (path === 'Ferry log/B/B page.md') throw new Error('EACCES: refused');
		return writeText(path, text, modified);
	};
	const result = await importNotebooks(NOTEBOOKS(), h, OPTIONS);
	assert.deepEqual(seen, ['Ferry log/A.one', 'Ferry log/B.one', 'Ferry log/C.one', 'Tides/Spring.one']);
	const b = result.notebooks[0]!.sections.find(section => section.section === 'B')!;
	assert.equal(b.failed, true);
	assert.match(b.error!, /EACCES/);
	assert.match(sink.files.get('Ferry log/B/_目录.md') as string, /onenote-import: failed/);
});
