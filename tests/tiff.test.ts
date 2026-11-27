// TIF pictures written as PNG (src/core/render/tiff.ts, §11.5 item 77): the same pixels, or nothing
// for a TIF of a kind not read here (which is then written as it was).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { tiffToPng } from '../src/core/render/tiff.ts';

/** A one-page, uncompressed TIF (little-endian), in strips of `rowsPerStrip` rows. */
function tiff(width: number, height: number, samples: number, pixels: number[], options: { extra?: number, compression?: number, rowsPerStrip?: number, nextPage?: boolean, orientation?: number } = {}): Uint8Array {
	const rowsPerStrip = options.rowsPerStrip ?? height;
	const strips = Math.ceil(height / rowsPerStrip);
	const tags: [number, number, number[]][] = [
		[256, 3, [width]], [257, 3, [height]], [258, 3, Array(samples).fill(8)], [259, 3, [options.compression ?? 1]],
		[262, 3, [samples === 1 ? 1 : 2]], [273, 4, Array(strips).fill(0)], [277, 3, [samples]], [278, 3, [rowsPerStrip]],
		[279, 4, Array.from({ length: strips }, (_, i) => width * samples * Math.min(rowsPerStrip, height - i * rowsPerStrip))], [284, 3, [1]],
		...(options.orientation !== undefined ? [[274, 3, [options.orientation]] as [number, number, number[]]] : []),
		...(options.extra !== undefined ? [[338, 3, [options.extra]] as [number, number, number[]]] : []),
	];
	const ifd = 8, extraAt = ifd + 2 + tags.length * 12 + 4;
	const extra: number[] = [];
	const entries = tags.map(([tag, type, values]) => {
		const size = type === 3 ? 2 : 4;
		if (values.length * size <= 4) return { tag, type, values, at: -1 };
		const at = extraAt + extra.length;
		for (const v of values) for (let k = 0; k < size; k++) extra.push((v >> (8 * k)) & 0xff);
		return { tag, type, values, at };
	});
	const dataAt = extraAt + extra.length;
	const out = new Uint8Array(dataAt + pixels.length);
	const view = new DataView(out.buffer);
	out.set([0x49, 0x49, 42, 0]);
	view.setUint32(4, ifd, true);
	view.setUint16(ifd, tags.length, true);
	out.set(extra, extraAt);
	entries.forEach((entry, i) => {
		const at = ifd + 2 + i * 12;
		view.setUint16(at, entry.tag, true);
		view.setUint16(at + 2, entry.type, true);
		view.setUint32(at + 4, entry.values.length, true);
		let values = entry.values;
		if (entry.tag === 273) values = values.map((_, k) => dataAt + k * width * samples * rowsPerStrip);
		if (entry.at < 0) values.forEach((v, k) => (entry.type === 3 ? view.setUint16(at + 8 + 2 * k, v, true) : view.setUint32(at + 8, v, true)));
		else {
			view.setUint32(at + 8, entry.at, true);
			values.forEach((v, k) => (entry.type === 3 ? view.setUint16(entry.at + 2 * k, v, true) : view.setUint32(entry.at + 4 * k, v, true)));
		}
	});
	view.setUint32(ifd + 2 + tags.length * 12, options.nextPage ? 8 : 0, true);
	out.set(pixels, dataAt);
	return out;
}

/** The pixels of a PNG written by tiffToPng (filter 1 on every row), and its channel count. */
function pixelsOf(png: Uint8Array): { width: number, height: number, channels: number, data: number[] } {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const width = view.getUint32(16), height = view.getUint32(20), channels = { 0: 1, 2: 3, 6: 4 }[png[25]!]!;
	const chunks: Uint8Array[] = [];
	for (let at = 8; at < png.length;) {
		const length = view.getUint32(at);
		if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
		at += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(chunks));
	const row = width * channels, data: number[] = [];
	for (let y = 0; y < height; y++) {
		assert.equal(raw[y * (row + 1)], 1);
		for (let x = 0; x < row; x++) data.push((raw[y * (row + 1) + 1 + x]! + (x >= channels ? data[y * row + x - channels]! : 0)) & 0xff);
	}
	return { width, height, channels, data };
}

const RGB = [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 200, 100, 50, 1, 2, 3];

test('an uncompressed RGB TIF becomes a PNG with the same pixels, in one strip or several', async () => {
	for (const rowsPerStrip of [3, 1]) {
		const png = await tiffToPng(tiff(2, 3, 3, RGB, { rowsPerStrip }));
		assert.deepEqual(pixelsOf(png!), { width: 2, height: 3, channels: 3, data: RGB });
	}
});

test('an alpha channel opaque everywhere is dropped; a see-through one is kept, unless premultiplied', async () => {
	const rgba = (alpha: number) => RGB.flatMap((v, i) => (i % 3 === 2 ? [v, alpha] : [v]));
	assert.deepEqual(pixelsOf((await tiffToPng(tiff(2, 3, 4, rgba(255), { extra: 1 })))!), { width: 2, height: 3, channels: 3, data: RGB });
	assert.deepEqual(pixelsOf((await tiffToPng(tiff(2, 3, 4, rgba(128), { extra: 2 })))!).data, rgba(128));
	assert.equal(await tiffToPng(tiff(2, 3, 4, rgba(128), { extra: 1 })), undefined);
	// A fourth sample of no stated use (padding) is not transparency: left out, the picture stays visible (§11.5 item 79).
	assert.deepEqual(pixelsOf((await tiffToPng(tiff(2, 3, 4, rgba(0), { extra: 0 })))!), { width: 2, height: 3, channels: 3, data: RGB });
});

test('a TIF of another kind (compressed, several pages), or not a TIF, is left as it was', async () => {
	assert.equal(await tiffToPng(tiff(2, 3, 3, RGB, { compression: 5 })), undefined);
	assert.equal(await tiffToPng(tiff(2, 3, 3, RGB, { nextPage: true })), undefined);
	// Turned or mirrored: left as it was, not written another way round.
	assert.equal(await tiffToPng(tiff(2, 3, 3, RGB, { orientation: 6 })), undefined);
	assert.ok(await tiffToPng(tiff(2, 3, 3, RGB, { orientation: 1 })));
	assert.equal(await tiffToPng(new TextEncoder().encode('not a picture')), undefined);
	assert.equal(await tiffToPng(tiff(2, 3, 3, RGB).subarray(0, 60)), undefined);
});
