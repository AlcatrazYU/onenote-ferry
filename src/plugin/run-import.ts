// One import inside Obsidian: the core's import flow, with each section converted in the worker
// and every file written into the vault from the window.

import type { App } from 'obsidian';
import type { DownloadNotebook } from '../core/download.ts';
import { importNotebooks } from '../core/importer.ts';
import type { ImportHost, ImportProgress, ImportResult, SectionOptions, SectionResult } from '../core/importer.ts';
import { joinPath } from '../core/names.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { failedSectionToc, notebookFolder, sectionFolder } from '../core/write.ts';
import { VaultSink } from './vault-sink.ts';
import type { WorkerClient } from './worker-client.ts';

/**
 * WebAssembly memory only grows: after a section this large the worker is replaced by a fresh one,
 * so the memory a big section took is handed back (about 2.6 GB for the largest one measured).
 */
const FRESH_WORKER_AFTER_BYTES = 256 * 1024 * 1024;

export interface ImportRequest {
	/** The download: a zip or a folder outside the vault. */
	input: string;
	notebooks: DownloadNotebook[];
	/** The vault folder the notebooks go under. */
	root: string;
	language: Language;
	options: SectionOptions;
	isCancelled?(): boolean;
	onProgress?(progress: ImportProgress): void;
}

/** Notebook folders that are already there under the root (an import never writes over them). */
export function existingNotebooks(app: App, request: Pick<ImportRequest, 'notebooks' | 'root' | 'language'>): string[] {
	const sink = new VaultSink(app, request.root);
	return request.notebooks.map(notebook => notebookFolder(notebook.name, STRINGS[request.language])).filter(folder => sink.exists(folder));
}

export async function runImport(app: App, client: WorkerClient, request: ImportRequest): Promise<ImportResult> {
	const sink = new VaultSink(app, request.root);
	const strings = STRINGS[request.language];
	const clash = existingNotebooks(app, request);
	if (clash.length) throw new Error(`Already in ${request.root || 'the vault'}: ${clash.join(', ')}`);

	const fresh = async () => {
		if (client.running) await client.close().catch(() => undefined);
		await client.start();
		await client.open(request.input);
	};
	await fresh();
	client.sink = sink;

	const host: ImportHost = {
		sink,
		parse: () => Promise.reject(new Error('sections are converted in the worker')),
		isPasswordProtected: async () => false,
		listFolders: async () => sink.listFolders(),
		isCancelled: request.isCancelled,
		onProgress: request.onProgress,
		async convertSection(section, notebookDir, language, options): Promise<SectionResult> {
			try {
				const result = await client.convert(section, notebookDir, language, options);
				if (section.size > FRESH_WORKER_AFTER_BYTES) await fresh();
				return result;
			}
			catch (error) {
				// The worker failed on this section (out of memory, a crash in the parser): note it
				// where the section would be, and go on with a fresh worker.
				const message = String((error as Error)?.message ?? error).slice(0, 500);
				const dir = joinPath(notebookDir, sectionFolder(section.groups, section.label, STRINGS[language]));
				await sink.ensureFolder(dir);
				await sink.writeText(joinPath(dir, `${STRINGS[language].tocFileName}.md`), failedSectionToc(section.label, STRINGS[language].conversionFailedNote(message), STRINGS[language]));
				await fresh();
				return { groups: section.groups, section: section.label, failed: true, error: message };
			}
		},
	};
	try {
		const result = await importNotebooks(request.notebooks, host, { languageFor: () => request.language, ...request.options, links: true });
		const summary = result.notebooks.map(notebook => ({ notebook: notebook.notebook, sections: notebook.sections }));
		await sink.writeText(strings.reportFileName, JSON.stringify({ links: result.links, cancelled: result.cancelled, notebooks: summary }, null, 2));
		return result;
	}
	finally {
		client.sink = undefined;
		// Removes the worker's temporary copies, then hands the parser's memory back.
		if (client.running) await client.close().catch(() => undefined);
		client.stop();
	}
}
