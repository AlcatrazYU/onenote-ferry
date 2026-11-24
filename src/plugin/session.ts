// One import from start to end: the downloads chosen, their notebooks and sections and which of
// them are chosen, the settings, and then the import itself. The import window shows it and
// changes it; the import goes on when the window is closed.

import type { App } from 'obsidian';
import { distinctNames, renameNotebook } from '../core/download.ts';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import { earlierNotebook, sectionKey } from '../core/importer.ts';
import type { EarlierNotebook, ImportProgress, SectionOptions } from '../core/importer.ts';
import { reportedNotebooks } from '../core/report.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { notebookFolder } from '../core/write.ts';
import type { IncompleteZip } from '../node/download.ts';
import { AlreadyThereError, downloadName, runImport } from './run-import.ts';
import type { ImportOutcome } from './run-import.ts';
import { folderProblem } from './settings.ts';
import { VaultSink } from './vault-sink.ts';
import { ConverterStopped } from './worker-client.ts';
import type { WorkerClient } from './worker-client.ts';

export interface ChosenDownload {
	input: string;
	name: string;
	state: 'reading' | 'ready' | 'failed';
	notebooks: DownloadNotebook[];
	incomplete?: IncompleteZip;
	error?: string;
	/** It could not be read because the converter stopped (not because of the download). */
	stopped?: boolean;
	/** Paths of its password-protected sections, once looked for. */
	locked?: Set<string>;
}

export interface NotebookChoice {
	download: ChosenDownload;
	notebook: DownloadNotebook;
	/** Its name in OneNote (the notebook's name gets " (2)" when another chosen notebook has it too). */
	originalName: string;
	/**
	 * Paths (in the download) of the sections the user unticked. Every other section that can be
	 * chosen is chosen, so what the user picked survives a change of target folder.
	 */
	excluded: Set<string>;
	/** What an earlier import wrote of it in the target folder, if anything: sections are added to it. */
	earlier?: EarlierNotebook;
	/** A folder of its name is in the target folder, but not a notebook of ours: it cannot go there. */
	blocked?: boolean;
	/** That folder is spelled otherwise (another case): it is the same folder on disk, but not this name in the vault. */
	otherSpelling?: boolean;
}

/**
 * Where a section stands: can be chosen, or not (imported before, password protected, cut off, its
 * notebook's folder or its own folder holds what is not ours).
 */
export type SectionState = 'free' | 'imported' | 'locked' | 'incomplete' | 'blocked' | 'occupied';

export type Phase = 'setup' | 'running' | 'finished';

const message = (error: unknown) => String((error as Error)?.message ?? error);
const key = (name: string) => name.normalize('NFC').toLowerCase();

export class ImportSession {
	readonly downloads: ChosenDownload[] = [];
	choices: NotebookChoice[] = [];
	folder: string;
	options: Required<SectionOptions>;
	/** The language of the marks and folder names of notebooks new to the target folder. */
	language: Language;
	phase: Phase = 'setup';
	progress?: ImportProgress;
	startedAt = 0;
	outcome?: ImportOutcome;
	error?: string;
	stopRequested = false;
	/** The notebooks already in the target folder when the import started (it then wrote nothing). */
	alreadyThere?: string[];
	/** The target folder is being looked at (what earlier imports left there). */
	checking = false;
	/** Why the target folder could not be looked at, if it could not. */
	folderError?: string;
	/** The import is about to start: the target folder is looked at once more. */
	private starting = false;
	/** Names given again after a look at the target folder, since the user last changed anything (see lookUp). */
	private renamings = 0;
	private readonly listeners = new Set<() => void>();
	/** The window was closed (or the plugin turned off) before an import: nothing more is done. */
	private disposed = false;
	/** Counts lookups of the target folder, so that only the latest one is kept. */
	private lookups = 0;
	private readonly app: App;
	private readonly client: WorkerClient;
	readonly readerLanguage: Language;

	constructor(app: App, client: WorkerClient, defaults: { folder: string } & Required<SectionOptions>, readerLanguage: Language) {
		this.app = app;
		this.client = client;
		this.folder = defaults.folder;
		this.options = { boxMarkers: defaults.boxMarkers, keepFontColor: defaults.keepFontColor, imageAltText: defaults.imageAltText };
		this.readerLanguage = readerLanguage;
		this.language = readerLanguage;
	}

