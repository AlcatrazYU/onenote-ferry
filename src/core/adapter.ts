// Maps the parser's JSON (one section) to the semantic model.

import type { AssetData, Element, EmbeddedFile, Image, Ink, InkStroke, Outline, Page, Paragraph, ParagraphLayout, Placement, Section, Tag, TextRun } from './model.ts';
import { MIN_PEN_OPACITY } from './model.ts';
import { composedText } from './names.ts';
import type { Strings } from './strings.ts';
import { emphasisColor } from './render/color.ts';
import { strokesToSvg } from './render/ink-svg.ts';
import { drawingUnder } from './render/ink-layout.ts';
import { officeMathToLatex } from './render/math.ts';

/** Ink at page level is in HIMETRIC (1/2540 inch); the model uses half inches. */
const HIMETRIC_PER_HALF_INCH = 1270;
/** Ink inside a line of text is drawn straight in CSS pixels. */
const HIMETRIC_PER_PX = 2540 / 96;

const OBJECT_REPLACEMENT = /\uFFFC/g;
/** OneNote's field marker, in front of Word-style `HYPERLINK "url"` field codes. */
const FIELD_MARKER = '\uFDDF';

/** Note tag shapes the parser names, as OneNote's NoteTagShape numbers. */
const CALLOUT_SHAPE: Record<string, number> = { YellowStar: 13, QuestionMark: 15, HighPriority: 17, LightBulb: 21 };

type Json = any;

type RawRun = TextRun & { link?: boolean };

export interface AdapterStats {
	/** Ink objects seen at page level. */
	ink: number;
	/** Ink objects with only highlighter strokes, which produce no drawing. */
	highlighterOnly: number;
}

/**
 * Hyperlinks arrive as Word-style field codes that often span runs: the marker, the
 * instruction and the shown text each get one. This strips the codes and puts the URL on
 * the first non-blank run of shown text after them.
 *
 * Adapted from Obsidian Importer (MIT), src/formats/onenote-file/semantic/map.ts at commit
 * fa9444a. See THIRD_PARTY_LICENSES.md.
 */
export function liftHyperlinkFields(runs: TextRun[]): void {
	const full = runs.map(run => run.text).join('');
	if (!full.includes(FIELD_MARKER)) return;

	const pattern = new RegExp(`${FIELD_MARKER}\\s*HYPERLINK\\s*"([^"]*)"\\s*`, 'g');
	const fields: { start: number, end: number, url: string }[] = [];
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(full))) fields.push({ start: match.index, end: match.index + match[0].length, url: match[1] });

	const out: TextRun[] = [];
	let position = 0;
	let pending: string | undefined;
	for (const run of runs) {
		const runStart = position, runEnd = position + run.text.length;
		position = runEnd;
		const cuts = new Set<number>([runStart, runEnd]);
		for (const field of fields) {
			if (field.start > runStart && field.start < runEnd) cuts.add(field.start);
			if (field.end > runStart && field.end < runEnd) cuts.add(field.end);
		}
		const points = [...cuts].sort((a, b) => a - b);
		if (points.length === 2 && runStart === runEnd) {
			out.push(run);
			continue;
		}
		for (let k = 0; k + 1 < points.length; k++) {
			const a = points[k], b = points[k + 1];
			const field = fields.find(f => a >= f.start && a < f.end);
			if (field) {
				if (b >= field.end) pending = field.url;
				continue;
			}
			const segment: TextRun = { ...run, text: full.slice(a, b).split(FIELD_MARKER).join('') };
			if (pending !== undefined && segment.text.trim() !== '') {
				segment.hyperlinkUrl ??= pending;
				pending = undefined;
			}
			out.push(segment);
		}
	}
	runs.splice(0, runs.length, ...out);
}

/**
 * OneNote inserts a file "as printout" twice: the file itself, and one image per page. On Windows
 * each image holds the whole document (XPS or PDF) plus a page number; on the Mac each is a picture
 * of one page. Obsidian cannot show XPS, and a page picture cannot be searched, but Obsidian can
 * show a page of a PDF, so when the original PDF sits on the same page the images point at it.
 */
export function linkPrintouts(page: Page): void {
	const { files, images } = printoutsOf(page);
	for (const image of images) {
		const file = image.printoutName ? files.get(image.printoutName.normalize('NFC')) : undefined;
		if (!file) continue;
		image.originalOnPage = true;
		if (/\.pdf$/i.test(file.fileName ?? '')) image.printoutOf = file;
	}
}

/**
 * A printout whose original PDF is not on its page but elsewhere in the section points at that one
 * (§11.5 item 77), when the section holds one PDF of that name only: two different files of one
 * name could be two documents.
 */
