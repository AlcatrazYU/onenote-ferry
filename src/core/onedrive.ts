// The user's OneDrive as the plugin sees it (§11.5 items 61 to 63): which notebooks there are,
// which files each holds, and what a local copy has to do to match it. Microsoft Graph is asked
// through a function the caller hands in (Obsidian's requestUrl in the plugin), so this file only
// decides what to ask and what the answers mean.
//
// A notebook in OneDrive is a "package" of type oneNote: a folder holding one .one file per
// section, a table of contents (.onetoc2), a folder per section group, and OneNote_RecycleBin.
// Notebooks are found in two steps (Internal-10 §14.1): the Documents folder, where OneNote puts
// new notebooks, and a search for table-of-contents files, which finds notebooks anywhere else.
// Walking the whole drive (delta) took 34 minutes on a drive of 400,000 items.

/** A driveItem with the fields asked for (`ITEM_FIELDS`). */
export interface DriveItem {
	id: string;
	name: string;
	size?: number;
	eTag?: string;
	cTag?: string;
	lastModifiedDateTime?: string;
	folder?: { childCount?: number };
	file?: object;
	package?: { type?: string };
	deleted?: object;
	parentReference?: { id?: string, driveId?: string, path?: string };
}

export const ITEM_FIELDS = 'id,name,size,eTag,cTag,lastModifiedDateTime,folder,file,package,deleted,parentReference';

/**
 * Answers a Graph request: a path under `https://graph.microsoft.com/v1.0` (`/me/drive/...`) or a
 * full `@odata.nextLink`. Throws GraphError for an error answer.
 */
export type GraphGet = (pathOrUrl: string) => Promise<any>;

export class GraphError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code = '', message = '') {
		super(`${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`);
		this.name = 'GraphError';
		this.status = status;
		this.code = code;
	}
}

/** Every item of a listing, following its next links. */
export async function listAll(graph: GraphGet, path: string): Promise<DriveItem[]> {
	const items: DriveItem[] = [];
	let next: string | undefined = path;
	// A guard against a listing that never ends (a next link pointing back).
	for (let pages = 0; next && pages < 10_000; pages++) {
		const answer: { value?: DriveItem[], '@odata.nextLink'?: string } = await graph(next);
		items.push(...(answer.value ?? []));
		next = answer['@odata.nextLink'];
	}
	return items;
}

export const isNotebookPackage = (item: DriveItem) => item.package?.type?.toLowerCase() === 'onenote' && !item.deleted;
const RECYCLE_BIN = 'OneNote_RecycleBin';

/** A notebook in the user's OneDrive. */
export interface RemoteNotebook {
	/** The notebook's OneDrive item ID: it stays the same when the notebook is renamed or moved. */
	id: string;
	name: string;
	/** The folder it is in, as the user sees it in OneDrive (`学习/文档`); '' for the top. */
	folder: string;
	eTag?: string;
	modified?: string;
}

/** The folder path in a parentReference (`/drive/root:/a/b`), as people read it (`a/b`). */
export function folderPath(parent: DriveItem['parentReference']): string {
	const path = parent?.path;
	if (!path) return '';
	const at = path.indexOf(':');
	const rest = at < 0 ? '' : path.slice(at + 1).replace(/^\/+/, '');
	try {
		return decodeURIComponent(rest);
	}
	catch {
		return rest;
	}
}

function notebookOf(item: DriveItem): RemoteNotebook {
	return { id: item.id, name: item.name, folder: folderPath(item.parentReference), eTag: item.eTag, modified: item.lastModifiedDateTime };
}

/**
 * The user's notebooks: those in the Documents folder and those a search for table-of-contents
 * files finds elsewhere. A notebook is listed once, whichever way it was found.
 */
export async function findRemoteNotebooks(graph: GraphGet): Promise<RemoteNotebook[]> {
	const found = new Map<string, RemoteNotebook>();
	try {
		for (const item of await listAll(graph, `/me/drive/special/documents/children?$select=${ITEM_FIELDS}&$top=1000`)) {
			if (isNotebookPackage(item)) found.set(item.id, notebookOf(item));
		}
	}
	catch (error) {
		// A drive without a Documents folder: the search still finds its notebooks.
		if (!(error instanceof GraphError && error.status === 404)) throw error;
	}
	const hits = (await listAll(graph, `/me/drive/root/search(q='onetoc2')?$select=id,name,parentReference,file,deleted&$top=1000`))
		.filter(item => /\.onetoc2$/i.test(item.name) && !item.deleted);
	// Each hit's folder is a notebook, one of its section groups, or a recycle bin. Most are inside a
	// notebook found already, which the hit's own path tells without asking (each question is a
	// request); the others are walked up to their notebook, a few at a time.
	const placeOf = (item: DriveItem) => folderPath(item.parentReference).normalize('NFC').toLowerCase();
	const knownPlaces = () => [...found.values()].map(notebook => `${notebook.folder ? `${notebook.folder}/` : ''}${notebook.name}`.normalize('NFC').toLowerCase());
	const inKnown = (hit: DriveItem) => {
		if (!hit.parentReference?.path) return false;
		const place = placeOf(hit);
		return knownPlaces().some(known => place === known || place.startsWith(`${known}/`));
	};
	const seen = new Map<string, DriveItem | null>();
	const item = async (id: string): Promise<DriveItem | null> => {
		if (!seen.has(id)) {
			try {
				seen.set(id, await graph(`/me/drive/items/${encodeURIComponent(id)}?$select=${ITEM_FIELDS}`));
			}
			catch (error) {
				if (!(error instanceof GraphError && error.status === 404)) throw error;
				seen.set(id, null);
			}
		}
		return seen.get(id)!;
	};
	const unknown = hits.filter(hit => !inKnown(hit));
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(6, unknown.length) }, async () => {
		while (next < unknown.length) {
			const hit = unknown[next++]!;
			// Found meanwhile through another hit of the same notebook.
			if (inKnown(hit)) continue;
			let id = hit.parentReference?.id;
			// Section groups nest; a notebook is never this deep in practice.
			for (let depth = 0; id && depth < 12; depth++) {
				if (found.has(id)) break;
				const folder = await item(id);
				if (!folder || folder.deleted) break;
				if (isNotebookPackage(folder)) {
					found.set(folder.id, notebookOf(folder));
					break;
				}
				id = folder.parentReference?.id;
			}
		}
	}));
	return [...found.values()];
}

