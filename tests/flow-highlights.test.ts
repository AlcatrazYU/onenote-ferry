// Highlighter strokes on pictures inside text boxes (src/core/render/flow-highlights.ts, §11.5
// item 67): where such a picture is worked out to sit, when that is sure enough to draw the strokes
// into it, and what is written either way. Pictures, profiles and strokes are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeHighlights, readProfile } from '../src/core/render/flow-highlights.ts';
import type { RowProfile } from '../src/core/render/flow-highlights.ts';
import { renderPage } from '../src/core/render/page.ts';
import { zhHans } from '../src/core/strings.ts';
import type { Image, InkStroke, Outline, Page, Paragraph } from '../src/core/model.ts';

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
	const [placed] = await placeHighlights([outline], strokes, profileOf);
	assert.ok(placed);
	assert.equal(placed.image, shot);
	assert.deepEqual(placed.strokes, [0, 1, 2]);
	assert.equal(placed.sure, true);
	assert.ok(Math.abs(placed.box.top - top) < 0.02, String(placed.box.top - top));
});

test('a picture under eight lines of text whose line height is not known: not sure; with a stored height that gives it: sure', async () => {
	// 42 characters a line at 11 pt in 13 half inches: eight lines.
	const long = text('一'.repeat(8 * 42));
	const free = box([long, shot], { x: 2, y: 2, width: 13 });
	const top = 2 + 8 * 11 * 1.5 / 36;
	const strokes = [across(top + 12 / 60), across(top + 52 / 60)];
	const [unsure] = await placeHighlights([free], strokes, profileOf);
	assert.equal(unsure?.sure, false);
	// The same box, sized by the user: its height is what eight lines at 1.5 times 11 pt and the picture take.
	const pinned = box([long, shot], { x: 2, y: 2, width: 13, height: 8 * 11 * 1.5 / 36 + 5 }, true);
	const [sure] = await placeHighlights([pinned], strokes, profileOf);
	assert.equal(sure?.sure, true);
	assert.ok(Math.abs(sure!.box.top - top) < 0.02);
});

test('a picture whose rows cannot be read, or with only a dot on it: not sure; strokes on no picture: on none', async () => {
	const outline = box([text('Above.'), shot], { x: 2, y: 2, width: 13 });
	const top = 2 + 11 * 1.46 / 36;
	const [unread] = await placeHighlights([outline], [across(top + 1)], async () => undefined);
	assert.equal(unread?.sure, false);
	const dot: InkStroke = { points: [{ x: 5, y: top + 1 }, { x: 5.1, y: top + 1 }], color: '#ffff00', width: 0.4, opacity: 0.5 };
	const [dotted] = await placeHighlights([outline], [dot], profileOf);
	assert.equal(dotted?.sure, false);
	assert.deepEqual(await placeHighlights([outline], [across(30, 30, 35)], profileOf), []);
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
		keepFontColor: true, boxMarkers: false, strings: zhHans,
		saveAttachment: async (data, hint) => {
			saved.push({ role: hint.role, text: data.kind === 'inline' ? new TextDecoder().decode(data.bytes) : undefined });
			const name = hint.role === 'image' ? `img${++n}.${hint.extension ?? 'bin'}` : `ink${++n}.svg`;
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
	assert.equal(unsure.markdown, 'Above.\n\n![](<_附件/img1.png>)\n\n> [!info]- 荧光笔笔迹（位置为估算）\n> ![](<_附件/ink2.svg>)');
	assert.deepEqual(unsure.saved.map(s => s.role), ['image', 'ink']);
});
