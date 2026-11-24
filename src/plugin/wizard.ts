// The import window: one page, as Obsidian's own Importer does it, built from Obsidian's own parts
// (setting groups, and the file tree Obsidian Publish uses). From the top: the downloads chosen,
// the notebooks and sections in them to tick, the settings, and "Start import". Once the import
// starts the same window shows its progress, and at the end what it did. Closing the window while
// the import runs leaves it going; the status bar item opens the window again.

import { ButtonComponent, Modal, Notice, ProgressBarComponent, Setting, SettingGroup, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import { LANGUAGES } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { formatBytes, LANGUAGE_NAMES } from './i18n.ts';
import type { UiStrings } from './i18n.ts';
import { elapsed } from './progress.ts';
import type { ChosenDownload, ImportSession, NotebookChoice, SectionState } from './session.ts';
import { cleanFolder, folderProblem, FolderSuggest } from './settings.ts';

declare const require: (id: string) => any;

export interface WizardHost {
	ui: UiStrings;
	/** Starts the session's import (status bar and all). */
	startImport(session: ImportSession): void;
	/** The window was closed. */
	wizardClosed(wizard: ImportWizard): void;
}

/** Only macOS has an open dialog that picks files and folders together. */
const BOTH_IN_ONE_DIALOG = process.platform === 'darwin';

/** An icon at the start of a setting row, the way Obsidian's own rows have one. */
function rowIcon(setting: Setting, icon: string): void {
	setIcon(setting.settingEl.createDiv({ cls: 'setting-item-icon', prepend: true }), icon);
}

/** The whole row is a button, the way Obsidian's own "add" rows are. `action` is told whether the keyboard pressed it. */
function rowAction(setting: Setting, action: (byKeyboard: boolean) => void): void {
	const el = setting.settingEl;
	el.addClass('mod-action', 'tappable');
	el.setAttr('role', 'button');
	el.tabIndex = 0;
	el.addEventListener('click', () => {
		// The open dialog hands focus back to this row: a ring would show although nothing was typed.
		el.blur();
		action(false);
	});
	el.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		action(true);
	});
}

/** A notebook, a section group or a section in the tree, with every section below it. */
interface TreeNode {
	title: string;
	/** Its place in the notebook (section groups and name), to remember it open or closed. */
	path: string;
	sections: DownloadSection[];
	children: TreeNode[];
}

/** A notebook as a tree: section groups hold sections and groups, as in OneNote. */
function treeOf(notebook: DownloadNotebook): TreeNode {
	const root: TreeNode = { title: notebook.name, path: '', sections: [...notebook.sections], children: [] };
	for (const section of notebook.sections) {
		let node = root;
		for (const [i, group] of section.groups.entries()) {
			const path = section.groups.slice(0, i + 1).join('/');
			let child = node.children.find(other => other.path === path && other.children.length > 0);
			if (!child) {
				child = { title: group, path, sections: [], children: [] };
				node.children.push(child);
			}
			child.sections.push(section);
			node = child;
		}
		node.children.push({ title: section.label, path: `${[...section.groups, section.label].join('/')}\u0000`, sections: [section], children: [] });
	}
	return root;
}

export class ImportWizard extends Modal {
	readonly session: ImportSession;
	private readonly host: WizardHost;
	private readonly ui: UiStrings;
	private off?: () => void;
	private timer?: number;
	/** What the window shows now: setting up, the import running, or its end. */
	private view?: ImportSession['phase'];
	/** Updates the parts of the current view that change while it is shown. */
	private refresh?: () => void;
	/** An open dialog is showing (another click does nothing meanwhile). */
	private choosing = false;
	/** Tree rows that are open, by download, notebook and place. */
	private readonly expanded = new Set<string>();
	/** The rows of the downloads, where the keyboard's focus goes back after a download is added. */
	private sourceList?: HTMLElement;

