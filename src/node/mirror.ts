// The local copy of the user's OneDrive notebooks (§11.5 item 61.6, plan A): in the system's cache
// folder, outside any vault, one folder per notebook laid out as in the website's zip, so the
// import and the check for updates read it like any downloaded folder. Only files that changed in
// OneDrive are fetched again; what OneDrive no longer has leaves the copy. These are the plugin's
// own files, never the user's, so it may remove them.
//
//   <cache>/onenote-ferry/onedrive/<drive>/<notebook item ID>/
//     <notebook name>/          the notebook, as in the website's zip (what the import is given)
//     state.json                which version of each file the copy holds
//     .downloading/<file>.part  a file still arriving (resumed next time)
//     lock                      one window at a time

import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { ENCRYPTION_MARKER_WINDOW, isPasswordProtected } from '../core/encryption.ts';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { notebookFiles, planCopy } from '../core/onedrive.ts';
import type { CopyPlan, GraphGet, LocalFile, RemoteFile, RemoteNotebook } from '../core/onedrive.ts';
import { downloadFile, DownloadError, removePart } from './fetch-download.ts';
import type { DownloadProblem, FileLink } from './fetch-download.ts';

/** The system's folder for caches: where the copy goes unless the user chose another place. */
export function systemCacheFolder(env: Record<string, string | undefined> = process.env, platform = process.platform, home = homedir()): string {
	if (platform === 'darwin') return join(home, 'Library', 'Caches');
	if (platform === 'win32') return env.LOCALAPPDATA || join(home, 'AppData', 'Local');
	return env.XDG_CACHE_HOME || join(home, '.cache');
}

/** The copy's folder for one account (its drive), under a cache folder. */
export function copyRoot(cacheFolder: string, driveId: string): string {
	return join(cacheFolder, 'onenote-ferry', 'onedrive', safeId(driveId));
}

/** An ID as a file name: OneDrive IDs are letters, digits and `!`; anything else becomes `_`. */
export const safeId = (id: string) => id.replace(/[^A-Za-z0-9!._-]/g, '_').slice(0, 120) || '_';

/** A path inside the notebook as OneDrive gave it, or undefined when it could step outside. */
function safeRelative(path: string): string | undefined {
	const parts = path.split('/');
	if (!path || parts.some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) return undefined;
	return path;
}

/** Where a notebook's files are in the account's copy folder (`<item ID>/<name>`), with `/` between folders. */
export function notebookPath(notebook: RemoteNotebook): string {
	return `${safeId(notebook.id)}/${notebookFolderName(notebook.name)}`;
}

/** A section file in the copy is password protected (read from its first bytes, as for a download). */
export async function isLockedFile(path: string): Promise<boolean> {
	const handle = await open(path, 'r');
	try {
		const { size } = await handle.stat();
		const bytes = new Uint8Array(Math.min(size, ENCRYPTION_MARKER_WINDOW));
		await handle.read(bytes, 0, bytes.length, 0);
		return isPasswordProtected(bytes);
	}
	finally {
		await handle.close();
	}
}

/** The notebook's folder name: its name, unless that cannot be a folder name. */
export function notebookFolderName(name: string): string {
	const clean = name.replace(/[/\\\0]/g, '_').trim();
	return clean && clean !== '.' && clean !== '..' ? clean : '_';
}

export interface CopyState {
	notebookId: string;
	/** The notebook's name when the copy was last brought up to date. */
	name: string;
	/** By OneDrive item ID. */
	files: Record<string, LocalFile>;
	/** When it was last brought up to date (ISO). */
	synced?: string;
}

async function readState(dir: string, notebook: RemoteNotebook): Promise<CopyState> {
	try {
		const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as CopyState;
		if (state && state.notebookId === notebook.id && typeof state.name === 'string' && state.files && typeof state.files === 'object') {
			// A record read back is not trusted further than it can go: paths stay inside the copy.
			const files: Record<string, LocalFile> = {};
			for (const [id, file] of Object.entries(state.files)) {
				const path = typeof file?.path === 'string' ? safeRelative(file.path) : undefined;
				if (path && typeof file.size === 'number' && typeof file.eTag === 'string') files[id] = { path, size: file.size, eTag: file.eTag };
			}
			return { ...state, files };
		}
	}
	catch {
		// No record yet, or one that cannot be read: the copy is checked file by file.
	}
	return { notebookId: notebook.id, name: notebook.name, files: {} };
}

