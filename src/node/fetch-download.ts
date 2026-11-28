// Downloading one OneDrive file to disk (§11.5 item 62): streamed with fetch, each piece written
// before the next is read, so memory stays flat however large the file; cancellable; resumed with
// Range after a network error. Measured in Obsidian (Internal-10 §14, §19):
// - A download link lasts about an hour, and always serves the file as it is now, not as it was
//   when the link was given. A file changed during a download in pieces comes out half old, half
//   new, and the parser reads it without complaint. So every answer's ETag must be the one the
//   download started with, and the file's version is checked again at the end.
// - Switching Wi-Fi off makes the read fail at once, or leaves it hanging until a timer catches it
//   (both seen); when the system says the network is back, a silent connection is given up at once
//   and the pause before the next try is cut short (whenOnline).
// - OneDrive gives no content hash for OneNote files: size, ETag and version are what can be checked.
// - Content-Range cannot be read from a browser (not exposed to CORS); status and length can.

import { open, rm, stat, readFile, writeFile } from 'node:fs/promises';

/** Where to download a file from, and which version that is. */
export interface FileLink {
	/** A pre-authenticated download URL: no sign-in header is sent with it. */
	url: string;
	size: number;
	eTag: string;
}

export interface DownloadFileOptions {
	/** The fetch to use (the window's, in Obsidian). */
	fetch: typeof globalThis.fetch;
	/** A fresh link and the file's current version (asked from Graph each time). */
	link(): Promise<FileLink>;
	/** Where the file is written as it arrives; `<part>.json` records which version it holds. */
	part: string;
	signal?: AbortSignal;
	/** No byte for this long counts as a broken connection. */
	idleMs?: number;
	/** Network errors in a row before giving up. */
	maxAttempts?: number;
	/** Times the file may change under the download before giving up. */
	maxRestarts?: number;
	/** Bytes received so far (of this file), as they come. */
	onProgress?(bytes: number, size: number): void;
	sleep?: (ms: number) => Promise<void>;
	/**
	 * Calls `callback` whenever the system says the network is back (the window's online event);
	 * answers a function that stops it. A connection silent for a moment is then given up at once,
	 * and the pause before the next try ends, rather than waiting out the idle time and the pause.
	 */
	whenOnline?(callback: () => void): () => void;
}

/** When the network is back, a connection silent this long is taken for broken (one still sending is left alone). */
const SILENT_WHEN_ONLINE_MS = 1000;

export type DownloadProblem =
	/** Stopped by the caller. */
	| 'cancelled'
	/** The file kept changing in OneDrive while it was being downloaded. */
	| 'changing'
	/** The network or OneDrive failed too many times in a row. */
	| 'unreachable'
	/** OneDrive answered something that cannot be right (a compressed body, a wrong length). */
	| 'failed';

export class DownloadError extends Error {
	readonly problem: DownloadProblem;
	constructor(problem: DownloadProblem, detail = '') {
		super(detail ? `${problem}: ${detail}` : problem);
		this.name = 'DownloadError';
		this.problem = problem;
	}
}

/** The file changed in OneDrive: start again from its first byte. */
class Changed extends Error {}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface PartRecord {
	eTag: string;
	size: number;
}

async function partState(part: string, link: FileLink): Promise<number> {
	try {
		const record = JSON.parse(await readFile(`${part}.json`, 'utf8')) as PartRecord;
		const { size } = await stat(part);
		if (record.eTag === link.eTag && record.size === link.size && size <= link.size) return size;
	}
	catch {
		// No part yet, or a record that cannot be read: start afresh.
	}
	await writeFile(part, new Uint8Array(0));
	await writeFile(`${part}.json`, JSON.stringify({ eTag: link.eTag, size: link.size } satisfies PartRecord));
	return 0;
}

/**
 * Downloads a file into `part`, resuming what is there when it is of the same version. Resolves
 * once `part` holds the whole file and OneDrive still has that version; throws DownloadError.
 */
