// Updates notebooks an earlier import wrote, from a new download, in place (§11.5 item 49; the
// plan is Internal-9). Each notebook is read again and planned (sync.ts) just before it is updated,
// and each section chosen is a small transaction:
//
// 1. It is converted outside the vault first (staging), each page keeping the file name it has.
// 2. The steps that bring the vault's section to the new version are worked out against the vault
//    as it is, checked, and written to the update's journal before any of them is done.
// 3. The steps run, each marked done in the journal: copies of what will be replaced go to the
//    previous versions; the section's contents page says `syncing`; the folder moves when OneNote
//    renamed the section or moved it to another group (never because the user moved it); the
//    attachments only replaced pages used go to the previous versions; retitled pages are renamed;
//    new and changed attachments and pages are written; pages that only moved get their place
//    properties brought up to date; the section's contents page (listing the pages OneNote deleted,
//    which stay where they are) and the notebook's are written last.
//
// Before a step writes over a file it checks that the file is as the step expects (a write cut off
// part way, or the user's edit since, leaves it otherwise): if not, a copy of it goes aside first.
// Every step can be done again or undone from a source other than the file it writes (the staging,
// text in the journal, a copy), so a write cut off part way is never built on.
//
// A step that fails puts the section back as it was, step by step: what was replaced is copied
// back, what was moved is moved back, what was new is moved aside. Nothing is ever deleted, nothing
// outside the output root is written, and only folders of ours are written into. An update cut off
// (Obsidian quit, a crash) is finished the next time (resumeUpdates): the journal says where it
// stopped; the section it was in is finished from its staging or, when that is gone, put back.
// Links are fixed once the sections are done (§11.5 item 52.1); then the report and the record.

import type { DownloadNotebook, DownloadSection } from './download.ts';
import { convertSection, inTocOrder, isOurNotebook, ALL_ATTACHMENT_FOLDERS, ALL_TOC_NAMES } from './importer.ts';
import type { ImportProgress, ImportResult, NotebookResult, ParsedSection, SectionNames, SectionOptions, SectionResult } from './importer.ts';
import type { UpdateSink } from './io.ts';
import { buildLinkIndex, relativePath, rewriteLinks } from './links.ts';
import type { LinkStats, SectionRef } from './links.ts';
import { composedText, joinPath, numberedName, safeName } from './names.ts';
import { link, readReport, reportedNotebooks, reportTime, text, writeReport } from './report.ts';
import type { ReportNotebook } from './report.ts';
import { isLanguage, LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings, UpdateCounts } from './strings.ts';
import { deletedByUser, editedInOneNote, frontMatter, planNotebook, readArchive } from './sync.ts';
import type { Archive, ArchivedPage, ArchivedSection, PlanItem, PlanOptions, PlanStatus, ScannedSection } from './sync.ts';
import { notebookFolder, notebookToc, sectionKey, tocHead } from './write.ts';
import type { NotebookTocEntry } from './write.ts';

/** A place outside the vault to convert one section into first. */
export interface Staging {
	/** Finds it again after a restart (see UpdateHost.openStaging). */
	id: string;
	sink: UpdateSink;
}

export interface UpdateHost {
	/** The output root: the folder the notebooks were imported into. */
	vault: UpdateSink;
	/** A new, empty place outside the vault. */
	newStaging(): Promise<Staging>;
	/** A place newStaging gave, when it is still there. */
	openStaging(id: string): Promise<UpdateSink | undefined>;
	/** Frees a place once its section is in the vault, or put back. */
	releaseStaging(id: string): Promise<void>;
	parse(section: DownloadSection): Promise<ParsedSection>;
	isPasswordProtected(section: DownloadSection): Promise<boolean>;
	/** Converts a section into `dir` of `staging` somewhere else (the plugin's worker); else parse() here. */
	convertSection?(section: DownloadSection, dir: string, language: Language, options: SectionOptions, names: SectionNames, staging: UpdateSink): Promise<SectionResult>;
	/** Folders directly under the output root. */
	listFolders(): Promise<string[]>;
	isCancelled?(): boolean;
	onProgress?(progress: ImportProgress): void;
	onSectionDone?(notebook: string, section: DownloadSection, outcome: SectionOutcome): void;
}

/** not converted: the section could not be read now; not updated: a folder it needs is taken. */
export type SectionOutcome = 'done' | 'rolled back' | 'not converted' | 'not updated';

/** One notebook of the new download to update. */
export interface UpdateRequest {
	notebook: DownloadNotebook;
	/** Page ids, titles and times of each of its sections (scannedPages), as for planNotebook. */
	scanned: ScannedSection[];
	/** sectionKeys of the sections to update; only those changed, new, unfinished or left unticked before are. */
	chosen: ReadonlySet<string>;
	/** The download holds only some of its sections. */
	partial?: boolean;
	/** Ids (upper case) of pages the user deleted in Obsidian that are to be written back; none is otherwise (§11.5 item 51). */
	restore?: ReadonlySet<string>;
	/**
	 * sectionKeys of sections without changes to convert again, whole, with `defaults` (§11.5 item 65):
	 * every page is written anew but those edited in Obsidian, which stay as they are.
	 */
	reconvert?: ReadonlySet<string>;
}

export interface UpdateOptions {
	at: Date;
	/** The reader's: the record, the report, and the update's own folders when there are none yet. */
	strings: Strings;
	/** Language of a notebook not imported before. */
	languageFor(notebook: DownloadNotebook): Language;
	/**
	 * The settings chosen now: for sections written now for the first time (new, left unticked before,
	 * imported again) and those converted again; and for a notebook's sections when its report entry
	 * does not say. A section updated because OneNote changed it keeps its own.
	 */
	defaults: SectionOptions;
	links: boolean;
	/** The downloads (file or folder names, not full paths). */
	sources: string[];
	/** The run imported new notebooks first: the time its report gave that import (the report's last import then covers both). */
	joins?: string;
}

export interface UpdateResult {
	/** Paths from the output root. */
	record: string;
	journal: string;
	backup: string;
	report: string;
	/** What happened to each section chosen, by notebook folder and sectionKey. */
	outcomes: { notebook: string, key: string, outcome: SectionOutcome | 'not reached' }[];
	links?: LinkStats;
	cancelled: boolean;
	/** What changed, as the record counts it. */
	counts: UpdateCounts;
	/** What needs the reader's attention, counted (the record says which). */
	attention: UpdateAttention;
}

/** Counts of what the record lists under "attention". */
export interface UpdateAttention {
	/** Pages changed in OneNote and in Obsidian: the new version went in, the user's was kept aside. */
	bothEdited: number;
	/** Converted again: pages edited in Obsidian, left as they were (not written with the new settings). */
	keptEdited: number;
	/** Files that were not as the update expected, copied aside before they were written over. */
	keptAside: number;
	rolledBack: number;
	notConverted: number;
	notUpdated: number;
	/** Chosen, and not reached (stopped before them). */
	notReached: number;
}

// The journal: one JSON object a line, in the update's log folder next to its record.

interface StartEntry {
	t: 'start';
	at: string;
	reader: Language;
	sources: string[];
	links: boolean;
	/** How sections are converted when a notebook's report entry does not say. */
	defaults: SectionOptions;
	/** Where copies of what the update replaces go (a path from the output root). */
	backup: string;
	record: string;
	journal: string;
	/** See UpdateOptions.joins. */
	joins?: string;
}

/** A section in a notebook's contents page and report: as it is, or as an update leaves it. */
interface Listed extends NotebookTocEntry {
	key: string;
	/** Not in the download: a section of ours OneNote no longer has (or a partial download left out). */
	extra?: true;
	/** Its entry in the report, when it has one. */
	result?: SectionResult;
	/** Why it could not be read now (one with no folder of ours). */
	error?: string;
}

interface NotebookEntry {
	t: 'notebook';
	n: number;
	notebook: string;
	dir: string;
	language: Language;
	options: SectionOptions;
	/** update: its sections may be written; different, occupied: nothing of it is (see the record). */
	state: 'update' | 'different' | 'occupied';
	listed: Listed[];
	/** Sections worth a line in the record that are not updated: gone, unreadable, occupied. */
	notes: { key: string, status: PlanStatus, label: string, groups: string[], error?: string }[];
	/** The sections chosen, by sectionKey. */
	chosen: string[];
}

/**
 * A file as a step expects to find it, or leaves it: its size and modification time (null when it
 * is not known ahead), or null for no file. A write cut off part way leaves a file of neither.
 */
type State = [number, number | null] | null;
/** What a step that writes over a file expects to find there before it, and leaves after it. */
interface Expect { before: State, after: State }
type Undo = { kind: 'text', text: string } | { kind: 'saved', path: string } | { kind: 'new' };
type Op =
	/** Copies a file aside before it is replaced. `size` is the file's, so a copy cut off part way is told from a whole one. */
	| { op: 'copy', from: string, to: string, size?: number }
	/** Moves a file or folder: renaming, or putting aside an attachment no page uses any more. */
	| { op: 'move', from: string, to: string }
	/** Writes a file: `text`, or a staged file (`staged`, with attachment names changed by `subst`). */
	| { op: 'write', path: string, text?: string, staged?: string, binary?: true, subst?: { folder: string, names: [string, string][] }, mtime?: number, undo: Undo } & Partial<Expect>
	/**
	 * Sets page properties (`null`: none) in `base`, the page's text before the update, keeping its
	 * time: done again or undone, it starts from `base`, never from what a cut-off write left.
	 */
	| { op: 'props', path: string, base: string, mtime: number | null, set: Record<string, string | null> } & Partial<Expect>;

interface PageChange { title: string, path: string, before?: string, was?: string, edited?: true }

interface Summary {
	notebook: string;
	label: string;
	groups: string[];
	/** It was not there before. */
	isNew?: true;
	/** Imported before, not found in the vault any more, imported again by choice (§11.5 item 52.3). */
	missing?: true;
	/** Its earlier name or place, when OneNote renamed or moved it. */
	was?: string;
	added: PageChange[];
	modified: PageChange[];
	/** Pages OneNote deleted since the section was last updated: they stay where they are. */
	removed: PageChange[];
	/** Pages the user had deleted, written back because they chose to. */
	restored: PageChange[];
	/** Titles of pages the user deleted, not written back. */
	notRestored: string[];
	reordered: number;
	/** Converted again with the settings chosen now (§11.5 item 65): how many pages were written anew. */
	reconverted?: true;
	rewritten?: number;
	/** Converted again: pages left as they were because they were edited in Obsidian. */
	kept?: PageChange[];
}

interface Move { from: string, to: string, folder?: true }

interface SectionEntry {
	t: 'section';
	s: number;
	n: number;
	key: string;
	staging: string;
	ops: Op[];
	/** Staged files the writes need, with their sizes: is the staging still whole? */
	needs: [string, number][];
	summary: Summary;
	/** The new version's report, and the section as the notebook lists it once done. */
	result: SectionResult;
	listed: Listed;
	/** Old paths and where they went, for links. */
	moves: Move[];
	/** Pages written from the new version. */
	fresh: string[];
}

type Entry =
	| StartEntry
	| NotebookEntry
	| SectionEntry
	| { t: 'op', s: number, i: number }
	| { t: 'undo', s: number, i: number }
	/** Putting a section back began, and why. */
	| { t: 'rollback', s: number, reason: string }
	/** A file was not as a step expected (changed since: by the user, say) and was copied here before the step went on. */
	| { t: 'kept', path: string, to: string }
	/** The link pass is about to change a page, found as `before`, to leave it as `after`; and it did. */
	| { t: 'link-begin', path: string, before: State, after: State, base?: string }
	| { t: 'link-done', path: string }
	| { t: 'section-end', s: number, outcome: 'done' | 'rolled back', error?: string }
	/** A section not converted (the parser failed), or not updated (`blocked`: a folder it needs is taken). */
	| { t: 'failed', n: number, key: string, label: string, groups: string[], error: string, locked?: true, blocked?: string }
	| { t: 'stop' }
	| { t: 'links', stats: LinkStats }
	| { t: 'end' };

