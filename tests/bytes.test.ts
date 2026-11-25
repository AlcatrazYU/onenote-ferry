import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyOf, ownArrayBuffer } from '../src/plugin/bytes.ts';

test('a small file read from disk is handed on as its own bytes, not the pool around it', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ferry-bytes-'));
	try {
		writeFileSync(join(dir, 'a.png'), Buffer.alloc(605, 7));
		readFileSync(join(dir, 'a.png'));
		const bytes = readFileSync(join(dir, 'a.png'));
		assert.ok(bytes.buffer.byteLength > bytes.byteLength, 'the read sits in a larger pool');
		const own = ownArrayBuffer(bytes);
		assert.equal(own.byteLength, 605);
		assert.deepEqual(new Uint8Array(own), new Uint8Array(605).fill(7));
		const copy = copyOf(bytes);
		assert.equal(copy.buffer.byteLength, 605);
		assert.notEqual(copy.buffer, bytes.buffer);
	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('bytes that fill their memory are handed on as they are', () => {
	const bytes = new Uint8Array([1, 2, 3]);
	assert.equal(ownArrayBuffer(bytes), bytes.buffer);
	const view = new Uint8Array(new Uint8Array([9, 1, 2, 3, 9]).buffer, 1, 3);
	assert.deepEqual(new Uint8Array(ownArrayBuffer(view)), bytes);
});
