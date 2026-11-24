import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/core/render/page.ts';
import { Adapter } from '../src/core/adapter.ts';
import { asset, element, outline, pageJson, sectionJson } from './helpers.ts';
import type { AttachmentHint, PageRenderOptions } from '../src/core/render/page.ts';
import { zhHans } from '../src/core/strings.ts';
import type { AssetData, Element, EmbeddedFile, Image, ListInfo, Outline, Page, Paragraph, Placement, Tag } from '../src/core/model.ts';

// Builders for small, invented pages.

function p(text: string, extra: Partial<Paragraph> = {}): Paragraph {
	return { kind: 'paragraph', runs: text ? [{ text }] : [], children: [], ...extra };
}
const bullet: ListInfo = { level: 0, ordered: false };
const numbered: ListInfo = { level: 0, ordered: true };
function box(children: Element[], place?: Placement): Outline {
	return { kind: 'outline', children, place };
}
function page(outlines: Outline[], directContent: Element[] = []): Page {
	return { id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false, outlines, directContent };
}
const stored = (key: string, size = 10): AssetData => ({ kind: 'stored', key, size });

interface Harness { options: PageRenderOptions; saved: { data: AssetData, hint: AttachmentHint }[]; skipped: string[] }

function harness(overrides: Partial<PageRenderOptions> = {}): Harness {
	const saved: Harness['saved'] = [];
	const skipped: string[] = [];
	let images = 0;
	const options: PageRenderOptions = {
		keepFontColor: true,
		boxMarkers: true,
		strings: zhHans,
		saveAttachment: async (data, hint) => {
			saved.push({ data, hint });
			const name = hint.role === 'file' ? hint.fileName
				: hint.role === 'image' ? `img${++images}.${hint.extension ?? 'bin'}`
				: hint.role === 'page-ink' ? 'ink.svg' : 'inline-ink.svg';
			return { path: `_附件/${name}`, name };
		},
		onSkipped: description => skipped.push(description),
		...overrides,
	};
	return { options, saved, skipped };
}

async function md(pg: Page, overrides: Partial<PageRenderOptions> = {}): Promise<string> {
	return (await renderPage(pg, harness(overrides).options)).markdown;
}

test('list nesting follows the outline tree', async () => {
	const c = p('C', { list: bullet });
	const b = p('B', { list: bullet, children: [c] });
	const a = p('A', { list: bullet, children: [b] });
	assert.equal(await md(page([box([a])])), '- A\n\t- B\n\t\t- C');
});

test('numbering continues across plain paragraphs and restarts after a bullet', async () => {
	const items = [p('one', { list: numbered }), p('plain'), p('two', { list: numbered }), p('bullet', { list: bullet }), p('three', { list: numbered })];
	assert.equal(await md(page([box(items)])), '1. one\n\nplain\n\n2. two\n- bullet\n1. three');
});

test('a bulleted heading at the top is a heading, and its children are not indented', async () => {
	const heading = p('Topic', { styleId: 'h2', list: bullet, children: [p('detail', { list: bullet })] });
	assert.equal(await md(page([box([heading])])), '## Topic\n\n- detail');
});

test('a line break inside a list item continues under the item', async () => {
	assert.equal(await md(page([box([p('line one\nline two', { list: bullet })])])), '- line one  \n\tline two');
});

test('to-do tags become task items', async () => {
	const todo: Tag = { checkable: true, completed: false };
	const done: Tag = { checkable: true, completed: true };
	assert.equal(await md(page([box([p('todo', { tags: [todo] }), p('done', { tags: [done] })])])), '- [ ] todo\n- [x] done');
});

test('a starred paragraph becomes a callout, and neighbours with the same tag share it', async () => {
	const star: Tag = { checkable: false, completed: false, shape: 13, label: 'Important' };
	assert.equal(await md(page([box([p('one', { tags: [star] }), p('two', { tags: [star] })])])),
		'> [!important] Important\n> one\n>\n> two');
});

test('tables: the first row becomes the header, pipes are escaped', async () => {
	const cell = (text: string) => ({ children: [p(text)] as Element[] });
	const table: Element = { kind: 'table', rows: [{ cells: [cell('H1'), cell('H2')] }, { cells: [cell('a|b'), cell('c')] }] };
	assert.equal(await md(page([box([table])])), '| H1 | H2 |\n| --- | --- |\n| a\\|b | c |');
});