/** Written to a temporary file, then put in place, so a crash leaves the old record or the new one. */
async function writeState(dir: string, state: CopyState): Promise<void> {
	const temporary = join(dir, `state.json.${process.pid}.tmp`);
	await writeFile(temporary, JSON.stringify(state, null, '\t'));
	await rename(temporary, join(dir, 'state.json'));
}

/** A lock older than this was left by a window that is gone. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export class CopyBusy extends Error {
	constructor() {
		super('another window is updating this notebook\'s copy');
		this.name = 'CopyBusy';
	}
}

/** The locks this process holds now. */
const heldHere = new Set<string>();

/**
 * Whether a copy's lock is held by a window that is still updating it: not when it is older than
 * STALE_LOCK_MS, nor when the process it names is gone (Obsidian quit or crashed during a download)
 * or is this one but holds no such lock now (§11.5 item 79).
 */
async function lockHeld(path: string): Promise<boolean> {
	const age = Date.now() - ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0);
	if (!(age < STALE_LOCK_MS)) return false;
	let pid: unknown;
	try {
		pid = (JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown }).pid;
	}
	catch {
		return true;
	}
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return true;
	if (pid === process.pid) return heldHere.has(path);
	try {
		process.kill(pid, 0);
		return true;
	}
	catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ESRCH';
	}
}

async function lock(dir: string): Promise<() => Promise<void>> {
	const path = join(dir, 'lock');
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await open(path, 'wx');
			await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
			await handle.close();
			heldHere.add(path);
			// Kept fresh while the copy is updated, so a long download does not look abandoned.
			const touch = setInterval(() => void writeFile(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })).catch(() => undefined), STALE_LOCK_MS / 4);
			return async () => {
				clearInterval(touch);
				heldHere.delete(path);
				await rm(path, { force: true });
			};
		}
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			if (await lockHeld(path)) throw new CopyBusy();
			await rm(path, { force: true });
		}
	}
	throw new CopyBusy();
}

export class NoSpace extends Error {
	readonly needed: number;
	readonly free: number;
	constructor(needed: number, free: number) {
		super(`not enough disk space: ${needed} bytes needed, ${free} free`);
		this.name = 'NoSpace';
		this.needed = needed;
		this.free = free;
	}
}

/** Space left on the disk that holds `dir` (undefined when the system does not say). */
export function freeSpace(dir: string): number | undefined {
	try {
		const fs = statfsSync(dir);
		return Number(fs.bavail) * Number(fs.bsize);
	}
	catch {
		return undefined;
	}
}

/** Kept free besides what a download needs. */
const SPARE_BYTES = 1024 ** 3;

export interface CopyProgress {
	/** Files fetched so far, and to fetch. */
	files: number;
	totalFiles: number;
	/**
	 * Sections (.one files) of those the copy is brought up to date for, in place so far (already as
	 * in OneDrive, or fetched now), and in all: what people count. Tables of contents are not counted.
	 */
	sections: number;
	totalSections: number;
	bytes: number;
	totalBytes: number;
	/** The section arriving now (its path in the notebook). */
	current?: string;
}

const isSectionFile = (path: string) => /\.one$/i.test(path);

export interface UpdateCopyOptions {
	graph: GraphGet;
	fetch: typeof globalThis.fetch;
	/** The account's copy folder (copyRoot). */
	root: string;
	notebook: RemoteNotebook;
	/** A fresh download link for a file, and its current version. */
	link(fileId: string): Promise<FileLink>;
	signal?: AbortSignal;
	onProgress?(progress: CopyProgress): void;
	/** Files fetched at the same time (3: small files are mostly waiting for answers). */
	concurrency?: number;
	/** The notebook's files, when they were just listed (otherwise listed here). */
	files?: RemoteFile[];
	/** Fetch only these files (by OneDrive item ID): the sections chosen for an import. Others stay as they are. */
	only?: ReadonlySet<string>;
	/** For tests: how long a download may go without a byte, and how to wait. */
	idleMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** The system's word that the network is back (see DownloadFileOptions.whenOnline). */
	whenOnline?: (callback: () => void) => () => void;
	free?(dir: string): number | undefined;
}

