// Writes one section (pages, attachments, table of contents) and builds a notebook's table of contents.

import type { SectionSource, Sink } from './io.ts';
import type { AssetData, Section } from './model.ts';
import { escapeInline, escapeLineStart } from './markdown.ts';
import { composedText, joinPath, safeName } from './names.ts';
import { renderPage } from './render/page.ts';
import type { AttachmentHint, ResolvedAttachment } from './render/page.ts';
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
}

export interface PageReport {
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
const pad = (n: number, width: number) => String(n).padStart(width, '0');

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
	await sink.ensureFolder(joinPath(dir, attachmentsFolder));

	// Page file names: unique within the section (case-insensitive), never the table of contents.
	const pages = section.pages.filter(page => !page.isDeleted);
	const used = new Set<string>();
	const fileOf = new Map<string, string>();
	const titleToFile = new Map<string, string>();
	for (const page of pages) {
		const base = safeName(page.title || strings.untitledPage, strings.untitledPage) + (page.isConflictPage ? strings.conflictPageSuffix : '');
		let name = base, n = 2;
		while (used.has(name.toLowerCase()) || name === strings.tocFileName) name = `${base} (${n++})`;
		used.add(name.toLowerCase());
		fileOf.set(page.id, name);
		if (!titleToFile.has(page.title)) titleToFile.set(page.title, name);
	}

	const byKey = new Map<string, string>();
	const usedAttachments = new Set<string>();
	let attachmentCount = 0, reused = 0;
	const label = composedText(options.label);
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
			while (usedAttachments.has(candidate.toLowerCase())) candidate = file.replace(/(\.[^.]+)?$/, m => ` (${k++})${m}`);
			usedAttachments.add(candidate.toLowerCase());

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
		await sink.writeText(path, `${frontMatter}\n\n${rendered.markdown}\n`);
		if (page.lastModifiedUtc && !isNaN(+page.lastModifiedUtc)) await sink.setModifiedTime(path, page.lastModifiedUtc);
		report.pages.push({ title: page.title, file: `${noteName}.md`, level: page.level, chars: rendered.markdown.length, assets: rendered.attachments.length, skipped });
	}

	const toc = [
		'---', `title: ${yaml(strings.tocTitle(label))}`, '---', '', `# ${label}`, '',
		...pages.map(page => `${'\t'.repeat(page.level)}- [${(page.title || strings.untitledPage).replace(/[[\]]/g, '\\$&')}](<${fileOf.get(page.id)}.md>)`),
	].join('\n');
	await sink.writeText(joinPath(dir, `${strings.tocFileName}.md`), toc + '\n');

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
}

/** Folder of a section inside its notebook folder. */
export function sectionFolder(groups: string[], section: string, strings: Strings): string {
	return joinPath(...groups.map(group => safeName(group, strings.untitledPage)), safeName(section, strings.untitledPage, 120));
}

/** Folder of a notebook inside the output root. */
export function notebookFolder(name: string, strings: Strings): string {
	return safeName(name, strings.untitledPage, 120);
}

/** The table of contents of a section that could not be converted: the reason, in place of its pages. */
export function failedSectionToc(label: string, reason: string, strings: Strings): string {
	const name = composedText(label);
	const note = escapeLineStart(escapeInline(reason.replace(/\s+/g, ' ').trim()));
	return ['---', `title: ${yaml(strings.tocTitle(name))}`, '---', '', `# ${name}`, '', `> ${note}`, ''].join('\n');
}

export function notebookToc(notebookName: string, entries: NotebookTocEntry[], strings: Strings): string {
	const name = composedText(notebookName);
	const lines = ['---', `title: ${yaml(strings.tocTitle(name))}`, '---', '', `# ${name}`, '', strings.sectionOrderNote, ''];
	// Sections come group by group; each group's name is a line above its sections.
	let open: string[] = [];
	for (const entry of entries) {
		const groups = entry.groups.map(composedText);
		let shared = 0;
		while (shared < groups.length && shared < open.length && groups[shared] === open[shared]) shared++;
		for (let level = shared; level < groups.length; level++) lines.push(`${'\t'.repeat(level)}- ${groups[level]}`);
		open = groups;
		const suffix = entry.locked ? strings.passwordProtectedSuffix : entry.failed ? strings.conversionFailedSuffix : '';
		lines.push(`${'\t'.repeat(groups.length)}- [${composedText(entry.section)}](<${sectionFolder(entry.groups, entry.section, strings)}/${strings.tocFileName}.md>)${suffix}`);
	}
	return lines.join('\n') + '\n';
}
