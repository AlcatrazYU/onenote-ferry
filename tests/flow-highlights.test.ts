// Highlighter strokes on pictures inside text boxes (src/core/render/flow-highlights.ts, §11.5
// item 67): where such a picture is worked out to sit, when that is sure enough to draw the strokes
// into it, and what is written either way. Pictures, profiles and strokes are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOnPictures, readProfile } from '../src/core/render/flow-highlights.ts';
import type { RowProfile } from '../src/core/render/flow-highlights.ts';
import { renderPage } from '../src/core/render/page.ts';
import { zhHans } from '../src/core/strings.ts';
import type { EmbeddedFile, Image, InkStroke, Outline, Page, Paragraph, Table } from '../src/core/model.ts';

/** A profile as the parser gives it: 600 px wide, `rows` rows, a line of text every `pitch` rows from `first`. */
function raw(rows: number, pitch: number, first: number): Float32Array {
	const out = new Float32Array(3 + rows);
	out[0] = 600;
	out[1] = rows;
	out[2] = 240;
	for (let r = 0; r < rows; r++) out[3 + r] = Math.abs(((r - first) % pitch + pitch) % pitch) < 5 || Math.abs(((r - first) % pitch + pitch) % pitch) > pitch - 5 ? 0.3 : 0.02;
	return out;
}

const text = (t: string, fontSize = 11): Paragraph => ({ kind: 'paragraph', runs: t ? [{ text: t }] : [], children: [], layout: { fontSize } });
const picture = (width: number, height: number): Image => ({ kind: 'image', extension: 'png', data: { kind: 'stored', key: 'shot.png', size: 1 }, size: { width, height } });
const box = (children: Outline['children'], place: Outline['place'], sizedByUser = false): Outline => ({ kind: 'outline', children, place, ...(sizedByUser ? { sizedByUser } : {}) });
/** A highlighter stroke across at height y (half inches), from x0 to x1. */
const across = (y: number, x0 = 3, x1 = 8): InkStroke => ({ points: [{ x: x0, y }, { x: x1, y }], color: '#ffff00', width: 0.4, opacity: 0.5 });

test('a profile: rows of text every so many pixels, and their middles', () => {
	const profile = readProfile(raw(300, 20, 12))!;
	assert.equal(profile.pitch, 20);
	assert.ok(profile.periodic > 0.5);
	assert.deepEqual(profile.bands.slice(0, 3), [12, 32, 52]);
	assert.equal(readProfile(new Float32Array([0, 0, 0])), undefined);
});

// A picture 5 half inches tall under one line of text: 300 rows, so 60 rows a half inch; a line
// of its text every 20 rows (a third of a half inch), the first in the middle of row 12.
const shot = picture(10, 5);
const profileOf = async (image: Image): Promise<RowProfile | undefined> => (image === shot ? readProfile(raw(300, 20, 12)) : undefined);

test('a picture under a line of text: placed where its rows meet the strokes on it, and sure', async () => {
	const outline = box([text('A line of text above the picture.'), shot], { x: 2, y: 2, width: 13 });
	// Where OneNote really put it: a little lower than one line at 1.46 times the font size says.
	const top = 2 + 11 * 1.46 / 36 + 0.08;
	const strokes = [across(top + 12 / 60), across(top + 52 / 60), across(top + 92 / 60)];
	const [placed] = await placeOnPictures([outline], strokes, profileOf);
	assert.ok(placed);
	assert.equal(placed.image, shot);
	assert.deepEqual(placed.strokes, [0, 1, 2]);
	assert.equal(placed.sure, true);
	assert.ok(Math.abs(placed.box.top - top) < 0.02, String(placed.box.top - top));
});

test('a picture below what the layout cannot measure (a file\'s icon, handwriting, a table with more in a cell, a picture of no size), or below text near a wrap: never sure (§11.5 item 79)', async () => {
	const strokes = (top: number) => [across(top + 12 / 60), across(top + 52 / 60)];
	const file: EmbeddedFile = { kind: 'embedded-file', fileName: 'notes.pdf', data: { kind: 'stored', key: 'notes.pdf', size: 1 } };
	const sized: Image = { kind: 'image', extension: 'png', data: { kind: 'stored', key: 'ink.png', size: 1 } };
	const table: Table = { kind: 'table', rows: [{ cells: [{ children: [text('one'), text('two'), text('three')] }] }] };
	for (const above of [file, sized, table] as Outline['children']) {
		const [placed] = await placeOnPictures([box([above, shot], { x: 2, y: 2, width: 13 })], strokes(2.5), profileOf);
		assert.equal(placed?.sure, false, above.kind);
	}
	// About 90 Latin letters: two lines at the average width counted, perhaps one in the font OneNote uses.
	const long = 'A sentence about the ferry timetable that runs close to the edge of the text box in width.';
	const [nearWrap] = await placeOnPictures([box([text(long), shot], { x: 2, y: 2, width: 13 })], strokes(2.9), profileOf);
	assert.equal(nearWrap?.sure, false);
});

