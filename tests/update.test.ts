// Updating notebooks in place from a new download (src/core/update.ts, §11.5 item 49): what is
// written, what is kept, what goes aside, and that an update cut off at any step is finished or
// put back. Version 1 of a notebook is imported as an import does it; version 2 is the new
// download. Notebooks, sections, pages and pictures are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { findNotebooks } from '../src/core/download.ts';
import type { DownloadFile, DownloadSection } from '../src/core/download.ts';
import { importNotebooks } from '../src/core/importer.ts';
import type { ImportHost } from '../src/core/importer.ts';
import { reportedNotebooks, writeReport } from '../src/core/report.ts';
import { zhHans } from '../src/core/strings.ts';
import { planNotebook, readArchive, scannedPages } from '../src/core/sync.ts';
import { recordedPlanOptions, resumeUpdates, updateNotebooks } from '../src/core/update.ts';
import type { UpdateHost } from '../src/core/update.ts';
import { importStatusOf, sectionKey } from '../src/core/write.ts';
import { asset, element, memorySink, outline, pageJson, rich, run, sectionJson } from './helpers.ts';
import type { MemorySink } from './helpers.ts';

/** Sections by their place in the notebook (`Group/Section`): their pages (parser JSON) and attachment bytes. */
type Version = Record<string, { pages: unknown[], assets?: Record<string, string> }>;

const OPTIONS = { boxMarkers: true, keepFontColor: true };
const AT = new Date(2026, 11, 1, 14, 30);
const BACKUP = '_旧版本/2026-12-01 1430';

const hour = (n: number) => 1700000000 + n * 3600;
/** A page id from a short name (hex digits only, as page ids are). */
const id = (name: string) => `{${name.padStart(8, '0')}-0000-0000-0000-000000000000}`;
/** A page: its id (by name), title, text, and the hour it was last changed. */
const page = (name: string, title: string, body: string, changed = 1, more: unknown[] = []) =>
	pageJson(title, [outline([element([rich([run(body)])]), ...more.map(item => element([item]))])], { id: id(name), updated: hour(changed) });
const picture = (key: string) => ({ type: 'image', asset: asset(key), fileName: null, x: null, y: null, w: null });
const linkTo = (name: string, label: string) => rich([run(label, { link: true, href: `onenote:https://x.example/Tides/X.one#t&section-id={DDDDDDDD-0000-0000-0000-000000000001}&page-id=${id(name)}&end` })]);

function download(version: Version, notebook = 'Tides') {
	const files: DownloadFile[] = [{ path: `${notebook}/Open Notebook.onetoc2`, size: 1 }, ...Object.keys(version).map(key => ({ path: `${notebook}/${key}.one`, size: 1 }))];
	return findNotebooks(files, 'Documents');
}

const placeOf = (section: DownloadSection) => [...section.groups, section.label].join('/');

function parser(version: Version) {
	return async (section: DownloadSection) => {
		const { pages, assets = {} } = version[placeOf(section)]!;
		return {
			json: sectionJson(section.label, pages),
			source: { async readAsset(key: string) {
				if (!(key in assets)) throw new Error(`missing ${key}`);
				return new TextEncoder().encode(assets[key]);
			} },
			release() {},
		};
	};
}

const folders = (sink: MemorySink) => async () => [...new Set([...sink.files.keys()].map(path => path.split('/')[0]!))];

/** A vault with version 1 imported into it, as the plugin and the command line import (`chosen`: the sections ticked, all when not given). */
async function imported(version: Version, chosen?: (section: DownloadSection) => boolean): Promise<MemorySink> {
	const vault = memorySink();
	const host: ImportHost = { sink: vault, parse: parser(version), isPasswordProtected: async () => false, listFolders: folders(vault) };
	const result = await importNotebooks(download(version), host, { languageFor: () => 'zh-Hans', ...OPTIONS, links: true, ...(chosen ? { chosen } : {}) });
	await writeReport(vault, zhHans, result, { at: new Date(2026, 10, 1), sources: ['old.zip'], options: OPTIONS }, await folders(vault)());
	return vault;
}

let stagingIds = 0;
function host(vault: MemorySink, version: Version, stagings = new Map<string, MemorySink>()): UpdateHost {
	return {
		vault,
		async newStaging() {
			const staging = { id: `staging ${stagingIds++}`, sink: memorySink() };
			stagings.set(staging.id, staging.sink);
			return staging;
		},
		async openStaging(id) { return stagings.get(id); },
		async releaseStaging(id) { stagings.delete(id); },
		parse: parser(version),
		isPasswordProtected: async () => false,
		listFolders: folders(vault),
	};
}

async function requests(version: Version, chosen?: string[], restore?: string[]) {
	return Promise.all(download(version).map(async notebook => ({
		...(restore ? { restore: new Set(restore) } : {}),
		notebook,
		scanned: await Promise.all(notebook.sections.map(async section => ({
			key: `${notebook.name}/${placeOf(section)}`, groups: section.groups, label: section.label,
			pages: await scannedPages(sectionJson(section.label, version[placeOf(section)]!.pages) as never),
		}))),
		chosen: new Set(chosen ?? notebook.sections.map(section => sectionKey(section.groups, section.label))),
	})));
}

const update = async (vault: MemorySink, version: Version, h = host(vault, version), chosen?: string[]) =>
	updateNotebooks(await requests(version, chosen), h, { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults: OPTIONS, links: true, sources: ['new.zip'] });

/** Files under a folder: text (or bytes as text) and time. */
function snapshot(sink: MemorySink, folder = 'Tides') {
	const out: Record<string, [string, number]> = {};
	for (const [path, value] of [...sink.files].sort(([a], [b]) => a.localeCompare(b))) {
		if (folder !== '' && !path.startsWith(`${folder}/`)) continue;
		out[path] = [typeof value === 'string' ? value : `bytes:${new TextDecoder().decode(value)}`, sink.times.get(path)?.getTime() ?? 0];
	}
	return out;
}
const textOf = (sink: MemorySink, path: string) => sink.files.get(path) as string | undefined;

const V1: Version = {
	Spring: { pages: [page('a', 'One', 'one, first version'), page('b', 'Two', 'two'), page('c', 'Three', 'three')] },
	Summer: { pages: [page('s', 'Sun', 'see', 1, [linkTo('a', 'One')])] },
};

test('the same download changes nothing: no file is written', async () => {
	const vault = await imported(V1);
	const before = snapshot(vault, '');
	const all = new Map(vault.files);
	assert.equal(await update(vault, V1), undefined);
	assert.deepEqual(snapshot(vault, ''), before);
	assert.deepEqual([...vault.files.keys()].sort(), [...all.keys()].sort());
});

