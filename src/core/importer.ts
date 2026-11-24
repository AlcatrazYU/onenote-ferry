// Converts the notebooks of a OneDrive download: each section in turn, each notebook's table of
// contents, then the links between pages once everything is written. The command line and the
// plugin share this; they differ only in how a section is parsed and where files go (ImportHost).

import { Adapter } from './adapter.ts';
import type { DownloadNotebook, DownloadSection } from './download.ts';
import type { SectionSource, Sink } from './io.ts';
import { buildLinkIndex, relinkPages } from './links.ts';
import type { LinkStats, SectionRef } from './links.ts';
import { joinPath } from './names.ts';
import { countSection, detectLanguage, emptyCounts } from './language.ts';
import type { ScriptCounts } from './language.ts';
import { LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings } from './strings.ts';
import { failedSectionToc, notebookFolder, notebookToc, sectionFolder, writeSection } from './write.ts';
import type { NotebookTocEntry, SectionReport } from './write.ts';

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
	keepFontColor: boolean;
	imageAltText?: boolean;
}

export interface ImportHost extends SectionHost {
	/** Folders directly under the output root: notebooks converted now or earlier, for links between them. */
	listFolders(): Promise<string[]>;
	/**
	 * Converts one section somewhere else (the plugin does it in its worker, so Obsidian's window
	 * never waits for the parser). Without it, sections are converted here with parse().
	 */
	convertSection?(section: DownloadSection, notebookDir: string, language: Language, options: SectionOptions): Promise<SectionResult>;
	isCancelled?(): boolean;
	/** Before each section. */
	onProgress?(progress: ImportProgress): void;
	/** After each section, with how it went. */
	onSectionDone?(notebook: string, section: DownloadSection, result: SectionResult): void;
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
}

export interface SectionResult extends NotebookTocEntry {
	dir?: string;
	report?: SectionReport;
	error?: string;
	stats?: unknown;
}

export interface NotebookResult {
	notebook: string;
	/** The notebook's folder under the output root. */
	dir: string;
	sections: SectionResult[];
}

export interface ImportResult {
	notebooks: NotebookResult[];
	links?: LinkStats;
	/** Stopped before every section was converted. */
	cancelled: boolean;
}

/** Table-of-contents and attachment folder names in every marker language, for links into notebooks of any language. */
const ALL_TOC_NAMES = [...new Set(LANGUAGES.map(language => STRINGS[language].tocFileName))];
const ALL_ATTACHMENT_FOLDERS = [...new Set(LANGUAGES.map(language => STRINGS[language].attachmentsFolder))];

export async function importNotebooks(notebooks: DownloadNotebook[], host: ImportHost, options: ImportOptions): Promise<ImportResult> {
	const { sink } = host;
	const total = notebooks.reduce((n, notebook) => n + notebook.sections.length, 0);
	let done = 0;
	let cancelled = false;
	const results: NotebookResult[] = [];
	const converted: SectionRef[] = [];
	const writtenPages: string[] = [];

	for (const notebook of notebooks) {
		if (host.isCancelled?.()) {
			cancelled = true;
			break;
		}
		const language = options.languageFor(notebook);
		const strings = STRINGS[language];
		const notebookDir = notebookFolder(notebook.name, strings);
		await sink.ensureFolder(notebookDir);
		const sections: SectionResult[] = [];
		for (const section of notebook.sections) {
			if (cancelled || host.isCancelled?.()) {
				// Stops between sections: what is written is whole; the rest is listed as not converted.
				cancelled = true;
				sections.push({ groups: section.groups, section: section.label, cancelled: true });
				continue;
			}
			host.onProgress?.({ notebook: notebook.name, section, done, total });
			const sectionOptions: SectionOptions = { boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor, imageAltText: options.imageAltText };
			const result = host.convertSection
				? await host.convertSection(section, notebookDir, language, sectionOptions)
				: await convertSection(section, notebookDir, strings, host, sectionOptions);
			sections.push(result);
			host.onSectionDone?.(notebook.name, section, result);
			done++;
		}
		await sink.writeText(joinPath(notebookDir, `${strings.tocFileName}.md`), notebookToc(notebook.name, sections, strings));
		results.push({ notebook: notebook.name, dir: notebookDir, sections });
		for (const section of sections) {
			if (!section.report || !section.dir) continue;
			converted.push({ source: [notebook.name, ...section.groups, section.section].map(s => s.normalize('NFC')), toc: joinPath(section.dir, `${strings.tocFileName}.md`) });
			writtenPages.push(...section.report.pages.map(page => joinPath(section.dir!, page.file)));
		}
	}

	let links: LinkStats | undefined;
	if (options.links) {
		// Links can point into any notebook under the output root, so they are fixed once everything is written.
		const notebookFolders = (await host.listFolders()).filter(name => !name.startsWith('_') && !name.startsWith('.')).sort();
		const index = await buildLinkIndex(sink, notebookFolders, converted, { tocFileNames: ALL_TOC_NAMES, attachmentsFolders: ALL_ATTACHMENT_FOLDERS });
		links = await relinkPages(sink, writtenPages, index);
	}
	return { notebooks: results, links, cancelled };
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

/** Converts one section into its folder under the notebook's folder; a failed one gets a page that says why. */
export async function convertSection(section: DownloadSection, notebookDir: string, strings: Strings, host: SectionHost, options: SectionOptions): Promise<SectionResult> {
	const { groups, label } = section;
	const dir = joinPath(notebookDir, sectionFolder(groups, label, strings));
	await host.sink.ensureFolder(dir);
	// A section that cannot be converted gets a table of contents that says why, so the notebook's
	// link to it leads somewhere.
	const failed = async (result: SectionResult, reason: string) => {
		await host.sink.writeText(joinPath(dir, `${strings.tocFileName}.md`), failedSectionToc(label, reason, strings));
		return result;
	};
	if (section.incomplete) return failed({ groups, section: label, failed: true, error: strings.incompleteSection }, strings.incompleteSection);
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
		const report = await writeSection(adapter.section(parsed.json), parsed.source, host.sink, {
			dir, label: parsed.json.name || label, strings,
			boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor, imageAltText: options.imageAltText,
		});
		return { groups, section: label, dir, report, stats: { parser: parsed.json.stats, parserErrors: parsed.json.errors, ...adapter.stats } };
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
