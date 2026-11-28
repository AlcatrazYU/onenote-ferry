// Reading glyph outlines from the TrueType fonts a Windows printout embeds (§11.5 item 77), so that
// text is drawn by the glyph numbers the document gives, with the document's own fonts: nothing
// is recognised or guessed. Only what that needs is read: the glyph outlines (`glyf`, `loca`),
// advance widths (`hmtx`), the character map (`cmap`) and the glyph substitutions (`GSUB`). The
// last two are used to check that each glyph number is the glyph of the character the document
// says it is, or one of its forms the font itself gives (a half-width comma, say), or the glyph the
// font's own rules make of several characters (a ligature), or, where the document gives no
// character, that the glyph is the glyph of one in the font (a small kana's form, say). Fonts of
// other kinds (CFF outlines, collections) are not read: their pages are not drawn.

export interface Font {
	readonly unitsPerEm: number;
	readonly glyphCount: number;
	/** The glyph's outline as SVG path data in font units (y up); '' for a glyph with no outline (a space). Undefined when it cannot be read. */
	outline(glyph: number): string | undefined;
	/** The glyph's advance width in font units. */
	advance(glyph: number): number;
	/** The glyph the font's character map gives a character (a code point); 0 (no glyph) when none. */
	glyphOf(codePoint: number): number;
	/**
	 * Whether `glyph` is `base` or a form of it the font gives by substituting one glyph for one
	 * (its single and alternate substitutions, as many steps as they go).
	 */
	isFormOf(glyph: number, base: number): boolean;
	/** The characters (code points) whose glyph `glyph` is, or one of whose forms it is; none for a glyph of no character. */
	charactersOf(glyph: number): number[];
	/** Whether `glyph` is what the font's ligature substitutions make of `components` (the characters' glyphs), or a form of it. */
	isLigatureOf(glyph: number, components: number[]): boolean;
	/** Whether `glyphs` is what the font's multiple substitutions make of `base` (one character's glyph). */
	isSplitOf(glyphs: number[], base: number): boolean;
}

/** Reads a TrueType font; undefined when it is not one read here. */
export function readTrueType(bytes: Uint8Array): Font | undefined {
	try {
		return new TrueType(bytes);
	}
	catch {
		return undefined;
	}
}

class TrueType implements Font {
	readonly unitsPerEm: number;
	readonly glyphCount: number;
	private readonly view: DataView;
	private readonly glyf: { offset: number, length: number };
	private readonly locations: number[];
	private readonly hmtx: { offset: number, metrics: number };
	private readonly lookup: (codePoint: number) => number;
	private readonly mapped: () => Iterable<[codePoint: number, glyph: number]>;
	private readonly outlines = new Map<number, string | undefined>();
	private readonly substitutes: Substitutions;
	/** Glyph to the characters whose glyph it is, or a form of (built when first needed). */
	private characters?: Map<number, number[]>;

