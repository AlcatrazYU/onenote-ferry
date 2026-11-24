// Renders one page of the semantic model to Markdown.
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/convert.ts at commit fa9444a,
// with reading order, list nesting, printouts and position comments reworked.
// See THIRD_PARTY_LICENSES.md.

import type { AssetData, Element, EmbeddedFile, Image, Ink, InkStroke, Page, Paragraph, Table, Tag } from '../model.ts';
import { MIN_PEN_OPACITY } from '../model.ts';
import { escapeLineStart } from '../markdown.ts';
import type { Strings } from '../strings.ts';
import { renderRuns } from './inline.ts';
import type { InlineOptions } from './inline.ts';
import { strokesToSvg } from './ink-svg.ts';

/** Converts half-inch ink units to CSS pixels at 96 DPI. */
const PIXELS_PER_INK_UNIT = 48;
/** Page positions are in half inches. */
const CM_PER_POSITION_UNIT = 1.27;

/** What an attachment is, so the writer can name it. */
export type AttachmentHint =
	| { role: 'image'; extension?: string }
	| { role: 'inline-ink' }
	| { role: 'page-ink' }
	| { role: 'file'; fileName: string };

export interface ResolvedAttachment {
	/** Link target relative to the page, e.g. `_附件/x.png`. */
	path: string;
	name: string;
}

export interface PageRenderOptions extends InlineOptions {
	/** Write a position comment before each text box when the page has several columns. */
	boxMarkers: boolean;
	/** Also draw highlighter strokes (semi-transparent ink). Off by default: they only make sense laid over the text. */
	keepHighlighterInk?: boolean;
	strings: Strings;
	/** Stores one attachment and answers with its link target, or null to leave it out. */
	saveAttachment: (data: AssetData, hint: AttachmentHint) => Promise<ResolvedAttachment | null>;
	onSkipped?: (description: string, reason: 'no-data') => void;
	isCancelled?: () => boolean;
}

export interface RenderedPage {
	markdown: string;
	attachments: ResolvedAttachment[];
}

export function extensionFromName(name: string | undefined): string | undefined {
	return name?.match(/\.([^.\s\\/]+)$/)?.[1];
}

/** An attachment without an extension is one the vault cannot open. */
export function withExtension(base: string, extension: string | undefined): string {
	if (!extension) return base;
	if (extensionFromName(base)) return base;
	return base + (extension.startsWith('.') ? extension : `.${extension}`);
}

function fileHint(file: EmbeddedFile): AttachmentHint {
	return { role: 'file', fileName: withExtension(file.fileName ?? 'attachment', file.extension) };
}

function imageHint(image: Image): AttachmentHint {
	if (image.inkSvg) return { role: 'inline-ink' };
	return { role: 'image', extension: image.extension ?? extensionFromName(image.fileName) };
}

function describe(hint: AttachmentHint): string {
	switch (hint.role) {
		case 'file': return hint.fileName;
		case 'image': return `image${hint.extension ? '.' + hint.extension : ''}`;
		case 'inline-ink': return 'ink.svg';
		case 'page-ink': return 'page ink.svg';
	}
}

function hasData(data: AssetData | undefined): data is AssetData {
	if (!data) return false;
	// The parser never names an empty attachment, so a stored one is always there.
	return data.kind === 'stored' || data.bytes.length > 0;
}

function headingPrefix(styleId: string | undefined): string {
	const level = styleId?.match(/^h([1-6])$/i);
	return level ? '#'.repeat(Number(level[1])) + ' ' : '';
}

// NoteTagShape values shown as Obsidian callouts, and the symbol a tagged heading shows instead.
const CALLOUT_SHAPES: Record<number, { type: string, symbol: string }> = {
	13: { type: 'important', symbol: '⭐' }, // Yellow star
	15: { type: 'question', symbol: '❓' }, // Question mark
	17: { type: 'danger', symbol: '❗' }, // High priority (red exclamation mark)
	21: { type: 'tip', symbol: '💡' }, // Light bulb
	111: { type: 'question', symbol: '❓' }, // Question balloon (desktop files only)
};

interface Callout {
	type: string;
	title?: string;
	symbol: string;
}

/** Tags in a table cell, where neither a callout nor a task box fits: symbols before the text. */
function cellTagPrefix(tags: Tag[] | undefined): string {
	const task = tags?.find(tag => tag.checkable);
	const callout = calloutFor(tags);
	return (task ? (task.completed ? '\u2611 ' : '\u2610 ') : '') + (callout ? `${callout.symbol} ` : '');
}

function calloutFor(tags: Tag[] | undefined): Callout | undefined {
	for (const tag of tags ?? []) {
		if (tag.checkable || tag.shape === undefined) continue;
		const shape = CALLOUT_SHAPES[tag.shape];
		if (shape) return { type: shape.type, title: tag.label, symbol: shape.symbol };
	}
	return undefined;
}

