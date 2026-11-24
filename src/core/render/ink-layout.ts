// Where loose handwriting on a page goes: onto the picture it was drawn on, or into the reading
// order as drawings of its own. Pure geometry on page positions (half inches), no output.

import type { InkStroke } from '../model.ts';
import { MIN_PEN_OPACITY } from '../model.ts';

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Strokes closer than this (half inches, about 6 mm) belong to one piece of writing. */
export const STROKE_GAP = 0.5;

export const isHighlighter = (stroke: InkStroke) => stroke.opacity < MIN_PEN_OPACITY;

export function strokeBox(stroke: InkStroke): Box {
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const { x, y } of stroke.points) {
		left = Math.min(left, x);
		right = Math.max(right, x);
		top = Math.min(top, y);
		bottom = Math.max(bottom, y);
	}
	const half = stroke.width / 2;
	return { left: left - half, top: top - half, right: right + half, bottom: bottom + half };
}

export function unionBox(boxes: Box[]): Box {
	return {
		left: Math.min(...boxes.map(b => b.left)),
		top: Math.min(...boxes.map(b => b.top)),
		right: Math.max(...boxes.map(b => b.right)),
		bottom: Math.max(...boxes.map(b => b.bottom)),
	};
}

/** The distance between two boxes along the axis where they are furthest apart (0 when they touch or overlap). */
export function gap(a: Box, b: Box): number {
	return Math.max(0, b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
}

/** Groups strokes that lie within `maxGap` of each other, directly or through other strokes. Keeps the input order inside a group. */
export function clusters<T>(items: T[], boxOf: (item: T) => Box, maxGap = STROKE_GAP): T[][] {
	const boxes = items.map(boxOf);
	const parent = items.map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]];
		return i;
	};
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			if (gap(boxes[i], boxes[j]) <= maxGap) parent[find(i)] = find(j);
		}
	}
	const groups = new Map<number, T[]>();
	items.forEach((item, i) => {
		const root = find(i);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root)!.push(item);
	});
	return [...groups.values()];
}

const inside = (box: Box, x: number, y: number, tolerance = 0.05) =>
	x >= box.left - tolerance && x <= box.right + tolerance && y >= box.top - tolerance && y <= box.bottom + tolerance;

/**
 * Which picture each stroke belongs to (index into `pictures`), or -1 for loose ink.
 * A stroke with at least half of its points on a picture was drawn on it. A stroke beside a
 * picture (in the page margin, level with it) that connects to such strokes, like an arrow
 * out to a note in the margin and the note itself, belongs to the same picture.
 */
export function assignToPictures(strokes: InkStroke[], pictures: Box[]): number[] {
	const owner = strokes.map(stroke => {
		let best = -1, bestCount = 0;
		pictures.forEach((picture, index) => {
			const count = stroke.points.filter(p => inside(picture, p.x, p.y)).length;
			if (count > bestCount) {
				best = index;
				bestCount = count;
			}
		});
		return bestCount * 2 >= stroke.points.length && stroke.points.length > 0 ? best : -1;
	});
	if (!owner.some(o => o >= 0)) return owner;
	const indexed = strokes.map((stroke, index) => ({ index, box: strokeBox(stroke) }));
	for (const group of clusters(indexed, item => item.box)) {
		const owners = new Set(group.map(item => owner[item.index]).filter(o => o >= 0));
		if (owners.size === 0) continue;
		for (const item of group) {
			if (owner[item.index] >= 0) continue;
			// Only beside a picture, level with it: writing above or below it is the page's own.
			const candidates = [...owners].filter(o => item.box.bottom > pictures[o].top && item.box.top < pictures[o].bottom);
			if (candidates.length === 0) continue;
			owner[item.index] = candidates.reduce((a, b) => (gap(item.box, pictures[b]) < gap(item.box, pictures[a]) ? b : a));
		}
	}
	return owner;
}

/** A column of the page's reading order (see readingOrder), with the tops of its members in order. */
export interface ColumnSpan {
	left: number;
	right: number;
	/** Positions of the column's members in the page's reading order, top to bottom, with their tops. */
	members: { order: number, top: number }[];
}

/**
 * Where a piece of loose writing goes in the reading order: the index of the item it comes
 * before (the number of items when it comes last). It joins the column it overlaps most (or the
 * nearest one) and comes before the first member of that column that starts below its middle:
 * writing that reaches up past the top of a text box (a line through its first line of text, a
 * note beside it) still belongs after the box, writing above the box before it.
 */
export function insertionPoint(box: Box, columns: ColumnSpan[], itemCount: number): number {
	if (columns.length === 0) return itemCount;
	const overlap = (c: ColumnSpan) => Math.min(c.right, box.right) - Math.max(c.left, box.left);
	const column = columns.reduce((a, b) => {
		const oa = overlap(a), ob = overlap(b);
		if (oa > 0 || ob > 0) return ob > oa ? b : a;
		return -ob < -oa ? b : a;
	});
	const middle = (box.top + box.bottom) / 2;
	const next = column.members.find(member => member.top > middle);
	if (next) return next.order;
	return column.members[column.members.length - 1].order + 1;
}
