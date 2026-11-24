// Telling a notebook's language from its text. All texts are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCounts, countSection, countText, detectLanguage, emptyCounts } from '../src/core/language.ts';
import { element, outline, pageJson, rich, run, sectionJson } from './helpers.ts';

const detect = (text: string) => {
	const counts = emptyCounts();
	countText(text, counts);
	return detectLanguage(counts);
};

test('each language by its letters', () => {
	assert.equal(detect('渡口的时刻表这里记录了每天开船的时间和码头的位置，还有船票的价格。'), 'zh-Hans');
	assert.equal(detect('渡口的時刻表這裡記錄了每天開船的時間和碼頭的位置，還有船票的價格。'), 'zh-Hant');
	assert.equal(detect('渡し場の時刻表です。毎日の出航時間と桟橋の場所を書いておきます。'), 'ja');
	assert.equal(detect('나루터 시간표입니다. 매일 배가 떠나는 시간과 부두 위치를 적어 둡니다.'), 'ko');
	assert.equal(detect('Ferry timetable: departure times and the pier for every day of the week.'), 'en');
});

test('too little text to tell', () => {
	assert.equal(detect('OK 好'), undefined);
});

test('a Chinese note quoting a little Japanese stays Chinese; links do not count as English', () => {
	const chinese = '这本笔记整理了江户时代学者的研究，下面引用一句原文作为例子，然后继续用中文讨论它的意义和背景。'.repeat(3);
	assert.equal(detect(chinese + '「学問の道は」'), 'zh-Hans');
	assert.equal(detect('渡口﷟HYPERLINK "https://example.com/a-very-long-english-looking-address/with/many/letters"时刻表'), undefined);
});

test('a link split across runs does not count as English; Japanese paragraphs do not tip simplified against traditional', () => {
	const link = sectionJson('S', [pageJson('', [outline([element([rich([run('\uFDDF'), run('HYPERLINK "https://example.com/a-very-long-english-looking-address/with/many/letters"'), run('渡口时刻表')])])])])]);
	assert.equal(countSection(link).latin, 0);
	const japanese = emptyCounts();
	countText('本研究の問題設定は、近世東アジアにおける経書解釈の変遷を記録資料から再検討する点にある。', japanese);
	assert.deepEqual([japanese.simplified, japanese.traditional], [0, 0]);
	const chinese = emptyCounts();
	countText('这里记录了渡口的时间。', chinese);
	assert.ok(chinese.simplified > 0);
});

test('a section is counted from page titles and every run of text, and notebooks add up', () => {
	const section = sectionJson('S', [pageJson('渡し場', [outline([element([rich([run('毎日の出航時間'), run('と桟橋')])])])])]);
	const counts = countSection(section);
	assert.equal(counts.kana + counts.han, '渡し場毎日の出航時間と桟橋'.length);
	const both = addCounts(emptyCounts(), counts);
	addCounts(both, counts);
	assert.equal(both.kana, counts.kana * 2);
});