export interface CopyResult {
	/** The notebook's folder: what the import is given. */
	folder: string;
	downloaded: number;
	bytes: number;
	moved: number;
	removed: number;
	same: number;
	/** Files that could not be fetched (the rest of the copy is up to date). */
	failed: { path: string, problem: DownloadProblem, detail: string }[];
	plan: CopyPlan;
}

/** Brings the local copy of one notebook up to date with OneDrive. */
export async function updateCopy(options: UpdateCopyOptions): Promise<CopyResult> {
	const { notebook, signal } = options;
	const dir = join(options.root, safeId(notebook.id));
	await mkdir(dir, { recursive: true });
	const unlock = await lock(dir);
	try {
		// Files left half-moved by a run that was cut off (Obsidian quit between the two steps of a
		// move): the record still has them at their old place, so they are fetched again; these go.
		await rm(join(dir, '.moving'), { recursive: true, force: true });
		const state = await readState(dir, notebook);
		const name = notebookFolderName(notebook.name);
		// Renamed in OneDrive: the copy's folder follows, so nothing is fetched again for it.
		const previous = notebookFolderName(state.name);
		if (previous !== name && existsSync(join(dir, previous))) {
			if (existsSync(join(dir, name))) await rm(join(dir, name), { recursive: true, force: true });
			await rename(join(dir, previous), join(dir, name));
		}
		state.name = notebook.name;
		const folder = join(dir, name);
		await mkdir(folder, { recursive: true });

		const remote = (options.files ?? await notebookFiles(options.graph, notebook.id)).filter(file => safeRelative(file.path));
		const present = (path: string) => {
			try {
				const info = statSync(join(folder, path));
				return info.isFile() ? info.size : undefined;
			}
			catch {
				return undefined;
			}
		};
		const plan = planCopy(remote, state.files, present);
		if (options.only) plan.download = plan.download.filter(file => options.only!.has(file.id));
		const totalBytes = plan.download.reduce((sum, file) => sum + file.size, 0);
		const free = (options.free ?? freeSpace)(dir);
		if (free !== undefined && totalBytes + SPARE_BYTES > free) throw new NoSpace(totalBytes + SPARE_BYTES, free);

		const result: CopyResult = { folder, downloaded: 0, bytes: 0, moved: 0, removed: 0, same: plan.same.length, failed: [], plan };
		const forget = (path: string) => {
			for (const [id, file] of Object.entries(state.files)) if (file.path === path) delete state.files[id];
		};
		for (const path of plan.remove) {
			await rm(join(folder, path), { force: true });
			forget(path);
			result.removed++;
		}
		// In two steps, so two files that swap places do not overwrite each other.
		const moving = join(dir, '.moving');
		for (const move of plan.move) {
			await mkdir(moving, { recursive: true });
			await rename(join(folder, move.from), join(moving, safeId(move.to.id)));
		}
		for (const move of plan.move) {
			await mkdir(dirname(join(folder, move.to.path)), { recursive: true });
			await rename(join(moving, safeId(move.to.id)), join(folder, move.to.path));
			state.files[move.to.id] = { path: move.to.path, size: move.to.size, eTag: move.to.eTag };
			result.moved++;
		}
		for (const file of plan.same) state.files[file.id] = { path: file.path, size: file.size, eTag: file.eTag };
		// Records of files OneDrive no longer has go, whether or not the copy still had them.
		const ids = new Set(remote.map(file => file.id));
		for (const id of Object.keys(state.files)) if (!ids.has(id)) delete state.files[id];
		await writeState(dir, state);

		const parts = join(dir, '.downloading');
		await mkdir(parts, { recursive: true });
		const sectionsWanted = remote.filter(file => isSectionFile(file.path) && (!options.only || options.only.has(file.id))).length;
		const sectionsFetched = plan.download.filter(file => isSectionFile(file.path)).length;
		const progress: CopyProgress = { files: 0, totalFiles: plan.download.length, sections: sectionsWanted - sectionsFetched, totalSections: sectionsWanted, bytes: 0, totalBytes };
		// Bytes of the files arriving now, by ID.
		const arriving = new Map<string, number>();
		const report = () => options.onProgress?.({ ...progress, bytes: progress.bytes + [...arriving.values()].reduce((a, b) => a + b, 0) });
		// One record write at a time: files finish in any order.
		let saving = Promise.resolve();
		const save = () => saving = saving.then(() => writeState(dir, state));
		let next = 0;
		const worker = async () => {
			while (next < plan.download.length && !signal?.aborted) {
				const file = plan.download[next++];
				const part = join(parts, `${safeId(file.id)}.part`);
				if (isSectionFile(file.path)) progress.current = file.path;
				arriving.set(file.id, 0);
				report();
				try {
					const done = await downloadFile({
						fetch: options.fetch,
						link: () => options.link(file.id),
						part,
						signal,
						idleMs: options.idleMs,
						sleep: options.sleep,
						...(options.whenOnline ? { whenOnline: options.whenOnline } : {}),
						onProgress: bytes => {
							arriving.set(file.id, bytes);
							report();
						},
					});
					const target = join(folder, file.path);
					await mkdir(dirname(target), { recursive: true });
					await rename(part, target);
					await rm(`${part}.json`, { force: true });
					// The version that arrived (it may be newer than the listing's, when the file changed meanwhile).
					state.files[file.id] = { path: file.path, size: done.size, eTag: done.eTag };
					await save();
					result.downloaded++;
					result.bytes += done.size;
				}
				catch (error) {
					if (error instanceof DownloadError && error.problem === 'cancelled') break;
					const problem: DownloadProblem = error instanceof DownloadError ? error.problem : 'failed';
					result.failed.push({ path: file.path, problem, detail: String((error as Error)?.message ?? error).slice(0, 300) });
					// What arrived of it stays for the next time; the copy's old version, if any, stays too.
				}
				arriving.delete(file.id);
				progress.files++;
				if (isSectionFile(file.path)) progress.sections++;
				progress.bytes += file.size;
				report();
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, plan.download.length)) }, worker));
		await saving;
		progress.current = undefined;
		report();
		if (signal?.aborted) throw new DownloadError('cancelled');
		// Parts of files OneDrive no longer has (deleted since an earlier, cut-off update). Those of files
		// it still has stay, whether or not they were asked for now: an import of some sections does not
		// throw away what a cut-off check had downloaded of another.
		const wanted = new Set(remote.map(file => `${safeId(file.id)}.part`));
		for (const entry of await readdir(parts).catch(() => [] as string[])) {
			const base = entry.replace(/\.json$/, '');
			if (!wanted.has(base)) await removePart(join(parts, base));
		}
		state.synced = new Date().toISOString();
		await writeState(dir, state);
		return result;
	}
	finally {
		await unlock();
	}
}

