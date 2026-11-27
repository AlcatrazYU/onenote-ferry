// Windows printout pages drawn from their XPS document (src/core/render/xps.ts, §11.5 item 70).
// The document is invented (tests/samples-xps.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openXps } from '../src/core/render/xps.ts';
import { xpsDocument } from './samples-xps.ts';

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
