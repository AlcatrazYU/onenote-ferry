import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRuns, linkTarget, internalPageTitle } from '../src/core/render/inline.ts';
import { highlightMarker, emphasisColor } from '../src/core/render/color.ts';
import { escapeLineStart } from '../src/core/markdown.ts';
import type { TextRun } from '../src/core/model.ts';

const render = (runs: TextRun[], options: Parameters<typeof renderRuns>[1] = {}) => renderRuns(runs, options);

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
	assert.equal(render([{ text: 'a*b', color: '#c00000' }]), '<span style="color:#c00000">a\\*b</span>');
});

test('underline is innermost, and dropped on links where it is the link style', () => {
	assert.equal(render([{ text: 'under', underline: true }]), '<u>under</u>');
	// Written in HTML, it carries its own bold (Markdown around it does not reach in, §11.5 item 87).
	assert.equal(render([{ text: 'x', bold: true, underline: true }]), '<b><u>x</u></b>');
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
	const options = { resolveInternalLink: (title: string) => title === 'Same Title' ? 'Same Title.md' : undefined };
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
	const options = { resolveInternalLink: (title: string) => title === 'Target Page' ? 'Target Page.md' : undefined };
	assert.equal(render([{ text: 'go', hyperlinkUrl: url }], options), '[go](<Target Page.md>)');
	assert.equal(internalPageTitle('https://example.com#x'), undefined);
});

// Obsidian's editing view (§11.5 item 87): `**` and `*` only where CommonMark lets them open and
// close, and text written in HTML carrying its own styles. The text is invented.

const RED = '<span style="color:#ff0000">';

test('punctuation at the edge of bold beside a letter outside is left out of it, so ** works in the editing view', () => {
	assert.equal(render([{ text: '船期' }, { text: '「北港」', bold: true }, { text: '開船' }]), '船期「**北港**」開船');
	assert.equal(render([{ text: '船期' }, { text: '北港', bold: true }, { text: '開船' }]), '船期**北港**開船');
	// Punctuation or a space outside too: left as it is.
	assert.equal(render([{ text: '船期。' }, { text: '「北港」', bold: true }, { text: '。' }]), '船期。**「北港」**。');
	assert.equal(render([{ text: 'Pier ' }, { text: '"north"', bold: true }, { text: ' only' }]), 'Pier **"north"** only');
	assert.equal(render([{ text: '潮汐' }, { text: '（高）', italic: true }, { text: '時刻' }]), '潮汐（*高*）時刻');
	// A sentence in bold that ends with a full stop, followed by text.
	assert.equal(render([{ text: '潮退，風起，船開。', bold: true }, { text: '晚到' }]), '**潮退，風起，船開**。晚到');
	// Bold and italic together move as one.
	assert.equal(render([{ text: '船期' }, { text: '「北港」', bold: true, italic: true }, { text: '開船' }]), '船期「***北港***」開船');
	// Only punctuation in bold: nothing is left to make bold.
	assert.equal(render([{ text: '船期' }, { text: '「」', bold: true }, { text: '開船' }]), '船期「」開船');
	// After a highlight's colour dot, which the editing view reads as a letter: past the bracket, it opens.
	assert.equal(render([{ text: '）--晚點', bold: true, highlight: '#ffff00' }, { text: '開船' }]), '==🟡）**--晚點**==開船');
	// Never between a backslash and what it escapes.
	assert.equal(render([{ text: '船期' }, { text: '[北港]', bold: true }, { text: '開船' }]), '船期\\[**北港**\\]開船');
	// Spaces in the way move out too; a > of the text is passed like other punctuation.
	assert.equal(render([{ text: '船期' }, { text: '北港 (', bold: true }, { text: '開船' }]), '船期**北港** (開船');
	assert.equal(render([{ text: '船期' }, { text: 'A->B>', bold: true }, { text: '開船' }]), '船期**A->B**>開船');
	// Before a tag (punctuation too) it closes where it is.
	assert.equal(render([{ text: '北港。', bold: true }, { text: '晚點', bold: true, color: '#ff0000' }, { text: '開船' }]), `**北港。**${RED}<b>晚點</b></span>開船`);
});

