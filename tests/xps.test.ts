// Windows printout pages drawn from their XPS document (src/core/render/xps.ts, §11.5 item 70).
// The document is invented (tests/samples-xps.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openXps } from '../src/core/render/xps.ts';
import { pngHeader, xpsDocument } from './samples-xps.ts';
import { makeZip, bytes } from './zip-writer.ts';
import { buildFont } from './font-writer.ts';

test('a page of image strips and filled shapes is drawn as SVG; a page of text without its font, or one that is not there, is not', async () => {
	const doc = await openXps(xpsDocument());
	assert.ok(doc);
	assert.equal(doc.pages, 2);
	const page = await doc.page(1);
	assert.ok(page);
	assert.deepEqual([page.width, page.height], [96, 192]);
	// The picture strip's Clip (its own shape here) as a clip path, once.
	assert.match(page.content, /^<defs><clipPath id="(cp\w+)" clipPathUnits="userSpaceOnUse"><path d="M 0,0 L 80,0 80,40 0,40 z" clip-rule="evenodd"\/><\/clipPath><\/defs><rect width="96" height="192" fill="#ffffff"\/>/);
	// Its Viewbox (160 by 80 at 96 dpi: the whole picture) stretched over its Viewport.
	assert.match(page.content, /<g transform="matrix\(1 0 0 1 8 4\)"><g clip-path="url\(#cp\w+\)"><svg x="0" y="0" width="80" height="40" viewBox="0 0 160 80" preserveAspectRatio="none"><image width="160" height="80" preserveAspectRatio="none" href="data:image\/png;base64,[^"]*"\/><\/svg><\/g>/);
	assert.match(page.content, /<g transform="matrix\(1 0 0 1 20 60\)"><path d="M 0,0 L 10,0 10,10 z" fill-rule="nonzero" fill="#ff0000"\/><\/g>/);
	assert.match(page.content, /<path d="M 0,0 C 1,1 2,2 3,3 z" fill-rule="nonzero" fill="#000000" fill-opacity="0.502"\/>/);
	assert.equal(await doc.page(2), undefined, 'text whose font is not in the document is not drawn');
	assert.equal(await doc.page(3), undefined);
	assert.equal(await openXps(new Uint8Array([1, 2, 3])), undefined);
});

test('a page with a tag written another way (single quotes) or an opacity mask is not drawn, rather than drawn in part', async () => {
	const doc = (page: string) => makeZip([
		{ name: '_rels/.rels', data: bytes('<Relationships><Relationship Type="x/fixedrepresentation" Target="/S.fdseq" /></Relationships>') },
		{ name: 'S.fdseq', data: bytes('<FixedDocumentSequence><DocumentReference Source="/D.fdoc" /></FixedDocumentSequence>') },
		{ name: 'D.fdoc', data: bytes('<FixedDocument><PageContent Source="/1.fpage" /></FixedDocument>') },
		{ name: '1.fpage', data: bytes(page) },
	]);
	const shape = '<Path Data="M 0,0 L 1,0 1,1 z" Fill="#ff000000" />';
	assert.ok(await (await openXps(doc(`<FixedPage Width="10" Height="10">${shape}</FixedPage>`)))!.page(1));
	assert.equal(await (await openXps(doc(`<FixedPage Width="10" Height="10"><Path Data='M 0,0 L 1,0 1,1 z' Fill='#ff000000' />${shape}</FixedPage>`)))!.page(1), undefined);
	assert.equal(await (await openXps(doc(`<FixedPage Width="10" Height="10"><Canvas><Canvas.OpacityMask><SolidColorBrush Color="#80000000" /></Canvas.OpacityMask>${shape}</Canvas></FixedPage>`)))!.page(1), undefined);
});


