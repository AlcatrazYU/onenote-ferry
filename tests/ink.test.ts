// Handwriting on the page: where loose ink goes, and ink drawn over pictures and printouts.
// All pages, pictures and strokes are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/core/render/page.ts';
import type { AttachmentHint, PageRenderOptions } from '../src/core/render/page.ts';
import { assignToPictures, clusters, insertionPoint, strokeBox } from '../src/core/render/ink-layout.ts';
import { base64, pictureInfo } from '../src/core/render/picture.ts';
import { strokesToSvg } from '../src/core/render/ink-svg.ts';
import { zhHans } from '../src/core/strings.ts';
import { xpsDocument } from './samples-xps.ts';
import type { AssetData, Element, EmbeddedFile, Image, Ink, InkStroke, Outline, Page, Paragraph, Placement } from '../src/core/model.ts';

// Positions are in half inches, as in the model.
const pen = (points: [number, number][], color = '#000000'): InkStroke => ({ points: points.map(([x, y]) => ({ x, y })), color, width: 0.02, opacity: 1 });
const marker = (points: [number, number][]): InkStroke => ({ ...pen(points, '#ffff00'), width: 0.2, opacity: 0.5 });
const ink = (...strokes: InkStroke[]): Ink => ({ kind: 'ink', strokes });
const p = (text: string): Paragraph => ({ kind: 'paragraph', runs: text ? [{ text }] : [], children: [] });
const box = (children: Element[], place?: Placement): Outline => ({ kind: 'outline', children, place });
const page = (outlines: Outline[], directContent: Element[] = [], extra: Partial<Page> = {}): Page =>
	({ id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false, outlines, directContent, ...extra });

/** The first 24 bytes of a PNG of the given size: enough for its type and size. */
function pngHeader(width: number, height: number): Uint8Array {
	const b = new Uint8Array(24);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

interface Saved { hint: AttachmentHint, text?: string }

function harness(assets: Record<string, Uint8Array> = {}, overrides: Partial<PageRenderOptions> = {}) {
	const saved: Saved[] = [];
	let images = 0, inks = 0;
	const options: PageRenderOptions = {
		boxMarkers: true,
		strings: zhHans,
		saveAttachment: async (data, hint) => {
			saved.push({ hint, text: data.kind === 'inline' ? new TextDecoder().decode(data.bytes) : undefined });
			const name = hint.role === 'file' ? hint.fileName
				: hint.role === 'image' ? `img${++images}.${hint.extension ?? 'bin'}`
				: `ink${++inks}.svg`;
			return { path: `_附件/${name}`, name };
		},
		readAsset: async (data: AssetData) => (data.kind === 'stored' ? assets[data.key] : data.bytes),
		...overrides,
	};
	return { options, saved };
}

async function render(pg: Page, assets: Record<string, Uint8Array> = {}, overrides: Partial<PageRenderOptions> = {}) {
	const h = harness(assets, overrides);
	const result = await renderPage(pg, h.options);
	return { markdown: result.markdown, saved: h.saved };
}

// Geometry.

test('strokes close together form one piece of writing, far apart two', () => {
	const a = pen([[1, 1], [2, 1]]), b = pen([[2.3, 1], [3, 1]]), c = pen([[8, 1], [9, 1]]);
	assert.deepEqual(clusters([a, b, c], strokeBox).map(group => group.length), [2, 1]);
});

test('a stroke on a picture belongs to it, and so does a note in the margin beside it that connects to it', () => {
	const picture = { left: 1, top: 10, right: 13, bottom: 26 };
	const circle = pen([[3, 12], [4, 12], [4, 13]]);
	const arrow = pen([[10, 14], [13.4, 14]]); // starts on the picture, ends in the margin
	const note = pen([[13.6, 13.8], [15, 14.2]]); // in the margin, level with the picture
	const below = pen([[2, 26.2], [5, 26.3]]); // just under the picture: the page's own writing
	assert.deepEqual(assignToPictures([circle, arrow, note, below], [picture]), [0, 0, 0, -1]);
});

test('loose writing goes before the first block that starts below its middle, in the column it overlaps', () => {
	const columns = [
		{ left: 1, right: 14, members: [{ order: 0, top: 2 }, { order: 1, top: 10 }] },
		{ left: 20, right: 30, members: [{ order: 2, top: 2 }] },
	];
	assert.equal(insertionPoint({ left: 2, top: 0.5, right: 6, bottom: 1.5 }, columns, 3), 0); // above the first box
	assert.equal(insertionPoint({ left: 2, top: 1.8, right: 6, bottom: 4 }, columns, 3), 1); // reaches up past its top: after it
	assert.equal(insertionPoint({ left: 2, top: 12, right: 6, bottom: 13 }, columns, 3), 2); // below the last box of the column
	assert.equal(insertionPoint({ left: 22, top: 5, right: 26, bottom: 6 }, columns, 3), 3); // second column, at the end
	assert.equal(insertionPoint({ left: 1, top: 1, right: 2, bottom: 2 }, [], 4), 4); // no positions: last
});

test('picture headers give type and size; base64 matches the standard encoding', () => {
	assert.deepEqual(pictureInfo(pngHeader(640, 480)), { mime: 'image/png', width: 640, height: 480 });
	const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]);
	assert.deepEqual(pictureInfo(gif), { mime: 'image/gif', width: 32, height: 16 });
	const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03]);
	assert.deepEqual(pictureInfo(jpeg), { mime: 'image/jpeg', width: 64, height: 48 });
	assert.equal(pictureInfo(new TextEncoder().encode('%PDF-1.7 not a picture')), undefined);
	for (const length of [0, 1, 2, 3, 4, 5, 12290]) {
		const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256);
		assert.equal(base64(bytes), Buffer.from(bytes).toString('base64'), `length ${length}`);
	}
});

