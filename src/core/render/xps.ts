// Pages of a Windows printout drawn as SVG (§11.5 item 70), so that ink written on a printout page
// can be drawn over the page itself, as on a picture.
//
// A Windows printout keeps the whole document as one XPS file (a zip package of XML pages and
// their images); OneNote shows a page of it. A page printed from a scan is made of image strips
// and filled shapes, which SVG draws as they are: XPS path data is SVG path data but for a leading
// fill rule. Anything else (text in glyphs, gradients, brushes of other kinds) is not drawn here:
// such a page is answered with nothing, and the ink is drawn as before.

import { entryDataOffset, readZipDirectory } from '../zip.ts';
import type { ZipEntry } from '../zip.ts';
import { base64, pictureInfo } from './picture.ts';

/** One page as SVG content (what goes inside an `<svg>`), in the page's own units (1/96 inch). */
export interface XpsPage {
	width: number;
	height: number;
	content: string;
}

export interface XpsDocument {
	/** How many pages it has. */
	readonly pages: number;
	/** Page `n` (from 1), or undefined when it cannot be drawn here. */
	page(n: number): Promise<XpsPage | undefined>;
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

const unescape = (value: string) => value.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: '\'', amp: '&' })[name]!);

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
		return {
			pages: pages.length,
			async page(n) {
				const path = pages[n - 1];
				if (path === undefined) return undefined;
				try {
					return await pageSvg(pkg, path);
				}
				catch {
					return undefined;
				}
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

/** Builds the SVG of one page; throws on what it does not draw. */
async function pageSvg(pkg: Package, path: string): Promise<XpsPage | undefined> {
	const xml = await pkg.text(path);
	if (xml === undefined) return undefined;
	// What is not drawn here: text, other brushes, transforms and data given as elements, visuals.
	if (/<(Glyphs|LinearGradientBrush|RadialGradientBrush|VisualBrush|[\w]+\.RenderTransform|[\w]+\.OpacityMask|Path\.Data|ImageBrush\.Transform)\b/.test(xml)) return undefined;
	if (/\sOpacityMask\s*=/.test(xml)) return undefined;
	// Shapes kept in resource dictionaries (the page's own, and those it names).
	const shapes = new Map<string, { figures: string, rule: string }>();
	const dictionaries = [xml];
	for (const source of sources(xml, 'ResourceDictionary')) dictionaries.push(await pkg.text(resolve(path, source)) ?? '');
	for (const dictionary of dictionaries) {
		for (const match of dictionary.matchAll(/<PathGeometry\b([^>]*?)\/?>/g)) {
			const attrs = attributes(match[1]!);
			const key = attrs.get('x:Key'), figures = attrs.get('Figures');
			if (key && figures) shapes.set(key, { figures, rule: attrs.get('FillRule') === 'NonZero' ? 'F1 ' : 'F0 ' });
		}
	}

	const images = new Map<string, { href: string, width: number, height: number } | undefined>();
	const image = async (source: string) => {
		const at = resolve(path, source);
		if (!images.has(at)) {
			const bytes = await pkg.read(at);
			const info = bytes && pictureInfo(bytes);
			images.set(at, bytes && info && /^image\/(png|jpeg|gif)$/.test(info.mime) ? { href: `data:${info.mime};base64,${base64(bytes)}`, width: info.width, height: info.height } : undefined);
		}
		return images.get(at);
	};

	let width = 0, height = 0;
	const out: string[] = [];
	// The path being read (its fill or stroke may come as an element inside it).
	let current: { attrs: Map<string, string>, fill?: Map<string, string>, image?: Map<string, string>, stroke?: Map<string, string>, within?: 'fill' | 'stroke' } | undefined;
	const emitPath = async (attrs: Map<string, string>, fill?: Map<string, string>, imageBrush?: Map<string, string>, stroke?: Map<string, string>) => {
		const data = attrs.get('Data') ?? '';
		const resource = data.match(/^\{StaticResource\s+([^}\s]+)\s*\}$/);
		const shape = resource ? shapes.get(resource[1]!) : undefined;
		if (resource && !shape) throw new Error('missing resource');
		const geo = geometry(shape ? shape.rule + shape.figures : data);
		if (!geo) throw new Error('path data');
		const parts: string[] = [];
		const transform = attrs.get('RenderTransform');
		const opacity = attrs.has('Opacity') ? Number(attrs.get('Opacity')) : 1;
		if (!(opacity >= 0 && opacity <= 1)) throw new Error('opacity');
		const open = [transform !== undefined ? ` transform="${matrix(transform) ?? ''}"` : '', opacity !== 1 ? ` opacity="${opacity}"` : ''].join('');
		if (transform !== undefined && !matrix(transform)) throw new Error('transform');
		if (imageBrush) {
			const tile = imageBrush.get('TileMode') ?? 'None';
			const port = numbers(imageBrush.get('Viewport'), 4), box = numbers(imageBrush.get('Viewbox'), 4);
			const picture = await image(imageBrush.get('ImageSource') ?? '');
			if (tile !== 'None' || !port || !box || !picture || imageBrush.get('ViewportUnits') !== 'Absolute') throw new Error('image brush');
			// The whole picture into the viewport (as MXDC writes them): a part of it is not drawn here.
			if (box[0] !== 0 || box[1] !== 0 || Math.abs(box[2]! / box[3]! - picture.width / picture.height) > 0.02 * (picture.width / picture.height)) throw new Error('viewbox');
			parts.push(`<image x="${port[0]}" y="${port[1]}" width="${port[2]}" height="${port[3]}" preserveAspectRatio="none" href="${picture.href}"/>`);
		}
		else {
			const paint = colour(fill?.get('Color') ?? attrs.get('Fill'));
			const line = colour(stroke?.get('Color') ?? attrs.get('Stroke'));
			if ((fill || attrs.has('Fill')) && !paint) throw new Error('fill');
			if ((stroke || attrs.has('Stroke')) && !line) throw new Error('stroke');
			if (!paint && !line) return;
			const thickness = Number(attrs.get('StrokeThickness') ?? '1');
			parts.push(`<path d="${geo.d}" fill-rule="${geo.rule}" fill="${paint ? paint.paint : 'none'}"${paint && paint.opacity < 1 ? ` fill-opacity="${paint.opacity.toFixed(3)}"` : ''}${line ? ` stroke="${line.paint}" stroke-width="${thickness}"${line.opacity < 1 ? ` stroke-opacity="${line.opacity.toFixed(3)}"` : ''}` : ''}/>`);
		}
		out.push(open ? `<g${open}>${parts.join('')}</g>` : parts.join(''));
	};

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
				out.push(`<g${transform !== undefined ? ` transform="${matrix(transform)}"` : ''}${opacity}>`);
			}
		}
		else if (name === 'Path') {
			if (closing) {
				if (current) await emitPath(current.attrs, current.fill, current.image, current.stroke);
				current = undefined;
			}
			else if (selfClosing) await emitPath(attrs);
			else current = { attrs };
		}
		else if (current && (name === 'Path.Fill' || name === 'Path.Stroke')) current.within = closing ? undefined : name === 'Path.Fill' ? 'fill' : 'stroke';
		else if (current && name === 'ImageBrush' && current.within === 'fill') current.image = attrs;
		else if (current && name === 'SolidColorBrush') {
			if (current.within === 'fill') current.fill = attrs;
			else if (current.within === 'stroke') current.stroke = attrs;
		}
		else if (current && !closing) return undefined; // something inside a path that is not drawn here
	}
	const comments = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
	if (tags !== (comments.match(/<[A-Za-z/]/g) ?? []).length) return undefined;
	if (!(width > 0) || !(height > 0)) return undefined;
	return { width, height, content: `<rect width="${width}" height="${height}" fill="#ffffff"/>${out.join('')}` };
}