/** A document of one page, with an embedded font obfuscated as Windows writes it ([MS-XPS] 9.1.7.3). */
function onePage(page: string, font?: Uint8Array): Uint8Array {
	const guid = '0123ABCD-4567-89EF-0123-456789ABCDEF';
	const files = [
		{ name: '_rels/.rels', data: bytes('<Relationships><Relationship Type="x/fixedrepresentation" Target="/S.fdseq" /></Relationships>') },
		{ name: 'S.fdseq', data: bytes('<FixedDocumentSequence><DocumentReference Source="/D.fdoc" /></FixedDocumentSequence>') },
		{ name: 'D.fdoc', data: bytes('<FixedDocument><PageContent Source="/1.fpage" /></FixedDocument>') },
		{ name: '1.fpage', data: bytes(page) },
	];
	if (font) {
		const key = guid.replace(/-/g, '').match(/../g)!.map(h => parseInt(h, 16)).reverse();
		const hidden = font.slice();
		for (let i = 0; i < 32; i++) hidden[i] = hidden[i]! ^ key[i % 16]!;
		files.push({ name: `Resources/${guid}.odttf`, data: hidden });
	}
	return makeZip(files);
}

const SQUARE: [number, number, boolean][] = [[0, 0, true], [500, 0, true], [500, 500, true], [0, 500, true]];
const TEXT_FONT = buildFont([undefined, { contours: [SQUARE] }, { contours: [SQUARE.map(([x, y, on]) => [x / 2, y, on] as [number, number, boolean])] }], { 0x41: 1, 0x42: 2 }, [0, 600, 300]);

test('text is drawn by its glyph numbers from the embedded font: each glyph once in the defs, then placed', async () => {
	const glyphs = '<Glyphs OriginX="10" OriginY="40" FontRenderingEmSize="20" FontUri="/Resources/0123ABCD-4567-89EF-0123-456789ABCDEF.odttf" UnicodeString="ABA" Indices="1;2;1" Fill="#ff112233" />';
	const page = await (await openXps(onePage(`<FixedPage Width="100" Height="100">${glyphs}</FixedPage>`, TEXT_FONT)))!.page(1);
	assert.ok(page);
	const defs = page.content.match(/<defs>(.*?)<\/defs>/)![1]!;
	assert.equal((defs.match(/<path id=/g) ?? []).length, 2);
	// Scale 20/1000, y up in the font and down on the page; advances 600 and 300 font units.
	assert.match(page.content, /<g fill="#112233"><use href="#g\w+_1" transform="matrix\(0\.02 0 0 -0\.02 10 40\)"\/><use href="#g\w+_2" transform="matrix\(0\.02 0 0 -0\.02 22 40\)"\/><use href="#g\w+_1" transform="matrix\(0\.02 0 0 -0\.02 28 40\)"\/><\/g>/);
	// A glyph number that is not its character's glyph: the page is not drawn.
	const wrong = glyphs.replace('Indices="1;2;1"', 'Indices="2;2;1"');
	const doc = await openXps(onePage(`<FixedPage Width="100" Height="100">${wrong}</FixedPage>`, TEXT_FONT));
	assert.equal(await doc!.page(1), undefined);
	assert.match((await doc!.explain(1)).reason!, /not its character/);
});

