// The settings page: a button to start an import, and the defaults each new import starts from.

import { AbstractInputSuggest, normalizePath, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import type { SectionOptions } from '../core/importer.ts';
import type { UiStrings } from './i18n.ts';

export interface Settings extends Required<SectionOptions> {
	/** The vault folder notebooks go into ('' for the top of the vault). */
	folder: string;
}

export const DEFAULT_SETTINGS: Settings = { folder: 'OneNote', boxMarkers: true, keepFontColor: true, imageAltText: false };

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
	saveSettings(): Promise<void>;
	openWizard(): void;
}

export class FerrySettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;

	constructor(app: App, host: SettingsHost) {
		super(app, host);
		this.host = host;
	}

	display(): void {
		const { containerEl } = this;
		const ui = this.host.ui;
		const settings = this.host.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName(ui.settingsImport)
			.setDesc(ui.settingsImportDesc)
			.addButton(button => button.setButtonText(ui.startImport).setCta().onClick(() => {
				// Opened from here, the import window would sit in the settings window while the file
				// dialog comes up over the main one and hides it: the settings close first.
				(this.app as App & { setting?: { close?(): void } }).setting?.close?.();
				this.host.openWizard();
			}));

		new Setting(containerEl).setName(ui.settingsDefaults).setHeading();
		const folder = new Setting(containerEl)
			.setName(ui.folder)
			.setDesc(ui.folderDesc);
		const warning = folder.descEl.createDiv({ cls: 'onenote-ferry-warning' });
		folder.addText(text => {
			// Empty means the top of the vault, so that is what the empty field says.
			text.setPlaceholder(ui.vaultTop).setValue(settings.folder).onChange(async value => {
				const clean = cleanFolder(value);
				warning.setText(folderProblem(clean) ? ui.badFolder : '');
				if (folderProblem(clean)) return;
				settings.folder = clean;
				await this.host.saveSettings();
			});
			new FolderSuggest(this.app, text.inputEl);
		});
		const toggle = (name: string, desc: string, key: keyof SectionOptions) => new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle(t => t.setValue(!!settings[key]).onChange(async value => {
				settings[key] = value;
				await this.host.saveSettings();
			}));
		toggle(ui.boxMarkers, ui.boxMarkersDesc, 'boxMarkers');
		toggle(ui.fontColor, ui.fontColorDesc, 'keepFontColor');
		toggle(ui.altText, ui.altTextDesc, 'imageAltText');
	}
}
