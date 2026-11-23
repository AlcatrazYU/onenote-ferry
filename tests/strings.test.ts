import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, STRINGS, zhHans, isLanguage } from '../src/core/strings.ts';
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
	texts.tocTitle = s.tocTitle('Sample notebook');
	return texts;
}
const STRUCTURE = ['attachmentsFolder', 'tocFileName', 'oldVersionsFolder', 'updateLogFolder', 'reportFileName'] as const;

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
		assert.ok(s.reportFileName.endsWith('.json'), language);
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
		[zhHans.attachmentsFolder, zhHans.tocFileName, zhHans.oldVersionsFolder, zhHans.updateLogFolder, zhHans.reportFileName, zhHans.imageWord, zhHans.inkWord, zhHans.untitledPage, zhHans.unnamedFile, zhHans.conflictPageSuffix, zhHans.conversionFailedSuffix],
		['_附件', '_目录', '_旧版本', '_更新记录', '_转换报告.json', '图', '手写', '无标题', '未命名文件', '（冲突版本）', '（转换失败）'],
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
	assert.match(sink.files.get('NB/Section/_contents.md') as string, /^---\ntitle: "Section contents"\n---\n\n# Section\n/);
});
