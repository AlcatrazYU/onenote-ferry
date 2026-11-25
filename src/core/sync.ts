// Plans an update (§11.5 item 49; Internal-9): compares a new download of a notebook with what an
// earlier import wrote into the vault, section by section. Doing it is separate.
//
// What is on disk decides, as when sections are added to a notebook imported before: only folders
// with a contents page of ours (its onenote-import property) are ours, and nothing else is ever a
// section. A section of the download is matched to the folder of ours that holds most of its pages
// (by page id), each folder going to one section at most, so a section renamed or moved into a
// group in OneNote is still recognised; one with no page in common is matched by the folder name
// the import gives it. A page counts as modified when its title or last-modified time differs, and
// as reordered when only its order or level does. Nothing of ours that the download does not have
// is ever touched (§11.5 items 49, 51): a section is listed as gone, a page as removed, and both
// stay where they are.

import { pageFingerprint } from './fingerprint.ts';
import type { Sink } from './io.ts';
import { composedText, joinPath, numberedName, safeName } from './names.ts';
import { LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings } from './strings.ts';
import type { SectionResult } from './importer.ts';
import { importStatusOf, sectionFolders, sectionKey, tocHeading } from './write.ts';
import type { ImportStatus } from './write.ts';

/** A page in the new download. */
export interface ScannedPage {
	/** Upper case, with braces. */
	id: string;
	/** Composed (see composedText); '' when it has none. */
	title: string;
	/** Last modified, as an ISO string (`2024-01-02T03:04:05.000Z`), or null when unknown. */
	modified: string | null;
	/** As the page properties count it (from 0). */
	level: number;
	/** Its content's fingerprint (pageFingerprint): what tells that OneNote changed it (§11.5 item 59). */
	fingerprint?: string;
}

/** A section found in the new download. */
export interface ScannedSection {
	/** `notebook/group/.../section`, for messages. */
	key: string;
	groups: string[];
	/** The section file's name without `.one`. */
	label: string;
	/** Its pages in order; absent when the section could not be read. */
	pages?: ScannedPage[];
	error?: string;
}

/** A page an earlier import wrote, read back from its properties. */
export interface ArchivedPage {
	id: string;
	title: string;
	modified: string | null;
	order: number | null;
	level: number | null;
	/** Its file name in the section folder. */
	file: string;
	/** Its file's modification time (milliseconds), when the sink can tell. */
	mtime?: number;
	/** Its content's fingerprint when it was written, as the report recorded it (none in reports before §11.5 item 59). */
	fingerprint?: string;
}

/** A section folder of ours. */
export interface ArchivedSection {
	/** Relative to the notebook folder. */
	folder: string;
	status: ImportStatus;
	/** Its name in OneNote when it was imported (the heading of its contents page). */
	heading?: string;
	pages: Map<string, ArchivedPage>;
	/** Titles (composed in full, lower case) of pages its contents page lists whose files are not there any more. */
	missing: Set<string>;
	/**
	 * Files (composed, lower case) its contents page lists as no longer in OneNote: pages OneNote
	 * deleted, which stay where they are (§11.5 item 51).
	 */
	gone: Set<string>;
	/** Ids (upper case) of pages the report records in this folder whose files are gone: the user deleted them (when the report has ids). */
	missingIds?: Set<string>;
	/**
	 * The report's entry for this section: the one recorded at this folder, or (a folder the user
	 * moved within the notebook, §11.5 item 52.2) the one sharing most of its page ids.
	 */
	recorded?: SectionResult;
}

/** What an earlier import wrote of a notebook. */
export interface Archive {
	language: Language;
	sections: ArchivedSection[];
	/** Every file in the notebook folder, relative to it (ours and the user's). */
	files: string[];
}

/**
 * same, changed: matched to a folder of ours. new: no folder yet. unfinished: its folder says it
 * was cut off or failed before. skipped: left unticked when it was imported. gone: a folder of ours
 * the download does not have (nothing is done to it). error: cannot be read now (its folder, if
 * any, is left as it is). occupied: the folder it would get holds what is not ours. missing:
 * imported before (the report says so), and no folder of ours has it now: the user moved it out of
 * the notebook folder or deleted it (§11.5 item 52.3).
 */
export type PlanStatus = 'same' | 'changed' | 'new' | 'unfinished' | 'skipped' | 'missing' | 'gone' | 'error' | 'occupied';

