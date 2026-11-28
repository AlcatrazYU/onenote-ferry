import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Adapter } from '../src/core/adapter.ts';
import { zhHans } from '../src/core/strings.ts';
import { failedSectionToc, importStatusOf, notebookToc, sectionFolder, writeSection } from '../src/core/write.ts';
import { composedText } from '../src/core/names.ts';
import { asset, element, memorySink, memorySource, outline, pageJson, rich, run, sectionJson, stroke } from './helpers.ts';

const DIR = 'Notebook/Section';
const options = { dir: DIR, label: 'Section', strings: zhHans, boxMarkers: true };

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

test('a page never takes a table of contents\' name, in any language or case', async () => {
	const { sink } = await write([textPage('_contents', 'a'), textPage('_目次', 'b'), textPage('_目录', 'c'), textPage('_Contents', 'd')]);
	const names = [...sink.files.keys()].filter(p => p.endsWith('.md')).sort();
	// '_Contents (2)' would clash with '_contents (2)' on a disk that ignores case.
	assert.deepEqual(names, [`${DIR}/_Contents (3).md`, `${DIR}/_contents (2).md`, `${DIR}/_目录 (2).md`, `${DIR}/_目录.md`, `${DIR}/_目次 (2).md`]);
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
		'---', 'title: "Section 目录"', 'onenote-import: complete', '---', '', '# Section', '',
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

test('handwriting: every drawing is numbered in page order, loose ink and ink in a line alike', async () => {
	// A different stroke from the inline one: identical drawings would be stored once.
	const pageInk = { type: 'ink', strokes: [stroke(0, [[0, 0], [2540, 0]])], x: 0, y: 0 };
	const { sink } = await write([pageJson('Ink', [outline([element([rich([run('text')], { inks: [{ strokes: [stroke(0)] }] })])]), pageInk])]);
	const attachments = [...sink.files.keys()].filter(p => p.includes('/_附件/')).sort();
	assert.deepEqual(attachments, [`${DIR}/_附件/Ink - 手写01.svg`, `${DIR}/_附件/Ink - 手写02.svg`]);
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

test('notebook table of contents lists sections and groups, marks failures; no note on their order (§11.5 item 104)', () => {
	const toc = notebookToc('Notebook', [
		{ groups: [], section: 'Intro' },
		{ groups: ['Group'], section: 'Inner: part', failed: true },
	], zhHans);
	assert.equal(toc, [
		'---', 'title: "Notebook 目录"', 'onenote-import: complete', '---', '', '# Notebook', '',
		'- [Intro](<Intro/_目录.md>)',
		'- Group',
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

test('the notebook table of contents names section groups above their sections and marks locked sections', () => {
	const toc = notebookToc('NB', [
		{ groups: [], section: 'Top' },
		{ groups: [], section: 'Locked', failed: true, locked: true },
		{ groups: ['Pier'], section: 'Inside' },
		{ groups: ['Pier', 'Inner'], section: 'Deep' },
		{ groups: ['Pier'], section: 'After' },
		{ groups: ['Harbour'], section: 'Other' },
	], zhHans);
	// The head is the properties and the notebook's name (§11.5 item 104: no note after it).
	assert.equal(toc.split('\n').slice(7).join('\n'), [
		'- [Top](<Top/_目录.md>)',
		'- [Locked](<Locked/_目录.md>)（有密码保护，未转换）',
		'- Pier',
		'\t- [Inside](<Pier/Inside/_目录.md>)',
		'\t- Inner',
		'\t\t- [Deep](<Pier/Inner/Deep/_目录.md>)',
		'\t- [After](<Pier/After/_目录.md>)',
		'- Harbour',
		'\t- [Other](<Harbour/Other/_目录.md>)',
		'',
	].join('\n'));
});

test('a section that could not be converted gets a table of contents saying why', () => {
	assert.equal(failedSectionToc('Locked', zhHans.passwordProtected, zhHans), [
		'---', 'title: "Locked 目录"', 'onenote-import: failed', '---', '', '# Locked', '', `> ${zhHans.passwordProtected}`, '',
	].join('\n'));
	assert.equal(failedSectionToc('Broken', zhHans.conversionFailedNote('PARSE_ERROR: bad\n  [data]'), zhHans).split('\n')[7],
		'> 这个分区没能转换。解析器报告：PARSE_ERROR: bad \\[data\\]');
});

test('our tables of contents say how far their import got; names in a notebook\'s are text', () => {
	assert.equal(importStatusOf(notebookToc('NB', [], zhHans, 'importing')), 'importing');
	assert.equal(importStatusOf(notebookToc('NB', [], zhHans)), 'complete');
	assert.equal(importStatusOf(failedSectionToc('S', 'why', zhHans)), 'failed');
	assert.equal(importStatusOf('---\ntitle: "my note"\n---\n\nonenote-import: complete\n'), undefined, 'only in the properties');
	assert.equal(importStatusOf('my own index'), undefined);
	const toc = notebookToc('NB', [{ groups: ['# Archive'], section: 'a]b' }, { groups: ['1. Lectures'], section: 'Intro' }], zhHans);
	// The folder name has "＃" (a file name cannot hold "#" everywhere); the text keeps "#", escaped.
	assert.match(toc, /\n- \\# Archive\n\t- \[a\\\]b\]\(<＃ Archive\/a］b\/_目录\.md>\)\n/);
	assert.match(toc, /\n- 1\\\. Lectures\n/);
});

test('page and attachment names are told apart as Obsidian tells them apart (composed, any case)', async () => {
	// U+F900 is a CJK compatibility ideograph: Obsidian composes it into U+8C48, so the two titles would share a file.
	const { sink } = await write([textPage('\uF900', 'one', { id: '{T1}' }), textPage('\u8C48', 'two', { id: '{T2}' })]);
	const pages = [...sink.files.keys()].filter(path => path.startsWith(`${DIR}/`) && path.endsWith('.md') && !path.endsWith('/_目录.md'));
	assert.equal(pages.length, 2);
	assert.equal(new Set(pages.map(path => path.normalize('NFC').toLowerCase())).size, 2);
});

test('a section\'s table of contents is the first thing written of it (saying importing) and the last (saying complete)', async () => {
	const sink = memorySink();
	const order: string[] = [];
	const writeText = sink.writeText.bind(sink), writeBinary = sink.writeBinary.bind(sink);
	sink.writeText = async (path, text, modified) => {
		order.push(`${path} ${importStatusOf(text) ?? ''}`.trim());
		return writeText(path, text, modified);
	};
	sink.writeBinary = async (path, bytes) => {
		order.push(path);
		return writeBinary(path, bytes);
	};
	const section = new Adapter(zhHans).section(sectionJson('Section', [textPage('Plan', 'invented'), textPage('Notes', 'invented', { id: '{N}' })]));
	await writeSection(section, memorySource({}), sink, options);
	assert.equal(order[0], `${DIR}/_目录.md importing`);
	assert.equal(order[order.length - 1], `${DIR}/_目录.md complete`);
	assert.ok(order.slice(1, -1).every(entry => !entry.endsWith('_目录.md')));
});

// An update keeps each page's file (§11.5 item 49): by page id, the name the earlier import gave it.
test('pages keep the file names given to them by id; new names avoid those and the files to leave alone', async () => {
	const sink = memorySink();
	const section = new Adapter(zhHans).section(sectionJson('Section', [
		textPage('Plan', 'a', { id: '{new-plan}' }), textPage('Plan', 'b', { id: '{old-plan}' }),
		textPage('Retitled', 'c', { id: '{kept}' }), textPage('Mine', 'd', { id: '{new}' }), textPage('_目录', 'e', { id: '{toc}' }),
	]));
	await writeSection(section, memorySource({}), sink, {
		...options,
		// Ids as the vault records them (upper case); a pin that is a table of contents' name is not kept.
		names: new Map([['{OLD-PLAN}', 'Plan'], ['{KEPT}', 'Before'], ['{TOC}', '_目录']]),
		taken: new Set(['mine.md']),
	});
	const names = [...sink.files.keys()].filter(p => p.endsWith('.md')).map(p => p.slice(DIR.length + 1)).sort();
	assert.deepEqual(names, ['Before.md', 'Mine (2).md', 'Plan (2).md', 'Plan.md', '_目录 (2).md', '_目录.md']);
	assert.match(text(sink, `${DIR}/Plan.md`), /onenote-id: "\{old-plan\}"/);
	assert.match(text(sink, `${DIR}/Plan (2).md`), /onenote-id: "\{new-plan\}"/);
	// The table of contents links each page where it is.
	assert.match(text(sink, `${DIR}/_目录.md`), /- \[Retitled\]\(<Before\.md>\)/);
});

test('a section being updated says so; an import treats it as there, an update as unfinished', async () => {
	const toc = (status: string) => `---\ntitle: "S 目录"\nonenote-import: ${status}\n---\n\n# S\n`;
	assert.equal(importStatusOf(toc('syncing')), 'syncing');
	assert.equal(importStatusOf(toc('updating')), undefined);
});

test('a section listed without a link: one that cannot be read and has no folder', () => {
	const toc = notebookToc('NB', [{ groups: [], section: 'Locked', locked: true, unlinked: true }, { groups: [], section: 'Broken', failed: true, unlinked: true }], zhHans);
	assert.match(toc, /\n- Locked（有密码保护，未转换）\n- Broken（转换失败）\n/);
});