export function linkPrintoutsAcross(pages: Page[]): void {
	const pdfs = new Map<string, EmbeddedFile[]>();
	const waiting: Image[] = [];
	for (const page of pages) {
		const { files, images } = printoutsOf(page);
		for (const [name, file] of files) {
			if (!/\.pdf$/i.test(name)) continue;
			if (!pdfs.has(name)) pdfs.set(name, []);
			pdfs.get(name)!.push(file);
		}
		waiting.push(...images.filter(image => !image.printoutOf && image.printoutName));
	}
	const sameData = (a: EmbeddedFile, b: EmbeddedFile) => a.data?.kind === 'stored' && b.data?.kind === 'stored' && a.data.key === b.data.key;
	for (const image of waiting) {
		const found = pdfs.get(image.printoutName!.normalize('NFC'));
		if (found?.length && found.every(file => sameData(file, found[0]))) image.printoutOf = found[0];
	}
}

/** The files on a page by name (the last of each name, as before) and its printout pictures. */
function printoutsOf(page: Page): { files: Map<string, EmbeddedFile>, images: Image[] } {
	const files = new Map<string, EmbeddedFile>();
	const images: Image[] = [];
	const walk = (x: Json) => {
		if (!x || typeof x !== 'object') return;
		if (Array.isArray(x)) {
			x.forEach(walk);
			return;
		}
		if (x.kind === 'embedded-file' && x.fileName) files.set(x.fileName.normalize('NFC'), x);
		if (x.kind === 'image' && x.printoutPage) images.push(x);
		for (const k of ['children', 'outlines', 'directContent', 'rows', 'cells']) if (x[k]) walk(x[k]);
	};
	walk(page);
	return { files, images };
}

