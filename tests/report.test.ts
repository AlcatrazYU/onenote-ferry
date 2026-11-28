// The import report: the page to read and its JSON, updated by each import, in the reader's
// language. Notebooks, sections and text are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNotebooks } from '../src/core/download.ts';
import type { DownloadFile, DownloadSection } from '../src/core/download.ts';
import { importNotebooks } from '../src/core/importer.ts';
import type { ImportHost, ImportResult } from '../src/core/importer.ts';
import { REPORT_FORMAT, reportMarkdown, reportTime, updateReport, writeReport } from '../src/core/report.ts';
import { en, ja, zhHans, zhHant } from '../src/core/strings.ts';
import type { Language } from '../src/core/strings.ts';
import { asset, element, memorySink, outline, pageJson, rich, run, sectionJson } from './helpers.ts';
import type { MemorySink } from './helpers.ts';

const files = (...paths: string[]): DownloadFile[] => paths.map(path => ({ path, size: 1 }));
const NOTEBOOKS = () => findNotebooks(files(
	'Ferry log/Open Notebook.onetoc2', 'Ferry log/Crossings.one', 'Ferry log/Locked.one', 'Ferry log/Broken.one',
	'Tides/Open Notebook.onetoc2', 'Tides/Spring.one',
), 'Documents');
const OPTIONS = { boxMarkers: true };
const AT = new Date(2026, 10, 24, 21, 5);

/** Crossings has a page with a picture whose bytes are missing; Locked is password protected; Broken fails. */
async function imported(sink: MemorySink, languageFor: (name: string) => Language, cancelAfter?: number): Promise<ImportResult> {
	let converted = 0;
	const host: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			if (section.label === 'Locked' || section.label === 'Broken') throw new Error('PARSE_ERROR: invented failure');
			const picture = { type: 'image', asset: asset('gone.png'), fileName: null, x: null, y: null, w: null };
			const pages = section.label === 'Crossings'
				? [pageJson('Morning boat', [outline([element([rich([run('invented text')])])])]), pageJson('Evening boat', [outline([element([picture])])])]
				: [pageJson(`${section.label} page`, [outline([element([rich([run('invented text')])])])])];
			return { json: sectionJson(section.label, pages), source: { async readAsset() { throw new Error('no data'); } }, release() {} };
		},
		async isPasswordProtected(section) {
			return section.label === 'Locked';
		},
		async listFolders() {
			return [...new Set([...sink.files.keys()].map(path => path.split('/')[0]))];
		},
		isCancelled: () => cancelAfter !== undefined && converted >= cancelAfter,
		onSectionDone() {
			converted++;
		},
	};
	return importNotebooks(NOTEBOOKS(), host, { languageFor: notebook => languageFor(notebook.name), ...OPTIONS, links: true });
}

const folders = (sink: MemorySink) => [...new Set([...sink.files.keys()].map(path => path.split('/')[0]))];

test('the page: the last import, a table of notebooks linking to their contents, and what needs attention', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'en');
	const report = updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	const page = reportMarkdown(report, en);
	assert.match(page, /^---\ntitle: "OneNote conversion report"\n---\n\n# OneNote conversion report\n/);
	assert.match(page, /- Time: 2026-11-24 21:05\n- From: Notes\.zip\n- 2 notebooks, 4 sections, 3 pages, 0 attachments\n- 2 sections not converted \(listed below\)\n/);
	assert.match(page, /\| \[Ferry log\]\(<Ferry log\/_contents\.md>\) \| 2026-11-24 21:05 \| 3 \| 2 \| 0 \| 2 \|/);
	assert.match(page, /\| \[Tides\]\(<Tides\/_contents\.md>\) \| 2026-11-24 21:05 \| 1 \| 1 \| 0 \| 0 \|/);
	assert.match(page, /### Ferry log\n\n/);
	assert.match(page, /- \[Evening boat\]\(<Ferry log\/Crossings\/Evening boat\.md>\): 1 picture or attachment missing \(the notebook's files have no data for it\)\n/);
	assert.match(page, /- Section "Locked": This section is password protected/);
	assert.match(page, /- Section "Broken": This section could not be converted\. The parser reported: PARSE\\_ERROR: invented failure/);
	assert.ok(!page.includes('### Tides'), 'a notebook with nothing to note has no heading');
});

test('the report is in the reader\'s language; links follow each notebook\'s own folder names', async () => {
	const sink = memorySink();
	const result = await imported(sink, name => (name === 'Tides' ? 'ja' : 'zh-Hans'));
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), en);
	assert.match(page, /\[Ferry log\]\(<Ferry log\/_目录\.md>\)/);
	assert.match(page, /\[Tides\]\(<Tides\/_目次\.md>\)/);
	// The reason is the reader's, not the notebook's (its own page says it in Chinese).
	assert.match(page, /Section "Locked": This section is password protected/);
	assert.ok(!page.includes('这个分区设了密码'));
});

