import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Adapter } from '../src/core/adapter.ts';
import { zhHans } from '../src/core/strings.ts';
import type { Element, EmbeddedFile, Image, Ink, Paragraph } from '../src/core/model.ts';
import { asset, element, outline, pageJson, rich, run, sectionJson, stroke } from './helpers.ts';

const adapt = (contents: unknown[]) => {
	const adapter = new Adapter(zhHans);
	const section = adapter.section(sectionJson('Sample section', [pageJson('Sample', contents)]));
	return { adapter, page: section.pages[0] };
};
/** A list item whose first content is not text is wrapped in an outline; this reaches through it. */
const unwrap = (e: Element) => (e.kind === 'outline' ? e.children[0] : e);
const firstParagraph = (contents: unknown[]) => adapt([outline([element([rich(contents)])])]).page.outlines[0].children[0] as Paragraph;

test('page properties: level is zero-based, times come from Unix seconds', () => {
	const { page } = adapt([]);
	assert.equal(page.level, 0);
	assert.equal(page.createdUtc?.toISOString(), '2023-11-14T22:13:20.000Z');
	assert.equal(page.lastModifiedUtc?.toISOString(), '2023-11-14T23:13:20.000Z');
});

test('a hyperlink field code spanning runs puts the URL on the shown text, and later link runs carry it on', () => {
	const p = firstParagraph([
		run('\uFDDFHYPERLINK "https://example.com/a" '),
		run('Example', { link: true }),
		run(' site', { link: true, bold: true }),
		run(' after'),
	]);
	assert.deepEqual(p.runs.map(r => [r.text, r.hyperlinkUrl]), [
		['Example', 'https://example.com/a'],
		[' site', 'https://example.com/a'],
		[' after', undefined],
	]);
});

test('white backgrounds are not highlights; grey font colours are dropped, emphasis kept', () => {
	const p = firstParagraph([
		run('a', { highlight: '#FFFFFF' }),
		run('b', { highlight: '#FFFF00' }),
		run('c', { color: '#595959' }),
		run('d', { color: '#C00000' }),
	]);
	assert.deepEqual(p.runs.map(r => [r.highlight, r.color]), [
		[undefined, undefined], ['#ffff00', undefined], [undefined, undefined], [undefined, '#c00000'],
	]);
});

test('object replacement characters are removed; math runs keep their LaTeX', () => {
	const p = firstParagraph([run('x\uFFFCy'), run('ignored', { latex: 'a^2' })]);
	assert.deepEqual(p.runs.map(r => [r.text, r.math]), [['xy', undefined], ['a^2', true]]);
});

test('an embedded file without data becomes a visible notice, with no dash in it', () => {
	const { page } = adapt([outline([element([{ type: 'file', asset: null, fileName: 'missing.pdf', x: null, y: null, w: null }])])]);
	const notice = page.outlines[0].children[0] as Paragraph;
	assert.deepEqual(notice.runs, [{ text: '〔附件缺失：missing.pdf（OneDrive 下载包里没有这个文件的数据）〕', italic: true }]);
	assert.ok(!/[\u2013\u2014\u2015]/.test(notice.runs[0].text));
});

test('a printout page points at the PDF of the same name on the page; page numbers become 1-based', () => {
	const file = { type: 'file', asset: asset('f.pdf'), fileName: 'doc.pdf', x: 1, y: 1, w: 5 };
	const printout = { type: 'image', asset: asset('p.xps'), fileName: 'doc.pdf', page: 0, x: 1, y: 2, w: 5 };
	const { page } = adapt([outline([element([file]), element([printout])])]);
	const [embedded, image] = page.outlines[0].children.map(unwrap) as [EmbeddedFile, Image];
	assert.equal(image.printoutPage, 1);
	assert.equal(image.printoutOf, embedded);
});

test('Mac printout pages (one picture each, named <document>_<page>.pdf) point at the PDF on the page', () => {
	const file = { type: 'file', asset: asset('f.pdf'), fileName: 'doc.pdf', x: 1, y: 1, w: 5 };
	const macPage = (n: number) => ({ type: 'image', asset: asset(`m${n}.png`), fileName: `doc_${n}.pdf`, page: n, x: 1, y: 2, w: 5 });
	const { page } = adapt([outline([element([file]), element([macPage(1)]), element([macPage(2)])])]);
	const [embedded, first, second] = page.outlines[0].children.map(unwrap) as [EmbeddedFile, Image, Image];
	assert.deepEqual([first.printoutPage, first.printoutName, first.printoutOf], [1, 'doc.pdf', embedded]);
	assert.deepEqual([second.printoutPage, second.printoutOf, second.extension], [2, embedded, 'png']);
});