	constructor(app: App, host: WizardHost, session: ImportSession) {
		super(app);
		this.host = host;
		this.ui = host.ui;
		this.session = session;
		// Obsidian puts the focus on the first row or button of a new window when there is a keyboard,
		// which draws a ring around "Choose a zip file or folder" (or "Close") as if it had been tabbed
		// to. Its own settings window turns that off the same way; Tab still moves into the window.
		(this as unknown as { hasInitialInputFocus: boolean }).hasInitialInputFocus = false;
	}

	onOpen(): void {
		this.modalEl.addClass('onenote-ferry-wizard');
		this.titleEl.setText(this.ui.wizardTitle);
		this.off = this.session.onChange(() => this.onChange());
		this.timer = window.setInterval(() => {
			if (this.session.phase === 'running') this.refresh?.();
		}, 1000);
		this.render();
	}

	onClose(): void {
		this.off?.();
		window.clearInterval(this.timer);
		this.contentEl.empty();
		this.host.wizardClosed(this);
	}

	private onChange(): void {
		if (this.session.phase !== this.view) this.render();
		else this.refresh?.();
	}

	private render(): void {
		this.view = this.session.phase;
		this.refresh = undefined;
		this.contentEl.empty();
		if (this.view === 'setup') this.setup();
		else if (this.view === 'running') this.running();
		else this.finished();
	}

	private footer(): HTMLElement {
		return this.contentEl.createDiv('modal-button-container onenote-ferry-footer');
	}

	// Before the import: what to import and how.

	private setup(): void {
		const ui = this.ui;
		const session = this.session;
		const body = this.contentEl.createDiv('onenote-ferry-body');

		// The downloads, and the rows that add them.
		const source = new SettingGroup(body).addClass('mod-list');

		// The notebooks and sections to tick: a heading row with the select-all button, then the tree,
		// in one group as Importer has them.
		const treeGroup = new SettingGroup(body).addClass('onenote-ferry-tree-group');
		let all!: ButtonComponent;
		new Setting(treeGroup.listEl)
			.setName(ui.tree)
			.addButton(button => {
				all = button;
				button.buttonEl.addClass('onenote-ferry-tree-button');
				button.onClick(() => session.selectAll(!session.allChosen));
			});
		const tree = treeGroup.listEl.createDiv('import-section file-tree publish-section onenote-ferry-tree').createDiv('publish-change-list');

		// The settings.
		const settings = new SettingGroup(body).setHeading(ui.settings).addClass('onenote-ferry-settings');
		let folderWarning!: HTMLElement;
		settings.addSetting(setting => {
			setting.setName(ui.importInto).setDesc(ui.importIntoDesc);
			folderWarning = setting.descEl.createDiv({ cls: 'onenote-ferry-warning' });
			setting.addText(text => {
				text.setPlaceholder(ui.vaultTop).setValue(session.folder).onChange(value => session.setFolder(cleanFolder(value)));
				new FolderSuggest(this.app, text.inputEl);
			});
		});
		settings.addSetting(setting => setting
			.setName(ui.language)
			.setDesc(ui.languageDesc)
			.addDropdown(dropdown => {
				for (const language of LANGUAGES) dropdown.addOption(language, LANGUAGE_NAMES[language]!);
				dropdown.setValue(session.language).onChange(value => session.setLanguage(value as Language));
			}));
		const option = (name: string, desc: string, key: keyof typeof session.options) => settings.addSetting(setting => setting
			.setName(name)
			.setDesc(desc)
			.addToggle(toggle => toggle.setValue(session.options[key]).onChange(value => session.options[key] = value)));
		option(ui.boxMarkers, ui.boxMarkersDesc, 'boxMarkers');
		option(ui.fontColor, ui.fontColorDesc, 'keepFontColor');
		option(ui.altText, ui.altTextDesc, 'imageAltText');

		// What the import will do, and the button that starts it.
		const footer = this.footer();
		const summary = footer.createDiv('onenote-ferry-summary');
		const start = new ButtonComponent(footer).setButtonText(ui.startImport).setCta().onClick(() => this.host.startImport(session));

		// Rows are drawn again only when what they show changes, so nothing jumps while ticking.
		let sourceShown: string | undefined;
		let treeShown: string | undefined;
		let rows: (() => void)[] = [];
		this.refresh = () => {
			const sourceState = session.downloads.map(download => `${download.input}:${download.state}:${download.notebooks.length}`).join('|');
			if (sourceState !== sourceShown) {
				sourceShown = sourceState;
				this.drawSource(source.listEl);
			}
			const treeState = session.choices.map(choice => `${choice.download.input}:${choice.notebook.path}`).join('|');
			if (treeState !== treeShown) {
				treeShown = treeState;
				rows = this.drawTree(tree);
			}
			for (const update of rows) update();
			const choosable = session.choices.some(choice => session.choosable(choice).length > 0);
			all.setButtonText(session.allChosen && choosable ? ui.deselectAll : ui.selectAll).setDisabled(!choosable);
			folderWarning.setText(folderProblem(session.folder) ? ui.badFolder : '');
			folderWarning.toggle(folderProblem(session.folder));
			const counts = session.counts();
			summary.setText(session.reading ? ui.reading
				: session.folderError ? ui.folderUnreadable(session.folderError)
				: session.checking || session.findingLocked ? ui.checking
				: counts.sections ? ui.willImport(counts.notebooks, counts.sections, formatBytes(counts.bytes), counts.unreadable)
				: choosable ? ui.nothingChosen
				: !session.choices.length ? ''
				// Why nothing can be imported, when there is one reason for all.
				: session.choices.every(choice => choice.blocked) ? ui.allTaken
				: session.choices.every(choice => !choice.notebook.sections.length) ? ui.noSectionsAnywhere
				: ui.nothingToImport);
			start.setDisabled(!session.ready);
		};
		this.refresh();
	}

