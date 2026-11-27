// Handwriting and highlighter strokes on pictures inside text boxes (§11.5 items 67 and 69;
// Internal-13 §9 to §12).
//
// OneNote keeps where a text box is, but not where each thing inside it is: a screenshot pasted
// under some lines of text sits wherever those lines end. Its place is worked out here from what
// is above it in the box (font sizes, wrapping at the box's width, a line height), then checked
// against the screenshot itself: its rows of text are read from its pixels (the parser's row
// profile, parser/ferry/src/profile.rs), and the picture is moved by less than half a line of its
// own text so that the strokes on it sit on those rows. Rows of printed text are evenly spaced,
// so a place off by a whole line fits as well as the right one: a picture counts as sure only
// when its place cannot be off by that much. Only highlighter strokes along a line of text say where
// its rows are (a pen may underline, circle or write beside them). All the strokes on a picture go
// together: drawn into it when its place is sure; otherwise onto one copy shown folded under it,
// marked as estimated.

import type { Element, Image, InkStroke, Outline } from '../model.ts';
import { assignToPictures, isHighlighter } from './ink-layout.ts';
import type { Box } from './ink-layout.ts';

/** Points per half inch (the model's unit for places). */
const PT = 36;
/** How far each level of a list or of indented paragraphs is moved in, in half inches. */
const INDENT = 0.75;
const DEFAULT_FONT_SIZE = 11;
/** Line height, times the font size, when nothing better is known: the median over 386 text boxes (Internal-13 §11). */
const USUAL_FACTOR = 1.46;
/** Line heights tried for a page (times the font size). */
const FACTORS = Array.from({ length: 17 }, (_, k) => Math.round((1.1 + 0.05 * k) * 100) / 100);
/**
 * How far the line height may still be off, times the font size: when a text box's stored height
 * gives it, and when it does not (about the spread over the maintainer's notes, p10 to p90).
 */
const PINNED_SPREAD = 0.05, FREE_SPREAD = 0.3;
/** Below this, a picture's row profile shows no evenly spaced rows of text. */
const PERIODIC = 0.25;
/** After the move, half the strokes must be this close to the middle of a row (times the row spacing). */
const OFF = 0.2;
/** Profiles are looked at about this many pixels wide (finer ones are averaged down to it). */
const PROFILE_WIDTH = 600;

/** A picture's rows of text as its pixels show them: rows of the profile, their spacing, their middles. */
export interface RowProfile {
	/** Rows in the profile (from the picture's top to its bottom). */
	height: number;
	/** The picture's width over its height. */
	aspect: number;
	/** Rows from one line of text to the next, when there is a clear spacing. */
	pitch?: number;
	/** How clearly the rows repeat at that spacing (0 to 1). */
	periodic: number;
	/** The middle row of each line of text. */
	bands: number[];
}

/** Reads the parser's `[width, height, paper, dark...]` into lines of text. */
export function readProfile(raw: ArrayLike<number>): RowProfile | undefined {
	const width = raw[0] ?? 0, rows = raw[1] ?? 0;
	if (!width || !rows || raw.length < 3 + rows) return undefined;
	// Averaged down to about PROFILE_WIDTH across, as the measurement was done (Internal-13 §11).
	const k = Math.max(1, Math.round(width / PROFILE_WIDTH));
	const dark: number[] = [];
	for (let i = 0; i < rows; i += k) {
		let sum = 0, n = 0;
		for (let j = i; j < Math.min(rows, i + k); j++) {
			sum += raw[3 + j]!;
			n++;
		}
		dark.push(sum / n);
	}
	const n = dark.length;
	const smooth = dark.map((_, i) => {
		const from = Math.max(0, i - 1), to = Math.min(n, i + 2);
		let sum = 0;
		for (let j = from; j < to; j++) sum += dark[j]!;
		return sum / (to - from);
	});
	const mean = smooth.reduce((a, b) => a + b, 0) / n;
	const dev = smooth.map(v => v - mean);
	const variance = dev.reduce((a, v) => a + v * v, 0) || 1e-9;
	let periodic = 0, pitch: number | undefined;
	for (let lag = 6; lag < Math.max(7, Math.floor(n / 3)); lag++) {
		let sum = 0;
		for (let i = 0; i + lag < n; i++) sum += dev[i]! * dev[i + lag]!;
		const ac = sum / variance;
		if (ac > periodic) {
			periodic = ac;
			pitch = lag;
		}
	}
	const bands: number[] = [];
	if (pitch) {
		const r = Math.max(1, Math.floor(pitch / 3));
		let run: number[] = [];
		const close = () => {
			if (run.length) bands.push((run[0]! + run[run.length - 1]!) / 2);
			run = [];
		};
		for (let i = 0; i < n; i++) {
			if (smooth[i]! <= mean) continue;
			let top = true;
			for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
				if (smooth[j]! > smooth[i]!) {
					top = false;
					break;
				}
			}
			if (!top) continue;
			// A run of equally dark rows is one line, at its middle.
			if (run.length && i - run[run.length - 1]! > r) close();
			run.push(i);
		}
		close();
	}
	return { height: n, aspect: width / rows, ...(pitch ? { pitch } : {}), periodic, bands };
}

