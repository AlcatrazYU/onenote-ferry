// One import from start to end: the downloads chosen, their notebooks and sections and which of
// them are chosen, the settings, and then the import itself. The import window shows it and
// changes it; the import goes on when the window is closed.
//
// A notebook an earlier import wrote into the target folder is updated (§11.5 item 49): its
// sections are read again (page ids, titles and times only) and compared with what is in the
// vault, and each section says what changed. New notebooks are imported as before; when both are
// chosen, the new ones are imported first and the others updated after.

import type { App } from 'obsidian';
import { distinctNames, findNotebooks, renameNotebook } from '../core/download.ts';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import { earlierNotebook, sectionKey } from '../core/importer.ts';
import type { EarlierNotebook, ImportProgress, SectionOptions } from '../core/importer.ts';
import { reportedNotebooks } from '../core/report.ts';
import type { ReportNotebook } from '../core/report.ts';
import { LANGUAGES, STRINGS } from '../core/strings.ts';
import type { Language, Strings } from '../core/strings.ts';
import { planNotebook, readArchive } from '../core/sync.ts';
import type { Archive, NotebookPlan, PagePlan, PlanItem, ScannedPage, ScannedSection } from '../core/sync.ts';
import { recordedPlanOptions } from '../core/update.ts';
import type { UpdateResult } from '../core/update.ts';
import { nameCollator } from '../core/names.ts';
import type { RemoteFile, RemoteNotebook } from '../core/onedrive.ts';
import { notebookFolder } from '../core/write.ts';
import type { IncompleteZip } from '../node/download.ts';
import { isLockedFile, notebookPath } from '../node/mirror.ts';
import type { CopyProgress, CopyResult } from '../node/mirror.ts';
import { AlreadyThereError, downloadName, runImport } from './run-import.ts';
import type { ImportOutcome } from './run-import.ts';
import { finishCutOff, runUpdate } from './run-update.ts';
import { folderProblem } from './settings.ts';
import { VaultSink } from './vault-sink.ts';
import { ConverterStopped } from './worker-client.ts';
import type { WorkerClient } from './worker-client.ts';

/** What the session needs of the signed-in OneDrive account (the plugin gives it; §11.5 items 61 to 63, Internal-10 §22). */
export interface OneDriveAccess {
	/** The account's local copy folder: what the import reads, laid out as a download. */
	root(): Promise<string>;
	/** The user's notebooks (Documents, and found elsewhere by search). */
	notebooks(): Promise<RemoteNotebook[]>;
	/** A notebook's sections and tables of contents. */
	files(notebookId: string): Promise<RemoteFile[]>;
	/** The list of notebooks kept from the last time, to show at once while OneDrive is asked again (none the first time). */
	kept?(): Promise<{ root: string, notebooks: KeptNotebook[] } | undefined>;
	/** Keeps the list for next time. */
	keep?(root: string, notebooks: KeptNotebook[]): Promise<void>;
	/** Brings the local copy of a notebook up to date (only the files in `only`, when given). */
	copy(notebook: RemoteNotebook, files: RemoteFile[], only: ReadonlySet<string> | undefined, signal: AbortSignal, onProgress: (progress: CopyProgress) => void): Promise<CopyResult>;
}

/** A notebook as kept in the list for next time: `extra` when the user added it from another folder. */
export interface KeptNotebook {
	notebook: RemoteNotebook;
	files: RemoteFile[];
	extra?: boolean;
}

/** A OneDrive source: its notebooks are listed from OneDrive, and downloaded into the local copy only when needed. */
export interface OneDriveSource {
	access: OneDriveAccess;
	/** Each notebook's OneDrive item, files and place in the tree, by its folder's path in the copy (`<ID>/<name>`). */
	notebooks: Map<string, KeptNotebook & { listed?: DownloadNotebook }>;
	/** Notebooks whose copy was brought up to date in this window (by OneDrive item ID). */
	refreshed: Set<string>;
	/** Sections that could not be downloaded, by path in the copy, with why. */
	failed: Map<string, string>;
	/** Stops its listing and downloads (removed, window closed, import stopped). */
	controller: AbortController;
	/** While its notebooks are listed: how many are, of how many (unknown while they are being found). */
	reading?: { done: number, total?: number };
	/** The list kept from last time is shown, and OneDrive is being asked what changed since. */
	refreshing?: boolean;
}

/**
 * The files of a OneDrive notebook to download for an import of some of its sections: those
 * sections, and every table of contents (the notebook's and its groups'), by OneDrive item ID.
 * `notebookPath` is the notebook's folder in the copy; sections are given by their paths there.
 */
export function filesToFetch(notebookPath: string, files: RemoteFile[], sectionPaths: string[]): Set<string> {
	const wanted = new Set(sectionPaths);
	return new Set(files.filter(file => /\.onetoc2$/i.test(file.path) || wanted.has(`${notebookPath}/${file.path}`)).map(file => file.id));
}

/** Runs `work` on each item, `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) await work(items[next++]!);
	}));
}

export interface ChosenDownload {
	/** A zip or a folder; for OneDrive, the account's local copy folder. */
	input: string;
	name: string;
	state: 'reading' | 'ready' | 'failed';
	notebooks: DownloadNotebook[];
	incomplete?: IncompleteZip;
	error?: string;
	/** It could not be read because the converter stopped (not because of the download). */
	stopped?: boolean;
	/** Paths of its password-protected sections, once looked for. */
	locked?: Set<string>;
	/** The user's OneDrive, read through the Microsoft account. */
	onedrive?: OneDriveSource;
}

export interface NotebookChoice {
	download: ChosenDownload;
	notebook: DownloadNotebook;
	/** Its name in OneNote (the notebook's name gets " (2)" when another chosen notebook has it too). */
	originalName: string;
	/**
	 * What the user ticked and unticked, by the section's path in the download. Every other section
	 * has its default (see defaultTick), so what the user picked survives a change of target folder.
	 */
	ticks: Map<string, boolean>;
	/** Pages the user deleted in Obsidian that are to come back (page ids), by the section's path (§11.5 item 51.2). */
	restore: Map<string, Set<string>>;
	/** What an earlier import wrote of it in the target folder, if anything: it is updated. */
	earlier?: EarlierNotebook;
	/** That folder, under the target folder (with `earlier`). */
	dir?: string;
	/** What an update would do, once each of its sections has been read (with `earlier`). */
	plan?: NotebookPlan;
	/** A folder of its name is in the target folder, but not a notebook of ours: it cannot go there. */
	blocked?: boolean;
	/** That folder is spelled otherwise (another case): it is the same folder on disk, but not this name in the vault. */
	otherSpelling?: boolean;
}

