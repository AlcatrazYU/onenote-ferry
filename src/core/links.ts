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
	/**
	 * The source under the notebook's OneNote name, for a notebook imported under another name
	 * (a copy, or "Name (2)"): links name the notebook as OneNote does.
	 */
	alias?: true;
}

export interface LinkIndex {
	/**
	 * Page id (upper case, with braces) to the paths of pages with that id, in folder order. Two
	 * folders hold the same ids when one notebook was imported twice (a copy).
	 */
	pages: Map<string, string[]>;
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
/** The notebook folder a path is in (its first part under the output root). */
const notebookOf = (path: string) => nfc(path.split('/')[0] ?? '');

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

/**
 * The section whose source ends the link's path the longest way. When several do, the one in the
 * linking page's own notebook wins (a copy links into itself), then the only one that is not an
 * alias (a link from elsewhere keeps going where it went before the copy existed).
 */
function findSection(segments: string[], sections: SectionRef[], fromPath: string): string | undefined {
	let best: SectionRef[] = [];
	for (const section of sections) {
		const n = section.source.length;
		if (n > segments.length) continue;
		const tail = segments.slice(segments.length - n);
		if (!tail.every((segment, i) => segment === section.source[i])) continue;
		if (!best.length || n > best[0].source.length) best = [section];
		else if (n === best[0].source.length) best.push(section);
	}
	const only = (candidates: SectionRef[]) => {
		const tocs = new Set(candidates.map(section => nfc(section.toc)));
		return tocs.size === 1 ? candidates[0].toc : undefined;
	};
	return only(best) ?? only(best.filter(section => notebookOf(section.toc) === notebookOf(fromPath))) ?? only(best.filter(section => !section.alias));
}

/** Where a link should point, as a path from the output root, or undefined to leave it. */
export function resolveLink(url: string, fromPath: string, index: LinkIndex): string | undefined {
	const pageId = url.match(PAGE_ID)?.[1];
	if (pageId) {
		const paths = index.pages.get(pageId.toUpperCase());
		return paths?.find(path => notebookOf(path) === notebookOf(fromPath)) ?? paths?.[0];
	}
	const segments = sectionSegments(url);
	if (segments) return findSection(segments, index.sections, fromPath);
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
	// Obsidian composes every path it writes (full NFC), so paths are compared composed.
	const known = new Set(converted.map(section => nfc(section.toc)));
	const tocNames = options.tocFileNames.map(name => `${name}.md`);
	for (const folder of notebookFolders) {
		const files = (await sink.listFiles(folder)).sort();
		for (const path of files) {
			if (!path.endsWith('.md') || path.split('/').some(part => options.attachmentsFolders.includes(part))) continue;
			if (tocNames.some(name => path.endsWith(`/${name}`))) {
				// A section from an earlier run: its folders stand for its source path.
				const segments = path.split('/').slice(0, -1);
				if (segments.length >= 2 && !known.has(nfc(path))) index.sections.push({ source: segments.map(nfc), toc: path });
				continue;
			}
			index.files.add(nfc(path));
			const head = (await sink.readText(path))?.slice(0, 4000) ?? '';
			const id = head.match(FRONT_MATTER_ID)?.[1];
			if (!id) continue;
			const paths = index.pages.get(id.toUpperCase());
			if (paths) paths.push(path);
			else index.pages.set(id.toUpperCase(), [path]);
		}
	}
	return index;
}

/** The notes in a notebook folder that links can point to: what buildLinkIndex reads there. */
export async function notebookNotes(sink: Sink, folder: string, options: { tocFileNames: string[], attachmentsFolders: string[] }): Promise<string[]> {
	const tocNames = options.tocFileNames.map(name => `${name}.md`);
	return (await sink.listFiles(folder)).sort().filter(path => path.endsWith('.md')
		&& !path.split('/').some(part => options.attachmentsFolders.includes(part))
		&& !tocNames.some(name => path.endsWith(`/${name}`)));
}

/** Writes a page with its links rewritten, keeping its modification time (that of the OneNote page). */
async function writeRelinked(sink: Sink, path: string, text: string, rewritten: string): Promise<void> {
	const modified = text.match(FRONT_MATTER_MODIFIED)?.[1];
	await sink.writeText(path, rewritten, modified && !isNaN(Date.parse(modified)) ? new Date(modified) : undefined);
}

/** Rewrites links in the given pages, keeping each page's modification time. Pages changed are added to `changed`. */
export async function relinkPages(sink: Sink, pages: string[], index: LinkIndex, changed?: Set<string>): Promise<LinkStats> {
	const stats: LinkStats = { links: 0, resolved: 0, unresolved: 0, filesChanged: 0, unresolvedTargets: {} };
	for (const path of pages) {
		const text = await sink.readText(path);
		if (text === undefined) continue;
		const rewritten = rewriteLinks(text, path, index, stats);
		if (rewritten === text) continue;
		stats.filesChanged++;
		changed?.add(path);
		await writeRelinked(sink, path, text, rewritten);
	}
	return stats;
}

/**
 * Links between the pages of one notebook, rewritten while the notebook is imported, section by
 * section (§11.5 item 47): an import cut off half way (Obsidian quit, a crash) leaves them done.
 * Only links to a page of the same notebook are rewritten here, which is where the pass over all
 * pages at the end of the import would send them too (a page of the linking page's own notebook
 * always wins); links into other notebooks and to whole sections wait for that pass, as what they
 * point to may still change.
 */
export class NotebookLinks {
	private readonly sink: Sink;
	private readonly index: LinkIndex = { pages: new Map(), sections: [], files: new Set() };
	/** Pages written by this import with links that may yet point into the notebook. */
	private readonly waiting = new Set<string>();
	/** Links rewritten so far, and the pages changed. */
	resolved = 0;
	readonly changed = new Set<string>();

	constructor(sink: Sink) {
		this.sink = sink;
	}

	/** Pages links can point to: this notebook's, written now or by an earlier import. */
	async add(paths: string[]): Promise<void> {
		for (const path of paths) {
			this.index.files.add(nfc(path));
			const id = ((await this.sink.readText(path))?.slice(0, 4000) ?? '').match(FRONT_MATTER_ID)?.[1];
			if (!id) continue;
			const known = this.index.pages.get(id.toUpperCase());
			if (known) known.push(path);
			else this.index.pages.set(id.toUpperCase(), [path]);
		}
	}

	/** Rewrites what can be rewritten now in these pages (just written) and in those still waiting. */
	async relink(written: string[]): Promise<void> {
		for (const path of written) this.waiting.add(path);
		for (const path of [...this.waiting]) {
			const text = await this.sink.readText(path);
			if (text === undefined) {
				this.waiting.delete(path);
				continue;
			}
			let open = false;
			const rewritten = text.replace(LINK, (whole, raw: string) => {
				const url = unquote(raw.replace(/^<|>$/g, ''));
				const pageId = url.match(PAGE_ID)?.[1];
				const target = pageId || url.startsWith('onenote:#') ? resolveLink(url, path, this.index) : undefined;
				if (!target) {
					// A page of this notebook not written yet may still come.
					if (pageId) open = true;
					return whole;
				}
				this.resolved++;
				return `](<${relativePath(target, folderOf(path))}>)`;
			});
			if (!open) this.waiting.delete(path);
			if (rewritten === text) continue;
			this.changed.add(path);
			await writeRelinked(this.sink, path, text, rewritten);
		}
	}
}
