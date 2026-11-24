// The update plan (src/core/sync.ts): a new download of a notebook against what an earlier import
// wrote into the vault. Notebooks, sections and pages are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontMatter, planNotebook, readArchive, scannedPages } from '../src/core/sync.ts';
import type { Archive, PlanItem, ScannedPage, ScannedSection } from '../src/core/sync.ts';
import { zhHans } from '../src/core/strings.ts';
import { memorySink } from './helpers.ts';
import type { MemorySink } from './helpers.ts';

const T1 = '2024-01-01T00:00:00.000Z';
const T2 = '2024-02-01T00:00:00.000Z';
const T0 = '2023-12-01T00:00:00.000Z';

/** A page in the new download. */
const p = (id: string, title: string, modified: string | null = T1, level = 1): ScannedPage => ({ id, title, modified, level });
const scan = (label: string, pages: ScannedPage[] | undefined, groups: string[] = [], error?: string): ScannedSection =>
	({ key: ['Tides', ...groups, label].join('/'), groups, label, ...(pages ? { pages } : {}), ...(error ? { error } : {}) });

/** A page an earlier import wrote: [id, title, modified, order, level]. */
type Written = [string, string, string?, number?, number?];
const toc = (status: string, name: string, files: string[] = []) =>
	`---\ntitle: "${name} 目录"\nonenote-import: ${status}\n---\n\n# ${name}\n\n${files.map(file => `- [${file.replace(/\.md$/, '')}](<${file}>)`).join('\n')}\n`;
const pageText = (id: string, title: string, modified = T1, order = 1, level = 1) =>
	`---\ntitle: ${JSON.stringify(title)}\nonenote-section: "S"\nonenote-order: ${order}\nonenote-level: ${level}\nmodified: ${modified}\nonenote-id: "${id}"\n---\n\ntext\n`;

/** A vault holding the notebook "Tides" as an import wrote it: section folders and their pages (mtimes as written). */
async function vault(sections: Record<string, Written[] | { status: string, name?: string, pages?: Written[] }>, extra: Record<string, string> = {}): Promise<MemorySink> {
	const sink = memorySink();
	await sink.writeText('Tides/_目录.md', toc('complete', 'Tides'));
	for (const [folder, value] of Object.entries(sections)) {
		const { status, name, pages } = Array.isArray(value) ? { status: 'complete', name: undefined, pages: value } : value;
		const files: string[] = [];
		for (const [i, [id, title, modified = T1, order = i + 1, level = 1]] of (pages ?? []).entries()) {
			const file = `${title}.md`;
			files.push(file);
			await sink.writeText(`Tides/${folder}/${file}`, pageText(id, title, modified, order, level), new Date(modified));
		}
		await sink.writeText(`Tides/${folder}/_目录.md`, toc(status, name ?? folder.split('/').pop()!, files));
	}
	for (const [path, text] of Object.entries(extra)) await sink.writeText(path, text, new Date(T2));
	return sink;
}

async function plan(scanned: ScannedSection[], sink: MemorySink, options: Parameters<typeof planNotebook>[4] = {}) {
	return planNotebook('Tides', scanned, await readArchive(sink, 'Tides'), zhHans, options);
}
const states = (items: PlanItem[]) => items.map(item => [item.key, item.status, item.old ?? null, item.new ?? null]);

test('an unchanged section is the same, in its folder', async () => {
	const { items, identity } = await plan([scan('Spring', [p('{A}', 'One')])], await vault({ Spring: [['{A}', 'One']] }));
	assert.equal(identity, 'same');
	assert.deepEqual(states(items), [['Tides/Spring', 'same', 'Spring', 'Spring']]);
});