/**
 * Where a section stands. A notebook not imported before: free (can be chosen), locked (password
 * protected), incomplete (cut off in the download), blocked (its notebook's folder holds what is not
 * ours). A notebook imported before, compared with the vault: checking (being read), different
 * (the vault's notebook of that name is another one), duplicate (another download chosen has a newer
 * copy of the same notebook: that one updates it), same, restorable (only pages the user deleted
 * differ), changed, older (the download is older than the vault), new, unfinished, skipped (left
 * unticked when imported), missing (imported before, not in the vault now), unreadable, locked,
 * incomplete, occupied (its folder holds what is not ours).
 */
export type SectionState = 'free' | 'locked' | 'incomplete' | 'blocked' | 'occupied' | 'unreadable'
	| 'checking' | 'different' | 'duplicate' | 'same' | 'restorable' | 'changed' | 'older' | 'new' | 'unfinished' | 'skipped' | 'missing';

/** The states a section can be ticked in. */
export const TICKABLE: ReadonlySet<SectionState> = new Set(['free', 'restorable', 'changed', 'older', 'new', 'unfinished', 'skipped', 'missing']);
/** The states of a notebook imported before that are ticked unless the user unticks them (§11.5 item 49; Internal-9 §3.4). */
const TICKED_FOR_UPDATE: ReadonlySet<SectionState> = new Set(['changed', 'new', 'unfinished']);
/** Sections whose pages in the vault an update replaces (the versions before go aside). */
const REPLACING: ReadonlySet<SectionState> = new Set(['changed', 'older', 'unfinished']);

export type Phase = 'setup' | 'running' | 'finished';

/** Which command opened the window (its title and first line). */
export type Entry = 'import' | 'update';

/** What the plugin keeps track of around an update (see main.ts). */
export interface SessionHooks {
	/** Resolves once updates cut off before (finished when Obsidian started) are done with. */
	beforeRun?(): Promise<void>;
	/** An update of the folder is about to write: it is to be finished at the next start if cut off. */
	updateStarting?(root: string): Promise<void>;
	/** The update of the folder ended (its journal is closed). */
	updateEnded?(root: string): Promise<void>;
}

/** A section's pages as read for an update, or why they could not be. */
interface Scan {
	pages?: ScannedPage[];
	error?: string;
}

/** What an update of the chosen notebooks imported before would do, counted for the window. */
export interface UpdateCounts {
	/** Sections whose pages are replaced (changed, older, unfinished). */
	updated: number;
	/** Sections written anew (new, left unticked before, missing from the vault). */
	added: number;
	/** Pages the user deleted that come back. */
	restored: number;
	/** Pages changed in OneNote and edited in Obsidian: the user's version goes aside. */
	bothEdited: number;
}

const message = (error: unknown) => String((error as Error)?.message ?? error);
const key = (name: string) => name.normalize('NFC').toLowerCase();

/** Folders an update keeps its own files in, in every language: no notebook takes one (§11.5 item 50.14). */
const RESERVED = [...new Set(LANGUAGES.flatMap(language => [STRINGS[language].oldVersionsFolder, STRINGS[language].updateLogFolder]))];

export class ImportSession {
	readonly downloads: ChosenDownload[] = [];
	choices: NotebookChoice[] = [];
	folder: string;
	options: Required<SectionOptions>;
	/** The language of the marks and folder names of notebooks new to the target folder. */
	language: Language;
	readonly entry: Entry;
	phase: Phase = 'setup';
	progress?: ImportProgress;
	startedAt = 0;
	/** What ran: an update (of notebooks imported before, with new ones imported first), or an import only. */
	running?: 'import' | 'update';
	/** The import of notebooks new to the folder, when one ran. */
	outcome?: ImportOutcome;
	/** The update, when one ran and had something to do. */
	updateResult?: UpdateResult;
	/** Its record, as a vault path. */
	recordPath?: string;
	/** The sections chosen for the update when it started (those a stop left out are counted from it). */
	updateTotal = 0;
	error?: string;
	stopRequested = false;
	/** The notebooks already in the target folder when the import started (it then wrote nothing). */
	alreadyThere?: string[];
	/** The target folder is being looked at (what earlier imports left there). */
	checking = false;
	/** The sections of notebooks imported before are being read and compared. */
	checkingUpdates = false;
	/** Why the target folder could not be looked at, if it could not. */
	folderError?: string;
	/** Files being downloaded from OneDrive (into the local copy), while they are. */
	downloading?: CopyProgress;
	/** Sections chosen from OneDrive that could not be downloaded when the import started (left out). */
	notDownloaded = 0;
	/**
	 * The import was stopped before the sections chosen from OneDrive were all downloaded: what came
	 * down stays in the local copy, a file cut off part way included, and the next import goes on from there.
	 */
	downloadsCut = false;
	/** The import is about to start: the target folder is looked at once more. */
	private starting = false;
	/** Names given again after a look at the target folder, since the user last changed anything (see lookUp). */
	private renamings = 0;
	private readonly listeners = new Set<() => void>();
	/** The window was closed (or the plugin turned off) before an import: nothing more is done. */
	private disposed = false;
	/** Counts lookups of the target folder, so that only the latest one is kept. */
	private lookups = 0;
	/** Sections read for an update, by download and section path (they do not depend on the target folder). */
	private readonly scans = new Map<string, Map<string, Scan>>();
	/** What the target folder holds of a notebook imported before (read once per folder), by folder and notebook folder. */
	private readonly archives = new Map<string, { archive?: Archive, entry?: ReportNotebook }>();
	/** The comparison running now, and whether it is to run again once done (something changed meanwhile). */
	private checkRun?: Promise<void>;
	private checkAgain = false;
	private readonly app: App;
	private readonly client: WorkerClient;
	private readonly hooks: SessionHooks;
	readonly readerLanguage: Language;

	constructor(app: App, client: WorkerClient, defaults: { folder: string } & Required<SectionOptions>, readerLanguage: Language, entry: Entry = 'import', hooks: SessionHooks = {}) {
		this.app = app;
		this.client = client;
		this.folder = defaults.folder;
		this.options = { boxMarkers: defaults.boxMarkers, keepFontColor: defaults.keepFontColor, imageAltText: defaults.imageAltText };
		this.readerLanguage = readerLanguage;
		this.language = readerLanguage;
		this.entry = entry;
		this.hooks = hooks;
	}