test('pages OneNote changed and added: the result is what importing the new version gives; replaced pages go aside; a page OneNote deleted stays', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, second version', 2), page('c', 'Three', 'three'), page('d', 'Four', 'four')] },
		Summer: V1.Summer!,
	};
	const vault = await imported(V1);
	const c = textOf(vault, 'Tides/Spring/Three.md')!;
	const two = snapshot(vault, 'Tides/Spring')['Tides/Spring/Two.md'];
	const result = await update(vault, V2);
	assert.ok(result);
	assert.deepEqual(result.outcomes, [{ notebook: 'Tides', key: 'Spring', outcome: 'done' }]);
	// The page OneNote deleted is where it was, as it was; the contents page lists it apart.
	const now = snapshot(vault);
	assert.deepEqual(now['Tides/Spring/Two.md'], two);
	const toc = now['Tides/Spring/_目录.md']![0];
	assert.match(toc, /- \[Four\]\(<Four\.md>\)\n\n## OneNote 中已移除的页面\n\n- \[Two\]\(<Two\.md>\)\n$/);
	const fresh = snapshot(await imported(V2));
	assert.equal(toc.slice(0, toc.indexOf('\n\n## ')), fresh['Tides/Spring/_目录.md']![0].replace(/\n$/, ''));
	delete now['Tides/Spring/Two.md'];
	delete now['Tides/Spring/_目录.md'];
	delete fresh['Tides/Spring/_目录.md'];
	assert.deepEqual(now, fresh);
	// What was replaced is kept, with its file time.
	assert.match(textOf(vault, `${BACKUP}/Tides/Spring/One.md`)!, /one, first version/);
	assert.equal(vault.times.get(`${BACKUP}/Tides/Spring/One.md`)?.getTime(), hour(1) * 1000);
	assert.equal(textOf(vault, `${BACKUP}/Tides/Spring/Two.md`), undefined);
	assert.match(textOf(vault, `${BACKUP}/Tides/Spring/_目录.md`)!, /onenote-import: complete/);
	// The page OneNote did not change: only its place in the section (order 3 to 2) is brought up to date.
	assert.equal(textOf(vault, 'Tides/Spring/Three.md'), c.replace('onenote-order: 3', 'onenote-order: 2'));
	// The record and the report.
	const record = textOf(vault, '_更新记录/2026-12-01 1430.md')!;
	assert.match(record, /更新 1 个分区，新增 1 页，修改 1 页，OneNote 中移除 1 页（仓库中保留）/);
	assert.match(record, /- 修改：\[One\]\(<\.\.\/Tides\/Spring\/One\.md>\)（\[更新前\]\(<\.\.\/_旧版本\/2026-12-01 1430\/Tides\/Spring\/One\.md>\)）/);
	assert.match(record, /- OneNote 中已移除，保留在原处：\[Two\]\(<\.\.\/Tides\/Spring\/Two\.md>\)/);
	assert.match(record, /1 页仅调整了顺序或层级/);
	// The opening says what the record covers and links the report, the overview of every notebook.
	assert.match(record, /本页记录这次更新对已导入的笔记本做了什么，包括补进的分区。更新前的版本在“\\_旧版本\/2026-12-01 1430”中，.*所有笔记本的总览见\[\\_转换报告\]\(<\.\.\/_转换报告\.md>\)。/);
	assert.match(textOf(vault, '_转换报告.md')!, /这次更新了已导入的笔记，详见\[更新记录 2026-12-01 14:30\]\(<_更新记录\/2026-12-01 1430\.md>\)。/);
	const journal = textOf(vault, '_更新记录/2026-12-01 1430.jsonl')!;
	assert.match(journal, /\{"t":"end"\}\n$/);
	// Checking again with the same download: nothing to do.
	const after = snapshot(vault, '');
	assert.equal(await update(vault, V2), undefined);
	assert.deepEqual(snapshot(vault, ''), after);
});

test('a page OneNote deleted keeps its file name: a new page of that title gets another', async () => {
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, first version'), page('e', 'Two', 'a new two'), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	const vault = await imported(V1);
	const two = textOf(vault, 'Tides/Spring/Two.md');
	await update(vault, V2);
	assert.equal(textOf(vault, 'Tides/Spring/Two.md'), two);
	assert.match(textOf(vault, 'Tides/Spring/Two (2).md')!, /a new two/);
	assert.match(textOf(vault, 'Tides/Spring/_目录.md')!, /- \[Two\]\(<Two \(2\)\.md>\)\n[^]*## OneNote 中已移除的页面\n\n- \[Two\]\(<Two\.md>\)/);
});

test('a page the user deleted comes back only when chosen', async () => {
	const vault = await imported(V1);
	vault.files.delete('Tides/Spring/Two.md');
	// Nothing else changed: nothing to do, unless the page is to come back.
	assert.equal(await update(vault, V1), undefined);
	assert.equal(textOf(vault, 'Tides/Spring/Two.md'), undefined);
	const back = await updateNotebooks(await requests(V1, undefined, [id('b').toUpperCase()]), host(vault, V1), { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults: OPTIONS, links: true, sources: ['new.zip'] });
	assert.deepEqual(back!.outcomes, [{ notebook: 'Tides', key: 'Spring', outcome: 'done' }]);
	assert.deepEqual(snapshot(vault, 'Tides/Spring'), snapshot(await imported(V1), 'Tides/Spring'));
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /- 补回在 Obsidian 中删除的页面：\[Two\]/);
	// Counted as a page brought back, not as a section updated (§11.5 item 51.2).
	assert.deepEqual(back!.counts, { sectionsUpdated: 0, sectionsAdded: 0, sectionsReconverted: 0, pagesAdded: 0, pagesModified: 0, pagesRemoved: 0, pagesRestored: 1 });
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /- 补回 1 页\n/);
});

test('a page whose content OneNote changed while its last-modified time stayed is updated: the content decides (§11.5 item 59)', async () => {
	// OneNote leaves a page's time as it was when its text is edited (seen on real downloads).
	const V2: Version = { ...V1, Spring: { pages: [page('a', 'One', 'one, edited in OneNote', 1), V1.Spring!.pages[1]!, V1.Spring!.pages[2]!] } };
	const vault = await imported(V1);
	const result = await update(vault, V2);
	assert.deepEqual(result!.outcomes.map(o => `${o.key}:${o.outcome}`), ['Spring:done']);
	assert.match(textOf(vault, 'Tides/Spring/One.md')!, /one, edited in OneNote/);
	assert.match(textOf(vault, `${BACKUP}/Tides/Spring/One.md`)!, /one, first version/);
	// The report now holds the new content's fingerprint: checking again finds nothing.
	assert.equal(await update(vault, V2), undefined);
});

test('only the width of a text box changed (OneNote does it by itself): nothing to update', async () => {
	const boxed = (width: number) => pageJson('One', [outline([element([rich([run('one, first version')])])], { x: 1, y: 1, w: width })], { id: id('a'), updated: hour(1) });
	const W1: Version = { Spring: { pages: [boxed(13.86)] } }, W2: Version = { Spring: { pages: [boxed(12.01)] } };
	const vault = await imported(W1);
	assert.equal(await update(vault, W2), undefined);
	// Moving it is a change (reading order and position comments follow it).
	const moved: Version = { Spring: { pages: [pageJson('One', [outline([element([rich([run('one, first version')])])], { x: 9, y: 1, w: 13.86 })], { id: id('a'), updated: hour(1) })] } };
	assert.deepEqual((await update(vault, moved))!.outcomes.map(o => o.outcome), ['done']);
});

test('a report written before fingerprints (none recorded): pages are compared by their time, as before', async () => {
	const vault = await imported(V1);
	const reportPath = [...vault.files.keys()].find(path => path.endsWith('.json'))!;
	vault.files.set(reportPath, (vault.files.get(reportPath) as string).replace(/,\s*"fingerprint":\s*"[^"]*"/g, ''));
	assert.doesNotMatch(vault.files.get(reportPath) as string, /fingerprint/);
	// The same content: nothing to update, though the content cannot be compared.
	assert.equal(await update(vault, V1), undefined);
	const V2: Version = { ...V1, Spring: { pages: [page('a', 'One', 'one, second version', 2), V1.Spring!.pages[1]!, V1.Spring!.pages[2]!] } };
	assert.deepEqual((await update(vault, V2))!.outcomes.map(o => o.outcome), ['done']);
});

test('two requests for one notebook folder (two downloads of it) are refused before anything is written', async () => {
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), V1.Spring!.pages[1]!, V1.Spring!.pages[2]!] }, Summer: V1.Summer! };
	const vault = await imported(V1);
	const before = snapshot(vault, '');
	await assert.rejects(updateNotebooks([...await requests(V2), ...await requests(V2)], host(vault, V2), { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults: OPTIONS, links: true, sources: ['new.zip'] }));
	assert.deepEqual(snapshot(vault, ''), before);
});

