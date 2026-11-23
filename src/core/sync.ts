// Plans an update: compares a new download of a notebook with what an earlier conversion wrote,
// section by section. Executing the plan (moving old versions aside, converting, fixing links,
// writing the update log) is separate.
//
// Port of the comparison part of the prototype's update.py:
// - a section in the download is matched to the old section folder that holds most of its pages
//   (by page id), so a renamed or moved section is still recognised;
// - a page counts as modified when its title or last-modified time differs.

import type { Sink } from './io.ts';
import { joinPath, safeName } from './names.ts';
import type { Strings } from './strings.ts';

export interface PageInfo {
	title: string;
	/** Last modified, as an ISO string (`2024-01-02T03:04:05.000Z`), or null when unknown. */
	modified: string | null;
}

/** A section found in the new download. */
export interface ScannedSection {
	/** `notebook/group/.../section`, for messages. */
	key: string;
	groups: string[];
	/** The section file's name without `.one`. */
	label: string;
	/** Pages by id (upper case, with braces); absent when the section could not be read. */
	pages?: Map<string, PageInfo>;
	error?: string;
}

export interface ArchivedPage extends PageInfo {
	file: string;
}

/** Section folders of one converted notebook (relative to the notebook folder) and their pages by id. */
export type ArchivedSections = Map<string, Map<string, ArchivedPage>>;

export type PlanStatus = 'new' | 'changed' | 'same' | 'gone' | 'error';

export interface PlanItem {
	key: string;
	status: PlanStatus;
	/** The section's folder in the earlier conversion. */
	old?: string;
	/** The folder the section gets now. */
	new?: string;
	added?: string[];
	removed?: string[];
	modified?: string[];
	error?: string;
}

/** The folder a scanned section is written to, relative to its notebook folder. */
export function sectionDir(section: Pick<ScannedSection, 'groups' | 'label'>, strings: Strings): string {
	return joinPath(...section.groups.map(group => safeName(group, strings.untitledPage)), safeName(section.label, strings.untitledPage, 120));
}

const nfc = (text: string) => text.normalize('NFC');

/**
 * The plan for one notebook. `partial` means the download holds only some sections, so sections
 * missing from it are not treated as deleted.
 */
export function planNotebook(notebook: string, scanned: ScannedSection[], existing: ArchivedSections, strings: Strings, partial = false): PlanItem[] {
	const existingByName = new Map([...existing.keys()].map(dir => [nfc(dir), dir]));
	// Page id to the section folder that holds it (a later folder wins, as in the prototype).
	const where = new Map<string, string>();
	for (const [dir, pages] of existing) for (const id of pages.keys()) where.set(id, dir);

	const claimed = new Set<string>();
	const items: PlanItem[] = [];
	for (const section of scanned) {
		const fresh = sectionDir(section, strings);
		const freshExisting = existingByName.get(nfc(fresh));
		if (section.error !== undefined || !section.pages) {
			items.push({ key: section.key, status: 'error', error: section.error ?? 'unreadable' });
			claimed.add(freshExisting ?? fresh);
			continue;
		}
		// Vote: the old folder that holds most of this section's pages; the first one seen wins a tie.
		const votes = new Map<string, number>();
		for (const id of section.pages.keys()) {
			const dir = where.get(id);
			if (dir !== undefined) votes.set(dir, (votes.get(dir) ?? 0) + 1);
		}
		let old: string | undefined;
		let best = 0;
		for (const [dir, count] of votes) {
			if (count > best) {
				old = dir;
				best = count;
			}
		}
		old ??= freshExisting;
		if (old === undefined) {
			items.push({ key: section.key, status: 'new', new: fresh, added: [...section.pages.values()].map(page => page.title) });
			continue;
		}
		claimed.add(old);
		const before = existing.get(old)!;
		const added = [...section.pages].filter(([id]) => !before.has(id)).map(([, page]) => page.title);
		const removed = [...before].filter(([id]) => !section.pages!.has(id)).map(([, page]) => page.title);
		const modified = [...section.pages]
			.filter(([id, page]) => before.has(id) && (before.get(id)!.title !== page.title || before.get(id)!.modified !== page.modified))
			.map(([, page]) => page.title);
		const changed = added.length > 0 || removed.length > 0 || modified.length > 0 || nfc(old) !== nfc(fresh);
		items.push({ key: section.key, status: changed ? 'changed' : 'same', old, new: fresh, added, removed, modified });
	}
	if (!partial) {
		for (const [dir, pages] of existing) {
			if (!claimed.has(dir)) items.push({ key: `${notebook}/${dir}`, status: 'gone', old: dir, removed: [...pages.values()].map(page => page.title) });
		}
	}
	return items;
}

/** Page info from the parser's JSON for one section. */
export function scannedPages(json: { pages: { id: string, title?: string | null, updated?: number | null }[] }): Map<string, PageInfo> {
	const pages = new Map<string, PageInfo>();
	for (const page of json.pages) {
		pages.set(page.id.toUpperCase(), {
			title: page.title || '',
			modified: page.updated ? new Date(page.updated * 1000).toISOString() : null,
		});
	}
	return pages;
}

/** Reads the simple `key: value` front matter the converter writes (string values are JSON). */
export function frontMatter(text: string): Record<string, string> {
	if (!text.startsWith('---')) return {};
	const end = text.indexOf('\n---', 3);
	const block = end < 0 ? text : text.slice(0, end);
	const out: Record<string, string> = {};
	for (const line of block.split('\n').slice(1)) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (!match) continue;
		let value = match[2];
		if (value.startsWith('"')) {
			try {
				value = JSON.parse(value);
			}
			catch {
				// Keep it as written.
			}
		}
		out[match[1]] = value;
	}
	return out;
}

/** The section folders of a converted notebook and their pages, read back from the output. */
export async function readArchive(sink: Sink, notebookFolder: string, strings: Strings): Promise<ArchivedSections> {
	const sections: ArchivedSections = new Map();
	const tocName = `${strings.tocFileName}.md`;
	const files = (await sink.listFiles(notebookFolder)).filter(path => !path.split('/').includes(strings.attachmentsFolder));
	const folders = new Set<string>();
	for (const path of files) {
		const folder = path.slice(0, path.lastIndexOf('/'));
		if (path.endsWith(`/${tocName}`) && folder !== notebookFolder) folders.add(folder);
	}
	for (const folder of [...folders].sort()) {
		const pages = new Map<string, ArchivedPage>();
		for (const path of files) {
			if (path.slice(0, path.lastIndexOf('/')) !== folder || !path.endsWith('.md') || path.endsWith(`/${tocName}`)) continue;
			const head = (await sink.readText(path))?.slice(0, 6000) ?? '';
			const fm = frontMatter(head);
			if (!fm['onenote-id']) continue;
			pages.set(fm['onenote-id'].toUpperCase(), { title: fm.title ?? '', modified: fm.modified ?? null, file: path.slice(folder.length + 1) });
		}
		sections.set(folder.slice(notebookFolder.length + 1), pages);
	}
	return sections;
}
