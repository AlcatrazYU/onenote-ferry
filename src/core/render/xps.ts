// Pages of a Windows printout drawn as SVG (§11.5 items 70 and 77), so that ink written on a
// printout page can be drawn over the page itself, as on a picture, and a printout without its PDF
// can be seen.
//
// A Windows printout keeps the whole document as one XPS file (a zip package of XML pages and
// their images); OneNote shows a page of it. A page printed from a scan is made of image strips
// and filled shapes, which SVG draws as they are: XPS path data is SVG path data but for a leading
// fill rule. Text (glyphs) is drawn by the glyph numbers the document gives, from the fonts it
// embeds, each checked against the character it is said to be (see `glyphRun`). Anything else
// (gradients, brushes of other kinds), or text that cannot be checked, is not drawn here: such a
// page is answered with nothing, and is shown as before ("better not shown than shown wrong").
// A page's text is also read out as the document writes it (see `pageText`), drawn or not.

import { entryDataOffset, readZipDirectory } from '../zip.ts';
import type { ZipEntry } from '../zip.ts';
import { base64, pictureInfo } from './picture.ts';
import { readTrueType } from './truetype.ts';
import type { Font } from './truetype.ts';

/** One page as SVG content (what goes inside an `<svg>`), in the page's own units (1/96 inch). */
export interface XpsPage {
	width: number;
	height: number;
	content: string;
}

/** The text of a page as its document writes it (§11.5 item 78). */
export interface PageText {
	/** Line by line: runs of text that go on from one another (along a line, or down a column) joined. */
	text: string;
	/** Only the characters the document writes out, without those found from the fonts, to compare with what OneNote kept. */
	given: string;
}

export interface XpsDocument {
	/** How many pages it has. */
	readonly pages: number;
	/** Page `n` (from 1), or undefined when it cannot be drawn here. */
	page(n: number): Promise<XpsPage | undefined>;
	/** Page `n`, or why it cannot be drawn here. */
	explain(n: number): Promise<{ page?: XpsPage, reason?: string }>;
	/** The text of page `n`; undefined when it has none, or cannot be read. */
	text(n: number): Promise<PageText | undefined>;
}

const decoder = new TextDecoder();

/** The package's parts by name (lower case, no leading slash): a part may be stored in pieces. */
class Package {
	private readonly parts = new Map<string, ZipEntry[]>();
	private readonly bytes: Uint8Array;

	constructor(bytes: Uint8Array, entries: ZipEntry[]) {
		this.bytes = bytes;
		const pieces = new Map<string, { index: number, entry: ZipEntry }[]>();
		for (const entry of entries) {
			const name = entry.name.replace(/^\/+/, '');
			const piece = name.match(/^(.*)\/\[(\d+)\](?:\.last)?\.piece$/i);
			const part = (piece ? piece[1]! : name).toLowerCase();
			if (!pieces.has(part)) pieces.set(part, []);
			pieces.get(part)!.push({ index: piece ? Number(piece[2]) : 0, entry });
		}
		for (const [part, list] of pieces) this.parts.set(part, list.sort((a, b) => a.index - b.index).map(item => item.entry));
	}

	async read(name: string): Promise<Uint8Array | undefined> {
		const entries = this.parts.get(decodeURIComponent(name).replace(/^\/+/, '').toLowerCase());
		if (!entries) return undefined;
		const chunks: Uint8Array[] = [];
		for (const entry of entries) {
			const start = await entryDataOffset({ size: this.bytes.length, read: async (offset, length) => this.bytes.subarray(offset, offset + length) }, entry);
			const stored = this.bytes.subarray(start, start + entry.compressedSize);
			if (entry.method === 0) chunks.push(stored);
			else if (entry.method === 8) chunks.push(await inflate(stored));
			else return undefined;
		}
		const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
		let at = 0;
		for (const chunk of chunks) {
			out.set(chunk, at);
			at += chunk.length;
		}
		return out;
	}

	async text(name: string): Promise<string | undefined> {
		const bytes = await this.read(name);
		return bytes && decoder.decode(bytes);
	}
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A path in the package from a reference in the part at `from`. */
function resolve(from: string, reference: string): string {
	if (reference.startsWith('/')) return reference.slice(1);
	const parts = from.split('/').slice(0, -1);
	for (const part of reference.split('/')) {
		if (part === '..') parts.pop();
		else if (part !== '.') parts.push(part);
	}
	return parts.join('/');
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: '\'', amp: '&' };
/** XML text: named entities and character references (`&#12354;`, `&#x3042;`). */
const unescape = (value: string) => value.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (whole, name: string) => {
	if (!name.startsWith('#')) return ENTITIES[name]!;
	const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
	return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
});

function attributes(text: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of text.matchAll(/([\w.:]+)\s*=\s*"([^"]*)"/g)) found.set(match[1]!, unescape(match[2]!));
	return found;
}

const sources = (xml: string, element: string) => [...xml.matchAll(new RegExp(`<${element}\\b[^>]*\\bSource="([^"]*)"`, 'g'))].map(match => unescape(match[1]!));