/** A picture inside a text box, where the layout puts it. */
interface FlowPicture {
	image: Image;
	box: Box;
	/** The text above it in its box, as lines times font size (points): what an error in line height adds up over. */
	emAbove: number;
	/** Its box's line height comes from the box's stored height. */
	pinned: boolean;
	/** Above it in its box: what the layout cannot tell the height of (a file's icon, handwriting, a table with more than a line in a cell, a picture of no known size). Its place is then never sure (§11.5 item 79). */
	unknownAbove: boolean;
	/** Above it: paragraphs of proportional text whose length is near where a line wraps, each a line it may have one more or one fewer of (points). */
	wrapRisk: number;
}

const isWide = (ch: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3FFFD}]/u.test(ch);
/** A character's width in points: CJK full width, Latin about half. */
const widthOf = (ch: string, size: number) => (ch === ' ' ? size * 0.25 : isWide(ch) ? size : size * 0.52);

/** How many lines a paragraph's text takes at a width (points). */
function lineCount(text: string, size: number, width: number): number {
	let lines = 1, x = 0;
	for (const ch of text) {
		const w = widthOf(ch, size);
		if (x + w > width && x > 0) {
			lines++;
			x = 0;
		}
		x += w;
	}
	return lines;
}

/** The picture's size in half inches: as stored, else its width with its pixels' proportions. */
function pictureSize(image: Image, aspects: Map<Image, number>): { width: number, height: number } | undefined {
	const width = image.size?.width;
	if (!width) return undefined;
	const height = image.size?.height ?? (aspects.has(image) ? width / aspects.get(image)! : undefined);
	return height ? { width, height } : undefined;
}

/** Walks a text box's content in reading order, with the indentation level of each element. */
function walk(elements: Element[], level: number, visit: (element: Element, level: number) => void): void {
	for (const element of elements) {
		visit(element, level);
		if (element.kind === 'paragraph') walk(element.children, level + 1, visit);
		else if (element.kind === 'outline') walk(element.children, level, visit);
	}
}

/**
 * The line height (times the font size) a text box's stored height gives, when it can be believed:
 * the user sized the box, it holds enough text to tell, and the result is a line height text has.
 */
function pinnedFactor(outline: Outline, aspects: Map<Image, number>): number | undefined {
	const height = outline.place?.height, width = outline.place?.width;
	if (!outline.sizedByUser || !height || !width) return undefined;
	let em = 0, pictures = 0;
	walk(outline.children, 1, (element, level) => {
		if (element.kind === 'paragraph') {
			const size = element.layout?.fontSize ?? DEFAULT_FONT_SIZE;
			em += lineCount(element.runs.map(run => run.text).join(''), size, (width - (level - 1) * INDENT) * PT) * size;
		}
		else if (element.kind === 'image') pictures += pictureSize(element, aspects)?.height ?? 0;
		else if (element.kind === 'table') em += element.rows.length * DEFAULT_FONT_SIZE;
	});
	if (em < 33 || height <= pictures) return undefined;
	const factor = (height - pictures) * PT / em;
	return factor >= 1.1 && factor <= 2 ? factor : undefined;
}