test('handwriting alone: coloured ink keeps the original drawing exactly; black ink turns white in a dark theme', () => {
	const px = (s: InkStroke): InkStroke => ({ ...s, points: s.points.map(q => ({ x: q.x * 48, y: q.y * 48 })), width: 1.5 });
	assert.equal(strokesToSvg([px(pen([[1, 1], [2, 2]], '#ff0000'))]),
		'<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68"><path d="M 10 10 L 58 58" stroke="#ff0000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
	assert.equal(strokesToSvg([px(pen([[1, 1], [2, 2]])), px(pen([[1, 2], [2, 2]], '#ff0000'))]),
		'<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68">'
		+ '<style>@media (prefers-color-scheme: dark) { .dark { stroke: #ffffff; } circle.dark { fill: #ffffff; } }</style>\n'
		+ '<path d="M 10 10 L 58 58" stroke="#000000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" class="dark"/>\n'
		+ '<path d="M 10 58 L 58 58" stroke="#ff0000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
	// Near-black ink turns white too; other colours keep theirs.
	assert.ok(strokesToSvg([px(pen([[1, 1], [2, 2]], '#1a1a1a'))])!.includes('class="dark"'));
	assert.ok(!strokesToSvg([px(pen([[1, 1], [2, 2]], '#3366ff'))])!.includes('class="dark"'));
});

// Loose handwriting in the reading order.

test('loose handwriting is drawn between the text boxes where it sits', async () => {
	const top = box([p('first')], { x: 1, y: 2, width: 13 });
	const bottom = box([p('second')], { x: 1, y: 10, width: 13 });
	const between = ink(pen([[2, 5], [6, 6]]));
	const above = ink(pen([[2, 0.5], [6, 1]]));
	const { markdown } = await render(page([top, bottom], [between, above]));
	assert.equal(markdown, '![](<_附件/ink1.svg>)\n\nfirst\n\n![](<_附件/ink2.svg>)\n\nsecond');
});

test('writing on both sides of an empty text box is one drawing', async () => {
	const text = box([p('text')], { x: 1, y: 2, width: 13 });
	const empty = box([p('')], { x: 1, y: 8, width: 13 });
	const { markdown, saved } = await render(page([text, empty], [ink(pen([[2, 5], [6, 6]])), ink(pen([[2, 12], [6, 13]]))]));
	assert.equal(markdown, 'text\n\n![](<_附件/ink1.svg>)');
	assert.equal((saved[0].text!.match(/<path /g) ?? []).length, 2);
});

test('highlighter away from pictures is not drawn unless asked for', async () => {
	const text = box([p('text')], { x: 1, y: 2, width: 13 });
	const highlight = ink(marker([[1, 2.2], [8, 2.2]]));
	assert.equal((await render(page([text], [], { highlighterInk: [highlight] }))).markdown, 'text');
	assert.equal((await render(page([text], [], { highlighterInk: [highlight] }), {}, { keepHighlighterInk: true })).markdown, 'text\n\n![](<_附件/ink1.svg>)');
});

test('highlighter touching loose handwriting is drawn into that drawing; one beside it or away from it is not; the drawing stays where its handwriting puts it', async () => {
	const top = box([p('first')], { x: 1, y: 2, width: 13 });
	const bottom = box([p('second')], { x: 1, y: 10, width: 13 });
	// Two lines of writing (a stroke across each), and a word on the first.
	const writing = ink(pen([[2, 5], [6, 5]]), pen([[2, 6], [6, 6]]), pen([[3, 4.9], [3.5, 5.1], [4, 4.9]]));
	const over = ink(marker([[2.5, 5], [4.5, 5]]));
	// Between the two lines, touching neither; and far away.
	const beside = ink(marker([[2, 5.5], [6, 5.5]]));
	const away = ink(marker([[20, 20], [25, 20]]));
	const { markdown, saved } = await render(page([top, bottom], [writing], { highlighterInk: [over, beside, away] }));
	assert.equal(markdown, 'first\n\n![](<_附件/ink1.svg>)\n\nsecond');
	assert.equal(saved.length, 1);
	assert.equal((saved[0].text!.match(/<path /g) ?? []).length, 4);
	assert.equal((saved[0].text!.match(/mix-blend-mode:multiply/g) ?? []).length, 1);
	// Drawn along the very edge of the writing (on its top line): drawn, whatever the hair's breadth.
	for (const dy of [-0.05, 0, 0.05]) {
		const along = ink(marker([[2, 5 + dy], [6, 5 + dy]]));
		const { saved: one } = await render(page([top, bottom], [writing], { highlighterInk: [along] }));
		assert.equal((one[0].text!.match(/mix-blend-mode:multiply/g) ?? []).length, 1, String(dy));
	}
	// A highlighter stroke reaching down past the next text box does not move the drawing.
	const long = ink(marker([[2.5, 5], [4.5, 5], [4.5, 12]]));
	assert.equal((await render(page([top, bottom], [writing], { highlighterInk: [long] }))).markdown, 'first\n\n![](<_附件/ink1.svg>)\n\nsecond');
});

test('in one drawing, highlighter strokes on the handwriting are drawn with it, others not', async () => {
	const { saved } = await render(page([box([p('before'), ink(pen([[1, 1], [3, 2]]), marker([[1, 1.5], [3, 1.5]]), marker([[10, 10], [12, 10]])), p('after')])]));
	assert.equal(saved.length, 1);
	assert.equal((saved[0].text!.match(/<path /g) ?? []).length, 2);
	assert.match(saved[0].text!, /mix-blend-mode:multiply/);
});

test('handwriting on a line of its own in a text box is drawn in its place', async () => {
	const { markdown } = await render(page([box([p('before'), ink(pen([[1, 1], [3, 2]])), p('after')])]));
	assert.equal(markdown, 'before\n\n![](<_附件/ink1.svg>)\n\nafter');
});

test('position comments count the text boxes and pictures, not the handwriting', async () => {
	const left = box([p('left')], { x: 1, y: 2, width: 10 });
	const right = box([p('right')], { x: 20, y: 2, width: 10 });
	const { markdown } = await render(page([left, right], [ink(pen([[2, 6], [5, 7]]))]));
	assert.deepEqual(markdown.split('\n').filter(line => line.startsWith('<!--')).map(line => line.match(/第\d+块（共\d+块）/)![0]), ['第1块（共2块）', '第2块（共2块）']);
	assert.ok(markdown.includes('left\n\n![](<_附件/ink1.svg>)\n\n<!-- 第2块'));
});

// Handwriting over pictures and printouts.

test('handwriting on a picture is drawn over it, highlighter included, as one picture', async () => {
	const photo: Image = { kind: 'image', fileName: 'photo.png', extension: 'png', data: { kind: 'stored', key: 'photo.png', size: 24 }, place: { x: 1, y: 4, width: 12 } };
	const circle = ink(pen([[3, 6], [5, 6], [5, 7]], '#ff0000'));
	const tick = ink(pen([[6, 9], [7, 10], [9, 7]]));
	const highlight = ink(marker([[2, 8], [9, 8]]));
	const { markdown, saved } = await render(page([box([p('caption')], { x: 1, y: 2, width: 12 })], [photo, circle, tick], { highlighterInk: [highlight] }), { 'photo.png': pngHeader(600, 400) });
	assert.equal(markdown, 'caption\n\n![](<_附件/img1.svg>)');
	assert.deepEqual(saved.map(s => s.hint), [{ role: 'image', extension: 'svg' }]);
	const svg = saved[0].text!;
	assert.ok(svg.includes(`href="data:image/png;base64,${base64(pngHeader(600, 400))}"`));
	// 12 half inches wide at 48 px each, 600 x 400 pixels: 576 x 384 on the page.
	assert.ok(svg.includes('width="576" height="384"'));
	assert.ok(svg.includes('stroke="#ff0000"') && svg.includes('mix-blend-mode:multiply'));
	assert.ok(svg.includes('<rect width="100%" height="100%" fill="#ffffff"/>'));
	// On white paper black ink stays black, whatever the theme.
	assert.ok(!svg.includes('prefers-color-scheme'));
});

test('a Mac printout with handwriting on a page is shown page by page; one without keeps the PDF', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 }, place: { x: 1, y: 1, width: 1 } };
	const macPage = (n: number): Image => ({
		kind: 'image', fileName: `doc_${n}.pdf`, extension: 'png', data: { kind: 'stored', key: `p${n}.png`, size: 24 },
		printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf, place: { x: 1, y: 2 + (n - 1) * 18, width: 12.4 },
	});
	const assets = { 'p1.png': pngHeader(850, 1100), 'p2.png': pngHeader(850, 1100) };
	const annotated = await render(page([], [pdf, macPage(1), macPage(2), ink(pen([[3, 24], [6, 24]], '#ff0000'))]), assets);
	assert.equal(annotated.markdown, '[doc.pdf](<_附件/doc.pdf>)\n\n![](<_附件/img1.png>)\n\n![](<_附件/img2.svg>)');
	const plain = await render(page([], [pdf, macPage(1), macPage(2)]), assets);
	assert.equal(plain.markdown, '[doc.pdf](<_附件/doc.pdf>)\n\n![](<_附件/doc.pdf#page=1>)');
});

