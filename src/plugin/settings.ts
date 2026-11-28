// The settings page: a button to start an import, and the defaults each new import starts from.

import { homedir } from 'node:os';
import { AbstractInputSuggest, ButtonComponent, Modal, normalizePath, Notice, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type { App, Plugin, SettingDefinitionItem } from 'obsidian';
import type { SectionOptions } from '../core/importer.ts';
import { allCopies, copiesFolder, removeCopies, systemCacheFolder } from '../node/mirror.ts';
import { removeScans, scansFolder, scansSize } from '../node/scan-store.ts';
import type { MicrosoftAccount } from './account.ts';
import { formatBytes } from './i18n.ts';
import type { UiStrings } from './i18n.ts';
import { oneDriveMessage } from './onedrive.ts';

export interface Settings extends Required<SectionOptions> {
	/** The vault folder notebooks go into ('' for the top of the vault). */
	folder: string;
}

export const DEFAULT_SETTINGS: Settings = { folder: 'OneNote', boxMarkers: true, imageAltText: false };

/**
 * A folder as typed, made a vault path: `/` or `\\` between parts, no blank or `.` parts, no
 * spaces around parts; '' (or only slashes) for the top of the vault.
 */
export function cleanFolder(folder: string): string {
	const parts = folder.split(/[\\/]/).map(part => part.trim()).filter(part => part !== '' && part !== '.');
	return parts.length ? normalizePath(parts.join('/')) : '';
}

/** A part of a (cleaned) folder starts with a dot: `..` leaves the vault, `.name` is hidden from Obsidian. */
export function folderProblem(folder: string): boolean {
	return folder !== '' && folder.split('/').some(part => part.startsWith('.'));
}

/** Suggests the vault's folders while typing one. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private readonly input: HTMLInputElement;

	constructor(app: App, input: HTMLInputElement) {
		super(app, input);
		this.input = input;
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder && !file.isRoot() && file.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.input.dispatchEvent(new Event('input'));
		this.close();
	}
}

export interface SettingsHost extends Plugin {
	settings: Settings;
	ui: UiStrings;
	/** The Microsoft account OneDrive is read with. */
	microsoft: MicrosoftAccount;
	saveSettings(): Promise<void>;
	openWizard(): void;
}