	/** A download's name, with the folder it is in when another chosen download has the same name. */
	private downloadLabel(download: ChosenDownload): string {
		if (this.session.downloads.filter(other => other.name === download.name).length < 2) return download.name;
		const parts = download.input.replace(/[\\/]+$/, '').split(/[\\/]/);
		return `${download.name} (${parts[parts.length - 2] ?? ''})`;
	}

	private drawSource(listEl: HTMLElement): void {
		const ui = this.ui;
		const session = this.session;
		this.sourceList = listEl;
		listEl.empty();
		if (!session.downloads.length) new Setting(listEl).setClass('mod-empty-state').setName(ui.sourceEmpty);
		for (const download of session.downloads) {
			const row = new Setting(listEl).setName(this.downloadLabel(download));
			rowIcon(row, /\.zip$/i.test(download.input) ? 'lucide-file-archive' : 'lucide-folder');
			row.settingEl.setAttr('title', download.input);
			row.setDesc(download.state === 'reading' ? ui.reading
				: download.state === 'failed' ? ui.cannotRead(download.stopped ? ui.converterStopped : download.error ?? '')
				: download.notebooks.length ? ui.notebooksFound(download.notebooks.length) : ui.noNotebooks);
			if (download.state === 'failed' || (download.state === 'ready' && !download.notebooks.length)) row.descEl.addClass('onenote-ferry-warning');
			if (download.incomplete) row.descEl.createDiv({ text: ui.incompleteZip, cls: 'onenote-ferry-warning' });
			row.addExtraButton(button => button.setIcon('lucide-x').setTooltip(ui.remove).setDisabled(download.state === 'reading').onClick(() => session.remove(download)));
		}
		const add = (name: string, kind: 'both' | 'zip' | 'folder') => {
			const row = new Setting(listEl).setClass('mod-add-item').setName(name);
			rowIcon(row, 'lucide-plus');
			rowAction(row, byKeyboard => void this.choose(kind, byKeyboard));
		};
		// One open dialog picks zips and folders together only on macOS.
		if (BOTH_IN_ONE_DIALOG) add(ui.chooseBoth, 'both');
		else {
			add(ui.chooseZips, 'zip');
			add(ui.chooseFolders, 'folder');
		}
	}