test('a new section chosen and not reached (the update was stopped) is new again next time, not "left unticked"', async () => {
	const V2: Version = { ...V1, Autumn: { pages: [page('x', 'Leaves', 'fall')] }, Winter: { pages: [page('y', 'Ice', 'cold')] } };
	const vault = await imported(V1);
	const h = host(vault, V2);
	let done = 0;
	h.onSectionDone = () => void done++;
	h.isCancelled = () => done >= 1;
	const result = await update(vault, V2, h);
	assert.deepEqual(result!.outcomes.map(o => `${o.key}:${o.outcome}`), ['Autumn:done', 'Winter:not reached']);
	const [entry] = await reportedNotebooks(vault, zhHans);
	const recorded = recordedPlanOptions(entry, 'Tides');
	assert.deepEqual([...recorded.skipped!], []);
	const plan = planNotebook('Tides', (await requests(V2))[0]!.scanned, await readArchive(vault, 'Tides', entry!.sections), zhHans, recorded);
	assert.equal(plan.items.find(item => item.label === 'Winter')!.status, 'new');
});

test('a section OneNote renamed moves with everything in it; links to it from other sections follow', async () => {
	const V2: Version = { 'Spring 2': V1.Spring!, Summer: V1.Summer! };
	const vault = await imported(V1);
	await vault.writeText('Tides/Spring/My notes.md', 'the user\'s own', new Date(5));
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /\]\(<\.\.\/Spring\/One\.md>\)/);
	await update(vault, V2);
	const fresh = snapshot(await imported(V2));
	const now = snapshot(vault);
	assert.equal(now['Tides/Spring 2/My notes.md']?.[0], 'the user\'s own');
	delete now['Tides/Spring 2/My notes.md'];
	assert.deepEqual(now, fresh);
	assert.ok(![...vault.files.keys()].some(path => path.startsWith('Tides/Spring/')));
	// The page whose link changed was copied aside first.
	assert.match(textOf(vault, `${BACKUP}/Tides/Summer/Sun.md`)!, /\]\(<\.\.\/Spring\/One\.md>\)/);
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /- 分区“\[Spring 2\]\(<\.\.\/Tides\/Spring 2\/_目录\.md>\)”（原为“Spring”）/);
});

test('pages OneNote retitled keep their file object (renamed), even two that swap their names', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'Two', 'one', 2), page('b', 'One', 'two', 2), page('c', 'Three', 'three')] },
		Summer: V1.Summer!,
	};
	const vault = await imported(V1);
	await update(vault, V2);
	assert.deepEqual(snapshot(vault), snapshot(await imported(V2)));
	assert.ok(![...vault.files.keys()].some(path => path.includes('onenote-ferry')));
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /- 修改：\[Two\]\(<\.\.\/Tides\/Spring\/Two\.md>\)（\[更新前\]\(<[^>]+\/One\.md>\)，原标题“One”）/);
	// The link to page a follows it to its new name.
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /\]\(<\.\.\/Spring\/Two\.md>\)/);
});

test('what the user did in Obsidian: edits are kept or set aside, deleted pages stay deleted, their files are left alone', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three'), page('m', 'Mine', 'from OneNote')] },
		Summer: V1.Summer!,
	};
	const vault = await imported(V1);
	// Edited in Obsidian: a (OneNote changed it too) and b (OneNote did not).
	await vault.writeText('Tides/Spring/One.md', `${textOf(vault, 'Tides/Spring/One.md')}my words on one\n`, new Date(9e12));
	await vault.writeText('Tides/Spring/Two.md', `${textOf(vault, 'Tides/Spring/Two.md')}my words on two\n`, new Date(9e12));
	vault.files.delete('Tides/Spring/Three.md');
	await vault.writeText('Tides/Spring/Mine.md', 'my own note', new Date(9e12));
	const two = textOf(vault, 'Tides/Spring/Two.md');
	await update(vault, V2);
	assert.match(textOf(vault, 'Tides/Spring/One.md')!, /one, second version/);
	assert.match(textOf(vault, `${BACKUP}/Tides/Spring/One.md`)!, /my words on one/);
	assert.equal(textOf(vault, 'Tides/Spring/Two.md'), two);
	assert.equal(vault.times.get('Tides/Spring/Two.md')?.getTime(), 9e12);
	assert.equal(textOf(vault, 'Tides/Spring/Three.md'), undefined);
	assert.equal(textOf(vault, 'Tides/Spring/Mine.md'), 'my own note');
	assert.match(textOf(vault, 'Tides/Spring/Mine (2).md')!, /from OneNote/);
	const record = textOf(vault, '_更新记录/2026-12-01 1430.md')!;
	assert.match(record, /以下页面在 OneNote 和 Obsidian 中都有修改/);
	assert.match(record, /\t- \[One\]\(<\.\.\/Tides\/Spring\/One\.md>\)（\[你的版本\]\(<\.\.\/_旧版本\/2026-12-01 1430\/Tides\/Spring\/One\.md>\)）/);
	assert.match(record, /修改：\[One\][^\n]*（Obsidian 中也已修改）/);
});

// Converting again with other settings (§11.5 item 65): sections without changes, chosen, are written
// anew with the settings chosen now; pages edited in Obsidian stay; each section keeps its settings.

const coloured = (name: string, title: string) => pageJson(title, [outline([element([rich([run('red words', { color: '#C00000' })])])])], { id: id(name), updated: hour(1) });
const COLOURED: Version = {
	Spring: { pages: [page('a', 'One', 'one'), coloured('b', 'Two'), coloured('c', 'Three')] },
	Summer: { pages: [coloured('s', 'Sun')] },
};
const PLAIN = { boxMarkers: true, keepFontColor: false };
const reconvert = async (vault: MemorySink, version: Version, keys: string[], defaults = PLAIN) => {
	const asked = (await requests(version, keys)).map(request => ({ ...request, reconvert: new Set(keys) }));
	return updateNotebooks(asked, host(vault, version), { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults, links: true, sources: ['same.zip'] });
};