	/** Calls `listener` after every change; answers a function that stops it. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	changed(): void {
		for (const listener of this.listeners) listener();
	}

	/** Downloads, choices and names change only while the import is being set up. */
	private get open(): boolean {
		return this.phase === 'setup' && !this.disposed;
	}

	private async worker(): Promise<WorkerClient> {
		if (this.disposed) throw new ConverterStopped('stopped');
		if (!this.client.running) await this.client.start();
		return this.client;
	}

	/** Adds downloads (zips or folders) and reads what they hold. */
	async add(inputs: string[]): Promise<void> {
		if (!this.open) return;
		const added = inputs.filter(input => !this.downloads.some(download => download.input === input))
			.map(input => ({ input, name: downloadName(input), state: 'reading', notebooks: [] } as ChosenDownload));
		this.downloads.push(...added);
		this.changed();
		for (const download of added) {
			if (!this.open) return;
			try {
				const opened = await (await this.worker()).open(download.input);
				if (!this.open) return;
				download.notebooks = opened.notebooks;
				download.incomplete = opened.incomplete;
				download.state = 'ready';
			}
			catch (error) {
				if (!this.open) return;
				download.state = 'failed';
				download.error = message(error);
				download.stopped = error instanceof ConverterStopped;
			}
			this.rebuild();
			this.changed();
		}
		void this.findLocked();
	}

	remove(download: ChosenDownload): void {
		if (!this.open) return;
		download.onedrive?.controller.abort();
		const index = this.downloads.indexOf(download);
		if (index >= 0) this.downloads.splice(index, 1);
		this.rebuild();
		this.changed();
	}

	/**
	 * Adds the user's OneDrive as a source: its notebooks and their sections, listed without
	 * downloading anything (a notebook is downloaded when it is imported, or checked for updates).
	 * The list kept from last time shows at once, and OneDrive is asked what changed behind it.
	 * With `notebooks` (found by the user in other folders), adds those. Answers how many it added.
	 */
	async addOneDrive(access: OneDriveAccess, notebooks?: RemoteNotebook[]): Promise<number> {
		if (!this.open) return 0;
		let download = this.downloads.find(one => one.onedrive);
		if (download && (download.state === 'reading' || download.onedrive!.refreshing)) return 0;
		const first = !download;
		if (!download) {
			download = { input: '', name: 'OneDrive', state: 'reading', notebooks: [], locked: new Set(),
				onedrive: { access, notebooks: new Map(), refreshed: new Set(), failed: new Map(), controller: new AbortController() } };
			this.downloads.push(download);
		}
		const source = download.onedrive!;
		download.error = undefined;
		if (notebooks) return this.addNotebooks(download, notebooks);
		if (first) {
			const kept = await access.kept?.().catch(() => undefined);
			if (kept?.notebooks.length && this.open && this.downloads.includes(download)) {
				download.input = kept.root;
				for (const entry of kept.notebooks) source.notebooks.set(notebookPath(entry.notebook), { ...entry });
				download.notebooks = this.listOneDrive(source);
				download.state = 'ready';
				this.rebuild();
			}
		}
		const showing = download.state === 'ready' && source.notebooks.size > 0;
		if (showing) source.refreshing = true;
		else {
			download.state = 'reading';
			source.reading = { done: 0 };
		}
		this.changed();
		const aborted = () => source.controller.signal.aborted || !this.open || !this.downloads.includes(download);
		let count = 0;
		try {
			download.input = await access.root();
			const found = await access.notebooks();
			// Notebooks added from other folders before are asked about again too.
			const extra = [...source.notebooks.values()].filter(entry => entry.extra && !found.some(one => one.id === entry.notebook.id)).map(entry => entry.notebook);
			const all = [...found, ...extra];
			if (source.reading) source.reading.total = all.length;
			this.changed();
			const next = new Map<string, KeptNotebook & { listed?: DownloadNotebook }>();
			// Several at a time: one listing is a handful of small requests, mostly waiting for answers.
			await eachLimited(all, 10, async notebook => {
				if (aborted()) return;
				const files = await access.files(notebook.id);
				if (aborted()) return;
				const path = notebookPath(notebook);
				next.set(path, { notebook, files, listed: source.notebooks.get(path)?.listed, ...(extra.includes(notebook) ? { extra: true } : {}) });
				if (source.reading) {
					source.reading.done++;
					this.changed();
				}
			});
			if (aborted()) return 0;
			source.notebooks = next;
			count = found.length;
			await access.keep?.(download.input, [...next.values()].map(({ notebook, files, extra: added }) => ({ notebook, files, ...(added ? { extra: true } : {}) }))).catch(() => undefined);
		}
		catch (error) {
			source.reading = undefined;
			source.refreshing = false;
			if (aborted()) return 0;
			download.error = message(error);
			if (!source.notebooks.size) {
				download.state = 'failed';
				this.rebuild();
				this.changed();
				return 0;
			}
			// What was listed (or kept from last time) stays; why it could not be brought up to date is said.
		}
		source.reading = undefined;
		source.refreshing = false;
		if (aborted()) return 0;
		download.notebooks = this.listOneDrive(source);
		download.state = 'ready';
		this.rebuild();
		this.changed();
		// Notebooks imported before are compared once their list is OneDrive's own.
		void this.check();
		return count;
	}

	/** Adds notebooks the user found in other folders to the OneDrive source. */
	private async addNotebooks(download: ChosenDownload, notebooks: RemoteNotebook[]): Promise<number> {
		const source = download.onedrive!;
		const known = new Set([...source.notebooks.values()].map(entry => entry.notebook.id));
		const fresh = notebooks.filter(notebook => !known.has(notebook.id));
		if (!fresh.length) return 0;
		download.state = 'reading';
		source.reading = { done: 0, total: fresh.length };
		this.changed();
		try {
			await eachLimited(fresh, 6, async notebook => {
				if (source.controller.signal.aborted) return;
				const files = await source.access.files(notebook.id);
				source.notebooks.set(notebookPath(notebook), { notebook, files, extra: true });
				source.reading!.done++;
				this.changed();
			});
			await source.access.keep?.(download.input, [...source.notebooks.values()].map(({ notebook, files, extra }) => ({ notebook, files, ...(extra ? { extra: true } : {}) }))).catch(() => undefined);
		}
		catch (error) {
			download.error = message(error);
		}
		source.reading = undefined;
		if (!this.open || !this.downloads.includes(download)) return 0;
		download.notebooks = this.listOneDrive(source);
		download.state = 'ready';
		this.rebuild();
		this.changed();
		return fresh.length;
	}