test('text boxes: columns left to right, each top to bottom, with position comments', async () => {
	const pg = page([
		box([p('right top')], { x: 10, y: 0, width: 5 }),
		box([p('left bottom')], { x: 0, y: 4, width: 5 }),
		box([p('left top')], { x: 0, y: 0, width: 5 }),
	]);
	assert.equal(await md(pg), [
		'<!-- 第1块（共3块） 页面位置：左 0.0 cm，上 0.0 cm -->', 'left top',
		'<!-- 第2块（共3块） 页面位置：左 0.0 cm，上 5.1 cm -->', 'left bottom',
		'<!-- 第3块（共3块） 页面位置：左 12.7 cm，上 0.0 cm -->', 'right top',
	].join('\n\n'));
	assert.equal(await md(pg, { boxMarkers: false }), 'left top\n\nleft bottom\n\nright top');
});

test('a single column of boxes gets no position comments', async () => {
	const pg = page([box([p('bottom')], { x: 0, y: 4, width: 5 }), box([p('top')], { x: 0.5, y: 0, width: 5 })]);
	assert.equal(await md(pg), 'top\n\nbottom');
});

test('printout pages of a PDF on the page show that page of the PDF, once per run', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: stored('h.pdf') };
	const printout = (n: number): Image => ({ kind: 'image', fileName: 'doc.pdf', extension: 'xps', data: stored('x.xps'), printoutPage: n, printoutOf: pdf });
	assert.equal(await md(page([box([pdf, printout(1), printout(2)])])),
		'[doc.pdf](<_附件/doc.pdf>)\n\n![](<_附件/doc.pdf#page=1>)');
	assert.equal(await md(page([box([pdf, printout(1), p('note'), printout(2)])])),
		'[doc.pdf](<_附件/doc.pdf>)\n\n![](<_附件/doc.pdf#page=1>)\n\nnote\n\n![](<_附件/doc.pdf#page=2>)');
});

test('Mac printout pages show the original PDF too, once per run', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: stored('h.pdf') };
	const macPage = (n: number): Image => ({ kind: 'image', fileName: `doc_${n}.pdf`, extension: 'png', data: stored(`m${n}.png`), printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf });
	assert.equal(await md(page([box([pdf, macPage(1), macPage(2), macPage(3)])])),
		'[doc.pdf](<_附件/doc.pdf>)\n\n![](<_附件/doc.pdf#page=1>)');
});

test('a printout without its original PDF falls back to the image itself', async () => {
	const image: Image = { kind: 'image', fileName: 'letter.docx', extension: 'xps', data: stored('y.xps'), printoutPage: 3 };
	assert.equal(await md(page([box([image])])), '![](<_附件/img1.xps>)');
});

test('a picture without data is reported and leaves a notice in its place', async () => {
	const h = harness();
	const result = await renderPage(page([box([{ kind: 'image', extension: 'png' }, p('after')])]), h.options);
	assert.equal(result.markdown, '*〔图片缺失（OneDrive 下载包里没有这张图片的数据）〕*\n\nafter');
	assert.deepEqual(h.skipped, ['image.png']);
	assert.equal(h.saved.length, 0);
});

test('pictures without data in a row share one notice; printout pages of one document become a page range', async () => {
	const gone = (fileName?: string): Image => ({ kind: 'image', fileName });
	const macPage = (n: number, document = 'doc'): Image => ({ kind: 'image', fileName: `${document}_${n}.pdf`, printoutPage: n, printoutName: `${document}.pdf` });
	assert.equal(await md(page([box([gone('a.png'), gone(), gone('b.png'), p('text'), gone()])])), [
		'*〔图片缺失 3 张：a.png、b.png（OneDrive 下载包里没有这些图片的数据）〕*', 'text', '*〔图片缺失（OneDrive 下载包里没有这张图片的数据）〕*',
	].join('\n\n'));
	assert.equal(await md(page([box([macPage(1), macPage(2), macPage(3), macPage(1, 'other'), macPage(5, 'other'), gone('c.png')])])), [
		'*〔打印页缺失：doc.pdf 第 1 到 3 页（OneDrive 下载包里没有这些页面的数据）〕*',
		'*〔打印页缺失：other.pdf 第 1 页（OneDrive 下载包里没有这一页的数据）〕*',
		'*〔打印页缺失：other.pdf 第 5 页（OneDrive 下载包里没有这一页的数据）〕*',
		'*〔图片缺失：c.png（OneDrive 下载包里没有这张图片的数据）〕*',
	].join('\n\n'));
});

test('a picture without data inside a list item or a table cell leaves its notice there', async () => {
	const item = p('item', { list: bullet, children: [{ kind: 'image', fileName: 'x.png' } as Image, { kind: 'image' } as Image] });
	assert.equal(await md(page([box([item])])), '- item\n\n\t*〔图片缺失 2 张：x.png（OneDrive 下载包里没有这些图片的数据）〕*');
	const table: Element = { kind: 'table', rows: [{ cells: [{ children: [p('H')] }] }, { cells: [{ children: [{ kind: 'image', fileName: 'y.png' } as Image] }] }] };
	assert.equal(await md(page([box([table])])), '| H |\n| --- |\n| *〔图片缺失：y.png（OneDrive 下载包里没有这张图片的数据）〕* |');
});