test('a section without changes, chosen, is converted again with the settings chosen now; the others are left alone', async () => {
	const vault = await imported(COLOURED);
	assert.match(textOf(vault, 'Tides/Spring/Two.md')!, /color:#c00000/i);
	const summer = textOf(vault, 'Tides/Summer/Sun.md');
	const result = await reconvert(vault, COLOURED, ['Spring']);
	assert.ok(result);
	assert.doesNotMatch(textOf(vault, 'Tides/Spring/Two.md')!, /color:/);
	assert.match(textOf(vault, `${BACKUP}/Tides/Spring/Two.md`)!, /color:#c00000/i, 'the version before goes aside');
	assert.equal(textOf(vault, 'Tides/Summer/Sun.md'), summer, 'a section not chosen is not touched');
	assert.equal(result!.counts.sectionsReconverted, 1);
	assert.equal(result!.counts.sectionsUpdated, 0);
	assert.equal(result!.counts.pagesModified, 0, 'pages written anew are not counted as changed in OneNote');
	// The report keeps each section's settings: the one converted again has the new ones.
	const report = JSON.parse(textOf(vault, '_转换报告.json')!);
	const sections = report.notebooks[0].sections as { section: string, options?: unknown }[];
	assert.deepEqual(sections.find(section => section.section === 'Spring')!.options, PLAIN);
	assert.equal(sections.find(section => section.section === 'Summer')!.options, undefined);
	const record = textOf(vault, '_更新记录/2026-12-01 1430.md')!;
	assert.match(record, /重新转换 1 个分区/);
	assert.match(record, /按现在的设置重新转换“\[Spring\]\(<[^>]+>\)”（重写 3 页）/);
});

test('converting again leaves a page edited in Obsidian as it is, and says so', async () => {
	const vault = await imported(COLOURED);
	await vault.writeText('Tides/Spring/Two.md', `${textOf(vault, 'Tides/Spring/Two.md')}my words\n`, new Date(9e12));
	const mine = textOf(vault, 'Tides/Spring/Two.md');
	const result = await reconvert(vault, COLOURED, ['Spring']);
	assert.equal(textOf(vault, 'Tides/Spring/Two.md'), mine);
	assert.doesNotMatch(textOf(vault, 'Tides/Spring/Three.md')!, /color:/);
	assert.equal(result!.attention.keptEdited, 1);
	const record = textOf(vault, '_更新记录/2026-12-01 1430.md')!;
	assert.match(record, /以下页面在 Obsidian 中改过，保持原样，没有按新设置重写：\n\t- \[Two\]/);
	assert.match(record, /（重写 2 页）/);
});

test('settings go with each section: one updated because OneNote changed it keeps its own, a new one takes those chosen now', async () => {
	const vault = await imported(COLOURED, section => section.label === 'Spring');
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one'), coloured('b', 'Two'), pageJson('Three', [outline([element([rich([run('changed', { color: '#C00000' })])])])], { id: id('c'), updated: hour(2) })] }, Summer: COLOURED.Summer! };
	await updateNotebooks(await requests(V2), host(vault, V2), { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults: PLAIN, links: true, sources: ['new.zip'] });
	// Spring changed in OneNote: written as it was imported (colours kept); Summer, added now: as chosen now.
	assert.match(textOf(vault, 'Tides/Spring/Three.md')!, /color:#c00000/i);
	assert.doesNotMatch(textOf(vault, 'Tides/Summer/Sun.md')!, /color:/);
	const report = JSON.parse(textOf(vault, '_转换报告.json')!);
	const sections = report.notebooks[0].sections as { section: string, options?: unknown }[];
	assert.deepEqual(sections.find(section => section.section === 'Summer')!.options, PLAIN);
	assert.deepEqual(sections.find(section => section.section === 'Spring')!.options, OPTIONS);
});

test('attachments: a changed picture replaces its file; one a page that stays uses is never overwritten; unused ones go aside', async () => {
	const long = 'A title long enough to be cut off';
	const V1p: Version = {
		Spring: { pages: [page('l1', `${long} 1`, 'one', 1, [picture('p1.png')]), page('l2', `${long} 2`, 'two', 1, [picture('p2.png')]), page('k', 'Kept', 'k', 1, [picture('k.png')])], assets: { 'p1.png': 'AAA', 'p2.png': 'BBB', 'k.png': 'KKK' } },
	};
	const vault = await imported(V1p);
	const files = () => [...vault.files.keys()].filter(path => path.startsWith('Tides/Spring/_附件/')).sort();
	assert.deepEqual(files(), ['Tides/Spring/_附件/A title long enough to be cut - 图001 (2).png', 'Tides/Spring/_附件/A title long enough to be cut - 图001.png', 'Tides/Spring/_附件/Kept - 图001.png']);
	// The two pages swap places and page 1 changes its picture: the converter now gives page 2 the first name.
	// (The parser names a picture by its bytes' SHA-1, so a changed picture comes with another name.)
	const V2p: Version = {
		Spring: { pages: [page('l2', `${long} 2`, 'two', 1, [picture('p2.png')]), page('l1', `${long} 1`, 'one', 2, [picture('p1b.png')]), page('k', 'Kept', 'k', 1, [picture('k.png')])], assets: { 'p1b.png': 'CCC', 'p2.png': 'BBB', 'k.png': 'KKK' } },
	};
	await update(vault, V2p);
	const bytes = (path: string) => new TextDecoder().decode(vault.files.get(path) as Uint8Array);
	// Page 2 did not change: its picture is where it was, as it was.
	assert.match(textOf(vault, `Tides/Spring/${long} 2.md`)!, /_附件\/A title long enough to be cut - 图001 \(2\)\.png/);
	assert.equal(bytes('Tides/Spring/_附件/A title long enough to be cut - 图001 (2).png'), 'BBB');
	// Page 1's new picture takes a name no other page uses; its old one goes aside.
	const link = textOf(vault, `Tides/Spring/${long} 1.md`)!.match(/_附件\/([^>]+)>/)![1]!;
	assert.equal(bytes(`Tides/Spring/_附件/${link}`), 'CCC');
	assert.equal(bytes(`${BACKUP}/Tides/Spring/_附件/A title long enough to be cut - 图001.png`), 'AAA');
	assert.ok(!vault.files.has('Tides/Spring/_附件/A title long enough to be cut - 图001.png'));
	assert.equal(bytes('Tides/Spring/_附件/Kept - 图001.png'), 'KKK');
});

test('a section and a notebook not imported before are added; sections the download no longer has are left as they are', async () => {
	const V2: Version = { Spring: V1.Spring!, Autumn: { pages: [page('x', 'Leaves', 'fall')] } };
	const vault = await imported(V1);
	const summer = snapshot(vault, 'Tides/Summer');
	await update(vault, V2);
	assert.deepEqual(snapshot(vault, 'Tides/Summer'), summer);
	assert.match(textOf(vault, 'Tides/Autumn/Leaves.md')!, /fall/);
	const toc = textOf(vault, 'Tides/_目录.md')!;
	assert.match(toc, /- \[Autumn\]\(<Autumn\/_目录\.md>\)\n- \[Spring\]\(<Spring\/_目录\.md>\)\n- \[Summer\]\(<Summer\/_目录\.md>\)\n/);
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /下载中没有这些分区，仓库中的保持原样：Tides \/ Summer/);
	// Nothing was replaced (only a section added): the record does not point to previous versions.
	assert.doesNotMatch(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /更新前的版本在/);

	const other = memorySink();
	await update(other, V2);
	assert.deepEqual(snapshot(other), snapshot(await imported(V2)));
});

test('a step the vault refuses puts the section back as it was; the next section still goes in', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, second version', 2), page('c', 'Three', 'three'), page('d', 'Four', 'four')] },
		Summer: { pages: [page('s', 'Sun', 'see again', 2, [linkTo('a', 'One')])] },
	};
	const vault = await imported(V1);
	const spring = snapshot(vault, 'Tides/Spring');
	const writeText = vault.writeText;
	// The last step of Spring: its contents page saying it is complete, once its new page is written.
	let refused = false;
	vault.writeText = async (path, text, modified) => {
		if (!refused && path === 'Tides/Spring/_目录.md' && importStatusOf(text) === 'complete') {
			refused = true;
			throw new Error('the disk is full');
		}
		return writeText(path, text, modified);
	};
	const result = await update(vault, V2);
	vault.writeText = writeText;
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['rolled back', 'done']);
	assert.deepEqual(snapshot(vault, 'Tides/Spring'), spring);
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /see again/);
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /分区“Tides \/ Spring”未能更新，已恢复原状：the disk is full/);
	// What it wrote before it was refused went aside, not away.
	assert.match(textOf(vault, `${BACKUP}/_未完成/Tides/Spring/Four.md`)!, /four/);
});

test('a section that cannot be converted now is left as it was; the others go in', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, second version', 2), page('c', 'Three', 'three')] },
		Summer: { pages: [page('s', 'Sun', 'see again', 2)] },
	};
	const vault = await imported(V1);
	const spring = snapshot(vault, 'Tides/Spring');
	const h = host(vault, V2);
	const parse = h.parse;
	h.parse = async section => {
		if (section.label === 'Spring') throw new Error('PARSE_ERROR: invented failure');
		return parse(section);
	};
	const failing = await update(vault, V2, h);
	assert.deepEqual(failing!.outcomes.map(o => o.outcome), ['not converted', 'done']);
	assert.deepEqual(snapshot(vault, 'Tides/Spring'), spring);
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /分区“Tides \/ Spring”无法读取，保持原样：[^\n]*invented failure/);
	// Converting that stopped outside the parser (the worker, say) is the same.
	const other = await imported(V1);
	const h2 = host(other, V2);
	h2.convertSection = async () => {
		throw new Error('the worker stopped');
	};
	const stopped = await update(other, V2, h2);
	assert.deepEqual(stopped!.outcomes.map(o => o.outcome), ['not converted', 'not converted']);
	assert.deepEqual(snapshot(other, 'Tides/Spring'), spring);
});

