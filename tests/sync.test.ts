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
	// Moved to another group in OneNote: told from what the report recorded of the folder (§11.5 item 52.2).
	const previous = new Map([['old name', { groups: [], name: 'Old name' }]]);
	assert.deepEqual(states((await plan([scan('Old name', [p('{A}', 'One'), p('{B}', 'Two')], ['Group'])], sink, { previous })).items), [['Tides/Group/Old name', 'changed', 'Old name', 'Group/Old name']]);
});

test('a section folder the user moved within the notebook stays where the user put it; renamed in OneNote, it is renamed there', async () => {
	const sink = await vault({ 'Archive/Winter': { status: 'complete', name: 'Winter', pages: [['{A}', 'One']] } });
	const previous = new Map([['archive/winter', { groups: [], name: 'Winter' }]]);
	assert.deepEqual(states((await plan([scan('Winter', [p('{A}', 'One')])], sink, { previous })).items), [['Tides/Winter', 'same', 'Archive/Winter', 'Archive/Winter']]);
	assert.deepEqual(states((await plan([scan('Snow', [p('{A}', 'One')])], sink, { previous })).items), [['Tides/Snow', 'changed', 'Archive/Winter', 'Archive/Snow']]);
	// Moved to another group in OneNote: into that group's folder.
	assert.deepEqual(states((await plan([scan('Winter', [p('{A}', 'One')], ['Cold'])], sink, { previous })).items), [['Tides/Cold/Winter', 'changed', 'Archive/Winter', 'Cold/Winter']]);
});

test('a section imported before that is not in the vault any more is missing, not new', async () => {
	const sink = await vault({ Spring: [['{A}', 'a']] });
	const { items } = await plan([scan('Spring', [p('{A}', 'a')]), scan('Gone away', [p('{G}', 'g')]), scan('Brand new', [p('{N}', 'n')])], sink, { imported: new Set(['Gone away']) });
	assert.deepEqual(states(items), [['Tides/Spring', 'same', 'Spring', 'Spring'], ['Tides/Gone away', 'missing', null, 'Gone away'], ['Tides/Brand new', 'new', null, 'Brand new']]);
});

test('a page moved to another section in OneNote does not pull that section into the wrong folder', async () => {
	const sink = await vault({ 'Archive/Inbox': [['{M}', 'Moved'], ['{I}', 'Inbox page']], Notes: [['{N}', 'Notes page']] });
	const { items } = await plan([scan('Notes', [p('{M}', 'Moved'), p('{N}', 'Notes page')]), scan('Inbox', [p('{I}', 'Inbox page')], ['Archive'])], sink);
	assert.deepEqual(states(items), [['Tides/Notes', 'changed', 'Notes', 'Notes'], ['Tides/Archive/Inbox', 'changed', 'Archive/Inbox', 'Archive/Inbox']]);
});

test('a section moved into a new group named like another section does not go inside that section\'s folder', async () => {
	const sink = await vault({ Notes: [['{A}', 'Alpha']], Work: [['{B}', 'Beta']] });
	const previous = new Map([['notes', { groups: [], name: 'Notes' }], ['work', { groups: [], name: 'Work' }]]);
	const { items } = await plan([scan('Work', [p('{B}', 'Beta')]), scan('Notes', [p('{A}', 'Alpha')], ['Work'])], sink, { previous });
	const notes = items.find(item => item.label === 'Notes')!;
	assert.ok(!notes.new!.toLowerCase().startsWith('work/'), notes.new);
});

test('the user\'s copy of a page (same page id) is not taken for the page: the one the contents page lists is', async () => {
	const sink = await vault({ Spring: [['{A}', 'One']] });
	await sink.writeText('Tides/Spring/A copy of One.md', pageText('{A}', 'One'), new Date(T1));
	const archive = (await readArchive(sink, 'Tides'))!;
	assert.equal(archive.sections[0]!.pages.get('{A}')!.file, 'One.md');
});