	constructor(bytes: Uint8Array) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.view = view;
		const version = view.getUint32(0);
		if (version !== 0x00010000 && version !== 0x74727565) throw new Error('not TrueType outlines');
		const tables = new Map<string, { offset: number, length: number }>();
		const count = view.getUint16(4);
		for (let i = 0; i < count; i++) {
			const at = 12 + 16 * i;
			const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
			const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
			if (offset + length > bytes.length) throw new Error('table outside the font');
			tables.set(tag, { offset, length });
		}
		const table = (tag: string) => {
			const found = tables.get(tag);
			if (!found) throw new Error(`no ${tag} table`);
			return found;
		};
		const head = table('head'), maxp = table('maxp'), hhea = table('hhea');
		this.unitsPerEm = view.getUint16(head.offset + 18);
		if (!(this.unitsPerEm >= 16 && this.unitsPerEm <= 16384)) throw new Error('units per em');
		const longOffsets = view.getInt16(head.offset + 50) === 1;
		this.glyphCount = view.getUint16(maxp.offset + 4);
		const loca = table('loca');
		this.locations = [];
		for (let i = 0; i <= this.glyphCount; i++) {
			const at = loca.offset + i * (longOffsets ? 4 : 2);
			if (at + (longOffsets ? 4 : 2) > loca.offset + loca.length) throw new Error('loca too short');
			this.locations.push(longOffsets ? view.getUint32(at) : view.getUint16(at) * 2);
		}
		this.glyf = table('glyf');
		this.hmtx = { offset: table('hmtx').offset, metrics: view.getUint16(hhea.offset + 34) };
		if (!(this.hmtx.metrics >= 1) || this.hmtx.offset + this.hmtx.metrics * 4 > bytes.length) throw new Error('hmtx');
		const map = characterMap(view, table('cmap'));
		this.lookup = map.lookup;
		this.mapped = map.entries;
		const gsub = tables.get('GSUB');
		this.substitutes = gsub ? substitutions(view, gsub.offset) : { single: new Map(), multiple: new Map(), ligature: new Map() };
	}

	charactersOf(glyph: number): number[] {
		if (!this.characters) {
			const characters = new Map<number, number[]>();
			const add = (g: number, code: number) => {
				if (!characters.has(g)) characters.set(g, []);
				const list = characters.get(g)!;
				if (!list.includes(code)) list.push(code);
			};
			for (const [code, base] of this.mapped()) {
				if (!base) continue;
				for (const form of this.formsOf(base)) add(form, code);
			}
			this.characters = characters;
		}
		return this.characters.get(glyph) ?? [];
	}

	isLigatureOf(glyph: number, components: number[]): boolean {
		if (components.length < 2) return false;
		return (this.substitutes.ligature.get(components[0]) ?? []).some(rule =>
			rule.components.length === components.length - 1 && rule.components.every((g, i) => g === components[i + 1]) && this.isFormOf(glyph, rule.glyph));
	}

	isSplitOf(glyphs: number[], base: number): boolean {
		return (this.substitutes.multiple.get(base) ?? []).some(sequence =>
			sequence.length === glyphs.length && sequence.every((g, i) => this.isFormOf(glyphs[i], g)));
	}

	/** `base` and every glyph its single and alternate substitutions lead to, four steps deep. */
	private formsOf(base: number): number[] {
		const seen = new Set([base]);
		let frontier = [base];
		for (let step = 0; step < 4 && frontier.length; step++) {
			const next: number[] = [];
			for (const g of frontier) {
				for (const s of this.substitutes.single.get(g) ?? []) {
					if (!seen.has(s)) {
						seen.add(s);
						next.push(s);
					}
				}
			}
			frontier = next;
		}
		return [...seen];
	}

	isFormOf(glyph: number, base: number): boolean {
		return glyph === base || this.formsOf(base).includes(glyph);
	}

	advance(glyph: number): number {
		const index = Math.min(glyph, this.hmtx.metrics - 1);
		return this.view.getUint16(this.hmtx.offset + index * 4);
	}

	glyphOf(codePoint: number): number {
		return this.lookup(codePoint);
	}

	outline(glyph: number): string | undefined {
		if (!this.outlines.has(glyph)) {
			let path = this.path(glyph, 0);
			// The glyph is placed by its left side bearing (hmtx), as renderers do: where that differs
			// from the outline's own left edge (its xMin), the outline moves by the difference.
			if (path) {
				const shift = this.leftSideBearing(glyph) - this.view.getInt16(this.glyf.offset + this.locations[glyph] + 2);
				if (shift) path = transformPath(path, 1, 0, 0, 1, shift, 0);
			}
			this.outlines.set(glyph, path);
		}
		return this.outlines.get(glyph);
	}

	private leftSideBearing(glyph: number): number {
		const { offset, metrics } = this.hmtx;
		return glyph < metrics ? this.view.getInt16(offset + glyph * 4 + 2) : this.view.getInt16(offset + metrics * 4 + (glyph - metrics) * 2);
	}

	/** The glyph's outline as SVG path data; composite glyphs are drawn from their parts, `depth` deep. */
	private path(glyph: number, depth: number): string | undefined {
		if (!(glyph >= 0 && glyph < this.glyphCount) || depth > 8) return undefined;
		const start = this.locations[glyph], end = this.locations[glyph + 1];
		if (end === start) return '';
		if (end < start || this.glyf.offset + end > this.glyf.offset + this.glyf.length) return undefined;
		const view = this.view;
		const at = this.glyf.offset + start;
		const contours = view.getInt16(at);
		return contours >= 0 ? this.simple(at, contours) : this.composite(at, depth);
	}

	private simple(at: number, contours: number): string | undefined {
		const view = this.view;
		let p = at + 10;
		const ends: number[] = [];
		for (let i = 0; i < contours; i++, p += 2) ends.push(view.getUint16(p));
		const points = contours ? ends[contours - 1] + 1 : 0;
		p += 2 + view.getUint16(p); // instructions
		const flags: number[] = [];
		while (flags.length < points) {
			const flag = view.getUint8(p++);
			flags.push(flag);
			if (flag & 8) {
				const repeat = view.getUint8(p++);
				for (let r = 0; r < repeat; r++) flags.push(flag);
			}
		}
		if (flags.length !== points) return undefined;
		const coordinates = (short: number, same: number) => {
			const out: number[] = [];
			let value = 0;
			for (const flag of flags) {
				if (flag & short) {
					const delta = view.getUint8(p++);
					value += flag & same ? delta : -delta;
				}
				else if (!(flag & same)) {
					value += view.getInt16(p);
					p += 2;
				}
				out.push(value);
			}
			return out;
		};
		const xs = coordinates(2, 16), ys = coordinates(4, 32);
		const d: string[] = [];
		let first = 0;
		for (const last of ends) {
			const contour: { x: number, y: number, on: boolean }[] = [];
			for (let i = first; i <= last; i++) contour.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
			first = last + 1;
			if (contour.length) d.push(contourPath(contour));
		}
		return d.join('');
	}

	private composite(at: number, depth: number): string | undefined {
		const view = this.view;
		let p = at + 10;
		const parts: string[] = [];
		for (;;) {
			const flags = view.getUint16(p), glyph = view.getUint16(p + 2);
			p += 4;
			let dx: number, dy: number;
			if (flags & 1) {
				dx = view.getInt16(p);
				dy = view.getInt16(p + 2);
				p += 4;
			}
			else {
				dx = view.getInt8(p);
				dy = view.getInt8(p + 1);
				p += 2;
			}
			// Parts placed by matching points are not read here.
			if (!(flags & 2)) return undefined;
			let a = 1, b = 0, c = 0, e = 1;
			const f2dot14 = (q: number) => view.getInt16(q) / 16384;
			if (flags & 8) {
				a = e = f2dot14(p);
				p += 2;
			}
			else if (flags & 0x40) {
				a = f2dot14(p);
				e = f2dot14(p + 2);
				p += 4;
			}
			else if (flags & 0x80) {
				a = f2dot14(p);
				b = f2dot14(p + 2);
				c = f2dot14(p + 4);
				e = f2dot14(p + 6);
				p += 8;
			}
			const part = this.path(glyph, depth + 1);
			if (part === undefined) return undefined;
			if (part) parts.push(transformPath(part, a, b, c, e, dx, dy));
			if (!(flags & 0x20)) break;
		}
		return parts.join('');
	}
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A closed contour of on-curve and off-curve (quadratic control) points as SVG path data. */
function contourPath(points: { x: number, y: number, on: boolean }[]): string {
	// Start on an on-curve point; with none (a round dot, say), at the point implied between the last
	// control point and the first, so that the curves go through every control point in turn.
	const startIndex = points.findIndex(point => point.on);
	const ordered = startIndex >= 0 ? [...points.slice(startIndex), ...points.slice(0, startIndex)] : points;
	const last = points[points.length - 1];
	const start = startIndex >= 0 ? ordered[0] : { x: (last.x + points[0].x) / 2, y: (last.y + points[0].y) / 2, on: true };
	const out = [`M${round(start.x)} ${round(start.y)}`];
	let control: { x: number, y: number } | undefined;
	const rest = startIndex >= 0 ? ordered.slice(1) : ordered;
	for (const point of [...rest, start]) {
		if (point.on) {
			out.push(control ? `Q${round(control.x)} ${round(control.y)} ${round(point.x)} ${round(point.y)}` : `L${round(point.x)} ${round(point.y)}`);
			control = undefined;
		}
		else if (control) {
			const mid = { x: (control.x + point.x) / 2, y: (control.y + point.y) / 2 };
			out.push(`Q${round(control.x)} ${round(control.y)} ${round(mid.x)} ${round(mid.y)}`);
			control = point;
		}
		else control = point;
	}
	if (control) out.push(`Q${round(control.x)} ${round(control.y)} ${round(start.x)} ${round(start.y)}`);
	out.push('Z');
	return out.join('');
}

