// The import window: one page, as Obsidian's own Importer does it, built from Obsidian's own parts
// (setting groups, and the file tree Obsidian Publish uses). From the top: the downloads chosen,
// the notebooks and sections in them to tick, the settings, and "Start import". Once the import
// starts the same window shows its progress, and at the end what it did. Closing the window while
// the import runs leaves it going; the status bar item opens the window again.
//
// The same window updates notebooks imported before (§11.5 item 49): each section says what
// changed in a word or two (why, on hover), a section that changed opens to its pages, and the
// bottom says what the update will do. Only what needs a decision stands out.

import { ButtonComponent, Modal, Notice, ProgressBarComponent, Setting, SettingGroup, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import type { RemoteNotebook } from '../core/onedrive.ts';
import { LANGUAGES, STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import type { PlanItem } from '../core/sync.ts';
import { SignInError } from '../core/microsoft-auth.ts';
import type { MicrosoftAccount } from './account.ts';
import { formatBytes, LANGUAGE_NAMES } from './i18n.ts';
import type { UiStrings } from './i18n.ts';
import { oneDriveMessage } from './onedrive.ts';
import type { OneDriveBrowse } from './onedrive.ts';
import { elapsed } from './progress.ts';
import { TICKABLE } from './session.ts';
import type { ChosenDownload, ImportSession, NotebookChoice, SectionState } from './session.ts';
import { cleanFolder, folderProblem, FolderSuggest } from './settings.ts';
import { nextLine } from './line.ts';
import type { LineMeasure, LineMode, LineShown } from './line.ts';

declare const require: (id: string) => any;

export interface WizardHost {
	ui: UiStrings;
	/** The Microsoft account OneDrive is read with. */
	microsoft: MicrosoftAccount;
	/** OneDrive through that account. */
	oneDrive(): OneDriveBrowse;
	/** Starts the session's import (status bar and all). */
	startImport(session: ImportSession): void;
	/** The window was closed. */
	wizardClosed(wizard: ImportWizard): void;
}

/** Only macOS has an open dialog that picks files and folders together. */
const BOTH_IN_ONE_DIALOG = process.platform === 'darwin';
/** How long the OneDrive row's line keeps a way of showing (progress, sliding, none) before it changes to another. */
const LINE_HOLD_MS = 400;


/**
 * Hover text, as the plain tooltip by the pointer (the `title`), or none. One kind for all that
 * explains (§11.5 item 82): it does not cover the window or reach out of it, and screen readers read
 * it out. Obsidian's dark tooltip is left to the icon buttons and the status bar, as in Obsidian.
 */
function showTip(el: HTMLElement, tip: string | undefined): void {
	if (tip) el.setAttr('title', tip);
	else el.removeAttribute('title');
}

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

/**
 * A notebook as a tree: section groups hold sections and groups, as in OneNote. `extra`: sections of
 * ours the download does not have (an update leaves them as they are), shown where they are.
 */
function treeOf(notebook: DownloadNotebook, extra: DownloadSection[] = []): TreeNode {
	const all = [...notebook.sections, ...extra];
	const root: TreeNode = { title: notebook.name, path: '', sections: all, children: [] };
	for (const section of all) {
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

/** How a row stands: a section's state, or one the download does not have. */
type RowState = SectionState | 'gone';

/** What the right of a row says: a word or two, how it stands out, and why (on hover). */
interface Flair {
	text: string;
	/** strong: needs the user (an update to take); warn: the user's own words are concerned. */
	tone?: 'strong' | 'warn';
	tip?: string;
}

/** States that stand out: what the update will take unless unticked. */
const STRONG: ReadonlySet<RowState> = new Set(['changed', 'new', 'unfinished']);
/** States a group row names when all its sections share one. */
const GROUP_WORDS: ReadonlySet<RowState> = new Set(['same', 'gone', 'checking', 'locked', 'incomplete', 'occupied', 'unreadable']);
/** States that leave a notebook imported before at "no changes": nothing differs that needs a look. */
const QUIET: ReadonlySet<RowState> = new Set(['same', 'gone', 'skipped', 'locked']);
/** Of those, the states of sections that are in the vault (imported before). */
const IMPORTED: ReadonlySet<RowState> = new Set(['same', 'gone']);

const fold = (path: string) => path.normalize('NFC').toLowerCase();

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
	/** The thin line along the bottom of the OneDrive row: set as things move, without drawing the row again. */
	private oneDriveLine?: { holder: HTMLElement, bar: ProgressBarComponent, download: ChosenDownload };
	/** How the line shows now, since when; and a look again once it may change. */
	private lineShown?: LineShown;
	private lineTimer?: number;
	/** Microsoft's sign-in page is open in the browser, for adding OneDrive. */
	private signingIn = false;

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
		this.titleEl.setText(this.session.entry === 'update' ? this.ui.updateTitle : this.ui.wizardTitle);
		this.off = this.session.onChange(() => this.onChange());
		this.timer = window.setInterval(() => {
			if (this.session.phase === 'running') this.refresh?.();
		}, 1000);
		this.render();
	}

	onClose(): void {
		this.off?.();
		window.clearInterval(this.timer);
		window.clearTimeout(this.lineTimer);
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
		// One name, whatever the rows hold (new notebooks, updates, or both): each row says what it is.
		new Setting(treeGroup.listEl)
			.setName(ui.tree)
			.addButton(button => {
				all = button;
				button.buttonEl.addClass('onenote-ferry-tree-button');
				button.onClick(() => session.selectAll(!session.allChosen));
			});
		const tree = treeGroup.listEl.createDiv('import-section file-tree publish-section onenote-ferry-tree').createDiv('publish-change-list');

		// The settings (§11.5 item 65): the language is for notebooks new to the target folder (a notebook
		// keeps one); the options for every section written now for the first time or converted again. A
		// section updated because OneNote changed it keeps its own, which the bottom line says when it matters.
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
		// Rows greyed as a whole (name, description and control) when nothing chosen uses them.
		const forNotebooks: Setting[] = [];
		const forSections: Setting[] = [];
		settings.addSetting(setting => {
			forNotebooks.push(setting);
			setting
				.setName(ui.language)
				.setDesc(ui.languageDesc)
				.addDropdown(dropdown => {
					for (const code of LANGUAGES) dropdown.addOption(code, LANGUAGE_NAMES[code]!);
					dropdown.setValue(session.language).onChange(value => session.setLanguage(value as Language));
				});
		});
		const option = (name: string, desc: string, key: keyof typeof session.options) => settings.addSetting(setting => {
			forSections.push(setting);
			setting
				.setName(name)
				.setDesc(desc)
				.addToggle(toggle => toggle.setValue(session.options[key]).onChange(value => session.options[key] = value));
		});
		option(ui.boxMarkers, ui.boxMarkersDesc, 'boxMarkers');
		option(ui.pictureText, ui.pictureTextDesc, 'imageAltText');

		// What the import or update will do, and the button that starts it.
		const footer = this.footer();
		const lines = footer.createDiv('onenote-ferry-summary');
		const summary = lines.createDiv();
		const warning = lines.createDiv('onenote-ferry-flair-warn');
		const start = new ButtonComponent(footer).setCta().onClick(() => this.host.startImport(session));

		// Rows are drawn again only when what they show changes, so nothing jumps while ticking.
		let sourceShown: string | undefined;
		let treeShown: string | undefined;
		let rows: (() => void)[] = [];
		this.refresh = () => {
			const sourceState = `${this.signingIn}:` + session.downloads.map(download => `${download.input}:${download.state}:${download.notebooks.length}:${download.error ?? ''}:${download.onedrive?.reading?.done ?? ''}/${download.onedrive?.reading?.total ?? ''}:${!!download.onedrive?.refreshing}`).join('|');
			if (sourceState !== sourceShown) {
				sourceShown = sourceState;
				this.drawSource(source.listEl);
			}
			this.showOneDriveLine();
			// The empty tree says what will come there: OneDrive's notebooks being read, or a download to choose.
			const treeState = `${session.downloads.some(download => download.onedrive && download.state === 'reading')}:` + session.choices.map(choice => `${choice.download.input}:${choice.notebook.path}:${this.shape(choice)}`).join('|');
			if (treeState !== treeShown) {
				treeShown = treeState;
				rows = this.drawTree(tree);
			}
			for (const update of rows) update();
			const updating = session.updating;
			const choosable = session.choices.some(choice => session.choosable(choice).length > 0);
			const selectable = session.selectable;
			all.setButtonText(session.allChosen && selectable ? ui.deselectAll : ui.selectAll).setDisabled(!selectable);
			folderWarning.setText(folderProblem(session.folder) ? ui.badFolder : '');
			folderWarning.toggle(folderProblem(session.folder));
			// A setting what is chosen does not use is greyed. With nothing chosen yet, the page settings
			// can be set first: they go with what is chosen next (new sections, those converted again).
			const included = session.included();
			const settingsUsed = !updating || session.settingsUsed || !included.length;
			for (const setting of forNotebooks) setting.setDisabled(updating && !session.languageUsed);
			for (const setting of forSections) setting.setDisabled(!settingsUsed);
			const counts = session.counts();
			const changes = session.updateCounts();
			const folder = session.oldVersionsFolder;
			const will = [
				counts.sections ? ui.willImport(counts.notebooks, counts.sections, formatBytes(counts.bytes), counts.unreadable) : '',
				changes.updated || changes.added || changes.restored || changes.reconverted ? ui.willUpdate(changes.updated, changes.added, changes.restored, changes.reconverted, folder) : '',
				// Why the settings do not reach sections updated because OneNote changed them: said once, where the plan is.
				updating && session.ownSettingsKept ? ui.ownSettingsKept : '',
			].filter(Boolean);
			// Nothing differs in the notebooks imported before.
			const noChange = updating && !session.choices.some(choice => choice.earlier && choice.notebook.sections.some(section => STRONG.has(session.sectionState(choice, section))));
			summary.empty();
			const reading = session.downloads.find(download => download.onedrive && download.state === 'reading')?.onedrive?.reading;
			if (reading) summary.setText(reading.total ? ui.oneDriveReadingCount(reading.done, reading.total) : ui.oneDriveFinding);
			// OneDrive's list first, then the notebooks imported before: one check for the user, so one line.
			else if (session.downloads.some(download => download.onedrive?.refreshing)) {
				summary.setText(updating || session.entry === 'update' ? ui.checkingUpdates(session.checkProgress.done, session.checkProgress.total) : ui.oneDriveRefreshing);
			}
			else if (session.folderError) summary.setText(ui.folderUnreadable(session.folderError));
			// One check, one line: what it does on the way (downloads, a look at the target folder) does
			// not change the words; the OneDrive row's line shows the downloads.
			else if (session.checkingUpdates || (updating && (session.checking || session.findingLocked))) summary.setText(ui.checkingUpdates(session.checkProgress.done, session.checkProgress.total));
			else if (session.reading) summary.setText(ui.reading);
			else if (session.checking || session.findingLocked) summary.setText(ui.checking);
			else if (session.downloading) summary.setText(ui.downloadingFiles(session.downloading.files, session.downloading.totalFiles, formatBytes(session.downloading.bytes), formatBytes(session.downloading.totalBytes)));
			else if (will.length) for (const line of will) summary.createDiv({ text: line });
			// Nothing to update: a click converts a section again (§11.5 item 65), said where the user looks.
			else summary.setText(noChange ? session.selectable ? ui.noUpdatesReconvert : ui.noUpdates
				: choosable ? ui.nothingChosen
				: !session.choices.length ? ''
				// Why nothing can be imported, when there is one reason for all.
				: session.choices.every(choice => choice.blocked) ? ui.allTaken
				: session.choices.every(choice => !choice.notebook.sections.length) ? ui.noSectionsAnywhere
				: ui.nothingToImport);
			const settled = !session.reading && !session.folderError && !session.checking && !session.findingLocked && !session.checkingUpdates;
			warning.setText(settled && changes.bothEdited ? ui.bothEditedWarning(changes.bothEdited, folder) : '');
			warning.toggle(settled && changes.bothEdited > 0);
			// What will be done: an update when a notebook imported before is chosen (or, with nothing chosen, among the downloads).
			start.setButtonText(included.some(choice => choice.earlier) || (!included.length && updating) ? ui.startUpdate : ui.startImport);
			start.setDisabled(!session.ready);
		};
		this.refresh();
	}

	/**
	 * What the tree shows of a notebook imported before, apart from ticks: which sections are there,
	 * which open to pages and which pages. The tree is drawn again when it changes.
	 */
	private shape(choice: NotebookChoice): string {
		const plan = choice.plan;
		if (!choice.earlier) return choice.blocked ? 'blocked' : 'new';
		if (!plan) return 'checking';
		const page = (pages: { id: string }[]) => pages.map(one => one.id).join(',');
		return `${plan.identity}:${plan.items.map(item => `${item.status}/${item.key}/${item.old ?? ''}>${item.new ?? ''}/${page(item.added)}/${page(item.modified)}/${page(item.removed)}/${item.reordered.length}`).join(';')}`;
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
		for (const download of session.downloads) {
			if (download.onedrive) {
				this.drawOneDrive(listEl, download);
				continue;
			}
			const row = new Setting(listEl).setName(this.downloadLabel(download));
			rowIcon(row, /\.(zip|onepkg)$/i.test(download.input) ? 'lucide-file-archive' : /\.one$/i.test(download.input) ? 'lucide-file' : 'lucide-folder');
			row.settingEl.setAttr('title', download.input);
			row.setDesc(download.state === 'reading' ? ui.reading
				: download.state === 'failed' ? ui.cannotRead(download.stopped ? ui.converterStopped : download.error ?? '')
				: download.notebooks.length ? ui.notebooksFound(download.notebooks.length) : ui.noNotebooks);
			if (download.state === 'failed' || (download.state === 'ready' && !download.notebooks.length)) row.descEl.addClass('onenote-ferry-warning');
			if (download.incomplete) row.descEl.createDiv({ text: ui.incompleteZip, cls: 'onenote-ferry-warning' });
			row.addExtraButton(button => button.setIcon('lucide-x').setTooltip(ui.remove).setDisabled(download.state === 'reading').onClick(() => session.remove(download)));
		}
		if (this.signingIn) {
			const row = new Setting(listEl).setName(ui.oneDrive).setDesc(ui.signInWaiting);
			rowIcon(row, 'lucide-cloud');
			// The page may open in a tab the user does not see (or a sign-in of another app may take the place).
			row.addExtraButton(button => button.setIcon('lucide-external-link').setTooltip(ui.reopenSignIn).onClick(() => this.host.microsoft.reopenSignIn()));
			row.addExtraButton(button => button.setIcon('lucide-x').setTooltip(ui.cancelSignIn).onClick(() => this.host.microsoft.cancelSignIn()));
		}
		// Where notebooks come from: OneDrive itself first, then files downloaded from its website or
		// exported by OneNote for Windows.
		const add = (name: string, desc: string, kind: 'both' | 'zip' | 'folder' | 'onedrive') => {
			const row = new Setting(listEl).setClass('mod-add-item').setName(name);
			// What it takes, in the plain tooltip by the pointer (as a OneDrive notebook's place is), so
			// the rows stay one line each and the text need not be cut to fit beside the name. Screen
			// readers read it out too.
			showTip(row.settingEl, desc);
			rowIcon(row, 'lucide-plus');
			rowAction(row, byKeyboard => void (kind === 'onedrive' ? this.fromOneDrive() : this.choose(kind, byKeyboard)));
		};
		if (!this.signingIn && !session.downloads.some(download => download.onedrive)) {
			add(session.entry === 'update' ? ui.chooseOneDriveUpdate : ui.chooseOneDrive, this.host.microsoft.signedIn ? ui.oneDriveAddDescSignedIn : ui.oneDriveAddDesc, 'onedrive');
		}
		// One open dialog picks zips and folders together only on macOS.
		if (BOTH_IN_ONE_DIALOG) add(ui.chooseBoth, `${ui.sourceZipsOrFolders}\n${ui.sourceExports}`, 'both');
		else {
			add(ui.chooseZips, `${ui.sourceZips}\n${ui.sourceExports}`, 'zip');
			add(ui.chooseFolders, ui.sourceFolders, 'folder');
		}
	}

	/**
	 * The OneDrive row, as it stands: being read (how far, with a way to stop), not readable (why,
	 * and again), or read (how many notebooks, where else to look). It keeps one shape whatever it is
	 * doing, so the window does not jump: one line of words, two buttons, and a thin line along its
	 * bottom edge that shows what goes on (showOneDriveLine), taking no room.
	 */
	private drawOneDrive(listEl: HTMLElement, download: ChosenDownload): void {
		const ui = this.ui;
		const session = this.session;
		const source = download.onedrive!;
		const row = new Setting(listEl).setName(ui.oneDrive).setClass('onenote-ferry-onedrive-row');
		rowIcon(row, 'lucide-cloud');
		if (download.state === 'failed') {
			row.setDesc(download.error ?? '');
			row.descEl.addClass('onenote-ferry-warning');
			row.addExtraButton(button => button.setIcon('lucide-rotate-cw').setTooltip(ui.retry).onClick(() => void session.addOneDrive(source.access)));
			this.oneDriveLine = undefined;
		}
		else {
			const reading = download.state === 'reading' ? source.reading : undefined;
			row.setDesc(download.state === 'reading' ? reading?.total ? ui.oneDriveReadingCount(reading.done, reading.total) : ui.oneDriveFinding
				: download.notebooks.length ? ui.notebooksFound(download.notebooks.length) : ui.noNotebooks);
			if (download.error) row.descEl.createDiv({ text: download.error, cls: 'onenote-ferry-warning' });
			row.addExtraButton(button => button.setIcon('lucide-folder-search').setTooltip(ui.otherFolder).setDisabled(download.state === 'reading').onClick(() => this.lookInFolder(source)));
			const holder = row.settingEl.createDiv('onenote-ferry-row-progress');
			this.oneDriveLine = { holder, bar: new ProgressBarComponent(holder), download };
			this.showOneDriveLine();
		}
		// Removing it stops whatever it is doing.
		row.addExtraButton(button => button.setIcon('lucide-x').setTooltip(ui.remove).onClick(() => session.remove(download)));
	}

	/**
	 * The OneDrive row's line: how far things have come when that is known (notebooks read, sections
	 * checked for updates, as the bottom line counts them; bytes of a download), sliding while it is
	 * not (OneDrive's list read again, before the count is known, or while a check downloads); none
	 * when idle. A check's downloads slide rather than show bytes, so the line never runs backwards
	 * between two measures.
	 */
	private showOneDriveLine(): void {
		const line = this.oneDriveLine;
		if (!line?.holder.isConnected) return;
		const session = this.session;
		const source = line.download.onedrive!;
		const reading = source.reading;
		const d = session.downloading;
		const checked = session.checkProgress;
		// A check for updates is one measure from start to end: OneDrive's list read again, the copies
		// brought up to date (downloads included) and the sections read, counted as the bottom line counts.
		const checking = session.checkingUpdates || (session.updating && (source.refreshing || session.checking || session.findingLocked));
		const [measure, fraction]: [LineMeasure, number | undefined | null] = line.download.state === 'reading' ? ['reading', reading?.total ? reading.done / reading.total : undefined]
			: checking ? ['check', checked.total && checked.done ? checked.done / checked.total : undefined]
			: source.refreshing ? ['list', undefined]
			: d ? ['download', d.totalBytes ? d.bytes / d.totalBytes : undefined]
			: ['none', null];
		const next = nextLine(this.lineShown, measure, fraction, Date.now(), LINE_HOLD_MS);
		this.lineShown = next.shown;
		if (next.wait !== undefined) {
			this.lineTimer ??= window.setTimeout(() => {
				this.lineTimer = undefined;
				this.showOneDriveLine();
			}, next.wait);
		}
		this.paintLine(line, next.paint.mode, next.paint.value);
	}

	private paintLine(line: { holder: HTMLElement, bar: ProgressBarComponent }, mode: LineMode, value: number): void {
		line.holder.toggleClass('is-idle', mode === 'idle');
		line.holder.toggleClass('onenote-ferry-indeterminate', mode === 'slide');
		line.bar.setValue(mode === 'bar' ? value : 30);
	}

	/** Adds OneDrive, signing in first when not signed in (in the system browser). */
	private async fromOneDrive(): Promise<void> {
		if (this.signingIn) return;
		const account = this.host.microsoft;
		if (!account.signedIn) {
			this.signingIn = true;
			if (this.sourceList) this.drawSource(this.sourceList);
			try {
				await account.signIn();
			}
			catch (error) {
				// Cancelled here (the row's x): nothing to say.
				if (!(error instanceof SignInError && error.problem === 'cancelled' && !error.detail)) new Notice(oneDriveMessage(error, this.ui));
				return;
			}
			finally {
				this.signingIn = false;
				if (this.containerEl.isConnected && this.sourceList) this.drawSource(this.sourceList);
			}
		}
		if (!this.containerEl.isConnected) return;
		await this.session.addOneDrive(this.host.oneDrive());
	}

	/** "Look in another folder": the drive as a tree of folders, notebooks ticked in it join the list. */
	private lookInFolder(source: NonNullable<ChosenDownload['onedrive']>): void {
		const listed = new Set([...source.notebooks.values()].map(entry => entry.notebook.id));
		new NotebookPicker(this.app, this.ui, this.host.oneDrive(), listed, notebooks => void this.session.addOneDrive(source.access, notebooks)).open();
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
				// A zip downloaded from OneDrive, or what OneNote for Windows exports: a notebook (.onepkg) or a section (.one).
				filters: kind === 'folder' ? undefined : [{ name: 'OneNote', extensions: ['zip', 'onepkg', 'one'] }],
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
		const oneDriveReading = session.downloads.some(download => download.onedrive && download.state === 'reading');
		if (!session.choices.length) listEl.createDiv({ cls: 'onenote-ferry-tree-placeholder', text: oneDriveReading ? this.ui.oneDriveTreeWaiting : this.ui.treeEmpty });
		// One notebook in all: open from the start.
		if (session.choices.length === 1) this.expanded.add(this.rowId(session.choices[0]!, ''));
		const many = session.downloads.filter(download => download.notebooks.length).length > 1;
		for (const download of session.downloads) {
			const choices = session.choices.filter(choice => choice.download === download);
			if (!choices.length) continue;
			if (many) listEl.createDiv({ cls: 'onenote-ferry-tree-heading', text: this.downloadLabel(download) });
			for (const choice of choices) {
				// Sections of ours the download does not have: shown where they are, never ticked.
				const gone = new Map(session.gone(choice).map(item => [{ path: `\u0000gone\u0000${item.old}`, notebook: choice.notebook.name, groups: item.groups, label: item.label, size: 0 } as DownloadSection, item]));
				this.treeRow(listEl, choice, treeOf(choice.notebook, [...gone.keys()]), 'notebook', rows, section => gone.has(section));
			}
		}
		return rows;
	}

	private rowId(choice: NotebookChoice, path: string): string {
		return `${choice.download.input}\u0000${choice.notebook.path}\u0000${path}`;
	}

	/** Shows a row's word on the right, how it stands out, and why on hover. */
	private static showFlair(el: HTMLElement, flair: Flair): void {
		el.setText(flair.text);
		el.toggleClass('onenote-ferry-flair-strong', flair.tone === 'strong');
		el.toggleClass('onenote-ferry-flair-warn', flair.tone === 'warn');
		// Why, in the plain tooltip by the pointer. Hover text never ends with a full stop (§11.5 item 74).
		showTip(el, flair.tip);
	}

	/** One row of the tree, and the rows under it (for a section that changed, its pages). */
	private treeRow(parent: HTMLElement, choice: NotebookChoice, node: TreeNode, kind: 'notebook' | 'group' | 'section', rows: (() => void)[], isGone: (section: DownloadSection) => boolean): void {
		const session = this.session;
		const stateOf = (section: DownloadSection): RowState => (isGone(section) ? 'gone' : session.sectionState(choice, section));
		const section = kind === 'section' ? node.sections[0]! : undefined;
		const item = section && !isGone(section) ? session.itemOf(choice, section) : undefined;
		const details = section && item ? this.details(choice, section, item) : [];
		const folder = kind !== 'section' || details.length > 0;
		const id = this.rowId(choice, node.path);
		const treeItem = parent.createDiv('tree-item');
		const self = treeItem.createDiv(`tree-item-self is-clickable ${folder ? 'mod-folder mod-collapsible' : 'mod-file'}`);
		const arrow = folder ? self.createDiv('tree-item-icon collapse-icon') : undefined;
		if (arrow) setIcon(arrow, 'right-triangle');
		const inner = self.createDiv('tree-item-inner file-tree-item');
		const box = inner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
		setIcon(inner.createDiv('file-tree-item-icon'), kind === 'notebook' ? 'lucide-notebook' : kind === 'group' ? 'lucide-folder' : 'lucide-file-text');
		const title = inner.createDiv({ cls: 'file-tree-item-title', text: node.title });
		// A OneDrive notebook: where it is (on hover); beside the name when another has the same name.
		const where = kind === 'notebook' ? session.oneDriveFolder(choice) : undefined;
		if (where !== undefined) {
			const place = where ? `${this.ui.oneDrive} / ${where.split('/').join(' / ')}` : this.ui.oneDrive;
			title.setAttr('title', `${place} / ${choice.originalName}`);
			if (session.choices.filter(other => other.download === choice.download && other.originalName === choice.originalName).length > 1) {
				inner.createDiv({ cls: 'onenote-ferry-where onenote-ferry-muted', text: place });
			}
		}
		const flair = self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair');
		const children = treeItem.createDiv('tree-item-children');

		const open = () => this.expanded.has(id);
		const showOpen = () => {
			arrow?.toggleClass('is-collapsed', !open());
			arrow?.setAttr('aria-expanded', String(open()));
			treeItem.toggleClass('is-collapsed', !open());
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
		// Only the download's own sections can be ticked: those with something to do, and (§11.5 item 65)
		// those without changes, which are converted again only when clicked.
		const pending = () => node.sections.filter(one => !isGone(one) && TICKABLE.has(session.sectionState(choice, one)));
		const unchanged = () => node.sections.filter(one => !isGone(one) && session.sectionState(choice, one) === 'same');
		// A click ticks or unticks what there is to do; with nothing to do, it converts the unchanged
		// sections again, or stops doing so.
		const click = () => {
			const todo = pending();
			if (todo.length) session.setSections(choice, todo, !todo.every(one => session.ticked(choice, one) === true));
			else {
				const same = unchanged();
				session.setSections(choice, same, !same.every(one => session.reconverts(choice, one)));
			}
		};
		box.addEventListener('click', event => event.stopPropagation());
		box.addEventListener('change', click);
		// A notebook or group row opens and closes; a section row ticks (its arrow opens it).
		self.addEventListener('click', () => {
			if (kind !== 'section') toggleOpen();
			else if (!box.disabled) click();
		});
		rows.push(() => {
			const states = node.sections.map(stateOf);
			const todo = pending();
			const same = unchanged();
			const ticks = todo.map(one => session.ticked(choice, one));
			// There already and left as it is: a dimmed tick, which a click turns into converting it again.
			let kept = false;
			if (todo.length) {
				const every = ticks.every(tick => tick === true);
				box.disabled = false;
				box.checked = every;
				box.indeterminate = !every && ticks.some(tick => tick !== false);
			}
			else if (same.length) {
				// Converted again, or only some pages deleted in Obsidian coming back from it (a partial tick).
				const chosen = same.filter(one => session.reconverts(choice, one)).length;
				const partly = same.some(one => session.ticked(choice, one) === 'some');
				box.disabled = false;
				box.checked = true;
				box.indeterminate = (chosen > 0 && chosen < same.length) || (chosen === 0 && partly);
				kept = chosen === 0 && !partly;
			}
			else {
				box.disabled = true;
				// Nothing to tick: ticked (and dimmed) when what can be there is there already.
				box.checked = states.some(state => state === 'same') && states.every(state => state !== 'blocked' && state !== 'different');
				box.indeterminate = false;
			}
			box.setAttr('data-indeterminate', String(box.indeterminate));
			self.toggleClass('is-disabled', box.disabled);
			self.toggleClass('onenote-ferry-kept', kept);
			// What a click on a dimmed tick does, on hover: anywhere on a section's row (a click there
			// converts it again; pages deleted in Obsidian do not come back by it, §11.5 item 79), and on
			// a notebook's or group's row only on the box (a click elsewhere opens the row).
			const deleted = kept && section ? session.deletedPages(choice, section).length : 0;
			showTip(kind === 'section' ? self : box, !kept ? undefined : deleted ? this.ui.reconvertKeepsDeleted(deleted) : this.ui.reconvertTip);
			if (kind === 'notebook') title.setText(choice.notebook.name);
			ImportWizard.showFlair(flair, this.note(kind, choice, node, states));
		});
		if (section) {
			for (const draw of details) draw(children, rows);
			return;
		}
		const childKind = (child: TreeNode) => (child.children.length ? 'group' : 'section');
		for (const child of node.children) this.treeRow(children, choice, child, childKind(child), rows, isGone);
	}

	/**
	 * The rows under a section of a notebook imported before that changed: where it was, its pages
	 * added, changed and removed, the pages the user deleted (each can be brought back), and how many
	 * only moved. Each draws its row into the section's children.
	 */
	private details(choice: NotebookChoice, section: DownloadSection, item: PlanItem): ((parent: HTMLElement, rows: (() => void)[]) => void)[] {
		const ui = this.ui;
		const session = this.session;
		const state = session.sectionState(choice, section);
		// A section without changes lists only the pages the user deleted in Obsidian, each of which can come back.
		if (state !== 'changed' && state !== 'older' && state !== 'unfinished' && !(state === 'same' && session.deletedPages(choice, section).length)) return [];
		const untitled = STRINGS[session.readerLanguage].untitledPage;
		const folder = session.oldVersionsFolder;
		const out: ((parent: HTMLElement, rows: (() => void)[]) => void)[] = [];
		const line = (text: string, flair: Flair, icon = 'lucide-file-text', muted = false) => (parent: HTMLElement) => {
			const self = parent.createDiv('tree-item').createDiv('tree-item-self mod-file onenote-ferry-page');
			const inner = self.createDiv('tree-item-inner file-tree-item');
			// In line with the rows that have a box.
			inner.createSpan('onenote-ferry-box-space');
			setIcon(inner.createDiv('file-tree-item-icon'), icon);
			inner.createDiv({ cls: `file-tree-item-title${muted ? ' onenote-ferry-muted' : ''}`, text });
			ImportWizard.showFlair(self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair'), flair);
		};
		// Where it was, when OneNote renamed it or moved it to another group.
		if (item.old !== undefined && item.new !== undefined && fold(item.old) !== fold(item.new)) {
			const was = item.before ? [...item.before.groups, item.before.name].join(' / ') : item.old;
			out.push(line(ui.sectionWas(was), { text: '' }, 'lucide-folder-input', true));
		}
		for (const page of item.added.filter(page => !page.userDeleted)) out.push(line(page.title || untitled, { text: ui.pageAdded }));
		for (const page of item.modified) {
			out.push(line(page.title || untitled, page.userEdited
				? { text: ui.pageBothEdited, tone: 'warn', tip: ui.pageBothEditedTip(folder) }
				: { text: ui.pageModified, ...(page.from !== undefined ? { tip: ui.pageRetitled(page.from || untitled) } : {}) }));
		}
		for (const page of item.removed) out.push(line(page.title || untitled, { text: ui.pageRemoved, tip: ui.keptAsIs }));
		// Pages the user deleted in Obsidian: each can be brought back.
		for (const page of item.added.filter(page => page.userDeleted)) {
			out.push((parent, rows) => {
				const self = parent.createDiv('tree-item').createDiv('tree-item-self is-clickable mod-file onenote-ferry-page');
				const inner = self.createDiv('tree-item-inner file-tree-item');
				const box = inner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
				setIcon(inner.createDiv('file-tree-item-icon'), 'lucide-file-text');
				inner.createDiv({ cls: 'file-tree-item-title', text: page.title || untitled });
				ImportWizard.showFlair(self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair'), { text: ui.pageDeleted });
				box.addEventListener('click', event => event.stopPropagation());
				box.addEventListener('change', () => session.setRestored(choice, section, page.id, box.checked));
				self.addEventListener('click', () => session.setRestored(choice, section, page.id, !box.checked));
				rows.push(() => {
					box.checked = session.isRestored(choice, section, page.id);
					// What a click does, on hover anywhere on the row, as on a section's row.
					showTip(self, box.checked ? undefined : ui.pageDeletedTip);
				});
			});
		}
		if (item.reordered.length) out.push(line(ui.pagesReordered(item.reordered.length), { text: '' }, 'lucide-list-ordered', true));
		return out;
	}

	/** What the right of a row says, and why on hover. */
	private note(kind: 'notebook' | 'group' | 'section', choice: NotebookChoice, node: TreeNode, states: RowState[]): Flair {
		const ui = this.ui;
		const session = this.session;
		if (!node.sections.length) return { text: ui.noSections };
		if (states.every(state => state === 'blocked')) return { text: kind === 'notebook' ? choice.otherSpelling ? ui.folderSpelling : ui.folderTaken : '' };
		if (kind === 'notebook' && choice.earlier) {
			// A notebook imported before: what changed in it, in a few words (open it for the rest).
			if (!choice.plan) return { text: ui.checkingRow };
			if (choice.plan.identity === 'different') return { text: ui.different, tip: ui.differentTip };
			if (states.every(state => state === 'duplicate' || state === 'gone')) return { text: ui.duplicate, tip: ui.duplicateTip };
			return this.summary(choice, node, states);
		}
		// A notebook new to the target folder, while others there are updated: it is ticked only when asked.
		if (kind === 'notebook' && session.updating) return { text: ui.notImported };
		const same = states.every(state => state === states[0]) ? states[0] : undefined;
		if (kind === 'group') {
			// A group in a notebook imported before that holds updates says so, as its notebook does.
			if (choice.earlier && states.some(state => STRONG.has(state))) return this.summary(choice, node, states);
			return same !== undefined && GROUP_WORDS.has(same) ? this.word(choice, node, same) : { text: '' };
		}
		if (kind === 'section') return this.word(choice, node, states[0]!);
		// A new notebook whose sections all cannot be ticked for one reason: that reason; else its size.
		if (same === 'locked' || same === 'incomplete') return this.word(choice, node, same);
		const bytes = node.sections.reduce((n, section) => n + section.size, 0);
		return { text: bytes ? formatBytes(bytes) : '' };
	}

	/**
	 * A notebook (or group) imported before, collapsed: how many sections the update takes unless
	 * unticked (as the bottom line counts them; a download older than the vault is no update), in the
	 * warning colour when pages edited on both sides are among them; "no changes" only when nothing
	 * in it differs or needs a look.
	 */
	private summary(choice: NotebookChoice, node: TreeNode, states: RowState[]): Flair {
		const ui = this.ui;
		const session = this.session;
		const changed = states.filter(state => STRONG.has(state)).length;
		if (changed) {
			const both = node.sections.some((section, i) => states[i] === 'changed' && session.itemOf(choice, section)?.modified.some(page => page.userEdited));
			return { text: ui.sectionsChanged(changed), tone: both ? 'warn' : 'strong' };
		}
		const reconverting = node.sections.filter(section => session.reconverts(choice, section)).length;
		if (reconverting) return { text: ui.sectionsReconverting(reconverting), tone: 'strong' };
		if (!states.every(state => QUIET.has(state))) return { text: '' };
		// Imported in part, the rest left unticked then: "no changes" would read as all of it being there.
		const skipped = states.filter(state => state === 'skipped').length;
		if (skipped && states.some(state => IMPORTED.has(state))) return { text: ui.partlyImported, tip: ui.partlyImportedTip(skipped) };
		return { text: ui.unchanged };
	}

	/** The word for a section (or a group of sections) in one state. */
	private word(choice: NotebookChoice, node: TreeNode, state: RowState): Flair {
		const ui = this.ui;
		const session = this.session;
		const section = node.sections[0]!;
		const folder = session.oldVersionsFolder;
		switch (state) {
			case 'free': {
				// Sections cut off in the download have no size: nothing rather than "0 B".
				const bytes = node.sections.reduce((n, one) => n + one.size, 0);
				return { text: bytes ? formatBytes(bytes) : '' };
			}
			case 'locked': return { text: ui.locked };
			case 'incomplete': return { text: ui.incomplete };
			case 'occupied': return { text: ui.folderTaken };
			case 'unreadable': {
				const error = node.sections.length === 1 ? session.itemOf(choice, section)?.error : undefined;
				// Hover text ends without a full stop, like every other tip; the message itself is a sentence.
				return { text: ui.unreadable, ...(error ? { tip: error.replace(/(?<![.。])[.。]$/u, '') } : {}) };
			}
			case 'checking': return { text: ui.checkingRow };
			case 'same': {
				// Clicked: converted again with the settings chosen now (§11.5 item 65); else what comes back of the pages deleted in Obsidian (§11.5 item 79).
				const chosen = node.sections.filter(one => session.reconverts(choice, one)).length;
				if (chosen && chosen === node.sections.length) return { text: ui.reconvertMark, tone: 'strong' };
				const back = node.sections.reduce((n, one) => n + session.restoredCount(choice, one), 0);
				return back ? { text: ui.bringingBack(back), tone: 'strong' } : { text: ui.unchanged };
			}
			case 'gone': return { text: ui.gone, tip: ui.keptAsIs };
			case 'changed': {
				const both = session.itemOf(choice, section)?.modified.filter(page => page.userEdited).length ?? 0;
				return both ? { text: ui.changed, tone: 'warn', tip: ui.bothEditedIn(both) } : { text: ui.changed, tone: 'strong' };
			}
			case 'older': return { text: ui.older, tip: ui.olderTip(folder) };
			case 'new': return { text: ui.newSection, tone: 'strong' };
			case 'unfinished': return { text: ui.unfinished, tone: 'strong' };
			case 'skipped': return { text: ui.skipped };
			case 'missing': return { text: ui.missing, tip: ui.missingTip };
			default: return { text: '' };
		}
	}

	// While the import runs.

	private running(): void {
		const ui = this.ui;
		const session = this.session;
		const box = this.contentEl.createDiv('onenote-ferry-progress-view');
		const count = box.createDiv('onenote-ferry-progress-count');
		const barHolder = box.createDiv();
		const bar = new ProgressBarComponent(barHolder);
		// How far it has come when that can be told; sliding while it cannot (the download's size not
		// known yet, the downloads being read, a first section being converted: a single large one
		// takes a while and says nothing until it is done), rather than an empty bar that looks stuck.
		const show = (fraction: number | undefined) => {
			barHolder.toggleClass('onenote-ferry-indeterminate', fraction === undefined);
			bar.setValue(fraction === undefined ? 30 : Math.floor(fraction * 100));
		};
		const name = box.createDiv('onenote-ferry-progress-name');
		box.createDiv({ cls: 'onenote-ferry-progress-hint', text: session.running === 'update' ? ui.closeHintUpdate : ui.closeHint });
		const footer = this.footer();
		const stop = new ButtonComponent(footer).onClick(() => session.requestStop());
		this.refresh = () => {
			const p = session.progress;
			const time = ui.elapsed(elapsed(Date.now() - session.startedAt));
			const d = session.downloading;
			if (d) {
				// Sections chosen from OneDrive coming down before the import.
				// In sections, as the import counts them (files only when no section is among them).
				const [done, total] = d.totalSections ? [d.sections, d.totalSections] : [d.files, d.totalFiles];
				count.setText(`${ui.statusDownloading(Math.min(done + 1, total), total)} · ${time}`);
				show(d.totalBytes ? d.bytes / d.totalBytes : undefined);
				name.setText(d.current ?? '');
				name.setAttribute('title', d.current ?? '');
			}
			else if (!p) {
				count.setText(`${ui.statusReading} · ${time}`);
				show(undefined);
				name.setText('');
			}
			else {
				count.setText(`${ui.sectionCount(p.done + 1, p.total)} · ${time}`);
				show(p.done ? p.done / p.total : undefined);
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
		const update = session.running === 'update';
		const box = this.contentEl.createDiv('onenote-ferry-result');
		const heading = box.createDiv('onenote-ferry-result-heading');
		// An update with nothing left to do when it started (a cut-off one finished first) did not fail.
		const failed = !!session.error || (!update && (!outcome || !result)) || session.nothingDownloaded;
		const stopped = !failed && (!!result?.cancelled || !!session.updateResult?.cancelled || (update && session.stopRequested && !session.updateResult));
		setIcon(heading.createSpan('onenote-ferry-result-icon'), failed ? 'lucide-circle-x' : stopped ? 'lucide-circle-pause' : 'lucide-circle-check');
		heading.createSpan({ text: update
			? failed ? ui.updateFailed : stopped ? ui.updateStopped : ui.updateFinished
			: failed ? ui.failed : stopped ? ui.stopped : ui.finished });
		const footer = this.footer();
		if (failed) {
			// Nothing could be downloaded from OneDrive: how many, and why.
			const lines = session.nothingDownloaded && !session.error ? [ui.leftOutNotDownloaded(session.notDownloaded), ...session.notDownloadedWhy] : [session.alreadyThere ? ui.alreadyInFolder(session.alreadyThere) : session.error ?? ''];
			for (const text of lines) box.createDiv({ cls: 'onenote-ferry-result-line onenote-ferry-warning', text });
			new ButtonComponent(footer).setButtonText(ui.close).setCta().onClick(() => this.close());
			return;
		}
		const notes: string[] = [];
		// The update: what it changed, and what needs a look (the record says which).
		const done = session.updateResult;
		if (update) {
			const counts = done?.counts;
			box.createDiv({ cls: 'onenote-ferry-result-line', text: counts ? ui.updateSummary(counts.sectionsUpdated, counts.sectionsAdded, counts.sectionsReconverted, counts.pagesAdded, counts.pagesModified, counts.pagesRestored) : ui.updateSummary(0, 0, 0, 0, 0, 0) });
			const attention = done?.attention;
			const backup = done?.backup ?? session.oldVersionsFolder;
			if (attention?.bothEdited) notes.push(ui.attnBothEdited(attention.bothEdited, backup));
			if (attention?.keptEdited) notes.push(ui.attnKeptEdited(attention.keptEdited));
			if (attention?.rolledBack) notes.push(ui.attnRolledBack(attention.rolledBack));
			if (attention?.notConverted) notes.push(ui.attnNotConverted(attention.notConverted));
			if (attention?.notUpdated) notes.push(ui.attnNotUpdated(attention.notUpdated));
			if (attention?.keptAside) notes.push(ui.attnKeptAside(attention.keptAside, backup.split('/')[0]!));
			// Stopped before the update began (while new notebooks were imported), or during it.
			const leftOut = done ? attention!.notReached : session.stopRequested ? session.updateTotal : 0;
			if (leftOut) notes.push(ui.attnLeftOut(leftOut));
		}
		// The import (of notebooks new to the target folder): the sections it converted (or noted as
		// failed), not those the user left unticked or a stop left out (those have their own line).
		if (result && result.notebooks.length) {
			const mine = (notebook: typeof result.notebooks[number]) => notebook.sections.filter(section => !section.earlier && !section.skipped);
			const handled = result.notebooks.flatMap(notebook => mine(notebook).filter(section => !section.cancelled));
			const converted = handled.filter(section => section.report);
			const summary = ui.summary(
				result.notebooks.filter(notebook => !(mine(notebook).length && mine(notebook).every(section => section.cancelled))).length, handled.length,
				converted.reduce((n, section) => n + (section.report?.pageCount ?? 0), 0),
				converted.reduce((n, section) => n + (section.report?.attachments ?? 0), 0));
			box.createDiv({ cls: 'onenote-ferry-result-line', text: update ? ui.alsoImported(summary) : summary });
			const notConverted = handled.filter(section => section.failed || section.locked).length;
			if (notConverted) notes.push(ui.notConverted(notConverted));
			const leftOut = result.notebooks.flatMap(mine).filter(section => section.cancelled).length + result.notStarted.reduce((n, notebook) => n + notebook.sections, 0);
			if (leftOut) notes.push(ui.leftOut(leftOut));
			// Only part of a notebook: some of it converted now, some left out by the stop (one the stop came
			// before entirely is counted with the sections left out).
			for (const notebook of result.notebooks) {
				if (mine(notebook).some(section => section.cancelled) && mine(notebook).some(section => !section.cancelled)) notes.push(ui.partial(notebook.notebook));
			}
		}
		// Sections chosen from OneDrive that could not be downloaded, and why (password-protected ones are counted with those not converted).
		if (session.notDownloaded) notes.push(ui.leftOutNotDownloaded(session.notDownloaded), ...session.notDownloadedWhy);
		// Stopped while downloading from OneDrive: nothing of it is lost.
		if (session.downloadsCut) notes.push(ui.downloadsKept);
		if (notes.length) {
			const list = box.createEl('ul', { cls: 'onenote-ferry-result-notes' });
			for (const note of notes) list.createEl('li', { text: note });
		}
		const close = new ButtonComponent(footer).setButtonText(ui.close).onClick(() => this.close());
		// The update's record when there is one (the report links to it), else the report.
		const target = session.recordPath ?? outcome?.reportPath;
		if (!target) {
			close.setCta();
			return;
		}
		const recordShown = target === session.recordPath;
		new ButtonComponent(footer).setButtonText(recordShown ? ui.openRecord : ui.openReport).setCta().onClick(() => {
			const file = this.app.vault.getFileByPath(target);
			if (!file) {
				new Notice(recordShown ? ui.recordMissing : ui.reportMissing);
				return;
			}
			void this.app.workspace.getLeaf(true).openFile(file);
			this.close();
		});
	}
}

/**
 * "Look in another folder": the drive as a tree, the way Finder and the import window show folders.
 * Folders open where they are (what is in them is read when first opened); notebooks are ticked;
 * "Add" adds the ticked ones. Notebooks already in the list show so, and cannot be ticked again.
 */
class NotebookPicker extends Modal {
	private readonly ui: UiStrings;
	private readonly browse: OneDriveBrowse;
	private readonly listed: ReadonlySet<string>;
	private readonly add: (notebooks: RemoteNotebook[]) => void;
	private readonly ticked = new Map<string, RemoteNotebook>();
	private summaryEl!: HTMLElement;
	private addButton!: ButtonComponent;

	constructor(app: App, ui: UiStrings, browse: OneDriveBrowse, listed: ReadonlySet<string>, add: (notebooks: RemoteNotebook[]) => void) {
		super(app);
		this.ui = ui;
		this.browse = browse;
		this.listed = listed;
		this.add = add;
		this.setTitle(ui.folderPickerTitle);
		this.modalEl.addClass('onenote-ferry-picker');
	}

	onOpen(): void {
		const ui = this.ui;
		this.contentEl.empty();
		const tree = this.contentEl.createDiv('import-section file-tree publish-section onenote-ferry-tree onenote-ferry-picker-tree').createDiv('publish-change-list');
		void this.fill(tree);
		const footer = this.contentEl.createDiv('onenote-ferry-footer');
		this.summaryEl = footer.createDiv({ cls: 'onenote-ferry-summary', text: ui.pickerHint });
		const buttons = footer.createDiv('modal-button-container');
		new ButtonComponent(buttons).setButtonText(ui.cancel).onClick(() => this.close());
		this.addButton = new ButtonComponent(buttons).setButtonText(ui.addNotebooks).setCta().setDisabled(true).onClick(() => {
			this.close();
			this.add([...this.ticked.values()]);
		});
	}

	private changed(): void {
		this.summaryEl.setText(this.ticked.size ? this.ui.pickerChosen(this.ticked.size) : this.ui.pickerHint);
		this.addButton.setDisabled(!this.ticked.size);
	}

	/** Fills `parent` with what the folder holds (the top of the drive without an ID): folders first, then notebooks. */
	private async fill(parent: HTMLElement, folderId?: string): Promise<void> {
		const waiting = this.line(parent, 'lucide-loader', this.ui.reading, true);
		let children: Awaited<ReturnType<OneDriveBrowse['children']>>;
		try {
			children = await this.browse.children(folderId);
		}
		catch (error) {
			waiting.remove();
			this.line(parent, 'lucide-circle-alert', String((error as Error)?.message ?? error), true).addClass('onenote-ferry-warning');
			return;
		}
		waiting.remove();
		const byName = <T extends { name: string }>(items: T[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		for (const folder of byName(children.folders)) this.folderRow(parent, folder);
		for (const notebook of byName(children.notebooks)) this.notebookRow(parent, notebook);
		if (!children.folders.length && !children.notebooks.length) this.line(parent, 'lucide-folder-open', this.ui.folderEmpty, true);
	}

	/** A line that is not a choice (reading, empty, an error). */
	private line(parent: HTMLElement, icon: string, text: string, muted: boolean): HTMLElement {
		const item = parent.createDiv('tree-item');
		const inner = item.createDiv('tree-item-self mod-file').createDiv('tree-item-inner file-tree-item');
		setIcon(inner.createDiv('file-tree-item-icon'), icon);
		inner.createDiv({ cls: `file-tree-item-title${muted ? ' onenote-ferry-muted' : ''}`, text });
		return item;
	}

	private folderRow(parent: HTMLElement, folder: { id: string, name: string }): void {
		const item = parent.createDiv('tree-item is-collapsed');
		const self = item.createDiv('tree-item-self is-clickable mod-folder mod-collapsible');
		const arrow = self.createDiv('tree-item-icon collapse-icon is-collapsed');
		setIcon(arrow, 'right-triangle');
		const inner = self.createDiv('tree-item-inner file-tree-item');
		setIcon(inner.createDiv('file-tree-item-icon'), 'lucide-folder');
		inner.createDiv({ cls: 'file-tree-item-title', text: folder.name });
		const children = item.createDiv('tree-item-children');
		children.hide();
		let filled = false;
		self.addEventListener('click', () => {
			const open = item.hasClass('is-collapsed');
			item.toggleClass('is-collapsed', !open);
			arrow.toggleClass('is-collapsed', !open);
			children.toggle(open);
			if (open && !filled) {
				filled = true;
				void this.fill(children, folder.id);
			}
		});
	}

	private notebookRow(parent: HTMLElement, notebook: RemoteNotebook): void {
		const listed = this.listed.has(notebook.id);
		const self = parent.createDiv('tree-item').createDiv(`tree-item-self mod-file${listed ? ' is-disabled' : ' is-clickable'}`);
		const inner = self.createDiv('tree-item-inner file-tree-item');
		const box = inner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
		box.checked = listed;
		box.disabled = listed;
		setIcon(inner.createDiv('file-tree-item-icon'), 'lucide-notebook');
		inner.createDiv({ cls: 'file-tree-item-title', text: notebook.name });
		if (listed) self.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: this.ui.alreadyListed });
		if (listed) return;
		const toggle = (on: boolean) => {
			box.checked = on;
			if (on) this.ticked.set(notebook.id, notebook);
			else this.ticked.delete(notebook.id);
			this.changed();
		};
		self.addEventListener('click', event => {
			if (event.target !== box) toggle(!box.checked);
		});
		box.addEventListener('change', () => toggle(box.checked));
	}
}