export class FerrySettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;

	constructor(app: App, host: SettingsHost) {
		super(app, host);
		this.host = host;
	}

	/**
	 * The settings as Obsidian lists them (from 1.13), which also puts them in its settings search.
	 * The rows that show how things are on this computer (the account, the download cache) are
	 * filled each time they are shown.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const ui = this.host.ui;
		return [
			{
				name: ui.settingsImport,
				desc: ui.settingsImportDesc,
				render: setting => {
					setting.addButton(button => button.setButtonText(ui.startImport).setCta().onClick(() => {
						// Opened from here, the import window would sit in the settings window while the file
						// dialog comes up over the main one and hides it: the settings close first.
						(this.app as App & { setting?: { close?(): void } }).setting?.close?.();
						this.host.openWizard();
					}));
				},
			},
			{
				type: 'group',
				heading: ui.settingsDefaults,
				items: [
					// Empty means the top of the vault, so that is what the empty field says.
					{ name: ui.folder, desc: ui.folderDesc, control: { type: 'folder', key: 'folder', placeholder: ui.vaultTop, validate: value => (folderProblem(cleanFolder(value)) ? ui.badFolder : undefined) } },
					{ name: ui.boxMarkers, desc: ui.boxMarkersDesc, control: { type: 'toggle', key: 'boxMarkers' } },
					{ name: ui.pictureText, desc: ui.pictureTextDesc, control: { type: 'toggle', key: 'imageAltText' } },
				],
			},
			// Importing from OneDrive (§11.5 item 61): the Microsoft account, and the download cache.
			{
				type: 'group',
				heading: ui.settingsOneDrive,
				items: [
					{ name: ui.settingsAccount, render: setting => this.accountRow(setting) },
					{ name: ui.settingsCopy, render: setting => this.cacheRow(setting) },
				],
			},
		];
	}

	/** Stored through the plugin, which keeps more than these settings in its data; a folder as a vault path. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.host.settings;
		if (key === 'folder' && typeof value === 'string') settings.folder = cleanFolder(value);
		else if ((key === 'boxMarkers' || key === 'imageAltText') && typeof value === 'boolean') settings[key] = value;
		else return;
		await this.host.saveSettings();
	}

	/**
	 * The account: signed in or not, and while signed in, where its access is withdrawn (Microsoft's
	 * own page: signing out here only forgets the sign-in on this device).
	 */
	private accountRow(setting: Setting): void {
		const ui = this.host.ui;
		const account = this.host.microsoft;
		setting.setDesc(!account.signedIn ? ui.accountNone : createFragment(fragment => {
			const organization = account.kind === 'organization';
			fragment.appendText(`${organization ? ui.accountOrganization : ui.accountPersonal}${ui.accountRevoke.before}`);
			fragment.createEl('a', { text: ui.accountRevoke.link, href: organization ? 'https://myapps.microsoft.com' : 'https://account.live.com/consent/Manage' });
			fragment.appendText(ui.accountRevoke.after);
		}));
		if (account.signedIn) setting.addButton(button => button.setButtonText(ui.signOut).onClick(() => {
			account.signOut();
			this.update();
		}));
		else setting.addButton(button => button.setButtonText(ui.signIn).onClick(async () => {
			button.setDisabled(true);
			try {
				await account.signIn();
			}
			catch (error) {
				new Notice(oneDriveMessage(error, ui));
			}
			this.update();
		}));
	}

	/**
	 * The download cache (the notebooks downloaded from OneDrive, outside the vault): what it is for,
	 * how much it takes on this computer and where, and clearing it. What checks for updates kept of
	 * the sections (§11.5 item 90) is cleared with it: it holds page titles, also for downloads that
	 * did not come from OneDrive, so the button is there while either is (§11.5 item 99).
	 */
	private cacheRow(setting: Setting): void {
		const ui = this.host.ui;
		const folder = copiesFolder(systemCacheFolder());
		const scans = scansFolder(systemCacheFolder());
		const copies = allCopies(folder);
		const bytes = copies.reduce((n, copy) => n + copy.bytes, 0);
		const keptBytes = scansSize(scans);
		setting.setDesc(copies.length ? ui.copyDesc(formatBytes(bytes), shownPath(folder)) : keptBytes ? ui.copyChecksOnly : ui.copyNone);
		if (copies.length || keptBytes) setting.addButton(button => button.setButtonText(ui.deleteCopy).setDestructive().onClick(() => {
			new ConfirmModal(this.app, ui.deleteCopyTitle, ui.deleteCopyConfirm(formatBytes(bytes + keptBytes)), ui.deleteCopy, ui.cancel, async () => {
				await removeCopies(copies.map(copy => copy.dir));
				await removeScans(scans).catch(() => undefined);
				this.update();
			}).open();
		}));
	}
}

/** A folder as people read it: the home folder as `~` (not on Windows, where that is not how paths are written). */
function shownPath(path: string): string {
	const home = homedir();
	return process.platform !== 'win32' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Asks before something is done that cannot be undone. */
class ConfirmModal extends Modal {
	constructor(app: App, title: string, text: string, confirm: string, cancel: string, onConfirm: () => Promise<void>) {
		super(app);
		this.setTitle(title);
		this.contentEl.createEl('p', { text });
		const footer = this.contentEl.createDiv('modal-button-container');
		new ButtonComponent(footer).setButtonText(cancel).onClick(() => this.close());
		// Destructive, and the action the window is for.
		new ButtonComponent(footer).setButtonText(confirm).setDestructive().setCta().onClick(async () => {
			this.close();
			await onConfirm();
		});
	}
}
