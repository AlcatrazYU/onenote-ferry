// What a OneDrive download holds: notebooks, their section groups and sections. Works on a list
// of file paths, so a folder on disk and a zip are read the same way.

import { nameCollator } from './names.ts';

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
	// Two notebooks of one name (in different folders of the download) would share an output
	// folder: the later ones get " (2)" and so on, as pages of one name do.
	const used = new Set<string>();
	for (const notebook of notebooks) {
		let name = notebook.name, n = 2;
		while (used.has(name.normalize('NFC').toLowerCase())) name = `${notebook.name} (${n++})`;
		used.add(name.normalize('NFC').toLowerCase());
		if (name !== notebook.name) {
			notebook.name = name;
			for (const section of notebook.sections) section.notebook = name;
		}
	}
	return notebooks;
}