	/** Calls `listener` after every change; answers a function that stops it. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	changed(): void {
		for (const listener of this.listeners) listener();
	}

	/** Downloads, choices and names change only while the import is being set up. */
	private get open(): boolean {
		return this.phase === 'setup' && !this.disposed;
	}

	private async worker(): Promise<WorkerClient> {
		if (this.disposed) throw new ConverterStopped('stopped');
		if (!this.client.running) await this.client.start();
		return this.client;
	}

	/** Adds downloads (zips or folders) and reads what they hold. */
	async add(inputs: string[]): Promise<void> {
		if (!this.open) return;
		const added = inputs.filter(input => !this.downloads.some(download => download.input === input))
			.map(input => ({ input, name: downloadName(input), state: 'reading', notebooks: [] } as ChosenDownload));
		this.downloads.push(...added);
		this.changed();
		for (const download of added) {
			if (!this.open) return;
			try {
				const opened = await (await this.worker()).open(download.input);
				if (!this.open) return;
				download.notebooks = opened.notebooks;
				download.incomplete = opened.incomplete;
				download.state = 'ready';
			}
			catch (error) {
				if (!this.open) return;
				download.state = 'failed';
				download.error = message(error);
				download.stopped = error instanceof ConverterStopped;
			}
			this.rebuild();
			this.changed();
		}
		void this.findLocked();
	}

	remove(download: ChosenDownload): void {
		if (!this.open) return;
		const index = this.downloads.indexOf(download);
		if (index >= 0) this.downloads.splice(index, 1);
		this.rebuild();
		this.changed();
	}

	/** The notebooks of every download, in order; earlier choices kept, new ones with every section they can have. */
	private rebuild(): void {
		const earlier = new Map(this.choices.map(choice => [choice.notebook, choice]));
		const choices: NotebookChoice[] = [];
		for (const download of this.downloads) {
			for (const notebook of download.notebooks) {
				choices.push(earlier.get(notebook) ?? { download, notebook, originalName: notebook.sourceName ?? notebook.name, excluded: new Set() });
			}
		}
		this.choices = choices;
		this.renameAll();
	}

	/**
	 * The user wants something of the notebook: a section that can be chosen and is not unticked.
	 * Names depend on this alone: a notebook whose sections are all imported already (or cannot be
	 * read) takes no name from another of the same name, which is then added to the folder it had.
	 */
	private wanted(choice: NotebookChoice): boolean {
		return choice.notebook.sections.some(section => !choice.excluded.has(section.path) && this.sectionState(choice, section) === 'free');
	}

	/**
	 * Every notebook back to its OneNote name, then " (2)" and so on where two wanted notebooks
	 * would get one folder (a notebook unticked keeps its name and takes none from the others);
	 * then the target folder is looked at again for what the names now lead to.
	 */
	private renameAll(byUser = true): void {
		if (!this.open) return;
		if (byUser) this.renamings = 0;
		for (const choice of this.choices) renameNotebook(choice.notebook, choice.originalName);
		this.named = new Set(this.choices.filter(choice => this.wanted(choice)));
		distinctNames([...this.named].map(choice => choice.notebook));
		void this.lookUp();
	}

	/** The notebooks the names were last given for (see renameAll). */
	private named = new Set<NotebookChoice>();