/** What an update has done, from its journal. */
interface RunState {
	start: StartEntry;
	notebooks: NotebookEntry[];
	/** Each section begun: its steps done so far, the first one undone when it is being put back, and how it ended. */
	sections: { entry: SectionEntry, done: number, undone?: number, reason?: string, outcome?: 'done' | 'rolled back', error?: string }[];
	failed: Extract<Entry, { t: 'failed' }>[];
	stopped: boolean;
	links?: LinkStats;
	/** The link pass so far: pages begun (with what was expected) and pages done. */
	linking: Map<string, { before: State, after: State, base?: string, done?: true }>;
	/** Files copied aside because they were not as expected. */
	kept: string[];
	resumed?: true;
}

const fold = (path: string) => path.normalize('NFC').toLowerCase();
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const pad = (n: number) => String(n).padStart(2, '0');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isText = (path: string) => /\.md$/i.test(path);
const errorText = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 500);
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** File times may be off by this much (FAT keeps two seconds). */
const TIME_TOLERANCE = 2000;
const sameState = (a: State, b: State) => (a === null || b === null ? a === b : a[0] === b[0] && (a[1] === null || b[1] === null || Math.abs(a[1] - b[1]) <= TIME_TOLERANCE));
async function stateOf(vault: UpdateSink, path: string): Promise<State> {
	const info = await vault.stat(path);
	return info ? [info.size, info.mtime] : null;
}

/** Local time to the minute, fit for a file name: `2026-12-01 1430`. */
export function updateStamp(at: Date): string {
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** The properties an update brings up to date on a page OneNote did not change (§11.5 item 50). */
const PLACE_PROPERTIES = ['onenote-section', 'onenote-order', 'onenote-level'];

/** The raw values (as written, after `key: `) of some front matter keys. */
function rawProperties(text: string, keys: readonly string[]): Record<string, string | null> {
	const head = text.replace(/\r\n/g, '\n');
	const end = head.startsWith('---\n') ? head.indexOf('\n---', 3) : -1;
	const block = end < 0 ? '' : head.slice(4, end);
	const out: Record<string, string | null> = {};
	for (const key of keys) out[key] = block.match(new RegExp(`^${escapeRegExp(key)}: ?([^\\n]*)$`, 'm'))?.[1] ?? null;
	return out;
}

/** The text with these front matter properties set (`null`: removed), the rest as it was. */
function setProperties(text: string, set: Record<string, string | null>): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(eol);
	if (lines[0] !== '---') return text;
	let end = lines.indexOf('---', 1);
	if (end < 0) return text;
	for (const [key, value] of Object.entries(set)) {
		const at = lines.slice(1, end).findIndex(line => line.startsWith(`${key}:`)) + 1;
		if (at > 0 && value === null) {
			lines.splice(at, 1);
			end--;
		}
		else if (at > 0) lines[at] = `${key}: ${value}`;
		else if (value !== null) lines.splice(end++, 0, `${key}: ${value}`);
	}
	return lines.join(eol);
}

/** Names of the attachments a page links to in the section's attachments folder. */
function attachmentLinks(text: string, folder: string): string[] {
	return [...text.matchAll(new RegExp(`\\]\\(<${escapeRegExp(folder)}/([^>]+)>\\)`, 'g'))].map(match => match[1]!);
}

/** The text with links to some attachments changed to others of the section's attachments folder. */
function renameAttachmentLinks(text: string, folder: string, renames: [string, string][]): string {
	const to = new Map(renames);
	return text.replace(new RegExp(`\\]\\(<${escapeRegExp(folder)}/([^>]+)>\\)`, 'g'), (whole, name: string) => (to.has(name) ? `](<${folder}/${to.get(name)}>)` : whole));
}