/** Path data (absolute M, L, Q and Z only, as contourPath writes) moved by the matrix [a b; c e] and (dx, dy). */
function transformPath(d: string, a: number, b: number, c: number, e: number, dx: number, dy: number): string {
	return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => {
		const px = Number(x), py = Number(y);
		return `${round(a * px + c * py + dx)} ${round(b * px + e * py + dy)}`;
	});
}

interface CharacterMap {
	lookup: (codePoint: number) => number;
	/** Every character the map gives a glyph, with that glyph. */
	entries: () => Iterable<[codePoint: number, glyph: number]>;
}

/** The character map: Unicode subtables (format 4 or 12) first, then a symbol subtable. */
function characterMap(view: DataView, cmap: { offset: number, length: number }): CharacterMap {
	const count = view.getUint16(cmap.offset + 2);
	const subtables: { platform: number, encoding: number, offset: number }[] = [];
	for (let i = 0; i < count; i++) {
		const at = cmap.offset + 4 + i * 8;
		subtables.push({ platform: view.getUint16(at), encoding: view.getUint16(at + 2), offset: cmap.offset + view.getUint32(at + 4) });
	}
	const read = (offset: number): { lookup: (code: number) => number, codes: () => Iterable<number> } | undefined => {
		const format = view.getUint16(offset);
		if (format === 4) {
			const segments = view.getUint16(offset + 6) / 2;
			const ends = offset + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
			const codes = function* () {
				for (let i = 0; i < segments; i++) {
					const last = view.getUint16(ends + i * 2);
					for (let code = view.getUint16(starts + i * 2); code <= last && code < 0xffff; code++) yield code;
				}
			};
			const lookup = (code: number) => {
				if (code > 0xffff) return 0;
				for (let i = 0; i < segments; i++) {
					if (code > view.getUint16(ends + i * 2)) continue;
					const first = view.getUint16(starts + i * 2);
					if (code < first) return 0;
					const delta = view.getUint16(deltas + i * 2), range = view.getUint16(ranges + i * 2);
					if (range === 0) return (code + delta) & 0xffff;
					const at = ranges + i * 2 + range + (code - first) * 2;
					const glyph = view.getUint16(at);
					return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
				}
				return 0;
			};
			return { lookup, codes };
		}
		if (format === 12) {
			const groups = view.getUint32(offset + 12);
			const lookup = (code: number) => {
				for (let i = 0; i < groups; i++) {
					const at = offset + 16 + i * 12;
					const first = view.getUint32(at), last = view.getUint32(at + 4);
					if (code >= first && code <= last) return view.getUint32(at + 8) + code - first;
				}
				return 0;
			};
			const codes = function* () {
				for (let i = 0; i < groups; i++) {
					const at = offset + 16 + i * 12;
					for (let code = view.getUint32(at), last = Math.min(view.getUint32(at + 4), 0x10ffff); code <= last; code++) yield code;
				}
			};
			return { lookup, codes };
		}
		return undefined;
	};
	const pick = (match: (subtable: { platform: number, encoding: number }) => boolean) => {
		for (const subtable of subtables.filter(match)) {
			const found = read(subtable.offset);
			if (found) return found;
		}
		return undefined;
	};
	const unicode = pick(s => s.platform === 3 && s.encoding === 10) ?? pick(s => s.platform === 0) ?? pick(s => s.platform === 3 && s.encoding === 1);
	const entries = (table: { lookup: (code: number) => number, codes: () => Iterable<number> }) => function* (): Iterable<[number, number]> {
		for (const code of table.codes()) yield [code, table.lookup(code)];
	};
	if (unicode) return { lookup: unicode.lookup, entries: entries(unicode) };
	const symbol = pick(s => s.platform === 3 && s.encoding === 0);
	// Symbol fonts map characters into U+F000 to U+F0FF.
	if (symbol) return { lookup: code => symbol.lookup(code) || (code <= 0xff ? symbol.lookup(0xf000 + code) : 0), entries: entries(symbol) };
	return { lookup: () => 0, entries: () => [] };
}