test('sections whose names OneNote swapped, and a chain of renames, are all updated in one go', async () => {
	const from: Version = { Alpha: { pages: [page('a1', 'A page', 'a')] }, Beta: { pages: [page('b1', 'B page', 'b')] }, Gamma: { pages: [page('c1', 'C page', 'c')] } };
	// Alpha and Beta swap names; Gamma becomes Delta.
	const to: Version = { Beta: from.Alpha!, Alpha: from.Beta!, Delta: from.Gamma! };
	const vault = await imported(from);
	const result = await update(vault, to);
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['done', 'done', 'done']);
	const tocOf = (folder: string) => textOf(vault, `Tides/${folder}/_目录.md`);
	// Each section's pages are in a folder of its new name (one of the swapped two numbered, so neither waits for the other).
	const folderOf = (title: string) => [...vault.files.keys()].find(path => path.endsWith(`/${title}.md`))!.split('/').slice(1, -1).join('/');
	assert.match(folderOf('A page'), /^Beta( \(2\))?$/);
	assert.match(folderOf('B page'), /^Alpha( \(2\))?$/);
	assert.equal(folderOf('C page'), 'Delta');
	assert.match(tocOf(folderOf('A page'))!, /\n# Beta\n/);
	assert.equal(await update(vault, to), undefined);
});

test('a partial download keeps the sections it does not have in the notebook\'s contents page and report', async () => {
	const from: Version = { Spring: V1.Spring!, Summer: V1.Summer!, Winter: { pages: [page('e1', 'Snow', 'cold')] } };
	const vault = await imported(from);
	const only: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] } };
	const result = await updateNotebooks((await requests(only)).map(request => ({ ...request, partial: true })), host(vault, only), { at: AT, strings: zhHans, languageFor: () => 'zh-Hans', defaults: OPTIONS, links: true, sources: ['part.zip'] });
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['done']);
	const toc = textOf(vault, 'Tides/_目录.md')!;
	assert.match(toc, /\[Spring\]\(<Spring\/_目录\.md>\)/);
	assert.match(toc, /\[Summer\]\(<Summer\/_目录\.md>\)/);
	assert.match(toc, /\[Winter\]\(<Winter\/_目录\.md>\)/);
	const report = JSON.parse(textOf(vault, '_转换报告.json')!);
	assert.deepEqual(report.notebooks[0].sections.map((section: { section: string }) => section.section).sort(), ['Spring', 'Summer', 'Winter']);
	assert.doesNotMatch(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /新下载里没有/);
});

test('a section folder the user moved within the notebook is updated where it is', async () => {
	const vault = await imported(V1);
	await vault.move('Tides/Spring', 'Tides/Archive/Spring');
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	await update(vault, V2);
	assert.match(textOf(vault, 'Tides/Archive/Spring/One.md')!, /one, second version/);
	assert.ok(![...vault.files.keys()].some(path => path.startsWith('Tides/Spring/')));
});

test('a section imported before, moved out of the notebook folder, comes back only when chosen', async () => {
	const vault = await imported(V1);
	for (const path of [...vault.files.keys()].filter(path => path.startsWith('Tides/Summer/'))) vault.files.delete(path);
	// Not chosen: nothing to do. Chosen: imported again into its old place.
	assert.equal(await update(vault, V1, host(vault, V1), ['Spring']), undefined);
	const result = await update(vault, V1, host(vault, V1), ['Summer']);
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['done']);
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /\nsee\n/);
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.md')!, /重新导入分区“\[Summer\]/);
});

test('a section left unticked when its notebook was imported is "skipped" (not ticked again unasked), and written only when chosen', async () => {
	const vault = await imported(V1, section => section.label !== 'Summer');
	const [entry] = await reportedNotebooks(vault, zhHans);
	const recorded = recordedPlanOptions(entry, 'Tides');
	assert.deepEqual([...recorded.skipped!], [sectionKey([], 'Summer')]);
	const archive = await readArchive(vault, 'Tides', entry!.sections);
	const plan = planNotebook('Tides', (await requests(V1))[0]!.scanned, archive, zhHans, recorded);
	assert.deepEqual(plan.items.map(item => [item.label, item.status]), [['Spring', 'same'], ['Summer', 'skipped']]);
	assert.equal(await update(vault, V1, host(vault, V1), ['Spring']), undefined);
	const result = await update(vault, V1, host(vault, V1), ['Summer']);
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['done']);
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /\nsee\n/);
});

test('a copy the user made of a page (same page id) is left alone; the page is updated', async () => {
	const vault = await imported(V1);
	await vault.writeText('Tides/Spring/A copy of One.md', `${textOf(vault, 'Tides/Spring/One.md')}my copy\n`, new Date(9e12));
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	await update(vault, V2);
	assert.match(textOf(vault, 'Tides/Spring/One.md')!, /one, second version/);
	assert.match(textOf(vault, 'Tides/Spring/A copy of One.md')!, /my copy/);
	assert.match(textOf(vault, 'Tides/Spring/A copy of One.md')!, /one, first version/);
});

test('attachments: one a page that stays embeds with a wikilink, and one no page links to, are never written over', async () => {
	const pic: Version = { Spring: { pages: [page('a', 'One', 'one', 1, [picture('p.png')]), page('b', 'Two', 'two')], assets: { 'p.png': 'AAA' } } };
	const vault = await imported(pic);
	// The user embeds One's picture in Two with a wikilink, and drops a file of their own in the attachments folder.
	await vault.writeText('Tides/Spring/Two.md', `${textOf(vault, 'Tides/Spring/Two.md')}![[One - 图001.png]]\n`, vault.times.get('Tides/Spring/Two.md'));
	await vault.writeBinary('Tides/Spring/_附件/One - 图002.png', new TextEncoder().encode('MINE'));
	const changed: Version = { Spring: { pages: [page('a', 'One', 'one', 2, [picture('p.png'), picture('q.png')]), page('b', 'Two', 'two')], assets: { 'p.png': 'CCC', 'q.png': 'DDD' } } };
	await update(vault, changed);
	const bytes = (path: string) => new TextDecoder().decode(vault.files.get(path) as Uint8Array);
	assert.equal(bytes('Tides/Spring/_附件/One - 图001.png'), 'AAA');
	assert.equal(bytes('Tides/Spring/_附件/One - 图002.png'), 'MINE');
	const links = [...textOf(vault, 'Tides/Spring/One.md')!.matchAll(/_附件\/([^>]+)>/g)].map(match => bytes(`Tides/Spring/_附件/${match[1]}`));
	assert.deepEqual(links, ['CCC', 'DDD']);
});

test('a page retitled in case only, with a numbered file name, keeps its file', async () => {
	const twins: Version = { Spring: { pages: [page('a', 'Plan', 'first'), page('b', 'Plan', 'second')] } };
	const vault = await imported(twins);
	assert.ok(vault.files.has('Tides/Spring/Plan (2).md'));
	await update(vault, { Spring: { pages: [page('a', 'Plan', 'first'), page('b', 'plan', 'second, again', 2)] } });
	assert.match(textOf(vault, 'Tides/Spring/Plan (2).md')!, /second, again/);
	assert.ok(![...vault.files.keys()].some(path => /\/plan \(2\)\.md$/.test(path)));
	assert.match(textOf(vault, 'Tides/Spring/_目录.md')!, /\(<Plan \(2\)\.md>\)/);
});