/** `name` or, when it is taken, `name (2)`, `name (3)`... before its extension. */
function numbered(name: string, taken: (candidate: string) => boolean): string {
	let candidate = name;
	for (let n = 2; taken(candidate); n++) candidate = name.replace(/(\.[^./]+)?$/, extension => ` (${n})${extension}`);
	return candidate;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** A path `relative` to `folder`, `..` resolved; undefined when it climbs out of the output folder. */
function resolvePath(folder: string, relative: string): string | undefined {
	const parts = folder ? folder.split('/') : [];
	for (const part of relative.split('/')) {
		if (part === '..') {
			if (!parts.length) return undefined;
			parts.pop();
		}
		else if (part !== '.' && part !== '') parts.push(part);
	}
	return parts.join('/');
}

class Journal {
	private readonly sink: UpdateSink;
	readonly path: string;

	constructor(sink: UpdateSink, path: string) {
		this.sink = sink;
		this.path = path;
	}

	private checked = false;

	async add(entry: Entry): Promise<void> {
		let line = `${JSON.stringify(entry)}\n`;
		// A line cut off part way (a crash while it was written) must not swallow this one.
		if (!this.checked) {
			const text = await this.sink.readText(this.path);
			if (text && !text.endsWith('\n')) line = `\n${line}`;
			this.checked = true;
		}
		await this.sink.appendText(this.path, line);
	}
}

/**
 * A folder name for the update's own files, in the language one already there has (in any
 * language), else in the reader's (§11.5 item 49).
 */
async function ownFolder(vault: UpdateSink, reader: Strings, which: 'oldVersionsFolder' | 'updateLogFolder'): Promise<string> {
	for (const strings of [reader, ...LANGUAGES.map(language => STRINGS[language])]) {
		if (await vault.exists(strings[which])) return strings[which];
	}
	return reader[which];
}

/**
 * Checks a section's steps against the vault's files as they are (`files`: by folded path, with
 * their states): each move, copy and new file finds its place free. Notes on each step what it
 * expects to find before it (`before`; its `after` is set when it is made) and, on each copy, the
 * size of what it copies.
 */
function check(ops: Op[], files: Map<string, State>): void {
	const present = new Map(files);
	const has = (path: string) => present.has(fold(path)) || [...present.keys()].some(file => file.startsWith(`${fold(path)}/`));
	const fail = (op: Op, why: string) => {
		throw new Error(`${op.op} ${'path' in op ? op.path : op.to}: ${why}`);
	};
	for (const op of ops) {
		switch (op.op) {
			case 'copy':
				if (!present.has(fold(op.from))) fail(op, 'nothing to copy');
				if (has(op.to)) fail(op, 'taken');
				op.size = present.get(fold(op.from))?.[0];
				present.set(fold(op.to), present.get(fold(op.from)) ?? null);
				break;
			case 'move': {
				if (!has(op.from)) fail(op, 'nothing to move');
				if (has(op.to) && fold(op.from) !== fold(op.to)) fail(op, 'taken');
				if (fold(op.to).startsWith(`${fold(op.from)}/`)) fail(op, 'into itself');
				const from = fold(op.from), to = fold(op.to);
				for (const [file, state] of [...present]) {
					if (file !== from && !file.startsWith(`${from}/`)) continue;
					present.delete(file);
					present.set(to + file.slice(from.length), state);
				}
				break;
			}
			case 'write':
			case 'props':
				if (op.op === 'write' && op.undo.kind === 'new' && has(op.path)) fail(op, 'taken');
				if ((op.op === 'props' || op.undo.kind !== 'new') && !present.has(fold(op.path))) fail(op, 'not there');
				op.before = present.get(fold(op.path)) ?? null;
				present.set(fold(op.path), op.after ?? null);
				break;
		}
	}
}

interface NotebookState {
	entry: NotebookEntry;
	strings: Strings;
	/** The notebook's contents page and what it says now (undefined: there is none yet). */
	tocPath: string;
	toc?: string;
	/** A copy of the notebook's contents page as it was before this update is (being) kept with the previous versions. */
	tocSaved?: true;
}

/**
 * Works out the steps for one section, staged at `staged`. `item` is its plan, `archived` the
 * folder of ours it was matched to (none for a new section).
 */
async function prepareSection(vault: UpdateSink, start: StartEntry, nb: NotebookState, s: number, item: PlanItem, archived: ArchivedSection | undefined, staged: Staging, result: SectionResult, restore: ReadonlySet<string> = new Set(), reconvert = false): Promise<SectionEntry> {
	const strings = nb.strings;
	const notebook = nb.entry;
	const tocName = `${strings.tocFileName}.md`;
	const att = strings.attachmentsFolder;
	const V = archived ? joinPath(notebook.dir, archived.folder) : undefined;
	const N = joinPath(notebook.dir, item.new!);
	const B = joinPath(start.backup, notebook.dir, archived?.folder ?? item.new!);
	const moving = V !== undefined && fold(V) !== fold(N);
	const inFolder = (path: string, folder: string) => fold(parentOf(path)) === fold(folder);

	// The vault's section folder (only its own files: what is in sub-folders goes along with it).
	const vaultAll = V ? await vault.listFiles(V) : await vault.listFiles(N);
	if (!V && vaultAll.length) throw new Blocked(N);
	if (moving && !fold(N).startsWith(`${fold(V!)}/`) && await vault.exists(N)) throw new Blocked(N);
	// Each file as it is now, to tell later whether it is still as the steps found it.
	const states = new Map<string, State>();
	for (const path of [...vaultAll, ...(nb.toc === undefined ? [] : [nb.tocPath])]) states.set(fold(path), await stateOf(vault, path));
	/** Edited in Obsidian since it was written: its file's time now is not the page's (as editedInVault, from this moment). */
	const editedNow = (page: ArchivedPage) => {
		const state = states.get(fold(joinPath(V!, page.file)));
		const written = page.modified ? Date.parse(page.modified) : NaN;
		return !!state && state[1] !== null && !isNaN(written) && Math.abs(state[1] - written) > TIME_TOLERANCE;
	};
	const vaultFiles = V ? vaultAll.filter(path => inFolder(path, V)).map(baseName) : [];
	const vaultAttachments = V ? vaultAll.filter(path => inFolder(path, joinPath(V, att))).map(baseName) : [];
	const attachmentByFold = new Map(vaultAttachments.map(name => [fold(name), name]));

	// The new version, page by page, in its order.
	const stagedAll = await staged.sink.listFiles(N);
	const stagedAttachments = new Set(stagedAll.filter(path => inFolder(path, joinPath(N, att))).map(baseName));
	const pages: { id: string, file: string, text: string, title: string, modified: string | null, fingerprint?: string }[] = [];
	for (const page of result.report!.pages) {
		const pageText = await staged.sink.readText(joinPath(N, page.file));
		if (pageText === undefined) throw new Error(`staged ${page.file} is missing`);
		const properties = frontMatter(pageText);
		pages.push({
			id: (properties['onenote-id'] ?? '').toUpperCase(), file: page.file, text: pageText, title: composedText(properties.title ?? ''), modified: properties.modified ?? null,
			...(page.fingerprint !== undefined ? { fingerprint: page.fingerprint } : {}),
		});
	}
	const newIds = new Set(pages.map(page => page.id));

	interface Write { file: string, text: string, title: string, existing?: ArchivedPage, edited?: true, restored?: true, rewritten?: true }
	/** Converted again (reconvert): pages left as they are because they were edited in Obsidian. */
	const keptEdited: ArchivedPage[] = [];
	const writes: Write[] = [];
	const renames: { from: string, to: string }[] = [];
	const props: { file: string, base: string, mtime: number | null, set: Record<string, string | null>, moved: boolean }[] = [];
	const notRestored: string[] = [];
	const replaced = new Set<string>();
	const spelling = new Map<string, string>();
	for (const page of pages) {
		const before = archived?.pages.get(page.id);
		if (!before) {
			// A page the user deleted in Obsidian is written back only when they chose so (§11.5 item 51).
			if (archived && deletedByUser(archived, page, strings)) {
				if (restore.has(page.id)) writes.push({ file: page.file, text: page.text, title: page.title, restored: true });
				else notRestored.push(page.title);
				continue;
			}
			writes.push({ file: page.file, text: page.text, title: page.title });
			continue;
		}
		if (fold(before.file) !== fold(page.file)) renames.push({ from: before.file, to: page.file });
		// Only the case differs (a title changed in case): the file keeps the vault's spelling.
		else if (before.file !== page.file) spelling.set(page.file, before.file);
		if (composedText(before.title) !== page.title || editedInOneNote(before, page)) {
			writes.push({ file: page.file, text: page.text, title: page.title, existing: before, ...(editedNow(before) ? { edited: true as const } : {}) });
			replaced.add(fold(before.file));
			continue;
		}
		// Converted again with other settings: every page is written anew, but one the user edited in
		// Obsidian stays as it is (OneNote did not change it: nothing would justify putting their work aside).
		if (reconvert) {
			if (editedNow(before)) keptEdited.push(before);
			else {
				writes.push({ file: page.file, text: page.text, title: page.title, existing: before, rewritten: true });
				replaced.add(fold(before.file));
				continue;
			}
		}
		// OneNote did not change it: only where it sits, when that changed (compared as values: Obsidian
		// may have written the properties again in its own way).
		const path = joinPath(V!, before.file);
		const now = await vault.readText(path) ?? '';
		const was = frontMatter(now), set = rawProperties(page.text, PLACE_PROPERTIES), wanted = frontMatter(page.text);
		const changed = PLACE_PROPERTIES.filter(key => (was[key] ?? null) !== (wanted[key] ?? null));
		if (changed.length) {
			props.push({
				file: page.file, base: now, mtime: states.get(fold(path))?.[1] ?? null, set: Object.fromEntries(changed.map(key => [key, set[key]!])),
				moved: changed.some(key => key !== 'onenote-section'),
			});
		}
	}
	// Pages OneNote deleted stay where they are, listed apart in the contents page (§11.5 item 51).
	const stay = [...archived?.pages.values() ?? []].filter(page => !newIds.has(page.id))
		.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file));

	// Attachments: what the pages that stay link to stays as it is; each new or changed page's goes
	// in by its bytes. One whose name a page that stays uses for other bytes gets another name.
	const kept = new Set<string>();
	const old = new Set<string>();
	for (const file of vaultFiles) {
		if (!isText(file) || fold(file) === fold(tocName)) continue;
		const fileText = await vault.readText(joinPath(V!, file)) ?? '';
		if (replaced.has(fold(file))) {
			for (const name of attachmentLinks(fileText, att)) old.add(fold(name));
			continue;
		}
		// What stays uses an attachment however it names it: our links, a wikilink the user wrote, a URL.
		for (const name of vaultAttachments) {
			if (fileText.includes(name) || fileText.includes(encodeURI(name)) || fileText.includes(encodeURIComponent(name))) kept.add(fold(name));
		}
	}
	const subst = new Map<string, string>();
	const attachmentWrites: { name: string, staged: string, saved?: string }[] = [];
	const chosen = new Set<string>();
	const seen = new Set<string>();
	const taken = (name: string) => attachmentByFold.has(fold(name)) || [...stagedAttachments].some(other => fold(other) === fold(name)) || chosen.has(fold(name));
	for (const write of writes) {
		for (const name of attachmentLinks(write.text, att)) {
			if (seen.has(name)) continue;
			seen.add(name);
			const bytes = await staged.sink.readBinary(joinPath(N, att, name));
			if (!bytes) continue;
			const there = attachmentByFold.get(fold(name));
			if (there === undefined) {
				attachmentWrites.push({ name, staged: name });
				chosen.add(fold(name));
				continue;
			}
			const present = await vault.readBinary(joinPath(V!, att, there));
			if (present && sameBytes(present, bytes)) {
				if (there !== name) subst.set(name, there);
				continue;
			}
			// Another name when a page that stays uses that file, or when no replaced page did (a file the user put there).
			if (kept.has(fold(name)) || !old.has(fold(name))) {
				const other = numbered(name, taken);
				chosen.add(fold(other));
				subst.set(name, other);
				attachmentWrites.push({ name: other, staged: name });
				continue;
			}
			if (there !== name) subst.set(name, there);
			attachmentWrites.push({ name: there, staged: name, saved: joinPath(B, att, there) });
		}
	}
	const linked = new Set(writes.flatMap(write => attachmentLinks(write.text, att).map(name => fold(subst.get(name) ?? name))));
	const orphans = [...old].map(name => attachmentByFold.get(name)).filter((name): name is string => name !== undefined && !kept.has(fold(name)) && !linked.has(fold(name)));

	// The steps, in order.
	const ops: Op[] = [];
	const oldToc = V ? await vault.readText(joinPath(V, tocName)) : undefined;
	// The section's contents page as it is, saying `syncing` (its pages stay listed meanwhile).
	const syncingToc = oldToc !== undefined
		? oldToc.replace(/^onenote-import: \w+$/m, 'onenote-import: syncing')
		: tocHead(composedText(result.report!.section), strings, 'syncing').join('\n');
	if (V) {
		if (oldToc !== undefined) ops.push({ op: 'copy', from: joinPath(V, tocName), to: joinPath(B, tocName) });
		for (const write of writes) if (write.existing) ops.push({ op: 'copy', from: joinPath(V, write.existing.file), to: joinPath(B, write.existing.file) });
		for (const entry of attachmentWrites) if (entry.saved) ops.push({ op: 'copy', from: joinPath(V, att, entry.name), to: entry.saved });
	}
	// A notebook new to the vault gets its contents page first, as an import writes it: the folder is ours.
	const textWrite = (path: string, text: string, undo: Undo): Op => ({ op: 'write', path, text, undo, after: [byteLength(text), null] });
	// The notebook's contents page as it was before this update, once, before its first change.
	if (nb.toc !== undefined && !nb.tocSaved) ops.unshift({ op: 'copy', from: nb.tocPath, to: joinPath(start.backup, notebook.dir, tocName) });
	if (nb.toc === undefined) ops.push(textWrite(nb.tocPath, notebookToc(notebook.notebook, notebook.listed, strings, 'importing'), { kind: 'new' }));
	ops.push(textWrite(joinPath(V ?? N, tocName), syncingToc, oldToc !== undefined ? { kind: 'text', text: oldToc } : { kind: 'new' }));
	if (moving && fold(N).startsWith(`${fold(V!)}/`)) {
		// Into a group of its own name (Spring to Spring/Spring): through a free name beside it.
		let between = `${V} (onenote-ferry)`;
		for (let n = 2; await vault.exists(between); n++) between = `${V} (onenote-ferry ${n})`;
		ops.push({ op: 'move', from: V!, to: between }, { op: 'move', from: between, to: N });
	}
	else if (moving) ops.push({ op: 'move', from: V!, to: N });
	for (const name of orphans) ops.push({ op: 'move', from: joinPath(N, att, name), to: joinPath(B, att, name) });

	// Renames, through a free name when two pages swap theirs.
	const present = new Set(vaultFiles.map(fold));
	const pending = renames.map(rename => ({ ...rename }));
	while (pending.length) {
		const next = pending.findIndex(rename => !present.has(fold(rename.to)));
		if (next >= 0) {
			const [rename] = pending.splice(next, 1) as [{ from: string, to: string }];
			ops.push({ op: 'move', from: joinPath(N, rename.from), to: joinPath(N, rename.to) });
			present.delete(fold(rename.from));
			present.add(fold(rename.to));
			continue;
		}
		const rename = pending[0]!;
		if (!pending.some(other => fold(other.from) === fold(rename.to))) throw new Blocked(joinPath(N, rename.to));
		const between = numbered(rename.from.replace(/\.md$/, ' (onenote-ferry).md'), name => present.has(fold(name)));
		ops.push({ op: 'move', from: joinPath(N, rename.from), to: joinPath(N, between) });
		present.delete(fold(rename.from));
		present.add(fold(between));
		rename.from = between;
	}

	const needs: [string, number][] = [];
	const need = async (path: string) => {
		const info = await staged.sink.stat(path);
		if (!info) throw new Error(`staged ${path} is missing`);
		needs.push([path, info.size]);
	};
	for (const entry of attachmentWrites) {
		await need(joinPath(N, att, entry.staged));
		ops.push({
			op: 'write', path: joinPath(N, att, entry.name), staged: joinPath(N, att, entry.staged), binary: true,
			undo: entry.saved ? { kind: 'saved', path: entry.saved } : { kind: 'new' }, after: [needs[needs.length - 1]![1], null],
		});
	}
	const renameList = [...subst];
	for (const write of writes) {
		await need(joinPath(N, write.file));
		const modified = Date.parse(frontMatter(write.text).modified ?? '');
		const written = renameList.length ? renameAttachmentLinks(write.text, att, renameList) : write.text;
		ops.push({
			op: 'write', path: joinPath(N, spelling.get(write.file) ?? write.file), staged: joinPath(N, write.file), ...(renameList.length ? { subst: { folder: att, names: renameList } } : {}),
			...(isNaN(modified) ? {} : { mtime: modified }),
			undo: write.existing ? { kind: 'saved', path: joinPath(B, write.existing.file) } : { kind: 'new' },
			after: [byteLength(written), isNaN(modified) ? null : modified],
		});
	}
	for (const entry of props) {
		const text = setProperties(entry.base, entry.set);
		ops.push({ op: 'props', path: joinPath(N, entry.file), base: entry.base, mtime: entry.mtime, set: entry.set, after: [byteLength(text), entry.mtime] });
	}
	// The section's contents page: the new version's, then the pages no longer in OneNote that stay.
	const stagedToc = await staged.sink.readText(joinPath(N, tocName));
	if (stagedToc === undefined) throw new Error(`staged ${tocName} is missing`);
	const stayList = stay.map(page => `- [${(page.title || strings.untitledPage).replace(/[[\]]/g, '\\$&')}](<${page.file}>)`);
	let tocText = stagedToc;
	for (const [file, there] of spelling) tocText = tocText.split(`(<${file}>)`).join(`(<${there}>)`);
	const sectionToc = stay.length ? `${tocText.replace(/\n+$/, '')}\n\n## ${strings.noLongerInOneNote}\n\n${stayList.join('\n')}\n` : tocText;
	for (const page of result.report!.pages) page.file = spelling.get(page.file) ?? page.file;
	ops.push(textWrite(joinPath(N, tocName), sectionToc, { kind: 'text', text: syncingToc }));

	// The notebook's contents page, with this section as it will be.
	const listed: Listed = { key: sectionKey(item.groups, item.label), groups: item.groups, section: item.label, folder: item.new!, result };
	const after = notebook.listed.map(entry => (entry.key === listed.key && !entry.extra ? listed : entry));
	const nbToc = notebookToc(notebook.notebook, after, strings, 'complete');
	const tocBefore = nb.toc ?? notebookToc(notebook.notebook, notebook.listed, strings, 'importing');
	ops.push(textWrite(nb.tocPath, nbToc, { kind: 'text', text: tocBefore }));

	check(ops, states);

	const moves: Move[] = [];
	if (moving) moves.push({ from: V!, to: N, folder: true });
	for (const name of orphans) moves.push({ from: joinPath(V!, att, name), to: joinPath(B, att, name) });
	for (const rename of renames) moves.push({ from: joinPath(V!, rename.from), to: joinPath(N, rename.to) });

	const label = composedText(result.report!.section);
	const summary: Summary = {
		notebook: notebook.notebook, label, groups: item.groups,
		...(archived ? {} : { isNew: true as const }),
		...(item.status === 'missing' ? { missing: true as const } : {}),
		...(moving ? { was: wasCalled(item, archived!, label) } : {}),
		added: writes.filter(write => !write.existing && !write.restored).map(write => ({ title: write.title, path: joinPath(N, write.file) })),
		...(reconvert ? { reconverted: true as const, rewritten: writes.filter(write => write.rewritten).length, kept: keptEdited.map(page => ({ title: page.title, path: joinPath(N, page.file) })) } : {}),
		modified: writes.filter(write => write.existing && !write.rewritten).map(write => ({
			title: write.title, path: joinPath(N, spelling.get(write.file) ?? write.file), before: joinPath(B, write.existing!.file),
			...(composedText(write.existing!.title) !== write.title ? { was: write.existing!.title } : {}),
			...(write.edited ? { edited: true as const } : {}),
		})),
		removed: stay.filter(page => !archived!.gone.has(fold(page.file))).map(page => ({ title: page.title, path: joinPath(N, page.file) })),
		restored: writes.filter(write => write.restored).map(write => ({ title: write.title, path: joinPath(N, write.file) })),
		notRestored,
		reordered: props.filter(entry => entry.moved).length,
	};
	return {
		t: 'section', s, n: notebook.n, key: listed.key, staging: staged.id, ops, needs, summary, result, listed, moves,
		fresh: writes.map(write => joinPath(N, spelling.get(write.file) ?? write.file)),
	};
}

