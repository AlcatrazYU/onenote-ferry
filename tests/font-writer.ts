// A TrueType font built for tests (tests/truetype.test.ts, tests/xps.test.ts): a few glyphs, a
// character map, and substitutions of the kinds the printout text check reads.

export type Point = [x: number, y: number, on: boolean];
export type Glyph = { contours: Point[][], lsb?: number } | { parts: { glyph: number, dx: number, dy: number }[] } | undefined;

export interface Rules {
	single?: Record<number, number>;
	multiple?: Record<number, number[]>;
	ligatures?: { components: number[], glyph: number }[];
}

/** A TrueType font of the glyphs given (glyph 0 first), a character map, and substitutions. */
export function buildFont(glyphs: Glyph[], cmap: Record<number, number>, advances: number[], rules: Rules = {}): Uint8Array {
	const bytes = (n: number) => ({ data: [] as number[], u8(v: number) { this.data.push(v & 0xff); return this; }, u16(v: number) { this.data.push((v >> 8) & 0xff, v & 0xff); return this; }, i16(v: number) { return this.u16(v & 0xffff); }, u32(v: number) { return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff); }, size: n });
	const glyf: number[] = [], loca: number[] = [0], lsbs: number[] = [];
	for (const glyph of glyphs) {
		const b = bytes(0);
		if (glyph && 'contours' in glyph) {
			const points = glyph.contours.flat();
			const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
			const xMin = Math.min(...xs);
			lsbs.push(glyph.lsb ?? xMin);
			b.i16(glyph.contours.length).i16(xMin).i16(Math.min(...ys)).i16(Math.max(...xs)).i16(Math.max(...ys));
			let end = -1;
			for (const contour of glyph.contours) b.u16(end += contour.length);
			b.u16(0); // no instructions
			for (const p of points) b.u8(p[2] ? 1 : 0); // x and y as 16-bit deltas
			let x = 0, y = 0;
			for (const p of points) { b.i16(p[0] - x); x = p[0]; }
			for (const p of points) { b.i16(p[1] - y); y = p[1]; }
		}
		else if (glyph) {
			lsbs.push(0);
			b.i16(-1).i16(0).i16(0).i16(0).i16(0);
			glyph.parts.forEach((part, i) => b.u16(0x0003 | (i < glyph.parts.length - 1 ? 0x20 : 0)).u16(part.glyph).i16(part.dx).i16(part.dy));
		}
		else lsbs.push(0);
		while (b.data.length % 4) b.u8(0);
		glyf.push(...b.data);
		loca.push(glyf.length);
	}
	const head = bytes(0).u32(0x00010000).u32(0).u32(0).u32(0x5f0f3cf5).u16(0).u16(1000).u32(0).u32(0).u32(0).u32(0).i16(0).i16(0).i16(0).i16(0).u16(0).u16(8).i16(2).i16(1).i16(0);
	const maxp = bytes(0).u32(0x00005000).u16(glyphs.length);
	const hhea = bytes(0).u32(0x00010000);
	for (let i = 0; i < 15; i++) hhea.u16(0);
	hhea.u16(glyphs.length);
	const hmtx = bytes(0);
	glyphs.forEach((_, i) => hmtx.u16(advances[i] ?? 0).i16(lsbs[i]!));
	const locaTable = bytes(0);
	for (const offset of loca) locaTable.u32(offset);
	// cmap: one format 4 subtable, a segment per character, then the closing segment.
	const codes = Object.keys(cmap).map(Number).sort((a, b) => a - b);
	const segments = codes.length + 1;
	const sub = bytes(0).u16(4).u16(16 + segments * 8).u16(0).u16(segments * 2).u16(0).u16(0).u16(0);
	for (const c of codes) sub.u16(c);
	sub.u16(0xffff).u16(0);
	for (const c of codes) sub.u16(c);
	sub.u16(0xffff);
	for (const c of codes) sub.i16((cmap[c]! - c) & 0xffff);
	sub.u16(1);
	for (let i = 0; i < segments; i++) sub.u16(0);
	const cmapTable = bytes(0).u16(0).u16(1).u16(3).u16(1).u32(12);
	cmapTable.data.push(...sub.data);
	// GSUB: a lookup for each kind of rule given (single format 2, multiple, ligature).
	const coverageOf = (list: number[]) => { const c = bytes(0).u16(1).u16(list.length); for (const g of list) c.u16(g); return c.data; };
	const lookups: number[][] = [];
	const single = Object.keys(rules.single ?? {}).map(Number).sort((a, b) => a - b);
	if (single.length) {
		const st = bytes(0).u16(2).u16(6 + 2 * single.length).u16(single.length);
		for (const g of single) st.u16(rules.single![g]!);
		lookups.push(lookupOf(1, [...st.data, ...coverageOf(single)]));
	}
	const multiple = Object.keys(rules.multiple ?? {}).map(Number).sort((a, b) => a - b);
	if (multiple.length) {
		const sequences = multiple.map(g => { const q = bytes(0).u16(rules.multiple![g]!.length); for (const x of rules.multiple![g]!) q.u16(x); return q.data; });
		const head = 6 + 2 * multiple.length;
		const st = bytes(0).u16(1).u16(head + sequences.reduce((n, q) => n + q.length, 0)).u16(multiple.length);
		let at = head;
		for (const q of sequences) { st.u16(at); at += q.length; }
		lookups.push(lookupOf(2, [...st.data, ...sequences.flat(), ...coverageOf(multiple)]));
	}
	const firsts = [...new Set((rules.ligatures ?? []).map(l => l.components[0]!))].sort((a, b) => a - b);
	if (firsts.length) {
		const sets = firsts.map(first => {
			const ligatures = rules.ligatures!.filter(l => l.components[0] === first).map(l => { const b = bytes(0).u16(l.glyph).u16(l.components.length); for (const c of l.components.slice(1)) b.u16(c); return b.data; });
			const set = bytes(0).u16(ligatures.length);
			let at = 2 + 2 * ligatures.length;
			for (const l of ligatures) { set.u16(at); at += l.length; }
			return [...set.data, ...ligatures.flat()];
		});
		const head = 6 + 2 * firsts.length;
		const st = bytes(0).u16(1).u16(head + sets.reduce((n, q) => n + q.length, 0)).u16(firsts.length);
		let at = head;
		for (const q of sets) { st.u16(at); at += q.length; }
		lookups.push(lookupOf(4, [...st.data, ...sets.flat(), ...coverageOf(firsts)]));
	}
	function lookupOf(type: number, subtable: number[]) { return [...bytes(0).u16(type).u16(0).u16(1).u16(8).data, ...subtable]; }
	const gsub = bytes(0);
	if (lookups.length) {
		const list = bytes(0).u16(lookups.length);
		let at = 2 + 2 * lookups.length;
		for (const l of lookups) { list.u16(at); at += l.length; }
		gsub.u32(0x00010000).u16(10).u16(10).u16(14).u16(0).u16(0);
		gsub.data.push(...list.data, ...lookups.flat());
	}
	const tables: [string, number[]][] = [['cmap', cmapTable.data], ...(lookups.length ? [['GSUB', gsub.data] as [string, number[]]] : []), ['glyf', glyf], ['head', head.data], ['hhea', hhea.data], ['hmtx', hmtx.data], ['loca', locaTable.data], ['maxp', maxp.data]];
	const out = bytes(0).u32(0x00010000).u16(tables.length).u16(0).u16(0).u16(0);
	let offset = 12 + 16 * tables.length;
	const body: number[] = [];
	for (const [tag, data] of tables) {
		for (const ch of tag) out.u8(ch.charCodeAt(0));
		out.u32(0).u32(offset).u32(data.length);
		body.push(...data);
		while (body.length % 4) body.push(0);
		offset = 12 + 16 * tables.length + body.length;
	}
	return Uint8Array.from([...out.data, ...body]);
}