test('a section moved into a section group of its own name gets there', async () => {
	const vault = await imported(V1);
	const to: Version = { 'Spring/Spring': V1.Spring!, Summer: V1.Summer! };
	const result = await update(vault, to);
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['done']);
	assert.match(textOf(vault, 'Tides/Spring/Spring/One.md')!, /one, first version/);
	assert.ok(![...vault.files.keys()].some(path => path.includes('onenote-ferry')));
});

test('links (§11.5 item 52.1): leftover OneNote links are resolved only in the sections updated now; elsewhere only links a move broke are fixed', async () => {
	// Pages in Winter and in Old link to page e1, which only the new download has (in Spring).
	const from: Version = {
		Spring: { pages: [page('a', 'One', 'one')] },
		Winter: { pages: [page('f1', 'Snow', 'cold', 1, [linkTo('e1', 'Later')])] },
		Old: { pages: [page('f2', 'Dust', 'old', 1, [linkTo('e1', 'Later')])] },
		Summer: { pages: [page('b1', 'Sun', 'see', 1, [linkTo('a', 'One')])] },
	};
	const vault = await imported(from);
	const winter = textOf(vault, 'Tides/Winter/Snow.md'), old = textOf(vault, 'Tides/Old/Dust.md');
	assert.match(winter!, /onenote:/);
	// Spring gets page e1 and is renamed; Winter changed too but is not chosen; Old is not in the download.
	const to: Version = {
		'Spring 2': { pages: [page('a', 'One', 'one'), page('e1', 'Later', 'later')] },
		Winter: { pages: [page('f1', 'Snow', 'colder', 2, [linkTo('e1', 'Later')])] },
		Summer: from.Summer!,
	};
	await update(vault, to, host(vault, to), ['Spring 2']);
	assert.equal(textOf(vault, 'Tides/Winter/Snow.md'), winter);
	assert.equal(textOf(vault, 'Tides/Old/Dust.md'), old);
	// Summer was not updated, but its link to One was broken by the rename: fixed, to the same page.
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /\]\(<\.\.\/Spring 2\/One\.md>\)/);
});

test('a page the vault never lets the update write (read-only): the section is put back as far as it can be, the journal closes, the rest goes on', async () => {
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] },
		Summer: { pages: [page('s', 'Sun', 'see again', 2, [linkTo('a', 'One')])] },
	};
	const vault = await imported(V1);
	const one = textOf(vault, 'Tides/Spring/One.md');
	const writeText = vault.writeText;
	vault.writeText = async (path, text, modified) => {
		if (path === 'Tides/Spring/One.md') throw new Error('EACCES: permission denied');
		return writeText(path, text, modified);
	};
	const result = await update(vault, V2);
	assert.deepEqual(result!.outcomes.map(o => o.outcome), ['rolled back', 'done']);
	assert.equal(textOf(vault, 'Tides/Spring/One.md'), one);
	assert.notEqual(importStatusOf(textOf(vault, 'Tides/Spring/_目录.md')), 'syncing');
	assert.match(textOf(vault, '_更新记录/2026-12-01 1430.jsonl')!, /\{"t":"end"\}\n$/);
	assert.match(textOf(vault, 'Tides/Summer/Sun.md')!, /see again/);
	// The next run does not stumble over it.
	vault.writeText = writeText;
	assert.deepEqual((await resumeUpdates(host(vault, V2))).finished, []);
});

test('a page OneNote did not change, edited by the user while an update was cut off: finishing keeps the edit, only its place changes', async () => {
	const to: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('e1', 'New', 'new'), page('b', 'Two', 'two'), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	const probe = crashing(await imported(V1), Infinity);
	await update(probe, to);
	for (let after = 0; after < probe.writes(); after++) {
		for (const keep of [true, false]) {
			const vault = await imported(V1);
			const stagings = new Map<string, MemorySink>();
			const cut = crashing(vault, after);
			await update(cut, to, host(cut, to, stagings)).catch(() => undefined);
			if (!keep) stagings.clear();
			await vault.writeText('Tides/Spring/Three.md', `${textOf(vault, 'Tides/Spring/Three.md')}WRITTEN AFTER THE CUT\n`, new Date(8e12));
			await resumeUpdates(host(vault, to, stagings));
			const three = textOf(vault, 'Tides/Spring/Three.md')!;
			assert.match(three, /WRITTEN AFTER THE CUT/, `after ${after}, staging ${keep ? 'kept' : 'gone'}`);
		}
	}
});

test('a section folder the user moved keeps its record: OneNote moving it to another group is followed, and the report keeps its pages', async () => {
	const from: Version = { Spring: V1.Spring!, Winter: { pages: [page('e1', 'Snow', 'cold'), page('e2', 'Ice', 'colder')] } };
	const vault = await imported(from);
	await vault.move('Tides/Winter', 'Tides/Archive/Winter');
	// Another section changes: the report is written again, and must keep Winter's pages, where Winter is now.
	const changed: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] }, Winter: from.Winter! };
	await update(vault, changed);
	const winter = JSON.parse(textOf(vault, '_转换报告.json')!).notebooks[0].sections.find((section: { section: string }) => section.section === 'Winter');
	assert.equal(winter.dir, 'Tides/Archive/Winter');
	assert.equal(winter.report.pageCount, 2);
	// OneNote then moves Winter into a group Old: followed (§11.5 item 52.2).
	const regrouped: Version = { Spring: changed.Spring!, 'Old/Winter': from.Winter! };
	const later = await updateNotebooks(await requests(regrouped), host(vault, regrouped), { at: new Date(2026, 11, 2, 9, 0), strings: zhHans, languageFor: () => 'zh-Hans', defaults: OPTIONS, links: true, sources: ['new.zip'] });
	assert.deepEqual(later!.outcomes.map(o => o.outcome), ['done']);
	assert.match(textOf(vault, 'Tides/Old/Winter/Snow.md')!, /cold/);
});

test('pages the user deleted in a section folder they moved are still told by page id', async () => {
	const vault = await imported(V1);
	await vault.move('Tides/Spring', 'Tides/Archive/Spring');
	vault.files.delete('Tides/Archive/Spring/Two.md');
	// OneNote retitles the deleted page: by id it is still the page the user deleted, not a new one.
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, first version'), page('b', 'Two renamed', 'two', 2), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	assert.equal(await update(vault, V2), undefined);
	assert.ok(![...vault.files.keys()].some(path => path.endsWith('/Two renamed.md')));
});

test('a section imported before and not found now stays so after another section is updated (§11.5 item 52.3)', async () => {
	const vault = await imported(V1);
	for (const path of [...vault.files.keys()].filter(path => path.startsWith('Tides/Summer/'))) vault.files.delete(path);
	const V2: Version = { Spring: { pages: [page('a', 'One', 'one, second version', 2), page('b', 'Two', 'two'), page('c', 'Three', 'three')] }, Summer: V1.Summer! };
	await update(vault, V2, host(vault, V2), ['Spring']);
	const report = JSON.parse(textOf(vault, '_转换报告.json')!);
	const { imported: known } = recordedPlanOptions(report.notebooks[0], 'Tides');
	assert.ok(known!.has('Summer'));
	assert.ok(!vault.files.has('Tides/Summer/Sun.md'));
});

