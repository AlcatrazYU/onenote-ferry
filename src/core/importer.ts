// Converts the notebooks of a OneDrive download: each section in turn, each notebook's table of
// contents, then the links between pages once everything is written. The command line and the
// plugin share this; they differ only in how a section is parsed and where files go (ImportHost).

import { pageFingerprint } from './fingerprint.ts';
import { Adapter } from './adapter.ts';
import type { DownloadNotebook, DownloadSection } from './download.ts';
import type { SectionSource, Sink } from './io.ts';
import { buildLinkIndex, NotebookLinks, notebookNotes, relinkPages } from './links.ts';
import type { LinkStats, SectionRef } from './links.ts';
import { joinPath, nameCollator } from './names.ts';
import { countSection, detectLanguage, emptyCounts } from './language.ts';
import type { ScriptCounts } from './language.ts';
import { LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings } from './strings.ts';
import { failedSectionToc, importStatusOf, notebookFolder, notebookToc, oneDriveTagOf, sectionFolders, sectionKey, tocHeading, writeSection } from './write.ts';
import type { NotebookTocEntry, SectionReport } from './write.ts';

export { sectionKey };

export interface ParsedSection {
	/** The parser's JSON for the section. */
	json: any;
	source: SectionSource;
	/** Frees what the parser holds for this section. */
	release(): void;
}

/** What converting one section needs. */
export interface SectionHost {
	sink: Sink;
	/** Parses a section. Throws with the parser's message when it cannot. */
	parse(section: DownloadSection): Promise<ParsedSection>;
	/** Whether a section that could not be parsed is password protected. */
	isPasswordProtected(section: DownloadSection): Promise<boolean>;
}

/** How each section is written: everything that is not about the notebook as a whole. */
export interface SectionOptions {
	boxMarkers: boolean;
	imageAltText?: boolean;
}

export interface ImportHost extends SectionHost {
	/** Folders directly under the output root: notebooks converted now or earlier, for links between them. */
	listFolders(): Promise<string[]>;
	/**
	 * Converts one section into its folder `dir` (from the output root) somewhere else: the plugin
	 * does it in its worker, so Obsidian's window never waits for the parser. Without it, sections
	 * are converted here with parse().
	 */
	convertSection?(section: DownloadSection, dir: string, language: Language, options: SectionOptions): Promise<SectionResult>;
	isCancelled?(): boolean;
	/** Before each section. */
	onProgress?(progress: ImportProgress): void;
	/** After each section, with how it went. */
	onSectionDone?(notebook: string, section: DownloadSection, result: SectionResult): void;
	/**
	 * After each section, what the import has done so far, to keep a record of it (the plugin
	 * updates its report): an import cut off half way (Obsidian quit, a crash) is not lost to the next.
	 */
	checkpoint?(sofar: ImportResult): Promise<void>;
}

export interface ImportProgress {
	notebook: string;
	section: DownloadSection;
	/** Sections done before this one, and all sections to convert. */
	done: number;
	total: number;
}

export interface ImportOptions extends SectionOptions {
	/** The language of a notebook's marks and folder names. */
	languageFor(notebook: DownloadNotebook): Language;
	/** Rewrite links between pages (`onenote:` links) once everything is written. */
	links: boolean;
	/**
	 * Whether a section is to be imported; every section is when this is not given. One not chosen
	 * is listed in its notebook's table of contents as not imported.
	 */
	chosen?(section: DownloadSection): boolean;
	/** What an earlier import wrote of a notebook (see earlierNotebook): those sections stay as they are. */
	earlier?(notebook: DownloadNotebook): EarlierNotebook | undefined;
	/** The OneDrive notebook a notebook is, when it came from there: kept on its table of contents (§11.5 item 66). */
	oneDriveOf?(notebook: DownloadNotebook): string | undefined;
}

/** A notebook an earlier import wrote into the output root, which this import adds sections to. */
export interface EarlierNotebook {
	/** Its marker language: what is added is written in it too. */
	language: Language;
	/** The sections it already has, by sectionKey: they are listed as they are and never written again. */
	sections: Map<string, SectionResult>;
	/**
	 * Sections whose folder holds something that is not ours (no table of contents of ours: the user's
	 * own notes, or a section whose table of contents the user removed): never written into.
	 */
	occupied: Set<string>;
}