	/**
	 * The notebooks of a OneDrive source, as a download of the local copy would show them: the tree
	 * is built from OneDrive's file lists the way it is from a folder's, by name. A notebook listed
	 * before keeps its place (and its ticks); its sections follow OneDrive's list.
	 */
	private listOneDrive(source: OneDriveSource): DownloadNotebook[] {
		const fresh: DownloadNotebook[] = [];
		const kept: DownloadNotebook[] = [];
		for (const [path, entry] of source.notebooks) {
			const found = findNotebooks(entry.files.map(file => ({ path: `${path}/${file.path}`, size: file.size })), 'OneDrive');
			// A notebook without any section or table of contents shows nothing.
			const built = found.length === 1 && found[0]!.path === path ? found[0]! : undefined;
			if (!built) entry.listed = undefined;
			else if (entry.listed) {
				entry.listed.sections = built.sections.map(section => ({ ...section, notebook: entry.listed!.name }));
				kept.push(entry.listed);
			}
			else {
				entry.listed = built;
				fresh.push(built);
			}
		}
		distinctNames(fresh, kept.map(notebook => notebook.name));
		return [...kept, ...fresh].sort((a, b) => nameCollator.compare(a.name, b.name));
	}

	/** The OneDrive folder a notebook of a OneDrive source is in (`学习/文档`; '' at the top), if it is one. */
	oneDriveFolder(choice: NotebookChoice): string | undefined {
		return choice.download.onedrive?.notebooks.get(choice.notebook.path)?.notebook.folder;
	}

	/** Looks at the first bytes of downloaded sections for a password (a OneDrive source's are only on disk once downloaded). */
	private async lookForPasswords(download: ChosenDownload, sections: DownloadSection[]): Promise<void> {
		const failed = download.onedrive?.failed;
		for (const section of sections) {
			if (failed?.has(section.path)) continue;
			if (await isLockedFile(`${download.input}/${section.path}`).catch(() => false)) (download.locked ??= new Set()).add(section.path);
		}
	}

	/**
	 * Brings a OneDrive notebook imported before up to date in the local copy, whole (only files
	 * changed in OneDrive are downloaded): its sections are then read like a download's (Internal-10
	 * §22.2). Sections that could not be downloaded are not read from an older copy.
	 */
	private async refreshCopy(choice: NotebookChoice): Promise<void> {
		const source = choice.download.onedrive;
		const entry = source?.notebooks.get(choice.notebook.path);
		if (!source || !entry || source.refreshed.has(entry.notebook.id)) return;
		source.refreshed.add(entry.notebook.id);
		try {
			const result = await source.access.copy(entry.notebook, entry.files, undefined, source.controller.signal, progress => {
				// Only when there is something to download (a copy already up to date reports nothing to fetch).
				if (!progress.totalFiles) return;
				this.downloading = progress;
				this.changed();
			});
			for (const failed of result.failed) source.failed.set(`${choice.notebook.path}/${failed.path}`, failed.detail);
		}
		catch (error) {
			for (const section of choice.notebook.sections) source.failed.set(section.path, message(error));
		}
		finally {
			this.downloading = undefined;
		}
		await this.lookForPasswords(choice.download, choice.notebook.sections);
	}

	/**
	 * Downloads the sections chosen from OneDrive for the import (with their notebooks' tables of
	 * contents) into the local copy. Sections that could not be downloaded are left out (and counted);
	 * one with a password is converted no more than from a download: the import reports it.
	 */
	private async fetchChosen(fresh: NotebookChoice[], going: Set<DownloadSection>): Promise<void> {
		const work: { source: OneDriveSource, notebook: RemoteNotebook, files: RemoteFile[], only: Set<string>, sections: DownloadSection[] }[] = [];
		for (const choice of fresh) {
			const source = choice.download.onedrive;
			if (!source) continue;
			const sections = choice.notebook.sections.filter(section => going.has(section));
			const entry = source.notebooks.get(choice.notebook.path);
			if (!entry || !sections.length) continue;
			const only = filesToFetch(choice.notebook.path, entry.files, sections.map(section => section.path));
			work.push({ source, notebook: entry.notebook, files: entry.files, only, sections });
		}
		const totalFiles = work.reduce((n, one) => n + one.only.size, 0);
		// Counted in sections, as the import is (a notebook's table of contents comes along uncounted).
		const totalSections = work.reduce((n, one) => n + one.sections.length, 0);
		const totalBytes = work.reduce((n, one) => n + one.files.filter(file => one.only.has(file.id)).reduce((m, file) => m + file.size, 0), 0);
		let files = 0, sections = 0, bytes = 0;
		const cut = () => {
			this.downloadsCut = true;
			this.downloading = undefined;
		};
		for (const one of work) {
			if (this.stopRequested) return cut();
			const stop = () => one.source.controller.abort();
			const off = this.onChange(() => {
				if (this.stopRequested) stop();
			});
			try {
				const result = await one.source.access.copy(one.notebook, one.files, one.only, one.source.controller.signal, progress => {
					this.downloading = { files: files + progress.files, totalFiles, sections: sections + progress.sections, totalSections, bytes: bytes + progress.bytes, totalBytes, current: progress.current };
					this.changed();
				});
				for (const failed of result.failed) one.source.failed.set(`${notebookPath(one.notebook)}/${failed.path}`, failed.detail);
			}
			catch (error) {
				if (this.stopRequested) return cut();
				for (const section of one.sections) one.source.failed.set(section.path, message(error));
			}
			finally {
				off();
			}
			files += one.only.size;
			sections += one.sections.length;
			bytes += one.files.filter(file => one.only.has(file.id)).reduce((m, file) => m + file.size, 0);
			for (const section of one.sections) {
				if (!one.source.failed.has(section.path)) continue;
				this.notDownloaded++;
				going.delete(section);
			}
		}
		this.downloading = undefined;
	}

	/** The notebooks of every download, in order; earlier choices kept, new ones with their defaults. */
	private rebuild(): void {
		const earlier = new Map(this.choices.map(choice => [choice.notebook, choice]));
		const choices: NotebookChoice[] = [];
		for (const download of this.downloads) {
			for (const notebook of download.notebooks) {
				choices.push(earlier.get(notebook) ?? { download, notebook, originalName: notebook.sourceName ?? notebook.name, ticks: new Map(), restore: new Map() });
			}
		}
		this.choices = choices;
		this.renameAll();
	}

	/**
	 * The user wants something of the notebook: a section chosen. Names depend on this alone: a
	 * notebook with nothing chosen (all imported and unchanged, say) takes no name from another of the
	 * same name, which then goes to the folder it had.
	 */
	private wanted(choice: NotebookChoice): boolean {
		return choice.notebook.sections.some(section => this.isChosen(choice, section));
	}