interface Block {
	text: string;
	listItem: boolean;
	callout?: string;
	/** A position comment; printout runs look through these. */
	marker?: boolean;
	/** Pictures without data in a row, shown as one notice, and the list depth it was written at. */
	missing?: MissingRun;
	depth?: number;
}

type MissingRun = { kind: 'images', count: number, names: string[] } | { kind: 'printout', document: string, first: number, last: number };

/** The notice for pictures without data (one, or a run of them). */
function missingNotice(run: MissingRun, strings: Strings): string {
	return run.kind === 'printout' ? strings.missingPrintoutPages(run.document, run.first, run.last) : strings.missingImages(run.count, run.names);
}

function missingRunOf(image: Image): MissingRun {
	return image.printoutName && image.printoutPage
		? { kind: 'printout', document: image.printoutName, first: image.printoutPage, last: image.printoutPage }
		: { kind: 'images', count: 1, names: image.fileName ? [image.fileName] : [] };
}

function containsTable(elements: Element[]): boolean {
	return elements.some(element => element.kind === 'table'
		|| ((element.kind === 'outline' || element.kind === 'paragraph') && containsTable(element.children)));
}

class PageWriter {
	private readonly options: PageRenderOptions;
	private readonly blocks: Block[] = [];
	private readonly inkStrokes: InkStroke[] = [];
	private readonly recognizedText: string[] = [];
	readonly attachments: ResolvedAttachment[] = [];
	/** How many list items enclose what is being written; each adds one tab. */
	private depth = 0;
	/** The PDF whose embed was written last, so the following printout pages of it are not embedded again. */
	private lastPrintout?: { file: EmbeddedFile, index: number };

	constructor(options: PageRenderOptions) {
		this.options = options;
	}

	get markdown(): string {
		const lines: string[] = [];
		for (const [index, block] of this.blocks.entries()) {
			const previous = this.blocks[index - 1];
			if (previous && !(block.listItem && previous.listItem)) lines.push('');
			lines.push(block.text);
		}
		return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	marker(text: string): void {
		this.blocks.push({ text, listItem: false, marker: true });
	}

	private push(text: string, listItem = false): void {
		const indent = '\t'.repeat(this.depth);
		this.blocks.push({ text: indent ? text.split('\n').map(line => line ? indent + line : line).join('\n') : text, listItem });
	}

	/** For text that already carries its own indentation. */
	private pushRaw(text: string, listItem: boolean): void {
		this.blocks.push({ text, listItem });
	}

	private pushCallout(callout: Callout, body: string): void {
		const quoted = body.split('\n').map(line => `> ${line}`).join('\n');
		const previous = this.blocks[this.blocks.length - 1];
		const opening = `> [!${callout.type}]${callout.title ? ` ${callout.title}` : ''}`;
		if (previous?.callout === opening) {
			previous.text += `\n>\n${quoted}`;
			return;
		}
		this.blocks.push({ text: `${opening}\n${quoted}`, listItem: false, callout: opening });
	}

	async writeElements(elements: Element[]): Promise<void> {
		// OneNote keeps counting numbered siblings across plain paragraphs between them;
		// only a bulleted sibling starts the count again.
		let ordinal = 0;
		for (const element of elements) {
			if (this.options.isCancelled?.()) return;
			if (element.kind === 'paragraph' && element.list) ordinal = element.list.ordered ? ordinal + 1 : 0;
			await this.writeElement(element, ordinal);
		}
	}

	private async writeElement(element: Element, ordinal = 0): Promise<void> {
		switch (element.kind) {
			case 'outline':
				await this.writeElements(element.children);
				break;
			case 'paragraph':
				await this.writeParagraph(element, ordinal);
				break;
			case 'table':
				await this.writeTable(element);
				break;
			case 'image': {
				const printout = element.printoutOf;
				// Obsidian embeds the whole PDF as a scrollable viewer, so one embed stands for a run of printout pages.
				if (printout && this.lastPrintout?.file === printout
					&& this.blocks.slice(this.lastPrintout.index + 1).every(block => block.marker)) break;
				if (printout) {
					// Show that page of the original PDF instead of an XPS Obsidian cannot display.
					const link = await this.renderAsset(printout.data, fileHint(printout), '', true);
					if (link) {
						this.push(link.replace(/>\)$/, `#page=${element.printoutPage}>)`));
						this.lastPrintout = { file: printout, index: this.blocks.length - 1 };
						break;
					}
				}
				if (!hasData(element.data)) {
					this.options.onSkipped?.(describe(imageHint(element)), 'no-data');
					this.pushMissing(element);
					break;
				}
				await this.writeAsset(element.data, imageHint(element), '', true);
				break;
			}
			case 'embedded-file': {
				const hint = fileHint(element);
				await this.writeAsset(element.data, hint, hint.role === 'file' ? hint.fileName : '', false);
				break;
			}
			case 'ink':
				this.collectInk(element);
				break;
		}
	}