/** What running and undoing steps need: where, the update's own record, and its journal. */
interface Context {
	vault: UpdateSink;
	start: StartEntry;
	journal: Journal;
	state: RunState;
}

/** A section's earlier name, with its earlier groups when OneNote moved it to another group, for the record. */
function wasCalled(item: PlanItem, archived: ArchivedSection, label: string): string {
	const name = item.before?.name ?? archived.heading ?? archived.folder.split('/').pop()!;
	const groups = item.before?.groups;
	if (groups && groups.map(composedText).join('/') !== item.groups.map(composedText).join('/')) return [...groups, name].join(' / ');
	return fold(composedText(name)) !== fold(label) ? name : archived.folder;
}

/** A free path in the update's previous versions for a file taken out of the way (nothing is deleted). */
async function asidePath(ctx: Context, path: string): Promise<string> {
	const target = joinPath(ctx.start.backup, STRINGS[ctx.start.reader].notAppliedFolder, path);
	let free = target;
	for (let n = 2; await ctx.vault.exists(free); n++) free = target.replace(/(\.[^./]+)?$/, extension => ` (${n})${extension}`);
	return free;
}

/** A file an update wrote and then took back goes aside, with the previous versions. */
async function setAside(ctx: Context, path: string): Promise<void> {
	await ctx.vault.move(path, await asidePath(ctx, path));
}

/**
 * Before a step writes over `path`: when the file there is none of `expected` (the user changed it
 * since the update looked, or a write cut off part way left it so), a copy of it goes aside first,
 * and the journal says so. What anyone wrote is never lost (rule 1).
 */
async function keepUnexpected(ctx: Context, path: string, expected: (State | undefined)[]): Promise<void> {
	const now = await stateOf(ctx.vault, path);
	if (now === null || expected.some(state => state !== undefined && sameState(state, now))) return;
	const to = await asidePath(ctx, path);
	await ctx.vault.copy(path, to);
	await ctx.journal.add({ t: 'kept', path, to });
	ctx.state.kept.push(to);
}

/** Writes over a file with another's content and time (text with its time, other files as bytes). */
async function writeFrom(vault: UpdateSink, from: string, to: string): Promise<void> {
	if (isText(to)) {
		const text = await vault.readText(from);
		const info = await vault.stat(from);
		if (text !== undefined) await vault.writeText(to, text, info ? new Date(info.mtime) : undefined);
		return;
	}
	const bytes = await vault.readBinary(from);
	if (bytes) await vault.writeBinary(to, bytes);
}

async function runOp(ctx: Context, staging: UpdateSink | undefined, op: Op): Promise<void> {
	const { vault } = ctx;
	switch (op.op) {
		case 'copy': {
			if (!await vault.exists(op.from)) return;
			const there = await vault.stat(op.to);
			// A whole copy is done; one cut off part way (shorter) is made again.
			if (there && (op.size === undefined || there.size === op.size)) return;
			if (there) await writeFrom(vault, op.from, op.to);
			else await vault.copy(op.from, op.to);
			return;
		}
		case 'move':
			if (!await vault.exists(op.from)) return;
			await vault.move(op.from, op.to);
			return;
		case 'write': {
			if (op.undo.kind !== 'new' || op.before !== undefined) await keepUnexpected(ctx, op.path, [op.before, op.after]);
			if (op.text !== undefined) {
				await vault.writeText(op.path, op.text);
				return;
			}
			if (!staging) throw new Error('the staging is gone');
			if (op.binary) {
				const bytes = await staging.readBinary(op.staged!);
				if (!bytes) throw new Error(`staged ${op.staged} is missing`);
				await vault.writeBinary(op.path, bytes);
				return;
			}
			const staged = await staging.readText(op.staged!);
			if (staged === undefined) throw new Error(`staged ${op.staged} is missing`);
			const pageText = op.subst ? renameAttachmentLinks(staged, op.subst.folder, op.subst.names) : staged;
			await vault.writeText(op.path, pageText, op.mtime !== undefined ? new Date(op.mtime) : undefined);
			return;
		}
		case 'props': {
			if (!await vault.exists(op.path)) return;
			// Changed by the user since (not a write cut off part way): their text stays, with the place set in it.
			const edited = await editedSince(vault, op);
			if (edited !== undefined) {
				const info = await vault.stat(op.path);
				await vault.writeText(op.path, setProperties(edited, op.set), info ? new Date(info.mtime) : undefined);
				return;
			}
			await keepUnexpected(ctx, op.path, [op.before, op.after]);
			await vault.writeText(op.path, setProperties(op.base, op.set), op.mtime !== null ? new Date(op.mtime) : undefined);
			return;
		}
	}
}

/**
 * A page a props step is about, when the user changed it since the update looked (its text, else
 * undefined): neither what the step expects before or after it, nor what a write of either cut off
 * part way leaves (the start of one of them).
 */
async function editedSince(vault: UpdateSink, op: Extract<Op, { op: 'props' }>): Promise<string | undefined> {
	const now = await stateOf(vault, op.path);
	if ([op.before, op.after].some(state => state !== undefined && sameState(state, now))) return undefined;
	const text = await vault.readText(op.path);
	if (text === undefined) return undefined;
	const after = setProperties(op.base, op.set);
	if (op.base.startsWith(text) || after.startsWith(text)) return undefined;
	return text;
}

async function undoOp(ctx: Context, op: Op): Promise<void> {
	const { vault } = ctx;
	switch (op.op) {
		case 'copy': {
			// Copies stay; one cut off part way is made whole, so no copy kept is half a file.
			const there = await vault.stat(op.to), source = await vault.stat(op.from);
			if (there && source && op.size !== undefined && there.size !== op.size && source.size === op.size) await writeFrom(vault, op.from, op.to);
			return;
		}
		case 'move':
			if (await vault.exists(op.to) && !await vault.exists(op.from)) await vault.move(op.to, op.from);
			return;
		case 'write':
			// Still as it was before the step (the step never got to write it): nothing to put back.
			if (op.undo.kind !== 'new' && op.before !== undefined && op.before !== null && sameState(op.before, await stateOf(vault, op.path))) return;
			switch (op.undo.kind) {
				case 'text':
					await keepUnexpected(ctx, op.path, [op.after, op.before]);
					await vault.writeText(op.path, op.undo.text);
					return;
				case 'saved':
					if (!await vault.exists(op.undo.path)) return;
					await keepUnexpected(ctx, op.path, [op.after, op.before]);
					await writeFrom(vault, op.undo.path, op.path);
					return;
				case 'new':
					if (await vault.exists(op.path)) await setAside(ctx, op.path);
					return;
			}
			return;
		case 'props': {
			if (!await vault.exists(op.path)) return;
			const edited = await editedSince(vault, op);
			if (edited !== undefined) {
				// The user's text stays, with the place as it was before the update.
				const info = await vault.stat(op.path);
				await vault.writeText(op.path, setProperties(edited, rawProperties(op.base, Object.keys(op.set))), info ? new Date(info.mtime) : undefined);
				return;
			}
			await keepUnexpected(ctx, op.path, [op.after, op.before]);
			await vault.writeText(op.path, op.base, op.mtime !== null ? new Date(op.mtime) : undefined);
			return;
		}
	}
}

/**
 * Runs a section's steps from the first not done, marking each done in the journal. When one
 * fails, the section is put back as it was (rollBack).
 */
async function runSection(ctx: Context, run: RunState['sections'][number], staging: UpdateSink | undefined): Promise<void> {
	const { entry } = run;
	try {
		for (let i = run.done; i < entry.ops.length; i++) {
			await runOp(ctx, staging, entry.ops[i]!);
			await ctx.journal.add({ t: 'op', s: entry.s, i });
			run.done = i + 1;
		}
	}
	catch (error) {
		await rollBack(ctx, run, errorText(error));
		return;
	}
	await ctx.journal.add({ t: 'section-end', s: entry.s, outcome: 'done' });
	run.outcome = 'done';
}

/**
 * Puts a section back as it was: the steps done, and the one under way (done or not), undone in
 * reverse, each marked in the journal so that putting back can itself go on after a restart (with
 * the reason it began for).
 */
async function rollBack(ctx: Context, run: RunState['sections'][number], reason: string): Promise<void> {
	const { entry } = run;
	if (run.undone === undefined && run.reason === undefined) {
		await ctx.journal.add({ t: 'rollback', s: entry.s, reason });
		run.reason = reason;
	}
	const from = run.undone !== undefined ? run.undone - 1 : Math.min(run.done, entry.ops.length - 1);
	// A step the vault does not let be undone (a file made read-only, say) is passed over, and said, so that the update still closes.
	const refused: string[] = [];
	for (let i = from; i >= 0; i--) {
		try {
			await undoOp(ctx, entry.ops[i]!);
		}
		catch (error) {
			refused.push(`${'path' in entry.ops[i]! ? (entry.ops[i] as { path: string }).path : (entry.ops[i] as { to: string }).to}: ${errorText(error)}`);
		}
		await ctx.journal.add({ t: 'undo', s: entry.s, i });
		run.undone = i;
	}
	const why = [run.reason ?? reason, ...refused].join('; ');
	await ctx.journal.add({ t: 'section-end', s: entry.s, outcome: 'rolled back', error: why });
	run.outcome = 'rolled back';
	run.error = why;
}

/** The language of a set of strings. */
const languageOf = (strings: Strings): Language => LANGUAGES.find(language => STRINGS[language] === strings) ?? 'en';
const isLocked = (error: string | undefined) => error !== undefined && LANGUAGES.some(language => STRINGS[language].passwordProtected === error);

