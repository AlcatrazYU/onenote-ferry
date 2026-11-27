// Renders one page of the semantic model to Markdown.
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/convert.ts at commit fa9444a,
// with reading order, list nesting, printouts and position comments reworked.
// See THIRD_PARTY_LICENSES.md.

import type { AssetData, Element, EmbeddedFile, Image, Ink, InkStroke, Page, Paragraph, Table, Tag } from '../model.ts';
import { escapeInline, escapeLineStart } from '../markdown.ts';
import type { Strings } from '../strings.ts';
import { renderRuns } from './inline.ts';
import type { InlineOptions } from './inline.ts';
import { strokesToSvg } from './ink-svg.ts';
import type { DrawingParts, Underlay } from './ink-svg.ts';
import { assignToPictures, clusters, drawingUnder, insertionPoint, isHighlighter, strokeBox, unionBox } from './ink-layout.ts';
import { placeOnPictures, readProfile } from './flow-highlights.ts';
import { openXps } from './xps.ts';
import type { XpsDocument, XpsPage } from './xps.ts';
import type { Box, ColumnSpan } from './ink-layout.ts';
import { base64, pictureInfo } from './picture.ts';
import type { PictureInfo } from './picture.ts';

/** Converts half-inch ink units to CSS pixels at 96 DPI. */
const PIXELS_PER_INK_UNIT = 48;
/** Page positions are in half inches. */
const CM_PER_POSITION_UNIT = 1.27;

/** What an attachment is, so the writer can name it. */
export type AttachmentHint =
	| { role: 'image'; extension?: string }
	| { role: 'ink' }
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
	/**
	 * Write an image's alternative text in a collapsed callout below it. Off by default: in real notes
	 * most alternative text is clipped or generated (see the project notes).
	 */
	imageAltText?: boolean;
	strings: Strings;
	/** Stores one attachment and answers with its link target, or null to leave it out. */
	saveAttachment: (data: AssetData, hint: AttachmentHint) => Promise<ResolvedAttachment | null>;
	/** The bytes of a picture, to draw handwriting over it; undefined when they cannot be read. */
	readAsset?: (data: AssetData) => Promise<Uint8Array | undefined>;
	/** How dark each pixel row of a picture is (the parser's row profile), to line highlighter strokes up with its text (§11.5 item 67). */
	rowProfile?: (data: AssetData) => Promise<Float32Array | undefined>;
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
	if (image.inkSvg) return { role: 'ink' };
	return { role: 'image', extension: image.extension ?? extensionFromName(image.fileName) };
}

function describe(hint: AttachmentHint): string {
	switch (hint.role) {
		case 'file': return hint.fileName;
		case 'image': return `image${hint.extension ? '.' + hint.extension : ''}`;
		case 'ink': return 'ink.svg';
	}
}

/** One stroke of handwriting and the ink object it came from. */
interface InkPiece {
	stroke: InkStroke;
	ink: Ink;
}

/** A picture placed on the page, where it sits (half inches) and, when readable, its bytes. */
interface PlacedPicture {
	box: Box;
	bytes?: Uint8Array;
	info?: PictureInfo;
	/** A Windows printout page, drawn from its document (§11.5 item 70). */
	page?: XpsPage;
}

/** What goes under the writing on a picture: the picture itself, or the printout page drawn; none when neither can be had. */
function underlayOf(picture: PlacedPicture): Underlay | undefined {
	if (picture.page) {
		const { left, top, right } = picture.box;
		const rect = pixelRect({ left, top, right, bottom: top + (right - left) * picture.page.height / picture.page.width });
		return { ...rect, svg: picture.page };
	}
	if (picture.bytes && picture.info) return { ...pixelRect(picture.box), href: `data:${picture.info.mime};base64,${base64(picture.bytes)}` };
	return undefined;
}

/** A text box or paragraph with nothing in it at all (no text, no picture, no file, no table, no ink). */
function isBlank(element: Element): boolean {
	switch (element.kind) {
		case 'outline': return element.children.every(isBlank);
		case 'paragraph': return element.runs.every(run => run.text.trim() === '') && element.children.every(isBlank);
		default: return false;
	}
}

/** A Windows printout page keeps the whole document (XPS or PDF), not a picture of the page. */
function isWholeDocument(image: Image): boolean {
	return image.printoutPage !== undefined && /^(xps|pdf)$/i.test(image.extension ?? '');
}

