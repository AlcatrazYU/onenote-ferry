// Writes one section (pages, attachments, table of contents) and builds a notebook's table of contents.

import type { SectionSource, Sink } from './io.ts';
import type { AssetData, Section } from './model.ts';
import { escapeInline, escapeLineStart } from './markdown.ts';
import { composedText, joinPath, numberedName, safeName } from './names.ts';
import { renderPage } from './render/page.ts';
import type { AttachmentHint, ResolvedAttachment } from './render/page.ts';
import { LANGUAGES, STRINGS } from './strings.ts';
import type { Strings } from './strings.ts';

export interface SectionWriteOptions {
	/** The section's folder, relative to the output root. */
	dir: string;
	/** The section's name as shown in its table of contents and page properties. */
	label: string;
	strings: Strings;
	boxMarkers: boolean;
	keepFontColor: boolean;
	keepHighlighterInk?: boolean;
	/** Write images' alternative text in a collapsed callout below them (see PageRenderOptions). */
	imageAltText?: boolean;
	isCancelled?: () => boolean;
	/**
	 * File names (without `.md`) to keep, by page id in upper case: an update gives each page the
	 * file it has in the vault (§11.5 item 49). Other pages get names that none of these take.
	 */
	names?: ReadonlyMap<string, string>;
	/** File names (composed, lower case, with `.md`) no page may take: files in the folder that are not pages being written. */
	taken?: ReadonlySet<string>;
}

export interface PageReport {
	/** The page id (as the parser gives it), to tell pages apart in a later update (absent in reports before M3). */
	id?: string;
	title: string;
	file: string;
	level: number;
	chars: number;
	assets: number;
	skipped: string[];
}

export interface SectionReport {
	section: string;
	dir: string;
	pages: PageReport[];
	pageCount: number;
	attachments: number;
	reusedAttachments: number;
}

const yaml = (value: string) => JSON.stringify(value);
/**
 * Names as the disk and Obsidian tell them apart: Obsidian composes every path it writes (full NFC,
 * which also turns CJK compatibility ideographs into their unified forms), and a disk may ignore case.
 */
const fold = (name: string) => name.normalize('NFC').toLowerCase();
/**
 * A page never takes a table of contents' name, in any marker language and any case: on a disk
 * that ignores case the table of contents would overwrite it, and links between notebooks of
 * different languages would take it for one.
 */
const TOC_NAMES = new Set(LANGUAGES.map(language => fold(STRINGS[language].tocFileName)));
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * The property each table of contents of ours carries (§11.5 item 47): it marks the folder as ours,
 * and says how far the import of it got. A section's is written as `importing` before anything else
 * of it and becomes `complete` once all its pages are written (`failed` when it could not be
 * converted); a notebook's is `importing` until all its chosen sections are done. Only a table of
 * contents with it is ours: a folder without one is never written into.
 */
export const IMPORT_PROPERTY = 'onenote-import';
/**
 * `syncing`: an update is replacing some of the section's files (§11.5 item 49). An import leaves
 * such a section alone, as one that is there; the update finishes it or puts it back as it was.
 */
export type ImportStatus = 'importing' | 'complete' | 'failed' | 'syncing';

/** The import status a table of contents records, or undefined when it is not one of ours. */
export function importStatusOf(text: string | undefined): ImportStatus | undefined {
	if (!text?.startsWith('---\n')) return undefined;
	const end = text.indexOf('\n---', 3);
	if (end < 0) return undefined;
	return text.slice(4, end).match(/^onenote-import: (importing|complete|failed|syncing)$/m)?.[1] as ImportStatus | undefined;
}