export async function downloadFile(options: DownloadFileOptions): Promise<{ size: number, eTag: string, restarts: number, retries: number }> {
	const { part, signal } = options;
	const idleMs = options.idleMs ?? 30_000;
	const maxAttempts = options.maxAttempts ?? 6;
	const maxRestarts = options.maxRestarts ?? 3;
	const sleep = options.sleep ?? defaultSleep;
	let restarts = 0;
	let retries = 0;
	let failures = 0;
	const cancelled = () => new DownloadError('cancelled');
	/** A pause before the next try, ended early when the network is back or the download is stopped. */
	const pause = (ms: number) => new Promise<void>(resolve => {
		let over = false;
		let stopWatching: (() => void) | undefined;
		const end = () => {
			if (over) return;
			over = true;
			stopWatching?.();
			signal?.removeEventListener('abort', end);
			resolve();
		};
		signal?.addEventListener('abort', end);
		stopWatching = options.whenOnline?.(end);
		if (over) stopWatching?.();
		void sleep(ms).then(end);
	});

	let link = await options.link();
	let offset = await partState(part, link);
	/** An answer came without an ETag: the version is checked with Graph at the end instead. */
	let untagged = false;
	/** The file changed under the download: start it again from the first byte, of the new version. */
	const restart = async (now?: FileLink) => {
		if (++restarts > maxRestarts) throw new DownloadError('changing', `changed ${restarts} times during the download`);
		link = now ?? await freshLink(options, link);
		offset = await partState(part, link);
		untagged = false;
	};
	for (;;) {
		if (signal?.aborted) throw cancelled();
		const before = offset;
		try {
			if (offset < link.size) {
				const got = await fetchInto(options, link, offset, idleMs);
				offset = got.offset;
				if (!got.tagged) untagged = true;
			}
			if (offset !== link.size) throw new Error(`ended at byte ${offset} of ${link.size}`);
			// Every answer carried the version the download began with: the file is of one version.
			// Otherwise ask Graph whether that is still the version it has.
			if (untagged) {
				const now = await options.link();
				if (now.eTag !== link.eTag || now.size !== link.size) {
					await restart(now);
					continue;
				}
			}
			return { size: link.size, eTag: link.eTag, restarts, retries };
		}
		catch (error) {
			if (signal?.aborted) throw cancelled();
			if (error instanceof DownloadError) throw error;
			if (error instanceof Changed) {
				await restart();
				continue;
			}
			// A network error, a broken or stalled connection, an expired link, OneDrive busy: go on
			// from what reached the disk (the part is written in order, so its size is what arrived).
			offset = (await stat(part)).size;
			failures = offset > before ? 1 : failures + 1;
			if (failures > maxAttempts) throw new DownloadError('unreachable', String((error as Error)?.message ?? error).slice(0, 300));
			retries++;
			// OneDrive's own wait is kept; a pause after a network error ends when the network is back.
			if (error instanceof Busy) await sleep(error.waitMs);
			else await pause(Math.min(30_000, 1000 * 2 ** (failures - 1)));
			if (signal?.aborted) throw cancelled();
			let now: FileLink | undefined;
			try {
				now = await options.link();
			}
			catch {
				// Graph not reachable either: the next round tries the same link again.
			}
			if (now && (now.eTag !== link.eTag || now.size !== link.size)) await restart(now);
			else if (now) link = now;
		}
	}
}

/** OneDrive asked to wait (429 or 503). */
class Busy extends Error {
	readonly waitMs: number;
	constructor(waitMs: number) {
		super(`OneDrive is busy: waiting ${Math.round(waitMs / 1000)} s`);
		this.waitMs = waitMs;
	}
}

async function freshLink(options: DownloadFileOptions, previous: FileLink): Promise<FileLink> {
	try {
		return await options.link();
	}
	catch {
		return previous;
	}
}

/**
 * One request from `offset` to the end, written into the part file as it comes. Answers the new
 * offset (the bytes written) and whether the answer said its version; throws Changed when the
 * answer is of another version.
 */
