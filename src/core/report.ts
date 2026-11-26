// The import report, in the output root: a page to read (`_conversion report.md`) and the same in
// JSON for programs (later syncs), both in the reader's language rather than each notebook's.
// Each import updates it: the notebooks imported now replace their earlier entries, and the
// other notebooks still in the folder stay listed. A folder has one report: when it already holds
// one under another language's name, that one is updated (in the reader's language now).

import type { ImportResult, SectionOptions, SectionResult } from './importer.ts';
import type { Sink } from './io.ts';
import type { LinkStats } from './links.ts';
import { composedText, joinPath } from './names.ts';
import { isLanguage, LANGUAGES, STRINGS } from './strings.ts';
import type { Language, Strings } from './strings.ts';

export const REPORT_FORMAT = 1;

export interface ReportNotebook {
	notebook: string;
	/** Its name in OneNote, when it was imported under another (a copy, or "Name (2)"). */
	originalName?: string;
	/** Its folder under the output root. */
	dir: string;
	language: Language;
	/** The OneDrive notebook it is (`<drive>/<item ID>`), when it came from there (§11.5 item 66). */
	oneDrive?: string;
	/** When it was imported (ISO 8601). */
	importedAt: string;
	/** The download it came from (a file or folder name, not a full path). */
	source: string;
	options: SectionOptions;
	sections: SectionResult[];
}

export interface ImportReport {
	format: typeof REPORT_FORMAT;
	lastImport: {
		at: string;
		/** The downloads (file or folder names, not full paths). */
		sources: string[];
		seconds?: number;
		cancelled: boolean;
		/** Folders of the notebooks this import wrote. */
		notebooks: string[];
		notStarted: { notebook: string; sections: number }[];
		links?: LinkStats;
		/** Written while the import ran (it records what was done so far): it had not ended. */
		unfinished?: true;
		/** The run was an update: its record (a path from the output root). */
		update?: string;
		/** When the update began, for a run that imported new notebooks first (`at` is when the import began). */
		updateAt?: string;
	};
	notebooks: ReportNotebook[];
}

export interface ReportMeta {
	at: Date;
	/** The downloads (file or folder names, not full paths). */
	sources: string[];
	/** The download a notebook (by its folder) came from, when there were several. */
	sourceOf?(dir: string): string | undefined;
	seconds?: number;
	options: SectionOptions;
	/** The import is still running (a record of what it has done so far). */
	unfinished?: true;
	/** How a notebook (by its folder) was converted, when not `options`: an update keeps each notebook's own. */
	optionsOf?(dir: string): SectionOptions | undefined;
	/** The run was an update: its record (a path from the output root). */
	update?: string;
	/**
	 * The run imported new notebooks first and this is its update: the time that import's report
	 * gave its last import. The last import then covers both (the plugin, new and earlier notebooks ticked together).
	 */
	joins?: string;
}

/** Folders as a disk that ignores case, and Obsidian (which composes every path), tell them apart. */
const key = (dir: string) => dir.normalize('NFC').toLowerCase();

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown) => value === undefined || typeof value === 'number';

/** A section entry as this code reads it (the file may have been edited by hand, or be damaged). */
function isSection(value: unknown): value is SectionResult {
	const section = value as SectionResult | null;
	if (!section || typeof section !== 'object' || !isString(section.section) || !Array.isArray(section.groups) || !section.groups.every(isString)) return false;
	if (section.dir !== undefined && !isString(section.dir)) return false;
	if (section.error !== undefined && !isString(section.error)) return false;
	const report = section.report;
	if (report === undefined) return true;
	return !!report && typeof report === 'object' && isNumber(report.pageCount) && isNumber(report.attachments) && Array.isArray(report.pages)
		&& report.pages.every(page => !!page && isString(page.file) && (page.title === undefined || isString(page.title)) && (page.fingerprint === undefined || isString(page.fingerprint)) && Array.isArray(page.skipped) && page.skipped.every(isString));
}

function isEntry(value: unknown): value is ReportNotebook {
	const notebook = value as ReportNotebook | null;
	return !!notebook && typeof notebook === 'object' && isString(notebook.notebook) && isString(notebook.dir) && isString(notebook.importedAt)
		&& !isNaN(Date.parse(notebook.importedAt)) && isLanguage(notebook.language) && Array.isArray(notebook.sections) && notebook.sections.every(isSection)
		&& (notebook.oneDrive === undefined || isString(notebook.oneDrive));
}

const isStats = (value: unknown): value is LinkStats => {
	const stats = value as LinkStats | null;
	return !!stats && typeof stats === 'object' && [stats.links, stats.resolved, stats.unresolved, stats.filesChanged].every(n => typeof n === 'number')
		&& !!stats.unresolvedTargets && typeof stats.unresolvedTargets === 'object';
};