	/**
	 * Every notebook back to its OneNote name, then " (2)" and so on where two wanted notebooks
	 * would get one folder (a notebook unticked keeps its name and takes none from the others), or
	 * one would get a folder an update keeps its own files in; then the target folder is looked at
	 * again for what the names now lead to.
	 */
	private renameAll(byUser = true): void {
		if (!this.open) return;
		if (byUser) this.renamings = 0;
		for (const choice of this.choices) renameNotebook(choice.notebook, choice.originalName);
		this.named = new Set(this.choices.filter(choice => this.wanted(choice)));
		distinctNames([...this.named].map(choice => choice.notebook), RESERVED);
		void this.lookUp();
	}

	/** The notebooks the names were last given for (see renameAll). */
	private named = new Set<NotebookChoice>();

	/**
	 * Looks at the target folder for each notebook: a folder of an earlier import of it (it is
	 * updated), a folder of its name that is not ours (it cannot go there), or nothing. Then the
	 * notebooks imported before are compared with what the download has.
	 */
	private async lookUp(): Promise<void> {
		const lookup = ++this.lookups;
		this.checking = true;
		this.folderError = undefined;
		this.changed();
		const found = new Map<NotebookChoice, Pick<NotebookChoice, 'earlier' | 'blocked' | 'otherSpelling' | 'dir'>>();
		try {
			const sink = new VaultSink(this.app, this.folder);
			// The report the import will update (the reader's language first), for counts only.
			const recorded = new Map((await reportedNotebooks(sink, STRINGS[this.readerLanguage])).map(entry => [key(entry.dir), entry]));
			for (const choice of this.choices) {
				if (lookup !== this.lookups || !this.open) return;
				const dir = notebookFolder(choice.notebook.name, STRINGS[this.language]);
				if (!sink.hasChild(dir)) {
					found.set(choice, {});
					continue;
				}
				// Ours only under this very spelling: another case is the same folder on disk but not in the vault's index.
				if (!sink.exists(dir)) {
					found.set(choice, { blocked: true, otherSpelling: true });
					continue;
				}
				const earlier = await earlierNotebook(sink, dir, choice.notebook, recorded.get(key(dir)));
				found.set(choice, earlier ? { earlier, dir } : { blocked: true });
			}
		}
		catch (error) {
			if (lookup !== this.lookups || !this.open) return;
			// The folder could not be read: nothing can be known of it, so nothing starts.
			this.folderError = message(error);
			this.checking = false;
			this.changed();
			return;
		}
		if (lookup !== this.lookups || !this.open) return;
		for (const [choice, state] of found) {
			// Compared again where its folder is another one now.
			if (choice.dir !== state.dir || !state.earlier) choice.plan = undefined;
			choice.earlier = state.earlier;
			choice.dir = state.dir;
			choice.blocked = state.blocked;
			choice.otherSpelling = state.otherSpelling;
		}
		this.checking = false;
		// What can be chosen may have changed which notebooks are wanted, and so the names. A few
		// rounds settle it; should two notebooks keep taking each other's folder, the names stay.
		this.settleNames();
		// Says it is comparing before anything is told of the change (so that nothing waiting for the window to settle goes on too early).
		await this.check();
	}

	/** Gives names again when the notebooks wanted are not those the names were given for (see lookUp). */
	private settleNames(): void {
		const wanted = new Set(this.choices.filter(choice => this.wanted(choice)));
		if (this.renamings < 3 && (wanted.size !== this.named.size || [...wanted].some(choice => !this.named.has(choice)))) {
			this.renamings++;
			this.renameAll(false);
		}
	}

	get reading(): boolean {
		return this.downloads.some(download => download.state === 'reading' || download.onedrive?.refreshing);
	}

	/** Resolves once the downloads are read, the target folder and password-protected sections looked at, and updates compared. */
	whenSettled(): Promise<void> {
		const busy = () => this.open && (this.reading || this.checking || this.findingLocked || this.checkingUpdates);
		if (!busy()) return Promise.resolve();
		return new Promise(resolve => {
			const off = this.onChange(() => {
				if (busy()) return;
				off();
				resolve();
			});
		});
	}

	/** Looks for password-protected sections in each download not looked at yet. */
	async findLocked(): Promise<void> {
		// Downloads may be removed meanwhile: a copy of the list, so none after a removed one is passed over.
		for (const download of [...this.downloads]) {
			if (!this.open) return;
			if (download.state !== 'ready' || download.locked || this.lockChecks.has(download) || !this.downloads.includes(download)) continue;
			this.lockChecks.add(download);
			try {
				const locked = await (await this.worker()).locked(download.input);
				if (!this.open) return;
				download.locked = new Set(locked);
			}
			catch {
				if (!this.open) return;
				download.locked = new Set();
			}
			finally {
				this.lockChecks.delete(download);
			}
			this.changed();
		}
	}

	/** Downloads whose password-protected sections are being looked for. */
	private readonly lockChecks = new Set<ChosenDownload>();

	/** Password-protected sections are still being looked for: until then they could be ticked. */
	get findingLocked(): boolean {
		return this.downloads.some(download => download.state === 'ready' && !download.locked);
	}

	// Updates: what changed in the notebooks imported before.

	/** The notebooks imported before (that can be updated). */
	private get updatable(): NotebookChoice[] {
		return this.choices.filter(choice => choice.earlier && !choice.blocked);
	}

	/** A notebook imported before is among the downloads: the window updates as well as imports. */
	get updating(): boolean {
		return this.updatable.length > 0;
	}

	private scanOf(download: ChosenDownload, section: DownloadSection): Scan | undefined {
		return this.scans.get(download.input)?.get(section.path);
	}

	/** How far the reading of the notebooks imported before has got: sections read, of all. */
	get checkProgress(): { done: number, total: number } {
		const sections = this.updatable.flatMap(choice => choice.notebook.sections.map(section => this.scanOf(choice.download, section)));
		return { done: sections.filter(Boolean).length, total: sections.length };
	}