/** How the notebook's contents page and report list its sections before the update. */
function listing(items: PlanItem[], dir: string, earlier: ReportNotebook | undefined, archive: Archive | undefined, unmatched: ArchivedSection[] = []): Listed[] {
	const results = new Map((earlier?.sections ?? []).filter(section => section.dir).map(section => [fold(section.dir!), section]));
	// A section's report entry, where it is now (a folder the user moved keeps its record, found by its pages).
	const resultOf = (folder: string) => {
		const result = archive?.sections.find(section => fold(section.folder) === fold(folder))?.recorded ?? results.get(fold(joinPath(dir, folder)));
		if (!result) return {};
		const here = joinPath(dir, folder);
		return { result: { ...result, dir: here, ...(result.report ? { report: { ...result.report, dir: here } } : {}), earlier: true as const } };
	};
	const inDownload: Listed[] = [], extra: Listed[] = [];
	for (const item of items) {
		const base = { key: sectionKey(item.groups, item.label), groups: item.groups, section: item.label };
		if (item.status === 'gone') extra.push({ ...base, extra: true, folder: item.old!, ...resultOf(item.old!) });
		// Imported before and not found now: its record stays, so that it is still known for imported (§11.5 item 52.3).
		else if (item.status === 'missing') {
			const record = earlier?.sections.find(section => sectionKey(section.groups, section.section) === base.key && section.report);
			inDownload.push({ ...base, skipped: true, ...(record ? { result: { ...record, earlier: true as const } } : {}) });
		}
		else if (item.status === 'new' || item.status === 'skipped' || item.status === 'occupied') inDownload.push({ ...base, skipped: true });
		else if (item.old !== undefined) inDownload.push({ ...base, folder: item.old, ...resultOf(item.old) });
		else inDownload.push({ ...base, unlinked: true, ...(item.error !== undefined ? { error: item.error } : {}), ...(isLocked(item.error) ? { locked: true } : { failed: true }) });
	}
	// Sections of ours a partial download does not have: listed where they are, as gone ones are.
	for (const section of unmatched) {
		if (extra.some(entry => entry.folder !== undefined && fold(entry.folder) === fold(section.folder))) continue;
		const parts = section.folder.split('/');
		const label = section.heading ?? parts[parts.length - 1]!;
		extra.push({ key: sectionKey(parts.slice(0, -1), label), groups: parts.slice(0, -1), section: label, extra: true, folder: section.folder, ...resultOf(section.folder) });
	}
	return inTocOrder(inDownload, extra);
}

/** File names to keep (by page id) and to leave alone, for converting a matched section again. */
function namesFor(archived: ArchivedSection | undefined, files: string[], scanned: ScannedSection | undefined, strings: Strings): SectionNames {
	if (!archived) return {};
	const titles = new Map((scanned?.pages ?? []).map(page => [page.id, page.title]));
	const names = new Map<string, string>();
	for (const page of archived.pages.values()) {
		const now = titles.get(page.id);
		if (now === undefined) continue;
		const base = page.file.replace(/\.md$/i, '');
		// A page OneNote retitled gets a name from its new title, unless that is its name already (in another case, say).
		if (composedText(page.title) !== now && fold(safeName(now || strings.untitledPage, strings.untitledPage)) !== fold(base)) continue;
		names.set(page.id, base);
	}
	// Files no new page may take: all but those of the pages the download has (pages OneNote deleted stay, §11.5 item 51).
	const pageFiles = new Set([...archived.pages.values()].filter(page => titles.has(page.id)).map(page => fold(page.file)));
	const taken = new Set(files.filter(file => parentOf(file) === archived.folder && !pageFiles.has(fold(baseName(file)))).map(file => fold(baseName(file))));
	return { names, taken };
}

/**
 * What the report recorded of a notebook in `dir`, for planning it (§11.5 item 52): each section
 * folder's OneNote name and groups then, the sections imported, and those left unticked (they are
 * not ticked again unasked).
 */
export function recordedPlanOptions(entry: ReportNotebook | undefined, dir: string): Pick<PlanOptions, 'previous' | 'imported' | 'skipped'> {
	const inNotebook = (entry?.sections ?? []).filter(section => section.dir !== undefined && fold(section.dir).startsWith(`${fold(dir)}/`));
	return {
		previous: new Map(inNotebook.map(section => [fold(section.dir!.slice(dir.length + 1)), { groups: section.groups, name: section.section }])),
		imported: new Set(inNotebook.filter(section => section.report && !section.failed && !section.skipped && !section.cancelled).map(section => sectionKey(section.groups, section.section))),
		// Left unticked: recorded without a folder (a section of ours is never one of these).
		skipped: new Set((entry?.sections ?? []).filter(section => section.skipped && !section.report).map(section => sectionKey(section.groups, section.section))),
	};
}

const UPDATED = new Set<PlanStatus>(['changed', 'new', 'unfinished', 'skipped', 'missing']);

/**
 * The sections to update, in an order that lets each move into the folder it is given: one whose
 * new folder another moves out of (OneNote renamed A to B and B to C) comes after that one. Where
 * two (or more) would wait for each other (OneNote swapped two names), one is given a numbered
 * folder instead, so that the others can go on.
 */
function inMovingOrder(items: PlanItem[], archive: Archive | undefined, strings: Strings): PlanItem[] {
	const moving = (item: PlanItem) => item.old !== undefined && item.new !== undefined && fold(item.old) !== fold(item.new);
	const waitsFor = (item: PlanItem) => items.filter(other => other !== item && moving(other) && item.new !== undefined
		&& (fold(item.new) === fold(other.old!) || fold(item.new).startsWith(`${fold(other.old!)}/`)));
	const taken = new Set([...(archive?.sections ?? []).map(section => fold(section.folder)), ...items.map(item => fold(item.new ?? ''))]);
	const out: PlanItem[] = [];
	const state = new Map<PlanItem, 'visiting' | 'done'>();
	const visit = (item: PlanItem) => {
		if (state.get(item) === 'done') return;
		if (state.get(item) === 'visiting') {
			// A cycle: this one goes to a numbered folder, which no other section has or is given.
			let folder = item.new!;
			for (let n = 2; taken.has(fold(folder)); n++) folder = joinPath(parentOf(item.new!), safeName(numberedName(item.label, n), strings.untitledPage, 120));
			taken.add(fold(folder));
			item.new = folder;
			// Its new folder is nobody's: it waits for none, and goes before the one that waits for it.
			state.set(item, 'done');
			out.push(item);
			return;
		}
		state.set(item, 'visiting');
		for (const other of waitsFor(item)) visit(other);
		if (state.get(item) !== 'done') {
			state.set(item, 'done');
			out.push(item);
		}
	};
	for (const item of items) visit(item);
	return out;
}

/**
 * Updates the notebooks of a new download in the vault (§11.5 item 49): the sections chosen
 * (those changed, new, unfinished, or left unticked before). Returns undefined when there is
 * nothing to do, and then nothing is written. An update cut off before is to be finished first
 * (resumeUpdates).
 */
export async function updateNotebooks(requests: UpdateRequest[], host: UpdateHost, options: UpdateOptions): Promise<UpdateResult | undefined> {
	const { vault } = host;
	const reported = new Map((await reportedNotebooks(vault, options.strings)).map(notebook => [fold(notebook.dir), notebook]));

	// Each notebook is planned again against the vault as it is now.
	const planned = [];
	for (const request of requests) {
		const notebook = request.notebook;
		let dir: string | undefined, archive;
		for (const language of LANGUAGES) {
			const candidate = notebookFolder(notebook.name, STRINGS[language]);
			archive = await readArchive(vault, candidate, reported.get(fold(candidate))?.sections);
			if (archive) {
				dir = candidate;
				break;
			}
		}
		const language = archive?.language ?? options.languageFor(notebook);
		const strings = STRINGS[language];
		dir ??= notebookFolder(notebook.name, strings);
		const plan = planNotebook(notebook.name, request.scanned, archive, strings, { partial: request.partial, ...recordedPlanOptions(reported.get(fold(dir)), dir), chosen: request.chosen });
		// A folder of that name that is not ours: nothing goes into it.
		const occupied = !archive && (await vault.listFiles(dir)).length > 0;
		// Sections chosen that changed, are new or unfinished; and those with a page the user deleted that is to come back.
		const restoring = (item: PlanItem) => item.status === 'same' && item.added.some(page => page.userDeleted && request.restore?.has(page.id));
		// And those without changes the user chose to convert again with the settings chosen now.
		const reconverting = (item: PlanItem) => item.status === 'same' && !!request.reconvert?.has(sectionKey(item.groups, item.label));
		const chosen = plan.identity === 'different' || occupied ? [] : plan.items.filter(item => (UPDATED.has(item.status) || restoring(item) || reconverting(item)) && request.chosen.has(sectionKey(item.groups, item.label)));
		const todo = inMovingOrder(chosen, archive, strings);
		planned.push({ request, dir, archive, language, strings, plan, occupied, todo });
	}
	if (!planned.some(entry => entry.todo.length)) return undefined;
	// Two requests for one notebook folder (two downloads of one notebook) would each plan against the
	// other's output and set aside over each other's copies: refused before anything is written.
	const folders = planned.map(entry => fold(entry.dir));
	const twice = planned.find((entry, i) => folders.indexOf(fold(entry.dir)) !== i);
	if (twice) throw new Error(`Two downloads would update the notebook folder ${twice.dir}: choose one of them`);

	const reader = options.strings;
	const oldRoot = await ownFolder(vault, reader, 'oldVersionsFolder');
	const logRoot = await ownFolder(vault, reader, 'updateLogFolder');
	let stamp = updateStamp(options.at);
	for (let n = 2; await vault.exists(joinPath(oldRoot, stamp)) || await vault.exists(joinPath(logRoot, `${stamp}.md`)) || await vault.exists(joinPath(logRoot, `${stamp}.jsonl`)); n++) stamp = `${updateStamp(options.at)} (${n})`;
	const start: StartEntry = {
		t: 'start', at: options.at.toISOString(), reader: languageOf(reader), sources: options.sources, links: options.links, defaults: options.defaults,
		backup: joinPath(oldRoot, stamp), record: joinPath(logRoot, `${stamp}.md`), journal: joinPath(logRoot, `${stamp}.jsonl`),
		...(options.joins !== undefined ? { joins: options.joins } : {}),
	};
	const journal = new Journal(vault, start.journal);
	await journal.add(start);
	const state: RunState = { start, notebooks: [], sections: [], failed: [], stopped: false, linking: new Map(), kept: [] };
	const ctx: Context = { vault, start, journal, state };

	for (const [n, entry] of planned.entries()) {
		const earlier = reported.get(fold(entry.dir));
		const notebook: NotebookEntry = {
			t: 'notebook', n, notebook: entry.request.notebook.name, dir: entry.dir, language: entry.language,
			options: earlier?.options ?? options.defaults,
			state: entry.plan.identity === 'different' ? 'different' : entry.occupied ? 'occupied' : 'update',
			listed: listing(entry.plan.items, entry.dir, earlier, entry.archive, (entry.archive?.sections ?? []).filter(section => !entry.plan.items.some(item => item.old !== undefined && fold(item.old) === fold(section.folder)))),
			notes: entry.plan.items.filter(item => item.status === 'gone' || item.status === 'error' || item.status === 'occupied')
				.map(item => ({ key: item.key, status: item.status, label: item.label, groups: item.groups, ...(item.error !== undefined ? { error: item.error } : {}) })),
			chosen: entry.todo.map(item => sectionKey(item.groups, item.label)),
		};
		await journal.add(notebook);
		state.notebooks.push(notebook);
	}

	const total = planned.reduce((sum, entry) => sum + entry.todo.length, 0);
	let done = 0;
	for (const [n, entry] of planned.entries()) {
		if (!entry.todo.length) continue;
		const notebook = state.notebooks[n]!;
		const tocPath = joinPath(entry.dir, `${entry.strings.tocFileName}.md`);
		const nb: NotebookState = { entry: notebook, strings: entry.strings, tocPath, toc: entry.archive ? await vault.readText(tocPath) : undefined };
		for (const item of entry.todo) {
			if (host.isCancelled?.()) {
				state.stopped = true;
				break;
			}
			const key = sectionKey(item.groups, item.label);
			const section = entry.request.notebook.sections.find(candidate => sectionKey(candidate.groups, candidate.label) === key)!;
			host.onProgress?.({ notebook: notebook.notebook, section, done, total });
			const archived = item.old !== undefined ? entry.archive?.sections.find(candidate => candidate.folder === item.old) : undefined;
			const names = namesFor(archived, entry.archive?.files ?? [], entry.request.scanned.find(scanned => sectionKey(scanned.groups, scanned.label) === key), entry.strings);
			const reconvert = item.status === 'same' && !!entry.request.reconvert?.has(key);
			const outcome = await updateSection(host, ctx, nb, item, section, archived, names, entry.request.restore, reconvert);
			done++;
			host.onSectionDone?.(notebook.notebook, section, outcome);
		}
		if (state.stopped) break;
	}
	if (state.stopped) await journal.add({ t: 'stop' });
	return finish(host, ctx);
}

