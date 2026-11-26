// Downloading one OneDrive file with fetch: streamed to disk, resumed after a broken connection,
// started again when the file changes underneath (Internal-10 §19), cancellable. A local server
// stands in for OneDrive's download host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFile, DownloadError } from '../src/node/fetch-download.ts';
import type { DownloadFileOptions, FileLink } from '../src/node/fetch-download.ts';

function bytes(length: number, seed: number): Uint8Array {
	const out = new Uint8Array(length);
	let x = seed;
	for (let i = 0; i < length; i++) {
		x = (x * 1103515245 + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

/** What the next request gets instead of the normal answer. */
type Hook = (req: IncomingMessage, res: ServerResponse, host: Host) => boolean;

interface Host {
	version: { eTag: string, body: Uint8Array };
	requests: { range?: string }[];
	hooks: Hook[];
	url: string;
	link(): Promise<FileLink>;
	close(): Promise<void>;
}

function rangeOf(req: IncomingMessage, size: number): { start: number, end: number } | undefined {
	const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
	if (!match) return undefined;
	return { start: Number(match[1]), end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 };
}

/** The normal answer: the current version, in three writes; 206 for a Range. */
function serve(req: IncomingMessage, res: ServerResponse, host: Host, cut?: number, stall = false): void {
	const { eTag, body } = host.version;
	const range = rangeOf(req, body.length);
	const part = range ? body.subarray(range.start, range.end + 1) : body;
	res.writeHead(range ? 206 : 200, { 'Content-Length': part.length, ETag: eTag, 'Accept-Ranges': 'bytes' });
	const send = cut === undefined ? part : part.subarray(0, cut);
	const third = Math.ceil(send.length / 3);
	res.write(send.subarray(0, third));
	res.write(send.subarray(third, 2 * third));
	// A cut connection: what was sent arrives, then the connection breaks before the rest.
	res.write(send.subarray(2 * third), () => {
		if (cut !== undefined && !stall) setTimeout(() => res.socket?.destroy(), 20);
	});
	if (cut === undefined) res.end();
}

async function host(size = 200_000): Promise<Host> {
	const h: Host = {
		version: { eTag: '"{F},1"', body: bytes(size, 1) },
		requests: [],
		hooks: [],
		url: '',
		link: async () => ({ url: `${h.url}/file`, size: h.version.body.length, eTag: h.version.eTag }),
		close: () => new Promise(resolve => server.close(() => resolve())),
	};
	const server = createServer((req, res) => {
		h.requests.push({ range: req.headers.range as string | undefined });
		const hook = h.hooks.shift();
		if (hook && hook(req, res, h)) return;
		serve(req, res, h);
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	h.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const close = h.close;
	h.close = async () => {
		server.closeAllConnections();
		await close();
	};
	return h;
}

function setup(h: Host, extra: Partial<DownloadFileOptions> = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'ferry-dl-'));
	const part = join(dir, 'file.part');
	const options: DownloadFileOptions = { fetch, link: h.link, part, sleep: async () => undefined, idleMs: 400, ...extra };
	return { dir, part, options, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a file arrives whole, as OneDrive has it', async () => {
	const h = await host();
	const t = setup(h);
	try {
		const seen: number[] = [];
		const result = await downloadFile({ ...t.options, onProgress: bytes => seen.push(bytes) });
		assert.deepEqual(result, { size: 200_000, eTag: '"{F},1"', restarts: 0, retries: 0 });
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
		assert.equal(seen.at(-1), 200_000);
		assert.equal(h.requests[0]!.range, undefined);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a broken connection is resumed from the bytes that arrived, with the same version', async () => {
	const h = await host();
	h.hooks.push((req, res, host) => {
		serve(req, res, host, 70_000);
		return true;
	});
	const t = setup(h);
	try {
		const result = await downloadFile(t.options);
		assert.equal(result.retries, 1);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
		assert.equal(h.requests[1]!.range, `bytes=${70_000}-`);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a connection that stops sending is given up after the idle time and resumed', async () => {
	const h = await host();
	h.hooks.push((req, res, host) => {
		serve(req, res, host, 50_000, true);
		return true;
	});
	const t = setup(h, { idleMs: 300 });
	try {
		const started = Date.now();
		await downloadFile(t.options);
		assert.ok(Date.now() - started >= 250);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
		assert.equal(h.requests[1]!.range, `bytes=${50_000}-`);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a file changed during the download is started again, never put together from two versions', async () => {
	const h = await host();
	// The first answer breaks off; meanwhile OneNote saves a new version (the link now serves it).
	h.hooks.push((req, res, host) => {
		serve(req, res, host, 80_000);
		host.version = { eTag: '"{F},2"', body: bytes(210_000, 2) };
		return true;
	});
	const t = setup(h);
	try {
		const result = await downloadFile(t.options);
		assert.equal(result.eTag, '"{F},2"');
		assert.equal(result.restarts, 1);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
		// Started again from the first byte, not resumed into the old version's part.
		assert.equal(h.requests.at(-1)!.range, undefined);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('an answer of another version than the one asked for is not written', async () => {
	const h = await host();
	const t = setup(h);
	// The listing said version 1; by the first request OneDrive already has version 2.
	const old = await h.link();
	h.version = { eTag: '"{F},2"', body: bytes(200_000, 3) };
	let first = true;
	try {
		const result = await downloadFile({ ...t.options, link: async () => first ? (first = false, old) : h.link() });
		assert.equal(result.eTag, '"{F},2"');
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a file that keeps changing is given up, saying so', async () => {
	const h = await host();
	for (let i = 0; i < 6; i++) {
		h.hooks.push((req, res, host) => {
			serve(req, res, host, 10_000);
			host.version = { eTag: `"{F},${10 + i}"`, body: bytes(200_000, 10 + i) };
			return true;
		});
	}
	const t = setup(h);
	try {
		await assert.rejects(downloadFile({ ...t.options, maxRestarts: 2 }), (error: unknown) => error instanceof DownloadError && error.problem === 'changing');
	}
	finally {
		t.done();
		await h.close();
	}
});

test('an expired or refused link is replaced by a fresh one', async () => {
	const h = await host();
	h.hooks.push((_req, res) => {
		res.writeHead(401, { 'Content-Type': 'text/html' });
		res.end('<html>expired</html>');
		return true;
	});
	let links = 0;
	const t = setup(h);
	try {
		await downloadFile({ ...t.options, link: async () => (links++, h.link()) });
		assert.equal(links, 2, 'asked for at the start and after the refusal; the answers\' ETags vouch for the version');
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('answers that do not say their version: Graph is asked at the end, and a change starts it again', async () => {
	const h = await host();
	h.hooks.push((_req, res, host) => {
		res.writeHead(200, { 'Content-Length': host.version.body.length });
		res.end(host.version.body);
		// Saved again in OneNote right after this answer.
		host.version = { eTag: '"{F},2"', body: bytes(150_000, 4) };
		return true;
	});
	h.hooks.push((_req, res, host) => {
		res.writeHead(200, { 'Content-Length': host.version.body.length });
		res.end(host.version.body);
		return true;
	});
	const t = setup(h);
	try {
		const result = await downloadFile(t.options);
		assert.deepEqual([result.eTag, result.restarts], ['"{F},2"', 1]);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('OneDrive busy: waits as long as it says, then goes on', async () => {
	const h = await host();
	h.hooks.push((_req, res) => {
		res.writeHead(429, { 'Retry-After': '7' });
		res.end();
		return true;
	});
	const waits: number[] = [];
	const t = setup(h, { sleep: async ms => void waits.push(ms) });
	try {
		await downloadFile(t.options);
		assert.deepEqual(waits, [7000]);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a server that ignores Range sends the whole file again, and that is what is kept', async () => {
	const h = await host();
	h.hooks.push((req, res, host) => {
		serve(req, res, host, 60_000);
		return true;
	});
	h.hooks.push((_req, res, host) => {
		res.writeHead(200, { 'Content-Length': host.version.body.length, ETag: host.version.eTag });
		res.end(host.version.body);
		return true;
	});
	const t = setup(h);
	try {
		await downloadFile(t.options);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a part left by an earlier run is resumed when it is of the same version, started over when not', async () => {
	const h = await host();
	const t = setup(h);
	try {
		writeFileSync(t.part, h.version.body.subarray(0, 120_000));
		writeFileSync(`${t.part}.json`, JSON.stringify({ eTag: h.version.eTag, size: 200_000 }));
		await downloadFile(t.options);
		assert.equal(h.requests[0]!.range, 'bytes=120000-');
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);

		writeFileSync(t.part, bytes(120_000, 9));
		writeFileSync(`${t.part}.json`, JSON.stringify({ eTag: '"{F},0"', size: 200_000 }));
		await downloadFile(t.options);
		assert.equal(h.requests.at(-1)!.range, undefined);
		assert.deepEqual(new Uint8Array(readFileSync(t.part)), h.version.body);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a compressed answer or one of the wrong length is refused', async () => {
	const h = await host();
	h.hooks.push((_req, res, host) => {
		res.writeHead(200, { 'Content-Length': host.version.body.length, ETag: host.version.eTag, 'Content-Encoding': 'gzip' });
		res.end(host.version.body);
		return true;
	});
	const t = setup(h);
	try {
		await assert.rejects(downloadFile(t.options), (error: unknown) => error instanceof DownloadError && error.problem === 'failed');
	}
	finally {
		t.done();
		await h.close();
	}
});

test('stopping the download stops it at once', async () => {
	const h = await host(2_000_000);
	h.hooks.push((req, res, host) => {
		serve(req, res, host, 100_000, true);
		return true;
	});
	const controller = new AbortController();
	const t = setup(h, { signal: controller.signal, idleMs: 60_000 });
	try {
		setTimeout(() => controller.abort(), 100);
		const started = Date.now();
		await assert.rejects(downloadFile(t.options), (error: unknown) => error instanceof DownloadError && error.problem === 'cancelled');
		assert.ok(Date.now() - started < 5000);
	}
	finally {
		t.done();
		await h.close();
	}
});

test('a network that stays down is given up after a few tries, saying so', async () => {
	const h = await host();
	const t = setup(h, {});
	const h2 = await host();
	await h2.close();
	try {
		// The server is gone: every request fails to connect.
		await assert.rejects(downloadFile({ ...t.options, link: async () => ({ url: `${h2.url}/file`, size: 10, eTag: '"x"' }), maxAttempts: 3 }),
			(error: unknown) => error instanceof DownloadError && error.problem === 'unreachable');
	}
	finally {
		t.done();
		await h.close();
	}
});