async function fetchInto(options: DownloadFileOptions, link: FileLink, offset: number, idleMs: number): Promise<{ offset: number, tagged: boolean }> {
	// Opened first: nothing below is left running when the part cannot be opened.
	const handle = await open(options.part, 'r+');
	const controller = new AbortController();
	let stalled = false;
	let last = Date.now();
	const onAbort = () => controller.abort();
	options.signal?.addEventListener('abort', onAbort);
	const watch = setInterval(() => {
		if (Date.now() - last > idleMs) {
			stalled = true;
			controller.abort();
		}
	}, Math.min(1000, idleMs / 2));
	// The network is back: a connection silent for a moment will not wake up (it was cut).
	const stopWatching = options.whenOnline?.(() => {
		if (Date.now() - last > SILENT_WHEN_ONLINE_MS) {
			stalled = true;
			controller.abort();
		}
	});
	try {
		let response: Response;
		try {
			// Not kept in the browser's cache (it would hold the user's notes there); no cookies; no sign-in header.
			const init = { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {}, cache: 'no-store', credentials: 'omit', signal: controller.signal };
			response = await options.fetch(link.url, init as RequestInit);
		}
		catch (error) {
			throw stalled ? new Error(`no answer for ${idleMs / 1000} s`) : error;
		}
		last = Date.now();
		const status = response.status;
		if (status === 429 || status === 503) {
			const after = Number(response.headers.get('retry-after'));
			await response.body?.cancel().catch(() => undefined);
			throw new Busy(Number.isFinite(after) && after > 0 ? Math.min(after, 600) * 1000 : 30_000);
		}
		// The link expired or was refused: the caller asks for a fresh one.
		if (status === 401 || status === 403 || status === 404 || status === 410) {
			await response.body?.cancel().catch(() => undefined);
			throw new Error(`the download link was refused (${status})`);
		}
		if (status !== 206 && status !== 200) {
			await response.body?.cancel().catch(() => undefined);
			throw new Error(`OneDrive answered ${status}`);
		}
		const eTag = response.headers.get('etag');
		if (eTag && eTag !== link.eTag) {
			await response.body?.cancel().catch(() => undefined);
			throw new Changed();
		}
		// The whole file instead of the rest (the server may ignore Range): start the part again.
		if (status === 200 && offset > 0) {
			await handle.truncate(0);
			offset = 0;
		}
		const encoding = response.headers.get('content-encoding');
		if (encoding && encoding !== 'identity') {
			await response.body?.cancel().catch(() => undefined);
			throw new DownloadError('failed', `a compressed answer (${encoding})`);
		}
		const length = Number(response.headers.get('content-length'));
		if (response.headers.has('content-length') && length !== link.size - offset) {
			await response.body?.cancel().catch(() => undefined);
			// Another length than this version's rest: the file changed.
			throw new Changed();
		}
		if (!response.body) throw new Error('an answer without a body');
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				last = Date.now();
				if (offset + value.length > link.size) throw new DownloadError('failed', `more bytes than the file has (${link.size})`);
				// Written before the next piece is read: the network waits for the disk.
				let written = 0;
				while (written < value.length) {
					const { bytesWritten } = await handle.write(value, written, value.length - written, offset + written);
					written += bytesWritten;
				}
				offset += value.length;
				options.onProgress?.(offset, link.size);
			}
		}
		catch (error) {
			await reader.cancel().catch(() => undefined);
			if (error instanceof DownloadError) throw error;
			throw stalled ? new Error(`no data for ${idleMs / 1000} s`) : error;
		}
		return { offset, tagged: !!eTag };
	}
	finally {
		clearInterval(watch);
		stopWatching?.();
		options.signal?.removeEventListener('abort', onAbort);
		await handle.close();
	}
}

/** Removes a part file and its record (the download finished elsewhere, or is no longer wanted). */
export async function removePart(part: string): Promise<void> {
	await rm(part, { force: true });
	await rm(`${part}.json`, { force: true });
}