/** A section's steps cannot be worked out against the vault as it is: a folder it needs is taken. */
class Blocked extends Error {
	readonly folder: string;
	constructor(folder: string) {
		super(`${folder} is taken`);
		this.folder = folder;
	}
}

/** Converts one section outside the vault, then puts it in (or back, when that cannot be finished). */
async function updateSection(host: UpdateHost, ctx: Context, nb: NotebookState, item: PlanItem, section: DownloadSection, archived: ArchivedSection | undefined, names: SectionNames, restore?: ReadonlySet<string>, reconvert = false): Promise<SectionOutcome> {
	const { journal, state } = ctx;
	const notebook = nb.entry;
	const key = sectionKey(item.groups, item.label);
	const failed = async (error: string, locked?: boolean, blocked?: string) => {
		const entry = { t: 'failed' as const, n: notebook.n, key, label: item.label, groups: item.groups, error, ...(locked ? { locked: true as const } : {}), ...(blocked !== undefined ? { blocked } : {}) };
		await journal.add(entry);
		state.failed.push(entry);
		// A section not there before that cannot be read is listed as such; one that was there stays as it was.
		if (!archived) {
			const at = notebook.listed.findIndex(listed => listed.key === key && !listed.extra);
			if (at >= 0) notebook.listed[at] = { key, groups: item.groups, section: item.label, unlinked: true, ...(locked ? { locked: true } : { failed: true }) };
		}
		return blocked !== undefined ? 'not updated' as const : 'not converted' as const;
	};
	const staged = await host.newStaging();
	const dir = joinPath(notebook.dir, item.new!);
	// Settings go with each section (§11.5 item 65): one written now for the first time, or converted
	// again by choice, takes those chosen now; one OneNote changed keeps its own, so its pages stay alike.
	const firstTime = item.status === 'new' || item.status === 'skipped' || item.status === 'missing' || item.status === 'unfinished';
	const options = reconvert || firstTime ? state.start.defaults : (archived?.recorded?.options ?? notebook.options);
	let result: SectionResult;
	try {
		result = host.convertSection
			? await host.convertSection(section, dir, notebook.language, options, names, staged.sink)
			: await convertSection(section, dir, nb.strings, { sink: staged.sink, parse: host.parse, isPasswordProtected: host.isPasswordProtected }, options, names);
		result = { ...result, options };
	}
	catch (error) {
		// Converting failed outside the parser (the worker stopped, the staging is full): nothing was written.
		await host.releaseStaging(staged.id);
		return failed(errorText(error));
	}
	if (!result.report) {
		await host.releaseStaging(staged.id);
		return failed(result.error ?? '', result.locked);
	}
	let entry: SectionEntry;
	try {
		entry = await prepareSection(host.vault, state.start, nb, state.sections.length, item, archived, staged, result, restore, reconvert);
	}
	catch (error) {
		await host.releaseStaging(staged.id);
		return failed(errorText(error), false, error instanceof Blocked ? error.folder : undefined);
	}
	await journal.add(entry);
	const run: RunState['sections'][number] = { entry, done: 0 };
	state.sections.push(run);
	await runSection(ctx, run, staged.sink);
	await host.releaseStaging(staged.id);
	if (entry.ops[0]?.op === 'copy' && entry.ops[0].from === nb.tocPath) nb.tocSaved = true;
	if (run.outcome === 'done') {
		nb.toc = (entry.ops[entry.ops.length - 1] as { text: string }).text;
		const at = notebook.listed.findIndex(listed => listed.key === entry.key && !listed.extra);
		if (at >= 0) notebook.listed[at] = entry.listed;
	}
	return run.outcome!;
}

/**
 * Relative links of a page that was at `oldPath` and is at `newPath`, made to point where their
 * targets are now. Only links whose target or page moved change; a link that climbs out of the
 * output folder is left as it is.
 */
function remapLinks(pageText: string, oldPath: string, newPath: string, moved: (path: string) => string): string {
	const oldFolder = parentOf(oldPath), newFolder = parentOf(newPath);
	return pageText.replace(/\]\(<([^>\n]+)>\)/g, (whole, target: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return whole;
		const hash = target.indexOf('#');
		const path = hash < 0 ? target : target.slice(0, hash), anchor = hash < 0 ? '' : target.slice(hash);
		const before = resolvePath(oldFolder, path);
		if (before === undefined) return whole;
		const now = moved(before);
		if (fold(now) === fold(before) && fold(oldFolder) === fold(newFolder)) return whole;
		return `](<${relativePath(now, newFolder)}${anchor}>)`;
	});
}

/**
 * The pages the sections' contents pages list (in any marker language), as paths: `listed`, all of
 * them (a file that is not listed is the user's, a copy of a page say); `gone`, those listed as no
 * longer in OneNote.
 */
async function listedPages(vault: UpdateSink, notebookFolders: string[]): Promise<{ listed: Set<string>, gone: Set<string> }> {
	const headings = [...new Set(LANGUAGES.map(language => STRINGS[language].noLongerInOneNote))];
	const listed = new Set<string>(), gone = new Set<string>();
	for (const folder of notebookFolders) {
		for (const path of await vault.listFiles(folder)) {
			if (!ALL_TOC_NAMES.some(name => path.endsWith(`/${name}.md`))) continue;
			const text = await vault.readText(path) ?? '';
			const at = Math.max(...headings.map(heading => text.indexOf(`\n## ${heading}\n`)));
			for (const match of text.matchAll(/\]\(<([^>]+\.md)>\)/g)) {
				if (match[1]!.includes('/')) continue;
				const page = fold(joinPath(parentOf(path), match[1]!));
				listed.add(page);
				if (at >= 0 && match.index! > at) gone.add(page);
			}
		}
	}
	return { listed, gone };
}

/**
 * Links, once the sections are done (§11.5 item 52.1), in our pages only (those with a page id).
 * In the sections updated now: `onenote:` links in the pages written now and, in the pages that
 * were there, those left from before that can be resolved now. Elsewhere (sections not chosen,
 * not in the download, pages OneNote deleted, other notebooks): only relative links this update's
 * renames and moves broke, made to point to the same page again. A page that was there before is
 * copied aside before it is changed and keeps its file time; its links are worked out from that
 * copy, and a page written now from its text as written. Each page is journaled before and after
 * it is changed: done again after a cut-off, a page done is left alone, one begun is finished
 * from its copy (after keeping aside what the user changed meanwhile).
 */
async function fixLinks(host: Pick<UpdateHost, 'vault' | 'listFolders'>, ctx: Context): Promise<LinkStats> {
	const { vault, state } = ctx;
	const done = state.sections.filter(run => run.outcome === 'done').map(run => run.entry);
	const moves = done.flatMap(entry => entry.moves);
	const freshPaths = done.flatMap(entry => entry.fresh);
	const fresh = new Set(freshPaths.map(fold));
	const updated = new Set(done.map(entry => fold(joinPath(state.notebooks.find(notebook => notebook.n === entry.n)!.dir, entry.listed.folder!))));
	const exact = new Map(moves.filter(move => !move.folder).map(move => [fold(move.from), move.to]));
	const folders = moves.filter(move => move.folder);
	const moved = (path: string) => {
		const to = exact.get(fold(path));
		if (to !== undefined) return to;
		for (const move of folders) if (fold(path).startsWith(`${fold(move.from)}/`)) return move.to + path.slice(move.from.length);
		return path;
	};
	const oldPathOf = (path: string) => {
		for (const move of folders) if (fold(path).startsWith(`${fold(move.to)}/`)) return move.from + path.slice(move.to.length);
		return path;
	};
	const names = { tocFileNames: ALL_TOC_NAMES, attachmentsFolders: ALL_ATTACHMENT_FOLDERS };
	const notebookFolders: string[] = [];
	for (const name of await host.listFolders()) {
		if (!name.startsWith('.') && await isOurNotebook(vault, name)) notebookFolders.push(name);
	}
	notebookFolders.sort();
	const { listed, gone } = await listedPages(vault, notebookFolders);
	// The sections of the notebooks updated are known by their OneNote names too.
	const converted: SectionRef[] = [];
	for (const notebook of state.notebooks) {
		if (notebook.state !== 'update') continue;
		const tocName = `${STRINGS[notebook.language].tocFileName}.md`;
		for (const listed of finalListing(state, notebook)) {
			if (listed.folder === undefined || listed.unlinked || listed.skipped) continue;
			converted.push({ source: [notebook.notebook, ...listed.groups, listed.section].map(part => part.normalize('NFC')), toc: joinPath(notebook.dir, listed.folder, tocName) });
		}
	}
	const index = await buildLinkIndex(vault, notebookFolders, converted, names);
	// A page id held by several files: links go to the page its contents page lists, not to a copy
	// the user made; and to the live one, not the old file of a page OneNote moved to another section
	// (it keeps its id; the old file stays, listed as no longer in OneNote).
	for (const [id, paths] of index.pages) {
		const ours = paths.filter(path => listed.has(fold(path)) || fresh.has(fold(path)));
		const live = (ours.length ? ours : paths).filter(path => !gone.has(fold(path)));
		const best = live.length ? live : ours.length ? ours : paths;
		if (best.length < paths.length) index.pages.set(id, best);
	}
	const stats: LinkStats = { links: 0, resolved: 0, unresolved: 0, filesChanged: 0, unresolvedTargets: {} };
	const inUpdated = (path: string) => updated.has(fold(parentOf(path)));
	const pages = new Set(freshPaths);
	for (const folder of notebookFolders) {
		for (const path of (await vault.listFiles(folder)).sort()) {
			if (!isText(path) || path.split('/').some(part => names.attachmentsFolders.includes(part)) || names.tocFileNames.some(toc => path.endsWith(`/${toc}.md`))) continue;
			// Pages elsewhere are read only when something moved.
			if (inUpdated(path) || moves.length) pages.add(path);
		}
	}
	for (const path of pages) {
		const begun = state.linking.get(fold(path));
		if (begun?.done) continue;
		const now = await vault.readText(path);
		// Ours only (with a page id); a page begun before a cut-off is ours even when the cut left too little of it to tell.
		if (now === undefined || (!begun && !/^onenote-id:/m.test(now.slice(0, 4000)))) continue;
		const isFresh = fresh.has(fold(path));
		// Pages only: a file its contents page does not list is the user's (a copy of a page, say).
		if (!isFresh && !begun && !listed.has(fold(path))) continue;
		// onenote: links only in the sections updated now, and not in the pages OneNote deleted.
		const resolving = state.start.links && inUpdated(path) && !gone.has(fold(path));
		const old = isFresh ? path : oldPathOf(path);
		const saved = joinPath(state.start.backup, old);
		let base = now;
		// Begun before a cut-off: a page written now from the text the journal kept of it.
		if (isFresh && begun?.base !== undefined) base = begun.base;
		else if (!isFresh && begun) {
			// Begun before a cut-off: its copy, when that is whole; else the page as it is (not changed yet).
			const copy = await vault.stat(saved);
			if (copy && begun.before && copy.size === begun.before[0]) base = await vault.readText(saved) ?? now;
		}
		const counts: LinkStats = isFresh ? stats : { links: 0, resolved: 0, unresolved: 0, filesChanged: 0, unresolvedTargets: {} };
		const remapped = isFresh ? base : remapLinks(base, old, path, moved);
		const rewritten = resolving ? rewriteLinks(remapped, path, index, counts) : remapped;
		if (!isFresh) {
			stats.links += counts.resolved;
			stats.resolved += counts.resolved;
		}
		if (rewritten === now) continue;
		try {
			const before = begun?.before ?? await stateOf(vault, path);
			const time = before?.[1] ?? null;
			const after: State = [byteLength(rewritten), time];
			if (!begun) {
				// A page written now has no copy elsewhere: the journal keeps the text its links are worked out from.
				await ctx.journal.add({ t: 'link-begin', path, before, after, ...(isFresh ? { base } : {}) });
				state.linking.set(fold(path), { before, after, ...(isFresh ? { base } : {}) });
			}
			if (!isFresh) {
				const copy = await vault.stat(saved);
				if (!copy) await vault.copy(path, saved);
				else if (!before || copy.size !== before[0]) await writeFrom(vault, path, saved);
			}
			await keepUnexpected(ctx, path, [before, after]);
			await vault.writeText(path, rewritten, time !== null ? new Date(time) : undefined);
			await ctx.journal.add({ t: 'link-done', path });
			state.linking.get(fold(path))!.done = true;
			stats.filesChanged++;
		}
		catch {
			// Left as it was: the next update tries again.
		}
	}
	return stats;
}