/** An earlier report's last import, when it can be read. */
function lastImportOf(previous: unknown): ImportReport['lastImport'] | undefined {
	const report = previous as ImportReport | null;
	const last = report && typeof report === 'object' && report.format === REPORT_FORMAT ? report.lastImport : undefined;
	if (!last || typeof last !== 'object' || !isString(last.at) || !Array.isArray(last.sources) || !last.sources.every(isString)
		|| !Array.isArray(last.notebooks) || !last.notebooks.every(isString) || !Array.isArray(last.notStarted)) return undefined;
	return last;
}

/** Link counts of two parts of one run (they fix links in different pages). */
function addLinks(a: LinkStats | undefined, b: LinkStats | undefined): LinkStats | undefined {
	if (!a || !b) return a ?? b;
	const targets = { ...a.unresolvedTargets };
	for (const [target, n] of Object.entries(b.unresolvedTargets)) targets[target] = (targets[target] ?? 0) + n;
	return { links: a.links + b.links, resolved: a.resolved + b.resolved, unresolved: a.unresolved + b.unresolved, filesChanged: a.filesChanged + b.filesChanged, unresolvedTargets: targets };
}

/** The entries of an earlier report that can be read; one damaged entry does not cost the others. */
function earlierEntries(previous: unknown): ReportNotebook[] {
	const report = previous as ImportReport | null;
	if (!report || typeof report !== 'object' || report.format !== REPORT_FORMAT || !Array.isArray(report.notebooks)) return [];
	return report.notebooks.filter(isEntry);
}

/**
 * The report after an import. `previous` is what the report file held (anything; a report in
 * another form starts afresh); `folders` are the folders now under the output root, so notebooks
 * that were removed drop out.
 */