	private async choose(kind: 'both' | 'zip' | 'folder', byKeyboard = false): Promise<void> {
		if (this.choosing) return;
		this.choosing = true;
		let paths: string[] = [];
		const title = kind === 'both' ? this.ui.dialogTitle : kind === 'zip' ? this.ui.dialogTitleZips : this.ui.dialogTitleFolders;
		try {
			const { remote } = require('electron');
			// Attached to the window this one is in (Obsidian's main window, or a window of its own the
			// user moved a tab to), so nothing else can be clicked while it is open.
			const parent = remote.BrowserWindow.getFocusedWindow() ?? remote.getCurrentWindow();
			const result = await remote.dialog.showOpenDialog(parent, {
				title,
				// What macOS shows (its open panel has no title bar).
				message: title,
				properties: kind === 'both' ? ['openFile', 'openDirectory', 'multiSelections', 'dontAddToRecent']
					: kind === 'zip' ? ['openFile', 'multiSelections', 'dontAddToRecent'] : ['openDirectory', 'multiSelections', 'dontAddToRecent'],
				filters: kind === 'folder' ? undefined : [{ name: 'Zip', extensions: ['zip'] }],
			});
			paths = result.canceled ? [] : result.filePaths;
		}
		catch (error) {
			new Notice(this.ui.dialogUnavailable(String((error as Error)?.message ?? error)));
			return;
		}
		finally {
			this.choosing = false;
		}
		if (paths.length && this.containerEl.isConnected) {
			const adding = this.session.add(paths);
			// The rows are drawn anew as the download is read: the keyboard's focus goes back to "add".
			if (byKeyboard) window.setTimeout(() => this.sourceList?.querySelector<HTMLElement>('.mod-add-item')?.focus(), 0);
			await adding;
		}
	}

	/** Draws the tree; answers what updates each row in place (ticks, names, notes). */
	private drawTree(listEl: HTMLElement): (() => void)[] {
		const session = this.session;
		listEl.empty();
		const rows: (() => void)[] = [];
		// Nothing chosen yet: the place says what will come here, so the page keeps its shape.
		if (!session.choices.length) listEl.createDiv({ cls: 'onenote-ferry-tree-placeholder', text: this.ui.treeEmpty });
		// One notebook in all: open from the start.
		if (session.choices.length === 1) this.expanded.add(this.rowId(session.choices[0]!, ''));
		const many = session.downloads.filter(download => download.notebooks.length).length > 1;
		for (const download of session.downloads) {
			const choices = session.choices.filter(choice => choice.download === download);
			if (!choices.length) continue;
			if (many) listEl.createDiv({ cls: 'onenote-ferry-tree-heading', text: this.downloadLabel(download) });
			for (const choice of choices) this.treeRow(listEl, choice, treeOf(choice.notebook), 'notebook', rows);
		}
		return rows;
	}

	private rowId(choice: NotebookChoice, path: string): string {
		return `${choice.download.input}\u0000${choice.notebook.path}\u0000${path}`;
	}