export interface SectionResult extends NotebookTocEntry {
	dir?: string;
	report?: SectionReport;
	error?: string;
	/** Not converted because the download stopped inside it. */
	incomplete?: true;
	/** Written by an earlier import and kept as it was (this import added other sections). */
	earlier?: true;
	/**
	 * How it was converted, when an update wrote it (§11.5 item 65: settings go with each section).
	 * None: as its notebook's report entry says.
	 */
	options?: SectionOptions;
	stats?: unknown;
}

export interface NotebookResult {
	notebook: string;
	/** Its name in OneNote, when it was imported under another (a copy, or "Name (2)"). */
	originalName?: string;
	/** The notebook's folder under the output root. */
	dir: string;
	/** The language of its marks and folder names. */
	language: Language;
	/** The OneDrive notebook it is (`<drive>/<item ID>`), when it came from there (§11.5 item 66). */
	oneDrive?: string;
	sections: SectionResult[];
}

export interface ImportResult {
	notebooks: NotebookResult[];
	links?: LinkStats;
	/** Stopped before every section was converted. */
	cancelled: boolean;
	/** Notebooks the import stopped before (nothing of them was written). */
	notStarted: { notebook: string; sections: number }[];
}

/** Table-of-contents and attachment folder names in every marker language, for links into notebooks of any language. */
export const ALL_TOC_NAMES = [...new Set(LANGUAGES.map(language => STRINGS[language].tocFileName))];
export const ALL_ATTACHMENT_FOLDERS = [...new Set(LANGUAGES.map(language => STRINGS[language].attachmentsFolder))];

/** Folds a path as the disk and Obsidian compare them (composed, any case). */
const fold = (path: string) => path.normalize('NFC').toLowerCase();

/**
 * The order of a notebook's table of contents, as the download gives it: at each level sections
 * first, then section groups, each by name. Used to put in place the sections an earlier import
 * wrote that this download no longer has.
 */
function tocOrder(a: { groups: string[], section: string }, b: { groups: string[], section: string }): number {
	for (let i = 0; ; i++) {
		const ga = a.groups[i], gb = b.groups[i];
		if (ga === undefined && gb === undefined) return nameCollator.compare(`${a.section}.one`, `${b.section}.one`);
		if (ga === undefined) return -1;
		if (gb === undefined) return 1;
		if (ga !== gb) return nameCollator.compare(ga, gb);
	}
}

/** `entries` (in the download's order) with `extra` ones put where they belong. */
export function inTocOrder<T extends { groups: string[], section: string }>(entries: T[], extra: T[]): T[] {
	const out = [...entries];
	for (const entry of extra) {
		const at = out.findIndex(other => tocOrder(entry, other) < 0);
		out.splice(at < 0 ? out.length : at, 0, entry);
	}
	return out;
}

