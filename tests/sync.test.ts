import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontMatter, planNotebook, readArchive, scannedPages, sectionDir } from '../src/core/sync.ts';
import type { ArchivedSections, PageInfo, ScannedSection } from '../src/core/sync.ts';
import { zhHans } from '../src/core/strings.ts';
import { memorySink } from './helpers.ts';

const T1 = '2024-01-01T00:00:00.000Z';
const T2 = '2024-02-01T00:00:00.000Z';
const page = (title: string, modified: string | null = T1): PageInfo => ({ title, modified });
const scan = (label: string, pages: [string, PageInfo][], groups: string[] = []): ScannedSection =>
	({ key: ['NB', ...groups, label].join('/'), groups, label, pages: new Map(pages) });
const archive = (sections: Record<string, [string, PageInfo][]>): ArchivedSections =>
	new Map(Object.entries(sections).map(([dir, pages]) => [dir, new Map(pages.map(([id, p]) => [id, { ...p, file: `${p.title}.md` }]))]));

test('an unchanged section is the same', () => {
	const items = planNotebook('NB', [scan('S', [['{A}', page('One')]])], archive({ S: [['{A}', page('One')]] }), zhHans);
	assert.deepEqual(items.map(i => [i.status, i.old, i.new]), [['same', 'S', 'S']]);
});

test('added, removed and modified pages make a section changed', () => {
	const items = planNotebook('NB',
		[scan('S', [['{A}', page('One', T2)], ['{C}', page('Three')], ['{D}', page('Renamed')]])],
		archive({ S: [['{A}', page('One')], ['{B}', page('Two')], ['{D}', page('Four')]] }), zhHans);
	assert.equal(items[0].status, 'changed');
	assert.deepEqual([items[0].added, items[0].removed, items[0].modified], [['Three'], ['Two'], ['One', 'Renamed']]);
});

test('a renamed section is matched to its old folder by its pages', () => {
	const items = planNotebook('NB', [scan('New name', [['{A}', page('One')], ['{B}', page('Two')]])], archive({ 'Old name': [['{A}', page('One')], ['{B}', page('Two')]] }), zhHans);
	assert.deepEqual(items.map(i => [i.status, i.old, i.new]), [['changed', 'Old name', 'New name']]);
	assert.deepEqual([items[0].added, items[0].removed, items[0].modified], [[], [], []]);
});

test('a section moved into a group counts as changed, at its new folder', () => {
	const items = planNotebook('NB', [scan('S', [['{A}', page('One')]], ['Group'])], archive({ S: [['{A}', page('One')]] }), zhHans);
	assert.deepEqual(items.map(i => [i.status, i.old, i.new]), [['changed', 'S', 'Group/S']]);
});

test('a new section, and a section that is gone unless the download is partial', () => {
	const scanned = [scan('Fresh', [['{N}', page('New page')]])];
	const old = archive({ Old: [['{O}', page('Old page')]] });
	assert.deepEqual(planNotebook('NB', scanned, old, zhHans).map(i => [i.status, i.key, i.added ?? i.removed]), [
		['new', 'NB/Fresh', ['New page']],
		['gone', 'NB/Old', ['Old page']],
	]);
	assert.deepEqual(planNotebook('NB', scanned, old, zhHans, true).map(i => i.status), ['new']);
});

test('a section that cannot be read is reported and keeps its old folder from being gone', () => {
	const items = planNotebook('NB', [{ key: 'NB/S', groups: [], label: 'S', error: 'PARSE_ERROR: bad' }], archive({ S: [['{A}', page('One')]] }), zhHans);
	assert.deepEqual(items.map(i => [i.status, i.error]), [['error', 'PARSE_ERROR: bad']]);
});

test('votes: the folder holding most pages wins; on a tie the first one seen', () => {
	const old = archive({ X: [['{A}', page('a')]], Y: [['{B}', page('b')], ['{C}', page('c')]] });
	assert.equal(planNotebook('NB', [scan('Z', [['{A}', page('a')], ['{B}', page('b')], ['{C}', page('c')]])], old, zhHans)[0].old, 'Y');
	assert.equal(planNotebook('NB', [scan('Z', [['{A}', page('a')], ['{B}', page('b')]])], old, zhHans)[0].old, 'X');
});

test('section folders use the same safe names as the converter', () => {
	assert.equal(sectionDir({ groups: ['G: 1'], label: 'a/b' }, zhHans), 'G： 1/a／b');
});

test('page info from the parser JSON: ids upper case, times as ISO strings', () => {
	const pages = scannedPages({ pages: [{ id: '{abc}', title: 'T', updated: 1704067200 }, { id: '{def}', title: null, updated: null }] });
	assert.deepEqual([...pages], [['{ABC}', { title: 'T', modified: T1 }], ['{DEF}', { title: '', modified: null }]]);
});

test('front matter and the archive are read back from written pages', async () => {
	assert.deepEqual(frontMatter('---\ntitle: "A \\"quoted\\" title"\nonenote-order: 3\n---\n\nbody'), { 'title': 'A "quoted" title', 'onenote-order': '3' });
	const sink = memorySink();
	await sink.writeText('NB/_目录.md', '---\ntitle: "NB 目录"\n---\n');
	await sink.writeText('NB/S/_目录.md', '---\ntitle: "S 目录"\n---\n');
	await sink.writeText('NB/S/One.md', `---\ntitle: "One"\nmodified: ${T1}\nonenote-id: "{a}"\n---\n\nbody\n`);
	await sink.writeText('NB/S/_附件/note.md', '---\nonenote-id: "{z}"\n---\n');
	await sink.writeText('NB/G/S2/_目录.md', '---\n---\n');
	const result = await readArchive(sink, 'NB', zhHans);
	assert.deepEqual([...result.keys()], ['G/S2', 'S']);
	assert.deepEqual([...result.get('S')!], [['{A}', { title: 'One', modified: T1, file: 'One.md' }]]);
	assert.equal(result.get('G/S2')!.size, 0);
});

test('a section folder or page title written decomposed by an earlier conversion is still the same', () => {
	const decomposed = 'ライティンク\u3099';
	const items = planNotebook('NB', [scan(decomposed.normalize('NFC'), [['{A}', page('ヘ\u309Aージ'.normalize('NFC'))]])], archive({ [decomposed]: [['{A}', page('ヘ\u309Aージ')]] }), zhHans);
	assert.deepEqual(items.map(i => [i.status, i.old, i.new]), [['same', decomposed, decomposed.normalize('NFC')]]);
	assert.equal(scannedPages({ pages: [{ id: '{a}', title: 'ヘ\u309Aージ' }] }).get('{A}')!.title, 'ページ');
});