	/** One row of the tree, and the rows under it. */
	private treeRow(parent: HTMLElement, choice: NotebookChoice, node: TreeNode, kind: 'notebook' | 'group' | 'section', rows: (() => void)[]): void {
		const session = this.session;
		const folder = kind !== 'section';
		const id = this.rowId(choice, node.path);
		const item = parent.createDiv('tree-item');
		const self = item.createDiv(`tree-item-self is-clickable ${folder ? 'mod-folder mod-collapsible' : 'mod-file'}`);
		const arrow = folder ? self.createDiv('tree-item-icon collapse-icon') : undefined;
		if (arrow) setIcon(arrow, 'right-triangle');
		const inner = self.createDiv('tree-item-inner file-tree-item');
		const box = inner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
		setIcon(inner.createDiv('file-tree-item-icon'), kind === 'notebook' ? 'lucide-notebook' : kind === 'group' ? 'lucide-folder' : 'lucide-file-text');
		const title = inner.createDiv({ cls: 'file-tree-item-title', text: node.title });
		const flair = self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair');
		const children = item.createDiv('tree-item-children');

		const open = () => this.expanded.has(id);
		const showOpen = () => {
			arrow?.toggleClass('is-collapsed', !open());
			arrow?.setAttr('aria-expanded', String(open()));
			item.toggleClass('is-collapsed', !open());
			children.toggle(open());
		};
		const toggleOpen = () => {
			if (open()) this.expanded.delete(id);
			else this.expanded.add(id);
			showOpen();
		};
		if (arrow) {
			// The arrow is a button the keyboard reaches too (Tab, then Enter or Space).
			arrow.setAttr('role', 'button');
			arrow.setAttr('aria-label', node.title);
			arrow.tabIndex = 0;
			arrow.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				event.stopPropagation();
				toggleOpen();
			});
		}
		if (folder) showOpen();
		arrow?.addEventListener('click', event => {
			event.stopPropagation();
			toggleOpen();
		});
		box.addEventListener('click', event => event.stopPropagation());
		box.addEventListener('change', () => session.setSections(choice, node.sections, box.checked));
		// A notebook or group row opens and closes; a section row ticks.
		self.addEventListener('click', () => {
			if (folder) toggleOpen();
			else if (!box.disabled) session.setSections(choice, node.sections, !box.checked);
		});

		rows.push(() => {
			const states = node.sections.map(section => session.sectionState(choice, section));
			const free = node.sections.filter((_, i) => states[i] === 'free');
			const chosen = free.filter(section => session.isChosen(choice, section)).length;
			const disabled = free.length === 0;
			box.disabled = disabled;
			// Nothing to tick: ticked (and dimmed) when what can be there is there already.
			box.checked = disabled ? states.some(state => state === 'imported') && states.every(state => state !== 'blocked') : chosen === free.length;
			box.indeterminate = !disabled && chosen > 0 && chosen < free.length;
			box.setAttr('data-indeterminate', String(box.indeterminate));
			self.toggleClass('is-disabled', disabled);
			if (kind === 'notebook') title.setText(choice.notebook.name);
			flair.setText(this.note(kind, choice, node, states));
		});
		const childKind = (child: TreeNode) => child.children.length ? 'group' : 'section';
		for (const child of node.children) this.treeRow(children, choice, child, childKind(child), rows);
	}

	/** What the right of a row says: why it cannot be ticked, that it goes into a notebook there already, or its size. */
	private note(kind: 'notebook' | 'group' | 'section', choice: NotebookChoice, node: TreeNode, states: SectionState[]): string {
		const ui = this.ui;
		if (!node.sections.length) return ui.noSections;
		if (states.length && states.every(state => state === 'blocked')) return kind === 'notebook' ? choice.otherSpelling ? ui.folderSpelling : ui.folderTaken : '';
		// Nothing left to tick, and some of it is there: imported (the rest cannot be read).
		if (states.some(state => state === 'imported') && !states.includes('free')) return ui.imported;
		// A section, or a notebook or group whose sections are all alike: why they cannot be ticked.
		const same = states.every(state => state === states[0]) ? states[0] : undefined;
		if (same === 'locked') return ui.locked;
		if (same === 'incomplete') return ui.incomplete;
		if (same === 'occupied') return ui.folderTaken;
		// Sections to add to the folder an earlier import of this notebook left: said, so two notebooks
		// of one name are not merged unseen (§11.5 item 47).
		if (kind === 'notebook' && choice.earlier) return ui.addingTo;
		if (kind === 'group') return '';
		// Sections cut off in the download have no size: nothing rather than "0 B".
		const bytes = node.sections.reduce((n, section) => n + section.size, 0);
		return bytes ? formatBytes(bytes) : '';
	}

	// While the import runs.

	private running(): void {
		const ui = this.ui;
		const session = this.session;
		const box = this.contentEl.createDiv('onenote-ferry-progress-view');
		const count = box.createDiv('onenote-ferry-progress-count');
		const bar = new ProgressBarComponent(box);
		const name = box.createDiv('onenote-ferry-progress-name');
		box.createDiv({ cls: 'onenote-ferry-progress-hint', text: ui.closeHint });
		const footer = this.footer();
		const stop = new ButtonComponent(footer).onClick(() => session.requestStop());
		this.refresh = () => {
			const p = session.progress;
			const time = ui.elapsed(elapsed(Date.now() - session.startedAt));
			if (!p) {
				count.setText(`${ui.statusReading} · ${time}`);
				bar.setValue(0);
				name.setText('');
			}
			else {
				count.setText(`${ui.sectionCount(p.done + 1, p.total)} · ${time}`);
				bar.setValue(Math.floor((p.done / p.total) * 100));
				const label = `${p.notebook} / ${[...p.section.groups, p.section.label].join(' / ')}`;
				name.setText(label);
				name.setAttribute('title', label);
			}
			stop.setButtonText(session.stopRequested ? ui.stopping : ui.stop).setDisabled(session.stopRequested);
		};
		this.refresh();
	}

	// Once it has ended.

	private finished(): void {
		const ui = this.ui;
		const session = this.session;
		const outcome = session.outcome;
		const result = outcome?.result;
		const box = this.contentEl.createDiv('onenote-ferry-result');
		const heading = box.createDiv('onenote-ferry-result-heading');
		const failed = !!session.error || !outcome || !result;
		setIcon(heading.createSpan('onenote-ferry-result-icon'), failed ? 'lucide-circle-x' : result.cancelled ? 'lucide-circle-pause' : 'lucide-circle-check');
		heading.createSpan({ text: failed ? ui.failed : result.cancelled ? ui.stopped : ui.finished });
		const footer = this.footer();
		if (failed) {
			box.createDiv({ cls: 'onenote-ferry-result-line onenote-ferry-warning', text: session.alreadyThere ? ui.alreadyInFolder(session.alreadyThere) : session.error ?? '' });
			new ButtonComponent(footer).setButtonText(ui.close).setCta().onClick(() => this.close());
			return;
		}
		// What this import did: the sections it converted (or noted as failed), not those an earlier one had
		// written, the user left unticked, or a stop left out (those have their own line below).
		const mine = (notebook: typeof result.notebooks[number]) => notebook.sections.filter(section => !section.earlier && !section.skipped);
		const handled = result.notebooks.flatMap(notebook => mine(notebook).filter(section => !section.cancelled));
		const converted = handled.filter(section => section.report);
		box.createDiv({ cls: 'onenote-ferry-result-line', text: ui.summary(
			result.notebooks.filter(notebook => !(mine(notebook).length && mine(notebook).every(section => section.cancelled))).length, handled.length,
			converted.reduce((n, section) => n + (section.report?.pageCount ?? 0), 0),
			converted.reduce((n, section) => n + (section.report?.attachments ?? 0), 0)) });
		const notes: string[] = [];
		const notConverted = handled.filter(section => section.failed || section.locked).length;
		if (notConverted) notes.push(ui.notConverted(notConverted));
		const leftOut = result.notebooks.flatMap(mine).filter(section => section.cancelled).length + result.notStarted.reduce((n, notebook) => n + notebook.sections, 0);
		if (leftOut) notes.push(ui.leftOut(leftOut));
		// Only part of a notebook: some of it converted now, some left out by the stop (one the stop came
		// before entirely is counted with the sections left out).
		for (const notebook of result.notebooks) {
			if (mine(notebook).some(section => section.cancelled) && mine(notebook).some(section => !section.cancelled)) notes.push(ui.partial(notebook.notebook));
		}
		if (notes.length) {
			const list = box.createEl('ul', { cls: 'onenote-ferry-result-notes' });
			for (const note of notes) list.createEl('li', { text: note });
		}
		const reportPath = outcome.reportPath;
		const close = new ButtonComponent(footer).setButtonText(ui.close).onClick(() => this.close());
		if (!reportPath) {
			close.setCta();
			return;
		}
		new ButtonComponent(footer).setButtonText(ui.openReport).setCta().onClick(() => {
			const file = this.app.vault.getFileByPath(reportPath);
			if (!file) {
				new Notice(ui.reportMissing);
				return;
			}
			void this.app.workspace.getLeaf(true).openFile(file);
			this.close();
		});
	}
}