/** Where the pictures inside the text boxes sit, with a line height for boxes that do not give their own. */
function layOut(outlines: Outline[], factor: number, pins: Map<Outline, number | undefined>, aspects: Map<Image, number>): FlowPicture[] {
	const pictures: FlowPicture[] = [];
	for (const outline of outlines) {
		const place = outline.place;
		if (place?.x === undefined || place.y === undefined) continue;
		const own = pins.get(outline);
		const lineFactor = own ?? factor;
		const boxWidth = place.width ?? 13;
		let y = place.y, emAbove = 0, unknownAbove = false, wrapRisk = 0;
		walk(outline.children, 1, (element, level) => {
			const x = place.x! + (level - 1) * INDENT;
			if (element.kind === 'paragraph') {
				const size = element.layout?.fontSize ?? DEFAULT_FONT_SIZE;
				const text = element.runs.map(run => run.text).join('');
				const width = (boxWidth - (level - 1) * INDENT) * PT;
				const lines = lineCount(text, size, width);
				const lineHeight = element.layout?.lineSpacing ?? size * lineFactor;
				y += ((element.layout?.spaceBefore ?? 0) + lines * lineHeight + (element.layout?.spaceAfter ?? 0)) / PT;
				emAbove += lines * size;
				// Latin letters are counted at an average width: near a wrap, a line more or fewer.
				if (/[A-Za-z]/.test(text)) {
					let used = 0;
					for (const ch of text) used += widthOf(ch, size);
					const fill = used / width, part = fill - Math.floor(fill);
					if (fill >= 0.8 && (part <= 0.2 || part >= 0.8)) wrapRisk += lineHeight;
				}
			}
			else if (element.kind === 'image' && !element.place) {
				const size = pictureSize(element, aspects);
				if (!size) {
					unknownAbove = true;
					return;
				}
				pictures.push({ image: element, box: { left: x, top: y, right: x + size.width, bottom: y + size.height }, emAbove, pinned: own !== undefined, unknownAbove, wrapRisk });
				y += size.height;
			}
			else if (element.kind === 'table') {
				y += element.rows.length * DEFAULT_FONT_SIZE * lineFactor / PT;
				emAbove += element.rows.length * DEFAULT_FONT_SIZE;
				if (element.rows.some(row => row.cells.some(cell => cell.children.length > 1 || cell.children.some(child => child.kind !== 'paragraph')))) unknownAbove = true;
			}
			else if (element.kind === 'embedded-file' || element.kind === 'ink') unknownAbove = true;
		});
	}
	return pictures;
}

/** A stroke's middle, and whether it is one along a line of text (not a dot, not a mark down the side or a circle). */
function shape(stroke: InkStroke): { x: number, y: number, along: boolean } {
	let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
	for (const p of stroke.points) {
		left = Math.min(left, p.x);
		right = Math.max(right, p.x);
		top = Math.min(top, p.y);
		bottom = Math.max(bottom, p.y);
	}
	const along = bottom - top <= 2.5 * stroke.width && right - left >= 2 * stroke.width;
	return { x: (left + right) / 2, y: (top + bottom) / 2, along };
}

/** The strokes (by index) whose middle is on each picture. */
function onPictures(pictures: FlowPicture[], middles: { x: number, y: number }[]): Map<number, number[]> {
	const on = new Map<number, number[]>();
	middles.forEach((m, i) => {
		const k = pictures.findIndex(p => m.x >= p.box.left && m.x <= p.box.right && m.y >= p.box.top && m.y <= p.box.bottom);
		if (k < 0) return;
		if (!on.has(k)) on.set(k, []);
		on.get(k)!.push(i);
	});
	return on;
}

/** How far each stroke along a line is from the middle of a row of text, times the row spacing. */
function offsets(picture: FlowPicture, profile: RowProfile, ys: number[], shift = 0): number[] {
	const scale = profile.height / (picture.box.bottom - picture.box.top);
	return ys.map(y => {
		const row = (y - picture.box.top) * scale + shift;
		let best = Infinity;
		for (const band of profile.bands) best = Math.min(best, Math.abs(row - band));
		return best / profile.pitch!;
	});
}

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
};

export interface PlacedMarks {
	image: Image;
	/** Where the picture sits, in the strokes' page positions: as laid out, moved onto its rows when sure. */
	box: Box;
	/** The strokes on it (indexes into the strokes given). */
	strokes: number[];
	/** Its place is sure: the strokes are drawn into it; otherwise onto a copy folded under it. */
	sure: boolean;
}

/**
 * Which pictures inside the page's text boxes the strokes (handwriting and highlighter) lie on, and
 * where those pictures sit. `profileOf` reads a picture's rows of text (undefined when it cannot be read).
 */