/** Opens a printout's XPS document; undefined when it is not one that can be read. */
export async function openXps(bytes: Uint8Array): Promise<XpsDocument | undefined> {
	let pkg: Package;
	try {
		pkg = new Package(bytes, await readZipDirectory({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }));
	}
	catch {
		return undefined;
	}
	try {
		const rels = await pkg.text('_rels/.rels') ?? '';
		const root = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(match => attributes(match[0]))
			.find(rel => /fixedrepresentation$/i.test(rel.get('Type') ?? ''))?.get('Target') ?? 'FixedDocumentSequence.fdseq';
		const sequence = resolve('', root);
		const pages: string[] = [];
		for (const document of sources(await pkg.text(sequence) ?? '', 'DocumentReference')) {
			const path = resolve(sequence, document);
			for (const page of sources(await pkg.text(path) ?? '', 'PageContent')) pages.push(resolve(path, page));
		}
		if (!pages.length) return undefined;
		const fonts = new Map<string, Promise<Font | undefined>>();
		const explain = async (n: number) => {
			const path = pages[n - 1];
			if (path === undefined) return { reason: 'no such page' };
			try {
				const page = await pageSvg(pkg, path, fonts);
				return page ? { page } : { reason: 'not drawn' };
			}
			catch (error) {
				return { reason: error instanceof Error ? error.message : String(error) };
			}
		};
		return {
			pages: pages.length,
			async page(n) {
				return (await explain(n)).page;
			},
			explain,
			async text(n) {
				const path = pages[n - 1];
				return path === undefined ? undefined : pageText(pkg, path, fonts).catch(() => undefined);
			},
		};
	}
	catch {
		return undefined;
	}
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const numbers = (value: string | undefined, count: number) => {
	const parts = (value ?? '').split(/[\s,]+/).filter(Boolean);
	return parts.length === count && parts.every(part => NUMBER.test(part)) ? parts.map(Number) : undefined;
};

/** A transform `a,b,c,d,e,f` as SVG, or undefined when it is not one. */
function matrix(value: string | undefined): string | undefined {
	const m = numbers(value, 6);
	return m && `matrix(${m.join(' ')})`;
}

/** An XPS colour (`#aarrggbb` or `#rrggbb`) as SVG paint and opacity, or undefined when it is of another kind. */
function colour(value: string | undefined): { paint: string, opacity: number } | undefined {
	const hex = value?.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
	if (!hex) return undefined;
	return hex.length === 8 ? { paint: `#${hex.slice(2)}`, opacity: parseInt(hex.slice(0, 2), 16) / 255 } : { paint: `#${hex}`, opacity: 1 };
}

/** XPS path data as SVG path data and fill rule (XPS data may start with `F0`, even-odd, or `F1`, non-zero). */
function geometry(data: string): { d: string, rule: string } | undefined {
	const text = data.replace(/\s+/g, ' ').trim();
	const rule = text.match(/^F\s*([01])\s*/);
	const d = rule ? text.slice(rule[0].length) : text;
	if (!/^[MmLlHhVvCcQqSsAaZz0-9eE.,+\-\s]*$/.test(d) || !/^[Mm]/.test(d)) return undefined;
	return { d, rule: rule?.[1] === '1' ? 'nonzero' : 'evenodd' };
}

/** A glyph of a run, where its origin is from the run's origin (page units, y down). */
interface Placed {
	glyph: number;
	x: number;
	y: number;
}

/** An entry of a run's `Indices`: `(units:glyphs)glyph,advance,uOffset,vOffset`, every part optional. */
interface IndexEntry {
	/** A cluster's first entry: how many UTF-16 units of the text, and how many glyphs (entries), it has. */
	units?: number;
	glyphs?: number;
	glyph?: number;
	advance?: number;
	u: number;
	v: number;
}

/** The entries of a run's `Indices` ([MS-XPS] 5.1.3 / ECMA-388 12.1.3); advances and offsets in hundredths of the em size. Throws when they cannot be read. */
function indexEntries(indices: string | undefined): IndexEntry[] {
	if (!indices?.trim()) return [];
	return indices.split(';').map(entry => {
		const match = entry.trim().match(/^(?:\((\d+)(?::(\d+))?\))?([^,]*)(?:,([^,]*))?(?:,([^,]*))?(?:,([^,]*))?(?:,.*)?$/);
		if (!match) throw new Error('glyph indices');
		const value = (part: string | undefined) => {
			if (part === undefined || part.trim() === '') return undefined;
			const n = Number(part);
			if (!Number.isFinite(n)) throw new Error('glyph indices');
			return n;
		};
		return { units: match[1] ? Number(match[1]) : undefined, glyphs: match[1] ? Number(match[2] ?? '1') : undefined, glyph: value(match[3]), advance: value(match[4]), u: value(match[5]) ?? 0, v: value(match[6]) ?? 0 };
	});
}

/** The characters (code points) of a piece of UTF-16 text. */
const codePoints = (text: string) => [...text].map(character => character.codePointAt(0)!);

/**
 * The check for one cluster of a run: the characters it stands for (`codes`, none when the
 * document gives none) and the glyphs that draw them. Each glyph must be what the font itself
 * makes of those characters: one character's glyph or a form of it (a half-width comma, say); the
 * ligature its substitutions make of several; the glyphs they split one into. With no characters
 * given, each glyph must be the glyph of a character in the font (or a form of one). A glyph that
 * draws nothing (a space) needs no check. Throws when the check fails.
 */
function checkCluster(font: Font, codes: number[], glyphs: number[], hasText: boolean): void {
	const drawn = (glyph: number) => font.outline(glyph) !== '';
	if (!glyphs.some(drawn)) return;
	if (!codes.length) {
		for (const glyph of glyphs) if (drawn(glyph) && !font.charactersOf(glyph).length) throw new Error(hasText ? 'glyph of no character' : 'glyph of no character, and no characters given');
		return;
	}
	if (codes.length === glyphs.length) {
		glyphs.forEach((glyph, k) => {
			if (drawn(glyph) && !font.isFormOf(glyph, font.glyphOf(codes[k]!))) throw new Error('glyph is not its character');
		});
		return;
	}
	const bases = codes.map(code => font.glyphOf(code));
	if (glyphs.length === 1) {
		if (!font.isLigatureOf(glyphs[0]!, bases)) throw new Error('glyph cannot be checked: not the ligature of its characters');
		return;
	}
	if (codes.length === 1) {
		if (!font.isSplitOf(glyphs, bases[0]!)) throw new Error('glyphs cannot be checked: not what their character splits into');
		return;
	}
	throw new Error('glyph cluster cannot be checked');
}

/**
 * The glyphs of a run (an XPS `Glyphs` element) placed along its baseline, each cluster checked by
 * `checkCluster` against the font's own character map and substitutions. Throws when a check fails.
 * `indices` is the `Indices` attribute ([MS-XPS] 5.1.3 / ECMA-388 12.1.3): entries
 * `(units:glyphs)glyph,advance,uOffset,vOffset`, every part optional; advances and offsets are in
 * hundredths of the em size.
 */
export function glyphRun(font: Font, text: string | undefined, indices: string | undefined, em: number): Placed[] {
	let units = text ?? '';
	if (units.startsWith('{}')) units = units.slice(2);
	const hasText = text !== undefined && units.length > 0;
	const entries = indexEntries(indices);
	const defaultAdvance = (glyph: number) => font.advance(glyph) * 100 / font.unitsPerEm;
	const placed: Placed[] = [];
	let x = 0, at = 0;
	const place = (glyph: number, advance: number | undefined, u: number, v: number) => {
		if (!(glyph >= 0 && glyph < font.glyphCount)) throw new Error('glyph number outside the font');
		if (font.outline(glyph) === undefined) throw new Error('glyph outline');
		placed.push({ glyph, x: x + u * em / 100, y: -v * em / 100 });
		x += (advance ?? defaultAdvance(glyph)) * em / 100;
	};
	for (let i = 0; i < entries.length;) {
		const first = entries[i]!;
		const clusterUnits = first.units ?? 1, clusterGlyphs = first.glyphs ?? 1;
		if (!(clusterGlyphs >= 1) || i + clusterGlyphs > entries.length) throw new Error('glyph cluster');
		const cluster = entries.slice(i, i + clusterGlyphs);
		if (cluster.slice(1).some(entry => entry.units !== undefined)) throw new Error('glyph cluster');
		const codes = codePoints(units.slice(at, at + clusterUnits));
		at += clusterUnits;
		// A glyph not given is its character's own (one character, one glyph).
		const glyphs = cluster.map(entry => {
			if (entry.glyph !== undefined) return entry.glyph;
			if (codes.length !== 1 || cluster.length !== 1) throw new Error('glyph without a character');
			const glyph = font.glyphOf(codes[0]!);
			if (glyph === 0) throw new Error('character without a glyph');
			return glyph;
		});
		for (const glyph of glyphs) if (!(glyph >= 0 && glyph < font.glyphCount)) throw new Error('glyph number outside the font');
		checkCluster(font, codes, glyphs, hasText);
		cluster.forEach((entry, k) => place(glyphs[k]!, entry.advance, entry.u, entry.v));
		i += clusterGlyphs;
	}
	// Characters past the indices: one glyph each, from the character map.
	while (at < units.length) {
		const code = units.codePointAt(at)!;
		at += code > 0xffff ? 2 : 1;
		const glyph = font.glyphOf(code);
		if (glyph === 0) throw new Error('character without a glyph');
		place(glyph, undefined, 0, 0);
	}
	return placed;
}

/** The key an obfuscated font (`.odttf`) is read with: its part name's GUID, bytes in reverse order ([MS-XPS] / ECMA-388 9.1.7.3). */
function deobfuscate(name: string, bytes: Uint8Array): Uint8Array | undefined {
	const guid = name.split('/').pop()!.replace(/\.[^.]*$/, '').replace(/[{}-]/g, '');
	if (!/^[0-9a-f]{32}$/i.test(guid) || bytes.length < 32) return undefined;
	const key = Array.from({ length: 16 }, (_, i) => parseInt(guid.slice(30 - 2 * i, 32 - 2 * i), 16));
	const out = bytes.slice();
	for (let i = 0; i < 32; i++) out[i] = out[i]! ^ key[i % 16]!;
	return out;
}

/** Each font's name for its glyphs in the SVG. */
const fontIds = new WeakMap<Font, string>();

/** A short, steady name for a font's glyphs in the SVG: FNV-1a of its bytes. */
function fontId(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
	return hash.toString(36);
}

/**
 * A picture's resolution in dots per inch, as a brush's Viewbox counts it: from a PNG's pHYs chunk
 * or a JPEG's JFIF header, else 96 ([MS-XPS] / ECMA-388: a picture without one is taken at 96).
 */
export function resolution(b: Uint8Array): { x: number, y: number } {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const ascii = (at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));
	if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
		for (let at = 8; at + 12 <= b.length;) {
			const length = view.getUint32(at), type = ascii(at + 4, 4);
			if (type === 'pHYs' && length >= 9 && at + 17 <= b.length) {
				const x = view.getUint32(at + 8) * 0.0254, y = view.getUint32(at + 12) * 0.0254;
				if (b[at + 16] === 1 && x > 0 && y > 0) return { x, y };
				break;
			}
			if (type === 'IDAT' || type === 'IEND') break;
			at += 12 + length;
		}
	}
	else if (b.length >= 18 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xe0 && ascii(6, 5) === 'JFIF\0') {
		const units = b[13], x = view.getUint16(14), y = view.getUint16(16);
		if (x > 0 && y > 0 && units === 1) return { x, y };
		if (x > 0 && y > 0 && units === 2) return { x: x * 2.54, y: y * 2.54 };
	}
	return { x: 96, y: 96 };
}