export interface PagePlan {
	id: string;
	title: string;
	/** Its file in the section folder, when it has one. */
	file?: string;
	/** Its title before, when OneNote changed it. */
	from?: string;
	/** Edited in Obsidian since it was written: its file's time is not the page's any more. */
	userEdited?: true;
	/**
	 * Deleted in Obsidian since it was written: its section's contents page lists it, its file is
	 * gone. Such a page is listed with the pages added, and is written back only when chosen.
	 */
	userDeleted?: true;
}

export interface PlanItem {
	key: string;
	status: PlanStatus;
	groups: string[];
	label: string;
	/** Its folder of ours, relative to the notebook folder. */
	old?: string;
	/** The folder it goes into (another one than `old` when OneNote renamed or moved it). */
	new?: string;
	added: PagePlan[];
	/** Pages OneNote deleted since the last update of the section (they stay in the vault, listed apart). */
	removed: PagePlan[];
	modified: PagePlan[];
	/** Pages whose order or level changed, and nothing else. */
	reordered: PagePlan[];
	/** A page of the download is older than the one in the vault (an older download, say). */
	older?: true;
	/** Its OneNote name and groups as the report recorded them, when matched to a folder of ours. */
	before?: { groups: string[], name: string };
	error?: string;
}

export interface NotebookPlan {
	/**
	 * new: nothing of ours in the vault. same: the notebook there. different: a notebook of ours of
	 * that name with no page in common: another notebook of the same name (§11.5 item 47.3).
	 */
	identity: 'new' | 'same' | 'different';
	items: PlanItem[];
}

/** Our heading in a section's contents page above the pages no longer in OneNote, in every marker language. */
const NO_LONGER_IN_ONENOTE = [...new Set(LANGUAGES.map(language => STRINGS[language].noLongerInOneNote))];

/** File times written as a page's last-modified time may be off by this much (FAT keeps two seconds). */
const EDIT_TOLERANCE = 2000;