test('a picture under eight lines of text whose line height is not known: not sure; with a stored height that gives it: sure', async () => {
	// 42 characters a line at 11 pt in 13 half inches: eight lines.
	const long = text('一'.repeat(8 * 42));
	const free = box([long, shot], { x: 2, y: 2, width: 13 });
	const top = 2 + 8 * 11 * 1.5 / 36;
	const strokes = [across(top + 12 / 60), across(top + 52 / 60)];
	const [unsure] = await placeOnPictures([free], strokes, profileOf);
	assert.equal(unsure?.sure, false);
	// The same box, sized by the user: its height is what eight lines at 1.5 times 11 pt and the picture take.
	const pinned = box([long, shot], { x: 2, y: 2, width: 13, height: 8 * 11 * 1.5 / 36 + 5 }, true);
	const [sure] = await placeOnPictures([pinned], strokes, profileOf);
	assert.equal(sure?.sure, true);
	assert.ok(Math.abs(sure!.box.top - top) < 0.02);
});

test('a picture whose rows cannot be read, or with only a dot on it: not sure; strokes on no picture: on none', async () => {
	const outline = box([text('Above.'), shot], { x: 2, y: 2, width: 13 });
	const top = 2 + 11 * 1.46 / 36;
	const [unread] = await placeOnPictures([outline], [across(top + 1)], async () => undefined);
	assert.equal(unread?.sure, false);
	const dot: InkStroke = { points: [{ x: 5, y: top + 1 }, { x: 5.1, y: top + 1 }], color: '#ffff00', width: 0.4, opacity: 0.5 };
	const [dotted] = await placeOnPictures([outline], [dot], profileOf);
	assert.equal(dotted?.sure, false);
	assert.deepEqual(await placeOnPictures([outline], [across(30, 30, 35)], profileOf), []);
});