test('a page\'s text: runs that go on from one another joined, along a line or down a column; a glyph given without its character read from the font (§11.5 item 78)', async () => {
	const font = 'FontUri="/Resources/0123ABCD-4567-89EF-0123-456789ABCDEF.odttf" Fill="#ff000000"';
	const runs = [
		// A line in three runs (A is 12 wide at this size, B 6): the third gives glyph 2 only, which the font draws for B.
		`<Glyphs OriginX="10" OriginY="40" FontRenderingEmSize="20" ${font} UnicodeString="AB" />`,
		`<Glyphs OriginX="28" OriginY="40" FontRenderingEmSize="20" ${font} UnicodeString="A" />`,
		`<Glyphs OriginX="40" OriginY="40" FontRenderingEmSize="20" ${font} Indices="2" />`,
		// The next line; then a run beside the first line, not where it goes on.
		`<Glyphs OriginX="10" OriginY="80" FontRenderingEmSize="20" ${font} UnicodeString="BA" />`,
		`<Glyphs OriginX="80" OriginY="40" FontRenderingEmSize="20" ${font} UnicodeString="B" />`,
		// A column: glyphs set one em below the other by offsets, inside a moved canvas; the run after it goes on down.
		`<Canvas RenderTransform="1,0,0,1,100,0"><Glyphs OriginX="-40" OriginY="10" FontRenderingEmSize="20" ${font} UnicodeString="AAA" Indices="1,0;1,0,,-100;1,,,-200" />`,
		`<Glyphs OriginX="-40" OriginY="70" FontRenderingEmSize="20" ${font} UnicodeString="B" /></Canvas>`,
	];
	const doc = await openXps(onePage(`<FixedPage Width="100" Height="100">${runs.join('')}</FixedPage>`, TEXT_FONT));
	assert.deepEqual(await doc!.text(1), { text: 'ABAB\nBA\nB\nAAAB', given: 'AB\nA\n\nBA\nB\nAAA\nB' });
	assert.ok(await doc!.page(1));
	assert.equal(await doc!.text(2), undefined);
});

test('on a page without vertical writing, runs of one character a line apart are not joined: bullets, a column of a table (§11.5 item 79)', async () => {
	const font = 'FontUri="/Resources/0123ABCD-4567-89EF-0123-456789ABCDEF.odttf" Fill="#ff000000"';
	// Lines 24 apart at em 20: one bullet (A) or one digit-like cell (B) before each item, set apart by a tab.
	const runs = [0, 1, 2].flatMap(k => [
		`<Glyphs OriginX="10" OriginY="${40 + 24 * k}" FontRenderingEmSize="20" ${font} UnicodeString="A" />`,
		`<Glyphs OriginX="40" OriginY="${40 + 24 * k}" FontRenderingEmSize="20" ${font} UnicodeString="BAB" />`,
	]);
	const doc = await openXps(onePage(`<FixedPage Width="100" Height="200">${runs.join('')}</FixedPage>`, TEXT_FONT));
	assert.equal((await doc!.text(1))!.text, 'A\nBAB\nA\nBAB\nA\nBAB');
});

/** A one-page document with a picture `1.png` (`png`) in it. */
function pagePicture(page: string, png: Uint8Array): Uint8Array {
	const files = [
		{ name: '_rels/.rels', data: bytes('<Relationships><Relationship Type="x/fixedrepresentation" Target="/S.fdseq" /></Relationships>') },
		{ name: 'S.fdseq', data: bytes('<FixedDocumentSequence><DocumentReference Source="/D.fdoc" /></FixedDocumentSequence>') },
		{ name: 'D.fdoc', data: bytes('<FixedDocument><PageContent Source="/1.fpage" /></FixedDocument>') },
		{ name: '1.fpage', data: bytes(page) },
		{ name: '1.png', data: png },
	];
	return makeZip(files);
}