/** Names as the disk and Obsidian tell them apart: composed in full, any case. */
const fold = (name: string) => name.normalize('NFC').toLowerCase();
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Whether OneNote changed a page since it was written: its content, told by the fingerprints when
 * both sides have one (OneNote leaves a page's time as it was when its text is edited), else its
 * time (§11.5 item 59). A changed title is told apart by the callers.
 */
export function editedInOneNote(before: { modified: string | null, fingerprint?: string }, now: { modified: string | null, fingerprint?: string }): boolean {
	return before.fingerprint !== undefined && now.fingerprint !== undefined ? before.fingerprint !== now.fingerprint : before.modified !== now.modified;
}

/** Whether a page was edited in Obsidian since it was written: its file's time is not the page's any more. */
export function editedInVault(page: ArchivedPage): boolean {
	if (page.mtime === undefined || !page.modified) return false;
	const written = Date.parse(page.modified);
	return !isNaN(written) && Math.abs(page.mtime - written) > EDIT_TOLERANCE;
}

const plan = (page: ArchivedPage, extra: Partial<PagePlan> = {}): PagePlan =>
	({ id: page.id, title: page.title, file: page.file, ...(editedInVault(page) ? { userEdited: true as const } : {}), ...extra });

/**
 * The plan for one notebook. `archive` is what readArchive found (undefined: nothing of ours there).
 * `skipped` holds the sectionKeys of sections left unticked when the notebook was imported.
 * `partial` means the download holds only some sections, so none is listed as gone.
 */
export interface PlanOptions {
	/** The download holds only some sections: none is listed as gone. */
	partial?: boolean;
	/** sectionKeys of sections left unticked when the notebook was imported. */
	skipped?: ReadonlySet<string>;
	/**
	 * What the report recorded of each section folder of ours (relative to the notebook folder,
	 * composed, lower case): the section's OneNote name and groups then. A section moves only when
	 * OneNote changed one of those, never because the user moved its folder (§11.5 item 52.2).
	 */
	previous?: ReadonlyMap<string, { groups: string[], name: string }>;
	/** sectionKeys the report records as imported (see 'missing'). */
	imported?: ReadonlySet<string>;
	/** sectionKeys of the sections to be updated now; the others stay where they are, and keep their folders. */
	chosen?: ReadonlySet<string>;
}

/** Whether the user deleted a page in Obsidian: by its id when the report has ids, else by its title in the contents page. */
export function deletedByUser(section: ArchivedSection, page: { id: string, title: string }, strings: Strings): boolean {
	return section.missingIds ? section.missingIds.has(page.id) : section.missing.has(fold(page.title || strings.untitledPage));
}

export function planNotebook(notebook: string, scanned: ScannedSection[], archive: Archive | undefined, strings: Strings, options: PlanOptions = {}): NotebookPlan {
	// Folder names in the notebook's own language, as the import gave them.
	const names = archive ? STRINGS[archive.language] : strings;
	const folders = sectionFolders(scanned, names);
	const freshOf = (section: ScannedSection) => folders.get(sectionKey(section.groups, section.label))!;
	const sections = archive?.sections ?? [];
	const files = (archive?.files ?? []).map(fold);
	const ours = new Set(sections.map(section => fold(section.folder)));
	/** The folder holds a file and is not a section of ours: the user's. */
	const foreign = (folder: string) => !ours.has(fold(folder)) && files.some(file => file.startsWith(`${fold(folder)}/`));

	const downloadIds = new Set(scanned.flatMap(section => section.pages?.map(page => page.id) ?? []));
	const vaultIds = sections.flatMap(section => [...section.pages.keys()]);
	const identity = !archive ? 'new' : downloadIds.size && vaultIds.length && !vaultIds.some(id => downloadIds.has(id)) ? 'different' : 'same';

	// Matching: pairs by pages in common, most first (then in the download's order), each side once;
	// then by name for the rest (sections without pages in common, sections that cannot be read).
	const holder = new Map<string, number>();
	// Pages listed as no longer in OneNote do not vote: OneNote may have moved them elsewhere since.
	for (const [i, section] of sections.entries()) for (const [id, page] of section.pages) if (!holder.has(id) && !section.gone.has(fold(page.file))) holder.set(id, i);
	const pairs: { s: number, a: number, n: number }[] = [];
	for (const [s, section] of scanned.entries()) {
		const votes = new Map<number, number>();
		for (const page of section.pages ?? []) {
			const a = holder.get(page.id);
			if (a !== undefined) votes.set(a, (votes.get(a) ?? 0) + 1);
		}
		for (const [a, n] of votes) pairs.push({ s, a, n });
	}
	// On equal votes, a folder of the section's own name first (a page moved to another section ties them).
	/** What the report recorded of a folder of ours: the section's OneNote name and groups then (§11.5 item 52.2). */
	const previousOf = (old: ArchivedSection) => options.previous?.get(fold(old.folder)) ?? (old.recorded ? { groups: old.recorded.groups, name: old.recorded.section } : undefined);
	const nameOf = (old: ArchivedSection) => previousOf(old)?.name ?? old.heading ?? old.folder.split('/').pop()!;
	const named = (pair: { s: number, a: number }) => (fold(composedText(nameOf(sections[pair.a]!))) === fold(composedText(scanned[pair.s]!.label)) ? 1 : 0);
	pairs.sort((x, y) => y.n - x.n || named(y) - named(x) || x.s - y.s || x.a - y.a);
	const matchOf = new Map<number, number>();
	const taken = new Set<number>();
	for (const { s, a } of pairs) {
		if (matchOf.has(s) || taken.has(a)) continue;
		matchOf.set(s, a);
		taken.add(a);
	}
	for (const [s, section] of scanned.entries()) {
		if (matchOf.has(s)) continue;
		const fresh = fold(freshOf(section));
		const a = sections.findIndex((old, i) => !taken.has(i) && fold(old.folder) === fresh);
		if (a < 0) continue;
		matchOf.set(s, a);
		taken.add(a);
	}

	// Where each matched section goes (§11.5 item 52.2): where it is, unless OneNote renamed it (then
	// renamed where it is) or moved it to another group (then into that group's folder), as compared
	// with what the report recorded; never because the user moved its folder within the notebook, and
	// never because only the import's numbering of like names differs. Only into a folder that will
	// be free: not one of ours that stays, not the user's, and not inside a section's folder.
	const updating = (section: ScannedSection) => !options.chosen || options.chosen.has(sectionKey(section.groups, section.label));
	const wanted = (section: ScannedSection, old: ArchivedSection): string => {
		if (!section.pages || !updating(section)) return old.folder;
		const previous = previousOf(old);
		const name = previous?.name ?? old.heading;
		const regrouped = previous !== undefined && fold(previous.groups.map(composedText).join('/')) !== fold(section.groups.map(composedText).join('/'));
		if (regrouped) return freshOf(section);
		if (name !== undefined && fold(composedText(name)) !== fold(composedText(section.label))) return joinPath(parentOf(old.folder), safeName(section.label, names.untitledPage, 120));
		return old.folder;
	};
	const used = new Set<string>();
	for (const [a, section] of sections.entries()) if (!taken.has(a)) used.add(fold(section.folder));
	const target = new Map<number, string>();
	for (const [s, a] of matchOf) {
		if (fold(wanted(scanned[s]!, sections[a]!)) !== fold(sections[a]!.folder)) continue;
		target.set(s, sections[a]!.folder);
		used.add(fold(sections[a]!.folder));
	}
	/** Taken: one of ours that stays (or a folder given already), the user's, inside one of those, or holding one. */
	const clashes = (folder: string) => {
		const f = fold(folder);
		return used.has(f) || foreign(folder) || [...used].some(other => f.startsWith(`${other}/`) || other.startsWith(`${f}/`));
	};
	const free = (folder: string, label: string) => {
		// A group folder that is a section folder of ours (a group named like a section): the group's folder gets a number.
		const parts = folder.split('/');
		for (let i = 0; i < parts.length - 1; i++) {
			const name = parts[i]!;
			for (let n = 2; n < 1000 && used.has(fold(parts.slice(0, i + 1).join('/'))); n++) parts[i] = safeName(numberedName(name, n), names.untitledPage);
		}
		const at = joinPath(...parts);
		let candidate = at;
		for (let n = 2; n < 1000 && clashes(candidate); n++) candidate = joinPath(parentOf(at), safeName(numberedName(label, n), names.untitledPage, 120));
		return candidate;
	};
	for (const [s, a] of [...matchOf].sort((x, y) => x[0] - y[0])) {
		if (target.has(s)) continue;
		// A folder another section moves out of may be taken: the update moves that one first.
		const folder = free(wanted(scanned[s]!, sections[a]!), scanned[s]!.label);
		target.set(s, folder);
		used.add(fold(folder));
	}
	/** A folder for a new section: the import's name, or numbered when it is taken. */
	const newFolder = (section: ScannedSection) => free(freshOf(section), section.label);

	const items: PlanItem[] = [];
	for (const [s, section] of scanned.entries()) {
		const base = { key: section.key, groups: section.groups, label: section.label, added: [], removed: [], modified: [], reordered: [] };
		const a = matchOf.get(s);
		const old = a === undefined ? undefined : sections[a]!;
		if (section.error !== undefined || !section.pages) {
			items.push({ ...base, status: 'error', ...(old ? { old: old.folder, new: old.folder } : {}), error: section.error ?? 'unreadable' });
			continue;
		}
		if (!old) {
			const fresh = freshOf(section);
			if (foreign(fresh)) {
				items.push({ ...base, status: 'occupied', new: fresh });
				continue;
			}
			const folder = newFolder(section);
			used.add(fold(folder));
			const key = sectionKey(section.groups, section.label);
			if (options.skipped?.has(key)) items.push({ ...base, status: 'skipped', new: folder });
			else items.push({ ...base, status: options.imported?.has(key) ? 'missing' : 'new', new: folder, added: section.pages.map(page => ({ id: page.id, title: page.title })) });
			continue;
		}
		const recorded = previousOf(old);
		const item: PlanItem = {
			...base, status: 'same', old: old.folder, new: target.get(s)!, added: [], removed: [], modified: [], reordered: [],
			...(recorded ? { before: recorded } : {}),
		};
		const ids = new Set(section.pages.map(page => page.id));
		for (const [i, page] of section.pages.entries()) {
			const before = old.pages.get(page.id);
			if (!before) {
				item.added.push({ id: page.id, title: page.title, ...(deletedByUser(old, page, names) ? { userDeleted: true as const } : {}) });
				continue;
			}
			// Back in OneNote after it was listed as no longer there: its contents page changes.
			if (old.gone.has(fold(before.file))) {
				item.reordered.push(plan(before));
				continue;
			}
			const retitled = composedText(before.title) !== page.title;
			if (retitled || editedInOneNote(before, page)) {
				item.modified.push(plan(before, { title: page.title, ...(retitled ? { from: before.title } : {}) }));
				if (before.modified && page.modified && page.modified < before.modified) item.older = true;
			}
			else if (before.order !== i + 1 || before.level !== page.level) item.reordered.push(plan(before));
		}
		// Pages OneNote deleted stay where they are; once their section's contents page lists them as
		// no longer in OneNote, they are not a change any more.
		for (const page of old.pages.values()) if (!ids.has(page.id) && !old.gone.has(fold(page.file))) item.removed.push(plan(page));
		// A page only the user deleted is not a change: bringing it back is the user's choice.
		const changed = item.added.some(page => !page.userDeleted) || item.removed.length || item.modified.length || item.reordered.length || fold(item.old!) !== fold(item.new!);
		item.status = old.status !== 'complete' ? 'unfinished' : changed ? 'changed' : 'same';
		items.push(item);
	}
	if (!options.partial) {
		for (const [a, section] of sections.entries()) {
			if (taken.has(a)) continue;
			items.push({
				key: [notebook, ...section.folder.split('/').slice(0, -1), section.heading ?? section.folder.split('/').pop()!].join('/'),
				status: 'gone', groups: section.folder.split('/').slice(0, -1), label: section.heading ?? section.folder.split('/').pop()!,
				old: section.folder, added: [], removed: [...section.pages.values()].map(page => plan(page)), modified: [], reordered: [],
			});
		}
	}
	return { identity, items };
}

/** Page info from the parser's JSON for one section, in order, with each page's content fingerprint. */
export async function scannedPages(json: { pages: { id: string, title?: string | null, updated?: number | null, level?: number | null, contents?: unknown }[] }): Promise<ScannedPage[]> {
	return Promise.all(json.pages.map(async page => ({
		id: page.id.toUpperCase(),
		title: composedText(page.title || ''),
		modified: page.updated ? new Date(page.updated * 1000).toISOString() : null,
		// As the adapter writes it (adapter.ts): the parser counts levels from 1.
		level: Math.max(0, (page.level ?? 1) - 1),
		...(page.contents !== undefined ? { fingerprint: await pageFingerprint(page.contents) } : {}),
	})));
}

/**
 * Reads the simple `key: value` front matter the converter writes (string values are JSON), and
 * what an edit in another program may leave: CRLF line ends, single-quoted values.
 */
export function frontMatter(text: string): Record<string, string> {
	const normalized = text.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---')) return {};
	const end = normalized.indexOf('\n---', 3);
	const block = end < 0 ? normalized : normalized.slice(0, end);
	const out: Record<string, string> = {};
	for (const line of block.split('\n').slice(1)) {
		// Not `.`, which stops at the line separators a title may hold (U+2028, U+2029).
		const match = line.match(/^([\w-]+):\s*([^\n]*)$/);
		if (!match) continue;
		let value = match[2]!.trim();
		if (value.startsWith('"')) {
			try {
				value = JSON.parse(value);
			}
			catch {
				// Keep it as written.
			}
		}
		else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
		out[match[1]!] = value;
	}
	return out;
}

const number = (value: string | undefined) => (value !== undefined && /^\d+$/.test(value) ? Number(value) : null);
/** Link text as a contents page writes it (`[` and `]` escaped). */
/** Link text as a contents page writes it: only `[` and `]` are escaped (a backslash in a title stays as it is). */
const unescape = (text: string) => text.replace(/\\([[\]])/g, '$1');

/**
 * What an earlier import wrote of a notebook in `notebookFolder` (a path from the output root), or
 * undefined when the folder is not one of ours (no contents page of ours in it).
 */
/**
 * `recorded`: the notebook's sections as the report has them; where they list page ids, pages the
 * user deleted are told by id (see deletedByUser).
 */
export async function readArchive(sink: Sink, notebookFolder: string, recorded?: readonly SectionResult[]): Promise<Archive | undefined> {
	const all = await sink.listFiles(notebookFolder);
	const byFold = new Map(all.map(path => [fold(path), path]));
	let language: Language | undefined;
	for (const candidate of LANGUAGES) {
		const path = byFold.get(fold(`${notebookFolder}/${STRINGS[candidate].tocFileName}.md`));
		if (path && importStatusOf(await sink.readText(path))) {
			language = candidate;
			break;
		}
	}
	if (!language) return undefined;
	const strings = STRINGS[language];
	const toc = `${strings.tocFileName}.md`;
	const files = all.map(path => path.slice(notebookFolder.length + 1));
	const sections: ArchivedSection[] = [];
	const presentOf = new Map<string, Set<string>>();
	for (const path of files.filter(file => file.endsWith(`/${toc}`)).sort()) {
		const folder = path.slice(0, -(toc.length + 1));
		if (folder.split('/').includes(strings.attachmentsFolder)) continue;
		const text = await sink.readText(`${notebookFolder}/${path}`);
		const status = importStatusOf(text);
		if (!status) continue;
		const inFolder = files.filter(file => parentOf(file) === folder);
		// The contents page lists the section's pages, then, under our heading for them (in any marker
		// language; a heading the user adds does not count), those no longer in OneNote.
		const split = Math.max(...NO_LONGER_IN_ONENOTE.map(heading => (text ?? '').indexOf(`\n## ${heading}\n`)));
		const links = /\[((?:\\.|[^\]\\])*)\]\(<([^>]+\.md)>\)/g;
		const listed = [...(split < 0 ? text ?? '' : text!.slice(0, split)).matchAll(links)].filter(match => !match[2]!.includes('/'));
		const gone = new Set(split < 0 ? [] : [...text!.slice(split).matchAll(links)].filter(match => !match[2]!.includes('/')).map(match => fold(match[2]!)));
		const linkedFiles = new Set([...listed.map(match => fold(match[2]!)), ...gone]);
		const pages = new Map<string, ArchivedPage>();
		for (const file of inFolder) {
			if (!file.endsWith('.md') || file === path) continue;
			const full = `${notebookFolder}/${file}`;
			const fm = frontMatter((await sink.readText(full))?.slice(0, 6000) ?? '');
			const id = fm['onenote-id']?.toUpperCase();
			if (!id) continue;
			const name = file.slice(folder.length + 1);
			// Two files of one page id (the user copied a page in Obsidian): the one the contents page lists is the page.
			const other = pages.get(id);
			if (other && (linkedFiles.has(fold(other.file)) || !linkedFiles.has(fold(name)))) continue;
			const info = await sink.stat?.(full);
			pages.set(id, {
				id, title: fm.title ?? '', modified: fm.modified ?? null, order: number(fm['onenote-order']), level: number(fm['onenote-level']),
				file: name, ...(info ? { mtime: info.mtime } : {}),
			});
		}
		// Pages of the first list whose files are gone: the user deleted them; by id where the report has ids.
		const present = new Set(inFolder.map(file => fold(file.slice(folder.length + 1))));
		const missing = new Set(listed.filter(match => !present.has(fold(match[2]!))).map(match => fold(composedText(unescape(match[1]!)))));
		const heading = tocHeading(text);
		sections.push({ folder, status, ...(heading !== undefined ? { heading } : {}), pages, missing, gone });
		presentOf.set(folder, present);
	}
	// Each folder's report entry: by its path, else (moved by the user) by the page ids they share.
	const records = (recorded ?? []).filter(record => record.dir !== undefined && record.report);
	const taken = new Set<SectionResult>();
	for (const section of sections) {
		const record = records.find(candidate => !taken.has(candidate) && fold(candidate.dir!) === fold(`${notebookFolder}/${section.folder}`));
		if (record) {
			section.recorded = record;
			taken.add(record);
		}
	}
	for (const section of sections) {
		if (section.recorded) continue;
		let best: SectionResult | undefined, most = 0;
		for (const record of records) {
			if (taken.has(record)) continue;
			const shared = record.report!.pages.filter(page => typeof page.id === 'string' && section.pages.has(page.id.toUpperCase())).length;
			if (shared > most) [best, most] = [record, shared];
		}
		if (best) {
			section.recorded = best;
			taken.add(best);
		}
	}
	// Each page's fingerprint when it was written, from its section's report entry (§11.5 item 59).
	for (const section of sections) {
		for (const recorded of section.recorded?.report?.pages ?? []) {
			const page = typeof recorded.id === 'string' && typeof recorded.fingerprint === 'string' ? section.pages.get(recorded.id.toUpperCase()) : undefined;
			if (page) page.fingerprint = recorded.fingerprint;
		}
	}
	// Pages the report records for the folder whose files are gone (and not listed as no longer in OneNote): the user deleted them.
	for (const section of sections) {
		const withIds = section.recorded?.report?.pages.filter(page => typeof page.id === 'string');
		if (!withIds?.length) continue;
		const present = presentOf.get(section.folder)!;
		section.missingIds = new Set(withIds.filter(page => !present.has(fold(page.file)) && !section.gone.has(fold(page.file))).map(page => page.id!.toUpperCase()));
	}
	return { language, sections, files };
}