test('added, removed, modified and retitled pages make a section changed', async () => {
	const { items } = await plan([scan('Spring', [p('{A}', 'One', T2), p('{C}', 'Three'), p('{D}', 'Renamed')])],
		await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two'], ['{D}', 'Four']] }));
	const [item] = items as [PlanItem];
	assert.equal(item.status, 'changed');
	assert.deepEqual(item.added.map(page => page.title), ['Three']);
	assert.deepEqual(item.removed.map(page => page.title), ['Two']);
	assert.deepEqual(item.modified.map(page => [page.title, page.from ?? null]), [['One', null], ['Renamed', 'Four']]);
});

test('only the order or the level of pages changed: the section is changed, those pages are listed apart', async () => {
	const { items } = await plan([scan('Spring', [p('{B}', 'Two'), p('{A}', 'One', T1, 2)])], await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two']] }));
	assert.equal(items[0]!.status, 'changed');
	assert.deepEqual(items[0]!.reordered.map(page => page.title).sort(), ['One', 'Two']);
	assert.deepEqual([items[0]!.added, items[0]!.removed, items[0]!.modified], [[], [], []]);
});

test('a section renamed or moved into a group in OneNote: matched by its pages, moving to its new folder', async () => {
	const sink = await vault({ 'Old name': [['{A}', 'One'], ['{B}', 'Two']] });
	assert.deepEqual(states((await plan([scan('New name', [p('{A}', 'One'), p('{B}', 'Two')])], sink)).items), [['Tides/New name', 'changed', 'Old name', 'New name']]);
	assert.deepEqual(states((await plan([scan('Old name', [p('{A}', 'One'), p('{B}', 'Two')], ['Group'])], sink)).items), [['Tides/Group/Old name', 'changed', 'Old name', 'Group/Old name']]);
});

test('one old folder goes to one section: renamed, then a new section of the old name', async () => {
	// A was renamed B, then a new A was made: B is the old A moved, the new A is new.
	const { items } = await plan([scan('A', [p('{N}', 'Fresh')]), scan('B', [p('{X}', 'One'), p('{Y}', 'Two')])], await vault({ A: [['{X}', 'One'], ['{Y}', 'Two']] }));
	assert.deepEqual(states(items), [['Tides/A', 'new', null, 'A'], ['Tides/B', 'changed', 'A', 'B']]);
});

test('one old folder goes to one section: a section split in two, and two sections swapping names', async () => {
	const split = await plan([scan('S', [p('{A}', 'a'), p('{B}', 'b')]), scan('T', [p('{C}', 'c')])], await vault({ S: [['{A}', 'a'], ['{B}', 'b'], ['{C}', 'c']] }));
	assert.deepEqual(states(split.items), [['Tides/S', 'changed', 'S', 'S'], ['Tides/T', 'new', null, 'T']]);
	const swapped = await plan([scan('X', [p('{B}', 'b')]), scan('Y', [p('{A}', 'a')])], await vault({ X: [['{A}', 'a']], Y: [['{B}', 'b']] }));
	assert.deepEqual(states(swapped.items), [['Tides/X', 'changed', 'Y', 'X'], ['Tides/Y', 'changed', 'X', 'Y']]);
});

test('folders are named as the import names them: two names that give one folder stay the same', async () => {
	// The import wrote "Plan" and "plan (2)" (plan first, in the download's order).
	const sink = await vault({ 'plan': [['{A}', 'a']], 'Plan (2)': { status: 'complete', name: 'Plan', pages: [['{B}', 'b']] } });
	const { items } = await plan([scan('plan', [p('{A}', 'a')]), scan('Plan', [p('{B}', 'b')])], sink);
	assert.deepEqual(states(items), [['Tides/plan', 'same', 'plan', 'plan'], ['Tides/Plan', 'same', 'Plan (2)', 'Plan (2)']]);
});

test('names are compared as Obsidian compares them: composed in full, any case', async () => {
	// The plugin wrote the folder with U+F900 composed into U+8C48; the download still says U+F900.
	const { items } = await plan([scan('豈 notes', [p('{A}', 'a')])], await vault({ '豈 notes': { status: 'complete', name: '豈 notes', pages: [['{A}', 'a']] } }));
	assert.equal(items[0]!.status, 'same');
	// Matched by name alone (it cannot be read now), in another case too: still its folder, not gone.
	const byName = await plan([scan('\uF900 notes', undefined, [], 'PARSE_ERROR: bad'), scan('summer', undefined, [], 'PARSE_ERROR: bad')],
		await vault({ '\u8C48 notes': { status: 'complete', name: '\uF900 notes', pages: [['{A}', 'a']] }, Summer: [['{B}', 'b']] }));
	assert.deepEqual(states(byName.items), [['Tides/\uF900 notes', 'error', '\u8C48 notes', '\u8C48 notes'], ['Tides/summer', 'error', 'Summer', 'Summer']]);
});

test('only sections of ours are read: a folder without our contents page is not gone, and a section of its name cannot go there', async () => {
	const sink = await vault({ Spring: [['{A}', 'a']] }, {
		'Tides/Diary/_目录.md': 'my own index',
		'Tides/Diary/Monday.md': 'mine',
		'Tides/Plans/notes.md': 'mine',
	});
	const { items } = await plan([scan('Spring', [p('{A}', 'a')]), scan('Plans', [p('{P}', 'p')])], sink);
	assert.deepEqual(states(items), [['Tides/Spring', 'same', 'Spring', 'Spring'], ['Tides/Plans', 'occupied', null, 'Plans']]);
});

test('a section the user took the contents page from is not ours any more: occupied, not changed', async () => {
	const sink = await vault({ Spring: [['{A}', 'a']] });
	sink.files.delete('Tides/Spring/_目录.md');
	const { items } = await plan([scan('Spring', [p('{A}', 'a', T2)])], sink);
	assert.deepEqual(states(items), [['Tides/Spring', 'occupied', null, 'Spring']]);
});

test('a section cut off or failed before is unfinished; one left unticked before is skipped', async () => {
	const sink = await vault({ Spring: { status: 'importing', pages: [['{A}', 'a']] }, Summer: { status: 'failed' } });
	const { items } = await plan([scan('Spring', [p('{A}', 'a'), p('{B}', 'b')]), scan('Summer', [p('{C}', 'c')]), scan('Autumn', [p('{D}', 'd')])], sink, { skipped: new Set(['Autumn']) });
	assert.deepEqual(states(items), [['Tides/Spring', 'unfinished', 'Spring', 'Spring'], ['Tides/Summer', 'unfinished', 'Summer', 'Summer'], ['Tides/Autumn', 'skipped', null, 'Autumn']]);
});

test('a section no longer in the download is listed as gone (nothing is done to it), unless the download is partial', async () => {
	const sink = await vault({ Spring: [['{A}', 'a']], Old: [['{O}', 'o']] });
	assert.deepEqual(states((await plan([scan('Spring', [p('{A}', 'a')])], sink)).items), [['Tides/Spring', 'same', 'Spring', 'Spring'], ['Tides/Old', 'gone', 'Old', null]]);
	assert.deepEqual(states((await plan([scan('Spring', [p('{A}', 'a')])], sink, { partial: true })).items), [['Tides/Spring', 'same', 'Spring', 'Spring']]);
});

test('a section that cannot be read keeps its folder, by name, from being gone', async () => {
	const { items } = await plan([scan('Spring', undefined, [], 'PARSE_ERROR: bad')], await vault({ Spring: [['{A}', 'a']] }));
	assert.deepEqual(items.map(item => [item.status, item.old, item.error]), [['error', 'Spring', 'PARSE_ERROR: bad']]);
});

test('a download older than the vault: the section is marked older', async () => {
	const { items } = await plan([scan('Spring', [p('{A}', 'a', T0)])], await vault({ Spring: [['{A}', 'a', T1]] }));
	assert.equal(items[0]!.status, 'changed');
	assert.equal(items[0]!.older, true);
});

test('pages the user edited or deleted in Obsidian are marked', async () => {
	const sink = await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two'], ['{C}', 'Three']] });
	// One edited (its file time is not the OneNote time any more); Two deleted.
	sink.times.set('Tides/Spring/One.md', new Date(T2));
	sink.files.delete('Tides/Spring/Two.md');
	const { items } = await plan([scan('Spring', [p('{A}', 'One', T2), p('{B}', 'Two', T2), p('{C}', 'Three')])], sink);
	const modified = items[0]!.modified.find(page => page.title === 'One')!;
	assert.equal(modified.userEdited, true);
	const deleted = items[0]!.added.find(page => page.title === 'Two')!;
	assert.equal(deleted.userDeleted, true);
});

test('two notebooks of one name with no page in common are not the same notebook', async () => {
	const { identity } = await plan([scan('Recipes', [p('{Z}', 'Soup')])], await vault({ Spring: [['{A}', 'a']] }));
	assert.equal(identity, 'different');
	assert.equal(planNotebook('Tides', [scan('Spring', [p('{A}', 'a')])], undefined, zhHans).identity, 'new');
});

test('page info from the parser JSON: in order, ids upper case, times as ISO strings, levels', () => {
	const pages = scannedPages({ pages: [{ id: '{abc}', title: 'T', updated: 1704067200, level: 2 }, { id: '{def}', title: null, updated: null }] });
	// Levels as the page properties have them (the parser counts from 1, the properties from 0).
	assert.deepEqual(pages, [{ id: '{ABC}', title: 'T', modified: T1, level: 1 }, { id: '{DEF}', title: '', modified: null, level: 0 }]);
});

test('front matter: JSON strings, single quotes, CRLF lines, line separators inside a value', () => {
	assert.deepEqual(frontMatter('---\ntitle: "A \\"quoted\\" title"\nonenote-order: 3\n---\n\nbody'), { 'title': 'A "quoted" title', 'onenote-order': '3' });
	assert.deepEqual(frontMatter("---\r\ntitle: 'It''s'\r\nmodified: 2024-01-01T00:00:00.000Z\r\n---\r\n"), { title: "It's", modified: '2024-01-01T00:00:00.000Z' });
	assert.deepEqual(frontMatter('---\ntitle: "a b"\nonenote-id: "{A}"\n---\n'), { 'title': 'a b', 'onenote-id': '{A}' });
});

test('the archive: only folders with a contents page of ours, the language, page details and file times', async () => {
	const sink = await vault({ Spring: [['{a}', 'One', T1, 1, 2]], 'G/Summer': { status: 'failed' } }, { 'Tides/Spring/_附件/note.md': '---\nonenote-id: "{z}"\n---\n' });
	const archive = await readArchive(sink, 'Tides') as Archive;
	assert.equal(archive.language, 'zh-Hans');
	assert.deepEqual(archive.sections.map(section => [section.folder, section.status, section.heading]), [['G/Summer', 'failed', 'Summer'], ['Spring', 'complete', 'Spring']]);
	assert.deepEqual([...archive.sections[1]!.pages.values()], [{ id: '{A}', title: 'One', modified: T1, order: 1, level: 2, file: 'One.md', mtime: Date.parse(T1) }]);
	sink.files.set('Tides/_目录.md', 'my own index');
	assert.equal(await readArchive(sink, 'Tides'), undefined, 'a notebook folder without our contents page is not ours');
});
