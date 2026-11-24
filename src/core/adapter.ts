// Maps the parser's JSON (one section) to the semantic model.

import type { AssetData, Element, EmbeddedFile, Image, Ink, InkStroke, Outline, Page, Paragraph, Section, Tag, TextRun } from './model.ts';
import { MIN_PEN_OPACITY } from './model.ts';
import { composedText } from './names.ts';
import type { Strings } from './strings.ts';
import { emphasisColor } from './render/color.ts';
import { strokesToSvg } from './render/ink-svg.ts';
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
	const files = new Map<string, EmbeddedFile>();
	const images: Image[] = [];
	const walk = (x: Json) => {
		if (!x || typeof x !== 'object') return;
		if (Array.isArray(x)) {
			x.forEach(walk);
			return;
		}
		if (x.kind === 'embedded-file' && x.fileName && /\.pdf$/i.test(x.fileName)) files.set(x.fileName.normalize('NFC'), x);
		if (x.kind === 'image' && x.printoutPage) images.push(x);
		for (const k of ['children', 'outlines', 'directContent', 'rows', 'cells']) if (x[k]) walk(x[k]);
	};
	walk(page);
	for (const image of images) {
		const file = image.printoutName ? files.get(image.printoutName.normalize('NFC')) : undefined;
		if (file) image.printoutOf = file;
	}
}

function inkColor(value: number | null | undefined): string {
	if (value === null || value === undefined) return '#000000';
	const r = value & 0xff, g = (value >> 8) & 0xff, b = (value >> 16) & 0xff;
	return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Decodes strokes (points after the first are deltas) into `unit`s, offset by (dx, dy). Keeps highlighter strokes. */
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
		return { points, color: inkColor(s.color), width: Math.max(s.width ?? 0, 1) / unit, opacity: (255 - (s.transparency ?? 0)) / 255 };
	});
}

const isPen = (stroke: InkStroke) => stroke.opacity >= MIN_PEN_OPACITY;

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

function placeOf(o: Json) {
	return o.x === null || o.x === undefined ? undefined : { x: o.x, y: o.y ?? undefined, width: o.w ?? undefined };
}

export class Adapter {
	readonly stats: AdapterStats = { ink: 0, highlighterOnly: 0 };
	private readonly strings: Strings;

	constructor(strings: Strings) {
		this.strings = strings;
	}

	section(json: Json): Section {
		return { name: composedText(json.name ?? ''), pages: (json.pages as Json[]).map(p => this.page(p)) };
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
		for (const c of p.contents as Json[]) {
			if (c.type === 'outline') {
				const outline: Outline = { kind: 'outline', children: this.items(c.items) };
				const place = placeOf(c);
				if (place) outline.place = place;
				page.outlines.push(outline);
			}
			else {
				const element = this.content(c, page);
				if (element) page.directContent.push(element);
			}
		}
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
			case 'table':
				return {
					kind: 'table',
					rows: (c.rows as Json[][]).map(cells => ({ cells: cells.map(elements => ({ children: this.items(elements) })) })),
				};
			case 'image': {
				const extension: string | undefined = c.asset?.asset?.split('.').pop();
				// File names are names: composed like the others (the parser gives them as stored).
				const fileName: string | undefined = c.fileName ? composedText(c.fileName) : undefined;
				const image: Image = { kind: 'image', fileName, extension, data: stored(c.asset) };
				if (typeof c.alt === 'string' && c.alt.trim() !== '') image.alt = composedText(c.alt);
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
				return image;
			}
			case 'file': {
				const fileName: string | undefined = c.fileName ? composedText(c.fileName) : undefined;
				if (!c.asset) {
					const missing: Paragraph = {
						kind: 'paragraph',
						children: [],
						runs: [{ text: this.strings.missingAttachment(fileName ?? this.strings.unnamedFile), italic: true }],
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
		// Ink written inside a line of text: drawn on its own, right after the paragraph.
		for (const ink of (c.inks ?? []) as Json[]) {
			const pen = inkStrokes(ink, HIMETRIC_PER_PX).filter(isPen);
			if (!pen.length) {
				this.stats.highlighterOnly++;
				continue;
			}
			const svg = strokesToSvg(pen.map(stroke => ({ ...stroke, width: Math.max(1, stroke.width) })));
			if (!svg) continue;
			paragraph.children.push({ kind: 'image', extension: 'svg', inkSvg: true, data: { kind: 'inline', bytes: new TextEncoder().encode(svg) } });
		}
		return paragraph;
	}
}
