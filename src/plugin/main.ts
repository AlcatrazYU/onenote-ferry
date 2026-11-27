// The Obsidian plugin: an import wizard (from the ribbon, the command palette or the settings
// page) that converts OneDrive-downloaded OneNote notebooks into the vault, with progress in the
// status bar and a report at the end. The same window updates notebooks imported before from a new
// download (§11.5 item 49); an update cut off (Obsidian quit) is finished when Obsidian starts.

import { Notice, Plugin, requestUrl } from 'obsidian';
import * as obsidian from 'obsidian';
import { markerLanguageFor } from '../core/strings.ts';
import { findRemoteNotebooks } from '../core/onedrive.ts';
import { copyRoot, systemCacheFolder, updateCopy } from '../node/mirror.ts';
import { MicrosoftAccount } from './account.ts';
import { driveOf, graphFor, linkFor, oneDriveAccess, streamingFetch } from './onedrive.ts';
import type { OneDriveBrowse } from './onedrive.ts';
import { ICON, registerIcon } from './icon.ts';
import { uiStrings } from './i18n.ts';
import type { UiStrings } from './i18n.ts';
import { ProgressDisplay } from './progress.ts';
import { finishCutOff, sweepStagingFolders } from './run-update.ts';
import { ImportSession } from './session.ts';
import type { Entry, SessionHooks } from './session.ts';
import { cleanFolder, DEFAULT_SETTINGS, FerrySettingTab, folderProblem } from './settings.ts';
import type { Settings, SettingsHost } from './settings.ts';
import { ImportWizard } from './wizard.ts';
import type { WizardHost } from './wizard.ts';
import { VaultSink } from './vault-sink.ts';
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
	/** The Microsoft account to download with (M3.5, §11.5 item 61). */
	readonly microsoft = new MicrosoftAccount(this.app, () => ({ title: this.ui.signInPageTitle, done: this.ui.signInPageDone, failed: this.ui.signInPageFailed }));
	/** The import being set up, running, or finished and not looked at yet. */
	private session?: ImportSession;
	private wizard?: ImportWizard;
	private progress?: ProgressDisplay;
	/** The notice that an import ended while the wizard was hidden (gone once the result is seen). */
	private resultNotice?: Notice;
	/** Turned off: an import that is still winding down shows nothing more. */
	private unloaded = false;
	/**
	 * Target folders with an update under way (kept in the plugin's data): one cut off by Obsidian
	 * quitting is finished when Obsidian starts again (§11.5 item 49.7).
	 */
	private pendingUpdates: string[] = [];
	/** The updates cut off before, being finished (an import waits for it). */
	private finishing: Promise<void> = Promise.resolve();
	private readonly hooks: SessionHooks = {
		beforeRun: () => this.finishing,
		updateStarting: async root => {
			if (this.pendingUpdates.includes(root)) return;
			this.pendingUpdates.push(root);
			await this.saveSettings();
		},
		updateEnded: async root => {
			this.pendingUpdates = this.pendingUpdates.filter(other => other !== root);
			await this.saveSettings();
		},
	};

	async onload(): Promise<void> {
		this.ui = uiStrings(interfaceLanguage());
		await this.loadSettings();
		registerIcon();
		this.addRibbonIcon(ICON, this.ui.commandImport, () => this.openWizard());
		this.addCommand({ id: 'import', name: this.ui.commandImport, callback: () => this.openWizard() });
		this.addCommand({ id: 'check-updates', name: this.ui.commandUpdate, callback: () => this.openWizard('update') });
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
		// Once Obsidian has started: scratch folders an earlier run could not remove (Obsidian quit
		// during an import), updates it cut off, then staging folders left long ago.
		this.app.workspace.onLayoutReady(() => {
			WorkerClient.sweep();
			this.finishing = this.finishCutOffUpdates().finally(() => sweepStagingFolders());
		});
	}

	/** Finishes the updates Obsidian quitting cut off (each section finished or put back), and says so. */
	private async finishCutOffUpdates(): Promise<void> {
		for (const root of [...this.pendingUpdates]) {
			if (this.unloaded) return;
			try {
				const finished = await finishCutOff(this.app, root);
				this.pendingUpdates = this.pendingUpdates.filter(other => other !== root);
				await this.saveSettings();
				for (const result of finished) {
					const notice = new Notice(this.ui.resumedNotice, 0);
					const record = new VaultSink(this.app, root).vaultPath(result.record);
					const el = (notice as { containerEl?: HTMLElement }).containerEl ?? notice.noticeEl;
					el.addEventListener('click', () => {
						const file = this.app.vault.getFileByPath(record);
						if (file) void this.app.workspace.getLeaf(true).openFile(file);
					});
				}
			}
			catch (error) {
				// Tried again at the next start; an update of this folder finishes it first too.
				new Notice(this.ui.resumeFailed(String((error as Error)?.message ?? error)), 0);
			}
		}
	}

	onunload(): void {
		this.unloaded = true;
		this.microsoft.cancelSignIn();
		this.session?.requestStop();
		this.client.stop('unloaded');
		this.progress?.finish();
		this.resultNotice?.hide();
		this.wizard?.close();
	}

	/** The saved settings, each kept only when it is of the right kind (the file may have been edited by hand). */
	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const flag = (key: 'boxMarkers' | 'imageAltText') => typeof saved[key] === 'boolean' ? saved[key] as boolean : DEFAULT_SETTINGS[key];
		const folder = typeof saved.folder === 'string' ? cleanFolder(saved.folder) : DEFAULT_SETTINGS.folder;
		this.settings = {
			folder: folderProblem(folder) ? DEFAULT_SETTINGS.folder : folder,
			boxMarkers: flag('boxMarkers'),
			imageAltText: flag('imageAltText'),
		};
		this.pendingUpdates = Array.isArray(saved.pendingUpdates) ? saved.pendingUpdates.filter((root): root is string => typeof root === 'string' && !folderProblem(root)) : [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ ...this.settings, ...(this.pendingUpdates.length ? { pendingUpdates: this.pendingUpdates } : {}) });
	}

	/** Opens the wizard: on the import that is running or just finished, or for a new one (to import, or to check for updates). */
	openWizard(entry: Entry = 'import'): void {
		if (this.wizard || this.unloaded) return;
		this.resultNotice?.hide();
		this.resultNotice = undefined;
		this.session ??= new ImportSession(this.app, this.client, this.settings, markerLanguageFor(interfaceLanguage()), entry, this.hooks);
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
			const d = session.downloading;
			const p = session.progress;
			if (d) progress.update({ done: d.totalSections ? d.sections : d.files, total: d.totalSections || d.totalFiles, notebook: this.ui.oneDrive, section: d.current ?? '', startedAt: session.startedAt, downloading: true });
			else if (p) progress.update({ done: p.done, total: p.total, notebook: p.notebook, section: p.section.label, startedAt: session.startedAt, updating: session.running === 'update' });
		});
		void session.start().finally(() => {
			off();
			progress.finish();
			this.progress = undefined;
			// Not started after all (the target folder changed as it was looked at once more), or seen in the window.
			if (this.unloaded || this.wizard || this.session !== session || session.phase !== 'finished') return;
			// Finished while the wizard was hidden: a notice that leads to the result.
			const update = session.running === 'update';
			const stopped = !!session.outcome?.result.cancelled || !!session.updateResult?.cancelled || (update && session.stopRequested && !session.updateResult);
			const outcome = session.error ? update ? this.ui.updateFailed : this.ui.failed
				: stopped ? update ? this.ui.updateStopped : this.ui.stopped
				: update ? this.ui.updateFinished : this.ui.finished;
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
		const session = new ImportSession(this.app, this.client, { ...this.settings, folder: root }, markerLanguageFor(interfaceLanguage()), 'import', this.hooks);
		this.session = session;
		try {
			await session.add(inputs);
			await session.whenSettled();
			if (!session.ready) throw new Error(session.included().length ? 'Two notebooks would get the same folder, or the folder name starts with a dot.' : 'Nothing to import or update: nothing changed, or no download could be read.');
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
			const result = session.outcome?.result;
			const sections = result?.notebooks.flatMap(notebook => notebook.sections) ?? [];
			const update = session.updateResult;
			return {
				seconds: Math.round((Date.now() - session.startedAt) / 100) / 10,
				cancelled: !!result?.cancelled || !!update?.cancelled,
				notebooks: result?.notebooks.length ?? 0,
				sections: sections.filter(section => section.report).length,
				pages: sections.reduce((n, section) => n + (section.report?.pageCount ?? 0), 0),
				failed: sections.filter(section => section.failed).length,
				report: session.outcome?.reportPath,
				...(update ? { update: { counts: update.counts, attention: update.attention, outcomes: update.outcomes, record: session.recordPath } } : {}),
			};
		}
		finally {
			if (this.session === session) {
				session.dispose();
				this.session = undefined;
			}
		}
	}

	/**
	 * For testing from the developer console (M3.5 step 1): signs in to Microsoft when not signed in
	 * (or when asked), then reads what kind of drive the account has, to see the whole way work.
	 * Answers nothing that names the person.
	 */
	async microsoftCheck(signIn = false) {
		if (signIn || !this.microsoft.signedIn) await this.microsoft.signIn();
		const token = await this.microsoft.accessToken();
		const response = await requestUrl({ url: 'https://graph.microsoft.com/v1.0/me/drive?$select=driveType', headers: { Authorization: `Bearer ${token}` }, throw: false });
		let driveType: unknown;
		try {
			driveType = (response.json as { driveType?: unknown }).driveType;
		}
		catch {
			driveType = undefined;
		}
		return { kind: this.microsoft.kind, status: response.status, driveType, kept: !!this.app.secretStorage.getSecret('onenote-ferry-microsoft') };
	}

	/** OneDrive through the signed-in account, for the import window (Internal-10 §22.1). */
	oneDrive(): OneDriveBrowse {
		return oneDriveAccess(this.app, this.microsoft, this.manifest.version, this.ui);
	}

	/**
	 * For testing from the developer console (M3.5 step 3): brings the local copy of the OneDrive
	 * notebooks named (all when none) up to date, and answers what it did.
	 */
	async microsoftCopy(names?: string[]) {
		const graph = graphFor(this.microsoft, this.manifest.version);
		const drive = await driveOf(graph);
		const notebooks = await findRemoteNotebooks(graph);
		const root = copyRoot(systemCacheFolder(), drive.id);
		const copied = [];
		for (const notebook of notebooks.filter(n => !names || names.includes(n.name))) {
			const started = Date.now();
			const result = await updateCopy({ graph, fetch: streamingFetch, root, notebook, link: linkFor(graph) });
			copied.push({ name: notebook.name, seconds: Math.round((Date.now() - started) / 100) / 10, downloaded: result.downloaded, bytes: result.bytes, moved: result.moved, removed: result.removed, same: result.same, failed: result.failed, folder: result.folder });
		}
		return { driveType: drive.driveType, notebooks: notebooks.length, root, copied };
	}

	/** For testing from the developer console: ask the running import to stop after its current section. */
	requestStop(): void {
		this.session?.requestStop();
	}
}
