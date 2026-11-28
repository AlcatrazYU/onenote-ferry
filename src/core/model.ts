// The semantic model every input format is mapped to, and every output is rendered from.
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/semantic/content.ts
// at commit fa9444a. See THIRD_PARTY_LICENSES.md.

/**
 * The bytes of an attachment. Parsed files keep their bytes in the section source and
 * hand them out one at a time on request; bytes made during conversion (ink drawings)
 * are carried inline.
 */
export type AssetData =
	| { kind: 'stored'; key: string; size: number }
	| { kind: 'inline'; bytes: Uint8Array };

export interface TextRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	superscript?: boolean;
	subscript?: boolean;
	hyperlinkUrl?: string;
	math?: boolean;
	/** Background colour as `#rrggbb`. */
	highlight?: string;
	/** Font colour as `#rrggbb`. */
	color?: string;
}

export interface Tag {
	label?: string;
	checkable: boolean;
	completed: boolean;
	/** OneNote's NoteTagShape number. */
	shape?: number;
}

export interface ListInfo {
	level: number;
	ordered: boolean;
	format?: string;
}

/** Where a block sits on the page, in half inches. */
export interface Placement {
	x?: number;
	y?: number;
	width?: number;
	/** A text box's height as stored: what its content took when the user last sized it (see Outline.sizedByUser). */
	height?: number;
}

/**
 * What a paragraph's height on the page is made of (OneNote does not store where its lines are):
 * its font size and the spaces around it, in points. Only used to estimate where a picture
 * further down in the same text box sits (§11.5 item 67).
 */
export interface ParagraphLayout {
	fontSize?: number;
	spaceBefore?: number;
	spaceAfter?: number;
	/** A fixed line spacing, when the paragraph has one. */
	lineSpacing?: number;
}

interface Placed {
	place?: Placement;
}

export interface Paragraph extends Placed {
	kind: 'paragraph';
	runs: TextRun[];
	children: Element[];
	list?: ListInfo;
	styleId?: string;
	tags?: Tag[];
	/** The notice in place of an attached file the download has no data for: that file's name. */
	missingFile?: string;
	/** Its font size and spacing, for estimating where things below it sit. */
	layout?: ParagraphLayout;
}

export interface Outline extends Placed {
	kind: 'outline';
	children: Element[];
	list?: ListInfo;
	/** The user sized the text box: its stored height is then what its content took. */
	sizedByUser?: boolean;
}

export interface TableCell {
	children: Element[];
}

export interface TableRow {
	cells: TableCell[];
}

export interface Table extends Placed {
	kind: 'table';
	rows: TableRow[];
	/** Each column's width (half inches), when the file gives them: where a picture in a cell sits (§11.5 item 86). */
	columnWidths?: number[];
}

export interface Image extends Placed {
	kind: 'image';
	fileName?: string;
	extension?: string;
	data?: AssetData;
	/** An ink drawing written inside a line of text, rendered to SVG. */
	inkSvg?: boolean;
	/**
	 * The alternative text set in OneNote (its title and description). Written only when asked
	 * (§11.5 items 32 and 78): in real notes much of it is clipped or generated text.
	 */
	alt?: string;
	/** The text OneNote recognized in the picture (for a printout, the text of its page; §11.5 item 78). */
	recognizedText?: string;
	/** A printout shows one page (1-based) of a whole document. */
	printoutPage?: number;
	/** The printed document's file name (`<name>.pdf` on the Mac, where each page image is named `<name>_<page>.pdf`). */
	printoutName?: string;
	/** The original PDF, on the same page or (when only one of that name is) elsewhere in the section. */
	printoutOf?: EmbeddedFile;
	/** The printed document's own file (a PDF, a Word document) is on the same page, linked there. */
	originalOnPage?: true;
	/** How large it is shown, in half inches (also for a picture inside a text box, which has no place). */
	size?: { width: number, height?: number };
}

export interface EmbeddedFile extends Placed {
	kind: 'embedded-file';
	fileName?: string;
	extension?: string;
	data?: AssetData;
}

export interface InkPoint {
	x: number;
	y: number;
}

/** Strokes more transparent than this are highlighter, not handwriting. */
export const MIN_PEN_OPACITY = 0.9;

export interface InkStroke {
	points: InkPoint[];
	color: string;
	width: number;
	opacity: number;
}

export interface Ink extends Placed {
	kind: 'ink';
	strokes: InkStroke[];
	recognizedText?: string;
}

export type Element = Paragraph | Outline | Table | Image | EmbeddedFile | Ink;

export interface Page {
	/** Stable source identity, used for links and for repeat imports. */
	id: string;
	title: string;
	level: number;
	createdUtc?: Date;
	lastModifiedUtc?: Date;
	isConflictPage: boolean;
	isDeleted: boolean;
	outlines: Outline[];
	directContent: Element[];
	/** Ink objects on the page made only of highlighter strokes; not rendered today. */
	highlighterInk?: Ink[];
}

export interface Section {
	name: string;
	pages: Page[];
}