test('links go to the page its contents page lists, not to a copy the user made of it; the copy is not changed', async () => {
	const vault = await imported(V1);
	// Obsidian's "Make a copy" names it so, and it sorts before the page.
	const copy = `${textOf(vault, 'Tides/Spring/One.md')}[later](onenote:https://x.example/Tides/X.one#t&section-id={DDDDDDDD-0000-0000-0000-000000000001}&page-id=${id('e1')}&end)\n`;
	await vault.writeText('Tides/Spring/One 1.md', copy, new Date(9e12));
	const V2: Version = {
		Spring: { pages: [page('a', 'One', 'one, first version'), page('b', 'Two', 'two, now with a link', 2, [linkTo('a', 'One')]), page('c', 'Three', 'three'), page('e1', 'Later', 'later')] },
		Summer: V1.Summer!,
	};
	await update(vault, V2);
	assert.match(textOf(vault, 'Tides/Spring/Two.md')!, /\]\(<One\.md>\)/);
	assert.equal(textOf(vault, 'Tides/Spring/One 1.md'), copy);
});

/**
 * A vault that stops working after `after` writes, as when Obsidian quits or the machine stops.
 * `torn`: the write it stops in is left half done (a file with only the first half of what was
 * being written, as a power cut leaves a plain write), instead of not done at all.
 */
function crashing(vault: MemorySink, after: number, torn: boolean | 'empty' = false): MemorySink & { writes(): number } {
	let writes = 0;
	const wrapped: MemorySink & { writes(): number } = { ...vault, writes: () => writes };
	const dead = () => {
		if (writes > after) throw new Error('stopped');
	};
	// 'empty': cut off right after the file was emptied, before anything was written into it.
	const half = (value: string | Uint8Array) => value.slice(0, torn === 'empty' ? 0 : Math.floor(value.length / 2));
	const tear: Record<string, (...args: never[]) => void> = {
		writeText: (path: string, text: string) => vault.files.set(path, half(text)),
		writeBinary: (path: string, bytes: Uint8Array) => vault.files.set(path, half(bytes)),
		copy: (from: string, to: string) => vault.files.set(to, half(vault.files.get(from) ?? '')),
		appendText: (path: string, text: string) => vault.files.set(path, `${(vault.files.get(path) as string | undefined) ?? ''}${half(text)}`),
	};
	for (const name of ['writeText', 'writeBinary', 'move', 'copy', 'appendText', 'ensureFolder'] as const) {
		const original = vault[name] as (...args: unknown[]) => Promise<void>;
		(wrapped as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
			writes++;
			if (torn && writes === after + 1 && tear[name]) (tear[name] as (...a: unknown[]) => void)(...args);
			dead();
			return original(...args);
		};
	}
	for (const name of ['readText', 'readBinary', 'listFiles', 'stat', 'exists'] as const) {
		const original = vault[name] as (...args: unknown[]) => Promise<unknown>;
		(wrapped as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
			dead();
			return original(...args);
		};
	}
	return wrapped;
}

const V2_CUT: Version = {
	'Spring 2': { pages: [page('a', 'Two', 'one, second version', 2), page('b', 'One', 'two', 2), page('c', 'Three', 'three'), page('d', 'Four', 'four', 1, [picture('d.png')])], assets: { 'd.png': 'DDD' } },
	Summer: { pages: [page('s', 'Sun', 'see again', 2, [linkTo('a', 'One'), linkTo('d', 'Four')])] },
};

/**
 * Cuts an update from `from` to `to` off after each of its writes in turn, then opens the vault
 * again (resumeUpdates, with or without the staging) and checks for updates again: each section
 * is all old or all new in between, and the end is what the update gives when it is not cut off.
 */
async function cutEverywhere(from: Version, to: Version, keep: boolean, sections: [string, string, string][], torn: boolean | 'empty' = false, prepare?: (vault: MemorySink) => Promise<void>) {
	const start = async () => {
		const vault = await imported(from);
		await prepare?.(vault);
		return vault;
	};
	const whole = await start();
	const probe = crashing(whole, Infinity);
	await update(probe, to);
	const total = probe.writes();
	const expected = snapshot(whole);
	const original = snapshot(await start());
	const inFolder = (all: Record<string, [string, number]>, folder: string) => Object.fromEntries(Object.entries(all).filter(([path]) => path.startsWith(`Tides/${folder}/`)));
	// Pages that stay may have their links made to follow a section that moved: that is part of that section's update.
	const unlinked = (all: Record<string, [string, number]>) => JSON.parse(JSON.stringify(all).replace(/\]\(<[^>]*>\)/g, ''));
	for (let after = 0; after < total; after++) {
		const vault = await start();
		const stagings = new Map<string, MemorySink>();
		const cut = crashing(vault, after, torn);
		await update(cut, to, host(cut, to, stagings)).catch(() => undefined);
		if (!keep) stagings.clear();
		await resumeUpdates(host(vault, to, stagings));
		const now = snapshot(vault);
		for (const [name, oldFolder, newFolder] of sections) {
			const wasThere = isDeepStrictEqual(unlinked(inFolder(now, oldFolder)), unlinked(inFolder(original, oldFolder))) && (oldFolder === newFolder || !Object.keys(inFolder(now, newFolder)).length);
			const isNew = isDeepStrictEqual(inFolder(now, newFolder), inFolder(expected, newFolder)) && (oldFolder === newFolder || !Object.keys(inFolder(now, oldFolder)).length);
			assert.ok(wasThere || isNew, `${name} after ${after}`);
		}
		for (const [path, value] of Object.entries(now)) if (path.endsWith('_目录.md')) assert.notEqual(importStatusOf(value[0]), 'syncing', `${path} after ${after}`);
		// Every copy kept of a file the update replaced is whole: what it was before the update.
		for (const [path, value] of vault.files) {
			if (!path.startsWith(`${BACKUP}/Tides/`)) continue;
			const was = original[path.slice(BACKUP.length + 1)];
			if (was) assert.equal(typeof value === 'string' ? value : `bytes:${new TextDecoder().decode(value)}`, was[0], `${path} after ${after}`);
		}
		// The journal is closed (or cut off in its first line, when nothing was done); checking again finishes what is left.
		const started = (journal: string) => journal.split('\n').some(line => line.startsWith('{"t":"start"') && line.endsWith('}'));
		assert.ok([...vault.files].every(([path, value]) => !path.endsWith('.jsonl') || (value as string).endsWith('{"t":"end"}\n') || !started(value as string)), `journal after ${after}`);
		await update(vault, to);
		assert.deepEqual(snapshot(vault), expected, `after ${after}`);
	}
	return total;
}

