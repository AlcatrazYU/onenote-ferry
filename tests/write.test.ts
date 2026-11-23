import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Adapter } from '../src/core/adapter.ts';
import { zhHans } from '../src/core/strings.ts';
import { notebookToc, sectionFolder, writeSection } from '../src/core/write.ts';
import { composedText } from '../src/core/names.ts';
import { asset, element, memorySink, memorySource, outline, pageJson, rich, run, sectionJson, stroke } from './helpers.ts';

const DIR = 'Notebook/Section';
const options = { dir: DIR, label: 'Section', strings: zhHans, boxMarkers: true, keepFontColor: true };

async function write(pages: unknown[], assets: Record<string, string> = {}) {
	const sink = memorySink();
	const section = new Adapter(zhHans).section(sectionJson('Section', pages));
	const report = await writeSection(section, memorySource(assets), sink, options);
	return { sink, report };
}
const text = (sink: ReturnType<typeof memorySink>, path: string) => sink.files.get(path) as string;
const textPage = (title: string, body: string, extra: Record<string, unknown> = {}) => pageJson(title, [outline([element([rich([run(body)])])])], extra);

test('page files: unique names, untitled pages, illegal characters, never the table of contents name', async () => {
	const { sink } = await write([textPage('Plan', 'a'), textPage('plan', 'b'), textPage('', 'c'), textPage('a/b: c?', 'd'), textPage('_目录', 'e')]);
	const names = [...sink.files.keys()].filter(p => p.endsWith('.md')).sort();
	assert.deepEqual(names, [
		`${DIR}/Plan.md`, `${DIR}/_目录 (2).md`, `${DIR}/_目录.md`, `${DIR}/a／b： c？.md`, `${DIR}/plan (2).md`, `${DIR}/无标题.md`,
	]);
});

test('front matter and file time', async () => {
	const { sink } = await write([textPage('Plan', 'body', { level: 2 })]);
	assert.equal(text(sink, `${DIR}/Plan.md`), [
		'---', 'title: "Plan"', 'onenote-section: "Section"', 'onenote-order: 1', 'onenote-level: 1',
		'created: 2023-11-14T22:13:20.000Z', 'modified: 2023-11-14T23:13:20.000Z', 'onenote-id: "{Plan}"', '---', '', 'body', '',
	].join('\n'));
	assert.equal(sink.times.get(`${DIR}/Plan.md`)?.toISOString(), '2023-11-14T23:13:20.000Z');
});

test('section table of contents: OneNote order, sub-page indentation, brackets escaped', async () => {
	const { sink } = await write([textPage('Top [1]', 'a'), textPage('Child', 'b', { level: 2 })]);
	assert.equal(text(sink, `${DIR}/_目录.md`), [
		'---', 'title: "Section 目录"', '---', '', '# Section', '',
		'- [Top \\[1\\]](<Top \uFF3B1\uFF3D.md>)', '\t- [Child](<Child.md>)', '',
	].join('\n'));
});

test('attachments: named after the page, written once per section, embedded files keep their names', async () => {
	const image = { type: 'image', asset: asset('img.png'), fileName: null, x: null, y: null, w: null };
	const file = (name: string, key: string) => ({ type: 'file', asset: asset(key), fileName: name, x: null, y: null, w: null });
	const { sink, report } = await write([
		pageJson('A long page title that goes on and on beyond thirty characters', [outline([element([image]), element([file('notes.docx', 'n1.docx')])])]),
		pageJson('Second', [outline([element([image]), element([file('notes.docx', 'n2.docx')])])]),
	], { 'img.png': 'PNG', 'n1.docx': 'ONE', 'n2.docx': 'TWO' });
	const attachments = [...sink.files.keys()].filter(p => p.includes('/_附件/')).sort();
	assert.deepEqual(attachments, [
		`${DIR}/_附件/A long page title that goes on - 图001.png`,
		`${DIR}/_附件/notes (2).docx`,
		`${DIR}/_附件/notes.docx`,
	]);
	assert.match(text(sink, `${DIR}/Second.md`), /!\[\]\(<_附件\/A long page title that goes on - 图001\.png>\)/);
	assert.equal(report.attachments, 3);
	assert.equal(report.reusedAttachments, 1);
});

test('handwriting: page ink is one drawing named after the page, inline ink is numbered', async () => {
	// A different stroke from the inline one: identical drawings would be stored once.
	const pageInk = { type: 'ink', strokes: [stroke(0, [[0, 0], [2540, 0]])], x: 0, y: 0 };
	const { sink } = await write([pageJson('Ink', [outline([element([rich([run('text')], { inks: [{ strokes: [stroke(0)] }] })])]), pageInk])]);
	const attachments = [...sink.files.keys()].filter(p => p.includes('/_附件/')).sort();
	assert.deepEqual(attachments, [`${DIR}/_附件/Ink - 手写.svg`, `${DIR}/_附件/Ink - 手写01.svg`]);
});

test('an attachment whose bytes cannot be read is reported and not linked', async () => {
	const image = { type: 'image', asset: asset('gone.png'), fileName: null, x: null, y: null, w: null };
	const { sink, report } = await write([pageJson('Page', [outline([element([image]), element([rich([run('after')])])])])]);
	assert.equal(text(sink, `${DIR}/Page.md`).split('---\n\n')[1], 'after\n');
	assert.deepEqual(report.pages[0].skipped, ['image: missing raw asset', 'image.png: no-data']);
});

