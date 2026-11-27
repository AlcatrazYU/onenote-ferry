// Text on Windows printout pages drawn by glyph number (src/core/render/truetype.ts and glyphRun in
// src/core/render/xps.ts, §11.5 item 77). The font here is built by the test: a few glyphs, a
// character map, and one substitution, enough to check outlines, placement and the character check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTrueType } from '../src/core/render/truetype.ts';
import type { Font } from '../src/core/render/truetype.ts';
import { glyphRun } from '../src/core/render/xps.ts';
import { buildFont } from './font-writer.ts';
import type { Point } from './font-writer.ts';

// Glyphs: 0 nothing; 1 a square; 2 a dot of control points only; 3 glyph 1 moved right; 4 another
// form of glyph 1; 5 a square placed by a left side bearing other than its left edge; 6 a space;
// 7 a square no character maps to; 8 the ligature of A and B.
const SQUARE: Point[] = [[100, 0, true], [300, 0, true], [300, 200, true], [100, 200, true]];
const FONT = readTrueType(buildFont([
	undefined,
	{ contours: [SQUARE] },
	{ contours: [[[200, 100, false], [200, 200, false], [100, 200, false], [100, 100, false]]] },
	{ parts: [{ glyph: 1, dx: 500, dy: 0 }] },
	{ contours: [[[100, 0, true], [250, 0, true], [250, 200, true], [100, 200, true]]] },
	{ contours: [SQUARE], lsb: 150 },
	undefined,
	{ contours: [SQUARE] },
	{ contours: [SQUARE] },
], { 0x41: 1, 0x42: 2, 0x43: 3, 0x45: 5, 0x20: 6 }, [500, 400, 300, 900, 380, 400, 250, 400, 700], { single: { 1: 4 }, multiple: { 5: [1, 2] }, ligatures: [{ components: [1, 2], glyph: 8 }] }))!;

test('outlines: a square as drawn; a dot of control points only goes through every one of them; a composite moved', () => {
	assert.equal(FONT.unitsPerEm, 1000);
	assert.equal(FONT.outline(1), 'M100 0L300 0L300 200L100 200L100 0Z');
	// Starts between the last control point and the first, then one curve per control point.
	assert.equal(FONT.outline(2), 'M150 100Q200 100 200 150Q200 200 150 200Q100 200 100 150Q100 100 150 100Z');
	assert.equal(FONT.outline(3), 'M600 0L800 0L800 200L600 200L600 0Z');
	assert.equal(FONT.outline(6), '');
	assert.equal(FONT.outline(99), undefined);
});

test('a glyph whose left side bearing is not its left edge is moved to it, as renderers place it', () => {
	assert.equal(FONT.outline(5), 'M150 0L350 0L350 200L150 200L150 0Z');
});

test('the character map, advances, and the forms a substitution gives', () => {
	assert.deepEqual([FONT.glyphOf(0x41), FONT.glyphOf(0x42), FONT.glyphOf(0x20), FONT.glyphOf(0x5a)], [1, 2, 6, 0]);
	assert.deepEqual([FONT.advance(1), FONT.advance(6)], [400, 250]);
	assert.equal(FONT.isFormOf(4, 1), true);
	assert.equal(FONT.isFormOf(1, 4), false);
	assert.equal(FONT.isFormOf(2, 1), false);
});

const glyphsOf = (font: Font, text: string | undefined, indices: string | undefined) => glyphRun(font, text, indices, 20).map(g => [g.glyph, Math.round(g.x * 100) / 100]);

test('glyphs are placed by the advances given, else the font\'s; characters past the indices from the character map', () => {
	// 20 units em: advance 50 (hundredths of em) is 10 units; the font's advance 400/1000 em is 8.
	assert.deepEqual(glyphsOf(FONT, 'AB', '1,50;2'), [[1, 0], [2, 10]]);
	assert.deepEqual(glyphsOf(FONT, 'ABA', '1'), [[1, 0], [2, 8], [1, 14]]);
	assert.deepEqual(glyphsOf(FONT, 'A B', ''), [[1, 0], [6, 8], [2, 13]]);
	assert.deepEqual(glyphsOf(FONT, '{}A', undefined), [[1, 0]]);
});

test('the check: a glyph number must be its character\'s glyph, or a form of it the font gives', () => {
	assert.deepEqual(glyphsOf(FONT, 'A', '4'), [[4, 0]]);
	assert.throws(() => glyphsOf(FONT, 'A', '2'), /not its character/);
	assert.throws(() => glyphsOf(FONT, 'Z', ''), /character without a glyph/);
	assert.throws(() => glyphsOf(FONT, 'A', '42'), /outside the font/);
});

test('without characters given, a glyph must be the glyph of a character in the font, or a form of one', () => {
	assert.deepEqual([FONT.charactersOf(1), FONT.charactersOf(4), FONT.charactersOf(7)], [[0x41], [0x41], []]);
	assert.deepEqual(glyphsOf(FONT, undefined, '4;6'), [[4, 0], [6, 7.6]]);
	assert.throws(() => glyphsOf(FONT, undefined, '7'), /of no character/);
	// Past the characters given, the same.
	assert.deepEqual(glyphsOf(FONT, 'A', '1;4'), [[1, 0], [4, 8]]);
	assert.throws(() => glyphsOf(FONT, 'A', '1;7'), /of no character/);
});

test('several characters in one glyph, or one character in several: only as the font\'s own rules make them', () => {
	assert.deepEqual(glyphsOf(FONT, 'AB', '(2:1)8'), [[8, 0]]);
	assert.throws(() => glyphsOf(FONT, 'AB', '(2:1)1'), /cannot be checked/);
	assert.throws(() => glyphsOf(FONT, 'BA', '(2:1)8'), /cannot be checked/);
	assert.deepEqual(glyphsOf(FONT, 'E', '(1:2)1;2'), [[1, 0], [2, 8]]);
	assert.throws(() => glyphsOf(FONT, 'A', '(1:2)1;2'), /cannot be checked/);
	// As many characters as glyphs: each its own.
	assert.deepEqual(glyphsOf(FONT, 'AB', '(2:2)4;2'), [[4, 0], [2, 7.6]]);
	assert.throws(() => glyphsOf(FONT, 'AB', '(2:2)2;1'), /not its character/);
});