for (const keep of [true, false]) {
	const staging = keep ? 'its staging still there' : 'its staging gone';
	test(`an update cut off at any step, ${staging}: each section is all old or all new, and checking again gives the full update`, async () => {
		const steps = await cutEverywhere(V1, V2_CUT, keep, [['Spring', 'Spring', 'Spring 2'], ['Summer', 'Summer', 'Summer']]);
		assert.ok(steps > 30);
	});
	test(`an update cut off while it fixes links, ${staging}: a page that stays, in a section moved into a group, gets its links right once`, async () => {
		const from: Version = { Spring: { pages: [page('a1', 'One', 'one', 1, [linkTo('b1', 'Sun')])] }, Summer: { pages: [page('b1', 'Sun', 'see')] } };
		const to: Version = { 'Group/Spring': from.Spring!, Summer: from.Summer! };
		await cutEverywhere(from, to, keep, [['Spring', 'Spring', 'Group/Spring']]);
		const vault = await imported(from);
		await update(vault, to);
		assert.match(textOf(vault, 'Tides/Group/Spring/One.md')!, /\]\(<\.\.\/\.\.\/Summer\/Sun\.md>\)/);
	});
	// A plain write cut off part way leaves half a file (a power cut, Obsidian quitting): no step may
	// then take that half for the whole, nor build on it.
	test(`an update cut off in the middle of any write, ${staging}: each section all old or all new, and checking again gives the full update`, async () => {
		await cutEverywhere(V1, V2_CUT, keep, [['Spring', 'Spring', 'Spring 2'], ['Summer', 'Summer', 'Summer']], true);
		const from: Version = { Spring: { pages: [page('a1', 'One', 'one', 1, [linkTo('b1', 'Sun')])] }, Summer: { pages: [page('b1', 'Sun', 'see')] } };
		await cutEverywhere(from, { 'Group/Spring': from.Spring!, Summer: from.Summer! }, keep, [['Spring', 'Spring', 'Group/Spring']], true);
	});
	test(`an update cut off right after any file was emptied for writing, ${staging}: the same (a notebook's contents page left empty included)`, async () => {
		await cutEverywhere(V1, V2_CUT, keep, [['Spring', 'Spring', 'Spring 2'], ['Summer', 'Summer', 'Summer']], 'empty');
	});
	test(`a page the user edited that only moves, cut off in the middle of any write, ${staging}: the user's words are never lost`, async () => {
		const to: Version = { Spring: { pages: [page('e1', 'New', 'new'), ...V1.Spring!.pages] }, Summer: V1.Summer! };
		const edit = async (vault: MemorySink) => {
			await vault.writeText('Tides/Spring/Three.md', `${textOf(vault, 'Tides/Spring/Three.md')}MY OWN WORDS\n`, new Date(9e12));
		};
		await cutEverywhere(V1, to, keep, [['Spring', 'Spring', 'Spring']], true, edit);
	});
	test(`the user edits a page after an update was cut off, ${staging}: finishing or putting it back keeps the edit`, async () => {
		const probe = crashing(await imported(V1), Infinity);
		await update(probe, V2_CUT);
		for (let after = 0; after < probe.writes(); after++) {
			const vault = await imported(V1);
			const stagings = new Map<string, MemorySink>();
			const cut = crashing(vault, after);
			await update(cut, V2_CUT, host(cut, V2_CUT, stagings)).catch(() => undefined);
			if (!keep) stagings.clear();
			// Whichever file page a has now, the user writes in it.
			const path = ['Tides/Spring 2/Two.md', 'Tides/Spring 2/One (onenote-ferry).md', 'Tides/Spring 2/One.md', 'Tides/Spring/One.md'].find(candidate => /onenote-id: "\{0000000a-/.test(textOf(vault, candidate) ?? ''))!;
			await vault.writeText(path, `${textOf(vault, path)}WRITTEN WHILE CUT OFF\n`, new Date(8e12));
			await resumeUpdates(host(vault, V2_CUT, stagings));
			assert.ok([...vault.files.values()].some(value => typeof value === 'string' && value.includes('WRITTEN WHILE CUT OFF')), `after ${after}`);
		}
	});
}

for (const torn of [false, true]) test(`putting a section back, itself cut off at any step${torn ? ' in the middle of a write' : ''}, goes on the next time: all old in the end`, async () => {
	const probe = crashing(await imported(V1), Infinity);
	await update(probe, V2_CUT);
	const original = snapshot(await imported(V1));
	const inSpring = (all: Record<string, [string, number]>) => Object.fromEntries(Object.entries(all).filter(([path]) => path.startsWith('Tides/Spring/') || path.startsWith('Tides/Spring 2/')));
	const unlinked = (all: Record<string, [string, number]>) => JSON.parse(JSON.stringify(all).replace(/\]\(<[^>]*>\)/g, ''));
	let rounds = 0;
	for (let after = 4; after < probe.writes(); after += 3) {
		// Cut off with the staging gone, so that the next run puts the section back; then that is cut off at each of its writes.
		const first = await imported(V1);
		const cut = crashing(first, after, torn);
		await update(cut, V2_CUT, host(cut, V2_CUT)).catch(() => undefined);
		const replay = crashing(first, Infinity);
		await resumeUpdates(host(replay, V2_CUT));
		for (let again = 0; again < replay.writes(); again++) {
			const vault = await imported(V1);
			const cutFirst = crashing(vault, after, torn);
			await update(cutFirst, V2_CUT, host(cutFirst, V2_CUT)).catch(() => undefined);
			const cutAgain = crashing(vault, again, torn);
			await resumeUpdates(host(cutAgain, V2_CUT)).catch(() => undefined);
			await resumeUpdates(host(vault, V2_CUT));
			const now = snapshot(vault);
			const springNow = inSpring(now);
			const done = Object.keys(springNow).some(path => path.startsWith('Tides/Spring 2/'));
			if (!done) assert.deepEqual(unlinked(springNow), unlinked(inSpring(original)), `after ${after}, then ${again}`);
			for (const [path, value] of Object.entries(now)) if (path.endsWith('_目录.md')) assert.notEqual(importStatusOf(value[0]), 'syncing', `${path} after ${after}, then ${again}`);
			rounds++;
		}
	}
	assert.ok(rounds > 20);
});

// The journal is a file in the vault: changed by hand, by a sync tool, or in a vault from someone
// else, it must not make an update touch anything outside the notebook it was about and the
// update's own folders, let alone outside the output folder.
test('a journal changed to point anywhere else is not followed: nothing is written', async () => {
	const tamperings: [string, (journal: string) => string][] = [
		['a step moving a page out of the output folder', journal => journal.replace(/"to":"_旧版本\/2026-12-01 1430\/Tides\/Spring\/_目录\.md"/, '"to":"../outside.md"')],
		['an absolute path', journal => journal.replace(/"from":"Tides\/Spring\/_目录\.md"/, '"from":"/etc/hosts"')],
		['a step writing into another folder of the vault', journal => journal.replace(/"path":"Tides\/Spring 2\/One\.md"/, '"path":"My own notes/One.md"')],
		['previous versions put outside', journal => journal.replace('"backup":"_旧版本/2026-12-01 1430"', '"backup":"../away"')],
		['a staged file outside the staging', journal => journal.replace(/"staged":"Tides\/Spring 2\/One\.md"/, '"staged":"../../One.md"')],
		['a notebook folder that is not the one an import gives that notebook', journal => journal.replace('"dir":"Tides"', '"dir":"My own notes"')],
		['a backslash', journal => journal.replace(/"to":"_旧版本\/2026-12-01 1430\/Tides\/Spring\/_目录\.md"/, '"to":"_旧版本\\\\..\\\\x.md"')],
	];
	for (const [what, tamper] of tamperings) {
		const vault = await imported(V1);
		await vault.writeText('My own notes/One.md', 'mine', new Date(7));
		const stagings = new Map<string, MemorySink>();
		const cut = crashing(vault, 6);
		await update(cut, V2_CUT, host(cut, V2_CUT, stagings)).catch(() => undefined);
		const path = '_更新记录/2026-12-01 1430.jsonl';
		const journal = textOf(vault, path)!;
		const changed = tamper(journal);
		assert.notEqual(changed, journal, what);
		await vault.writeText(path, changed);
		const before = snapshot(vault, '');
		const keys = [...vault.files.keys()].sort();
		await resumeUpdates(host(vault, V2_CUT, stagings));
		assert.deepEqual([...vault.files.keys()].sort(), keys, what);
		assert.deepEqual(snapshot(vault, ''), before, what);
	}
});

test('nothing is ever deleted: every file the vault had is still there, or set aside with what it held', async () => {
	const vault = await imported(V1);
	await vault.writeText('Tides/Spring/My notes.md', 'mine');
	const before = new Map(vault.files);
	await update(vault, V2_CUT);
	// Pages that only moved have their place properties brought up to date (§11.5 item 50): the rest is what it was.
	const held = (value: string | Uint8Array) => (typeof value === 'string' ? value : new TextDecoder().decode(value)).replace(/^onenote-(section|order|level): .*$/gm, '');
	const now = [...vault.files.values()].map(held);
	for (const [path, value] of before) {
		if (/_转换报告\.(md|json)$|\/_目录\.md$/.test(path)) continue;
		assert.ok(now.includes(held(value)), path);
	}
});