	/**
	 * Looks at the target folder for each notebook: a folder of an earlier import of it (sections are
	 * added to it), a folder of its name that is not ours (it cannot go there), or nothing.
	 */
	private async lookUp(): Promise<void> {
		const lookup = ++this.lookups;
		this.checking = true;
		this.folderError = undefined;
		this.changed();
		const found = new Map<NotebookChoice, Pick<NotebookChoice, 'earlier' | 'blocked' | 'otherSpelling'>>();
		try {
			const sink = new VaultSink(this.app, this.folder);
			// The report the import will update (the reader's language first), for counts only.
			const recorded = new Map((await reportedNotebooks(sink, STRINGS[this.readerLanguage])).map(entry => [key(entry.dir), entry]));
			for (const choice of this.choices) {
				if (lookup !== this.lookups || !this.open) return;
				const dir = notebookFolder(choice.notebook.name, STRINGS[this.language]);
				if (!sink.hasChild(dir)) {
					found.set(choice, {});
					continue;
				}
				// Ours only under this very spelling: another case is the same folder on disk but not in the vault's index.
				if (!sink.exists(dir)) {
					found.set(choice, { blocked: true, otherSpelling: true });
					continue;
				}
				const earlier = await earlierNotebook(sink, dir, choice.notebook, recorded.get(key(dir)));
				found.set(choice, earlier ? { earlier } : { blocked: true });
			}
		}
		catch (error) {
			if (lookup !== this.lookups || !this.open) return;
			// The folder could not be read: nothing can be known of it, so nothing starts.
			this.folderError = message(error);
			this.checking = false;
			this.changed();
			return;
		}
		if (lookup !== this.lookups || !this.open) return;
		for (const [choice, state] of found) {
			choice.earlier = state.earlier;
			choice.blocked = state.blocked;
			choice.otherSpelling = state.otherSpelling;
		}
		this.checking = false;
		// What can be chosen may have changed which notebooks are wanted, and so the names. A few
		// rounds settle it; should two notebooks keep taking each other's folder, the names stay.
		const wanted = new Set(this.choices.filter(choice => this.wanted(choice)));
		if (this.renamings < 3 && (wanted.size !== this.named.size || [...wanted].some(choice => !this.named.has(choice)))) {
			this.renamings++;
			this.renameAll(false);
		}
		this.changed();
	}

	get reading(): boolean {
		return this.downloads.some(download => download.state === 'reading');
	}

	/** Resolves once the downloads are read and the target folder and password-protected sections looked at. */
	whenSettled(): Promise<void> {
		const busy = () => this.open && (this.reading || this.checking || this.findingLocked);
		if (!busy()) return Promise.resolve();
		return new Promise(resolve => {
			const off = this.onChange(() => {
				if (busy()) return;
				off();
				resolve();
			});
		});
	}

	/** Looks for password-protected sections in each download not looked at yet. */
	async findLocked(): Promise<void> {
		// Downloads may be removed meanwhile: a copy of the list, so none after a removed one is passed over.
		for (const download of [...this.downloads]) {
			if (!this.open) return;
			if (download.state !== 'ready' || download.locked || this.lockChecks.has(download) || !this.downloads.includes(download)) continue;
			this.lockChecks.add(download);
			try {
				const locked = await (await this.worker()).locked(download.input);
				if (!this.open) return;
				download.locked = new Set(locked);
			}
			catch {
				if (!this.open) return;
				download.locked = new Set();
			}
			finally {
				this.lockChecks.delete(download);
			}
			this.changed();
		}
	}

	/** Downloads whose password-protected sections are being looked for. */
	private readonly lockChecks = new Set<ChosenDownload>();

	/** Password-protected sections are still being looked for: until then they could be ticked. */
	get findingLocked(): boolean {
		return this.downloads.some(download => download.state === 'ready' && !download.locked);
	}

	sectionState(choice: NotebookChoice, section: DownloadSection): SectionState {
		if (choice.blocked) return 'blocked';
		const key = sectionKey(section.groups, section.label);
		if (choice.earlier?.sections.has(key)) return 'imported';
		if (choice.earlier?.occupied.has(key)) return 'occupied';
		if (section.incomplete) return 'incomplete';
		if (choice.download.locked?.has(section.path)) return 'locked';
		return 'free';
	}

	/** The sections of a notebook that can be chosen. */
	choosable(choice: NotebookChoice, sections = choice.notebook.sections): DownloadSection[] {
		return sections.filter(section => this.sectionState(choice, section) === 'free');
	}

	/** The section goes into the import: it can be chosen and the user has not unticked it. */
	isChosen(choice: NotebookChoice, section: DownloadSection): boolean {
		return this.sectionState(choice, section) === 'free' && !choice.excluded.has(section.path);
	}

	/** Ticks or unticks some sections of a notebook. */
	setSections(choice: NotebookChoice, sections: DownloadSection[], value: boolean): void {
		if (!this.open) return;
		for (const section of sections) {
			if (value) choice.excluded.delete(section.path);
			else choice.excluded.add(section.path);
		}
		if (this.wanted(choice) !== this.named.has(choice)) this.renameAll();
		this.changed();
	}