test('asterisks typed in the text are escaped where the paragraph has bold or italic, so they never pair with ours', () => {
	// One typed at the start of a bold paragraph, with no partner.
	assert.equal(render([{ text: '**潮汐表', bold: true }, { text: '（晚）' }]), '**\\*\\*潮汐表**（晚）');
	assert.equal(render([{ text: '船期 *註' }, { text: '北港', italic: true }]), '船期 \\*註*北港*');
	// Without bold or italic they are left as they were.
	assert.equal(render([{ text: '船期 *註*', highlight: '#ffff00' }]), '==🟡船期 *註*==');
	assert.equal(render([{ text: '船期 *註* ' }, { text: '晚', bold: true, color: '#ff0000' }]), `船期 *註* ${RED}<b>晚</b></span>`);
	// Text written in HTML escapes them itself.
	assert.equal(render([{ text: '*晚*', bold: true, color: '#ff0000' }]), `${RED}<b>\\*晚\\*</b></span>`);
});

test('coloured text carries its own bold, italic and strikethrough; Markdown around it never touches its tags', () => {
	assert.equal(render([{ text: '船期' }, { text: '晚點', bold: true, color: '#ff0000' }, { text: '開船' }]), `船期${RED}<b>晚點</b></span>開船`);
	assert.equal(render([{ text: '取消', strikethrough: true, italic: true, color: '#ff0000' }]), `${RED}<i><s>取消</s></i></span>`);
	assert.equal(render([{ text: '北港', bold: true }, { text: '晚點', bold: true, color: '#ff0000' }, { text: '開船', bold: true }]), `**北港${RED}<b>晚點</b></span>開船**`);
	// At either end of a bold stretch it stays outside the **.
	assert.equal(render([{ text: '晚點', bold: true, color: '#ff0000' }, { text: '開船', bold: true }, { text: '晚到' }]), `${RED}<b>晚點</b></span>**開船**晚到`);
	assert.equal(render([{ text: '船期' }, { text: '北港', bold: true }, { text: '晚點', bold: true, color: '#ff0000' }]), `船期**北港**${RED}<b>晚點</b></span>`);
	assert.equal(render([{ text: '北港', strikethrough: true }, { text: '晚點', strikethrough: true, color: '#ff0000' }]), `~~北港~~${RED}<s>晚點</s></span>`);
});

test('text written in HTML escapes only what the reading view would read as Markdown', () => {
	// The editing view shows a backslash inside HTML as it is: brackets alone, a single = or ~ need none.
	assert.equal(render([{ text: '[1] 潮汐 a=b c~d', color: '#ff0000' }]), `${RED}[1] 潮汐 a=b c~d</span>`);
	// A wikilink, a footnote, a link, a highlight, a strikethrough would be read.
	assert.equal(render([{ text: '[[北港]] 見^[註] [港](x) a==b c~~d', color: '#ff0000' }]), String.raw`${RED}\[[北港]] 見^\[註] [港\](x) a\=\=b c\~\~d</span>`);
	assert.equal(render([{ text: '[潮][汐] [^1]', underline: true }]), String.raw`<u>[潮\][汐] \[^1]</u>`);
	// These are escaped wherever they are.
	assert.equal(render([{ text: '*潮* _汐_ `表` $x$ \\', color: '#ff0000' }]), `${RED}\\*潮\\* \\_汐\\_ \\\`表\\\` \\$x\\$ \\\\</span>`);
});

test('a highlight over coloured or underlined text stays one ==, as Markdown cannot do more', () => {
	// The editing view does not show the highlight on the coloured part (a known limitation); the reading view does.
	assert.equal(render([
		{ text: '北港', highlight: '#ffff00' },
		{ text: '晚點', highlight: '#ffff00', color: '#ff0000' },
		{ text: '開船', highlight: '#ffff00' },
	]), `==🟡北港${RED}晚點</span>開船==`);
	assert.equal(render([{ text: '潮汐', highlight: '#00ff00', underline: true }]), '==🟢<u>潮汐</u>==');
});
