// Rewrites `onenote:` links between converted pages into relative Markdown links.
//
// A link to a page is matched by its page id (the `onenote-id` page property), wherever the
// page lives. A link to a whole section is matched by the end of its path (notebook, section
// groups, section), so it does not matter which folder the notebook sits in, whose OneDrive
// it is on, or whether it is OneDrive or SharePoint. Links that cannot be matched stay as they are.

import type { Sink } from './io.ts';
import { joinPath } from './names.ts';

const LINK = /\]\((<onenote:[^>\n]*>|onenote:[^\s)\n]*)\)/g;
const PAGE_ID = /page-id=(\{[0-9A-Fa-f-]+\})/i;
const FRONT_MATTER_ID = /^onenote-id:\s*"?(\{[0-9A-Fa-f-]+\})"?\s*$/m;
const FRONT_MATTER_MODIFIED = /^modified:\s*(\S+)\s*$/m;

/** A converted section: where it came from (notebook, groups, section) and its table of contents. */
export interface SectionRef {
	source: string[];
	toc: string;
}

export interface LinkIndex {
	/** Page id (upper case, with braces) to page path. */
	pages: Map<string, string>;
	sections: SectionRef[];
	/** Every page path, for links to a page of the same section by title. */
	files: Set<string>;
}

export interface LinkStats {
	links: number;
	resolved: number;
	unresolved: number;
	filesChanged: number;
	/** Unresolved link targets without their ids, with counts, for the report. */
	unresolvedTargets: Record<string, number>;
}

/** Percent-decoding as UTF-8, tolerant of malformed sequences (they become U+FFFD). */
export function unquote(text: string): string {
	return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, sequence => {
		const bytes = new Uint8Array(sequence.length / 3);
		for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(sequence.slice(i * 3 + 1, i * 3 + 3), 16);
		return new TextDecoder().decode(bytes);
	});
}

const nfc = (text: string) => text.normalize('NFC');

/** `a/b/c` relative to the folder `a/x`: `../b/c`. */
export function relativePath(target: string, fromFolder: string): string {
	const to = target.split('/');
	const from = fromFolder === '' ? [] : fromFolder.split('/');
	let common = 0;
	while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
	return [...new Array(from.length - common).fill('..'), ...to.slice(common)].join('/');
}

const folderOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

/** Path segments of the section a link points at (`.../Notebook/Group/Section.one`), if it names one. */
export function sectionSegments(url: string): string[] | undefined {
	const beforeHash = url.slice('onenote:'.length).split('#')[0];
	let path: string | undefined;
	if (/^https?:\/\//i.test(beforeHash)) path = beforeHash.replace(/^https?:\/\/[^/]+/i, '');
	else if (/\.one$/i.test(beforeHash)) {
		// A relative section path, resolved against the base-path parameter (the folder of the linking section).
		const base = url.match(/[&#]base-path=([^&]+)/i)?.[1];
		if (!base) return undefined;
		path = `${base.replace(/^https?:\/\/[^/]+/i, '')}/${beforeHash}`;
	}
	if (!path || !/\.one$/i.test(path)) return undefined;
	return path.split('/').filter(Boolean).map((segment, i, all) => nfc(i === all.length - 1 ? segment.replace(/\.one$/i, '') : segment));
}

function findSection(segments: string[], sections: SectionRef[]): string | undefined {
	let best: SectionRef | undefined;
	let ambiguous = false;
	for (const section of sections) {
		const n = section.source.length;
		if (n > segments.length) continue;
		const tail = segments.slice(segments.length - n);
		if (!tail.every((segment, i) => segment === section.source[i])) continue;
		if (!best || n > best.source.length) {
			best = section;
			ambiguous = false;
		}
		else if (n === best.source.length && section.toc !== best.toc) ambiguous = true;
	}
	return best && !ambiguous ? best.toc : undefined;
}

/** Where a link should point, as a path from the output root, or undefined to leave it. */
export function resolveLink(url: string, fromPath: string, index: LinkIndex): string | undefined {
	const pageId = url.match(PAGE_ID)?.[1];
	if (pageId) return index.pages.get(pageId.toUpperCase());
	const segments = sectionSegments(url);
	if (segments) return findSection(segments, index.sections);
	if (url.startsWith('onenote:#')) {
		const candidate = joinPath(folderOf(fromPath), `${url.slice('onenote:#'.length).split('&')[0]}.md`);
		return index.files.has(nfc(candidate)) ? candidate : undefined;
	}
	return undefined;
}

export function rewriteLinks(markdown: string, fromPath: string, index: LinkIndex, stats: LinkStats): string {
	return markdown.replace(LINK, (whole, raw: string) => {
		stats.links++;
		const url = unquote(raw.replace(/^<|>$/g, ''));
		const target = resolveLink(url, fromPath, index);
		if (!target) {
			stats.unresolved++;
			const key = url.replace(/&(section|page|object)-id=.*/i, '').slice(0, 110);
			stats.unresolvedTargets[key] = (stats.unresolvedTargets[key] ?? 0) + 1;
			return whole;
		}
		stats.resolved++;
		return `](<${relativePath(target, folderOf(fromPath))}>)`;
	});
}

/**
 * Builds the index from every page under the given notebook folders (their `onenote-id`), the
 * sections converted in this run, and every other section folder found there.
 */
export async function buildLinkIndex(sink: Sink, notebookFolders: string[], converted: SectionRef[], options: { tocFileNames: string[], attachmentsFolders: string[] }): Promise<LinkIndex> {
	const index: LinkIndex = { pages: new Map(), sections: [...converted], files: new Set() };
	const known = new Set(converted.map(section => section.toc));
	const tocNames = options.tocFileNames.map(name => `${name}.md`);
	for (const folder of notebookFolders) {
		const files = (await sink.listFiles(folder)).sort();
		for (const path of files) {
			if (!path.endsWith('.md') || path.split('/').some(part => options.attachmentsFolders.includes(part))) continue;
			if (tocNames.some(name => path.endsWith(`/${name}`))) {
				// A section from an earlier run: its folders stand for its source path.
				const segments = path.split('/').slice(0, -1);
				if (segments.length >= 2 && !known.has(path)) index.sections.push({ source: segments.map(nfc), toc: path });
				continue;
			}
			index.files.add(nfc(path));
			const head = (await sink.readText(path))?.slice(0, 4000) ?? '';
			const id = head.match(FRONT_MATTER_ID)?.[1];
			if (id && !index.pages.has(id.toUpperCase())) index.pages.set(id.toUpperCase(), path);
		}
	}
	return index;
}

/** Rewrites links in the given pages, keeping each page's modification time. */
export async function relinkPages(sink: Sink, pages: string[], index: LinkIndex): Promise<LinkStats> {
	const stats: LinkStats = { links: 0, resolved: 0, unresolved: 0, filesChanged: 0, unresolvedTargets: {} };
	for (const path of pages) {
		const text = await sink.readText(path);
		if (text === undefined) continue;
		const rewritten = rewriteLinks(text, path, index, stats);
		if (rewritten === text) continue;
		stats.filesChanged++;
		const modified = text.match(FRONT_MATTER_MODIFIED)?.[1];
		await sink.writeText(path, rewritten, modified && !isNaN(Date.parse(modified)) ? new Date(modified) : undefined);
	}
	return stats;
}