test('pages the user deleted are told by page id when the report has ids, and a page with no title or a backslash in it is still told', async () => {
	const sink = await vault({ Spring: [['{A}', ''], ['{B}', 'a\\b'], ['{C}', 'Three']] });
	sink.files.delete('Tides/Spring/.md');
	sink.files.delete('Tides/Spring/a\\b.md');
	// No ids in the report: by title, untitled pages and backslashes included.
	await sink.writeText('Tides/Spring/_目录.md', toc('complete', 'Spring', ['无标题.md', 'a\\b.md', 'Three.md']).replace('[无标题]', '[无标题]'));
	sink.files.set('Tides/Spring/_目录.md', (sink.files.get('Tides/Spring/_目录.md') as string).replace('(<无标题.md>)', '(<无标题.md>)'));
	const byTitle = (await plan([scan('Spring', [p('{A}', ''), p('{B}', 'a\\b'), p('{C}', 'Three')])], sink)).items[0]!;
	assert.deepEqual(byTitle.added.map(page => [page.title, !!page.userDeleted]), [['', true], ['a\\b', true]]);
	// With ids: a new OneNote page of a deleted page's title is new, not taken for the deleted one.
	const recorded = [{ groups: [], section: 'Spring', dir: 'Tides/Spring', report: { section: 'Spring', dir: 'Tides/Spring', pageCount: 3, attachments: 0, reusedAttachments: 0, pages: [{ id: '{A}', title: '', file: '无标题.md', level: 0, chars: 0, assets: 0, skipped: [] }, { id: '{B}', title: 'a\\b', file: 'a\\b.md', level: 0, chars: 0, assets: 0, skipped: [] }, { id: '{C}', title: 'Three', file: 'Three.md', level: 0, chars: 0, assets: 0, skipped: [] }] } }];
	const byId = planNotebook('Tides', [scan('Spring', [p('{A}', ''), p('{Z}', 'a\\b'), p('{C}', 'Three')])], await readArchive(sink, 'Tides', recorded), zhHans);
	assert.deepEqual(byId.items[0]!.added.map(page => [page.id, !!page.userDeleted]), [['{A}', true], ['{Z}', false]]);
});

test('a page OneNote brought back after it was listed as no longer in OneNote makes its section changed', async () => {
	const sink = await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two']] });
	await sink.writeText('Tides/Spring/_目录.md', `${toc('complete', 'Spring', ['One.md'])}\n## OneNote 里已经没有的页面\n\n- [Two](<Two.md>)\n`);
	const item = (await plan([scan('Spring', [p('{A}', 'One'), p('{B}', 'Two', T1, 1)])], sink)).items[0]!;
	assert.equal(item.status, 'changed');
});

test('a heading the user adds to a contents page does not hide pages they deleted', async () => {
	const sink = await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two']] });
	await sink.writeText('Tides/Spring/_目录.md', `${toc('complete', 'Spring', [])}\n## My notes\n\n- [One](<One.md>)\n- [Two](<Two.md>)\n`);
	sink.files.delete('Tides/Spring/Two.md');
	const item = (await plan([scan('Spring', [p('{A}', 'One'), p('{B}', 'Two')])], sink)).items[0]!;
	assert.deepEqual(item.added.map(page => [page.title, !!page.userDeleted]), [['Two', true]]);
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

test('a section an update was cut off in (its record gone) is unfinished, even with no change', async () => {
	const sink = await vault({ Spring: { status: 'syncing', pages: [['{A}', 'a']] } });
	assert.deepEqual(states((await plan([scan('Spring', [p('{A}', 'a')])], sink)).items), [['Tides/Spring', 'unfinished', 'Spring', 'Spring']]);
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

// A page OneNote deleted stays where it is (§11.5 item 51): the update lists it in its section's
// contents page as no longer in OneNote, and from then on it is not a change.
test('a page OneNote deleted makes its section changed once; listed as no longer in OneNote, it does not', async () => {
	const sink = await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two']] });
	const first = (await plan([scan('Spring', [p('{A}', 'One')])], sink)).items[0]!;
	assert.equal(first.status, 'changed');
	assert.deepEqual(first.removed.map(page => page.title), ['Two']);
	await sink.writeText('Tides/Spring/_目录.md', `${toc('complete', 'Spring', ['One.md'])}\n## OneNote 里已经没有的页面\n\n- [Two](<Two.md>)\n`);
	const again = (await plan([scan('Spring', [p('{A}', 'One')])], sink)).items[0]!;
	assert.equal(again.status, 'same');
	assert.deepEqual(again.removed, []);
});

test('a page the user deleted in Obsidian alone does not make its section changed (bringing it back is a choice)', async () => {
	const sink = await vault({ Spring: [['{A}', 'One'], ['{B}', 'Two']] });
	sink.files.delete('Tides/Spring/Two.md');
	const item = (await plan([scan('Spring', [p('{A}', 'One'), p('{B}', 'Two')])], sink)).items[0]!;
	assert.equal(item.status, 'same');
	assert.deepEqual(item.added.map(page => [page.title, page.userDeleted]), [['Two', true]]);
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