	/**
	 * Reads each section of the notebooks imported before (page ids, titles and times only; once
	 * per download), then compares each such notebook with the vault. One at a time: a call while it
	 * runs makes it run again once done, and resolves then.
	 */
	private check(): Promise<void> {
		if (this.checkRun) {
			this.checkAgain = true;
			return this.checkRun;
		}
		if (!this.updatable.length) {
			this.changed();
			return Promise.resolve();
		}
		this.checkRun = (async () => {
			this.checkingUpdates = true;
			this.changed();
			try {
				do {
					this.checkAgain = false;
					for (const choice of this.updatable) {
						if (choice.download.onedrive?.refreshing) continue;
						if (choice.download.onedrive && this.open) await this.refreshCopy(choice);
						for (const section of choice.notebook.sections) {
							if (!this.open) return;
							if (!this.downloads.includes(choice.download) || this.scanOf(choice.download, section)) continue;
							await this.read(choice.download, section);
							this.changed();
						}
					}
					if (!this.open) return;
					await this.planAll();
				} while (this.checkAgain && this.open);
			}
			finally {
				this.checkingUpdates = false;
				this.checkRun = undefined;
				if (this.open) {
					this.settleNames();
					this.changed();
				}
			}
		})();
		return this.checkRun;
	}

	/** Reads one section's pages in the worker. */
	private async read(download: ChosenDownload, section: DownloadSection): Promise<void> {
		let scan: Scan;
		const notDownloaded = download.onedrive?.failed.get(section.path);
		if (section.incomplete) scan = { error: 'incomplete' };
		else if (notDownloaded !== undefined) scan = { error: notDownloaded };
		else {
			try {
				scan = { pages: await (await this.worker()).scan(download.input, section) };
			}
			catch (error) {
				if (!this.open) return;
				// The worker failed on it (out of memory, say): the next section gets a fresh one (see worker()).
				scan = { error: error instanceof ConverterStopped ? error.detail ?? error.message : message(error) };
			}
		}
		if (!this.scans.has(download.input)) this.scans.set(download.input, new Map());
		this.scans.get(download.input)!.set(section.path, scan);
	}

	/** The sections of a notebook as read, as the planner and the update take them. */
	private scanned(choice: NotebookChoice, strings: Strings): ScannedSection[] {
		return choice.notebook.sections.map(section => {
			const base = { key: [choice.notebook.name, ...section.groups, section.label].join('/'), groups: section.groups, label: section.label };
			const scan = this.scanOf(choice.download, section);
			if (section.incomplete) return { ...base, error: strings.incompleteSection };
			if (scan?.pages) return { ...base, pages: scan.pages };
			return { ...base, error: choice.download.locked?.has(section.path) ? strings.passwordProtected : scan?.error ?? 'unreadable' };
		});
	}

	/** Compares each notebook imported before, all of whose sections are read, with what the target folder holds. */
	private async planAll(): Promise<void> {
		const folder = this.folder;
		const sink = new VaultSink(this.app, folder);
		let reported: ReportNotebook[] | undefined;
		try {
			for (const choice of this.updatable) {
				if (!this.open || folder !== this.folder) return;
				if (choice.notebook.sections.some(section => !this.scanOf(choice.download, section))) continue;
				const at = `${key(folder)}\u0000${key(choice.dir!)}`;
				let known = this.archives.get(at);
				if (!known) {
					reported ??= await reportedNotebooks(sink, STRINGS[this.readerLanguage]);
					const entry = reported.find(candidate => key(candidate.dir) === key(choice.dir!));
					known = { archive: await readArchive(sink, choice.dir!, entry?.sections), ...(entry ? { entry } : {}) };
					this.archives.set(at, known);
				}
				if (!this.open || folder !== this.folder) return;
				const { archive, entry } = known;
				// Not ours after all (its contents page changed since it was looked at): looked at again next time.
				if (!archive) {
					choice.plan = undefined;
					this.archives.delete(at);
					continue;
				}
				const strings = STRINGS[archive.language];
				choice.plan = planNotebook(choice.notebook.name, this.scanned(choice, strings), archive, strings, { partial: !!choice.download.incomplete, ...recordedPlanOptions(entry, choice.dir!) });
			}
		}
		catch (error) {
			if (this.open) this.folderError = message(error);
		}
	}

	/** The plan of a section of a notebook imported before. */
	itemOf(choice: NotebookChoice, section: DownloadSection): PlanItem | undefined {
		const plan = choice.plan;
		if (!plan) return undefined;
		let items = this.items.get(plan);
		if (!items) {
			items = new Map(plan.items.filter(item => item.status !== 'gone').map(item => [sectionKey(item.groups, item.label), item]));
			this.items.set(plan, items);
		}
		return items.get(sectionKey(section.groups, section.label));
	}

	private readonly items = new WeakMap<NotebookPlan, Map<string, PlanItem>>();

	/** Sections of ours in a notebook imported before that the download does not have: they stay as they are. */
	gone(choice: NotebookChoice): PlanItem[] {
		return choice.plan?.items.filter(item => item.status === 'gone') ?? [];
	}

	/** Pages of a section the user deleted in Obsidian (they can be brought back). */
	deletedPages(choice: NotebookChoice, section: DownloadSection): PagePlan[] {
		return this.itemOf(choice, section)?.added.filter(page => page.userDeleted) ?? [];
	}

	/** A notebook's pages as its download has them: last-modified times by page id (ISO strings compare as times do). */
	private pageTimes(choice: NotebookChoice): Map<string, string> {
		const times = new Map<string, string>();
		for (const section of choice.notebook.sections) {
			for (const page of this.scanOf(choice.download, section)?.pages ?? []) if (page.modified) times.set(page.id, page.modified);
		}
		return times;
	}

	/** Whether download `a` of a notebook is newer than `b`: by the pages both have, then the newest page, then the most sections. */
	private newer(a: NotebookChoice, b: NotebookChoice): boolean {
		const [x, y] = [this.pageTimes(a), this.pageTimes(b)];
		let ahead = 0;
		for (const [id, time] of x) {
			const other = y.get(id);
			if (other !== undefined && time !== other) ahead += time > other ? 1 : -1;
		}
		if (ahead) return ahead > 0;
		const newest = (times: Map<string, string>) => [...times.values()].reduce((max, time) => (time > max ? time : max), '');
		if (newest(x) !== newest(y)) return newest(x) > newest(y);
		return a.notebook.sections.length > b.notebook.sections.length;
	}

	/**
	 * Of the downloads chosen that hold the same notebook imported before (an older and a newer zip of
	 * it), the one that updates it: the newer (see newer), else the first. Only one may: two would each
	 * plan against the other's output. Undefined while some are still compared.
	 */
	private updaterOf(choice: NotebookChoice): NotebookChoice | undefined {
		const same = this.updatable.filter(other => key(other.dir!) === key(choice.dir!) && other.plan?.identity !== 'different');
		if (same.length < 2) return choice;
		if (same.some(other => !other.plan)) return undefined;
		let best = same[0]!;
		for (const other of same.slice(1)) if (this.newer(other, best)) best = other;
		return best;
	}