function inkColor(value: number | null | undefined): string {
	if (value === null || value === undefined) return '#000000';
	const r = value & 0xff, g = (value >> 8) & 0xff, b = (value >> 16) & 0xff;
	return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Decodes strokes (points after the first are deltas) into `unit`s, offset by (dx, dy). Keeps
 * highlighter strokes, whose broad side is the larger of the tip's width and height.
 */
function inkStrokes(ink: Json, unit: number, dx = 0, dy = 0): InkStroke[] {
	return (ink.strokes as Json[]).map(s => {
		let x = 0, y = 0;
		const points = (s.points as number[][]).map((p, i) => {
			if (i === 0) {
				x = p[0];
				y = p[1];
			}
			else {
				x += p[0];
				y += p[1];
			}
			return { x: dx + x / unit, y: dy + y / unit };
		});
		const opacity = (255 - (s.transparency ?? 0)) / 255;
		const tip = opacity < MIN_PEN_OPACITY ? Math.max(s.width ?? 0, s.height ?? 0) : s.width ?? 0;
		return { points, color: inkColor(s.color), width: Math.max(tip, 1) / unit, opacity };
	});
}

const isPen = (stroke: InkStroke) => stroke.opacity >= MIN_PEN_OPACITY;

/**
 * Ink inside a line of text, in page positions (half inches). Its points are mostly in page positions
 * already, but some come from the corner of their text box (seen for a second piece of ink in one
 * line, and for highlighter alone in a text box): whichever reading puts the ink nearer its text box.
 */
/** The box around points, counted one by one (a spread into Math.min fails on hundreds of thousands, §11.5 item 79). */
function bounds(points: { x: number, y: number }[]): { left: number, right: number, top: number, bottom: number } {
	let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
	for (const p of points) {
		if (p.x < left) left = p.x;
		if (p.x > right) right = p.x;
		if (p.y < top) top = p.y;
		if (p.y > bottom) bottom = p.y;
	}
	return { left, right, top, bottom };
}

/** `box`: the box the ink was drawn in, if any (Json is any, undefined included). */
function inPage(json: Json, box: Json): InkStroke[] {
	const strokes = inkStrokes(json, HIMETRIC_PER_HALF_INCH);
	const x = box?.x, y = box?.y;
	if (typeof x !== 'number' || typeof y !== 'number') return strokes;
	const points = strokes.flatMap(stroke => stroke.points);
	if (!points.length) return strokes;
	const { left, right, top, bottom } = bounds(points);
	const w = box?.w ?? 0, h = Math.max(box?.h ?? 0, 0.6);
	const away = (dx: number, dy: number) => Math.max(0, x - (right + dx), left + dx - (x + w), y - (bottom + dy), top + dy - (y + h));
	return away(x, y) < away(0, 0) ? inkStrokes(json, HIMETRIC_PER_HALF_INCH, x, y) : strokes;
}

/**
 * The handwriting of a text box that holds nothing else (no text, no picture, no file, no table,
 * no tag such as a to-do box, no list item), or undefined. Ink inside a line of text stands in the
 * text as an object replacement character.
 */
function inkOnly(outline: Json): Json[] | undefined {
	const inks: Json[] = [];
	const visit = (items: Json[] | undefined): boolean => {
		for (const item of items ?? []) {
			if (item.type === 'element') {
				if (item.list || !visit(item.contents) || !visit(item.children)) return false;
			}
			else if (item.type === 'rich') {
				const text = ((item.runs ?? []) as Json[]).map(r => r.text ?? '').join('');
				if (text.replace(/[\uFFFC\s]/g, '') !== '' || (Array.isArray(item.tags) ? item.tags.length > 0 : !!item.tags)) return false;
				inks.push(...((item.inks ?? []) as Json[]));
			}
			else return false;
		}
		return true;
	};
	return visit(outline.items) && inks.length ? inks : undefined;
}

function colorOf(value: string | null | undefined, ignore: string[]): string | undefined {
	if (!value) return undefined;
	const v = value.toLowerCase();
	return ignore.includes(v) ? undefined : v;
}

function run(r: Json): RawRun {
	return {
		text: r.latex ?? r.text ?? '',
		bold: r.bold || undefined,
		italic: r.italic || undefined,
		underline: r.underline || undefined,
		strikethrough: r.strike || undefined,
		superscript: r.sup || undefined,
		subscript: r.sub || undefined,
		hyperlinkUrl: r.href ?? undefined,
		// An empty piece of an equation (an empty argument) is still part of it.
		math: r.latex !== null && r.latex !== undefined ? true : undefined,
		// A white background is the page, not a highlight.
		highlight: colorOf(r.highlight, ['#ffffff']),
		color: emphasisColor(r.color ?? undefined),
		link: r.link || undefined,
	};
}

function tags(list: Json[] | null | undefined): Tag[] | undefined {
	if (!list?.length) return undefined;
	return list.map(t => ({ checkable: !!t.checkable, completed: !!t.completed, label: t.label || undefined, shape: t.checkable ? 1 : CALLOUT_SHAPE[t.shape] }));
}

function stored(asset: Json): AssetData | undefined {
	if (!asset?.asset) return undefined;
	return { kind: 'stored', key: asset.asset, size: asset.size ?? 0 };
}

/** A paragraph's font size (the first run's, else its style's; in points) and spacing, when known. */
function layoutOf(c: Json): ParagraphLayout | undefined {
	const runSize = (c.runs as Json[] | undefined)?.find(r => typeof r.size === 'number')?.size;
	const halfPoints: number | undefined = runSize ?? c.para?.size ?? undefined;
	const layout: ParagraphLayout = {};
	if (typeof halfPoints === 'number' && halfPoints > 0) layout.fontSize = halfPoints / 2;
	if (typeof c.para?.before === 'number' && c.para.before > 0) layout.spaceBefore = c.para.before;
	if (typeof c.para?.after === 'number' && c.para.after > 0) layout.spaceAfter = c.para.after;
	if (typeof c.para?.lineExact === 'number' && c.para.lineExact > 0) layout.lineSpacing = c.para.lineExact;
	return Object.keys(layout).length ? layout : undefined;
}

function placeOf(o: Json): Placement | undefined {
	return o.x === null || o.x === undefined ? undefined : { x: o.x, y: o.y ?? undefined, width: o.w ?? undefined };
}

export class Adapter {
	readonly stats: AdapterStats = { ink: 0, highlighterOnly: 0 };
	private readonly strings: Strings;
	/** The page being read: highlighter ink found inside its text boxes is kept on it. */
	private current?: Page;
	/** The text box being read (its place, for ink inside its lines). */
	private box?: Json;

	constructor(strings: Strings) {
		this.strings = strings;
	}

	section(json: Json): Section {
		const pages = (json.pages as Json[]).map(p => this.page(p));
		linkPrintoutsAcross(pages);
		return { name: composedText(json.name ?? ''), pages };
	}

	page(p: Json): Page {
		const page: Page = {
			id: p.id,
			title: composedText(p.title ?? ''),
			level: Math.max(0, (p.level ?? 1) - 1),
			createdUtc: p.created ? new Date(p.created * 1000) : undefined,
			lastModifiedUtc: p.updated ? new Date(p.updated * 1000) : undefined,
			isConflictPage: false,
			isDeleted: false,
			outlines: [],
			directContent: [],
		};
		this.current = page;
		for (const c of p.contents as Json[]) {
			if (c.type === 'outline') {
				// A text box with nothing in it but handwriting (OneNote makes one where a pen taps or
				// writes in an empty spot): its ink is the page's own, where it was written (§11.5 item 71).
				const inks = inkOnly(c);
				this.box = c;
				// It keeps its place in the reading order, empty (the columns of the page stay as they were).
				const outline: Outline = { kind: 'outline', children: inks ? [] : this.items(c.items) };
				this.box = undefined;
				if (inks) for (const ink of inks) this.looseInk(page, ink, c);
				const place = placeOf(c);
				if (place) outline.place = place;
				// Its stored height says what its content took only when the user sized it (§11.5 item 67).
				if (place && c.bySize && typeof c.h === 'number') {
					place.height = c.h;
					outline.sizedByUser = true;
				}
				page.outlines.push(outline);
			}
			else {
				const element = this.content(c, page);
				if (element) page.directContent.push(element);
			}
		}
		this.current = undefined;
		linkPrintouts(page);
		return page;
	}

	private items(list: Json[]): Element[] {
		return list.map(x => this.item(x)).filter((e): e is Element => !!e);
	}

	private item(i: Json): Element | undefined {
		if (i.type === 'group') return { kind: 'outline', children: this.items(i.items) };
		if (i.type !== 'element') return this.content(i);
		const contents = (i.contents as Json[]).map(c => this.content(c)).filter((e): e is Element => !!e);
		const children = this.items(i.children);
		const format: string | undefined = i.list?.format;
		const list = i.list ? { level: Math.max(0, (i.level ?? 1) - 1), ordered: (format ?? '').includes('\uFFFD'), format: format || undefined } : undefined;
		const primary = contents[0];
		if (primary && primary.kind === 'paragraph') {
			primary.list = list;
			primary.children.push(...contents.slice(1), ...children);
			return primary;
		}
		if (primary) return { kind: 'outline', list, children: [...contents, ...children] };
		return { kind: 'paragraph', runs: [], children, list };
	}

	/** `page` is given for content placed straight on the page, where highlighter-only ink is kept aside. */
	private content(c: Json, page?: Page): Element | undefined {
		switch (c.type) {
			case 'rich': return this.paragraph(c);
			case 'table': {
				const widths = Array.isArray(c.w) && c.w.every((w: unknown) => typeof w === 'number' && w > 0) ? c.w as number[] : undefined;
				return {
					kind: 'table',
					rows: (c.rows as Json[][]).map(cells => ({ cells: cells.map(elements => ({ children: this.items(elements) })) })),
					...(widths?.length ? { columnWidths: widths } : {}),
				};
			}
			case 'image': {
				const extension: string | undefined = c.asset?.asset?.split('.').pop();
				// File names are names: composed like the others (the parser gives them as stored).
				const fileName: string | undefined = c.fileName ? composedText(c.fileName) : undefined;
				const image: Image = { kind: 'image', fileName, extension, data: stored(c.asset) };
				if (typeof c.alt === 'string' && c.alt.trim() !== '') image.alt = composedText(c.alt);
				if (typeof c.ocr === 'string' && c.ocr.trim() !== '') image.recognizedText = composedText(c.ocr);
				if (typeof c.page === 'number' && /^(xps|pdf)$/i.test(extension ?? '')) {
					// Windows: a printout keeps the whole document (XPS or PDF) and shows one page of it (0-based).
					image.printoutPage = c.page + 1;
					if (fileName) image.printoutName = fileName;
				}
				else if (typeof c.page === 'number') {
					// Mac: each printout page is its own picture, named `<document>_<page>.pdf` (1-based).
					const mac = /^(.+)_(\d+)\.pdf$/i.exec(fileName ?? '');
					if (mac && Number(mac[2]) === c.page) {
						image.printoutPage = c.page;
						image.printoutName = `${mac[1]}.pdf`;
					}
				}
				const place = placeOf(c);
				if (place) image.place = place;
				if (typeof c.w === 'number' && c.w > 0) image.size = { width: c.w, ...(typeof c.h === 'number' && c.h > 0 ? { height: c.h } : {}) };
				return image;
			}
			case 'file': {
				const fileName: string | undefined = c.fileName ? composedText(c.fileName) : undefined;
				if (!c.asset) {
					const missing: Paragraph = {
						kind: 'paragraph',
						children: [],
						runs: [{ text: this.strings.missingAttachment(fileName ?? this.strings.unnamedFile), italic: true }],
						missingFile: fileName ?? this.strings.unnamedFile,
					};
					return missing;
				}
				const extension: string | undefined = c.asset?.asset?.split('.').pop();
				const file: EmbeddedFile = { kind: 'embedded-file', fileName, extension, data: stored(c.asset) };
				const place = placeOf(c);
				if (place) file.place = place;
				return file;
			}
			case 'ink': {
				this.stats.ink++;
				const ink: Ink = { kind: 'ink', strokes: inkStrokes(c, HIMETRIC_PER_HALF_INCH, c.x ?? 0, c.y ?? 0) };
				// Where it sits on the page: the strokes are in page positions already.
				const points = ink.strokes.flatMap(stroke => stroke.points);
				if (page && points.length) {
					const { left, right, top } = bounds(points);
					ink.place = { x: left, y: top, width: right - left };
				}
				if (!ink.strokes.some(isPen)) {
					// Only highlighter: draws nothing today, so it takes no place in the reading order,
					// but it is kept on the page for a later "export highlighter ink" option.
					this.stats.highlighterOnly++;
					if (page) (page.highlighterInk ??= []).push(ink);
					return undefined;
				}
				return ink;
			}
			default:
				return undefined;
		}
	}

	/** Handwriting of a text box with nothing else in it, as ink on the page (§11.5 item 71). */
	private looseInk(page: Page, json: Json, box: Json): void {
		this.stats.ink++;
		const strokes = inPage(json, box);
		const all = strokes.flatMap(stroke => stroke.points);
		if (!all.length) return;
		const { left, right, top } = bounds(all);
		const ink: Ink = { kind: 'ink', strokes, place: { x: left, y: top, width: right - left } };
		if (!strokes.some(isPen)) {
			this.stats.highlighterOnly++;
			(page.highlighterInk ??= []).push(ink);
		}
		else page.directContent.push(ink);
	}

	private paragraph(c: Json): Paragraph {
		// An equation arrives as one run per piece of it: joined, then translated to LaTeX once.
		const runs: RawRun[] = [];
		for (const r of (c.runs as Json[]).map(run)) {
			const last = runs[runs.length - 1];
			if (r.math && last?.math) last.text += r.text;
			else runs.push(r);
		}
		for (const r of runs) if (r.math) r.text = officeMathToLatex(r.text);
		for (const r of runs) r.text = r.text.replace(OBJECT_REPLACEMENT, '');
		liftHyperlinkFields(runs);
		// Shown text in composed form; link targets (now in hyperlinkUrl) stay as written. A combining
		// mark belongs to the character before it, even when a formatting change falls between them.
		let base: RawRun | undefined;
		for (const r of runs) {
			const marks = base ? /^\p{M}+/u.exec(r.text)?.[0] : undefined;
			if (base && marks) {
				base.text += marks;
				r.text = r.text.slice(marks.length);
			}
			if (r.text !== '') base = r;
		}
		for (const r of runs) r.text = composedText(r.text);
		// A link's shown text may span several runs (e.g. a font change inside it): carry the URL on.
		let previous: RawRun | undefined;
		for (const r of runs) {
			if (r.text === '') continue;
			if (r.link && !r.hyperlinkUrl && previous?.link && previous.hyperlinkUrl) r.hyperlinkUrl = previous.hyperlinkUrl;
			previous = r;
		}
		for (const r of runs) delete r.link;
		const paragraph: Paragraph = { kind: 'paragraph', runs, children: [], styleId: c.styleId ?? undefined, tags: tags(c.tags) };
		const layout = layoutOf(c);
		if (layout) paragraph.layout = layout;
		// Ink written inside a line of text: drawn on its own, right after the paragraph.
		for (const ink of (c.inks ?? []) as Json[]) {
			const strokes = inkStrokes(ink, HIMETRIC_PER_PX);
			const pen = strokes.filter(isPen);
			if (!pen.length) {
				this.stats.highlighterOnly++;
				// Highlighter alone, kept in a paragraph of a text box: its strokes are where they were
				// drawn on the page (OneNote puts them there when they are drawn over a text box).
				// Kept with the page's highlighter ink, to go onto what it was drawn over (§11.5 item 67).
				if (this.current) (this.current.highlighterInk ??= []).push({ kind: 'ink', strokes: inPage(ink, this.box) });
				continue;
			}
			// Highlighter strokes on this handwriting are drawn with it (§11.5 item 67).
			const shown = strokes.filter(stroke => isPen(stroke) || drawingUnder(stroke, [pen]) === 0);
			const svg = strokesToSvg(shown.map(stroke => ({ ...stroke, width: Math.max(1, stroke.width) })));
			if (!svg) continue;
			paragraph.children.push({ kind: 'image', extension: 'svg', inkSvg: true, data: { kind: 'inline', bytes: new TextEncoder().encode(svg) } });
		}
		return paragraph;
	}
}