test('writing it: both files under the reader\'s name; another import keeps the other notebooks still there', async () => {
	const sink = memorySink();
	const first = await imported(sink, () => 'zh-Hans');
	await writeReport(sink, zhHans, first, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	const json = JSON.parse(sink.files.get('_转换报告.json') as string);
	assert.equal(json.format, REPORT_FORMAT);
	assert.deepEqual(json.notebooks.map((n: { dir: string }) => n.dir), ['Ferry log', 'Tides']);
	assert.match(sink.files.get('_转换报告.md') as string, /^---\ntitle: "OneNote 转换报告"/);

	// Tides again, later, from another download: it replaces its own entry; Ferry log stays.
	const later = new Date(2026, 10, 25, 9, 30);
	const again: ImportResult = { notebooks: first.notebooks.filter(n => n.notebook === 'Tides'), cancelled: false, notStarted: [] };
	const { report: second } = await writeReport(sink, zhHans, again, { at: later, sources: ['Tides.zip'], options: OPTIONS }, folders(sink));
	assert.deepEqual(second.notebooks.map(n => [n.dir, n.source]), [['Ferry log', 'Notes.zip'], ['Tides', 'Tides.zip']]);
	const page = sink.files.get('_转换报告.md') as string;
	assert.match(page, /- 时间：2026-11-25 09:30\n- 来源：Tides\.zip\n- 1 本笔记本，1 个分区，1 页，0 个附件\n/);
	assert.match(page, /\| \[Ferry log\]\(<Ferry log\/_目录\.md>\) \| 2026-11-24 21:05 \|/);

	// A notebook folder that is gone drops out.
	const third = updateReport(JSON.parse(sink.files.get('_转换报告.json') as string), again, { at: later, sources: ['Tides.zip'], options: OPTIONS }, ['Tides']);
	assert.deepEqual(third.notebooks.map(n => n.dir), ['Tides']);
});

test('a OneDrive notebook whose folder the user renamed keeps its entry, in that folder, when another notebook is imported (§11.5 item 79)', async () => {
	const sink = memorySink();
	const first = await imported(sink, () => 'zh-Hans');
	await writeReport(sink, zhHans, first, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	// Tides came from OneDrive: its entry and its contents page carry the notebook.
	const report = JSON.parse(sink.files.get('_转换报告.json') as string);
	report.notebooks.find((n: { dir: string }) => n.dir === 'Tides').oneDrive = 'drive-1/T';
	sink.files.set('_转换报告.json', JSON.stringify(report));
	for (const path of [...sink.files.keys()].filter(path => path.startsWith('Tides/'))) {
		const text = sink.files.get(path)!;
		sink.files.set(`My tides/${path.slice('Tides/'.length)}`, path === 'Tides/_目录.md' ? (text as string).replace('---\n', '---\nonedrive-notebook: "drive-1/T"\n') : text);
		sink.files.delete(path);
	}
	const again: ImportResult = { notebooks: first.notebooks.filter(n => n.notebook === 'Ferry log'), cancelled: false, notStarted: [] };
	const { report: after } = await writeReport(sink, zhHans, again, { at: AT, sources: ['Ferry.zip'], options: OPTIONS }, folders(sink));
	assert.deepEqual(after.notebooks.map(n => [n.dir, n.oneDrive ?? null]), [['Ferry log', null], ['My tides', 'drive-1/T']]);
	assert.ok(after.notebooks[1]!.sections.every(section => section.dir === undefined || section.dir.startsWith('My tides/')));
});

test('a report file in another form, or not JSON at all, is started afresh', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'en');
	for (const old of ['{"seconds": 54, "notebooks": [{"notebook": "Old"}]}', 'not json', '{"format": 1, "notebooks": [{"dir": 3}]}']) {
		sink.files.set('_conversion report.json', old);
		const { report } = await writeReport(sink, en, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
		assert.deepEqual(report.notebooks.map(n => n.dir), ['Ferry log', 'Tides']);
	}
});

test('a stopped import: sections left out are counted, notebooks not started are named', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'ja', 1);
	assert.deepEqual(result.notStarted, [{ notebook: 'Tides', sections: 1 }]);
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), ja);
	assert.match(page, /- インポートは途中で停止しました。3 個のセクションは変換されていません。\n\n## /);
	// The notebooks not started are named once, under what needs attention, with what to do.
	assert.match(page, /- 途中で停止したためインポートされなかったノートブック：Tides。もう一度インポートすると追加されます。\n/);
	assert.equal(page.split('Tides').length - 1, 1);
	assert.match(page, /- 2 個のセクションは、インポートが途中で停止したため変換されていません。/);
	assert.ok(!page.includes('[Tides]'), 'a notebook not started is not in the table');
});