	sectionState(choice: NotebookChoice, section: DownloadSection): SectionState {
		if (choice.blocked) return 'blocked';
		if (choice.earlier) {
			const plan = choice.plan;
			if (!plan) return 'checking';
			if (plan.identity === 'different') return 'different';
			const updater = this.updaterOf(choice);
			if (!updater) return 'checking';
			if (updater !== choice) return 'duplicate';
			const item = this.itemOf(choice, section);
			switch (item?.status) {
				case undefined: return 'checking';
				case 'error': return section.incomplete ? 'incomplete' : choice.download.locked?.has(section.path) ? 'locked' : 'unreadable';
				case 'occupied': return 'occupied';
				case 'same': return item.added.some(page => page.userDeleted) ? 'restorable' : 'same';
				case 'changed': return item.older ? 'older' : 'changed';
				case 'new': case 'unfinished': case 'skipped': case 'missing': return item.status;
				default: return 'same';
			}
		}
		if (section.incomplete) return 'incomplete';
		if (choice.download.locked?.has(section.path)) return 'locked';
		return 'free';
	}

	/**
	 * Whether a section is ticked when the user has not said: a new notebook's sections, unless a
	 * notebook imported before is among the downloads (then nothing new is imported unasked); and a
	 * notebook imported before's sections that changed, are new, or were cut off before.
	 */
	private defaultTick(choice: NotebookChoice, state: SectionState): boolean {
		// OneDrive holds all the user's notebooks: none is ticked unasked (as in Obsidian's own importer).
		return state === 'free' ? !this.updating && !choice.download.onedrive : TICKED_FOR_UPDATE.has(state);
	}

	/** The sections of a notebook that can be chosen. */
	choosable(choice: NotebookChoice, sections = choice.notebook.sections): DownloadSection[] {
		return sections.filter(section => TICKABLE.has(this.sectionState(choice, section)));
	}

	/** The section goes into the import or the update. */
	isChosen(choice: NotebookChoice, section: DownloadSection): boolean {
		const state = this.sectionState(choice, section);
		if (state === 'restorable') return (choice.restore.get(section.path)?.size ?? 0) > 0;
		if (!TICKABLE.has(state)) return false;
		return choice.ticks.get(section.path) ?? this.defaultTick(choice, state);
	}

	/** How a section's box shows: a section with only deleted pages is partly ticked when some of them come back. */
	ticked(choice: NotebookChoice, section: DownloadSection): boolean | 'some' {
		if (this.sectionState(choice, section) !== 'restorable') return this.isChosen(choice, section);
		const all = this.deletedPages(choice, section).length;
		const chosen = choice.restore.get(section.path)?.size ?? 0;
		return chosen === 0 ? false : chosen >= all ? true : 'some';
	}

	/** Ticks or unticks some sections of a notebook (a section with only deleted pages: all of them). */
	setSections(choice: NotebookChoice, sections: DownloadSection[], value: boolean): void {
		if (!this.open) return;
		for (const section of sections) {
			choice.ticks.set(section.path, value);
			if (!value) choice.restore.delete(section.path);
			else if (this.sectionState(choice, section) === 'restorable') choice.restore.set(section.path, new Set(this.deletedPages(choice, section).map(page => page.id)));
		}
		if (this.wanted(choice) !== this.named.has(choice)) this.renameAll();
		this.changed();
	}

	/** Whether a page the user deleted comes back. */
	isRestored(choice: NotebookChoice, section: DownloadSection, id: string): boolean {
		return !!choice.restore.get(section.path)?.has(id) && this.isChosen(choice, section);
	}

	/** Brings back a page the user deleted, or not; its section is ticked with it. */
	setRestored(choice: NotebookChoice, section: DownloadSection, id: string, value: boolean): void {
		if (!this.open) return;
		const pages = choice.restore.get(section.path) ?? new Set<string>();
		if (value) pages.add(id);
		else pages.delete(id);
		if (pages.size) choice.restore.set(section.path, pages);
		else choice.restore.delete(section.path);
		if (value && this.sectionState(choice, section) !== 'restorable') choice.ticks.set(section.path, true);
		if (this.wanted(choice) !== this.named.has(choice)) this.renameAll();
		this.changed();
	}

	/** Every section that can be chosen is chosen. */
	get allChosen(): boolean {
		return this.choices.every(choice => this.choosable(choice).every(section => this.ticked(choice, section) === true));
	}

	/** Ticks every section, or unticks them all. */
	selectAll(value: boolean): void {
		if (!this.open) return;
		for (const choice of this.choices) {
			for (const section of choice.notebook.sections) {
				choice.ticks.set(section.path, value);
				if (!value) choice.restore.delete(section.path);
				else if (this.sectionState(choice, section) === 'restorable') choice.restore.set(section.path, new Set(this.deletedPages(choice, section).map(page => page.id)));
			}
		}
		this.renameAll();
		this.changed();
	}

	/** Moves the import to another target folder (as typed; cleaned by the caller). */
	setFolder(folder: string): void {
		if (!this.open) return;
		this.folder = folder;
		this.renamings = 0;
		void this.lookUp();
		this.changed();
	}

	setLanguage(language: Language): void {
		if (!this.open) return;
		this.language = language;
		this.renamings = 0;
		// Folder names of untitled notebooks follow the language.
		void this.lookUp();
		this.changed();
	}

	/** The notebooks the import or update will write into: with a section chosen (which also means allowed in the target folder). */
	included(): NotebookChoice[] {
		return this.choices.filter(choice => choice.notebook.sections.some(section => this.isChosen(choice, section)));
	}

	/**
	 * The sections a new notebook's import takes: those chosen, and with them those of the notebook
	 * that cannot be read (they get a page that says why).
	 */
	private going(choice: NotebookChoice): DownloadSection[] {
		return choice.notebook.sections.filter(section => {
			const state = this.sectionState(choice, section);
			return this.isChosen(choice, section) || state === 'locked' || state === 'incomplete';
		});
	}

	/**
	 * What the import of new notebooks will do: notebooks, sections (with those that cannot be read,
	 * also counted apart) and the bytes of those sections.
	 */
	counts(): { notebooks: number, sections: number, unreadable: number, bytes: number } {
		const included = this.included().filter(choice => !choice.earlier);
		const sections = included.flatMap(choice => this.going(choice));
		const unreadable = included.flatMap(choice => this.going(choice).filter(section => !this.isChosen(choice, section)));
		return { notebooks: included.length, sections: sections.length, unreadable: unreadable.length, bytes: sections.reduce((n, section) => n + section.size, 0) };
	}