const LINE_CAPS: Record<string, string> = { Flat: 'butt', Square: 'square', Round: 'round' };
const LINE_JOINS: Record<string, string> = { Miter: 'miter', Bevel: 'bevel', Round: 'round' };

/**
 * How a path's stroke is drawn, as SVG attributes: caps, joins (XPS mitres up to 10, SVG to 4 unless
 * told) and dashes, which XPS counts in stroke widths (§11.5 item 79). Throws on what SVG cannot
 * draw the same way: triangle caps, or different caps at the two ends or on the dashes.
 */
function strokeStyle(attrs: Map<string, string>, thickness: number): string {
	const start = attrs.get('StrokeStartLineCap') ?? 'Flat', end = attrs.get('StrokeEndLineCap') ?? 'Flat', dashCap = attrs.get('StrokeDashCap') ?? 'Flat';
	const dashes = attrs.get('StrokeDashArray');
	if (!LINE_CAPS[start] || start !== end || (dashes !== undefined && dashCap !== start)) throw new Error('line caps');
	const join = attrs.get('StrokeLineJoin') ?? 'Miter';
	if (!LINE_JOINS[join]) throw new Error('line join');
	let out = start !== 'Flat' ? ` stroke-linecap="${LINE_CAPS[start]}"` : '';
	if (join !== 'Miter') out += ` stroke-linejoin="${LINE_JOINS[join]}"`;
	else {
		const limit = Number(attrs.get('StrokeMiterLimit') ?? '10');
		if (!(limit >= 1)) throw new Error('miter limit');
		out += ` stroke-miterlimit="${limit}"`;
	}
	if (dashes !== undefined) {
		const values = dashes.trim().split(/[\s,]+/).map(Number);
		const offset = Number(attrs.get('StrokeDashOffset') ?? '0');
		if (!values.length || values.some(value => !(value >= 0)) || values.every(value => value === 0) || !Number.isFinite(offset)) throw new Error('dashes');
		const scaled = (value: number) => Math.round(value * thickness * 1000) / 1000;
		out += ` stroke-dasharray="${values.map(scaled).join(' ')}"${offset ? ` stroke-dashoffset="${scaled(offset)}"` : ''}`;
	}
	return out;
}