test('handwriting on a Windows printout page follows the PDF, once its run of pages is over, on a blank sheet of the page\'s size', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 } };
	const winPage = (n: number): Image => ({
		kind: 'image', fileName: 'doc.pdf', extension: 'xps', data: { kind: 'stored', key: 'doc.xps', size: 10 },
		printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf, place: { x: 1, y: 2 + (n - 1) * 18, width: 12.4 },
	});
	const { markdown, saved } = await render(page([], [winPage(1), winPage(2), winPage(3), ink(pen([[3, 24], [6, 24]], '#ff0000'))]));
	// One embed for the three pages (Obsidian shows the whole PDF in it), the notes on page 2 after it (§11.5 item 72).
	assert.equal(markdown, [
		'![](<_附件/doc.pdf#page=1>)',
		'*〔doc.pdf 第 2 页上的手写批注（按它在这一页上的位置画出）〕*',
		'![](<_附件/ink1.svg>)',
	].join('\n\n'));
	// The sheet is the page: 12.4 x 18 half inches.
	assert.ok(saved.find(s => s.hint.role === 'ink')!.text!.includes('width="595.2" height="864" fill="#ffffff" stroke="#c8c8c8"'));
});

test('handwriting on a Windows printout page whose document can be drawn: on the page itself; on a page of text, on a blank sheet as before (§11.5 item 70)', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 } };
	const winPage = (n: number): Image => ({
		kind: 'image', fileName: 'doc.pdf', extension: 'xps', data: { kind: 'stored', key: 'doc.xps', size: 10 },
		printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf, place: { x: 1, y: 2 + (n - 1) * 18, width: 12.4 },
	});
	const assets = { 'doc.xps': xpsDocument() };
	const onFirst = await render(page([], [winPage(1), winPage(2), ink(pen([[3, 6], [6, 6]], '#ff0000'))]), assets);
	// The text of the run's pages follows it, each page named (§11.5 item 78): page 2 has some.
	assert.equal(onFirst.markdown, ['![](<_附件/doc.pdf#page=1>)', '*〔doc.pdf 第 1 页上的手写批注（按它在这一页上的位置画出）〕*', '![](<_附件/ink1.svg>)', '> [!info]- 打印页上的文字\n> *doc.pdf 第 2 页*\n> text'].join('\n\n'));
	const drawing = onFirst.saved.find(s => s.hint.role === 'ink')!.text!;
	// The page (12.4 half inches wide, 96 by 192 of its own units) under the stroke, not a blank sheet.
	assert.match(drawing, /<svg x="0" y="0" width="595.2" height="1190.4" preserveAspectRatio="none" viewBox="0 0 96 192"><rect width="96" height="192" fill="#ffffff"\/>/);
	assert.doesNotMatch(drawing, /stroke="#c8c8c8"/);
	const onSecond = await render(page([], [winPage(1), winPage(2), ink(pen([[3, 24], [6, 24]], '#ff0000'))]), assets);
	assert.match(onSecond.saved.find(s => s.hint.role === 'ink')!.text!, /stroke="#c8c8c8"/);
});