export function updateReport(previous: unknown, result: ImportResult, meta: ReportMeta, folders: string[]): ImportReport {
	const at = meta.at.toISOString();
	const fresh = new Map(result.notebooks.map(notebook => [key(notebook.dir), {
		notebook: notebook.notebook, ...(notebook.originalName !== undefined ? { originalName: notebook.originalName } : {}), dir: notebook.dir, language: notebook.language,
		...(notebook.oneDrive !== undefined ? { oneDrive: notebook.oneDrive } : {}),
		importedAt: at, source: meta.sourceOf?.(notebook.dir) ?? meta.sources.join(', '), options: meta.optionsOf?.(notebook.dir) ?? meta.options, sections: notebook.sections,
	} satisfies ReportNotebook]));
	const present = new Set(folders.map(key));
	const notebooks: ReportNotebook[] = [];
	for (const earlier of earlierEntries(previous)) {
		// The same notebook: in the same folder, or (renamed with OneNote, §11.5 item 66) the same OneDrive notebook.
		const now = fresh.get(key(earlier.dir)) ?? (earlier.oneDrive !== undefined && !present.has(key(earlier.dir)) ? [...fresh.values()].find(one => one.oneDrive === earlier.oneDrive) : undefined);
		if (now) {
			// Nothing of it written now (only earlier sections, sections left unticked or left out by a
			// stop): it keeps when, from what and how it was imported.
			const added = now.sections.some(section => !section.earlier && !section.skipped && !section.cancelled);
			notebooks.push(added ? now : { ...now, importedAt: earlier.importedAt, source: earlier.source, options: earlier.options });
			fresh.delete(key(now.dir));
		}
		else if (present.has(key(earlier.dir))) notebooks.push(earlier);
	}
	notebooks.push(...fresh.values());
	// An update that follows the same run's import: the last import is the whole run.
	const begun = meta.joins !== undefined ? lastImportOf(previous) : undefined;
	const first = begun && begun.at === meta.joins && !begun.update ? begun : undefined;
	const written = result.notebooks.map(notebook => notebook.dir);
	return {
		format: REPORT_FORMAT,
		lastImport: first
			? {
				at: first.at, sources: [...new Set([...first.sources, ...meta.sources])], cancelled: !!first.cancelled || result.cancelled,
				notebooks: [...first.notebooks, ...written.filter(dir => !first.notebooks.some(other => key(other) === key(dir)))],
				notStarted: [...first.notStarted, ...result.notStarted], links: addLinks(isStats(first.links) ? first.links : undefined, result.links),
				...(meta.unfinished ? { unfinished: true as const } : {}),
				...(meta.update ? { update: meta.update, updateAt: at } : {}),
			}
			: {
				at, sources: meta.sources, seconds: meta.seconds, cancelled: result.cancelled,
				notebooks: written, notStarted: result.notStarted, links: result.links,
				...(meta.unfinished ? { unfinished: true as const } : {}),
				...(meta.update ? { update: meta.update } : {}),
			},
		notebooks,
	};
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local date and time, to the minute. */
export function reportTime(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const notConverted = (section: SectionResult) => !!(section.failed || section.locked) && !section.cancelled;
/**
 * A name or reason as plain text on the page: every mark Markdown or Obsidian would act on is
 * escaped (links, code, emphasis, highlights, comments, tags, math, block ids, tables).
 */
export const text = (value: string) => composedText(value).replace(/\s+/g, ' ').trim().replace(/[\\[\]`<>*_~=%#$^|]/g, '\\$&');
export const link = (label: string, path: string) => `[${text(label)}](<${path}>)`;

/** Counts over the sections of some notebooks (those not chosen for import left out), or only those `which` keeps. */
/**
 * Counts: the sections converted (or noted as failed); those a stop left out are counted apart, and
 * those the user left unticked not at all.
 */
function totals(notebooks: ReportNotebook[], which: (section: SectionResult) => boolean = () => true) {
	const listed = notebooks.map(notebook => notebook.sections.filter(section => !section.skipped && which(section)));
	const sections = listed.flat().filter(section => !section.cancelled);
	return {
		// A notebook a stop left out entirely is not counted; one without sections is.
		notebooks: listed.filter(own => !(own.length && own.every(section => section.cancelled))).length,
		sections: sections.length,
		pages: sections.reduce((n, section) => n + (section.report?.pageCount ?? 0), 0),
		attachments: sections.reduce((n, section) => n + (section.report?.attachments ?? 0), 0),
		notConverted: sections.filter(notConverted).length,
		cancelled: listed.flat().filter(section => section.cancelled).length,
	};
}

/** Why a section was not converted, in the reader's language (the section's own note is in its notebook's). */
function reason(section: SectionResult, strings: Strings): string {
	if (section.locked) return strings.passwordProtected;
	// The flag, or (in reports written before it) the wording of the time.
	if (section.incomplete || Object.values(STRINGS).some(s => s.incompleteSection === section.error)) return strings.incompleteSection;
	return strings.conversionFailedNote(section.error ?? '');
}

/** The page to read. */
export function reportMarkdown(report: ImportReport, strings: Strings): string {
	const r = strings.report;
	const last = report.lastImport;
	const imported = report.notebooks.filter(notebook => last.notebooks.some(dir => key(dir) === key(notebook.dir)));
	// The last import: the sections it converted, not those an earlier one had written.
	const now = totals(imported, section => !section.earlier);
	const stopped = now.cancelled + last.notStarted.reduce((n, notebook) => n + notebook.sections, 0);

	const lines = ['---', `title: ${JSON.stringify(r.title)}`, '---', '', `# ${r.title}`, '', r.intro(text(strings.updateLogFolder)), '', `## ${r.lastImport}`, ''];
	lines.push(`- ${r.time(reportTime(last.at))}`, `- ${r.source(last.sources.map(text))}`);
	lines.push(`- ${r.totals(now.notebooks, now.sections, now.pages, now.attachments)}`);
	if (now.notConverted) lines.push(`- ${r.notConverted(now.notConverted)}`);
	if (last.links && last.links.links) lines.push(`- ${r.links(last.links.resolved, last.links.unresolved)}`);
	if (last.cancelled) lines.push(`- ${r.cancelled(stopped)}`);
	if (last.unfinished) lines.push(`- ${r.unfinished}`);
	if (last.update) lines.push(`- ${r.update(link(strings.update.title(reportTime(last.updateAt ?? last.at)), last.update))}`);

	if (report.notebooks.length) {
		lines.push('', `## ${r.notebooks}`, '', `| ${r.columns.join(' | ')} |`, '| --- | --- | ---: | ---: | ---: | ---: |');
		for (const notebook of report.notebooks) {
			const t = totals([notebook]);
			const toc = joinPath(notebook.dir, `${STRINGS[notebook.language].tocFileName}.md`);
			lines.push(`| ${link(notebook.notebook, toc)} | ${reportTime(notebook.importedAt)} | ${t.sections} | ${t.pages} | ${t.attachments} | ${t.notConverted} |`);
		}
	}

	lines.push('', `## ${r.attention}`, '');
	let notes = 0;
	if (last.cancelled && last.notStarted.length) {
		lines.push(`- ${r.notStarted(last.notStarted.map(notebook => text(notebook.notebook)))}`, '');
		notes++;
	}
	for (const notebook of report.notebooks) {
		const items: string[] = [];
		for (const section of notebook.sections) {
			const name = text([...section.groups, section.section].join(' / '));
			if (notConverted(section)) items.push(`- ${r.sectionNotConverted(name, text(reason(section, strings)))}`);
			for (const page of section.report?.pages ?? []) {
				// One `no-data` entry per missing item (other entries say more about the same item).
				const missing = page.skipped.filter(entry => entry.endsWith(': no-data')).length;
				if (!missing || !section.dir) continue;
				items.push(`- ${link(page.title || strings.untitledPage, joinPath(section.dir, page.file))}: ${r.missingItems(missing)}`);
			}
		}
		const cancelled = notebook.sections.filter(section => section.cancelled).length;
		if (cancelled) items.push(`- ${r.sectionsCancelled(cancelled)}`);
		if (!items.length) continue;
		lines.push(`### ${text(notebook.notebook)}`, '', ...items, '');
		notes += items.length;
	}
	// Sections there without their record (the report's data was deleted or changed): what is missing
	// in them cannot be told, so the page does not say that nothing is.
	if (report.notebooks.some(notebook => notebook.sections.some(section => section.dir && !section.report && !section.failed && !section.locked && !section.cancelled && !section.skipped))) {
		lines.push(r.recordsMissing, '');
		notes++;
	}
	if (!notes) lines.push(r.nothingToNote, '');
	return lines.join('\n').replace(/\n+$/, '\n');
}

/** The name (without `.json`) of the report the output root holds, the reader's language's first, and what it says. */
export async function readReport(sink: Sink, strings: Strings): Promise<{ name: string, previous: unknown } | undefined> {
	const names = [strings.reportName, ...LANGUAGES.map(language => STRINGS[language].reportName)];
	for (const name of names) {
		const old = await sink.readText(`${name}.json`);
		if (old === undefined) continue;
		try {
			return { name, previous: JSON.parse(old) };
		}
		catch {
			return { name, previous: undefined };
		}
	}
	// Only the page is left (its data deleted): still the one report of the folder, written anew.
	for (const name of names) if (await sink.readText(`${name}.md`) !== undefined) return { name, previous: undefined };
	return undefined;
}

/**
 * The notebooks the output root's report lists, as far as they can be read (none when there is no
 * report). `strings` are the reader's, as for writeReport: with reports in two languages in the
 * folder, both read the same one.
 */
/**
 * A report entry for a notebook now in `dir` (§11.5 item 66): its folder's, or else that of the same
 * OneDrive notebook recorded in another folder (renamed with OneNote, or by the user), with its
 * paths moved to `dir`.
 */
export function reportedEntry(entries: readonly ReportNotebook[], dir: string, oneDrive?: string): ReportNotebook | undefined {
	const here = entries.find(entry => key(entry.dir) === key(dir));
	if (here) return here;
	const moved = oneDrive !== undefined ? entries.find(entry => entry.oneDrive === oneDrive) : undefined;
	return moved && movedEntry(moved, dir);
}

/** A report entry with its notebook's folder (and so its sections' folders) moved to `dir`. */
export function movedEntry(entry: ReportNotebook, dir: string): ReportNotebook {
	if (key(entry.dir) === key(dir)) return entry;
	const from = `${key(entry.dir)}/`;
	const move = (path: string) => (key(path).startsWith(from) ? `${dir}/${path.slice(entry.dir.length + 1)}` : path);
	return { ...entry, dir, sections: entry.sections.map(section => (section.dir !== undefined ? { ...section, dir: move(section.dir) } : section)) };
}

export async function reportedNotebooks(sink: Sink, strings: Strings): Promise<ReportNotebook[]> {
	return earlierEntries((await readReport(sink, strings))?.previous);
}

/**
 * Reads the report the output root holds, updates it with this import, and writes both files.
 * Answers the report and its file name (without `.md` or `.json`): the reader's language's, or
 * that of a report the folder already holds in another language.
 */
export async function writeReport(sink: Sink, strings: Strings, result: ImportResult, meta: ReportMeta, folders: string[], earlier?: { name: string, previous: unknown }): Promise<{ report: ImportReport, name: string }> {
	// `earlier`: the report as it was before this run (an update keeps a copy, so finishing it after
	// a cut-off works from the same report even when the first try was cut off while writing it).
	const found = earlier ?? await readReport(sink, strings);
	const name = found?.name ?? strings.reportName;
	const report = updateReport(found?.previous, result, meta, folders);
	// Both are made before either is written, so a failure leaves the earlier pair as it was.
	const json = JSON.stringify(report, null, 2) + '\n';
	const markdown = reportMarkdown(report, strings);
	await sink.writeText(`${name}.json`, json);
	await sink.writeText(`${name}.md`, markdown);
	return { report, name };
}