	/** Every section that can be chosen is chosen. */
	get allChosen(): boolean {
		return this.choices.every(choice => this.choosable(choice).every(section => !choice.excluded.has(section.path)));
	}

	/** Ticks every section, or unticks them all. */
	selectAll(value: boolean): void {
		if (!this.open) return;
		for (const choice of this.choices) {
			if (value) choice.excluded.clear();
			else for (const section of choice.notebook.sections) choice.excluded.add(section.path);
		}
		this.renameAll();
		this.changed();
	}

	/** Moves the import to another target folder (as typed; cleaned by the caller). */
	setFolder(folder: string): void {
		if (!this.open) return;
		this.folder = folder;
		this.renamings = 0;
		void this.lookUp();
		this.changed();
	}

	setLanguage(language: Language): void {
		if (!this.open) return;
		this.language = language;
		this.renamings = 0;
		// Folder names of untitled notebooks follow the language.
		void this.lookUp();
		this.changed();
	}

	/** The notebooks the import will write into: with a section chosen (which also means allowed in the target folder). */
	included(): NotebookChoice[] {
		return this.choices.filter(choice => choice.notebook.sections.some(section => this.isChosen(choice, section)));
	}

	/** The sections the import will take: those chosen, and with them those of their notebooks that cannot be read (they get a page that says why). */
	private going(choice: NotebookChoice): DownloadSection[] {
		return choice.notebook.sections.filter(section => {
			const state = this.sectionState(choice, section);
			return this.isChosen(choice, section) || state === 'locked' || state === 'incomplete';
		});
	}

	/** What the import will do: notebooks, sections (with those that cannot be read, also counted apart) and the bytes of those sections. */
	counts(): { notebooks: number, sections: number, unreadable: number, bytes: number } {
		const included = this.included();
		const sections = included.flatMap(choice => this.going(choice));
		const unreadable = included.flatMap(choice => this.going(choice).filter(section => !this.isChosen(choice, section)));
		return { notebooks: included.length, sections: sections.length, unreadable: unreadable.length, bytes: sections.reduce((n, section) => n + section.size, 0) };
	}

	get ready(): boolean {
		return this.open && !this.starting && !this.reading && !this.checking && !this.findingLocked && !this.folderError && !folderProblem(this.folder) && this.included().length > 0;
	}

	/** Runs the import. Resolves when it ends (finished, stopped or failed). */
	async start(): Promise<void> {
		if (!this.ready) return;
		// The target folder may have changed since it was looked at (a folder removed, renamed, added).
		this.starting = true;
		try {
			await this.lookUp();
		}
		finally {
			this.starting = false;
		}
		if (!this.ready) {
			this.changed();
			return;
		}
		const included = this.included();
		const of = new Map(included.map(choice => [choice.notebook, choice]));
		const chosen = new Set(included.flatMap(choice => this.going(choice)));
		this.phase = 'running';
		this.startedAt = Date.now();
		this.changed();
		try {
			this.outcome = await runImport(this.app, this.client, {
				downloads: this.downloads.map(download => ({ input: download.input, notebooks: included.filter(choice => choice.download === download).map(choice => choice.notebook) }))
					.filter(download => download.notebooks.length),
				root: this.folder,
				languageFor: notebook => of.get(notebook)?.earlier?.language ?? this.language,
				chosen: section => chosen.has(section),
				earlier: notebook => of.get(notebook)?.earlier,
				reportLanguage: this.readerLanguage,
				options: this.options,
				isCancelled: () => this.stopRequested,
				onProgress: progress => {
					this.progress = progress;
					this.changed();
				},
			});
		}
		catch (error) {
			this.error = message(error);
			if (error instanceof AlreadyThereError) this.alreadyThere = error.names;
		}
		this.phase = 'finished';
		this.changed();
	}

	requestStop(): void {
		this.stopRequested = true;
		this.changed();
	}

	/** Ends a session that is not importing: stops the worker (which removes its temporary copies) and anything still reading. */
	dispose(): void {
		if (this.phase === 'running') return;
		this.disposed = true;
		this.client.stop();
		this.listeners.clear();
	}
}
