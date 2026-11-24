// The Obsidian plugin: an import wizard (from the ribbon, the command palette or the settings
// page) that converts OneDrive-downloaded OneNote notebooks into the vault, with progress in the
// status bar and a report at the end.

import { Notice, Plugin } from 'obsidian';
import * as obsidian from 'obsidian';
import { markerLanguageFor } from '../core/strings.ts';
import { ICON, registerIcon } from './icon.ts';
import { uiStrings } from './i18n.ts';
import type { UiStrings } from './i18n.ts';
import { ProgressDisplay } from './progress.ts';
import { ImportSession } from './session.ts';
import { cleanFolder, DEFAULT_SETTINGS, FerrySettingTab, folderProblem } from './settings.ts';
import type { Settings, SettingsHost } from './settings.ts';
import { ImportWizard } from './wizard.ts';
import type { WizardHost } from './wizard.ts';
import { WorkerClient } from './worker-client.ts';

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

export default class OneNoteFerryPlugin extends Plugin implements SettingsHost, WizardHost {
	settings: Settings = { ...DEFAULT_SETTINGS };
	ui: UiStrings = uiStrings('en');
	private readonly client = new WorkerClient();
	/** The import being set up, running, or finished and not looked at yet. */
	private session?: ImportSession;
	private wizard?: ImportWizard;
	private progress?: ProgressDisplay;
	/** The notice that an import ended while the wizard was hidden (gone once the result is seen). */
	private resultNotice?: Notice;
	/** Turned off: an import that is still winding down shows nothing more. */
	private unloaded = false;

	async onload(): Promise<void> {
		this.ui = uiStrings(interfaceLanguage());
		await this.loadSettings();
		registerIcon();
		this.addRibbonIcon(ICON, this.ui.commandImport, () => this.openWizard());
		this.addCommand({ id: 'import', name: this.ui.commandImport, callback: () => this.openWizard() });
		this.addCommand({
			id: 'stop-import',
			name: this.ui.commandStop,
			checkCallback: checking => {
				const session = this.session;
				if (session?.phase !== 'running' || session.stopRequested) return false;
				if (!checking) session.requestStop();
				return true;
			},
		});
		this.addSettingTab(new FerrySettingTab(this.app, this));
		// Scratch folders an earlier run could not remove (Obsidian quit during an import), once Obsidian has started.
		this.app.workspace.onLayoutReady(() => WorkerClient.sweep());
	}

	onunload(): void {
		this.unloaded = true;
		this.session?.requestStop();
		this.client.stop('unloaded');
		this.progress?.finish();
		this.resultNotice?.hide();
		this.wizard?.close();
	}

	/** The saved settings, each kept only when it is of the right kind (the file may have been edited by hand). */
	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const flag = (key: 'boxMarkers' | 'keepFontColor' | 'imageAltText') => typeof saved[key] === 'boolean' ? saved[key] as boolean : DEFAULT_SETTINGS[key];
		const folder = typeof saved.folder === 'string' ? cleanFolder(saved.folder) : DEFAULT_SETTINGS.folder;
		this.settings = {
			folder: folderProblem(folder) ? DEFAULT_SETTINGS.folder : folder,
			boxMarkers: flag('boxMarkers'),
			keepFontColor: flag('keepFontColor'),
			imageAltText: flag('imageAltText'),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Opens the wizard: on the import that is running or just finished, or for a new one. */
	openWizard(): void {
		if (this.wizard || this.unloaded) return;
		this.resultNotice?.hide();
		this.resultNotice = undefined;
		this.session ??= new ImportSession(this.app, this.client, this.settings, markerLanguageFor(interfaceLanguage()));
		this.wizard = new ImportWizard(this.app, this, this.session);
		this.wizard.open();
	}

	wizardClosed(wizard: ImportWizard): void {
		if (this.wizard === wizard) this.wizard = undefined;
		// Closed before the import, or after looking at its result: start afresh next time.
		if (this.session === wizard.session && this.session.phase !== 'running') {
			this.session.dispose();
			this.session = undefined;
		}
	}

	startImport(session: ImportSession): void {
		if (session !== this.session || session.phase !== 'setup' || !session.ready) return;
		const progress = new ProgressDisplay(this, this.ui, () => this.openWizard());
		this.progress = progress;
		const off = session.onChange(() => {
			const p = session.progress;
			if (p) progress.update({ done: p.done, total: p.total, notebook: p.notebook, section: p.section.label, startedAt: session.startedAt });
		});
		void session.start().finally(() => {
			off();
			progress.finish();
			this.progress = undefined;
			// Not started after all (the target folder changed as it was looked at once more), or seen in the window.
			if (this.unloaded || this.wizard || this.session !== session || session.phase !== 'finished') return;
			// Finished while the wizard was hidden: a notice that leads to the result.
			const outcome = session.error ? this.ui.failed : session.outcome?.result.cancelled ? this.ui.stopped : this.ui.finished;
			const notice = new Notice(this.ui.finishedNotice(outcome), 0);
			this.resultNotice = notice;
			const el = (notice as { containerEl?: HTMLElement }).containerEl ?? notice.noticeEl;
			el.addEventListener('click', () => this.openWizard());
		});
	}

	/**
	 * For testing from the developer console: imports every notebook of some downloads into `root`,
	 * with the default options and no wizard, and answers what the wizard would show at the end.
	 */
	async importFrom(inputs: string[], root = this.settings.folder) {
		if (this.session) throw new Error(this.session.phase === 'running' ? this.ui.alreadyRunning : 'Close the import wizard (or open the finished import) first.');
		const session = new ImportSession(this.app, this.client, { ...this.settings, folder: root }, markerLanguageFor(interfaceLanguage()));
		this.session = session;
		try {
			await session.add(inputs);
			await session.whenSettled();
			if (!session.ready) throw new Error(session.included().length ? 'Two notebooks would get the same folder, or the folder name starts with a dot.' : 'Nothing to import: every notebook is in the folder already, or no download could be read.');
			const finished = new Promise<void>(resolve => {
				const off = session.onChange(() => {
					if (session.phase !== 'finished') return;
					off();
					resolve();
				});
			});
			this.startImport(session);
			await finished;
			if (session.error) throw new Error(session.error);
			const result = session.outcome!.result;
			const sections = result.notebooks.flatMap(notebook => notebook.sections);
			return {
				seconds: Math.round((Date.now() - session.startedAt) / 100) / 10,
				cancelled: result.cancelled,
				notebooks: result.notebooks.length,
				sections: sections.filter(section => section.report).length,
				pages: sections.reduce((n, section) => n + (section.report?.pageCount ?? 0), 0),
				failed: sections.filter(section => section.failed).length,
				report: session.outcome!.reportPath,
			};
		}
		finally {
			if (this.session === session) {
				session.dispose();
				this.session = undefined;
			}
		}
	}

	/** For testing from the developer console: ask the running import to stop after its current section. */
	requestStop(): void {
		this.session?.requestStop();
	}
}
