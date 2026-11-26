// One update inside Obsidian (§11.5 item 49): the core's update, with each section converted in the
// worker into a folder outside the vault first, then put into the vault from the window. And the
// finishing of an update that was cut off (Obsidian quit, a crash), before anything else is done
// in that folder.

import type { App } from 'obsidian';
import type { DownloadSection } from '../core/download.ts';
import type { ImportProgress, SectionOptions, SectionResult } from '../core/importer.ts';
import { resumeUpdates, updateNotebooks } from '../core/update.ts';
import type { UpdateHost, UpdateRequest, UpdateResult } from '../core/update.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { stagingPlaces, sweepStaging } from '../node/staging.ts';
import type { StagingPlaces } from '../node/staging.ts';
import { FRESH_WORKER_AFTER_BYTES } from './run-import.ts';
import { VaultSink } from './vault-sink.ts';
import { ConverterStopped } from './worker-client.ts';
import type { WorkerClient } from './worker-client.ts';

declare const require: (id: string) => any;

export interface UpdateRunRequest {
	/** The vault folder the notebooks were imported into. */
	root: string;
	/** The notebooks to update, each with the download it is in (a zip or a folder outside the vault). */
	requests: { input: string, request: UpdateRequest }[];
	/** The reader's language: the record's and the report's. */
	reportLanguage: Language;
	/** How sections are converted when a notebook's report entry does not say. */
	defaults: SectionOptions;
	/** The downloads (file or folder names). */
	sources: string[];
	/** The run imported new notebooks first: the time its report gave that import. */
	joins?: string;
	isCancelled?(): boolean;
	onProgress?(progress: ImportProgress): void;
}

/** The plugin's staging folders, in the system's temporary folder. */
function staging(): StagingPlaces {
	return stagingPlaces(require('os').tmpdir());
}

/** Removes staging folders left long ago (Obsidian quit while a section was converted). */
export function sweepStagingFolders(): void {
	try {
		sweepStaging(require('os').tmpdir());
	}
	catch {
		// Nothing to sweep.
	}
}

/**
 * Finishes the updates of `root` that were cut off (§11.5 item 49.7): each section they were in is
 * finished, or put back as it was. Needs no worker. Answers the updates finished.
 */
export async function finishCutOff(app: App, root: string): Promise<UpdateResult[]> {
	const vault = new VaultSink(app, root);
	const { finished } = await resumeUpdates({ vault, ...staging(), listFolders: async () => vault.listFolders() });
	return finished;
}

/** Runs an update. Undefined when there was nothing to do (then nothing was written). */
export async function runUpdate(app: App, client: WorkerClient, request: UpdateRunRequest): Promise<UpdateResult | undefined> {
	const vault = new VaultSink(app, request.root);
	const places = staging();
	const inputOf = new Map<DownloadSection, string>();
	for (const { input, request: one } of request.requests) for (const section of one.notebook.sections) inputOf.set(section, input);

	const fresh = async () => {
		if (client.running) await client.close().catch(() => undefined);
		await client.start();
	};
	await fresh();
	const isCancelled = () => !!request.isCancelled?.();
	// A worker that cannot be started again: the sections left are not converted (and stay as they
	// are), with why; the update still ends with its links, report and record.
	let workerDown: string | undefined;
	const restart = async () => {
		if (isCancelled()) return;
		try {
			await fresh();
		}
		catch (error) {
			workerDown = String((error as Error)?.message ?? error).slice(0, 500);
		}
	};

	const host: UpdateHost = {
		vault,
		...places,
		parse: () => Promise.reject(new Error('sections are converted in the worker')),
		isPasswordProtected: async () => false,
		listFolders: async () => vault.listFolders(),
		isCancelled,
		onProgress: request.onProgress,
		async convertSection(section, dir, language, options, names, into): Promise<SectionResult> {
			if (workerDown !== undefined) throw new Error(workerDown);
			const path = places.pathOf(into);
			if (!path) throw new Error('no staging folder for this section');
			let result: SectionResult;
			try {
				if (!client.running) await client.start();
				result = await client.convert(inputOf.get(section)!, section, dir, language, options, { path, names });
			}
			catch (error) {
				// The worker failed on this section (out of memory, a crash in the parser) or was stopped:
				// the section stays as it is (the core says why), and the next one gets a fresh worker.
				const message = String(error instanceof ConverterStopped ? error.detail ?? error.message : (error as Error)?.message ?? error).slice(0, 500);
				await restart();
				throw new Error(message);
			}
			// WebAssembly memory only grows: a fresh worker after a large section hands it back.
			if (section.size > FRESH_WORKER_AFTER_BYTES) await restart();
			return result;
		},
	};
	try {
		return await updateNotebooks(request.requests.map(entry => entry.request), host, {
			at: new Date(),
			strings: STRINGS[request.reportLanguage],
			// Only notebooks imported before are updated here (new ones are imported first).
			languageFor: () => request.reportLanguage,
			defaults: request.defaults,
			links: true,
			sources: request.sources,
			...(request.joins !== undefined ? { joins: request.joins } : {}),
		});
	}
	finally {
		// Removes the worker's temporary copies, then hands the parser's memory back.
		if (client.running) await client.close().catch(() => undefined);
		client.stop();
	}
}