/** A notebook's sections as the update leaves them. */
function finalListing(state: RunState, notebook: NotebookEntry): Listed[] {
	const done = new Map(state.sections.filter(run => run.outcome === 'done' && run.entry.n === notebook.n).map(run => [run.entry.key, run.entry.listed]));
	const failed = new Map(state.failed.filter(entry => entry.n === notebook.n).map(entry => [entry.key, entry]));
	return notebook.listed.map(listed => {
		if (listed.extra) return listed;
		const now = done.get(listed.key);
		if (now) return now;
		const failure = failed.get(listed.key);
		if (failure && listed.folder === undefined) return { key: listed.key, groups: listed.groups, section: listed.section, unlinked: true, ...(failure.locked ? { locked: true } : { failed: true }) };
		return listed;
	});
}

/** What the update did, as an import's result, for the report. */
function importResult(state: RunState): ImportResult {
	const notebooks: NotebookResult[] = [];
	for (const notebook of state.notebooks) {
		// Only notebooks this update wrote into: the others keep their entries as they are.
		if (notebook.state !== 'update' || !state.sections.some(run => run.outcome === 'done' && run.entry.n === notebook.n)) continue;
		const done = new Map(state.sections.filter(run => run.outcome === 'done' && run.entry.n === notebook.n).map(run => [run.entry.key, run.entry.result]));
		const failed = new Map(state.failed.filter(entry => entry.n === notebook.n).map(entry => [entry.key, entry]));
		const sections = finalListing(state, notebook).map((listed): SectionResult => {
			const base = { groups: listed.groups, section: listed.section };
			const now = !listed.extra ? done.get(listed.key) : undefined;
			if (now) return now;
			if (listed.result) return listed.result;
			if (listed.folder !== undefined) return { ...base, dir: joinPath(notebook.dir, listed.folder), earlier: true };
			const failure = !listed.extra ? failed.get(listed.key) : undefined;
			if (failure) return { ...base, failed: true, error: failure.error, ...(failure.locked ? { locked: true } : {}) };
			if (listed.unlinked) return { ...base, failed: true, earlier: true, ...(listed.error !== undefined ? { error: listed.error } : {}), ...(listed.locked ? { locked: true } : {}) };
			// Chosen and not done (stopped before it, or put back): not left unticked, so it is new again next time.
			if (!listed.extra && notebook.chosen.includes(listed.key)) return { ...base, cancelled: true };
			return { ...base, skipped: true };
		});
		notebooks.push({ notebook: notebook.notebook, dir: notebook.dir, language: notebook.language, sections });
	}
	return { notebooks, cancelled: false, notStarted: [] };
}

/** The sections chosen that the update did not get to (it was stopped, or cut off and finished later). */
function notReached(state: RunState): { notebook: NotebookEntry, key: string }[] {
	const reached = new Set([...state.sections.map(run => `${run.entry.n}/${run.entry.key}`), ...state.failed.map(entry => `${entry.n}/${entry.key}`)]);
	return state.notebooks.flatMap(notebook => notebook.chosen.filter(key => !reached.has(`${notebook.n}/${key}`)).map(key => ({ notebook, key })));
}

/** What the sections done changed. */
function countsOf(state: RunState): UpdateCounts {
	const done = state.sections.filter(run => run.outcome === 'done').map(run => run.entry);
	// A section whose only change is pages the user brought back is not counted as updated (§11.5 item 51.2).
	const onlyRestored = (summary: Summary) => !summary.added.length && !summary.modified.length && !summary.removed.length && !summary.reordered && summary.was === undefined && summary.restored.length > 0;
	return {
		sectionsUpdated: done.filter(entry => !entry.summary.isNew && !entry.summary.reconverted && !onlyRestored(entry.summary)).length,
		sectionsAdded: done.filter(entry => entry.summary.isNew).length,
		sectionsReconverted: done.filter(entry => entry.summary.reconverted).length,
		pagesAdded: done.reduce((n, entry) => n + entry.summary.added.length, 0),
		pagesModified: done.reduce((n, entry) => n + entry.summary.modified.length, 0),
		pagesRemoved: done.reduce((n, entry) => n + entry.summary.removed.length, 0),
		pagesRestored: done.reduce((n, entry) => n + entry.summary.restored.length, 0),
	};
}

/** What needs the reader's attention, counted as the record lists it. */
function attentionOf(state: RunState): UpdateAttention {
	const done = state.sections.filter(run => run.outcome === 'done').map(run => run.entry);
	return {
		bothEdited: done.reduce((n, entry) => n + entry.summary.modified.filter(page => page.edited).length, 0),
		keptEdited: done.reduce((n, entry) => n + (entry.summary.kept?.length ?? 0), 0),
		keptAside: state.kept.length,
		rolledBack: state.sections.filter(run => run.outcome === 'rolled back').length,
		notConverted: state.failed.filter(entry => entry.blocked === undefined).length,
		notUpdated: state.failed.filter(entry => entry.blocked !== undefined).length,
		notReached: notReached(state).length,
	};
}