test('a stopped import counts only the sections it converted (or noted as failed); those it left out have their own line', async () => {
	const sink = memorySink();
	// Ferry log: Broken (fails) is converted, then the stop leaves out Crossings and Locked; Tides is not started.
	const result = await imported(sink, () => 'en', 1);
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), en);
	assert.match(page, /- 1 notebook, 1 section, 0 pages, 0 attachments\n/);
	assert.match(page, /\| \[Ferry log\]\(<Ferry log\/_contents\.md>\) \| [^|]+ \| 1 \| 0 \| 0 \| 1 \|/);
});

test('a folder whose report lost its data (only the page is left) keeps that one report', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'en');
	sink.files.set('_conversion report.md', 'the page of an earlier import');
	const { name } = await writeReport(sink, zhHans, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	assert.equal(name, '_conversion report');
	assert.deepEqual([...sink.files.keys()].filter(path => !path.includes('/')).sort(), ['_conversion report.json', '_conversion report.md']);
	assert.match(sink.files.get('_conversion report.md') as string, /# OneNote 转换报告/);
});

test('names that Markdown would read as structure are escaped, also in the table', () => {
	const result: ImportResult = {
		notebooks: [{ notebook: 'A | B [draft]', dir: 'A ｜ B ［draft］', language: 'en', sections: [{ groups: [], section: 'S', failed: true, error: 'x' }] }],
		cancelled: false, notStarted: [],
	};
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['a`b.zip'], options: OPTIONS }, ['A ｜ B ［draft］']), en);
	assert.match(page, /\| \[A \\\| B \\\[draft\\\]\]\(<A ｜ B ［draft］\/_contents\.md>\) \|/);
	assert.match(page, /- From: a\\`b\.zip/);
});

test('times are local, to the minute', () => {
	assert.equal(reportTime(new Date(2026, 0, 2, 3, 4, 59).toISOString()), '2026-01-02 03:04');
});

test('a stop between notebooks: the notebooks not started need attention, and nothing says all is converted', async () => {
	const sink = memorySink();
	// Ferry log has three sections: stopping after them leaves only Tides, which never started.
	const result = await imported(sink, () => 'en', 3);
	assert.equal(result.notebooks[0]!.sections.some(section => section.cancelled), false);
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), en);
	const attention = page.slice(page.indexOf('## Needs attention'));
	assert.match(attention, /- Notebooks not imported because the import stopped: Tides\. Import again to add them\.\n/);
	assert.doesNotMatch(page, /Nothing needs attention/);
});

test('a notebook the stop came in says how to add the rest', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'zh-Hans', 1);
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), zhHans);
	assert.match(page, /- 2 个分区因导入中途停止没有转换。再导入一次，没导入的分区会补进这本笔记本。/);
	assert.match(reportMarkdown(updateReport(undefined, { ...result, notebooks: result.notebooks.map(n => ({ ...n, sections: n.sections.filter((s, i) => i < 2) })) }, { at: AT, sources: ['N.zip'], options: OPTIONS }, folders(sink)), zhHans), /1 个分区因导入中途停止没有转换/);
});

test('an attached file the download has no data for is counted as missing', async () => {
	const sink = memorySink();
	const host: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			const file = { type: 'file', asset: null, fileName: 'plan.pdf', x: null, y: null, w: null };
			return { json: sectionJson(section.label, [pageJson('Timetable', [outline([element([file])])])]), source: { async readAsset() { throw new Error('no data'); } }, release() {} };
		},
		async isPasswordProtected() {
			return false;
		},
		async listFolders() {
			return folders(sink);
		},
	};
	const result = await importNotebooks(findNotebooks(files('Tides/Open Notebook.onetoc2', 'Tides/Spring.one'), 'Documents'), host, { languageFor: () => 'en', ...OPTIONS, links: false });
	assert.match(sink.files.get('Tides/Spring/Timetable.md') as string, /Missing attachment: plan\.pdf/);
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['N.zip'], options: OPTIONS }, folders(sink)), en);
	assert.match(page, /- \[Timetable\]\(<Tides\/Spring\/Timetable\.md>\): 1 picture or attachment missing/);
	assert.doesNotMatch(page, /Nothing needs attention/);
});

test('damaged entries of an earlier report are dropped one by one; the rest is kept', () => {
	const good = { notebook: 'Tides', dir: 'Tides', language: 'en', importedAt: AT.toISOString(), source: 'N.zip', options: OPTIONS, sections: [{ groups: [], section: 'S' }] };
	const previous = {
		format: REPORT_FORMAT,
		notebooks: [
			good,
			{ ...good, dir: 'A', sections: [{ section: 'S' }] },
			{ ...good, dir: 'B', sections: [null] },
			{ ...good, dir: 'C', notebook: undefined },
			{ ...good, dir: 'D', sections: [{ groups: [], section: 'S', report: { pageCount: 1, attachments: 0, pages: [{ file: 'p.md', skipped: 'x' }] } }] },
			{ ...good, dir: 'E', importedAt: 'yesterday' },
		],
	};
	const empty: ImportResult = { notebooks: [], cancelled: false, notStarted: [] };
	const report = updateReport(previous, empty, { at: AT, sources: [], options: OPTIONS }, ['Tides', 'A', 'B', 'C', 'D', 'E']);
	assert.deepEqual(report.notebooks.map(n => n.dir), ['Tides']);
	reportMarkdown(report, en);
});

test('a folder with a report in another language keeps that one report, now in the reader\'s language', async () => {
	const sink = memorySink();
	const first = await imported(sink, () => 'zh-Hans');
	await writeReport(sink, zhHans, first, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	const later = new Date(2026, 10, 25, 9, 30);
	const again: ImportResult = { notebooks: first.notebooks.filter(n => n.notebook === 'Tides'), cancelled: false, notStarted: [] };
	const { report, name } = await writeReport(sink, en, again, { at: later, sources: ['Tides.zip'], options: OPTIONS }, folders(sink));
	assert.equal(name, '_转换报告');
	assert.ok(!sink.files.has('_conversion report.json') && !sink.files.has('_conversion report.md'));
	assert.deepEqual(report.notebooks.map(n => n.dir), ['Ferry log', 'Tides']);
	assert.match(sink.files.get('_转换报告.md') as string, /^---\ntitle: "OneNote conversion report"/);
});

test('an unfinished download is named as such in any reader\'s language, also from older reports', () => {
	const section = (extra: Record<string, unknown>) => ({ groups: [], section: 'Spring', failed: true, ...extra });
	const notebook = (sections: unknown[]) => ({ notebook: 'Tides', dir: 'Tides', language: 'zh-Hans', importedAt: AT.toISOString(), source: 'N.zip', options: OPTIONS, sections });
	const flagged = updateReport({ format: REPORT_FORMAT, notebooks: [notebook([section({ incomplete: true, error: 'an earlier wording' })])] }, { notebooks: [], cancelled: false, notStarted: [] }, { at: AT, sources: [], options: OPTIONS }, ['Tides']);
	assert.match(reportMarkdown(flagged, en), /Section "Spring": This section did not download completely\. Download again to get it\./);
	const matched = updateReport({ format: REPORT_FORMAT, notebooks: [notebook([section({ error: zhHans.incompleteSection })])] }, { notebooks: [], cancelled: false, notStarted: [] }, { at: AT, sources: [], options: OPTIONS }, ['Tides']);
	assert.match(reportMarkdown(matched, en), /This section did not download completely/);
});

test('a folder spelled in another case is the same folder; a copy keeps its OneNote name', () => {
	const entry = { notebook: 'Tides', dir: 'Tides', language: 'en', importedAt: AT.toISOString(), source: 'N.zip', options: OPTIONS, sections: [] };
	const kept = updateReport({ format: REPORT_FORMAT, notebooks: [entry] }, { notebooks: [], cancelled: false, notStarted: [] }, { at: AT, sources: [], options: OPTIONS }, ['tides']);
	assert.deepEqual(kept.notebooks.map(n => n.dir), ['Tides']);
	const copy: ImportResult = { notebooks: [{ notebook: 'Tides (2)', originalName: 'Tides', dir: 'Tides (2)', language: 'en', sections: [] }], cancelled: false, notStarted: [] };
	assert.equal(updateReport(undefined, copy, { at: AT, sources: [], options: OPTIONS }, ['Tides (2)']).notebooks[0]!.originalName, 'Tides');
});

test('names are plain text on the page: no tags, comments, highlights or math', () => {
	const result: ImportResult = {
		notebooks: [{ notebook: '#todo %%draft%% ==key== $x$', dir: 'N', language: 'en', sections: [{ groups: [], section: 'Notes #', failed: true, error: 'x' }] }],
		cancelled: false, notStarted: [],
	};
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['N.zip'], options: OPTIONS }, ['N']), en);
	assert.match(page, /### \\#todo \\%\\%draft\\%\\% \\=\\=key\\=\\= \\\$x\\\$\n/);
	assert.match(page, /- Section "Notes \\#": /);
});

test('counts: a notebook without sections is counted, one a stop left out entirely is not', () => {
	const result: ImportResult = {
		notebooks: [
			{ notebook: 'Empty', dir: 'Empty', language: 'en', sections: [] },
			{ notebook: 'Left', dir: 'Left', language: 'en', sections: [{ groups: [], section: 'S', cancelled: true }] },
			{ notebook: 'Done', dir: 'Done', language: 'en', sections: [{ groups: [], section: 'S', dir: 'Done/S', report: { section: 'S', dir: 'Done/S', pages: [], pageCount: 2, attachments: 1, reusedAttachments: 0 } }] },
		],
		cancelled: true, notStarted: [],
	};
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['N.zip'], options: OPTIONS }, ['Empty', 'Left', 'Done']), en);
	assert.match(page, /- 2 notebooks, 1 section, 2 pages, 1 attachment\n/);
	assert.match(page, /\| \[Left\]\(<Left\/_contents\.md>\) \| [^|]+ \| 0 \| 0 \| 0 \| 0 \|/);
});

test('written while the import runs, the report says the import has not ended; sections without their record are said to be', async () => {
	const sink = memorySink();
	const result = await imported(sink, () => 'en');
	const running = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['N.zip'], options: OPTIONS, unfinished: true }, folders(sink)), en);
	assert.match(running, new RegExp(en.report.unfinished.replace(/[.]/g, '\\.')));
	const done = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['N.zip'], options: OPTIONS }, folders(sink)), en);
	assert.doesNotMatch(done, /has not finished/);
	// A section there without its record (the report's data was lost): no "nothing needs attention".
	const lost: ImportResult = { notebooks: [{ notebook: 'NB', dir: 'NB', language: 'en', sections: [{ groups: [], section: 'S', dir: 'NB/S', earlier: true }] }], cancelled: false, notStarted: [] };
	const page = reportMarkdown(updateReport(undefined, lost, { at: AT, sources: ['N.zip'], options: OPTIONS }, ['NB']), en);
	assert.match(page, /no earlier record/);
	assert.doesNotMatch(page, /Nothing needs attention/);
});

test('a notebook added to keeps when it was imported, when nothing of it was written this time', () => {
	const before = { format: 1, lastImport: { at: '2026-01-01T00:00:00.000Z', sources: ['Old.zip'], cancelled: false, notebooks: ['NB'], notStarted: [] }, notebooks: [
		{ notebook: 'NB', dir: 'NB', language: 'en', importedAt: '2026-01-01T00:00:00.000Z', source: 'Old.zip', options: OPTIONS, sections: [{ groups: [], section: 'A', dir: 'NB/A' }] },
	] };
	const nothing: ImportResult = { notebooks: [{ notebook: 'NB', dir: 'NB', language: 'en', sections: [{ groups: [], section: 'A', dir: 'NB/A', earlier: true }, { groups: [], section: 'B', cancelled: true }] }], cancelled: true, notStarted: [] };
	const kept = updateReport(before, nothing, { at: AT, sources: ['New.zip'], options: OPTIONS }, ['NB']);
	assert.equal(kept.notebooks[0]!.importedAt, '2026-01-01T00:00:00.000Z');
	assert.equal(kept.notebooks[0]!.source, 'Old.zip');
	const added: ImportResult = { ...nothing, notebooks: [{ ...nothing.notebooks[0]!, sections: [{ groups: [], section: 'A', dir: 'NB/A', earlier: true }, { groups: [], section: 'B', dir: 'NB/B', report: { section: 'B', dir: 'NB/B', pages: [], pageCount: 1, attachments: 0, reusedAttachments: 0 } }] }] };
	assert.equal(updateReport(before, added, { at: AT, sources: ['New.zip'], options: OPTIONS }, ['NB']).notebooks[0]!.source, 'New.zip');
});

test('the page says what it is, and where each update\'s changes are', async () => {
	const sink = memorySink();
	const report = updateReport(undefined, await imported(sink, () => 'en'), { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink));
	assert.match(reportMarkdown(report, en), /rewritten after each import or update\. What each update changed in notebooks imported before is in "\\_sync log"\./);
	assert.match(reportMarkdown(report, zhHans), /这一页是这个文件夹的总览：.*记在“\\_更新记录”里。/);
});

test('a run that imports new notebooks and then updates others: its last import is the whole run', () => {
	const importAt = '2026-11-24T12:00:00.000Z';
	const pages = (section: string, dir: string, pageCount: number) => ({ section, dir, pages: [], pageCount, attachments: 0, reusedAttachments: 0 });
	const before = {
		format: 1,
		lastImport: { at: importAt, sources: ['OneDrive'], cancelled: false, notebooks: ['New'], notStarted: [], links: { links: 3, resolved: 2, unresolved: 1, filesChanged: 1, unresolvedTargets: { Elsewhere: 1 } } },
		notebooks: [
			{ notebook: 'Old', dir: 'Old', language: 'en', importedAt: '2026-01-01T00:00:00.000Z', source: 'Old.zip', options: OPTIONS, sections: [{ groups: [], section: 'A', dir: 'Old/A' }] },
			{ notebook: 'New', dir: 'New', language: 'en', importedAt: importAt, source: 'OneDrive', options: OPTIONS, sections: [{ groups: [], section: 'N', dir: 'New/N', report: pages('N', 'New/N', 2) }] },
		],
	};
	const update: ImportResult = {
		notebooks: [{ notebook: 'Old', dir: 'Old', language: 'en', sections: [{ groups: [], section: 'A', dir: 'Old/A', earlier: true }, { groups: [], section: 'B', dir: 'Old/B', report: pages('B', 'Old/B', 3) }] }],
		cancelled: false, notStarted: [], links: { links: 1, resolved: 1, unresolved: 0, filesChanged: 1, unresolvedTargets: {} },
	};
	const updateAt = new Date('2026-11-24T12:10:00.000Z');
	const meta = { at: updateAt, sources: ['OneDrive'], options: OPTIONS, update: '_sync log/2026-11-24 2110.md' };
	const whole = updateReport(before, update, { ...meta, joins: importAt }, ['Old', 'New']);
	assert.equal(whole.lastImport.at, importAt);
	assert.deepEqual(whole.lastImport.sources, ['OneDrive']);
	assert.deepEqual(whole.lastImport.notebooks, ['New', 'Old']);
	assert.equal(whole.lastImport.links?.resolved, 3);
	assert.deepEqual(whole.lastImport.links?.unresolvedTargets, { Elsewhere: 1 });
	assert.equal(whole.lastImport.updateAt, updateAt.toISOString());
	const page = reportMarkdown(whole, en);
	assert.ok(page.includes(`- Time: ${reportTime(importAt)}\n`));
	assert.match(page, /- 2 notebooks, 2 sections, 5 pages, 0 attachments\n/);
	// The record is named by its own time, when the update began.
	assert.ok(page.includes(`[Sync log ${reportTime(updateAt.toISOString())}](<_sync log/2026-11-24 2110.md>)`));
	// Not after this run's import (none, another time, or an update): the update alone, as before.
	for (const joins of [undefined, '2026-11-24T11:00:00.000Z']) {
		const alone = updateReport(before, update, { ...meta, ...(joins ? { joins } : {}) }, ['Old', 'New']);
		assert.deepEqual(alone.lastImport.notebooks, ['Old']);
		assert.equal(alone.lastImport.at, updateAt.toISOString());
		assert.equal(alone.lastImport.updateAt, undefined);
	}
	const afterUpdate = { ...before, lastImport: { ...before.lastImport, update: '_sync log/old.md' } };
	assert.deepEqual(updateReport(afterUpdate, update, { ...meta, joins: importAt }, ['Old', 'New']).lastImport.notebooks, ['Old']);
});

test('simplified Chinese never uses 「」; traditional Chinese calls a section 節', () => {
	// Every text, functions called with numbers, or with names where they take a list.
	const call = (f: (...args: unknown[]) => unknown) => {
		for (const args of [[2, 2, 2, 2], [['A', 'B']], ['A', 'B']]) {
			try {
				return [String(f(...args))];
			}
			catch {
				// Not these arguments.
			}
		}
		return [];
	};
	const texts = (value: unknown): string[] => typeof value === 'string' ? [value]
		: typeof value === 'function' ? call(value as (...args: unknown[]) => unknown)
		: value && typeof value === 'object' ? Object.values(value).flatMap(texts) : [];
	for (const text of texts(zhHans)) assert.ok(!/[「」]/.test(text), text);
	assert.match(zhHant.report.sectionsCancelled(2), /節/);
	assert.match(zhHant.notImportedSuffix, /匯入/);
});

test('a Windows printout page that is not drawn is named under the page, with where to see it (§11.5 item 77)', async () => {
	const sink = memorySink();
	// A printout of a Word document whose XPS cannot be read here: shown as before, and noted.
	const printout = { type: 'image', asset: asset('doc.xps'), fileName: 'report.docx', page: 0, x: 1, y: 2, w: 5 };
	const host: ImportHost = {
		sink,
		async parse(section: DownloadSection) {
			return { json: sectionJson(section.label, [pageJson('Printed page', [outline([element([printout])])])]), source: { async readAsset() { return new TextEncoder().encode('not an XPS package'); } }, release() {} };
		},
		async isPasswordProtected() {
			return false;
		},
		async listFolders() {
			return folders(sink);
		},
	};
	const result = await importNotebooks(findNotebooks(files('Tides/Spring.one'), 'Documents'), host, { languageFor: () => 'zh-Hans', ...OPTIONS, links: true });
	const page = reportMarkdown(updateReport(undefined, result, { at: AT, sources: ['Notes.zip'], options: OPTIONS }, folders(sink)), zhHans);
	assert.match(page, /- \[Printed page\]\(<Tides\/Spring\/Printed page\.md>\): 1 页打印页没有画出（文字无法逐字核对，或页面用了这里画不了的内容），请打开原文件查看\n/);
});