/** A font of the document, read once (`fonts` holds them by part name); undefined when it cannot be read here. */
function readFont(pkg: Package, fonts: Map<string, Promise<Font | undefined>>, at: string): Promise<Font | undefined> {
	if (!fonts.has(at)) {
		fonts.set(at, (async () => {
			const bytes = await pkg.read(at);
			if (!bytes) return undefined;
			const plain = /\.odttf$/i.test(at) ? deobfuscate(at, bytes) : bytes;
			const font = plain && readTrueType(plain);
			if (font && plain) fontIds.set(font, fontId(plain));
			return font;
		})());
	}
	return fonts.get(at)!;
}

/** Builds the SVG of one page; throws on what it does not draw. */
async function pageSvg(pkg: Package, path: string, fonts: Map<string, Promise<Font | undefined>>): Promise<XpsPage | undefined> {
	const xml = await pkg.text(path);
	if (xml === undefined) return undefined;
	// What is not drawn here: other brushes, transforms and data given as elements, visuals.
	const unsupported = xml.match(/<(RadialGradientBrush|VisualBrush|[\w]+\.RenderTransform|[\w]+\.OpacityMask|[\w]+\.Clip|Path\.Data|ImageBrush\.Transform|LinearGradientBrush\.Transform)\b/);
	if (unsupported) throw new Error(unsupported[1]!);
	if (/\sOpacityMask\s*=/.test(xml)) throw new Error('opacity mask');
	// Fonts the page's text uses, read once per document; glyph outlines go into the page's defs once.
	const defs = new Map<string, string>();
	/** Linear gradients the page's paths are filled or stroked with, by their id. */
	const gradients = new Map<string, string>();
	/**
	 * A linear gradient brush ([MS-XPS] / ECMA-388 13.4) as an SVG gradient, its reference. Start and
	 * end points in page units or relative to the shape's bounding box; padded, reflected or repeated;
	 * colours interpolated in sRGB (the other way, scRGB, is not drawn here).
	 */
	const linearGradient = (brush: Map<string, string>, stops: Map<string, string>[]) => {
		const start = numbers(brush.get('StartPoint'), 2), end = numbers(brush.get('EndPoint'), 2);
		const mapping = brush.get('MappingMode') ?? 'Absolute', spread = brush.get('SpreadMethod') ?? 'Pad';
		if (!start || !end || !stops.length || !['Absolute', 'RelativeToBoundingBox'].includes(mapping) || !['Pad', 'Reflect', 'Repeat'].includes(spread)) throw new Error('gradient');
		if ((brush.get('ColorInterpolationMode') ?? 'SRgbLinearInterpolation') !== 'SRgbLinearInterpolation') throw new Error('gradient colours');
		const opacity = brush.has('Opacity') ? Number(brush.get('Opacity')) : 1;
		const transform = brush.get('Transform');
		if (!(opacity >= 0 && opacity <= 1) || (transform !== undefined && !matrix(transform))) throw new Error('gradient');
		const stopTags = stops.map(stop => {
			const paint = colour(stop.get('Color')), offset = Number(stop.get('Offset'));
			if (!paint || !Number.isFinite(offset)) throw new Error('gradient stop');
			const alpha = paint.opacity * opacity;
			return `<stop offset="${offset}" stop-color="${paint.paint}"${alpha < 1 ? ` stop-opacity="${alpha.toFixed(3)}"` : ''}/>`;
		});
		const body = `gradientUnits="${mapping === 'Absolute' ? 'userSpaceOnUse' : 'objectBoundingBox'}" x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}"${spread !== 'Pad' ? ` spreadMethod="${spread.toLowerCase()}"` : ''}${transform !== undefined ? ` gradientTransform="${matrix(transform)}"` : ''}>${stopTags.join('')}`;
		const id = `lg${fontId(new TextEncoder().encode(body))}`;
		gradients.set(id, `<linearGradient id="${id}" ${body}</linearGradient>`);
		return `url(#${id})`;
	};
	const fontAt = (at: string) => readFont(pkg, fonts, at);
	// Shapes kept in resource dictionaries (the page's own, and those it names).
	const shapes = new Map<string, { figures: string, rule: string, transformed: boolean }>();
	const dictionaries = [xml];
	for (const source of sources(xml, 'ResourceDictionary')) dictionaries.push(await pkg.text(resolve(path, source)) ?? '');
	for (const dictionary of dictionaries) {
		for (const match of dictionary.matchAll(/<PathGeometry\b([^>]*?)\/?>/g)) {
			const attrs = attributes(match[1]!);
			const key = attrs.get('x:Key'), figures = attrs.get('Figures');
			if (key && figures) shapes.set(key, { figures, rule: attrs.get('FillRule') === 'NonZero' ? 'F1 ' : 'F0 ', transformed: attrs.has('Transform') });
		}
	}
	/** A shape given as path data or as a resource (`{StaticResource key}`), as SVG path data and fill rule. */
	const shapeOf = (data: string) => {
		const resource = data.match(/^\{StaticResource\s+([^}\s]+)\s*\}$/);
		const shape = resource ? shapes.get(resource[1]!) : undefined;
		if (resource && !shape) throw new Error('missing resource');
		if (shape?.transformed) throw new Error('shape transform');
		const geo = geometry(shape ? shape.rule + shape.figures : data);
		if (!geo) throw new Error('path data');
		return geo;
	};
	/** Clip regions, as SVG clip paths in the defs, by their id. */
	const clips = new Map<string, string>();
	/** A clip path for a shape: in the coordinates of the element that uses it, after its own transform, as in XPS. */
	const clipPath = (geo: { d: string, rule: string }) => {
		const body = `<path d="${geo.d}" clip-rule="${geo.rule}"/>`;
		const id = `cp${fontId(new TextEncoder().encode(body))}`;
		clips.set(id, `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${body}</clipPath>`);
		return `url(#${id})`;
	};
	/** An element's Clip ([MS-XPS] / ECMA-388 14.3) as a clip-path attribute, or nothing (§11.5 item 79). */
	const clipOf = (attrs: Map<string, string>) => {
		const value = attrs.get('Clip');
		return value === undefined ? '' : ` clip-path="${clipPath(shapeOf(value))}"`;
	};
	/** A solid colour brush (or a colour given as an attribute) as SVG paint, the brush's opacity included. */
	const solid = (brush: Map<string, string> | undefined, attribute: string | undefined) => {
		const paint = colour(brush?.get('Color') ?? attribute);
		if (!paint || !brush?.has('Opacity')) return paint;
		const opacity = Number(brush.get('Opacity'));
		if (!(opacity >= 0 && opacity <= 1)) throw new Error('brush opacity');
		return { paint: paint.paint, opacity: paint.opacity * opacity };
	};

	const images = new Map<string, { href: string, width: number, height: number } | undefined>();
	/** A picture, with its size in the units of a brush's Viewbox: 1/96 inch at its own resolution. */
	const image = async (source: string) => {
		const at = resolve(path, source);
		if (!images.has(at)) {
			const bytes = await pkg.read(at);
			const info = bytes && pictureInfo(bytes);
			const dpi = bytes && resolution(bytes);
			images.set(at, bytes && info && dpi && /^image\/(png|jpeg|gif)$/.test(info.mime) ? { href: `data:${info.mime};base64,${base64(bytes)}`, width: Math.round(info.width * 96 / dpi.x * 1000) / 1000, height: Math.round(info.height * 96 / dpi.y * 1000) / 1000 } : undefined);
		}
		return images.get(at);
	};

	let width = 0, height = 0;
	const out: string[] = [];
	// The path being read (its fill or stroke may come as an element inside it).
	let current: { attrs: Map<string, string>, fill?: Map<string, string>, image?: Map<string, string>, stroke?: Map<string, string>, within?: 'fill' | 'stroke', gradient?: { brush: Map<string, string>, stops: Map<string, string>[], within: 'fill' | 'stroke' }, fillGradient?: string, strokeGradient?: string } | undefined;
	const emitPath = async (attrs: Map<string, string>, fill?: Map<string, string>, imageBrush?: Map<string, string>, stroke?: Map<string, string>, gradientFill?: string, gradientStroke?: string) => {
		const geo = shapeOf(attrs.get('Data') ?? '');
		const parts: string[] = [];
		const transform = attrs.get('RenderTransform');
		const opacity = attrs.has('Opacity') ? Number(attrs.get('Opacity')) : 1;
		if (!(opacity >= 0 && opacity <= 1)) throw new Error('opacity');
		if (transform !== undefined && !matrix(transform)) throw new Error('transform');
		const open = [transform !== undefined ? ` transform="${matrix(transform)}"` : '', opacity !== 1 ? ` opacity="${opacity}"` : '', clipOf(attrs)].join('');
		const line = gradientStroke ? { paint: gradientStroke, opacity: 1 } : solid(stroke, attrs.get('Stroke'));
		if ((stroke || attrs.has('Stroke')) && !line) throw new Error('stroke');
		const thickness = Number(attrs.get('StrokeThickness') ?? '1');
		if (line && !(thickness >= 0)) throw new Error('stroke thickness');
		const strokeAttrs = line ? ` stroke="${line.paint}" stroke-width="${thickness}"${line.opacity < 1 ? ` stroke-opacity="${line.opacity.toFixed(3)}"` : ''}${strokeStyle(attrs, thickness)}` : '';
		if (imageBrush) {
			const tile = imageBrush.get('TileMode') ?? 'None';
			const port = numbers(imageBrush.get('Viewport'), 4), box = numbers(imageBrush.get('Viewbox'), 4);
			const picture = await image(imageBrush.get('ImageSource') ?? '');
			if (tile !== 'None' || !port || !box || !picture || imageBrush.get('ViewportUnits') !== 'Absolute' || (imageBrush.get('ViewboxUnits') ?? 'Absolute') !== 'Absolute') throw new Error('image brush');
			if (imageBrush.has('Transform')) throw new Error('image brush transform');
			if (!(box[2]! > 0 && box[3]! > 0 && port[2]! > 0 && port[3]! > 0)) throw new Error('viewbox');
			const brushOpacity = imageBrush.has('Opacity') ? Number(imageBrush.get('Opacity')) : 1;
			if (!(brushOpacity >= 0 && brushOpacity <= 1)) throw new Error('brush opacity');
			// The brush's Viewbox (in 1/96 inch of the picture at its own resolution) stretched over its
			// Viewport, painted only inside the path's own shape (§11.5 item 79).
			const picturePart = `<svg x="${port[0]}" y="${port[1]}" width="${port[2]}" height="${port[3]}" viewBox="${box.join(' ')}" preserveAspectRatio="none"><image width="${picture.width}" height="${picture.height}" preserveAspectRatio="none"${brushOpacity !== 1 ? ` opacity="${brushOpacity}"` : ''} href="${picture.href}"/></svg>`;
			// The path's Clip is often its own shape (as MXDC writes picture strips): clipped once.
			const own = clipPath(geo);
			parts.push(open.includes(own) ? picturePart : `<g clip-path="${own}">${picturePart}</g>`);
			if (line) parts.push(`<path d="${geo.d}" fill="none"${strokeAttrs}/>`);
		}
		else {
			const paint = gradientFill ? { paint: gradientFill, opacity: 1 } : solid(fill, attrs.get('Fill'));
			if ((fill || attrs.has('Fill')) && !paint) throw new Error('fill');
			if (!paint && !line) return;
			parts.push(`<path d="${geo.d}" fill-rule="${geo.rule}" fill="${paint ? paint.paint : 'none'}"${paint && paint.opacity < 1 ? ` fill-opacity="${paint.opacity.toFixed(3)}"` : ''}${strokeAttrs}/>`);
		}
		out.push(open ? `<g${open}>${parts.join('')}</g>` : parts.join(''));
	};

	// A run of text: each glyph's outline once in the defs, then placed (§11.5 item 77).
	const emitGlyphs = async (attrs: Map<string, string>, fill?: Map<string, string>) => {
		const uri = attrs.get('FontUri');
		if (!uri || uri.includes('#')) throw new Error('font reference');
		const font = await fontAt(resolve(path, uri));
		if (!font) throw new Error('font not read');
		const paint = solid(fill, attrs.get('Fill'));
		if (!paint) throw new Error('glyph fill');
		if (Number(attrs.get('BidiLevel') ?? '0') % 2 === 1) throw new Error('right to left text');
		if (attrs.get('IsSideways') === 'true') throw new Error('sideways text');
		const em = Number(attrs.get('FontRenderingEmSize')), ox = Number(attrs.get('OriginX')), oy = Number(attrs.get('OriginY'));
		if (!(em > 0) || !Number.isFinite(ox) || !Number.isFinite(oy)) throw new Error('glyph position');
		const simulation = attrs.get('StyleSimulations') ?? 'None';
		if (!['None', 'ItalicSimulation', 'BoldSimulation', 'BoldItalicSimulation'].includes(simulation)) throw new Error('style simulation');
		const transform = attrs.get('RenderTransform');
		if (transform !== undefined && !matrix(transform)) throw new Error('transform');
		const opacity = attrs.has('Opacity') ? Number(attrs.get('Opacity')) : 1;
		if (!(opacity >= 0 && opacity <= 1)) throw new Error('opacity');
		const placed = glyphRun(font, attrs.get('UnicodeString'), attrs.get('Indices'), em);
		const id = fontIds.get(font)!;
		const scale = em / font.unitsPerEm;
		// Italic simulation slants by 20 degrees; bold simulation widens the outline by 1% of the em on each side.
		const slant = /Italic/.test(simulation) ? Math.tan(Math.PI / 9) : 0;
		const uses: string[] = [];
		for (const glyph of placed) {
			const outline = font.outline(glyph.glyph)!;
			if (!outline) continue;
			const ref = `g${id}_${glyph.glyph}`;
			if (!defs.has(ref)) defs.set(ref, outline);
			const r = (n: number) => Math.round(n * 1000) / 1000;
			uses.push(`<use href="#${ref}" transform="matrix(${r(scale)} 0 ${r(scale * slant)} ${r(-scale)} ${r(ox + glyph.x)} ${r(oy + glyph.y)})"/>`);
		}
		if (!uses.length) return;
		const bold = /Bold/.test(simulation) ? ` stroke="${paint.paint}" stroke-width="${Math.round(font.unitsPerEm * 0.02)}"${paint.opacity < 1 ? ` stroke-opacity="${paint.opacity.toFixed(3)}"` : ''}` : '';
		out.push(`<g${transform !== undefined ? ` transform="${matrix(transform)}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}${clipOf(attrs)} fill="${paint.paint}"${paint.opacity < 1 ? ` fill-opacity="${paint.opacity.toFixed(3)}"` : ''}${bold}>${uses.join('')}</g>`);
	};
	let glyphs: { attrs: Map<string, string>, fill?: Map<string, string>, within?: boolean } | undefined;

	// Every tag must be read: one written otherwise (single quotes, say) would leave part of the page out.
	let tags = 0;
	for (const match of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w.:]*)((?:\s+[\w.:]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
		const [, closing, name, rest, selfClosing] = match;
		if (!name) continue;
		tags++;
		const attrs = attributes(rest ?? '');
		if (name === 'FixedPage' && !closing) {
			width = Number(attrs.get('Width'));
			height = Number(attrs.get('Height'));
		}
		else if (name === 'Canvas') {
			if (closing) out.push('</g>');
			else if (!selfClosing) {
				const transform = attrs.get('RenderTransform');
				if (transform !== undefined && !matrix(transform)) return undefined;
				const value = attrs.has('Opacity') ? Number(attrs.get('Opacity')) : 1;
				if (!(value >= 0 && value <= 1)) return undefined;
				const opacity = value !== 1 ? ` opacity="${value}"` : '';
				out.push(`<g${transform !== undefined ? ` transform="${matrix(transform)}"` : ''}${opacity}${clipOf(attrs)}>`);
			}
		}
		else if (name === 'Path') {
			if (closing) {
				if (current) await emitPath(current.attrs, current.fill, current.image, current.stroke, current.fillGradient, current.strokeGradient);
				current = undefined;
			}
			else if (selfClosing) await emitPath(attrs);
			else current = { attrs };
		}
		else if (name === 'Glyphs') {
			if (closing) {
				if (glyphs) await emitGlyphs(glyphs.attrs, glyphs.fill);
				glyphs = undefined;
			}
			else if (selfClosing) await emitGlyphs(attrs);
			else glyphs = { attrs };
		}
		else if (glyphs && name === 'Glyphs.Fill') glyphs.within = !closing;
		else if (glyphs && name === 'SolidColorBrush' && glyphs.within) glyphs.fill = attrs;
		else if (glyphs && !closing) throw new Error(`${name} inside glyphs`);
		else if (current && (name === 'Path.Fill' || name === 'Path.Stroke')) current.within = closing ? undefined : name === 'Path.Fill' ? 'fill' : 'stroke';
		else if (current && name === 'ImageBrush' && current.within === 'fill') current.image = attrs;
		else if (current && name === 'LinearGradientBrush' && current.within) {
			if (!closing) current.gradient = { brush: attrs, stops: [], within: current.within };
			if (closing || selfClosing) {
				const gradient = current.gradient;
				if (!gradient) throw new Error('gradient');
				const reference = linearGradient(gradient.brush, gradient.stops);
				if (gradient.within === 'fill') current.fillGradient = reference;
				else current.strokeGradient = reference;
				current.gradient = undefined;
			}
		}
		else if (current?.gradient && name === 'LinearGradientBrush.GradientStops') { /* the stops follow */ }
		else if (current?.gradient && name === 'GradientStop' && !closing) current.gradient.stops.push(attrs);
		else if (current && name === 'SolidColorBrush') {
			if (current.within === 'fill') current.fill = attrs;
			else if (current.within === 'stroke') current.stroke = attrs;
		}
		else if (current && !closing) return undefined; // something inside a path that is not drawn here
	}
	const comments = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
	if (tags !== (comments.match(/<[A-Za-z/]/g) ?? []).length) return undefined;
	if (!(width > 0) || !(height > 0)) return undefined;
	const glyphDefs = defs.size || gradients.size || clips.size ? `<defs>${[...gradients.values()].join('')}${[...clips.values()].join('')}${[...defs].map(([ref, d]) => `<path id="${ref}" d="${d}"/>`).join('')}</defs>` : '';
	return { width, height, content: `${glyphDefs}<rect width="${width}" height="${height}" fill="#ffffff"/>${out.join('')}` };
}