function toPixels(stroke: InkStroke): InkStroke {
	return {
		points: stroke.points.map(point => ({ x: point.x * PIXELS_PER_INK_UNIT, y: point.y * PIXELS_PER_INK_UNIT })),
		color: stroke.color,
		width: Math.max(1, stroke.width * PIXELS_PER_INK_UNIT),
		opacity: stroke.opacity,
	};
}

function pixelRect(box: Box) {
	return {
		x: box.left * PIXELS_PER_INK_UNIT,
		y: box.top * PIXELS_PER_INK_UNIT,
		width: (box.right - box.left) * PIXELS_PER_INK_UNIT,
		height: (box.bottom - box.top) * PIXELS_PER_INK_UNIT,
	};
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
	readonly attachments: ResolvedAttachment[] = [];
	/** Handwriting drawn on a picture placed on the page, and where that picture sits. */
	readonly annotations = new Map<Image, InkPiece[]>();
	readonly pictures = new Map<Image, PlacedPicture>();
	/** Writing on a picture inside a text box whose place is not sure: drawn on a copy folded under it (§11.5 items 67 and 69). */
	readonly folded = new Map<Image, { pieces: InkPiece[], picture: PlacedPicture }>();
	/** Printed documents with handwriting on some page: shown page by page (Mac printouts) so the notes can be drawn on. */
	readonly annotatedDocuments = new Set<EmbeddedFile>();
	/** How many list items enclose what is being written; each adds one tab. */
	private depth = 0;
	/** The PDF whose embed was written last, so the following printout pages of it are not embedded again. */
	private lastPrintout?: { file: EmbeddedFile, index: number };
	/**
	 * Writing on pages of a PDF shown by one embed, held until the run of its pages ends, so that the
	 * embed stays one (§11.5 item 72): notes drawn on a page as they are written, and the copies
	 * whose place is estimated, which go into one folded box.
	 */
	private held?: { blocks: Block[], folded: string[], indent: string };
	/** Where blocks go while the writing on a printout page is held. */
	private capturing?: Block[];

	constructor(options: PageRenderOptions) {
		this.options = options;
	}

	get markdown(): string {
		this.release();
		const lines: string[] = [];
		for (const [index, block] of this.blocks.entries()) {
			const previous = this.blocks[index - 1];
			if (previous && !(block.listItem && previous.listItem)) lines.push('');
			lines.push(block.text);
		}
		return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	/** How many blocks are written so far (see addMarkers). */
	/** Where the first block written since beginItem went (after anything held then let go), if any. */
	private itemStart?: number;

	/** Starts counting what one item of the page writes (for its position comment, see addMarkers). */
	beginItem(): void {
		this.itemStart = undefined;
	}

	/** Where the item begun last starts in the page, or undefined when it wrote nothing. */
	get itemAt(): number | undefined {
		return this.itemStart;
	}

	/** Puts position comments in at the given places (block indexes, as itemAt told them), once the page is written. */
	addMarkers(markers: { at: number, text: string }[]): void {
		for (const { at, text } of [...markers].sort((a, b) => b.at - a.at)) this.blocks.splice(at, 0, { text, listItem: false, marker: true });
	}

	private push(text: string, listItem = false): void {
		const indent = '\t'.repeat(this.depth);
		this.add({ text: indent ? text.split('\n').map(line => line ? indent + line : line).join('\n') : text, listItem });
	}

	/** For text that already carries its own indentation. */
	private pushRaw(text: string, listItem: boolean): void {
		this.add({ text, listItem });
	}

	/** Adds a block: to what is held when the writing on a printout page is, else to the page (after anything held). */
	private add(block: Block): void {
		if (this.capturing) {
			this.capturing.push(block);
			return;
		}
		this.release();
		this.itemStart ??= this.blocks.length;
		this.blocks.push(block);
	}

	/** Writes what is held for a run of printout pages, once something else comes (§11.5 item 72). */
	private release(): void {
		const held = this.held;
		if (!held || this.capturing) return;
		this.held = undefined;
		this.blocks.push(...held.blocks);
		if (held.folded.length) {
			const body = held.folded.map(entry => entry.split('\n').map(line => `> ${line}`).join('\n')).join('\n>\n');
			const text = `> [!info]- ${this.options.strings.inkEstimated}\n${body}`;
			this.blocks.push({ text: held.indent ? text.split('\n').map(line => held.indent + line).join('\n') : text, listItem: false });
		}
	}

	/** Holds the writing on a page of a PDF shown by one embed, until the run of its pages ends. */
	private async hold(image: Image, notes: InkPiece[] | undefined): Promise<void> {
		const held = this.held ??= { blocks: [], folded: [], indent: '\t'.repeat(this.depth) };
		if (notes) {
			this.capturing = held.blocks;
			try {
				await this.writeNotesBesidePage(image, notes);
			}
			finally {
				this.capturing = undefined;
			}
		}
		const folded = this.folded.get(image);
		const underlay = folded && underlayOf(folded.picture);
		if (!folded || !underlay) return;
		const link = await this.drawingLink(folded.pieces, { underlays: [underlay] }, { role: 'ink' });
		const document = image.printoutName ?? image.fileName;
		const label = document && image.printoutPage ? renderRuns([{ text: this.options.strings.printoutPage(document, image.printoutPage), italic: true }], this.options) : undefined;
		if (link) held.folded.push(label ? `${label}\n${link}` : link);
	}

	private pushCallout(callout: Callout, body: string): void {
		this.release();
		const quoted = body.split('\n').map(line => `> ${line}`).join('\n');
		const previous = this.blocks[this.blocks.length - 1];
		const opening = `> [!${callout.type}]${callout.title ? ` ${callout.title}` : ''}`;
		if (previous?.callout === opening) {
			previous.text += `\n>\n${quoted}`;
			return;
		}
		this.itemStart ??= this.blocks.length;
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
				const notes = this.annotations.get(element);
				const printout = element.printoutOf;
				// A Mac printout page is a picture: when the document has handwriting on it, its pages are shown as pictures with the notes drawn on.
				const pageByPage = printout && !isWholeDocument(element) && this.annotatedDocuments.has(printout);
				if (printout && !pageByPage) {
					// Obsidian embeds the whole PDF as a scrollable viewer, so one embed stands for a run of printout pages.
					if (this.lastPrintout?.file === printout && this.blocks.slice(this.lastPrintout.index + 1).every(block => block.marker)) {
						await this.hold(element, notes);
						break;
					}
					// Show that page of the original PDF instead of an XPS Obsidian cannot display.
					const link = await this.renderAsset(printout.data, fileHint(printout), '', true);
					if (link) {
						this.push(link.replace(/>\)$/, `#page=${element.printoutPage}>)`));
						this.lastPrintout = { file: printout, index: this.blocks.length - 1 };
						await this.hold(element, notes);
						break;
					}
				}
				if (!hasData(element.data)) {
					this.options.onSkipped?.(describe(imageHint(element)), 'no-data');
					this.pushMissing(element);
					break;
				}
				if (notes && !isWholeDocument(element) && await this.writeAnnotatedPicture(element, notes)) {
					if (this.options.imageAltText && element.alt) this.pushAltText(element.alt);
					break;
				}
				await this.writeAsset(element.data, imageHint(element), '', true);
				if (notes) await this.writeNotesBesidePage(element, notes);
				await this.writeFolded(element);
				if (this.options.imageAltText && element.alt) this.pushAltText(element.alt);
				break;
			}
			case 'embedded-file': {
				const hint = fileHint(element);
				await this.writeAsset(element.data, hint, hint.role === 'file' ? hint.fileName : '', false);
				break;
			}
			case 'ink':
				// Handwriting on a line of its own in a text box: drawn in its place.
				await this.writeDrawing(this.visible(element.strokes.map(stroke => ({ stroke, ink: element }))));
				break;
		}
	}

	private async writeParagraph(paragraph: Paragraph, ordinal = 0): Promise<void> {
		if (paragraph.missingFile !== undefined) this.options.onSkipped?.(paragraph.missingFile, 'no-data');
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

	/**
	 * Pen strokes, with the highlighter strokes that lie on them (§11.5 item 67); every highlighter
	 * stroke only when asked for: away from handwriting or a picture they mark nothing.
	 */
	private visible(pieces: InkPiece[]): InkPiece[] {
		if (this.options.keepHighlighterInk) return pieces;
		const pens = pieces.filter(piece => !isHighlighter(piece.stroke)).map(piece => piece.stroke);
		if (!pens.length) return [];
		return pieces.filter(piece => !isHighlighter(piece.stroke) || drawingUnder(piece.stroke, [pens]) === 0);
	}

	/** Handwriting as an embedded drawing (and the recognized text, when OneNote kept any). */
	async writeDrawing(pieces: InkPiece[], parts: DrawingParts = {}): Promise<void> {
		const link = await this.drawingLink(pieces, parts, { role: 'ink' });
		if (!link) return;
		this.push(link);
		// Recognition text is repeated on every stroke in a word.
		const texts: string[] = [];
		for (const { ink } of pieces) {
			if (ink.recognizedText && !texts.includes(ink.recognizedText)) texts.push(ink.recognizedText);
		}
		if (texts.length) this.push(texts.join(' '));
	}

	private async drawingLink(pieces: InkPiece[], parts: DrawingParts = {}, hint: AttachmentHint = { role: 'ink' }): Promise<string | undefined> {
		const svg = strokesToSvg(pieces.map(piece => toPixels(piece.stroke)), parts);
		if (!svg) return undefined;
		return this.renderAsset({ kind: 'inline', bytes: new TextEncoder().encode(svg) }, hint, '', true);
	}

	/** A picture with the handwriting on it drawn over it, as one drawing. False when the picture cannot be drawn. */
	private async writeAnnotatedPicture(image: Image, notes: InkPiece[]): Promise<boolean> {
		const picture = this.pictures.get(image);
		const underlay = picture?.bytes && picture.info ? underlayOf(picture) : undefined;
		if (!underlay) return false;
		const link = await this.drawingLink(notes, { underlays: [underlay] }, { role: 'image', extension: 'svg' });
		if (!link) return false;
		this.push(link);
		return true;
	}

	/**
	 * Writing on a picture whose place in its text box is not sure (§11.5 items 67 and 69): all of it,
	 * handwriting and highlighter, drawn on one copy of the picture where it was estimated to be,
	 * folded under the picture and marked as estimated.
	 * The copy is named as a drawing, so the pictures after it on the page keep their numbers.
	 */
	private async writeFoldedHighlights(pieces: InkPiece[], picture: PlacedPicture): Promise<void> {
		const underlay = underlayOf(picture);
		if (!underlay) return;
		const link = await this.drawingLink(pieces, { underlays: [underlay] }, { role: 'ink' });
		if (link) this.push(`> [!info]- ${this.options.strings.inkEstimated}\n> ${link}`);
	}

	/**
	 * Handwriting on a printout page that cannot be drawn here (Windows printouts keep the whole
	 * document, not a picture of the page): a note naming the page, then the notes on a blank sheet
	 * of the page's size, where they sit on it.
	 */
	private async writeNotesBesidePage(image: Image, notes: InkPiece[]): Promise<void> {
		const picture = this.pictures.get(image);
		const pieces = picture ? notes : this.visible(notes);
		if (!pieces.length) return;
		const document = image.printoutName ?? image.fileName;
		if (picture && document && image.printoutPage) {
			this.push(renderRuns([{ text: this.options.strings.printoutNotes(document, image.printoutPage), italic: true }], this.options));
		}
		// On the page itself when it can be drawn from its document (§11.5 item 70), else on a blank sheet of its size.
		const page = picture && (picture.page ?? await this.printoutPage(image));
		const underlay = picture && page ? underlayOf({ ...picture, page }) : undefined;
		await this.writeDrawing(pieces, underlay ? { underlays: [underlay] } : picture ? { sheets: [pixelRect(picture.box)] } : {});
	}

	/** Each Windows printout document read once per page written (§11.5 item 70). */
	private readonly documents = new Map<string, Promise<XpsDocument | undefined>>();

	/** The page a Windows printout picture shows, drawn from its XPS document; undefined when it cannot be. */
	async printoutPage(image: Image): Promise<XpsPage | undefined> {
		if (!isWholeDocument(image) || image.data?.kind !== 'stored' || !image.printoutPage || !/^xps$/i.test(image.extension ?? '')) return undefined;
		const data = image.data;
		if (!this.documents.has(data.key)) {
			this.documents.set(data.key, (async () => {
				const bytes = await this.options.readAsset?.(data).catch(() => undefined);
				return bytes ? openXps(bytes) : undefined;
			})());
		}
		return (await this.documents.get(data.key))?.page(image.printoutPage);
	}

	/** The copy of a picture with the writing on it drawn where it was estimated to be, when there is one. */
	private async writeFolded(image: Image): Promise<void> {
		const folded = this.folded.get(image);
		if (folded) await this.writeFoldedHighlights(folded.pieces, folded.picture);
	}

	/** Loose handwriting that falls between two blocks of the page. */
	async writeLooseInk(pieces: InkPiece[]): Promise<void> {
		if (pieces.length) await this.writeDrawing(pieces);
	}

	/** An image's alternative text as it was in OneNote, in a callout below the image that starts collapsed. */
	private pushAltText(alt: string): void {
		const lines = alt.replace(/\r\n?/g, '\n').trim().split('\n').map(line => escapeLineStart(escapeInline(line.trim())));
		this.push([`> [!info]- ${this.options.strings.altTextTitle}`, ...lines.map(line => (line === '' ? '>' : `> ${line}`))].join('\n'));
	}

	/** A notice in place of a picture without data; pictures in a row (pages of one printout in order) share one. */
	private pushMissing(image: Image): void {
		this.release();
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
		this.itemStart ??= this.blocks.length;
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
					if (child.missingFile !== undefined) this.options.onSkipped?.(child.missingFile, 'no-data');
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
					parts.push(await this.drawingLink(this.visible(child.strokes.map(stroke => ({ stroke, ink: child })))) ?? '');
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
export function readingOrder(page: Page): { items: Positioned[], columns: number, spans: ColumnSpan[] } {
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
	const spans = columns.map(c => ({ left: c.left, right: c.right, members: c.members.map(m => ({ order: ordered.indexOf(m), top: m.y! })) }));
	return { items: ordered, columns: columns.length, spans };
}

/** Height over width of a Windows printout page that has no other page of its document below it (A4). */
const PAGE_ASPECT = Math.SQRT2;

/** Pictures placed straight on the page, with where they sit; only read when the page has loose handwriting. */
async function placedPictures(items: Positioned[], options: PageRenderOptions): Promise<Map<Image, PlacedPicture>> {
	const pictures = new Map<Image, PlacedPicture>();
	const documents = new Map<string, { image: Image, left: number, top: number, width: number }[]>();
	for (const { element } of items) {
		if (element.kind !== 'image' || element.inkSvg || !hasData(element.data)) continue;
		const place = element.place;
		if (place?.x === undefined || place.y === undefined || !place.width) continue;
		if (isWholeDocument(element)) {
			const key = element.data.kind === 'stored' ? element.data.key : element.printoutName ?? '';
			if (!documents.has(key)) documents.set(key, []);
			documents.get(key)!.push({ image: element, left: place.x, top: place.y, width: place.width });
			continue;
		}
		const bytes = await options.readAsset?.(element.data);
		const info = bytes ? pictureInfo(bytes) : undefined;
		if (!bytes || !info) continue;
		const height = place.width * info.height / info.width;
		pictures.set(element, { box: { left: place.x, top: place.y, right: place.x + place.width, bottom: place.y + height }, bytes, info });
	}
	for (const pages of documents.values()) {
		pages.sort((a, b) => a.top - b.top);
		pages.forEach((page, i) => {
			const next = pages[i + 1], previous = pages[i - 1];
			const height = next ? next.top - page.top : previous ? page.top - previous.top : page.width * PAGE_ASPECT;
			pictures.set(page.image, { box: { left: page.left, top: page.top, right: page.left + page.width, bottom: page.top + height } });
		});
	}
	return pictures;
}

export async function renderPage(page: Page, options: PageRenderOptions): Promise<RenderedPage> {
	const writer = new PageWriter(options);
	// Loose handwriting is laid out apart from the blocks of the page: onto the picture it was
	// drawn on, or into the reading order between the blocks where it sits.
	const loose = page.directContent.filter((element): element is Ink => element.kind === 'ink');
	const { items, columns, spans } = readingOrder({ ...page, directContent: page.directContent.filter(element => element.kind !== 'ink') });
	const slots = new Map<number, InkPiece[]>();
	const slotted = new Map<number, { piece: InkPiece, index: number }[]>();
	const pieces: InkPiece[] = [...loose, ...(page.highlighterInk ?? [])].flatMap(ink => ink.strokes.map(stroke => ({ stroke, ink })));
	if (pieces.length) {
		const pictures = await placedPictures(items, options);
		const placed = [...pictures.entries()];
		const owners = assignToPictures(pieces.map(piece => piece.stroke), placed.map(([, picture]) => picture.box));
		const free: { piece: InkPiece, index: number }[] = [];
		pieces.forEach((piece, index) => {
			const owner = owners[index];
			if (owner < 0) {
				free.push({ piece, index });
				return;
			}
			const [image, picture] = placed[owner];
			if (!writer.annotations.has(image)) writer.annotations.set(image, []);
			writer.annotations.get(image)!.push(piece);
			writer.pictures.set(image, picture);
			if (image.printoutOf && !isWholeDocument(image)) writer.annotatedDocuments.add(image.printoutOf);
		});
		const boxOf = (item: { piece: InkPiece }) => strokeBox(item.piece.stroke);
		const pen = (item: { piece: InkPiece }) => !isHighlighter(item.piece.stroke);
		const keepAll = !!options.keepHighlighterInk;
		// Writing on a picture inside a text box (§11.5 items 67 and 69): handwriting and highlighter
		// together, drawn into the picture when its place is sure, else onto one copy folded under it.
		let loose = free;
		if (!keepAll) {
			const placed = await placeOnPictures(page.outlines, free.map(item => item.piece.stroke), async image => {
				const raw = image.data ? await options.rowProfile?.(image.data) : undefined;
				return raw ? readProfile(raw) : undefined;
			});
			const taken = new Set<number>();
			for (const { image, box, strokes, sure } of placed) {
				// The picture, or the Windows printout page drawn from its document (§11.5 item 70).
				let picture: PlacedPicture | undefined;
				if (isWholeDocument(image)) {
					const page = await writer.printoutPage(image);
					if (page) picture = { box, page };
				}
				else {
					const bytes = image.data ? await options.readAsset?.(image.data) : undefined;
					const info = bytes ? pictureInfo(bytes) : undefined;
					if (bytes && info) picture = { box, bytes, info };
				}
				// A picture that cannot be drawn on: its handwriting stays a drawing of its own, as before.
				if (!picture) continue;
				const notes = strokes.map(i => free[i]!.piece);
				for (const i of strokes) taken.add(i);
				if (sure) {
					writer.annotations.set(image, notes);
					writer.pictures.set(image, picture);
				}
				else writer.folded.set(image, { pieces: notes, picture });
				// A Mac printout page marked so is shown page by page, as with handwriting on it: the
				// strokes go onto its picture, or onto the copy folded under it.
				if (image.printoutOf && !isWholeDocument(image)) writer.annotatedDocuments.add(image.printoutOf);
			}
			loose = free.filter((_, i) => !taken.has(i));
		}
		// The rest: drawings are made of pen strokes and placed by them, as before; a highlighter stroke
		// goes into the drawing it lies on (§11.5 item 67), and one away from any is not drawn (unless
		// every one is asked for).
		for (const group of clusters(keepAll ? loose : loose.filter(pen), boxOf)) {
			const slot = insertionPoint(unionBox(group.map(boxOf)), spans, items.length);
			if (!slotted.has(slot)) slotted.set(slot, []);
			slotted.get(slot)!.push(...group);
		}
		if (!keepAll) {
			const drawings = [...slotted.values()];
			const pens = drawings.map(list => list.map(item => item.piece.stroke));
			for (const item of loose) {
				if (pen(item)) continue;
				const under = drawingUnder(item.piece.stroke, pens);
				if (under >= 0) drawings[under]!.push(item);
			}
		}
		// Within one drawing, strokes keep the order they were written in.
		for (const [slot, list] of slotted) slots.set(slot, list.sort((a, b) => a.index - b.index).map(item => item.piece));
	}
	const cm = (v: number | undefined) => v === undefined ? '?' : (v * CM_PER_POSITION_UNIT).toFixed(1);
	// Position comments only help when the page really has several columns.
	const markers = options.boxMarkers && columns > 1 && items.length > 1;
	// Writing that falls on either side of an empty text box is one drawing.
	let pending: InkPiece[] = [];
	/** Where each block that wrote something starts, for its position comment (§11.5 item 58). */
	const written: { at: number, item: Positioned }[] = [];
	for (const [k, item] of items.entries()) {
		pending.push(...slots.get(k) ?? []);
		if (markers || !isBlank(item.element)) {
			await writer.writeLooseInk(pending);
			pending = [];
		}
		writer.beginItem();
		await writer.writeElements([item.element]);
		const at = writer.itemAt;
		if (at !== undefined) written.push({ at, item });
	}
	await writer.writeLooseInk([...pending, ...slots.get(items.length) ?? []]);
	// Only before blocks that wrote something, counted over those: an empty text box, or a later
	// printout page of a PDF embedded once (a picture of its own on the page), gets none.
	if (markers && written.length > 1) {
		writer.addMarkers(written.map(({ at, item }, n) => ({ at, text: options.strings.boxMarker(n + 1, written.length, cm(item.x), cm(item.y)) })));
	}
	return { markdown: writer.markdown, attachments: writer.attachments };
}
