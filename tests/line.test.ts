// The thin line along the OneDrive row: progress when it can be told, sliding when not, only
// forward within one measure, and no quick back-and-forth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLine } from '../src/plugin/line.ts';
import type { LineMeasure, LineShown } from '../src/plugin/line.ts';

const HOLD = 400;

/** Feeds the line one moment after another, as the window does, answering what it painted each time. */
function run(steps: [ms: number, measure: LineMeasure, fraction: number | undefined | null][]) {
	let shown: LineShown | undefined;
	return steps.map(([ms, measure, fraction]) => {
		const next = nextLine(shown, measure, fraction, ms, HOLD);
		shown = next.shown;
		return next.paint.mode === 'bar' ? `bar ${next.paint.value}` : next.paint.mode;
	});
}

test('a check slides until its first count, then only goes forward: no sliding again, no running back', () => {
	assert.deepEqual(run([
		[0, 'check', undefined],
		[1_000, 'check', 0.1],
		[2_000, 'check', 0.05],
		[3_000, 'check', undefined],
		[4_000, 'check', 0.5],
		[5_000, 'none', null],
	]), ['slide', 'bar 10', 'bar 10', 'bar 10', 'bar 50', 'idle']);
});

test('a change of way soon after the last one waits, and shows once it lasts', () => {
	let shown: LineShown | undefined;
	shown = nextLine(shown, 'check', undefined, 0, HOLD).shown;
	const early = nextLine(shown, 'check', 0.2, 100, HOLD);
	assert.deepEqual(early.paint, { mode: 'slide', value: 30 });
	assert.equal(early.wait, 300);
	const later = nextLine(early.shown, 'check', 0.2, 400, HOLD);
	assert.deepEqual(later.paint, { mode: 'bar', value: 20 });
	assert.equal(later.wait, undefined);
});

test('another measure starts afresh: the reading\'s full line does not hold back a check', () => {
	assert.deepEqual(run([
		[0, 'reading', 0.5],
		[1_000, 'reading', 1],
		[2_000, 'check', undefined],
		[3_000, 'check', 0.3],
	]), ['bar 50', 'bar 100', 'slide', 'bar 30']);
});