/** The folder holding every account's copy, under a cache folder (what the settings page shows). */
export function copiesFolder(cacheFolder: string): string {
	return join(cacheFolder, 'onenote-ferry', 'onedrive');
}

/** Every notebook copy of every account under `copiesFolder`, with its size. */
export function allCopies(folder: string): { dir: string, name: string, bytes: number }[] {
	if (!existsSync(folder)) return [];
	return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => copiedNotebooks(join(folder, entry.name)));
}

/**
 * Removes notebook copies (the user confirmed it on the settings page): the plugin's own files, the
 * vault is not touched. A copy being updated by a window now (its lock is fresh) is left. Answers
 * how many were removed and left.
 */
export async function removeCopies(dirs: string[]): Promise<{ removed: number, busy: number }> {
	let removed = 0, busy = 0;
	for (const dir of dirs) {
		if (await lockHeld(join(dir, 'lock'))) {
			busy++;
			continue;
		}
		await rm(dir, { recursive: true, force: true });
		removed++;
	}
	return { removed, busy };
}

/** The notebook copies under an account's folder (for the settings page: what is kept, and how large). */
export function copiedNotebooks(root: string): { dir: string, name: string, bytes: number }[] {
	if (!existsSync(root)) return [];
	const out: { dir: string, name: string, bytes: number }[] = [];
	const size = (path: string): number => {
		const info = statSync(path);
		if (!info.isDirectory()) return info.size;
		let total = 0;
		for (const entry of readdirSync(path)) total += size(join(path, entry));
		return total;
	};
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(root, entry.name);
		let name = entry.name;
		try {
			name = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).name ?? name;
		}
		catch {
			// No record: shown by its folder name.
		}
		out.push({ dir, name, bytes: size(dir) });
	}
	return out;
}