/** The name heading a table of contents (its first `# ` line), or undefined. */
export function tocHeading(text: string | undefined): string | undefined {
	return text?.match(/^# (.+)$/m)?.[1];
}

export const tocHead = (name: string, strings: Strings, status: ImportStatus) =>
	['---', `title: ${yaml(strings.tocTitle(name))}`, `${IMPORT_PROPERTY}: ${status}`, '---', '', `# ${name}`, ''];

/** The extension a suggested attachment name ends with, as the original converter read it. */
function extensionOf(name: string): string {
	return (name.match(/\.([^.\s\\/]+)$/)?.[1] ?? 'bin').toLowerCase();
}

/** A key that is equal for equal attachment bytes, so each is written once per section. */
function keyOf(data: AssetData, hint: AttachmentHint): string {
	if (data.kind === 'stored') return data.key;
	const extension = hint.role === 'file' ? extensionOf(hint.fileName) : 'svg';
	return `inline:${extension}:${new TextDecoder().decode(data.bytes)}`;
}

export async function writeSection(section: Section, source: SectionSource, sink: Sink, options: SectionWriteOptions): Promise<SectionReport> {
	const { strings, dir } = options;
	const attachmentsFolder = strings.attachmentsFolder;
	const label = composedText(options.label);
	const tocPath = joinPath(dir, `${strings.tocFileName}.md`);
	// First of all, the table of contents saying the section is being written: cut off half way (the
	// plugin turned off, Obsidian quit), the folder is still known for ours and may be written again.
	await sink.writeText(tocPath, tocHead(label, strings, 'importing').join('\n'));
	await sink.ensureFolder(joinPath(dir, attachmentsFolder));

	// Page file names: unique within the section (as Obsidian and the disk compare names), never the table of contents.
	const pages = section.pages.filter(page => !page.isDeleted);
	const used = new Set<string>();
	const fileOf = new Map<string, string>();
	// Names kept from the vault first, so no other page takes one.
	for (const page of pages) {
		const kept = options.names?.get(page.id.toUpperCase());
		if (kept === undefined || TOC_NAMES.has(fold(kept)) || used.has(fold(kept))) continue;
		used.add(fold(kept));
		fileOf.set(page.id, kept);
	}
	for (const page of pages) {
		if (fileOf.has(page.id)) continue;
		const base = safeName(page.title || strings.untitledPage, strings.untitledPage) + (page.isConflictPage ? strings.conflictPageSuffix : '');
		let name = base, n = 2;
		while (used.has(fold(name)) || TOC_NAMES.has(fold(name)) || options.taken?.has(fold(`${name}.md`))) name = `${base} (${n++})`;
		used.add(fold(name));
		fileOf.set(page.id, name);
	}
	const titleToFile = new Map<string, string>();
	for (const page of pages) if (!titleToFile.has(page.title)) titleToFile.set(page.title, fileOf.get(page.id)!);

	const byKey = new Map<string, string>();
	const usedAttachments = new Set<string>();
	let attachmentCount = 0, reused = 0;
	const report: SectionReport = { section: label, dir, pages: [], pageCount: 0, attachments: 0, reusedAttachments: 0 };

	for (const [order, page] of pages.entries()) {
		const noteName = fileOf.get(page.id)!;
		const short = [...noteName].slice(0, 30).join('').trim();
		let imageNo = 0, inkNo = 0;
		const skipped: string[] = [];

		const saveAttachment = async (data: AssetData, hint: AttachmentHint): Promise<ResolvedAttachment | null> => {
			const key = keyOf(data, hint);
			const existing = byKey.get(key);
			if (existing) {
				reused++;
				return { path: `${attachmentsFolder}/${existing}`, name: existing };
			}
			let file: string;
			switch (hint.role) {
				case 'ink': file = `${short} - ${strings.inkWord}${pad(++inkNo, 2)}.svg`; break;
				case 'image': file = `${short} - ${strings.imageWord}${pad(++imageNo, 3)}.${(hint.extension ?? 'bin').toLowerCase()}`; break;
				case 'file': file = safeName(hint.fileName, strings.untitledPage, 100); break;
			}
			let candidate = file, k = 2;
			while (usedAttachments.has(fold(candidate))) candidate = file.replace(/(\.[^.]+)?$/, m => ` (${k++})${m}`);
			usedAttachments.add(fold(candidate));

			let bytes: Uint8Array;
			if (data.kind === 'inline') bytes = data.bytes;
			else {
				try {
					bytes = await source.readAsset(data.key);
				}
				catch {
					skipped.push(`${hint.role === 'file' ? hint.fileName : hint.role}: missing raw asset`);
					return null;
				}
			}
			await sink.writeBinary(joinPath(dir, attachmentsFolder, candidate), bytes);
			byKey.set(key, candidate);
			attachmentCount++;
			return { path: `${attachmentsFolder}/${candidate}`, name: candidate };
		};

		const rendered = await renderPage(page, {
			strings,
			boxMarkers: options.boxMarkers,
			keepFontColor: options.keepFontColor,
			keepHighlighterInk: options.keepHighlighterInk,
			imageAltText: options.imageAltText,
			isCancelled: options.isCancelled,
			resolveInternalLink: title => titleToFile.has(composedText(title)) ? `${titleToFile.get(composedText(title))}.md` : undefined,
			onSkipped: (description, reason) => skipped.push(`${description}: ${reason}`),
			saveAttachment,
			readAsset: async data => {
				if (data.kind === 'inline') return data.bytes;
				try {
					return await source.readAsset(data.key);
				}
				catch {
					return undefined;
				}
			},
		});

		const frontMatter = [
			'---',
			`title: ${yaml(page.title)}`,
			`onenote-section: ${yaml(label)}`,
			`onenote-order: ${order + 1}`,
			`onenote-level: ${page.level}`,
			page.createdUtc ? `created: ${page.createdUtc.toISOString()}` : '',
			page.lastModifiedUtc ? `modified: ${page.lastModifiedUtc.toISOString()}` : '',
			`onenote-id: ${yaml(page.id)}`,
			page.isConflictPage ? 'onenote-conflict: true' : '',
			'---',
		].filter(Boolean).join('\n');
		const path = joinPath(dir, `${noteName}.md`);
		await sink.writeText(path, `${frontMatter}\n\n${rendered.markdown}\n`, page.lastModifiedUtc && !isNaN(+page.lastModifiedUtc) ? page.lastModifiedUtc : undefined);
		report.pages.push({ id: page.id, title: page.title, file: `${noteName}.md`, level: page.level, chars: rendered.markdown.length, assets: rendered.attachments.length, skipped });
	}

	// Last, the table of contents with every page: the section is complete.
	const toc = [
		...tocHead(label, strings, 'complete'),
		...pages.map(page => `${'\t'.repeat(page.level)}- [${(page.title || strings.untitledPage).replace(/[[\]]/g, '\\$&')}](<${fileOf.get(page.id)}.md>)`),
	].join('\n');
	await sink.writeText(tocPath, toc + '\n');

	report.pageCount = pages.length;
	report.attachments = attachmentCount;
	report.reusedAttachments = reused;
	return report;
}

export interface NotebookTocEntry {
	/** Section groups above the section, outermost first. */
	groups: string[];
	/** The section's name as listed (its file name without `.one`). */
	section: string;
	failed?: boolean;
	/** The section is password protected (and so not converted). */
	locked?: boolean;
	/** The import was cancelled before this section: listed, not converted, no link. */
	cancelled?: boolean;
	/** Not chosen for import: listed, no link. */
	skipped?: boolean;
	/** Its folder inside the notebook's folder, when known (see sectionFolders). */
	folder?: string;
	/** Listed without a link: it has no folder (it could not be read, and an update wrote nothing of it). */
	unlinked?: true;
}

/** A section's place in its notebook (section groups and name), for matching it across imports. */
export const sectionKey = (groups: string[], section: string) => [...groups, section].map(part => part.normalize('NFC')).join('/');

/** Folder of a section inside its notebook folder, before telling it apart from the others (see sectionFolders). */
export function sectionFolder(groups: string[], section: string, strings: Strings): string {
	return joinPath(...groups.map(group => safeName(group, strings.untitledPage)), safeName(section, strings.untitledPage, 120));
}

/**
 * The folders of a notebook's sections, by sectionKey. Two sections whose names give one folder (they
 * differ only in what a file name cannot hold, in case, or after 120 characters), or a section that
 * would take a section group's folder, would write into one: the later one gets " (2)" and so on,
 * as notebooks and pages of one name do. Section groups of one folder name share it.
 */
export function sectionFolders(sections: readonly { groups: string[], label: string }[], strings: Strings): Map<string, string> {
	const groupPath = (groups: string[]) => joinPath(...groups.map(group => safeName(group, strings.untitledPage)));
	// Names taken at each place (by the folder they are in): the groups' first, so no section takes one.
	const taken = new Map<string, Set<string>>();
	const take = (parent: string, name: string) => {
		const names = taken.get(fold(parent)) ?? new Set<string>();
		taken.set(fold(parent), names);
		const free = !names.has(fold(name));
		names.add(fold(name));
		return free;
	};
	for (const section of sections) {
		for (let i = 0; i < section.groups.length; i++) take(groupPath(section.groups.slice(0, i)), safeName(section.groups[i]!, strings.untitledPage));
	}
	const folders = new Map<string, string>();
	for (const section of sections) {
		const parent = groupPath(section.groups);
		let name = safeName(section.label, strings.untitledPage, 120), n = 2;
		while (!take(parent, name)) name = safeName(numberedName(section.label, n++), strings.untitledPage, 120);
		folders.set(sectionKey(section.groups, section.label), joinPath(parent, name));
	}
	return folders;
}

/** Folder of a notebook inside the output root. */
export function notebookFolder(name: string, strings: Strings): string {
	return safeName(name, strings.untitledPage, 120);
}

/** The table of contents of a section that could not be converted: the reason, in place of its pages. */
export function failedSectionToc(label: string, reason: string, strings: Strings): string {
	const name = composedText(label);
	const note = escapeLineStart(escapeInline(reason.replace(/\s+/g, ' ').trim()));
	return [...tocHead(name, strings, 'failed'), `> ${note}`, ''].join('\n');
}

/** A notebook's table of contents: `importing` while its sections are written, `complete` once they are. */
export function notebookToc(notebookName: string, entries: NotebookTocEntry[], strings: Strings, status: 'importing' | 'complete' = 'complete'): string {
	const name = composedText(notebookName);
	const lines = [...tocHead(name, strings, status), strings.sectionOrderNote, ''];
	// Sections come group by group; each group's name is a line above its sections. Names are text:
	// whatever Markdown or Obsidian would read as structure in them is escaped.
	let open: string[] = [];
	for (const entry of entries) {
		const groups = entry.groups.map(composedText);
		let shared = 0;
		while (shared < groups.length && shared < open.length && groups[shared] === open[shared]) shared++;
		for (let level = shared; level < groups.length; level++) lines.push(`${'\t'.repeat(level)}- ${escapeLineStart(escapeInline(groups[level]!))}`);
		open = groups;
		if (entry.cancelled || entry.skipped) {
			lines.push(`${'\t'.repeat(groups.length)}- ${escapeLineStart(escapeInline(composedText(entry.section)))}${entry.skipped ? strings.notImportedSuffix : strings.cancelledSuffix}`);
			continue;
		}
		const suffix = entry.locked ? strings.passwordProtectedSuffix : entry.failed ? strings.conversionFailedSuffix : '';
		if (entry.unlinked) {
			lines.push(`${'\t'.repeat(groups.length)}- ${escapeLineStart(escapeInline(composedText(entry.section)))}${suffix}`);
			continue;
		}
		const folder = entry.folder ?? sectionFolder(entry.groups, entry.section, strings);
		lines.push(`${'\t'.repeat(groups.length)}- [${escapeInline(composedText(entry.section))}](<${folder}/${strings.tocFileName}.md>)${suffix}`);
	}
	return lines.join('\n') + '\n';
}
