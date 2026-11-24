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
// is ever touched: it is listed as gone.

import type { Sink } from './io.ts';
import { composedText, joinPath, numberedName, safeName } from './names.ts';
import { LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings } from './strings.ts';
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
 * any, is left as it is). occupied: the folder it would get holds what is not ours.
 */
export type PlanStatus = 'same' | 'changed' | 'new' | 'unfinished' | 'skipped' | 'gone' | 'error' | 'occupied';

export interface PagePlan {
	id: string;
	title: string;
	/** Its file in the section folder, when it has one. */
	file?: string;
	/** Its title before, when OneNote changed it. */
	from?: string;
	/** Edited in Obsidian since it was written: its file's time is not the page's any more. */
	userEdited?: true;
	/** Deleted in Obsidian since it was written: its section's contents page lists it, its file is gone. */
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
	removed: PagePlan[];
	modified: PagePlan[];
	/** Pages whose order or level changed, and nothing else. */
	reordered: PagePlan[];
	/** A page of the download is older than the one in the vault (an older download, say). */
	older?: true;
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

/** File times written as a page's last-modified time may be off by this much (FAT keeps two seconds). */
const EDIT_TOLERANCE = 2000;

/** Names as the disk and Obsidian tell them apart: composed in full, any case. */
const fold = (name: string) => name.normalize('NFC').toLowerCase();
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function edited(page: ArchivedPage): boolean {
	if (page.mtime === undefined || !page.modified) return false;
	const written = Date.parse(page.modified);
	return !isNaN(written) && Math.abs(page.mtime - written) > EDIT_TOLERANCE;
}

const plan = (page: ArchivedPage, extra: Partial<PagePlan> = {}): PagePlan =>
	({ id: page.id, title: page.title, file: page.file, ...(edited(page) ? { userEdited: true as const } : {}), ...extra });

/**
 * The plan for one notebook. `archive` is what readArchive found (undefined: nothing of ours there).
 * `skipped` holds the sectionKeys of sections left unticked when the notebook was imported.
 * `partial` means the download holds only some sections, so none is listed as gone.
 */
export function planNotebook(notebook: string, scanned: ScannedSection[], archive: Archive | undefined, strings: Strings, options: { partial?: boolean, skipped?: ReadonlySet<string> } = {}): NotebookPlan {
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
	for (const [i, section] of sections.entries()) for (const id of section.pages.keys()) if (!holder.has(id)) holder.set(id, i);
	const pairs: { s: number, a: number, n: number }[] = [];
	for (const [s, section] of scanned.entries()) {
		const votes = new Map<number, number>();
		for (const page of section.pages ?? []) {
			const a = holder.get(page.id);
			if (a !== undefined) votes.set(a, (votes.get(a) ?? 0) + 1);
		}
		for (const [a, n] of votes) pairs.push({ s, a, n });
	}
	pairs.sort((x, y) => y.n - x.n || x.s - y.s || x.a - y.a);
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

	// Where each matched section goes: it moves only when OneNote renamed it or moved it to another
	// group (not when only the import's numbering of like names differs), and only into a folder
	// that will be free: not one of ours that stays, not the user's.
	const used = new Set<string>();
	for (const [a, section] of sections.entries()) if (!taken.has(a)) used.add(fold(section.folder));
	const renamed = (section: ScannedSection, old: ArchivedSection) => {
		const fresh = freshOf(section);
		if (fold(old.folder) === fold(fresh)) return false;
		const sameName = old.heading !== undefined && fold(old.heading) === fold(composedText(section.label));
		return !(sameName && fold(parentOf(old.folder)) === fold(parentOf(fresh)));
	};
	const target = new Map<number, string>();
	for (const [s, a] of matchOf) {
		if (scanned[s]!.pages && renamed(scanned[s]!, sections[a]!)) continue;
		target.set(s, sections[a]!.folder);
		used.add(fold(sections[a]!.folder));
	}
	for (const [s, a] of [...matchOf].sort((x, y) => x[0] - y[0])) {
		if (target.has(s)) continue;
		const fresh = freshOf(scanned[s]!);
		const free = !used.has(fold(fresh)) && !foreign(fresh);
		target.set(s, free ? fresh : sections[a]!.folder);
		used.add(fold(target.get(s)!));
	}
	/** A folder for a new section: the import's name, or numbered when one of ours that stays has it. */
	const newFolder = (section: ScannedSection) => {
		const fresh = freshOf(section);
		let folder = fresh, n = 2;
		while (used.has(fold(folder))) folder = joinPath(parentOf(fresh), safeName(numberedName(section.label, n++), names.untitledPage, 120));
		return folder;
	};

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
			if (options.skipped?.has(sectionKey(section.groups, section.label))) items.push({ ...base, status: 'skipped', new: folder });
			else items.push({ ...base, status: 'new', new: folder, added: section.pages.map(page => ({ id: page.id, title: page.title })) });
			continue;
		}
		const item: PlanItem = { ...base, status: 'same', old: old.folder, new: target.get(s)!, added: [], removed: [], modified: [], reordered: [] };
		const ids = new Set(section.pages.map(page => page.id));
		for (const [i, page] of section.pages.entries()) {
			const before = old.pages.get(page.id);
			if (!before) {
				item.added.push({ id: page.id, title: page.title, ...(old.missing.has(fold(page.title)) ? { userDeleted: true as const } : {}) });
				continue;
			}
			const retitled = composedText(before.title) !== page.title;
			if (retitled || before.modified !== page.modified) {
				item.modified.push(plan(before, { title: page.title, ...(retitled ? { from: before.title } : {}) }));
				if (before.modified && page.modified && page.modified < before.modified) item.older = true;
			}
			else if (before.order !== i + 1 || before.level !== page.level) item.reordered.push(plan(before));
		}
		for (const page of old.pages.values()) if (!ids.has(page.id)) item.removed.push(plan(page));
		const changed = item.added.length || item.removed.length || item.modified.length || item.reordered.length || fold(item.old!) !== fold(item.new!);
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

/** Page info from the parser's JSON for one section, in order. */
export function scannedPages(json: { pages: { id: string, title?: string | null, updated?: number | null, level?: number | null }[] }): ScannedPage[] {
	return json.pages.map(page => ({
		id: page.id.toUpperCase(),
		title: composedText(page.title || ''),
		modified: page.updated ? new Date(page.updated * 1000).toISOString() : null,
		// As the adapter writes it (adapter.ts): the parser counts levels from 1.
		level: Math.max(0, (page.level ?? 1) - 1),
	}));
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
const unescape = (text: string) => text.replace(/\\(.)/g, '$1');

/**
 * What an earlier import wrote of a notebook in `notebookFolder` (a path from the output root), or
 * undefined when the folder is not one of ours (no contents page of ours in it).
 */
export async function readArchive(sink: Sink, notebookFolder: string): Promise<Archive | undefined> {
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
	for (const path of files.filter(file => file.endsWith(`/${toc}`)).sort()) {
		const folder = path.slice(0, -(toc.length + 1));
		if (folder.split('/').includes(strings.attachmentsFolder)) continue;
		const text = await sink.readText(`${notebookFolder}/${path}`);
		const status = importStatusOf(text);
		if (!status) continue;
		const inFolder = files.filter(file => parentOf(file) === folder);
		const pages = new Map<string, ArchivedPage>();
		for (const file of inFolder) {
			if (!file.endsWith('.md') || file === path) continue;
			const full = `${notebookFolder}/${file}`;
			const fm = frontMatter((await sink.readText(full))?.slice(0, 6000) ?? '');
			const id = fm['onenote-id']?.toUpperCase();
			if (!id) continue;
			const info = await sink.stat?.(full);
			pages.set(id, {
				id, title: fm.title ?? '', modified: fm.modified ?? null, order: number(fm['onenote-order']), level: number(fm['onenote-level']),
				file: file.slice(folder.length + 1), ...(info ? { mtime: info.mtime } : {}),
			});
		}
		// Pages the contents page lists whose files are gone: the user deleted them.
		const present = new Set(inFolder.map(file => fold(file.slice(folder.length + 1))));
		const missing = new Set<string>();
		for (const match of (text ?? '').matchAll(/\[((?:\\.|[^\]\\])*)\]\(<([^>]+\.md)>\)/g)) {
			if (!match[2]!.includes('/') && !present.has(fold(match[2]!))) missing.add(fold(composedText(unescape(match[1]!))));
		}
		const heading = tocHeading(text);
		sections.push({ folder, status, ...(heading !== undefined ? { heading } : {}), pages, missing });
	}
	return { language, sections, files };
}