/** The record of an update: what changed, and what needs the reader's attention. */
/** The record's page. `reportName`: the folder's report (without `.md`), which the opening links to. */
function recordMarkdown(state: RunState, backupMade: boolean, reportName: string): string {
	const reader = STRINGS[state.start.reader];
	const u = reader.update, r = reader.report;
	const here = parentOf(state.start.record);
	const to = (path: string) => relativePath(path, here);
	const name = (groups: string[], label: string) => text([...groups, label].join(' / '));
	const notebookOf = (n: number) => state.notebooks.find(notebook => notebook.n === n)?.notebook ?? '';
	const done = state.sections.filter(run => run.outcome === 'done').map(run => run.entry);
	const counts = countsOf(state);
	const title = u.title(reportTime(state.start.at));
	const lines = ['---', `title: ${JSON.stringify(title)}`, '---', '', `# ${title}`, '', u.intro(backupMade ? text(state.start.backup) : undefined, link(reportName, to(`${reportName}.md`))), ''];
	lines.push(`- ${r.time(reportTime(state.start.at))}`, `- ${r.source(state.start.sources.map(text))}`, `- ${u.counts(counts)}`);
	if (state.stopped || notReached(state).length) lines.push(`- ${u.stopped}`);
	if (state.resumed) lines.push(`- ${u.resumed}`);

	lines.push('', `## ${u.attention}`, '');
	const notes: string[] = [];
	const both = done.flatMap(entry => entry.summary.modified.filter(page => page.edited)
		.map(page => u.bothEditedPage(link(page.title || reader.untitledPage, to(page.path)), link(u.yourVersion, to(page.before!)))));
	if (both.length) notes.push(`- ${u.bothEdited}`, ...both.map(line => `\t- ${line}`));
	const keptEdited = done.flatMap(entry => (entry.summary.kept ?? []).map(page => link(page.title || reader.untitledPage, to(page.path))));
	if (keptEdited.length) notes.push(`- ${u.keptEdited}`, ...keptEdited.map(line => `\t- ${line}`));
	const notRestored = done.flatMap(entry => (entry.summary.notRestored ?? []).map(title => name([entry.summary.notebook, ...entry.summary.groups, entry.summary.label], title || reader.untitledPage)));
	if (notRestored.length) notes.push(`- ${u.notRestored(notRestored)}`);
	if (state.kept.length) notes.push(`- ${u.keptAside(state.kept.length, text(joinPath(state.start.backup, reader.notAppliedFolder)))}`);
	for (const run of state.sections.filter(run => run.outcome === 'rolled back')) notes.push(`- ${u.rolledBack(name([run.entry.summary.notebook, ...run.entry.summary.groups], run.entry.summary.label), text(run.error ?? ''))}`);
	for (const entry of state.failed) {
		const section = name([notebookOf(entry.n), ...entry.groups], entry.label);
		notes.push(`- ${entry.blocked !== undefined ? u.notUpdated(section, u.folderTaken(text(entry.blocked))) : u.notConverted(section, text(entry.error))}`);
	}
	for (const notebook of state.notebooks) {
		if (notebook.state === 'different') notes.push(`- ${u.different(text(notebook.notebook))}`);
		if (notebook.state === 'occupied') notes.push(`- ${u.occupiedNotebook(text(notebook.notebook))}`);
		for (const note of notebook.notes.filter(note => note.status === 'error')) notes.push(`- ${u.notConverted(name([notebook.notebook, ...note.groups], note.label), text(note.error ?? ''))}`);
		const gone = notebook.notes.filter(note => note.status === 'gone').map(note => name([notebook.notebook, ...note.groups], note.label));
		if (gone.length) notes.push(`- ${u.gone(gone)}`);
		const occupied = notebook.notes.filter(note => note.status === 'occupied').map(note => name([notebook.notebook, ...note.groups], note.label));
		if (occupied.length) notes.push(`- ${u.occupied(occupied)}`);
	}
	// Pages and sections that moved (attachments no page uses any more, put aside, are not for links from elsewhere).
	const moves = done.flatMap(entry => entry.moves).filter(move => !within(move.to, state.start.backup));
	if (moves.length) notes.push(`- ${u.moved}`, ...moves.map(move => `\t- ${text(move.from)} → ${text(move.to)}`));
	lines.push(...(notes.length ? notes : [u.nothingToNote]));

	if (done.length) {
		lines.push('', `## ${u.changes}`);
		for (const notebook of state.notebooks) {
			const mine = done.filter(entry => entry.n === notebook.n);
			if (!mine.length) continue;
			lines.push('', `### ${text(notebook.notebook)}`, '');
			for (const entry of mine) {
				const summary = entry.summary;
				const toc = joinPath(notebook.dir, entry.listed.folder!, `${STRINGS[notebook.language].tocFileName}.md`);
				const section = link([...summary.groups, summary.label].join(' / '), to(toc));
				lines.push(`- ${summary.missing ? u.missingSection(section) : summary.isNew ? u.newSection(section) : summary.reconverted ? u.reconvertedSection(section, summary.rewritten ?? 0) : u.section(section, summary.was === undefined ? undefined : text(summary.was))}`);
				const mark = (page: PageChange) => (page.edited ? u.bothEditedMark : '');
				for (const page of summary.added) lines.push(`\t- ${u.added(link(page.title || reader.untitledPage, to(page.path)))}`);
				for (const page of summary.modified) {
					lines.push(`\t- ${u.modified(link(page.title || reader.untitledPage, to(page.path)), link(u.before, to(page.before!)), page.was === undefined ? undefined : text(page.was))}${mark(page)}`);
				}
				for (const page of summary.restored ?? []) lines.push(`\t- ${u.restored(link(page.title || reader.untitledPage, to(page.path)))}`);
				for (const page of summary.removed) lines.push(`\t- ${u.removed(link(page.title || reader.untitledPage, to(page.path)))}`);
				if (summary.reordered) lines.push(`\t- ${u.reordered(summary.reordered)}`);
			}
		}
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}

/**
 * The report as it was before this update: a copy is kept with the previous versions before the
 * report is first written, and used from then on (also when finishing after a cut-off).
 */
async function reportBefore(ctx: Context): Promise<{ name: string, previous: unknown } | undefined> {
	const { vault, start } = ctx;
	const parse = (text: string | undefined) => {
		try {
			return text === undefined ? undefined : { value: JSON.parse(text) as unknown };
		}
		catch {
			return undefined;
		}
	};
	const found = await readReport(vault, STRINGS[start.reader]);
	if (!found) return undefined;
	const keep = joinPath(start.backup, `${found.name}.json`);
	const kept = parse(await vault.readText(keep));
	if (kept) return { name: found.name, previous: kept.value };
	const now = await vault.readText(`${found.name}.json`);
	if (now === undefined || !parse(now)) return found;
	await vault.writeText(keep, now);
	return { name: found.name, previous: JSON.parse(now) };
}

/** Fixes links, updates the report, writes the record, and closes the journal. */
async function finish(host: Pick<UpdateHost, 'vault' | 'listFolders'>, ctx: Context): Promise<UpdateResult> {
	const { vault, journal, state } = ctx;
	if (!state.links && state.sections.some(run => run.outcome === 'done')) {
		state.links = await fixLinks(host, ctx);
		await journal.add({ t: 'links', stats: state.links });
	}
	const reader = STRINGS[state.start.reader];
	const options = new Map(state.notebooks.map(notebook => [fold(notebook.dir), notebook.options]));
	const { name } = await writeReport(vault, reader, { ...importResult(state), ...(state.links && state.start.links ? { links: state.links } : {}) }, {
		at: new Date(state.start.at), sources: state.start.sources, options: state.start.defaults,
		optionsOf: dir => options.get(fold(dir)), update: state.start.record,
		...(typeof state.start.joins === 'string' ? { joins: state.start.joins } : {}),
	}, await host.listFolders(), await reportBefore(ctx));
	// A page or attachment was replaced (not only contents pages or the report, kept every time): the record points to the previous versions.
	const ownFiles = new Set([...ALL_TOC_NAMES.map(name => `${name}.md`), ...LANGUAGES.flatMap(language => [`${STRINGS[language].reportName}.json`, `${STRINGS[language].reportName}.md`])].map(fold));
	const backupMade = (await vault.listFiles(state.start.backup)).some(path => !ownFiles.has(fold(baseName(path))));
	await vault.writeText(state.start.record, recordMarkdown(state, backupMade, name));
	await journal.add({ t: 'end' });
	const outcome = (n: number, key: string): SectionOutcome | 'not reached' => {
		const run = state.sections.find(candidate => candidate.entry.n === n && candidate.entry.key === key);
		if (run?.outcome) return run.outcome;
		const failure = state.failed.find(entry => entry.n === n && entry.key === key);
		return failure ? (failure.blocked !== undefined ? 'not updated' : 'not converted') : 'not reached';
	};
	return {
		record: state.start.record, journal: state.start.journal, backup: state.start.backup, report: name,
		outcomes: state.notebooks.flatMap(notebook => notebook.chosen.map(key => ({ notebook: notebook.dir, key, outcome: outcome(notebook.n, key) }))),
		...(state.links && state.start.links ? { links: state.links } : {}),
		cancelled: state.stopped,
		counts: countsOf(state),
		attention: attentionOf(state),
	};
}

/** A path from the output root as an update writes one: relative, `/` between parts, none empty, `.` or `..`, no backslash. */
function isPlainPath(path: unknown): path is string {
	if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return false;
	return path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
const within = (path: string, folder: string) => fold(path) === fold(folder) || fold(path).startsWith(`${fold(folder)}/`);

/**
 * Whether a journal read back is one this code could have written here, at `journalPath`: every
 * path in it is plain; the update's own files are in its own folders; and each step of a section
 * touches only the notebook it is about or the update's previous versions. A journal changed
 * since (by hand, by a sync tool, or in a vault from someone else) is not followed.
 */
function trustworthy(state: RunState, journalPath: string): boolean {
	try {
		const { start } = state;
		const own = (which: 'oldVersionsFolder' | 'updateLogFolder') => new Set(LANGUAGES.map(language => fold(STRINGS[language][which])));
		const oldRoots = own('oldVersionsFolder'), logRoots = own('updateLogFolder');
		if (!isPlainPath(start.backup) || !isPlainPath(start.record) || !isPlainPath(start.journal) || !isLanguage(start.reader)) return false;
		const backup = start.backup.split('/');
		if (backup.length !== 2 || !oldRoots.has(fold(backup[0]!))) return false;
		const log = parentOf(journalPath);
		if (log.includes('/') || !logRoots.has(fold(log)) || fold(start.journal) !== fold(journalPath)) return false;
		if (fold(parentOf(start.record)) !== fold(log) || !start.record.endsWith('.md')) return false;
		const notebooks = new Map<number, NotebookEntry>();
		for (const notebook of state.notebooks) {
			// A notebook is a folder directly under the output root, never one of the update's own.
			if (!isPlainPath(notebook.dir) || notebook.dir.includes('/') || notebook.dir.startsWith('.') || oldRoots.has(fold(notebook.dir)) || logRoots.has(fold(notebook.dir)) || !isLanguage(notebook.language)) return false;
			// The folder an import gives a notebook of that name (in some marker language), no other.
			if (typeof notebook.notebook !== 'string' || !LANGUAGES.some(language => fold(notebookFolder(notebook.notebook, STRINGS[language])) === fold(notebook.dir))) return false;
			notebooks.set(notebook.n, notebook);
		}
		for (const { entry } of state.sections) {
			const notebook = notebooks.get(entry.n);
			if (!notebook || typeof entry.staging !== 'string') return false;
			const mine = (path: unknown) => isPlainPath(path) && (within(path, notebook.dir) || within(path, start.backup));
			for (const op of entry.ops) {
				switch (op.op) {
					case 'copy':
					case 'move':
						if (!mine(op.from) || !mine(op.to)) return false;
						break;
					case 'write':
						if (!mine(op.path) || (op.staged !== undefined && !isPlainPath(op.staged))) return false;
						if (op.undo.kind === 'saved' && !mine(op.undo.path)) return false;
						if (op.subst && op.subst.names.some(([from, to]) => !isPlainPath(from) || !isPlainPath(to) || from.includes('/') || to.includes('/'))) return false;
						break;
					case 'props':
						if (!mine(op.path)) return false;
						break;
					default:
						return false;
				}
			}
			if (!entry.needs.every(([path]) => isPlainPath(path))) return false;
			if (!entry.moves.every(move => mine(move.from) && mine(move.to)) || !entry.fresh.every(mine)) return false;
		}
		return true;
	}
	catch {
		// Not the shape this code writes.
		return false;
	}
}

/** Reads a journal back (a line cut off when it was written is left out). */
function replay(journalText: string): RunState | undefined {
	let state: RunState | undefined;
	for (const line of journalText.split('\n')) {
		let entry: Entry;
		try {
			entry = JSON.parse(line);
		}
		catch {
			continue;
		}
		if (entry.t === 'start') {
			state = { start: entry, notebooks: [], sections: [], failed: [], stopped: false, linking: new Map(), kept: [] };
			continue;
		}
		if (!state) continue;
		const run = 's' in entry && entry.t !== 'section' ? state.sections.find(candidate => candidate.entry.s === entry.s) : undefined;
		switch (entry.t) {
			case 'notebook': state.notebooks.push(entry); break;
			case 'section': state.sections.push({ entry, done: 0 }); break;
			case 'op': if (run) run.done = Math.max(run.done, entry.i + 1); break;
			case 'undo': if (run) run.undone = Math.min(run.undone ?? entry.i, entry.i); break;
			case 'rollback': if (run) run.reason = entry.reason; break;
			case 'kept': state.kept.push(entry.to); break;
			case 'link-begin': state.linking.set(fold(entry.path), { before: entry.before, after: entry.after, ...(entry.base !== undefined ? { base: entry.base } : {}) }); break;
			case 'link-done': { const begun = state.linking.get(fold(entry.path)); if (begun) begun.done = true; break; }
			case 'section-end': if (run) Object.assign(run, { outcome: entry.outcome, ...(entry.error !== undefined ? { error: entry.error } : {}) }); break;
			case 'failed': state.failed.push(entry); break;
			case 'stop': state.stopped = true; break;
			case 'links': state.links = entry.stats; break;
			case 'end': return undefined;
		}
	}
	return state;
}

/** The journals of updates cut off and not finished yet that resumeUpdates would finish (in any marker language's log folder). */
export async function unfinishedUpdates(vault: UpdateSink): Promise<string[]> {
	const out: string[] = [];
	for (const folder of [...new Set(LANGUAGES.map(language => STRINGS[language].updateLogFolder))]) {
		for (const path of (await vault.listFiles(folder)).filter(file => parentOf(file) === folder && file.endsWith('.jsonl')).sort()) {
			const state = replay(await vault.readText(path) ?? '');
			if (state && trustworthy(state, path)) out.push(path);
		}
	}
	return out;
}

/**
 * Finishes the updates of the output root that were cut off (Obsidian quit, a crash): each has a
 * journal that does not end (§11.5 item 49). The section an update was in is finished from its
 * staging when that is whole, and otherwise put back as it was; then links, report and record.
 * A journal this code could not have written (see trustworthy) is left alone, and nothing is done
 * by it: its section stays as it is, and the next check for updates finds it unfinished.
 */
export async function resumeUpdates(host: Pick<UpdateHost, 'vault' | 'openStaging' | 'releaseStaging' | 'listFolders'>): Promise<{ finished: UpdateResult[], ignored: string[] }> {
	const { vault } = host;
	const results: UpdateResult[] = [];
	const ignored: string[] = [];
	const folders = [...new Set(LANGUAGES.map(language => STRINGS[language].updateLogFolder))];
	for (const folder of folders) {
		for (const path of (await vault.listFiles(folder)).filter(file => parentOf(file) === folder && file.endsWith('.jsonl')).sort()) {
			const state = replay(await vault.readText(path) ?? '');
			if (!state) continue;
			if (!trustworthy(state, path)) {
				ignored.push(path);
				continue;
			}
			state.resumed = true;
			const journal = new Journal(vault, path);
			const ctx: Context = { vault, start: state.start, journal, state };
			const reader = STRINGS[state.start.reader];
			for (const run of state.sections) {
				if (run.outcome) continue;
				if (run.undone !== undefined) {
					await rollBack(ctx, run, run.reason ?? reader.update.interrupted);
					await host.releaseStaging(run.entry.staging);
					continue;
				}
				// Going on needs the staged files of the steps not done yet, as they were.
				const staging = await host.openStaging(run.entry.staging);
				const sizes = new Map(run.entry.needs);
				let whole = true;
				for (const op of run.entry.ops.slice(run.done)) {
					if (op.op !== 'write' || op.staged === undefined) continue;
					whole &&= !!staging && (await staging.stat(op.staged))?.size === sizes.get(op.staged);
				}
				if (whole) await runSection(ctx, run, staging);
				else await rollBack(ctx, run, reader.update.interrupted);
				await host.releaseStaging(run.entry.staging);
			}
			results.push(await finish(host, ctx));
		}
	}
	return { finished: results, ignored };
}
