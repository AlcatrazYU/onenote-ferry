// The Obsidian plugin. M2 step 3: a plain import command (pick a download, convert it into the
// vault, see progress in the status bar, stop between sections). The wizard comes in step 4.

import { Notice, Plugin } from 'obsidian';
import * as obsidian from 'obsidian';
import type { ImportProgress } from '../core/importer.ts';
import { markerLanguageFor } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { uiStrings } from './i18n.ts';
import { ProgressDisplay } from './progress.ts';
import { existingNotebooks, runImport } from './run-import.ts';
import { WorkerClient } from './worker-client.ts';

declare const require: (id: string) => any;

/** Where imported notebooks go by default (a setting in step 4). */
const DEFAULT_ROOT = 'OneNote';

/** Obsidian's interface language: getLanguage() from 1.8.7, the same setting read directly before. */
function interfaceLanguage(): string {
	const get = (obsidian as { getLanguage?: () => string }).getLanguage;
	if (typeof get === 'function') return get();
	try {
		return window.localStorage.getItem('language') ?? 'en';
	}
	catch {
		return 'en';
	}
}

export default class OneNoteFerryPlugin extends Plugin {
	private readonly client = new WorkerClient();
	private importing = false;
	private cancelRequested = false;
	private progress?: ProgressDisplay;

	async onload(): Promise<void> {
		this.addCommand({ id: 'import', name: 'Import from OneNote (test)', callback: () => void this.pickAndImport() });
		this.addCommand({
			id: 'cancel-import',
			name: 'Stop the OneNote import after the current section',
			checkCallback: checking => {
				if (!this.importing) return false;
				if (!checking) this.cancelRequested = true;
				return true;
			},
		});
	}

	onunload(): void {
		this.cancelRequested = true;
		this.client.stop('the plugin was turned off');
		this.progress?.finish();
	}

	/** The system's own open dialog: a zip or a folder outside the vault. */
	private async pick(): Promise<string | undefined> {
		try {
			const { remote } = require('electron');
			const result = await remote.dialog.showOpenDialog({
				title: 'Pick a OneDrive download (zip or folder)',
				// Only macOS lets one dialog pick either a file or a folder (step 4 offers both elsewhere).
				properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openDirectory'],
			});
			return result.canceled ? undefined : result.filePaths[0];
		}
		catch (error) {
			new Notice(`The open dialog is not available: ${String(error)}`);
			return undefined;
		}
	}

	private async pickAndImport(): Promise<void> {
		const input = await this.pick();
		if (!input) return;
		try {
			const summary = await this.importFrom(input);
			new Notice(summary.cancelled
				? `OneNote import stopped: ${summary.sections} sections converted.`
				: `OneNote import done: ${summary.sections} sections, ${summary.pages} pages, ${summary.failed} not converted.`, 0);
		}
		catch (error) {
			new Notice(`OneNote import failed: ${String((error as Error)?.message ?? error)}`, 0);
		}
	}

	/**
	 * Imports a download into the vault folder `root`. Also used from the developer console to test
	 * the plugin; answers counts, time and the longest stall of Obsidian's window meanwhile.
	 */
	async importFrom(input: string, root = DEFAULT_ROOT) {
		if (this.importing) throw new Error('An import is already running.');
		this.importing = true;
		this.cancelRequested = false;
		const started = performance.now();
		const startedAt = Date.now();
		const progress = new ProgressDisplay(this, uiStrings(interfaceLanguage()));
		this.progress = progress;
		let last = performance.now(), longest = 0;
		const timer = window.setInterval(() => {
			const now = performance.now();
			longest = Math.max(longest, now - last - 100);
			last = now;
		}, 100);
		try {
			const language: Language = markerLanguageFor(interfaceLanguage());
			await this.client.start();
			const notebooks = await this.client.open(input);
			await this.client.close();
			this.client.stop();
			const clash = existingNotebooks(this.app, { notebooks, root, language });
			if (clash.length) throw new Error(`already in ${root}: ${clash.join(', ')} (nothing was written)`);
			const result = await runImport(this.app, this.client, {
				input, notebooks, root, language,
				options: { boxMarkers: true, keepFontColor: true, imageAltText: false },
				isCancelled: () => this.cancelRequested,
				onProgress: (p: ImportProgress) => progress.update({ done: p.done, total: p.total, notebook: p.notebook, section: p.section.label, startedAt }),
			});
			const sections = result.notebooks.flatMap(n => n.sections);
			return {
				seconds: Math.round((performance.now() - started) / 100) / 10,
				longestStallMs: Math.round(Math.max(0, longest)),
				cancelled: result.cancelled,
				notebooks: result.notebooks.length,
				sections: sections.filter(s => s.report).length,
				pages: sections.reduce((n, s) => n + (s.report?.pageCount ?? 0), 0),
				failed: sections.filter(s => s.failed).length,
				links: result.links,
			};
		}
		finally {
			window.clearInterval(timer);
			this.importing = false;
			progress.finish();
			this.progress = undefined;
		}
	}

	/** For testing from the developer console: ask the running import to stop after its current section. */
	requestStop(): void {
		this.cancelRequested = true;
	}
}