test('embedded files are links named after the file; inline ink is an embedded drawing', async () => {
	const h = harness();
	const file: EmbeddedFile = { kind: 'embedded-file', fileName: 'notes', extension: 'docx', data: stored('n.docx') };
	const ink: Image = { kind: 'image', extension: 'svg', inkSvg: true, data: { kind: 'inline', bytes: new TextEncoder().encode('<svg/>') } };
	const result = await renderPage(page([box([file, p('text', { children: [ink] })])]), h.options);
	assert.equal(result.markdown, '[notes.docx](<_附件/notes.docx>)\n\ntext\n\n![](<_附件/inline-ink.svg>)');
	assert.deepEqual(h.saved.map(s => s.hint), [{ role: 'file', fileName: 'notes.docx' }, { role: 'inline-ink' }]);
});

test('loose ink on the page becomes one drawing at the end', async () => {
	const h = harness();
	const ink: Element = { kind: 'ink', strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ff0000', width: 0.02, opacity: 1 }] };
	const result = await renderPage(page([box([p('text')])], [ink]), h.options);
	assert.equal(result.markdown, 'text\n\n![](<_附件/ink.svg>)');
	const saved = h.saved[0].data;
	assert.ok(saved.kind === 'inline' && new TextDecoder().decode(saved.bytes).startsWith('<svg'));
});

test('a tagged heading stays a heading, with the tag as a symbol before its text', async () => {
	const star: Tag = { checkable: false, completed: false, shape: 13, label: 'Important' };
	const bulb: Tag = { checkable: false, completed: false, shape: 21, label: 'Idea' };
	const heading = p('Chapter 3', { styleId: 'h2', list: bullet, tags: [star], children: [p('detail')] });
	assert.equal(await md(page([box([heading, p('note', { tags: [star] }), p('Plan', { styleId: 'h3', tags: [bulb] })])])),
		'## ⭐ Chapter 3\n\ndetail\n\n> [!important] Important\n> note\n\n### 💡 Plan');
});

test('tags on list items, inside list items and in table cells become symbols before the text', async () => {
	const star: Tag = { checkable: false, completed: false, shape: 13, label: 'Important' };
	const question: Tag = { checkable: false, completed: false, shape: 15, label: 'Question' };
	const todo: Tag = { checkable: true, completed: false };
	const done: Tag = { checkable: true, completed: true };
	const item = p('item', { list: bullet, tags: [star], children: [p('inner note', { tags: [question] })] });
	assert.equal(await md(page([box([item, p('task', { tags: [todo, star] })])])),
		'- \u2b50 item\n\n\t\u2753 inner note\n\n- [ ] \u2b50 task');
	const cell = (paragraph: Paragraph) => ({ children: [paragraph] as Element[] });
	const table: Element = { kind: 'table', rows: [
		{ cells: [cell(p('Stop')), cell(p('Note'))] },
		{ cells: [cell(p('East', { tags: [star] })), cell(p('Check pier', { tags: [done] }))] },
		{ cells: [cell(p('West', { tags: [question] })), cell(p('Ask', { tags: [todo] }))] },
	] };
	assert.equal(await md(page([box([table])])),
		'| Stop | Note |\n| --- | --- |\n| \u2b50 East | \u2611 Check pier |\n| \u2753 West | \u2610 Ask |');
});

test('the adapter keeps the alternative text of an image in the model', () => {
	const adapted = new Adapter(zhHans).section(sectionJson('S', [pageJson('P', [outline([element([{ type: 'image', asset: asset('m.png'), fileName: 'm.png', alt: 'Title\n\nDescription', x: null, y: null, w: null }])])])]));
	const first = adapted.pages[0].outlines[0].children[0] as Image | Outline;
	assert.equal((first.kind === 'image' ? first : first.children[0] as Image).alt, 'Title\n\nDescription');
});

test('with the option on, the alternative text of an image follows it in a collapsed callout, as written in OneNote', async () => {
	const image: Image = { kind: 'image', extension: 'png', data: stored('a.png'), alt: 'Ferry map\n\n# Route [A]\n- dock' };
	assert.equal(await md(page([box([image])])), '![](<_附件/img1.png>)');
	assert.equal(await md(page([box([image])]), { imageAltText: true }),
		'![](<_附件/img1.png>)\n\n> [!info]- 替换文字\n> Ferry map\n>\n> \\# Route \\[A\\]\n> \\- dock');
	const item = p('item', { list: bullet, children: [image] });
	assert.equal(await md(page([box([item])]), { imageAltText: true }),
		'- item\n\n\t![](<_附件/img1.png>)\n\n\t> [!info]- 替换文字\n\t> Ferry map\n\t>\n\t> \\# Route \\[A\\]\n\t> \\- dock');
});
