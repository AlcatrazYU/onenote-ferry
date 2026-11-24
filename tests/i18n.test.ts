// The plugin's interface text: four languages, each complete, with no dashes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, UI_LANGUAGES, uiStrings } from '../src/plugin/i18n.ts';
import type { UiStrings } from '../src/plugin/i18n.ts';

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`);

/** Texts that take a list of names; every other parameter takes a number or a name. */
const LISTS = new Set(['alreadyInFolder']);

/** Sample arguments: numbers distinct enough to be found in the text (names are numbers too, as text). */
function samples(key: string, count: number, first = 1234): unknown[] {
	return Array.from({ length: count }, (_, i) => LISTS.has(key) ? [`Name${first + i}`, `Name${first + i + 10}`] : first + i * 1111);
}

/** Every text of one language, functions called with sample arguments. */
function allTexts(ui: UiStrings): Record<string, string> {
	const texts: Record<string, string> = {};
	for (const [key, value] of Object.entries(ui)) {
		if (typeof value === 'string') texts[key] = value;
		else if (Array.isArray(value)) value.forEach((item, i) => texts[`${key}.${i}`] = item);
		else if (typeof value === 'function') {
			const fn = value as (...args: unknown[]) => string;
			texts[key] = fn(...samples(key, fn.length));
			texts[`${key}(1)`] = fn(...samples(key, fn.length).map(arg => Array.isArray(arg) ? ['Name'] : 1));
		}
		else for (const [inner, text] of Object.entries(value as Record<string, string>)) texts[`${key}.${inner}`] = text;
	}
	return texts;
}

test('every text shows each number and name it is given', () => {
	for (const [language, ui] of Object.entries(UI_LANGUAGES)) {
		for (const [key, value] of Object.entries(ui)) {
			if (typeof value !== 'function') continue;
			const fn = value as (...args: unknown[]) => string;
			const args = samples(key, fn.length);
			const text = fn(...args);
			for (const arg of args.flat()) {
				const shown = typeof arg === 'number' ? [String(arg), arg.toLocaleString('en-US')] : [String(arg)];
				assert.ok(shown.some(form => text.includes(form)), `${language}.${key} leaves out ${String(arg)}: ${text}`);
			}
		}
	}
});

test('four interface languages, each with every text, none empty', () => {
	const keys = Object.keys(allTexts(UI_LANGUAGES.en)).sort();
	for (const [language, ui] of Object.entries(UI_LANGUAGES)) {
		const texts = allTexts(ui);
		assert.deepEqual(Object.keys(texts).sort(), keys, language);
		for (const [key, text] of Object.entries(texts)) assert.ok(text.trim() !== '' && !text.includes('undefined'), `${language}.${key}: ${text}`);
	}
});

test('no dash characters', () => {
	for (const [language, ui] of Object.entries(UI_LANGUAGES)) {
		for (const [key, text] of Object.entries(allTexts(ui))) assert.ok(!DASHES.test(text), `${language}.${key}: ${text}`);
	}
});

test('the interface language follows Obsidian\'s; English for the rest', () => {
	assert.equal(uiStrings('zh'), UI_LANGUAGES.zh);
	assert.equal(uiStrings('zh-TW'), UI_LANGUAGES.zh);
	assert.equal(uiStrings('ja'), UI_LANGUAGES.ja);
	assert.equal(uiStrings('ko'), UI_LANGUAGES.ko);
	assert.equal(uiStrings('fr'), UI_LANGUAGES.en);
	assert.equal(uiStrings('jam'), UI_LANGUAGES.en);
});

test('English counts agree in number', () => {
	const ui = UI_LANGUAGES.en;
	assert.equal(ui.notebooksFound(1), '1 notebook');
	assert.equal(ui.notebooksFound(1208), '1,208 notebooks');
	assert.equal(ui.willImport(1, 1, '2 MB'), '1 section from 1 notebook, 2 MB.');
	assert.equal(ui.leftOut(1), '1 section not converted because the import was stopped.');
});

test('sizes', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1023), '1023 B');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(635 * 1024), '635 KB');
	assert.equal(formatBytes(1.7 * 1024 ** 3), '1.7 GB');
	// Rounded first: just under 1 MB is 1 MB, not 1024 KB.
	assert.equal(formatBytes(1048575), '1 MB');
	assert.equal(formatBytes(1024 ** 3 - 1), '1 GB');
});

test('Simplified Chinese quotes with “ ”, never with 「」', () => {
	for (const [key, text] of Object.entries(allTexts(UI_LANGUAGES.zh))) assert.ok(!/[「」『』]/.test(text), `zh.${key}: ${text}`);
});