export async function placeOnPictures(outlines: Outline[], strokes: InkStroke[], profileOf: (image: Image) => Promise<RowProfile | undefined>): Promise<PlacedMarks[]> {
	if (!strokes.length) return [];
	const profiles = new Map<Image, RowProfile | undefined>();
	const profile = async (image: Image) => {
		if (!profiles.has(image)) profiles.set(image, await profileOf(image));
		return profiles.get(image);
	};
	// A picture without a stored height takes its pixels' proportions.
	const aspects = new Map<Image, number>();
	for (const outline of outlines) {
		walk(outline.children, 1, element => {
			if (element.kind === 'image' && !element.place && element.size?.width && !element.size.height) aspects.set(element, 0);
		});
	}
	for (const image of [...aspects.keys()]) {
		const read = await profile(image);
		if (read) aspects.set(image, read.aspect);
		else aspects.delete(image);
	}
	const pins = new Map(outlines.map(outline => [outline, pinnedFactor(outline, aspects)]));
	const shapes = strokes.map(shape);
	// What lines a picture up with its rows: highlighter strokes along a line of text.
	const aligning = strokes.map((stroke, i) => isHighlighter(stroke) && shapes[i]!.along);

	// The line height that puts the strokes along lines best on rows of text, over the page.
	let factor = USUAL_FACTOR, best = Infinity;
	for (const candidate of FACTORS) {
		const pictures = layOut(outlines, candidate, pins, aspects);
		let cost = 0, n = 0;
		for (const [k, indexes] of onPictures(pictures, shapes)) {
			const read = await profile(pictures[k]!.image);
			const along = indexes.filter(i => aligning[i]);
			if (!read?.pitch || !read.bands.length || !along.length) continue;
			for (const off of offsets(pictures[k]!, read, along.map(i => shapes[i]!.y))) cost += Math.min(off, 0.5);
			n += along.length;
		}
		if (!n) continue;
		const score = cost / n;
		if (score < best - 1e-9 || (Math.abs(score - best) <= 1e-9 && Math.abs(candidate - USUAL_FACTOR) < Math.abs(factor - USUAL_FACTOR))) {
			best = score;
			factor = candidate;
		}
	}

	const pictures = layOut(outlines, factor, pins, aspects);
	// Which picture each stroke is on, by the rule for pictures placed on the page (at least half of
	// its points on it, and a note beside it joined to such strokes), at the places laid out.
	const owners = assignToPictures(strokes, pictures.map(picture => picture.box));
	const on = new Map<number, number[]>();
	owners.forEach((k, i) => {
		if (k < 0) return;
		if (!on.has(k)) on.set(k, []);
		on.get(k)!.push(i);
	});
	const placed: PlacedMarks[] = [];
	for (const [k, indexes] of [...on].sort((a, b) => a[0] - b[0])) {
		const picture = pictures[k]!;
		const read = await profile(picture.image);
		const along = indexes.filter(i => aligning[i]).map(i => shapes[i]!.y);
		const result: PlacedMarks = { image: picture.image, box: picture.box, strokes: indexes, sure: false };
		placed.push(result);
		if (!read?.pitch || read.periodic < PERIODIC || !read.bands.length || !along.length) continue;
		const scale = read.height / (picture.box.bottom - picture.box.top);
		// What the text above it can still add up to, against half a line of its own text; never sure
		// below what the layout cannot measure.
		if (picture.unknownAbove) continue;
		const uncertain = (picture.emAbove * (picture.pinned ? PINNED_SPREAD : FREE_SPREAD) + picture.wrapRisk) / PT * scale;
		if (uncertain >= read.pitch / 2) continue;
		let shift = 0, cost = Infinity;
		for (let s = -read.pitch / 2; s <= read.pitch / 2; s += 0.5) {
			const c = offsets(picture, read, along, s).reduce((a, off) => a + Math.min(off, 0.5), 0);
			if (c < cost - 1e-9 || (Math.abs(c - cost) <= 1e-9 && Math.abs(s) < Math.abs(shift))) {
				cost = c;
				shift = s;
			}
		}
		if (median(offsets(picture, read, along, shift)) > OFF) continue;
		// Moved onto its rows: a row the strokes were `shift` rows above is where they are.
		const move = -shift / scale;
		result.box = { left: picture.box.left, right: picture.box.right, top: picture.box.top + move, bottom: picture.box.bottom + move };
		result.sure = true;
	}
	return placed;
}
