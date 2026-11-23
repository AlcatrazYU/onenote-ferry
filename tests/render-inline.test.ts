import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRuns, linkTarget, internalPageTitle } from '../src/core/render/inline.ts';
import { highlightMarker, emphasisColor } from '../src/core/render/color.ts';
import { escapeLineStart } from '../src/core/markdown.ts';
import type { TextRun } from '../src/core/model.ts';

const plain = { keepFontColor: false };
const colored = { keepFontColor: true };
const render = (runs: TextRun[], options: Parameters<typeof renderRuns>[1] = plain) => renderRuns(runs, options);

test('a highlight wraps a style change inside it instead of being cut', () => {
	assert.equal(render([
		{ text: 'alpha ', highlight: '#ffff00' },
		{ text: 'beta', highlight: '#ffff00', bold: true },
		{ text: ' gamma', highlight: '#ffff00' },
	]), '==🟡alpha **beta** gamma==');
});

test('two different highlights side by side are separated by a zero-width space', () => {
	assert.equal(render([
		{ text: 'red', highlight: '#ff0000' },
		{ text: 'blue', highlight: '#0000ff' },
	]), '==🔴red==\u200B==🔵blue==');
});

test('equal neighbouring runs are merged', () => {
	assert.equal(render([{ text: 'a', bold: true }, { text: 'b', bold: true }]), '**ab**');
	assert.equal(render([{ text: 'x ' }, { text: 'bold', bold: true }, { text: ' y' }]), 'x **bold** y');
});

test('highlight colours are grouped by hue, pale tints keep their hue', () => {
	assert.equal(highlightMarker('#ebf1dd'), '🟢');
	assert.equal(highlightMarker('#ff0000'), '🔴');
	assert.equal(highlightMarker('#ff8000'), '🟠');
	assert.equal(highlightMarker('#ffff00'), '🟡');
	assert.equal(highlightMarker('#00b050'), '🟢');
	assert.equal(highlightMarker('#0070c0'), '🔵');
	assert.equal(highlightMarker('#7030a0'), '🟣');
	assert.equal(highlightMarker('#f2f2f2'), '⚪');
	assert.equal(highlightMarker('#262626'), '⚫');
	assert.equal(highlightMarker('not-a-colour'), '🟡');
	assert.equal(highlightMarker(undefined), '');
});

test('only saturated emphasis colours are kept as font colours', () => {
	assert.equal(emphasisColor('#FF0000'), '#ff0000');
	assert.equal(emphasisColor('#333333'), undefined);
	assert.equal(emphasisColor('#ffd0d0'), undefined);
	assert.equal(emphasisColor(undefined), undefined);
});

test('a kept font colour is inline HTML, with Markdown characters escaped inside it', () => {
	assert.equal(render([{ text: 'a*b', color: '#c00000' }], colored), '<span style="color:#c00000">a\\*b</span>');
	assert.equal(render([{ text: 'a*b', color: '#c00000' }], plain), 'a*b');
});

test('underline is innermost, and dropped on links where it is the link style', () => {
	assert.equal(render([{ text: 'under', underline: true }]), '<u>under</u>');
	assert.equal(render([{ text: 'x', bold: true, underline: true }]), '**<u>x</u>**');
	assert.equal(render([{ text: 'site', underline: true, hyperlinkUrl: 'https://example.com' }]), '[site](https://example.com)');
});

test('superscript and subscript', () => {
	assert.equal(render([{ text: 'x' }, { text: '2', superscript: true }]), 'x<sup>2</sup>');
	assert.equal(render([{ text: 'H' }, { text: '2', subscript: true }, { text: 'O' }]), 'H<sub>2</sub>O');
});

test('math becomes LaTeX, keeping script glyphs as scripts', () => {
	assert.equal(render([{ text: 'x\u00B2+y\u2081', math: true }]), '$x^{2}+y_{1}$');
});

test('plain text escapes characters Markdown would reinterpret', () => {
	assert.equal(render([{ text: '[note] `code` <tag>' }]), '\\[note\\] \\`code\\` \\<tag>');
});

test('line starts that would become structure are escaped', () => {
	assert.equal(escapeLineStart('1. not a list'), '1\\. not a list');
	assert.equal(escapeLineStart('# not a heading'), '\\# not a heading');
	assert.equal(escapeLineStart('- not a bullet'), '\\- not a bullet');
	assert.equal(escapeLineStart('> not a quote'), '\\> not a quote');
	assert.equal(escapeLineStart('#hashtag stays'), '#hashtag stays');
});

test('a link that names its page by id is not matched by title, even if this section has a page of that title', () => {
	const url = 'onenote:https://d.docs.live.net/0/F/Other%20notebook/Other.one#Same%20Title&section-id={00000000-0000-0000-0000-000000000002}&page-id={00000000-0000-0000-0000-000000000003}&end';
	const options = { keepFontColor: false, resolveInternalLink: (title: string) => title === 'Same Title' ? 'Same Title.md' : undefined };
	assert.equal(render([{ text: 'go', hyperlinkUrl: url }], options), `[go](${url})`);
});

test('URLs: encoded ones are left alone, spaces and brackets are handled', () => {
	assert.equal(linkTarget('https://example.com/a b'), 'https://example.com/a%20b');
	assert.equal(linkTarget('https://example.com/%E4%B8%AD'), 'https://example.com/%E4%B8%AD');
	assert.equal(linkTarget('https://example.com/wiki/Foo_(bar)'), '<https://example.com/wiki/Foo_(bar)>');
});

test('internal OneNote links resolve to notes when the resolver knows the page', () => {
	const url = 'onenote:#Target%20Page&section-id={00000000-0000-0000-0000-000000000001}&end';
	assert.equal(internalPageTitle(url), 'Target Page');
	const options = { keepFontColor: false, resolveInternalLink: (title: string) => title === 'Target Page' ? 'Target Page.md' : undefined };
	assert.equal(render([{ text: 'go', hyperlinkUrl: url }], options), '[go](<Target Page.md>)');
	assert.equal(internalPageTitle('https://example.com#x'), undefined);
});
