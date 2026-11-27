// What a OneDrive download holds: notebooks, their section groups and sections. Works on a list
// of file paths, so a folder on disk and a zip are read the same way.

import { nameCollator, numberedName, safeName } from './names.ts';

/** A file in the download, its path relative to the download's root with `/` between folders. */
export interface DownloadFile {
	path: string;
	size: number;
	/** The download stopped inside this file: it is listed, but cannot be read. */
	incomplete?: boolean;
}

export interface DownloadSection {
	notebook: string;
	groups: string[];
	/** The section's name: its file name without `.one`. */
	label: string;
	/** Path of the `.one` file in the download. */
	path: string;
	size: number;
	/** The download stopped inside this section's file. */
	incomplete?: boolean;
}

export interface DownloadNotebook {
	name: string;
	/** Its name in OneNote, once it has been given another (see renameNotebook). */
	sourceName?: string;
	/** Path of the notebook's folder in the download ('' when the download is the notebook itself). */
	path: string;
	sections: DownloadSection[];
}

const RECYCLE_BIN = 'OneNote_RecycleBin';
/** What macOS adds when it zips a folder: resource forks and extended attributes, never notes. */
const MAC_EXTRAS = '__MACOSX';

interface Folder {
	name: string;
	path: string;
	files: DownloadFile[];
	folders: Map<string, Folder>;
}

