// Finding notebooks in a download, and converting them: sections in order, failures, password
// protection, cancelling. Notebooks, sections and text are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNotebooks } from '../src/core/download.ts';
import type { DownloadFile, DownloadSection } from '../src/core/download.ts';
import { importNotebooks, scanNotebook } from '../src/core/importer.ts';
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

test('a section the download stopped inside is not parsed; its page asks for the notebook again', async () => {
	const { host: h, sink, seen } = host({});
	const notebooks = findNotebooks([...files('Ferry log/Open Notebook.onetoc2', 'Ferry log/A.one'), { path: 'Ferry log/B.one', size: 0, incomplete: true }], 'Documents');
	const result = await importNotebooks(notebooks, h, OPTIONS);
	assert.deepEqual(seen, ['Ferry log/A.one']);
	assert.equal(result.notebooks[0].sections[1].failed, true);
	assert.match(sink.files.get('Ferry log/B/_目录.md') as string, /这个分区没有下载完整/);
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

test('sections can be converted elsewhere (the plugin\'s worker), given the notebook\'s folder and language', async () => {
	const { host: h, sink } = host({});
	const asked: string[] = [];
	h.convertSection = async (section, notebookDir, language, options) => {
		asked.push(`${section.label} ${notebookDir} ${language} ${options.boxMarkers}`);
		return { groups: section.groups, section: section.label };
	};
	await importNotebooks(NOTEBOOKS(), h, { ...OPTIONS, languageFor: notebook => (notebook.name === 'Tides' ? 'ja' : 'zh-Hans') });
	assert.deepEqual(asked, ['A Ferry log zh-Hans true', 'B Ferry log zh-Hans true', 'C Ferry log zh-Hans true', 'Spring Tides ja true']);
	assert.ok(sink.files.has('Tides/_目次.md'));
});