export async function importNotebooks(notebooks: DownloadNotebook[], host: ImportHost, options: ImportOptions): Promise<ImportResult> {
	const { sink } = host;
	// The sections this import converts: chosen, not there from an earlier import, and not in a folder that is not ours.
	const toConvert = (notebook: DownloadNotebook) => {
		const earlier = options.earlier?.(notebook);
		return notebook.sections.filter(section => {
			const key = sectionKey(section.groups, section.label);
			return !earlier?.sections.has(key) && !earlier?.occupied.has(key) && (options.chosen?.(section) ?? true);
		});
	};
	const total = notebooks.reduce((n, notebook) => n + toConvert(notebook).length, 0);
	let done = 0;
	let cancelled = false;
	const results: NotebookResult[] = [];
	const notStarted: ImportResult['notStarted'] = [];
	const converted: SectionRef[] = [];
	const writtenPages: string[] = [];
	// Links rewritten while the notebooks were written (see NotebookLinks), and the pages changed then.
	let resolvedEarly = 0;
	const changedEarly = new Set<string>();
	const names = { tocFileNames: ALL_TOC_NAMES, attachmentsFolders: ALL_ATTACHMENT_FOLDERS };

	for (const notebook of notebooks) {
		if (cancelled || host.isCancelled?.()) {
			cancelled = true;
			notStarted.push({ notebook: notebook.name, sections: toConvert(notebook).length });
			continue;
		}
		const earlier = options.earlier?.(notebook);
		const language = earlier?.language ?? options.languageFor(notebook);
		const strings = STRINGS[language];
		const notebookDir = notebookFolder(notebook.name, strings);
		const tocPath = joinPath(notebookDir, `${strings.tocFileName}.md`);
		const oneDrive = options.oneDriveOf?.(notebook);
		const folders = sectionFolders(notebook.sections, strings);
		const keyOf = (section: DownloadSection) => sectionKey(section.groups, section.label);
		// Sections an earlier import wrote that this download does not have: they are there, so listed.
		const inDownload = new Set(notebook.sections.map(keyOf));
		const extra = [...earlier?.sections ?? []].filter(([key]) => !inDownload.has(key)).map(([, before]): SectionResult => ({ ...before, earlier: true }));
		// What the table of contents lists: each section where it is (its folder, for the link).
		const listing = (entries: SectionResult[]) => inTocOrder(entries, extra).map(entry => ({
			...entry,
			folder: entry.dir ? entry.dir.slice(notebookDir.length + 1) : folders.get(sectionKey(entry.groups, entry.section)),
		}));
		// The table of contents goes in first, `importing` (what is not written yet marked as not
		// imported), and again at the end: a notebook cut off half way (Obsidian quit, a crash) still
		// has one, so the next import knows the folder for ours and can add the rest.
		await sink.ensureFolder(notebookDir);
		await sink.writeText(tocPath, notebookToc(notebook.name, listing(notebook.sections.map(section => {
			const before = earlier?.sections.get(keyOf(section));
			return before ? { ...before, earlier: true } : { groups: section.groups, section: section.label, skipped: true };
		})), strings, 'importing', oneDrive));
		const renamed = notebook.sourceName !== undefined && notebook.sourceName !== notebook.name;
		const links = options.links ? new NotebookLinks(sink) : undefined;
		if (links && earlier) await links.add(await notebookNotes(sink, notebookDir, names));
		const sections: SectionResult[] = [];
		const handled = new Map<string, SectionResult>();
		/** The notebook as far as it is done: for a record of an import cut off half way. */
		const sofar = (): NotebookResult => ({
			notebook: notebook.name, ...(renamed ? { originalName: notebook.sourceName } : {}), dir: notebookDir, language, ...(oneDrive ? { oneDrive } : {}),
			sections: inTocOrder(notebook.sections.flatMap(section => {
				const entry = handled.get(keyOf(section)) ?? earlier?.sections.get(keyOf(section));
				return entry ? [entry.earlier || handled.has(keyOf(section)) ? entry : { ...entry, earlier: true as const }] : [];
			}), extra),
		});
		for (const section of notebook.sections) {
			const key = keyOf(section);
			const before = earlier?.sections.get(key);
			let result: SectionResult;
			if (before) result = { ...before, earlier: true };
			// A folder of that name holds what is not ours: nothing is written into it.
			else if (earlier?.occupied.has(key)) result = { groups: section.groups, section: section.label, skipped: true };
			else if (options.chosen && !options.chosen(section)) result = { groups: section.groups, section: section.label, skipped: true };
			else if (cancelled || host.isCancelled?.()) {
				// Stops between sections: what is written is whole; the rest is listed as not converted.
				cancelled = true;
				result = { groups: section.groups, section: section.label, cancelled: true };
			}
			else {
				host.onProgress?.({ notebook: notebook.name, section, done, total });
				const sectionOptions: SectionOptions = { boxMarkers: options.boxMarkers, imageAltText: options.imageAltText };
				const dir = joinPath(notebookDir, folders.get(key)!);
				result = host.convertSection
					? await host.convertSection(section, dir, language, sectionOptions)
					: await convertSection(section, dir, strings, host, sectionOptions);
				host.onSectionDone?.(notebook.name, section, result);
				done++;
				if (links && result.report && result.dir) {
					const pages = result.report.pages.map(page => joinPath(result.dir!, page.file));
					await links.add(pages);
					await links.relink(pages);
				}
				handled.set(key, result);
				sections.push(result);
				if (host.checkpoint) await host.checkpoint({ notebooks: [...results, sofar()], cancelled, notStarted: [...notStarted] });
				continue;
			}
			handled.set(key, result);
			sections.push(result);
		}
		if (links) {
			resolvedEarly += links.resolved;
			for (const path of links.changed) changedEarly.add(path);
		}
		const listed = inTocOrder(sections, extra);
		await sink.writeText(tocPath, notebookToc(notebook.name, listing(sections), strings, 'complete', oneDrive));
		results.push({ notebook: notebook.name, ...(renamed ? { originalName: notebook.sourceName } : {}), dir: notebookDir, language, ...(oneDrive ? { oneDrive } : {}), sections: listed });
		for (const section of listed) {
			if (!section.dir || !(section.report || section.earlier)) continue;
			const toc = joinPath(section.dir, `${strings.tocFileName}.md`);
			const rest = [...section.groups, section.section];
			// Sections written earlier are known by their OneNote names too, not only by their folders' names.
			converted.push({ source: [notebook.name, ...rest].map(s => s.normalize('NFC')), toc });
			if (renamed) converted.push({ source: [notebook.sourceName!, ...rest].map(s => s.normalize('NFC')), toc, alias: true });
			// Pages an earlier import wrote are never rewritten (links in them wait for sync).
			if (!section.earlier && section.report) writtenPages.push(...section.report.pages.map(page => joinPath(section.dir!, page.file)));
		}
	}
	// A section the host gave up on (the plugin turned off while it was converted) stops the import too.
	cancelled ||= results.some(result => result.sections.some(section => section.cancelled));

	let links: LinkStats | undefined;
	if (options.links) {
		// Links can point into any notebook under the output root, so they are fixed once everything
		// is written (those within a notebook were already, as it was written). A notebook folder is
		// one this import wrote or one with a table of contents of ours; other folders (the user's own
		// notes, when importing into the top of the vault) are never read.
		const written = new Set(results.map(result => result.dir.normalize('NFC')));
		const notebookFolders: string[] = [];
		for (const name of await host.listFolders()) {
			if (name.startsWith('.')) continue;
			if (written.has(name.normalize('NFC')) || await isOurNotebook(sink, name)) notebookFolders.push(name);
		}
		notebookFolders.sort();
		const index = await buildLinkIndex(sink, notebookFolders, converted, names);
		const changed = new Set(changedEarly);
		const last = await relinkPages(sink, writtenPages, index, changed);
		links = { links: last.links + resolvedEarly, resolved: last.resolved + resolvedEarly, unresolved: last.unresolved, filesChanged: changed.size, unresolvedTargets: last.unresolvedTargets };
	}
	return { notebooks: results, links, cancelled, notStarted };
}