/** The notebooks directly in one folder the user chose (or the folder itself, when it is one). */
export async function notebooksInFolder(graph: GraphGet, folderId: string): Promise<RemoteNotebook[]> {
	const folder: DriveItem = await graph(`/me/drive/items/${encodeURIComponent(folderId)}?$select=${ITEM_FIELDS}`);
	if (isNotebookPackage(folder)) return [notebookOf(folder)];
	return (await listAll(graph, `/me/drive/items/${encodeURIComponent(folderId)}/children?$select=${ITEM_FIELDS}&$top=1000`))
		.filter(isNotebookPackage).map(notebookOf);
}

/** What a folder holds (the top when no ID is given), for looking through the drive: its folders, and its notebooks. */
export async function folderChildren(graph: GraphGet, folderId?: string): Promise<{ folders: { id: string, name: string }[], notebooks: RemoteNotebook[] }> {
	const path = folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : '/me/drive/root/children';
	const items = (await listAll(graph, `${path}?$select=${ITEM_FIELDS}&$top=1000`)).filter(item => !item.deleted);
	return {
		folders: items.filter(item => item.folder && !isNotebookPackage(item)).map(item => ({ id: item.id, name: item.name })),
		notebooks: items.filter(isNotebookPackage).map(notebookOf),
	};
}

/** A file of a notebook in OneDrive, with its path inside the notebook (`New Group/API ink.one`). */
export interface RemoteFile {
	id: string;
	path: string;
	size: number;
	eTag: string;
	modified?: string;
}

/**
 * The files a local copy of a notebook needs: sections and tables of contents, in the notebook
 * and its section groups. The recycle bin and anything else are left out (conversion skips them).
 */
export async function notebookFiles(graph: GraphGet, notebookId: string): Promise<RemoteFile[]> {
	const out: RemoteFile[] = [];
	const visit = async (id: string, prefix: string, depth: number) => {
		for (const item of await listAll(graph, `/me/drive/items/${encodeURIComponent(id)}/children?$select=${ITEM_FIELDS}&$top=1000`)) {
			if (item.deleted || item.name.startsWith('.') && !/\.onetoc2$/i.test(item.name)) continue;
			const path = prefix ? `${prefix}/${item.name}` : item.name;
			if (item.folder) {
				if (item.name !== RECYCLE_BIN && depth < 12) await visit(item.id, path, depth + 1);
			}
			else if (/\.(one|onetoc2)$/i.test(item.name) && item.eTag) {
				out.push({ id: item.id, path, size: item.size ?? 0, eTag: item.eTag, modified: item.lastModifiedDateTime });
			}
		}
	};
	await visit(notebookId, '', 0);
	return out;
}

/** What the local copy of a notebook holds, as its state file records it. */
export interface LocalFile {
	path: string;
	size: number;
	eTag: string;
}

/** What to do so the local copy matches OneDrive. */
export interface CopyPlan {
	/** Files to fetch: new, changed, or missing or damaged in the copy. */
	download: RemoteFile[];
	/** Files OneDrive only renamed or moved (same version): moved in the copy, not fetched again. */
	move: { from: string, to: RemoteFile }[];
	/** Paths in the copy that OneDrive no longer has (deleted, or moved into the recycle bin). */
	remove: string[];
	/** Files already as in OneDrive. */
	same: RemoteFile[];
}

/**
 * Compares OneDrive with the copy. `state` is the copy's record (by OneDrive item ID); `present`
 * tells the size of a file actually in the copy (undefined when it is not there), so a file
 * deleted or cut short in the copy is fetched again whatever the record says.
 */
export function planCopy(remote: RemoteFile[], state: Record<string, LocalFile>, present: (path: string) => number | undefined): CopyPlan {
	const plan: CopyPlan = { download: [], move: [], remove: [], same: [] };
	const key = (path: string) => path.normalize('NFC').toLowerCase();
	const final = new Set(remote.map(file => key(file.path)));
	for (const file of remote) {
		const local = state[file.id];
		const intact = (path: string) => present(path) === file.size;
		if (local && local.eTag === file.eTag && local.size === file.size) {
			if (local.path === file.path && intact(file.path)) {
				plan.same.push(file);
				continue;
			}
			// Renamed or moved in OneDrive only: the copy's file goes along (unless another file takes its old place).
			if (local.path !== file.path && intact(local.path) && !final.has(key(local.path))) {
				plan.move.push({ from: local.path, to: file });
				continue;
			}
		}
		plan.download.push(file);
	}
	// Whatever the record has at a path OneDrive no longer uses goes: deleted sections, and the old
	// place of a section renamed or moved in OneDrive and changed too (fetched to its new place).
	const movedFrom = new Set(plan.move.map(move => key(move.from)));
	const removed = new Set<string>();
	for (const local of Object.values(state)) {
		const at = key(local.path);
		if (final.has(at) || movedFrom.has(at) || removed.has(at)) continue;
		if (present(local.path) !== undefined) {
			plan.remove.push(local.path);
			removed.add(at);
		}
	}
	return plan;
}