test('a Mac printout page without its PDF, or an image only named like one, stays an ordinary image', () => {
	const alone = { type: 'image', asset: asset('m.png'), fileName: 'doc_1.pdf', page: 1, x: 1, y: 2, w: 5 };
	const wrongPage = { type: 'image', asset: asset('w.png'), fileName: 'scan_2.pdf', page: 3, x: 1, y: 2, w: 5 };
	const noPage = { type: 'image', asset: asset('n.png'), fileName: 'scan_2.pdf', x: 1, y: 2, w: 5 };
	const { page } = adapt([outline([element([alone]), element([wrongPage]), element([noPage])])]);
	const [a, b, c] = page.outlines[0].children.map(unwrap) as Image[];
	assert.deepEqual([a.printoutPage, a.printoutName, a.printoutOf], [1, 'doc.pdf', undefined]);
	assert.deepEqual([b.printoutPage, c.printoutPage], [undefined, undefined]);
});

test('page ink keeps highlighter strokes in the model; highlighter-only ink is set aside', () => {
	const mixed = { type: 'ink', strokes: [stroke(0), stroke(128)], x: 2, y: 3 };
	const highlighterOnly = { type: 'ink', strokes: [stroke(128)], x: 0, y: 0 };
	const { page, adapter } = adapt([mixed, highlighterOnly]);
	assert.equal(page.directContent.length, 1);
	const ink = page.directContent[0] as Ink;
	assert.deepEqual(ink.strokes.map(s => s.opacity.toFixed(2)), ['1.00', '0.50']);
	// Page positions are absolute half inches: the offset plus the decoded points.
	assert.deepEqual(ink.strokes[0].points, [{ x: 2, y: 3 }, { x: 3, y: 4 }]);
	assert.equal(page.highlighterInk?.length, 1);
	assert.deepEqual(adapter.stats, { ink: 2, highlighterOnly: 1 });
});

test('ink inside a line of text becomes an SVG drawing after the paragraph; highlighter alone draws nothing', () => {
	const { page, adapter } = adapt([outline([element([rich([run('text')], { inks: [{ strokes: [stroke(0)] }, { strokes: [stroke(128)] }] })])])]);
	const p = page.outlines[0].children[0] as Paragraph;
	assert.equal(p.children.length, 1);
	const drawing = p.children[0] as Image;
	assert.equal(drawing.inkSvg, true);
	assert.ok(drawing.data?.kind === 'inline' && new TextDecoder().decode(drawing.data.bytes).startsWith('<svg'));
	assert.equal(adapter.stats.highlighterOnly, 1);
});

test('list items: numbered when the format holds the number placeholder, children attached to the item', () => {
	const numbered = element([rich([run('first')])], [element([rich([run('child')])])], { list: { format: '\uFFFD.' } });
	const bulleted = element([rich([run('second')])], [], { list: { format: '•' } });
	const { page } = adapt([outline([numbered, bulleted])]);
	const [a, b] = page.outlines[0].children as Paragraph[];
	assert.equal(a.list?.ordered, true);
	assert.equal((a.children[0] as Paragraph).runs[0].text, 'child');
	assert.equal(b.list?.ordered, false);
});

test('note tags: to-do boxes are checkable, named shapes map to callout numbers', () => {
	const p = firstParagraph([run('x')]);
	assert.equal(p.tags, undefined);
	const tagged = adapt([outline([element([rich([run('x')], { tags: [{ shape: 'YellowStar', checkable: false, completed: false, label: 'Important' }, { shape: 'Checkbox', checkable: true, completed: true, label: '' }] })])])]);
	assert.deepEqual((tagged.page.outlines[0].children[0] as Paragraph).tags, [
		{ checkable: false, completed: false, label: 'Important', shape: 13 },
		{ checkable: true, completed: true, label: undefined, shape: 1 },
	]);
});

test('text boxes keep their position on the page', () => {
	const { page } = adapt([outline([element([rich([run('x')])])], { x: 1.5, y: 2.5, w: 7 })]);
	assert.deepEqual(page.outlines[0].place, { x: 1.5, y: 2.5, width: 7 });
});