	private async writeParagraph(paragraph: Paragraph, ordinal = 0): Promise<void> {
		const text = renderRuns(paragraph.runs, this.options);
		const heading = headingPrefix(paragraph.styleId);
		// Nesting comes from the outline tree, not from the parser's list level (always 1).
		// A bulleted heading at the top is a heading: the bullet is only decoration.
		const list = paragraph.list && !(heading && this.depth === 0) ? paragraph.list : undefined;
		const task = paragraph.tags?.find(tag => tag.checkable);
		const marker = task ? (task.completed ? '- [x] ' : '- [ ] ')
			: list ? (list.ordered ? `${Math.max(1, ordinal)}. ` : '- ') : '';

		if (text !== '') {
			const indent = '\t'.repeat(this.depth);
			const escaped = text.split('\n').map(escapeLineStart);
			const callout = calloutFor(paragraph.tags);
			// Only a plain paragraph at the top becomes a callout. Anywhere else (a heading, which must
			// stay a heading for the outline and links; a list item or a paragraph inside one, which a
			// callout would break) the tag becomes a symbol before the text.
			const asCallout = callout !== undefined && !marker && !heading && this.depth === 0;
			const symbol = callout && !asCallout ? `${callout.symbol} ` : '';
			const body = indent + (marker || heading) + symbol + escaped.join('  \n' + indent + (marker ? '\t' : ''));
			if (callout && asCallout) this.pushCallout(callout, body);
			else this.pushRaw(body, marker !== '');
		}

		// Children of a list item belong to it and are indented under it.
		const nests = marker !== '' && text !== '';
		if (nests) this.depth++;
		try {
			await this.writeElements(paragraph.children);
		}
		finally {
			if (nests) this.depth--;
		}
	}