/** The first 24 bytes of a PNG of the given size: enough for its type and size. */
function pngHeader(width: number, height: number): Uint8Array {
	const b = new Uint8Array(24);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

async function render(page: Page, profile: Float32Array | undefined) {
	const saved: { role: string, text?: string }[] = [];
	let n = 0;
	const result = await renderPage(page, {
		boxMarkers: false, strings: zhHans,
		saveAttachment: async (data, hint) => {
			saved.push({ role: hint.role, text: data.kind === 'inline' ? new TextDecoder().decode(data.bytes) : undefined });
			const name = hint.role === 'image' ? `img${++n}.${hint.extension ?? 'bin'}` : hint.role === 'ink' ? `ink${++n}.svg` : hint.role === 'page' ? `page${++n}.svg` : hint.fileName;
			return { path: `_附件/${name}`, name };
		},
		readAsset: async data => (data.kind === 'stored' ? pngHeader(600, 300) : data.bytes),
		rowProfile: async () => profile,
	});
	return { markdown: result.markdown, saved };
}

test('written: a sure picture with the strokes drawn into it; an unsure one as it is, with a folded copy marked as estimated', async () => {
	const top = 2 + 11 * 1.46 / 36 + 0.08;
	const page = (children: Outline['children']): Page => ({
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		outlines: [box(children, { x: 2, y: 2, width: 13 })], directContent: [],
		highlighterInk: [{ kind: 'ink', strokes: [across(top + 12 / 60), across(top + 52 / 60)] }],
	});
	const sure = await render(page([text('Above.'), picture(10, 5)]), raw(300, 20, 12));
	assert.equal(sure.markdown, 'Above.\n\n![](<_附件/img1.svg>)');
	assert.match(sure.saved[0]!.text!, /<image /);
	assert.equal((sure.saved[0]!.text!.match(/mix-blend-mode:multiply/g) ?? []).length, 2);
	// No profile (the parser cannot read the picture): the picture as it is, the copy folded.
	const unsure = await render(page([text('Above.'), picture(10, 5)]), undefined);
	assert.equal(unsure.markdown, 'Above.\n\n![](<_附件/img1.png>)\n\n> [!info]- 笔迹（位置为估算）\n> ![](<_附件/ink2.svg>)');
	assert.deepEqual(unsure.saved.map(s => s.role), ['image', 'ink']);
});

test('Mac printout pages in a text box with highlighter on one: shown page by page, the strokes on that page (or on its folded copy)', async () => {
	const top = 2 + 11 * 1.46 / 36 + 0.08;
	const pdf: EmbeddedFile = { kind: 'embedded-file', fileName: 'doc.pdf', extension: 'pdf', data: { kind: 'stored', key: 'doc.pdf', size: 10 } };
	const macPage = (n: number): Image => ({ ...picture(10, 5), fileName: `doc_${n}.pdf`, printoutPage: n, printoutName: 'doc.pdf', printoutOf: pdf });
	const page = (): Page => ({
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		outlines: [box([text('Above.'), macPage(1), macPage(2)], { x: 2, y: 2, width: 13 })], directContent: [pdf],
		highlighterInk: [{ kind: 'ink', strokes: [across(top + 12 / 60), across(top + 52 / 60)] }],
	});
	const sure = await render(page(), raw(300, 20, 12));
	assert.equal(sure.markdown, 'Above.\n\n![](<_附件/img1.svg>)\n\n![](<_附件/img2.png>)\n\n[doc.pdf](<_附件/doc.pdf>)');
	const unsure = await render(page(), undefined);
	assert.equal(unsure.markdown, 'Above.\n\n![](<_附件/img1.png>)\n\n> [!info]- 笔迹（位置为估算）\n> ![](<_附件/ink2.svg>)\n\n![](<_附件/img3.png>)\n\n[doc.pdf](<_附件/doc.pdf>)');
});

test('handwriting and highlighter on one picture in a text box go into one picture: drawn in when sure, one folded copy when not; handwriting elsewhere stays its own drawing', async () => {
	const top = 2 + 11 * 1.46 / 36 + 0.08;
	// A circle drawn on the picture, a note beside it joined to the circle, and a word written well below the text box.
	const circle: InkStroke = { points: [{ x: 4, y: top + 1 }, { x: 6, y: top + 1 }, { x: 6, y: top + 2 }, { x: 4, y: top + 2 }, { x: 4, y: top + 1 }], color: '#ff0000', width: 0.05, opacity: 1 };
	const beside: InkStroke = { points: [{ x: 12.1, y: top + 1.5 }, { x: 13, y: top + 1.5 }], color: '#ff0000', width: 0.05, opacity: 1 };
	const arrow: InkStroke = { points: [{ x: 6, y: top + 1.5 }, { x: 12.1, y: top + 1.5 }], color: '#ff0000', width: 0.05, opacity: 1 };
	const away: InkStroke = { points: [{ x: 3, y: 20 }, { x: 5, y: 20.2 }], color: '#ff0000', width: 0.05, opacity: 1 };
	const page = (): Page => ({
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		outlines: [box([text('Above.'), picture(10, 5)], { x: 2, y: 2, width: 13 })],
		directContent: [{ kind: 'ink', strokes: [circle, arrow, beside, away] }],
		highlighterInk: [{ kind: 'ink', strokes: [across(top + 12 / 60), across(top + 52 / 60)] }],
	});
	const sure = await render(page(), raw(300, 20, 12));
	assert.equal(sure.markdown, 'Above.\n\n![](<_附件/img1.svg>)\n\n![](<_附件/ink2.svg>)');
	const drawn = sure.saved[0]!.text!;
	assert.match(drawn, /<image /);
	assert.equal((drawn.match(/<path /g) ?? []).length, 5, 'circle, arrow, note and two highlighter strokes, on the picture');
	assert.equal((sure.saved[1]!.text!.match(/<path /g) ?? []).length, 1, 'the word below, on its own');
	const unsure = await render(page(), undefined);
	assert.equal(unsure.markdown, 'Above.\n\n![](<_附件/img1.png>)\n\n> [!info]- 笔迹（位置为估算）\n> ![](<_附件/ink2.svg>)\n\n![](<_附件/ink3.svg>)');
	assert.equal((unsure.saved[1]!.text!.match(/<path /g) ?? []).length, 5);
});

test('handwriting alone on a picture in a text box: its rows say nothing of where it sits, so one folded copy, and no drawing of its own', async () => {
	const top = 2 + 11 * 1.46 / 36;
	const circle: InkStroke = { points: [{ x: 4, y: top + 1 }, { x: 6, y: top + 1 }, { x: 6, y: top + 2 }, { x: 4, y: top + 1 }], color: '#ff0000', width: 0.05, opacity: 1 };
	const page: Page = {
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		outlines: [box([text('Above.'), picture(10, 5)], { x: 2, y: 2, width: 13 })],
		directContent: [{ kind: 'ink', strokes: [circle] }],
	};
	const { markdown } = await render(page, raw(300, 20, 12));
	assert.equal(markdown, 'Above.\n\n![](<_附件/img1.png>)\n\n> [!info]- 笔迹（位置为估算）\n> ![](<_附件/ink2.svg>)');
});

// Pictures in table cells (§11.5 item 86): across from the column widths, down from the rows above,
// each row as high as its highest cell plus the padding, as OneNote draws a table (measured).

const { TABLE_LEFT, TABLE_TOP, COLUMN_EXTRA, CELL_LEFT, CELL_NARROWER, CELL_TOP, CELL_BOTTOM } = await import('../src/core/render/flow-highlights.ts');
/** A picture 4 by 2 half inches with a line of text every 66 of its 300 rows (16 points), the first in row 20. */
const cellShot = picture(4, 2);
const cellRows = raw(300, 66, 20);
const cellProfile = async (image: Image): Promise<RowProfile | undefined> => (image === cellShot ? readProfile(cellRows) : undefined);
/** A line of 11 point text at the usual line height, and a row holding one (half inches). */
const LINE = 11 * 1.46 / 36, ROW = CELL_TOP + LINE + CELL_BOTTOM;
/** Where a table at (2, 2) puts what is in its second column (columns 3 and 6 half inches wide), across. */
const SECOND = 2 + TABLE_LEFT + 3 + COLUMN_EXTRA + CELL_LEFT;
const grid = (rows: Outline['children'][][], widths = [3, 6]): Table => ({ kind: 'table', columnWidths: widths, rows: rows.map(cells => ({ cells: cells.map(children => ({ children })) })) });
/** Highlighter along the first two lines of text of a picture whose top is at `top`. */
const onCellShot = (top: number) => [across(top + 20 / 150, 6, 8), across(top + 86 / 150, 6, 8)];

test('a picture in a table cell sits across from the column widths and down from the rows above; with little above, sure', async () => {
	const table = grid([[[text('Pier')], [text('Notes')]], [[text('North')], [cellShot]]]);
	const top = 2 + TABLE_TOP + ROW + CELL_TOP;
	const [placed] = await placeOnPictures([box([table], { x: 2, y: 2, width: 13 })], onCellShot(top), cellProfile);
	assert.equal(placed?.image, cellShot);
	assert.deepEqual(placed.strokes, [0, 1]);
	assert.equal(placed.sure, true);
	assert.ok(Math.abs(placed.box.left - SECOND) < 1e-9);
	assert.ok(Math.abs(placed.box.top - top) < 0.02, String(placed.box.top - top));
	// Where the layout puts it, before its rows move it (its rows unread): exactly there.
	const [estimated] = await placeOnPictures([box([table], { x: 2, y: 2, width: 13 })], onCellShot(top), async () => undefined);
	assert.ok(Math.abs(estimated!.box.top - top) < 1e-9, String(estimated!.box.top - top));
});

test('a row is as high as its highest cell: a picture in the row below one with three lines in a cell sits below those', async () => {
	// A cell 3 half inches wide holds 9 characters of 11 points a line: three lines.
	const three = text('一'.repeat(3 * 9));
	const table = grid([[[three], [text('Notes')]], [[text('North')], [cellShot]]]);
	const top = 2 + TABLE_TOP + CELL_TOP + 3 * LINE + CELL_BOTTOM + CELL_TOP;
	const [placed] = await placeOnPictures([box([table], { x: 2, y: 2, width: 13 })], onCellShot(top), async () => undefined);
	assert.ok(Math.abs(placed!.box.top - top) < 1e-9, String(placed!.box.top - top));
});

test('a picture in a table below rows that may add up to half a line of its text, or below a cell that cannot be measured: not sure', async () => {
	const file: EmbeddedFile = { kind: 'embedded-file', fileName: 'notes.pdf', data: { kind: 'stored', key: 'notes.pdf', size: 1 } };
	const rows = grid([[[text('a')], [text('b')]], [[text('c')], [text('d')]], [[text('e')], [cellShot]]]);
	const [many] = await placeOnPictures([box([rows], { x: 2, y: 2, width: 13 })], onCellShot(2 + TABLE_TOP + 2 * ROW + CELL_TOP), cellProfile);
	assert.equal(many?.sure, false);
	const unmeasured = grid([[[file], [text('b')]], [[text('e')], [cellShot]]]);
	const [below] = await placeOnPictures([box([unmeasured], { x: 2, y: 2, width: 13 })], onCellShot(2 + TABLE_TOP + ROW + CELL_TOP), cellProfile);
	assert.equal(below?.sure, false);
});

test('a picture below a table in the same box keeps the estimate it had: a line a row', async () => {
	const table = grid([[[text('Pier')], [text('Notes')]], [[text('North')], [text('Calm')]]]);
	const top = 2 + 2 * LINE;
	const [placed] = await placeOnPictures([box([table, cellShot], { x: 2, y: 2, width: 13 })], [across(top + 20 / 150, 3, 5), across(top + 86 / 150, 3, 5)], async () => undefined);
	assert.equal(placed?.image, cellShot);
	assert.ok(Math.abs(placed.box.top - top) < 1e-9, String(placed.box.top - top));
});

test('a picture wider than its cell is shrunk to the cell\'s width, as OneNote shows it', async () => {
	const wide = picture(12, 6);
	const [placed] = await placeOnPictures([box([grid([[[text('Pier')], [wide]]])], { x: 2, y: 2, width: 13 })], [across(2.5, 6, 8)], async () => undefined);
	assert.equal(placed?.image, wide);
	assert.ok(Math.abs(placed.box.right - placed.box.left - (6 - CELL_NARROWER)) < 1e-9);
	assert.ok(Math.abs(placed.box.bottom - placed.box.top - (6 - CELL_NARROWER) / 2) < 1e-9);
});

test('written: a sure picture in a cell drawn with its strokes in the cell; an unsure one as it is, its copy folded below the table and named by its cell', async () => {
	const top = 2 + TABLE_TOP + ROW + CELL_TOP;
	const page: Page = {
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		outlines: [box([grid([[[text('Pier')], [text('Notes')]], [[text('North')], [picture(4, 2)]]])], { x: 2, y: 2, width: 13 })], directContent: [],
		highlighterInk: [{ kind: 'ink', strokes: onCellShot(top) }],
	};
	const sure = await render(page, cellRows);
	assert.equal(sure.markdown, '| Pier | Notes |\n| --- | --- |\n| North | ![](<_附件/img1.svg>) |');
	assert.match(sure.saved[0]!.text!, /<image /);
	const unsure = await render(page, undefined);
	assert.equal(unsure.markdown, '| Pier | Notes |\n| --- | --- |\n| North | ![](<_附件/img1.png>) |\n\n> [!info]- 笔迹（位置为估算）\n> *第 2 行第 2 列*\n> ![](<_附件/ink2.svg>)');
});

test('a box the user sized, with a picture in a table cell: its stored height is not believed (the table\'s rows are counted a line each), so not sure', async () => {
	const tall = picture(4, 6);
	const above = Array.from({ length: 10 }, (_, i) => text(`Line ${i}`));
	const below = Array.from({ length: 50 }, (_, i) => text(`Tail ${i}`));
	const table = grid([[[text('Pier')], [tall, text('')]]]);
	const top = 2 + 10 * LINE + TABLE_TOP + CELL_TOP;
	const height = 10 * LINE + TABLE_TOP + CELL_TOP + 6 + LINE + CELL_BOTTOM + 50 * LINE;
	const strokes = Array.from({ length: 9 }, (_, i) => across(top + (25 + 100 * i) / 150, SECOND + 0.5, SECOND + 3.5));
	const rows = readProfile(raw(900, 50, 25));
	const [placed] = await placeOnPictures([box([...above, table, ...below], { x: 2, y: 2, width: 13, height }, true)], strokes, async image => (image === tall ? rows : undefined));
	assert.equal(placed?.image, tall);
	assert.equal(placed.sure, false);
});

test('a picture indented past its cell\'s width: where it is cannot be told, and nothing fails', async () => {
	const deep: Paragraph = { ...text('a'), children: [{ ...text('b'), children: [picture(2, 10)] }] };
	const placed = await placeOnPictures([box([grid([[[deep]]], [1])], { x: 2, y: 2, width: 13 })], [across(2.5, 2, 3)], async () => undefined);
	assert.ok(placed.every(one => !one.sure));
});

test('written: the copies below a table name which picture of a cell holding several they are', async () => {
	const top = 2 + TABLE_TOP + ROW + CELL_TOP;
	const page: Page = {
		id: '{P}', title: 'Sample', level: 0, isConflictPage: false, isDeleted: false,
		// Strokes on the second of the cell's two pictures only.
		outlines: [box([grid([[[text('Pier')], [text('Notes')]], [[text('North')], [picture(4, 2), picture(4, 2)]]])], { x: 2, y: 2, width: 13 })], directContent: [],
		highlighterInk: [{ kind: 'ink', strokes: onCellShot(top + 2) }],
	};
	const { markdown } = await render(page, undefined);
	assert.match(markdown, /> \*第 2 行第 2 列，第 2 张图\*\n/);
});
