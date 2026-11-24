// One import inside Obsidian: the core's import flow, with each section converted in the worker
// and every file written into the vault from the window. One import can take several downloads
// (notebooks from different OneDrive folders, or a fresh download next to an older one), so links
// between their notebooks are fixed too.

import type { App } from 'obsidian';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import { importNotebooks } from '../core/importer.ts';
import type { EarlierNotebook, ImportHost, ImportProgress, ImportResult, SectionOptions, SectionResult } from '../core/importer.ts';
import { joinPath } from '../core/names.ts';
import { writeReport } from '../core/report.ts';
import type { ImportReport } from '../core/report.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language, Strings } from '../core/strings.ts';
import { failedSectionToc, notebookFolder } from '../core/write.ts';
import { VaultSink } from './vault-sink.ts';
import { ConverterStopped } from './worker-client.ts';
import type { WorkerClient } from './worker-client.ts';

/**
 * WebAssembly memory only grows: after a section this large the worker is replaced by a fresh one,
 * so the memory a big section took is handed back (about 2.6 GB for the largest one measured).
 */
const FRESH_WORKER_AFTER_BYTES = 256 * 1024 * 1024;

export interface ImportDownload {
	/** A zip or a folder outside the vault. */
	input: string;
	/** The notebooks to import from it (names distinct across all downloads: see distinctNames). */
	notebooks: DownloadNotebook[];
}

export interface ImportRequest {
	downloads: ImportDownload[];
	/** The vault folder the notebooks go under. */
	root: string;
	/** The language of a notebook's marks and folder names. */
	languageFor(notebook: DownloadNotebook): Language;
	/** Whether a section is to be imported (all are when not given). */
	chosen?(section: DownloadSection): boolean;
	/** What an earlier import wrote of a notebook: sections are added to it. */
	earlier?(notebook: DownloadNotebook): EarlierNotebook | undefined;
	/** The reader's language: the report's. */
	reportLanguage: Language;
	options: SectionOptions;
	isCancelled?(): boolean;
	onProgress?(progress: ImportProgress): void;
}

export interface ImportOutcome {
	result: ImportResult;
	/** None when nothing was written (stopped before the first notebook). */
	report?: ImportReport;
	/** The report page, as a vault path. */
	reportPath?: string;
}

/** Notebooks whose folders were found in the target folder when the import started: nothing was written. */
export class AlreadyThereError extends Error {
	readonly names: string[];

	constructor(names: string[]) {
		super(`Already in the target folder: ${names.join(', ')}`);
		this.names = names;
	}
}

/** The file or folder name of a download, without the folders above it. */
export const downloadName = (input: string) => input.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? input;

/** The notebooks whose folder is already there under the root (an import never writes over them). */
export function existingNotebooks(app: App, root: string, notebooks: DownloadNotebook[], languageFor: (notebook: DownloadNotebook) => Language): DownloadNotebook[] {
	const sink = new VaultSink(app, root);
	return notebooks.filter(notebook => sink.hasChild(notebookFolder(notebook.name, STRINGS[languageFor(notebook)])));
}