	/** What the update of notebooks imported before will do. */
	updateCounts(): UpdateCounts {
		const counts: UpdateCounts = { updated: 0, added: 0, restored: 0, bothEdited: 0 };
		for (const choice of this.included().filter(choice => choice.earlier)) {
			for (const section of choice.notebook.sections.filter(section => this.isChosen(choice, section))) {
				const state = this.sectionState(choice, section);
				const item = this.itemOf(choice, section);
				if (REPLACING.has(state)) {
					counts.updated++;
					counts.bothEdited += item?.modified.filter(page => page.userEdited).length ?? 0;
				}
				else if (state !== 'restorable') counts.added++;
				const deleted = new Set(this.deletedPages(choice, section).map(page => page.id));
				counts.restored += [...choice.restore.get(section.path) ?? []].filter(id => deleted.has(id)).length;
			}
		}
		return counts;
	}

	/**
	 * Where an update puts the versions it replaces: the folder of that kind the target folder has
	 * (in any language), or the reader's (as the update decides it).
	 */
	get oldVersionsFolder(): string {
		const sink = new VaultSink(this.app, this.folder);
		for (const strings of [STRINGS[this.readerLanguage], ...LANGUAGES.map(language => STRINGS[language])]) {
			if (sink.exists(strings.oldVersionsFolder)) return strings.oldVersionsFolder;
		}
		return STRINGS[this.readerLanguage].oldVersionsFolder;
	}

	get ready(): boolean {
		const included = this.included();
		// Never two notebooks into one folder (see updaterOf; new ones get " (2)").
		const folders = included.map(choice => key(choice.dir ?? notebookFolder(choice.notebook.name, STRINGS[this.language])));
		return this.open && !this.starting && !this.reading && !this.checking && !this.findingLocked && !this.checkingUpdates
			&& !this.folderError && !folderProblem(this.folder) && included.length > 0 && new Set(folders).size === folders.length;
	}

	/** Runs the import, the update, or both. Resolves when it ends (finished, stopped or failed). */
	async start(): Promise<void> {
		if (!this.ready) return;
		// Updates of the folder cut off before are finished first (those found when Obsidian started,
		// then any other, §11.5 item 53.15); then the folder is looked at once more, as it is now (a
		// folder removed, renamed, added, or a section finished meanwhile).
		this.starting = true;
		this.changed();
		try {
			await this.hooks.beforeRun?.();
			await finishCutOff(this.app, this.folder);
			this.archives.clear();
			await this.lookUp();
		}
		catch (error) {
			if (this.open) this.folderError = message(error);
		}
		finally {
			this.starting = false;
		}
		if (!this.ready) {
			this.changed();
			return;
		}
		const included = this.included();
		const fresh = included.filter(choice => !choice.earlier);
		const updates = included.filter(choice => choice.earlier);
		const of = new Map(fresh.map(choice => [choice.notebook, choice]));
		const going = new Set(fresh.flatMap(choice => this.going(choice)));
		const toUpdate = updates.reduce((n, choice) => n + choice.notebook.sections.filter(section => this.isChosen(choice, section)).length, 0);
		const requests = updates.map(choice => {
			const chosen = choice.notebook.sections.filter(section => this.isChosen(choice, section));
			const deleted = (section: DownloadSection) => new Set(this.deletedPages(choice, section).map(page => page.id));
			return {
				input: choice.download.input,
				request: {
					notebook: choice.notebook,
					scanned: this.scanned(choice, STRINGS[choice.earlier!.language]),
					chosen: new Set(chosen.map(section => sectionKey(section.groups, section.label))),
					partial: !!choice.download.incomplete,
					restore: new Set(chosen.flatMap(section => [...choice.restore.get(section.path) ?? []].filter(id => deleted(section).has(id)))),
				},
			};
		});
		this.phase = 'running';
		this.running = updates.length ? 'update' : 'import';
		this.updateTotal = toUpdate;
		this.startedAt = Date.now();
		this.changed();
		try {
			let imported = 0;
			// This run's import, as its report gave it (an update after it adds to that last import).
			let joins: string | undefined;
			// Sections chosen from OneDrive come down first (notebooks updated were downloaded when checked).
			if (fresh.some(choice => choice.download.onedrive)) {
				await this.fetchChosen(fresh, going);
				this.changed();
			}
			if (fresh.length) {
				this.outcome = await runImport(this.app, this.client, {
					downloads: this.downloads.map(download => ({ input: download.input, notebooks: fresh.filter(choice => choice.download === download && choice.notebook.sections.some(section => going.has(section))).map(choice => choice.notebook) }))
						.filter(download => download.notebooks.length),
					root: this.folder,
					languageFor: notebook => of.get(notebook)?.earlier?.language ?? this.language,
					chosen: section => going.has(section),
					earlier: () => undefined,
					reportLanguage: this.readerLanguage,
					options: this.options,
					isCancelled: () => this.stopRequested,
					onProgress: progress => {
						this.progress = { ...progress, total: progress.total + toUpdate };
						imported = progress.total;
						this.changed();
					},
				});
				joins = this.outcome.report?.lastImport.at;
			}
			if (requests.length && !this.stopRequested && !this.outcome?.result.cancelled) {
				await this.hooks.updateStarting?.(this.folder);
				this.updateResult = await runUpdate(this.app, this.client, {
					root: this.folder,
					requests,
					reportLanguage: this.readerLanguage,
					defaults: this.options,
					sources: [...new Set(requests.map(({ input }) => downloadName(input)))],
					// The report's last import then covers this whole run, not only its update.
					...(joins !== undefined ? { joins } : {}),
					isCancelled: () => this.stopRequested,
					onProgress: progress => {
						this.progress = { ...progress, done: progress.done + imported, total: progress.total + imported };
						this.changed();
					},
				});
				if (this.updateResult) this.recordPath = new VaultSink(this.app, this.folder).vaultPath(this.updateResult.record);
				// Its journal is closed: nothing is left to finish at the next start.
				await this.hooks.updateEnded?.(this.folder);
			}
		}
		catch (error) {
			this.error = message(error);
			if (error instanceof AlreadyThereError) this.alreadyThere = error.names;
		}
		this.phase = 'finished';
		this.changed();
	}

	requestStop(): void {
		this.stopRequested = true;
		this.changed();
	}

	/** Ends a session that is not importing: stops the worker (which removes its temporary copies) and anything still reading. */
	dispose(): void {
		if (this.phase === 'running') return;
		this.disposed = true;
		for (const download of this.downloads) download.onedrive?.controller.abort();
		this.client.stop();
		this.listeners.clear();
	}
}