test('handwriting on a Windows printout page inside a text box: the page with the writing, folded under it as estimated', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 } };
	const winPage: Image = { kind: 'image', fileName: 'doc.pdf', extension: 'xps', data: { kind: 'stored', key: 'doc.xps', size: 10 }, printoutPage: 1, printoutName: 'doc.pdf', printoutOf: pdf, size: { width: 12.4, height: 24.8 } };
	const { markdown, saved } = await render(page([box([winPage], { x: 1, y: 2, width: 13 })], [pdf, ink(pen([[3, 6], [6, 6]], '#ff0000'), pen([[3, 7], [6, 7]], '#ff0000'))]), { 'doc.xps': xpsDocument() });
	assert.equal(markdown, ['![](<_附件/doc.pdf#page=1>)', '> [!info]- 笔迹（位置为估算）\n> *doc.pdf 第 1 页*\n> ![](<_附件/ink1.svg>)', '[doc.pdf](<_附件/doc.pdf>)'].join('\n\n'));
	const folded = saved.find(s => s.hint.role === 'ink')!.text!;
	assert.match(folded, /viewBox="0 0 96 192"><rect width="96" height="192"/);
	assert.equal((folded.match(/stroke="#ff0000"/g) ?? []).length, 2);
});

test('two pages of a Windows printout in a text box with writing on them: one embed for the run, then one folded box with both pages, each named (§11.5 item 72)', async () => {
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 } };
	const winPage = (n: number): Image => ({ kind: 'image', fileName: 'doc.pdf', extension: 'xps', data: { kind: 'stored', key: 'doc.xps', size: 10 }, printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf, size: { width: 12.4, height: 24.8 } });
	// Page 1 from 2 to 26.8 half inches, page 2 below it; a box drawn on each, and the first page of the document is drawn twice (page 2 is text).
	const strokes = [pen([[3, 6], [6, 6], [6, 7], [3, 7], [3, 6]], '#ff0000'), pen([[3, 30], [6, 30], [6, 31], [3, 31], [3, 30]], '#ff0000')];
	const { markdown } = await render(page([box([winPage(1), winPage(1), p('after')], { x: 1, y: 2, width: 13 })], [pdf, ink(...strokes)]), { 'doc.xps': xpsDocument() });
	assert.equal(markdown, [
		'![](<_附件/doc.pdf#page=1>)',
		'> [!info]- 笔迹（位置为估算）\n> *doc.pdf 第 1 页*\n> ![](<_附件/ink1.svg>)\n>\n> *doc.pdf 第 1 页*\n> ![](<_附件/ink2.svg>)',
		'after',
		'[doc.pdf](<_附件/doc.pdf>)',
	].join('\n\n'));
});
