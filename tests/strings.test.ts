import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, STRINGS, zhHans, isLanguage, markerLanguageFor } from '../src/core/strings.ts';
import type { Strings } from '../src/core/strings.ts';
import { safeName } from '../src/core/names.ts';
import { Adapter } from '../src/core/adapter.ts';
import { writeSection } from '../src/core/write.ts';
import { asset, element, memorySink, memorySource, outline, pageJson, rich, run, sectionJson } from './helpers.ts';

/** Every inserted text of one language, with sample arguments. */
function allTexts(s: Strings): Record<string, string> {
	const texts: Record<string, string> = {};
	for (const [key, value] of Object.entries(s)) {
		if (typeof value === 'string') texts[key] = value;
	}
	texts.boxMarker = s.boxMarker(2, 12, '22.2', '3.7');
	texts.missingAttachment = s.missingAttachment('Sample.pdf');
	texts.conversionFailedNote = s.conversionFailedNote('PARSE_ERROR: sample');
	texts.missingImage = s.missingImages(1, ['Sample.png']);
	texts.missingUnnamedImage = s.missingImages(1, []);
	texts.missingImages = s.missingImages(3, ['a.png', 'b.png']);
	texts.missingPrintoutPage = s.missingPrintoutPages('Sample.pdf', 4, 4);
	texts.missingPrintoutPages = s.missingPrintoutPages('Sample.pdf', 1, 13);
	texts.tocTitle = s.tocTitle('Sample notebook');
	const r = s.report;
	for (const [key, value] of Object.entries(r)) {
		if (typeof value === 'string') texts[`report.${key}`] = value;
	}
	r.columns.forEach((column, i) => texts[`report.columns.${i}`] = column);
	texts['report.time'] = r.time('2026-11-24 21:05');
	texts['report.source'] = r.source(['Sample A.zip', 'Sample B.zip']);
	texts['report.totals'] = r.totals(3, 37, 1700, 2345);
	texts['report.totalsOne'] = r.totals(1, 1, 1, 1);
	texts['report.notConverted'] = r.notConverted(2);
	texts['report.links'] = r.links(120, 3);
	texts['report.linksAll'] = r.links(120, 0);
	texts['report.cancelled'] = r.cancelled(5);
	texts['report.sectionNotConverted'] = r.sectionNotConverted('Sample section', s.passwordProtected);
	texts['report.sectionsCancelled'] = r.sectionsCancelled(4);
	texts['report.sectionCancelled'] = r.sectionsCancelled(1);
	texts['report.notStarted'] = r.notStarted(['Sample A', 'Sample B']);
	texts['report.missingItems'] = r.missingItems(2);
	return texts;
}
const STRUCTURE = ['attachmentsFolder', 'tocFileName', 'oldVersionsFolder', 'updateLogFolder', 'reportName'] as const;

test('five languages, each complete and non-empty', () => {
	assert.deepEqual([...LANGUAGES], ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko']);
	const keys = Object.keys(allTexts(zhHans)).sort();
	for (const language of LANGUAGES) {
		const texts = allTexts(STRINGS[language]);
		assert.deepEqual(Object.keys(texts).sort(), keys, language);
		for (const [key, text] of Object.entries(texts)) assert.ok(text.trim() !== '', `${language}.${key}`);
	}
	assert.ok(isLanguage('ja'));
	assert.ok(!isLanguage('fr'));
});

test('no dash characters in any language', () => {
	for (const language of LANGUAGES) {
		for (const [key, text] of Object.entries(allTexts(STRINGS[language]))) {
			assert.ok(!/[\u2013\u2014\u2015]/.test(text), `${language}.${key}: ${text}`);
		}
	}
});

test('structure names are valid, distinct file names that sort first', () => {
	for (const language of LANGUAGES) {
		const s = STRINGS[language];
		const names = STRUCTURE.map(key => s[key]);
		for (const name of names) {
			assert.ok(name.startsWith('_'), `${language}: ${name}`);
			assert.equal(safeName(name, 'x', 200), name, `${language}: ${name}`);
		}
		assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, language);
		assert.ok(!/\.[a-z]+$/i.test(s.reportName), `${language}: the report name has no extension`);
		for (const word of [s.imageWord, s.inkWord, s.untitledPage, s.unnamedFile]) assert.equal(safeName(word, 'x'), word, `${language}: ${word}`);
	}
});

test('position comments are valid HTML comments that carry the numbers', () => {
	for (const language of LANGUAGES) {
		const marker = STRINGS[language].boxMarker(2, 12, '22.2', '3.7');
		assert.ok(marker.startsWith('<!-- ') && marker.endsWith(' -->'), `${language}: ${marker}`);
		assert.ok(!marker.slice(4, -3).includes('--'), `${language}: ${marker}`);
		for (const value of ['2', '12', '22.2', '3.7']) assert.ok(marker.includes(value), `${language}: ${marker}`);
	}
});