type Point = { x: number, y: number };
/** An XPS transform `a,b,c,d,e,f`: (x, y) goes to (ax + cy + e, bx + dy + f). */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const apply = (m: Matrix, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
/** `inner`, then `outer`. */
const compose = (outer: Matrix, inner: Matrix): Matrix => [
	outer[0] * inner[0] + outer[2] * inner[1], outer[1] * inner[0] + outer[3] * inner[1],
	outer[0] * inner[2] + outer[2] * inner[3], outer[1] * inner[2] + outer[3] * inner[3],
	outer[0] * inner[4] + outer[2] * inner[5] + outer[4], outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];
const transformOf = (value: string | undefined): Matrix => (numbers(value, 6) as Matrix | undefined) ?? IDENTITY;

/**
 * The one character a glyph draws, found from its font (the character map and the forms its
 * substitutions give); undefined when it is none, or could be more than one, or is a control or
 * private-use character, which says nothing about what is written.
 */
export function characterOf(font: Font | undefined, glyph: number | undefined): string | undefined {
	if (!font || glyph === undefined || !(glyph >= 0 && glyph < font.glyphCount)) return undefined;
	const codes = [...new Set(font.charactersOf(glyph))];
	const code = codes[0];
	if (codes.length !== 1 || code === undefined) return undefined;
	if (code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) return undefined;
	return String.fromCodePoint(code);
}

/** A run of text on a page: its characters, where its first glyph is, and where one that goes on from it would start. */
interface TextRun {
	text: string;
	given: string;
	first?: Point;
	next: Point[];
	/** One em below its last glyph: where a column of vertical writing goes on. */
	below?: Point;
	/** Its glyphs go down the page (vertical writing): more than one, set one below the other. */
	vertical: boolean;
	/** The em size on the page. */
	em: number;
}

/**
 * The characters of a run (an XPS `Glyphs` element) in order: those the document writes, and for a
 * glyph it gives without one, the character its font draws with it (`characterOf`); and where it
 * sits, in page units (`m` is the transform it is drawn with).
 */
export function textRun(attrs: Map<string, string>, font: Font | undefined, m: Matrix): TextRun | undefined {
	let units = attrs.get('UnicodeString') ?? '';
	if (units.startsWith('{}')) units = units.slice(2);
	let entries: IndexEntry[];
	try {
		entries = indexEntries(attrs.get('Indices'));
	}
	catch {
		entries = [];
	}
	const em = Number(attrs.get('FontRenderingEmSize')), ox = Number(attrs.get('OriginX')), oy = Number(attrs.get('OriginY'));
	const placed = em > 0 && Number.isFinite(ox) && Number.isFinite(oy);
	const origins: Point[] = [];
	let x = 0, v = 0, ends = placed;
	const place = (glyph: number | undefined, advance: number | undefined, u: number, offset: number) => {
		origins.push({ x: x + u * em / 100, y: -offset * em / 100 });
		v = -offset * em / 100;
		const step = advance ?? (font && glyph !== undefined && glyph >= 0 && glyph < font.glyphCount ? font.advance(glyph) * 100 / font.unitsPerEm : undefined);
		if (step === undefined) ends = false;
		else x += step * em / 100;
	};
	let text = '', given = '', at = 0;
	for (let i = 0; i < entries.length;) {
		const count = Math.max(1, entries[i]!.glyphs ?? 1);
		const cluster = entries.slice(i, i + count);
		const piece = units.slice(at, at + (entries[i]!.units ?? 1));
		at += entries[i]!.units ?? 1;
		if (piece) {
			text += piece;
			given += piece;
		}
		else for (const entry of cluster) text += characterOf(font, entry.glyph) ?? '';
		const single = [...piece].length === 1 ? font?.glyphOf(piece.codePointAt(0)!) : undefined;
		for (const entry of cluster) place(entry.glyph ?? single, entry.advance, entry.u, entry.v);
		i += count;
	}
	// Characters past the indices: one glyph each, from the character map.
	for (const character of units.slice(at)) {
		text += character;
		given += character;
		place(font?.glyphOf(character.codePointAt(0)!), undefined, 0, 0);
	}
	if (!text) return undefined;
	if (!placed || !origins.length) return { text, given, next: [], vertical: false, em: 0 };
	const transform = compose(m, transformOf(attrs.get('RenderTransform')));
	const scale = Math.sqrt(Math.abs(transform[0] * transform[3] - transform[1] * transform[2]));
	const at0 = (point: Point) => apply(transform, ox + point.x, oy + point.y);
	const first = at0(origins[0]!), last = at0(origins[origins.length - 1]!);
	const pageEm = em * scale;
	// Where the next glyph would go: along the run's advance, or one more step as its glyphs go (down
	// a column, where they are placed by offsets and advance nothing).
	const next: Point[] = [];
	if (ends) next.push(apply(transform, ox + x, oy + v));
	let vertical = false;
	if (origins.length > 1) {
		const before = at0(origins[origins.length - 2]!);
		next.push({ x: 2 * last.x - before.x, y: 2 * last.y - before.y });
		vertical = Math.abs(last.y - before.y) > Math.abs(last.x - before.x);
	}
	return { text, given, first, next, below: { x: last.x, y: last.y + pageEm }, vertical, em: pageEm };
}

/**
 * The text of one page (§11.5 item 78), whether it can be drawn here or not. Runs are taken in the
 * document's order; a run that starts where an earlier one would go on (within half an em) is
 * joined to it, so a line split into several runs, or a column of vertical text with its ruby set
 * apart, reads as one piece; everything else starts a new line. Going on one em below counts only
 * on a page with vertical writing, and there only after a run of it or of one glyph: on other pages
 * a bullet or a table cell of one character would be joined to the line below (§11.5 item 79).
 */
async function pageText(pkg: Package, path: string, fonts: Map<string, Promise<Font | undefined>>): Promise<PageText | undefined> {
	const xml = await pkg.text(path);
	if (xml === undefined) return undefined;
	const stack: Matrix[] = [IDENTITY];
	const runs: TextRun[] = [];
	for (const match of xml.matchAll(/<(\/?)(Canvas|Glyphs)((?:\s+[\w.:]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
		const [, closing, name, rest, selfClosing] = match;
		const top = stack[stack.length - 1]!;
		if (name === 'Canvas') {
			if (closing) {
				if (stack.length > 1) stack.pop();
			}
			else if (!selfClosing) stack.push(compose(top, transformOf(attributes(rest ?? '').get('RenderTransform'))));
			continue;
		}
		if (closing) continue;
		const attrs = attributes(rest ?? '');
		const uri = attrs.get('FontUri');
		const font = uri && !uri.includes('#') ? await readFont(pkg, fonts, resolve(path, uri)) : undefined;
		const run = textRun(attrs, font, top);
		if (run) runs.push(run);
	}
	const verticalPage = runs.some(run => run.vertical);
	const goesOn = (run: TextRun) => (verticalPage && run.below && (run.vertical || [...run.text].length === 1) ? [...run.next, run.below] : run.next);
	const lines: { text: string, next: Point[], em: number }[] = [];
	for (const run of runs) {
		const first = run.first;
		const line = first && lines.slice(-64).reverse().find(earlier => earlier.next.some(point => Math.hypot(point.x - first.x, point.y - first.y) <= 0.5 * Math.max(earlier.em, run.em)));
		if (line) {
			line.text += run.text;
			line.next = goesOn(run);
			line.em = run.em;
		}
		else lines.push({ text: run.text, next: goesOn(run), em: run.em });
	}
	const text = lines.map(line => line.text.trim()).filter(Boolean).join('\n');
	return text ? { text, given: runs.map(run => run.given).join('\n') } : undefined;
}