interface Substitutions {
	/** Glyph to the glyphs that may stand for it, one for one (single and alternate substitutions). */
	single: Map<number, number[]>;
	/** Glyph to the sequences of glyphs it may be split into (multiple substitution). */
	multiple: Map<number, number[][]>;
	/** First glyph to the ligatures that begin with it: the glyphs after it, and the ligature. */
	ligature: Map<number, { components: number[], glyph: number }[]>;
}

/**
 * The substitutions the font's GSUB table holds, whatever feature uses them: single (lookup type
 * 1), multiple (2), alternate (3) and ligature (4), any of them inside an extension (7). A table
 * that cannot be read gives none.
 */
function substitutions(view: DataView, gsub: number): Substitutions {
	const out: Substitutions = { single: new Map(), multiple: new Map(), ligature: new Map() };
	const add = (from: number, to: number) => {
		if (!out.single.has(from)) out.single.set(from, []);
		out.single.get(from)!.push(to);
	};
	const coverage = (at: number): number[] => {
		const format = view.getUint16(at);
		if (format === 1) return Array.from({ length: view.getUint16(at + 2) }, (_, i) => view.getUint16(at + 4 + 2 * i));
		if (format === 2) {
			const glyphs: number[] = [];
			for (let i = 0, n = view.getUint16(at + 2); i < n; i++) {
				const r = at + 4 + 6 * i;
				for (let g = view.getUint16(r); g <= view.getUint16(r + 2); g++) glyphs.push(g);
			}
			return glyphs;
		}
		return [];
	};
	const subtable = (type: number, at: number) => {
		if (type === 7) {
			subtable(view.getUint16(at + 2), at + view.getUint32(at + 4));
			return;
		}
		const format = view.getUint16(at);
		const glyphs = coverage(at + view.getUint16(at + 2));
		if (type === 1 && format === 1) {
			const delta = view.getInt16(at + 4);
			for (const g of glyphs) add(g, (g + delta) & 0xffff);
		}
		else if (type === 1 && format === 2) glyphs.forEach((g, i) => add(g, view.getUint16(at + 6 + 2 * i)));
		else if (type === 3 && format === 1) {
			glyphs.forEach((g, i) => {
				const set = at + view.getUint16(at + 6 + 2 * i);
				for (let k = 0, n = view.getUint16(set); k < n; k++) add(g, view.getUint16(set + 2 + 2 * k));
			});
		}
		else if (type === 2 && format === 1) {
			glyphs.forEach((g, i) => {
				const sequence = at + view.getUint16(at + 6 + 2 * i);
				const list = Array.from({ length: view.getUint16(sequence) }, (_, k) => view.getUint16(sequence + 2 + 2 * k));
				if (!out.multiple.has(g)) out.multiple.set(g, []);
				out.multiple.get(g)!.push(list);
			});
		}
		else if (type === 4 && format === 1) {
			glyphs.forEach((g, i) => {
				const set = at + view.getUint16(at + 6 + 2 * i);
				for (let k = 0, n = view.getUint16(set); k < n; k++) {
					const ligature = set + view.getUint16(set + 2 + 2 * k);
					const count = view.getUint16(ligature + 2);
					const components = Array.from({ length: count - 1 }, (_, c) => view.getUint16(ligature + 4 + 2 * c));
					if (!out.ligature.has(g)) out.ligature.set(g, []);
					out.ligature.get(g)!.push({ components, glyph: view.getUint16(ligature) });
				}
			});
		}
	};
	try {
		const lookups = gsub + view.getUint16(gsub + 8);
		for (let i = 0, n = view.getUint16(lookups); i < n; i++) {
			const lookup = lookups + view.getUint16(lookups + 2 + 2 * i);
			const type = view.getUint16(lookup);
			for (let k = 0, m = view.getUint16(lookup + 4); k < m; k++) subtable(type, lookup + view.getUint16(lookup + 6 + 2 * k));
		}
	}
	catch {
		return { single: new Map(), multiple: new Map(), ligature: new Map() };
	}
	return out;
}