	private async writeTable(table: Table): Promise<void> {
		if (table.rows.length === 0) return;

		// Markdown tables cannot nest, and a table that holds one is layout.
		if (table.rows.some(row => row.cells.some(cell => containsTable(cell.children)))) {
			for (const row of table.rows) {
				for (const cell of row.cells) await this.writeElements(cell.children);
			}
			return;
		}

		const columns = Math.max(...table.rows.map(row => row.cells.length));
		const rendered: string[][] = [];
		for (const row of table.rows) {
			const cells: string[] = [];
			for (let index = 0; index < columns; index++) {
				const text = await this.renderCell(row.cells[index]?.children ?? []);
				cells.push(text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
			}
			rendered.push(cells);
		}

		// GFM has no table without a header, so the first row becomes one.
		const lines = [
			`| ${rendered[0].join(' | ')} |`,
			`| ${new Array(columns).fill('---').join(' | ')} |`,
			...rendered.slice(1).map(row => `| ${row.join(' | ')} |`),
		];
		this.push(lines.join('\n'));
	}

	private collectInk(ink: Ink): void {
		for (const stroke of ink.strokes) {
			if (stroke.opacity < MIN_PEN_OPACITY && !this.options.keepHighlighterInk) continue;
			this.inkStrokes.push({
				points: stroke.points.map(point => ({ x: point.x * PIXELS_PER_INK_UNIT, y: point.y * PIXELS_PER_INK_UNIT })),
				color: stroke.color,
				width: Math.max(1, stroke.width * PIXELS_PER_INK_UNIT),
				opacity: stroke.opacity,
			});
		}
		// Recognition text is repeated on every stroke in a word.
		if (ink.recognizedText && ink.recognizedText !== this.recognizedText[this.recognizedText.length - 1]) {
			this.recognizedText.push(ink.recognizedText);
		}
	}

	/** Loose ink on the page becomes one drawing at the end of it. */
	async writeCollectedInk(): Promise<void> {
		const svg = strokesToSvg(this.inkStrokes);
		if (!svg) return;
		const recognizedText = this.recognizedText.join(' ');
		await this.writeAsset({ kind: 'inline', bytes: new TextEncoder().encode(svg) }, { role: 'page-ink' }, '', true);
		if (recognizedText !== '') this.push(recognizedText);
	}

	/** A notice in place of a picture without data; pictures in a row (pages of one printout in order) share one. */
	private pushMissing(image: Image): void {
		const run = missingRunOf(image);
		const previous = this.blocks[this.blocks.length - 1];
		const last = previous?.missing;
		const indent = '\t'.repeat(this.depth);
		if (last && previous.depth === this.depth) {
			if (last.kind === 'images' && run.kind === 'images') {
				last.count++;
				last.names.push(...run.names);
				previous.text = indent + this.notice(last);
				return;
			}
			if (last.kind === 'printout' && run.kind === 'printout' && last.document === run.document && run.first === last.last + 1) {
				last.last = run.first;
				previous.text = indent + this.notice(last);
				return;
			}
		}
		this.blocks.push({ text: indent + this.notice(run), listItem: false, missing: run, depth: this.depth });
	}

	private notice(run: MissingRun): string {
		return renderRuns([{ text: missingNotice(run, this.options.strings), italic: true }], this.options);
	}

	private async writeAsset(data: AssetData | undefined, hint: AttachmentHint, label: string, embed: boolean): Promise<void> {
		const link = await this.renderAsset(data, hint, label, embed);
		if (link) this.push(link);
	}

	private async renderAsset(data: AssetData | undefined, hint: AttachmentHint, label: string, embed: boolean): Promise<string | undefined> {
		if (!hasData(data)) {
			this.options.onSkipped?.(describe(hint), 'no-data');
			return undefined;
		}
		const attachment = await this.options.saveAttachment(data, hint);
		if (!attachment) {
			this.options.onSkipped?.(describe(hint), 'no-data');
			return undefined;
		}
		this.attachments.push(attachment);
		const target = `<${attachment.path}>`;
		return embed ? `![${label}](${target})` : `[${label}](${target})`;
	}

	private async renderCell(children: Element[]): Promise<string> {
		const parts: string[] = [];
		for (const child of children) {
			switch (child.kind) {
				case 'paragraph': {
					const text = renderRuns(child.runs, this.options);
					parts.push(text === '' ? '' : cellTagPrefix(child.tags) + text);
					parts.push(await this.renderCell(child.children));
					break;
				}
				case 'outline':
					parts.push(await this.renderCell(child.children));
					break;
				case 'image':
					if (!hasData(child.data)) {
						this.options.onSkipped?.(describe(imageHint(child)), 'no-data');
						parts.push(this.notice(missingRunOf(child)));
					}
					else parts.push(await this.renderAsset(child.data, imageHint(child), '', true) ?? '');
					break;
				case 'embedded-file': {
					const hint = fileHint(child);
					parts.push(await this.renderAsset(child.data, hint, hint.role === 'file' ? hint.fileName : '', false) ?? '');
					break;
				}
				case 'ink':
					this.collectInk(child);
					break;
				case 'table':
					// Unreachable: a table inside a cell makes the whole table layout (see writeTable).
					break;
			}
		}
		return parts.filter(part => part !== '').join(' ');
	}
}

interface Positioned {
	element: Element;
	index: number;
	x?: number;
	y?: number;
	w: number;
}

/**
 * Reading order: boxes that share at least half of the narrower one's width form a column;
 * columns go left to right, each column top to bottom. Unplaced content comes last.
 */
export function readingOrder(page: Page): { items: Positioned[], columns: number } {
	const items: Positioned[] = [...page.outlines, ...page.directContent].map((element, index) => {
		const place = element.place ?? {};
		return { element, index, x: place.x, y: place.y, w: place.width ?? (element.kind === 'outline' ? 13 : 4) };
	});
	const placed = items.filter(item => item.x !== undefined && item.y !== undefined).sort((a, b) => a.x! - b.x!);
	const columns: { left: number, right: number, members: Positioned[] }[] = [];
	for (const item of placed) {
		const left = item.x!, right = item.x! + Math.max(1, item.w);
		const column = columns.find(c => Math.min(c.right, right) - Math.max(c.left, left) >= 0.5 * Math.min(c.right - c.left, right - left));
		if (column) {
			column.left = Math.min(column.left, left);
			column.right = Math.max(column.right, right);
			column.members.push(item);
		}
		else columns.push({ left, right, members: [item] });
	}
	columns.sort((a, b) => a.left - b.left);
	const ordered = [
		...columns.flatMap(c => c.members.sort((a, b) => a.y! - b.y! || a.index - b.index)),
		...items.filter(item => item.x === undefined || item.y === undefined),
	];
	return { items: ordered, columns: columns.length };
}

export async function renderPage(page: Page, options: PageRenderOptions): Promise<RenderedPage> {
	const writer = new PageWriter(options);
	const { items, columns } = readingOrder(page);
	const cm = (v: number | undefined) => v === undefined ? '?' : (v * CM_PER_POSITION_UNIT).toFixed(1);
	for (const [k, item] of items.entries()) {
		// Position comments only help when the page really has several columns.
		if (options.boxMarkers && columns > 1 && items.length > 1) {
			writer.marker(options.strings.boxMarker(k + 1, items.length, cm(item.x), cm(item.y)));
		}
		await writer.writeElements([item.element]);
	}
	await writer.writeCollectedInk();
	return { markdown: writer.markdown, attachments: writer.attachments };
}