test('notices and titles include what they are about', () => {
	for (const language of LANGUAGES) {
		const s = STRINGS[language];
		assert.ok(s.missingAttachment('Sample.pdf').includes('Sample.pdf'), language);
		assert.ok(s.tocTitle('Sample notebook').includes('Sample notebook'), language);
		assert.ok(s.sectionOrderNote.startsWith('> '), language);
	}
});

test('the Simplified Chinese column is the one the existing output uses', () => {
	assert.equal(zhHans.boxMarker(2, 12, '22.2', '3.7'), '<!-- 第2块（共12块） 页面位置：左 22.2 cm，上 3.7 cm -->');
	assert.equal(zhHans.missingAttachment('a.pdf'), '〔附件缺失：a.pdf（OneDrive 下载包里没有这个文件的数据）〕');
	assert.equal(zhHans.tocTitle('X'), 'X 目录');
	assert.equal(zhHans.sectionOrderNote, '> 分区按名称排序（OneDrive 下载的文件里没有 OneNote 中的分区顺序）。');
	assert.deepEqual(
		[zhHans.attachmentsFolder, zhHans.tocFileName, zhHans.oldVersionsFolder, zhHans.updateLogFolder, zhHans.reportName, zhHans.imageWord, zhHans.inkWord, zhHans.untitledPage, zhHans.unnamedFile, zhHans.conflictPageSuffix, zhHans.conversionFailedSuffix],
		['_附件', '_目录', '_旧版本', '_更新记录', '_转换报告', '图', '手写', '无标题', '未命名文件', '（冲突版本）', '（转换失败）'],
	);
});

test('a section written in English uses English folder names and marks', async () => {
	const strings = STRINGS.en;
	const image = { type: 'image', asset: asset('i.png'), fileName: null, x: 10, y: 0, w: 5 };
	const missing = { type: 'file', asset: null, fileName: 'gone.pdf', x: null, y: null, w: null };
	const pages = [pageJson('Plan', [
		outline([element([rich([run('left')])]), element([missing])], { x: 0, y: 0, w: 5 }),
		outline([element([image])], { x: 10, y: 0, w: 5 }),
	])];
	const sink = memorySink();
	const section = new Adapter(strings).section(sectionJson('Section', pages));
	await writeSection(section, memorySource({ 'i.png': 'PNG' }), sink, { dir: 'NB/Section', label: 'Section', strings, boxMarkers: true, keepFontColor: true });
	assert.deepEqual([...sink.files.keys()].sort(), ['NB/Section/Plan.md', 'NB/Section/_attachments/Plan - image001.png', 'NB/Section/_contents.md']);
	assert.equal((sink.files.get('NB/Section/Plan.md') as string).split('---\n\n')[1], [
		'<!-- Box 1 of 2, position on page: left 0.0 cm, top 0.0 cm -->',
		'left',
		'*\\[Missing attachment: gone.pdf. The OneDrive download has no data for this file.\\]*',
		'<!-- Box 2 of 2, position on page: left 12.7 cm, top 0.0 cm -->',
		'![](<_attachments/Plan - image001.png>)',
		'',
	].join('\n\n').replace(/\n\n$/, '\n'));
	assert.match(sink.files.get('NB/Section/_contents.md') as string, /^---\ntitle: "Section contents"\nonenote-import: complete\n---\n\n# Section\n/);
});

test('marks follow the reader\'s interface language', () => {
	const cases: [string | undefined, string][] = [
		['zh', 'zh-Hans'], ['zh-CN', 'zh-Hans'], ['zh_CN.UTF-8', 'zh-Hans'], ['zh-Hans-CN', 'zh-Hans'],
		['zh-TW', 'zh-Hant'], ['zh_HK.UTF-8', 'zh-Hant'], ['zh-Hant-TW', 'zh-Hant'],
		['ja', 'ja'], ['ja_JP.UTF-8', 'ja'], ['ko', 'ko'], ['ko-KR', 'ko'],
		['en', 'en'], ['de', 'en'], ['', 'en'], [undefined, 'en'],
		// Other languages that start with the same letters, and other Chinese languages.
		['kok_IN.UTF-8', 'en'], ['jam', 'en'], ['zh_SG.UTF-8', 'zh-Hans'], ['yue_HK.UTF-8', 'zh-Hant'], ['yue-Hant-HK', 'zh-Hant'],
		['yue-Hans-CN', 'zh-Hans'], ['nan_TW', 'zh-Hant'], ['lzh_TW', 'zh-Hant'], ['sr_RS@latin', 'en'], ['C', 'en'], ['POSIX', 'en'],
	];
	for (const [locale, language] of cases) assert.equal(markerLanguageFor(locale), language, String(locale));
});
