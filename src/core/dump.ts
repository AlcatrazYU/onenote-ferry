// The parser's JSON for one section, as parser/ferry/src/dump.rs writes it. A field the parser has
// no value for is null; fields are optional here because tests build smaller pieces by hand.

type Maybe<T> = T | null | undefined;

export interface DumpSection {
	name?: Maybe<string>;
	pages: DumpPage[];
	stats?: DumpStats;
	errors?: string[];
}

export interface DumpStats {
	assets?: number;
	assetBytes?: number;
	ink?: number;
	unknown?: number;
}

export interface DumpPage {
	id: string;
	title?: Maybe<string>;
	level?: Maybe<number>;
	/** Seconds since 1970 (UTC). */
	created?: Maybe<number>;
	updated?: Maybe<number>;
	contents: DumpPageContent[];
}

/** Where a box sits and how large it is (half inches). */
export interface DumpBox {
	x?: Maybe<number>;
	y?: Maybe<number>;
	w?: Maybe<number>;
	h?: Maybe<number>;
}

export interface DumpOutline extends DumpBox {
	type: 'outline';
	bySize?: Maybe<boolean>;
	items: DumpItem[];
}

export type DumpPageContent = DumpOutline | DumpImage | DumpFile | DumpInk | DumpUnknown;

export interface DumpElement {
	type: 'element';
	level?: Maybe<number>;
	list?: Maybe<{ format?: Maybe<string> }>;
	contents: DumpContent[];
	children: DumpItem[];
}

export interface DumpGroup {
	type: 'group';
	level?: Maybe<number>;
	items: DumpItem[];
}

export type DumpItem = DumpElement | DumpGroup;

export type DumpContent = DumpRich | DumpTable | DumpImage | DumpFile | DumpInk | DumpUnknown;

export interface DumpRun {
	text?: Maybe<string>;
	bold?: Maybe<boolean>;
	italic?: Maybe<boolean>;
	underline?: Maybe<boolean>;
	strike?: Maybe<boolean>;
	sup?: Maybe<boolean>;
	sub?: Maybe<boolean>;
	/** `#rrggbb`. */
	highlight?: Maybe<string>;
	color?: Maybe<string>;
	link?: Maybe<boolean>;
	href?: Maybe<string>;
	latex?: Maybe<string>;
	/** Font size in half points. */
	size?: Maybe<number>;
}

export interface DumpTag {
	shape?: Maybe<string>;
	checkable?: Maybe<boolean>;
	completed?: Maybe<boolean>;
	label?: Maybe<string>;
}

export interface DumpRich {
	type: 'rich';
	runs?: Maybe<DumpRun[]>;
	styleId?: Maybe<string>;
	tags?: Maybe<DumpTag[]>;
	inks?: Maybe<DumpInk[]>;
	para?: Maybe<{ size?: Maybe<number>, before?: Maybe<number>, after?: Maybe<number>, lineExact?: Maybe<number> }>;
}

export interface DumpTable {
	type: 'table';
	/** Rows of cells, each cell a list of outline elements. */
	rows: DumpItem[][][];
	/** Column widths (half inches). */
	w?: Maybe<number[]>;
}

/** A picture or file's bytes, by the name the parser keeps them under. */
export interface DumpAsset {
	asset?: Maybe<string>;
	size?: Maybe<number>;
}

export interface DumpImage extends DumpBox {
	type: 'image';
	asset?: Maybe<DumpAsset>;
	fileName?: Maybe<string>;
	alt?: Maybe<string>;
	background?: Maybe<boolean>;
	href?: Maybe<string>;
	ocr?: Maybe<string>;
	/** The page of a printout's document it shows. */
	page?: Maybe<number>;
}

export interface DumpFile extends DumpBox {
	type: 'file';
	asset?: Maybe<DumpAsset>;
	fileName?: Maybe<string>;
}

export interface DumpStroke {
	/** The first point, then each next one as a step from the one before. */
	points: [number, number][];
	width?: Maybe<number>;
	height?: Maybe<number>;
	/** 0x00bbggrr. */
	color?: Maybe<number>;
	transparency?: Maybe<number>;
	tip?: unknown;
}

export interface DumpInk {
	type: 'ink';
	strokes: DumpStroke[];
	bbox?: Maybe<number[]>;
	x?: Maybe<number>;
	y?: Maybe<number>;
}

export interface DumpUnknown {
	type: 'unknown';
}