test('invariants: writes stay in the section folder; every attachment is linked and every link resolves', async () => {
	const image = (key: string) => ({ type: 'image', asset: asset(key), fileName: null, x: null, y: null, w: null });
	const { sink } = await write([
		pageJson('One', [outline([element([image('a.png')]), element([image('b.png')])])]),
		pageJson('Two', [outline([element([image('a.png')])])]),
	], { 'a.png': 'A', 'b.png': 'B' });
	for (const path of [...sink.files.keys(), ...sink.folders]) assert.ok(path.startsWith(`${DIR}/`), path);
	const written = new Set([...sink.files.keys()].filter(p => p.includes('/_附件/')).map(p => p.slice(DIR.length + 1)));
	const linked = new Set<string>();
	for (const [path, content] of sink.files) {
		if (!path.endsWith('.md') || typeof content !== 'string') continue;
		for (const m of content.matchAll(/\]\(<(_附件\/[^>]+)>\)/g)) linked.add(m[1]);
	}
	assert.deepEqual([...linked].sort(), [...written].sort());
});

test('notebook table of contents lists sections and groups, marks failures', () => {
	const toc = notebookToc('Notebook', [
		{ groups: [], section: 'Intro' },
		{ groups: ['Group'], section: 'Inner: part', failed: true },
	], zhHans);
	assert.equal(toc, [
		'---', 'title: "Notebook 目录"', '---', '', '# Notebook', '',
		'> 分区按名称排序（OneDrive 下载的文件里没有 OneNote 中的分区顺序）。', '',
		'- [Intro](<Intro/_目录.md>)',
		'\t- [Inner: part](<Group/Inner： part/_目录.md>)（转换失败）',
		'',
	].join('\n'));
	assert.equal(sectionFolder(['G'], 'S', zhHans), 'G/S');
});

test('names are written composed (NFC): folders, tables of contents, page properties and files', async () => {
	// The download can hold names whose voiced kana are two characters (ク plus a combining mark).
	const decomposed = 'ライティンク\u3099', composed = decomposed.normalize('NFC');
	assert.notEqual(decomposed, composed);
	assert.equal(sectionFolder([decomposed], decomposed, zhHans), `${composed}/${composed}`);
	const toc = notebookToc(decomposed, [{ groups: [], section: decomposed }], zhHans);
	assert.ok(!toc.includes(decomposed));
	assert.ok(toc.includes(`# ${composed}\n`) && toc.includes(`- [${composed}](<${composed}/_目录.md>)`));

	const sink = memorySink();
	const section = new Adapter(zhHans).section(sectionJson(decomposed, [textPage('ヘ\u309Aージ', 'body', { id: '{P1}' })]));
	assert.equal(section.name, composed);
	await writeSection(section, memorySource({}), sink, { ...options, label: decomposed });
	const page = text(sink, `${DIR}/ページ.md`);
	assert.ok(page.includes('title: "ページ"') && page.includes(`onenote-section: "${composed}"`));
	assert.ok(text(sink, `${DIR}/_目录.md`).includes(`# ${composed}\n`));
	assert.ok(![...sink.files.keys(), ...[...sink.files.values()].filter(v => typeof v === 'string')].some(v => v !== v.normalize('NFC')));
});

test('composed names keep CJK compatibility ideographs, which NFC would replace', () => {
	const variant = '\uFA19';
	assert.notEqual(variant.normalize('NFC'), variant);
	assert.equal(composedText(`${variant}道ライティンク\u3099`), `${variant}道ライティング`);
	assert.equal(composedText('\u{2F800}'), '\u{2F800}');
});

test('page text is written composed; compatibility ideographs and link targets stay as they are', async () => {
	const link = '\uFDDFHYPERLINK "https://example.com/テ\u3099"';
	const { sink } = await write([pageJson('P', [outline([element([rich([run('テ\u3099ータ \uFA19 '), run(`${link}リンク`)])])])], { id: '{P}' })]);
	const body = text(sink, `${DIR}/P.md`).split('---\n\n')[1];
	// The link keeps its decomposed form (percent-encoded: テ is E3 83 86, the mark is E3 82 99).
	assert.equal(body, 'データ \uFA19 [リンク](https://example.com/%E3%83%86%E3%82%99)\n');
});

test('a voiced mark split from its kana by a formatting change is still composed', async () => {
	const { sink } = await write([pageJson('P', [outline([element([rich([run('アーカイフ', { highlight: '#ffff00' }), run('\u3099化')])])])], { id: '{P}' })]);
	const body = text(sink, `${DIR}/P.md`).split('---\n\n')[1];
	assert.ok(body.includes('アーカイブ'), body);
	assert.ok(!body.includes('\u3099'), body);
});

test('a link to a page by a title written decomposed still finds the page, whose title is composed', async () => {
	const link = '\uFDDFHYPERLINK "onenote:#ヘ\u309Aージ&section-id={S}&end"';
	const { sink } = await write([textPage('ページ', 'target'), pageJson('From', [outline([element([rich([run(`${link}to it`)])])])], { id: '{F}' })]);
	assert.match(text(sink, `${DIR}/From.md`), /\[to it\]\(<ページ\.md>\)/);
});