/**
 * The folders directly under the output root whose notebook contents page of ours carries a OneDrive
 * notebook (§11.5 item 66), by that notebook (`<drive>/<item ID>`): more than one when the user
 * copied a notebook's folder.
 */
export async function oneDriveFolders(sink: Sink, folders: readonly string[]): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();
	for (const folder of folders) {
		for (const name of ALL_TOC_NAMES) {
			const text = await sink.readText(joinPath(folder, `${name}.md`));
			if (!importStatusOf(text)) continue;
			const tag = oneDriveTagOf(text);
			if (tag !== undefined) found.set(tag, [...found.get(tag) ?? [], folder]);
			break;
		}
	}
	return found;
}

/**
 * What an earlier import wrote of a notebook in `dir`, or undefined when the folder is not one of
 * ours (no table of contents of ours in it, §11.5 item 47). What is in the folder decides, never a
 * record: a section is there when its table of contents says it is complete, or that an update is
 * replacing some of it (the update finishes it or puts it back, §11.5 item 49). One that says
 * `importing` (cut off while it was written) or `failed`, and an empty folder, may be imported
 * (again): the same file names are written over. A folder with files but no table of contents of
 * ours is not ours (the user's own, or a section whose table of contents the user removed or
 * renamed): `occupied`, never written into. `recorded` (the notebook's entry in the report, if any)
 * only adds what is known of those sections, for counting.
 */
