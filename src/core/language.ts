// Which language a notebook is written in, for the marks the converter inserts into it
// (see the project plan: one language per notebook, shown before the import and changeable).

import type { DumpRich, DumpSection } from './dump.ts';
import type { Language } from './strings.ts';

export interface ScriptCounts {
	kana: number;
	hangul: number;
	han: number;
	latin: number;
	/** Han characters written differently in simplified and traditional Chinese, by form. */
	simplified: number;
	traditional: number;
}

export const emptyCounts = (): ScriptCounts => ({ kana: 0, hangul: 0, han: 0, latin: 0, simplified: 0, traditional: 0 });

/** Common characters with a different simplified and traditional form, pair by pair. */
const SIMPLIFIED = '这们个来时说为国学会对发过还没么进实现经与书长问题关东页见动开万门写读记论语话认识应当体观点无电难变条网图华历汉义乐儿处将礼从两机业气头样种让买卖车马鸟鱼龙间张陈刘杨赵级纪红线练组织终给绝统维编计设讲译试请谈谢诗词调质贵资费贸听声区医广产亲杂鸡号叶众优传伤价岁归状独战达运选遗邮钟银错镇阳阶际陆队风飞饭馆鲁齐';
const TRADITIONAL = '這們個來時說為國學會對發過還沒麼進實現經與書長問題關東頁見動開萬門寫讀記論語話認識應當體觀點無電難變條網圖華歷漢義樂兒處將禮從兩機業氣頭樣種讓買賣車馬鳥魚龍間張陳劉楊趙級紀紅線練組織終給絕統維編計設講譯試請談謝詩詞調質貴資費貿聽聲區醫廣產親雜雞號葉眾優傳傷價歲歸狀獨戰達運選遺郵鐘銀錯鎮陽階際陸隊風飛飯館魯齊';
const FORM = new Map<string, 'simplified' | 'traditional'>([
	...[...SIMPLIFIED].map(ch => [ch, 'simplified'] as const),
	...[...TRADITIONAL].map(ch => [ch, 'traditional'] as const),
]);

/** OneNote's hyperlink field codes: their URLs are not the note's language. */
const FIELD_CODE = /﷟HYPERLINK\s*"[^"]*"/gi;

/**
 * Counts one paragraph's letters. Japanese writes many characters in their traditional form
 * (時, 問, 題...), so in a paragraph with kana the forms are not counted for simplified or
 * traditional Chinese.
 */
export function countText(text: string, counts: ScriptCounts): void {
	const clean = text.replace(FIELD_CODE, '');
	const japanese = /[\u3040-\u30ff]/.test(clean);
	for (const ch of clean) {
		const code = ch.codePointAt(0)!;
		if (code >= 0x3040 && code <= 0x30ff) counts.kana++;
		else if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x1100 && code <= 0x11ff)) counts.hangul++;
		else if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x20000 && code <= 0x2fa1f)) {
			counts.han++;
			const form = japanese ? undefined : FORM.get(ch);
			if (form) counts[form]++;
		}
		else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) counts.latin++;
	}
}

/** Counts the text of a parsed section (the parser's JSON): page titles and every run of text. */
export function countSection(json: DumpSection, counts: ScriptCounts = emptyCounts()): ScriptCounts {
	const walk = (x: unknown): void => {
		if (Array.isArray(x)) {
			for (const v of x) walk(v);
			return;
		}
		if (!x || typeof x !== 'object') return;
		// A paragraph's runs together: a link's field code is often split across runs.
		if ((x as { type?: unknown }).type === 'rich') countText(((x as DumpRich).runs ?? []).map(r => (typeof r.text === 'string' ? r.text : '')).join(''), counts);
		for (const [key, value] of Object.entries(x)) if (key !== 'runs') walk(value);
	};
	for (const page of json.pages ?? []) {
		if (typeof page.title === 'string') countText(page.title, counts);
		walk(page.contents);
	}
	return counts;
}

export function addCounts(into: ScriptCounts, more: ScriptCounts): ScriptCounts {
	for (const key of Object.keys(into) as (keyof ScriptCounts)[]) into[key] += more[key];
	return into;
}

/** Below this many letters there is too little text to tell. */
const MIN_LETTERS = 20;

/**
 * The language of a notebook from its letters: Korean when Hangul is over a fifth of them,
 * Japanese when kana is over a tenth, Chinese when Han characters (with kana) are over three
 * tenths (traditional when more of its characters with two forms are traditional), otherwise
 * English. Undefined when there is too little text.
 */
export function detectLanguage(counts: ScriptCounts): Language | undefined {
	const total = counts.kana + counts.hangul + counts.han + counts.latin;
	if (total < MIN_LETTERS) return undefined;
	if (counts.hangul / total > 0.2) return 'ko';
	if (counts.kana / total > 0.1) return 'ja';
	if ((counts.han + counts.kana) / total > 0.3) return counts.traditional > counts.simplified ? 'zh-Hant' : 'zh-Hans';
	return 'en';
}