export async function runImport(app: App, client: WorkerClient, request: ImportRequest): Promise<ImportOutcome> {
	const started = Date.now();
	const sink = new VaultSink(app, request.root);
	const notebooks = request.downloads.flatMap(download => download.notebooks);
	// A folder that is there must be the earlier import of that notebook (found when the import was set up).
	const clash = existingNotebooks(app, request.root, notebooks.filter(notebook => !request.earlier?.(notebook)), request.languageFor);
	if (clash.length) throw new AlreadyThereError(clash.map(notebook => notebook.name));
	const inputOf = new Map<DownloadSection, string>();
	for (const download of request.downloads) {
		for (const section of download.notebooks.flatMap(notebook => notebook.sections)) inputOf.set(section, download.input);
	}

	// A fresh worker opens the downloads again as it needs them.
	const fresh = async () => {
		if (client.running) await client.close().catch(() => undefined);
		await client.start();
	};
	await fresh();
	client.sink = sink;
	// A worker that cannot be started again: the sections left are noted as failed, with why, and the
	// import still ends with its tables of contents and report.
	let workerDown: string | undefined;
	const isCancelled = () => !!request.isCancelled?.();
	const restart = async () => {
		if (isCancelled()) return;
		try {
			await fresh();
		}
		catch (error) {
			workerDown = String((error as Error)?.message ?? error).slice(0, 500);
		}
	};
	// The section's folder gets a page that says why it was not converted (the notebook's contents page links to it).
	const failed = async (section: DownloadSection, dir: string, strings: Strings, message: string): Promise<SectionResult> => {
		try {
			await sink.ensureFolder(dir);
			await sink.writeText(joinPath(dir, `${strings.tocFileName}.md`), failedSectionToc(section.label, strings.conversionFailedNote(message), strings));
		}
		catch {
			// The vault refused the folder or the page too: the notebook's contents page still says it failed.
		}
		return { groups: section.groups, section: section.label, failed: true, error: message };
	};
	const reportStrings = STRINGS[request.reportLanguage];
	const sourceOf = new Map(request.downloads.flatMap(download => download.notebooks.map(notebook =>
		[notebookFolder(notebook.name, STRINGS[request.languageFor(notebook)]), downloadName(download.input)] as const)));
	const meta = (unfinished: boolean) => ({
		at: new Date(started),
		sources: request.downloads.map(download => downloadName(download.input)),
		sourceOf: (dir: string) => sourceOf.get(dir),
		seconds: Math.round((Date.now() - started) / 1000),
		options: request.options,
		...(unfinished ? { unfinished: true as const } : {}),
	});

	const host: ImportHost = {
		sink,
		parse: () => Promise.reject(new Error('sections are converted in the worker')),
		isPasswordProtected: async () => false,
		listFolders: async () => sink.listFolders(),
		isCancelled,
		onProgress: request.onProgress,
		async convertSection(section, dir, language, options): Promise<SectionResult> {
			const strings = STRINGS[language];
			if (workerDown !== undefined) return failed(section, dir, strings, workerDown);
			let result: SectionResult;
			try {
				if (!client.running) await client.start();
				result = await client.convert(inputOf.get(section)!, section, dir, language, options);
			}
			catch (error) {
				// Stopped while converting it (the plugin turned off): it counts with the sections the stop left out.
				if (error instanceof ConverterStopped && isCancelled()) return { groups: section.groups, section: section.label, cancelled: true };
				// The worker failed on this section (out of memory, a crash in the parser, a page the vault
				// refused), or could not start: note it where the section would be (its contents page then
				// says it failed, so it may be imported again), and go on with a fresh worker.
				const message = String(error instanceof ConverterStopped ? error.detail ?? error.message : (error as Error)?.message ?? error).slice(0, 500);
				const noted = await failed(section, dir, strings, message);
				await restart();
				return noted;
			}
			// The section is written: replacing the worker afterwards cannot undo it.
			if (section.size > FRESH_WORKER_AFTER_BYTES) await restart();
			return result;
		},
		// After each section the report records what is done so far, marked unfinished: an import cut
		// off half way (Obsidian quit, a crash) is not lost to the next one, and the page says so.
		async checkpoint(sofar) {
			try {
				await writeReport(sink, reportStrings, sofar, meta(true), await sink.listFolders());
			}
			catch {
				// The report is written at the end anyway.
			}
		},
	};
	try {
		const result = await importNotebooks(notebooks, host, { languageFor: request.languageFor, chosen: request.chosen, earlier: request.earlier, ...request.options, links: true });
		// Stopped before the first notebook: nothing was written, and no report (or folder) is made for it.
		if (!result.notebooks.length) return { result };
		const { report, name } = await writeReport(sink, reportStrings, result, meta(false), await sink.listFolders());
		return { result, report, reportPath: sink.vaultPath(`${name}.md`) };
	}
	finally {
		client.sink = undefined;
		// Removes the worker's temporary copies, then hands the parser's memory back.
		if (client.running) await client.close().catch(() => undefined);
		client.stop();
	}
}