test('clips, picture crops, brush opacity and dashes are drawn as XPS means them; what cannot be is not drawn (§11.5 item 79)', async () => {
	const drawn = async (body: string, png = pngHeader(200, 100)) => (await openXps(pagePicture(`<FixedPage Width="300" Height="300">${body}</FixedPage>`, png)))!.explain(1);
	const square = 'Data="M 0,0 L 300,0 300,300 0,300 z"';
	// A canvas clipped to a small square: the clip path goes on its group, in its own coordinates.
	const clipped = await drawn(`<Canvas Clip="M 0,0 L 10,0 10,10 0,10 z"><Path ${square} Fill="#FF000000" /></Canvas>`);
	assert.match(clipped.page!.content, /<clipPath id="(cp\w+)" clipPathUnits="userSpaceOnUse"><path d="M 0,0 L 10,0 10,10 0,10 z" clip-rule="evenodd"\/><\/clipPath>/);
	assert.match(clipped.page!.content, /<g clip-path="url\(#cp\w+\)"><path d="M 0,0 L 300,0 300,300 0,300 z"/);
	// A clip given as an element is not drawn here.
	assert.equal((await drawn(`<Canvas><Canvas.Clip><PathGeometry Figures="M 0,0 L 10,0 10,10 z" /></Canvas.Clip><Path ${square} Fill="#FF000000" /></Canvas>`)).reason, 'Canvas.Clip');
	// A brush's opacity counts; a dashed stroke is dashed, in stroke widths.
	const brush = await drawn(`<Path ${square}><Path.Fill><SolidColorBrush Color="#FF000000" Opacity="0.1" /></Path.Fill></Path><Path Data="M 0,0 L 100,0" Stroke="#FF000000" StrokeThickness="2" StrokeDashArray="3 1" />`);
	assert.match(brush.page!.content, /fill="#000000" fill-opacity="0\.100"/);
	assert.match(brush.page!.content, /stroke="#000000" stroke-width="2" stroke-miterlimit="10" stroke-dasharray="6 2"/);
	// Triangle caps, a transform on a picture brush or on a shape: not drawn.
	assert.equal((await drawn('<Path Data="M 0,0 L 100,0" Stroke="#FF000000" StrokeStartLineCap="Triangle" StrokeEndLineCap="Triangle" />')).reason, 'line caps');
	const picture = (extra: string, box = '0,0,200,100') => `<Path ${square}><Path.Fill><ImageBrush ImageSource="/1.png" Viewbox="${box}" ViewboxUnits="Absolute" Viewport="0,0,300,150" ViewportUnits="Absolute" TileMode="None"${extra} /></Path.Fill></Path>`;
	assert.equal((await drawn(picture(' Transform="-1,0,0,1,200,0"'))).reason, 'image brush transform');
	// A picture of which a part is shown: that part (its Viewbox) over the viewport.
	assert.match((await drawn(picture('', '0,0,100,50'))).page!.content, /<svg x="0" y="0" width="300" height="150" viewBox="0 0 100 50" preserveAspectRatio="none"><image width="200" height="100"/);
	// At 192 dpi (7559 pixels a metre in a PNG's pHYs), the same picture is half as large in the Viewbox's units.
	const hiRes = new Uint8Array([...pngHeader(200, 100).slice(0, 8), ...[0, 0, 0, 13], ...bytes('IHDR'), ...new Uint8Array(17), ...[0, 0, 0, 9], ...bytes('pHYs'), ...[0, 0, 0x1d, 0x87, 0, 0, 0x1d, 0x87, 1], ...new Uint8Array(4)]);
	new DataView(hiRes.buffer).setUint32(16, 200);
	new DataView(hiRes.buffer).setUint32(20, 100);
	assert.match((await drawn(picture('', '0,0,100,50'), hiRes)).page!.content, /<image width="100.001" height="50"/);
});

test('a shape filled with a linear gradient is drawn with an SVG gradient', async () => {
	const path = '<Path Data="M 0,0 L 10,0 10,10 z"><Path.Fill><LinearGradientBrush MappingMode="Absolute" StartPoint="0,0" EndPoint="10,0"><LinearGradientBrush.GradientStops><GradientStop Color="#FFFF0000" Offset="0" /><GradientStop Color="#800000FF" Offset="1" /></LinearGradientBrush.GradientStops></LinearGradientBrush></Path.Fill></Path>';
	const page = await (await openXps(onePage(`<FixedPage Width="10" Height="10">${path}</FixedPage>`)))!.page(1);
	assert.ok(page);
	assert.match(page.content, /<linearGradient id="(lg\w+)" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"><stop offset="0" stop-color="#FF0000"\/><stop offset="1" stop-color="#0000FF" stop-opacity="0\.502"\/><\/linearGradient>/);
	assert.match(page.content, /<path d="M 0,0 L 10,0 10,10 z" fill-rule="evenodd" fill="url\(#lg\w+\)"\/>/);
});