export async function earlierNotebook(sink: Sink, dir: string, notebook: DownloadNotebook, recorded?: { sections: SectionResult[] }): Promise<EarlierNotebook | undefined> {
	const files = await sink.listFiles(dir);
	const byFold = new Map(files.map(file => [fold(file), file]));
	const read = async (path: string) => {
		const found = byFold.get(fold(path));
		return found === undefined ? undefined : await sink.readText(found);
	};
	let language: Language | undefined;
	for (const candidate of LANGUAGES) {
		if (importStatusOf(await read(joinPath(dir, `${STRINGS[candidate].tocFileName}.md`)))) {
			language = candidate;
			break;
		}
	}
	if (!language) return undefined;
	const strings = STRINGS[language];
	const toc = `${strings.tocFileName}.md`;
	const folders = sectionFolders(notebook.sections, strings);
	/** Anything in the folder (pages, attachments, the user's own notes). */
	const holds = (folder: string) => {
		const prefix = `${fold(folder)}/`;
		return files.some(file => fold(file).startsWith(prefix));
	};
	// Only what the report says of a section's pages, for counting; never whether it failed.
	const known = new Map((recorded?.sections ?? []).map(section => [sectionKey(section.groups, section.section), section.report]));
	const entry = (groups: string[], name: string, folder: string): SectionResult => {
		const report = known.get(sectionKey(groups, name));
		return { groups, section: name, dir: folder, ...(report ? { report } : {}) };
	};
	const sections = new Map<string, SectionResult>();
	const occupied = new Set<string>();
	const matched = new Set<string>();
	for (const section of notebook.sections) {
		const key = sectionKey(section.groups, section.label);
		const folder = joinPath(dir, folders.get(key)!);
		matched.add(fold(folder));
		const status = importStatusOf(await read(joinPath(folder, toc)));
		if (status === 'complete' || status === 'syncing') sections.set(key, entry(section.groups, section.label, folder));
		else if (!status && holds(folder)) occupied.add(key);
	}
	// Sections of ours this download does not have (deleted in OneNote since, say): still there, by
	// the name their table of contents gives.
	for (const file of files) {
		if (!fold(file).endsWith(`/${fold(toc)}`)) continue;
		const folder = file.slice(0, -(toc.length + 1));
		if (fold(folder) === fold(dir) || matched.has(fold(folder))) continue;
		matched.add(fold(folder));
		const text = await sink.readText(file);
		const status = importStatusOf(text);
		if (status !== 'complete' && status !== 'syncing') continue;
		const parts = folder.slice(dir.length + 1).split('/');
		const groups = parts.slice(0, -1), name = tocHeading(text) ?? parts[parts.length - 1]!;
		sections.set(sectionKey(groups, name), entry(groups, name, folder));
	}
	return { language, sections, occupied };
}

/** Whether a folder under the output root is a notebook of ours: its table of contents (in any marker language) carries our property. */
export async function isOurNotebook(sink: Sink, folder: string): Promise<boolean> {
	for (const name of ALL_TOC_NAMES) if (importStatusOf(await sink.readText(joinPath(folder, `${name}.md`)))) return true;
	return false;
}

/** Whether a section that could not be parsed is password protected; no when even that cannot be read. */
async function isLocked(host: Pick<SectionHost, 'isPasswordProtected'>, section: DownloadSection): Promise<boolean> {
	try {
		return await host.isPasswordProtected(section);
	}
	catch {
		return false;
	}
}

/** File names to keep and to leave alone in a section's folder (an update, see writeSection). */
export interface SectionNames {
	names?: ReadonlyMap<string, string>;
	taken?: ReadonlySet<string>;
}