function tree(files: DownloadFile[]): Folder {
	const root: Folder = { name: '', path: '', files: [], folders: new Map() };
	for (const file of files) {
		const parts = file.path.split('/').filter(Boolean);
		if (parts.includes(MAC_EXTRAS) || parts[parts.length - 1].startsWith('._')) continue;
		let folder = root;
		for (const part of parts.slice(0, -1)) {
			if (!folder.folders.has(part)) folder.folders.set(part, { name: part, path: folder.path ? `${folder.path}/${part}` : part, files: [], folders: new Map() });
			folder = folder.folders.get(part)!;
		}
		folder.files.push(file);
	}
	return root;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const isSection = (file: DownloadFile) => /\.one$/i.test(fileName(file.path));
const isNotebookFile = (file: DownloadFile) => /\.onetoc2$/i.test(fileName(file.path));
const visibleFolders = (folder: Folder) => [...folder.folders.values()]
	.filter(sub => sub.name !== RECYCLE_BIN && !sub.name.startsWith('.'))
	.sort((a, b) => nameCollator.compare(a.name, b.name));

/** A notebook's folder holds its table of contents (`.onetoc2`) or sections; a folder of notebooks holds neither. */
const isNotebook = (folder: Folder) => folder.files.some(file => isSection(file) || isNotebookFile(file));

function sectionsOf(folder: Folder, notebook: string, groups: string[], out: DownloadSection[]): void {
	// Sections first, then section groups, each by name (OneDrive downloads keep no order).
	const sections = folder.files.filter(isSection).sort((a, b) => nameCollator.compare(fileName(a.path), fileName(b.path)));
	for (const file of sections) {
		const section: DownloadSection = { notebook, groups, label: fileName(file.path).replace(/\.one$/i, ''), path: file.path, size: file.size };
		if (file.incomplete) section.incomplete = true;
		out.push(section);
	}
	for (const group of visibleFolders(folder)) sectionsOf(group, notebook, [...groups, group.name], out);
}

/**
 * The notebooks in a download. `rootName` names the download itself (the folder's name, or the
 * zip's name without `.zip`), for a download that is one notebook. Folders that are neither a
 * notebook nor hold one are looked into, so a zip of the Documents folder (one folder holding the
 * notebooks) gives the same notebooks as that folder.
 */
export function findNotebooks(files: DownloadFile[], rootName: string): DownloadNotebook[] {
	const notebooks: DownloadNotebook[] = [];
	const visit = (folder: Folder, name: string) => {
		if (isNotebook(folder)) {
			const sections: DownloadSection[] = [];
			sectionsOf(folder, name, [], sections);
			notebooks.push({ name, path: folder.path, sections });
			return;
		}
		for (const sub of visibleFolders(folder)) visit(sub, sub.name);
	};
	visit(tree(files), rootName);
	return distinctNames(notebooks);
}

/** A key for a folder of a notebook: its section groups, from the notebook's folder down. */
export const groupsKey = (groups: readonly string[]) => groups.join('\u0000');
/** Places after every place a table of contents can give. */
const UNLISTED = 1e9;
/** Names as tables of contents and file names are compared: composed, any case. */
const foldName = (name: string) => name.normalize('NFC').toLowerCase();

/**
 * The table of contents (`.onetoc2`) in each folder of a notebook that holds its sections: the
 * notebook's own and each section group's, by `groupsKey`. `files` is the download's file list.
 */
export function tableFiles(notebook: DownloadNotebook, files: DownloadFile[]): Map<string, string> {
	const folders = new Map<string, string>();
	const add = (groups: string[]) => folders.set([notebook.path, ...groups].filter(Boolean).join('/'), groupsKey(groups));
	add([]);
	for (const section of notebook.sections) for (let level = 1; level <= section.groups.length; level++) add(section.groups.slice(0, level));
	const tables = new Map<string, string>();
	for (const file of [...files].sort((a, b) => nameCollator.compare(a.path, b.path))) {
		const at = file.path.lastIndexOf('/');
		const key = folders.get(at < 0 ? '' : file.path.slice(0, at));
		if (key !== undefined && isNotebookFile(file) && !tables.has(key)) tables.set(key, file.path);
	}
	return tables;
}

/**
 * Puts a notebook's sections in the order OneNote shows them, as its tables of contents list them
 * (§11.5 item 76). `listed(groups)` gives the names the table of that folder lists, in order
 * (`<name>.one` for a section, the folder's name for a section group), or nothing when there is
 * none or it could not be read. At each level sections still come before section groups; what a
 * table does not list follows what it does, by name, as before.
 */
export function orderByTables(notebook: DownloadNotebook, listed: (groups: string[]) => string[] | undefined): void {
	// What each folder holds: its sections (`<name>.one`) and the groups right under it.
	const held = new Map<string, Set<string>>();
	const hold = (groups: string[], name: string) => {
		const key = groupsKey(groups);
		if (!held.has(key)) held.set(key, new Set());
		held.get(key)!.add(name);
	};
	for (const section of notebook.sections) {
		section.groups.forEach((group, level) => hold(section.groups.slice(0, level), group));
		hold(section.groups, `${section.label}.one`);
	}
	const ranks = new Map<string, Map<string, number>>();
	const rank = (groups: string[], name: string) => {
		const key = groupsKey(groups);
		if (!ranks.has(key)) ranks.set(key, placesInTable(listed(groups) ?? [], [...held.get(key) ?? []]));
		return ranks.get(key)!.get(name) ?? Infinity;
	};
	// What a table does not list goes after what it does, where it was (by name): the place of its
	// first section in the list as it stands.
	const first = new Map<string, number>();
	notebook.sections.forEach((section, index) => {
		for (let level = 1; level <= section.groups.length; level++) {
			const key = groupsKey(section.groups.slice(0, level));
			if (!first.has(key)) first.set(key, index);
		}
	});
	const place = (ranked: number, where: number) => (Number.isFinite(ranked) ? ranked : UNLISTED + where);
	// Each level: a section (0) or a group (1), then its place in that folder.
	const keyOf = (section: DownloadSection, index: number) => section.groups
		.flatMap((group, level) => [1, place(rank(section.groups.slice(0, level), group), first.get(groupsKey(section.groups.slice(0, level + 1)))!)])
		.concat([0, place(rank(section.groups, `${section.label}.one`), index)]);
	const keys = new Map(notebook.sections.map((section, index) => [section, keyOf(section, index)] as [DownloadSection, number[]]));
	const compare = (a: number[], b: number[]) => {
		for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
		return a.length - b.length;
	};
	notebook.sections = [...notebook.sections].sort((a, b) => compare(keys.get(a)!, keys.get(b)!));
}

/**
 * Where each of `names` (a folder's sections and groups) stands in its table of contents `listed`.
 * Tables write some characters as `^` and another one (a full-width colon as `^7`), so a listed
 * name is first looked for as it is, then with each `^` and the character after it standing for any
 * one character. A name the table does not list (renamed elsewhere, or added since) gets no place.
 */
function placesInTable(listed: string[], names: string[]): Map<string, number> {
	const places = new Map<string, number>();
	const free = new Set(names);
	const take = (index: number, matches: (name: string) => boolean) => {
		const name = [...free].find(matches);
		if (name === undefined) return false;
		places.set(name, index);
		free.delete(name);
		return true;
	};
	const left: number[] = [];
	listed.forEach((entry, index) => {
		if (!take(index, name => foldName(name) === foldName(entry))) left.push(index);
	});
	for (const index of left) {
		const entry = foldName(listed[index]!);
		if (!entry.includes('^')) continue;
		const pattern = new RegExp(`^${entry.split(/\^[\s\S]/u).map(part => part.replace(/[.*+?$()|[\]{}\\]/g, '\\$&')).join('.')}$`, 'u');
		take(index, name => pattern.test(foldName(name)));
	}
	return places;
}

/**
 * The folder a notebook name gets, as a key that two names share when they would get the same
 * folder: on a disk that ignores case, and in Obsidian, which composes every path (full NFC).
 */
export const folderKey = (name: string) => safeName(name, '\u0000', 120).normalize('NFC').toLowerCase();

/**
 * Two notebooks whose names give one output folder (one name in different folders of a download,
 * or in two downloads imported together, or names that differ only in what a file name cannot
 * hold) would share it: the later ones get " (2)" and so on, as pages of one name do. Renames in
 * place and answers the same list. `reserved` names no notebook may take (the folders an update
 * keeps its own files in): one called so gets " (2)" too.
 */
export function distinctNames(notebooks: DownloadNotebook[], reserved: readonly string[] = [], taken?: (notebook: DownloadNotebook) => readonly string[]): DownloadNotebook[] {
	const used = new Set<string>(reserved.map(folderKey));
	for (const notebook of notebooks) {
		// Names one notebook may not take (folders of other notebooks, §11.5 item 66), besides those every one may not.
		const theirs = new Set((taken?.(notebook) ?? []).map(folderKey));
		let name = notebook.name, n = 2;
		while (used.has(folderKey(name)) || theirs.has(folderKey(name))) name = numberedName(notebook.name, n++);
		used.add(folderKey(name));
		if (name !== notebook.name) renameNotebook(notebook, name);
	}
	return notebooks;
}

/** Gives a notebook another name (and so another output folder); its OneNote name is kept as `sourceName`. */
export function renameNotebook(notebook: DownloadNotebook, name: string): void {
	notebook.sourceName ??= notebook.name;
	notebook.name = name;
	for (const section of notebook.sections) section.notebook = name;
}
