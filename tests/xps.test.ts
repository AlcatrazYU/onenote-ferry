// Windows printout pages drawn from their XPS document (src/core/render/xps.ts, §11.5 item 70).
// The document is invented (tests/samples-xps.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openXps } from '../src/core/render/xps.ts';
import { xpsDocument } from './samples-xps.ts';
import { makeZip, bytes } from './zip-writer.ts';

test('a page of image strips and filled shapes is drawn as SVG; a page of text, or one that is not there, is not', async () => {
	const doc = await openXps(xpsDocument());
	assert.ok(doc);
	assert.equal(doc.pages, 2);
	const page = await doc.page(1);
	assert.ok(page);
	assert.deepEqual([page.width, page.height], [96, 192]);
	assert.match(page.content, /^<rect width="96" height="192" fill="#ffffff"\/>/);
	assert.match(page.content, /<g transform="matrix\(1 0 0 1 8 4\)"><image x="0" y="0" width="80" height="40" preserveAspectRatio="none" href="data:image\/png;base64,/);
	assert.match(page.content, /<g transform="matrix\(1 0 0 1 20 60\)"><path d="M 0,0 L 10,0 10,10 z" fill-rule="nonzero" fill="#ff0000"\/><\/g>/);
	assert.match(page.content, /<path d="M 0,0 C 1,1 2,2 3,3 z" fill-rule="nonzero" fill="#000000" fill-opacity="0.502"\/>/);
	assert.equal(await doc.page(2), undefined, 'text in glyphs is not drawn here');
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