/** Converts one section into its folder `dir` (see sectionFolders); a failed one gets a page that says why. */
export async function convertSection(section: DownloadSection, dir: string, strings: Strings, host: SectionHost, options: SectionOptions, names: SectionNames = {}): Promise<SectionResult> {
	const { groups, label } = section;
	await host.sink.ensureFolder(dir);
	// A section that cannot be converted gets a table of contents that says why, so the notebook's
	// link to it leads somewhere.
	const failed = async (result: SectionResult, reason: string) => {
		await host.sink.writeText(joinPath(dir, `${strings.tocFileName}.md`), failedSectionToc(label, reason, strings));
		return result;
	};
	if (section.incomplete) return failed({ groups, section: label, failed: true, incomplete: true, error: strings.incompleteSection }, strings.incompleteSection);
	let parsed: ParsedSection;
	try {
		parsed = await host.parse(section);
	}
	catch (error) {
		// Password protected (a clear message) or another failure.
		const message = String((error as Error)?.message ?? error).slice(0, 500);
		if (await isLocked(host, section)) return failed({ groups, section: label, failed: true, locked: true, error: strings.passwordProtected }, strings.passwordProtected);
		return failed({ groups, section: label, failed: true, error: message }, strings.conversionFailedNote(message));
	}
	try {
		const adapter = new Adapter(strings);
		// Each page's content fingerprint, so that a later check for updates sees what OneNote changed (§11.5 item 59).
		const fingerprints = new Map<string, string>(await Promise.all((parsed.json.pages as { id: string, contents?: unknown }[]).map(async page => [page.id, await pageFingerprint(page.contents)] as [string, string])));
		const report = await writeSection(adapter.section(parsed.json), parsed.source, host.sink, {
			dir, label: parsed.json.name || label, strings,
			boxMarkers: options.boxMarkers, imageAltText: options.imageAltText,
			...names, fingerprints,
		});
		return { groups, section: label, dir, report, stats: { parser: parsed.json.stats, parserErrors: parsed.json.errors, ...adapter.stats } };
	}
	catch (error) {
		// Writing it failed half way (a page the disk or the vault refused): its contents page says
		// so (it may be imported again), and the import goes on.
		const message = String((error as Error)?.message ?? error).slice(0, 500);
		try {
			return await failed({ groups, section: label, failed: true, error: message }, strings.conversionFailedNote(message));
		}
		catch {
			return { groups, section: label, failed: true, error: message };
		}
	}
	finally {
		parsed.release();
	}
}

export interface SectionScan {
	section: DownloadSection;
	pages?: number;
	/** Distinct attachments (pictures and files) and their size in bytes. */
	attachments?: number;
	attachmentBytes?: number;
	/** Why the section cannot be converted. */
	error?: string;
	locked?: boolean;
	/** The download stopped inside this section's file. */
	incomplete?: boolean;
}

export interface NotebookScan {
	notebook: DownloadNotebook;
	sections: SectionScan[];
	counts: ScriptCounts;
	/** The notebook's language, or undefined when it has too little text to tell. */
	language?: Language;
}

/** What an import would bring: parses each section (without reading its attachments) for the preview and the notebook's language. */
export async function scanNotebook(notebook: DownloadNotebook, host: Pick<SectionHost, 'parse' | 'isPasswordProtected'> & { isCancelled?(): boolean }, onSection?: (section: DownloadSection) => void): Promise<NotebookScan> {
	const counts = emptyCounts();
	const sections: SectionScan[] = [];
	for (const section of notebook.sections) {
		if (host.isCancelled?.()) break;
		onSection?.(section);
		if (section.incomplete) {
			sections.push({ section, incomplete: true });
			continue;
		}
		let parsed: ParsedSection;
		try {
			parsed = await host.parse(section);
		}
		catch (error) {
			const locked = await isLocked(host, section);
			sections.push({ section, locked, error: locked ? undefined : String((error as Error)?.message ?? error).slice(0, 500) });
			continue;
		}
		try {
			countSection(parsed.json, counts);
			const assets = new Map<string, number>();
			const walk = (x: any): void => {
				if (Array.isArray(x)) {
					for (const v of x) walk(v);
					return;
				}
				if (!x || typeof x !== 'object') return;
				if ((x.type === 'image' || x.type === 'file') && x.asset?.asset) assets.set(x.asset.asset, x.asset.size ?? 0);
				for (const value of Object.values(x)) walk(value);
			};
			walk(parsed.json.pages);
			sections.push({ section, pages: (parsed.json.pages ?? []).length, attachments: assets.size, attachmentBytes: [...assets.values()].reduce((a, b) => a + b, 0) });
		}
		finally {
			parsed.release();
		}
	}
	return { notebook, sections, counts, language: detectLanguage(counts) };
}
