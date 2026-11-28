// The window's side of the worker: starts it from the code and WebAssembly bundled into main.js,
// sends it requests, and does the vault writes it asks for.

import type * as Fs from 'node:fs';
import type * as Os from 'node:os';
import type * as Path from 'node:path';
import workerSource from 'onenote-ferry:worker';
import wasmBase64 from 'onenote-ferry:wasm';
import { CabFormatError } from '../core/cab.ts';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import type { SectionNames, SectionOptions, SectionResult } from '../core/importer.ts';
import type { Sink } from '../core/io.ts';
import type { Language } from '../core/strings.ts';
import type { ScannedPage } from '../core/sync.ts';
import type { FromWorker, OpenedDownload, SinkCall, ToWorker } from './protocol.ts';

type Request = ToWorker extends infer T ? T extends { id: number } ? Omit<T, 'id'> : never : never;

declare const require: {
	(id: 'fs'): typeof Fs;
	(id: 'os'): typeof Os;
	(id: 'path'): typeof Path;
};

/** The worker's scratch folders in the system's temporary folder (the command line names its own differently). */
const SCRATCH_PREFIX = 'onenote-ferry-worker-';
const DAY = 24 * 60 * 60 * 1000;

/** Why the worker stopped: asked to (or replaced), failed, or the plugin was turned off. */
export type StopReason = 'stopped' | 'crashed' | 'unloaded';

/** A request that failed because the worker stopped, not because of what it was asked. */
export class ConverterStopped extends Error {
	readonly reason: StopReason;
	readonly detail?: string;

	constructor(reason: StopReason, detail?: string) {
		super(detail ? `the converter ${reason}: ${detail}` : `the converter ${reason}`);
		this.reason = reason;
		this.detail = detail;
	}
}

function decodeBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export class WorkerClient {
	private worker?: Worker;
	private workerUrl?: string;
	private nextId = 1;
	/** Requests not answered yet; all are rejected when the worker stops or fails. */
	private readonly pending = new Map<number, { resolve(value: unknown): void, reject(error: Error): void }>();
	/** The worker's private folder for temporary copies, removed whenever the worker stops. */
	private scratch?: string;
	/** Where the worker's writes go while an import runs. */
	sink?: Sink;

	/** Removes scratch folders a worker left behind more than a day ago (Obsidian quit during an import, say). */
	static sweep(): void {
		try {
			const fs = require('fs'), os = require('os'), path = require('path');
			const dir: string = os.tmpdir();
			for (const name of fs.readdirSync(dir)) {
				if (!name.startsWith(SCRATCH_PREFIX)) continue;
				const full = path.join(dir, name);
				try {
					if (Date.now() - fs.statSync(full).mtimeMs > DAY) fs.rmSync(full, { recursive: true, force: true });
				}
				catch {
					// In use or gone: left for next time.
				}
			}
		}
		catch {
			// No temporary folder to look at: nothing to do.
		}
	}

	get running(): boolean {
		return this.worker !== undefined;
	}

	/** Starts the worker and the parser in it. */
	async start(): Promise<void> {
		this.stop();
		const fs = require('fs'), os = require('os'), path = require('path');
		const scratch: string = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
		this.scratch = scratch;
		const wasm = decodeBase64(wasmBase64);
		this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		worker.onmessage = event => this.onMessage(event.data as FromWorker);
		// A worker that fails (or runs out of memory) answers nothing more: every waiting request fails with it.
		worker.onerror = event => this.stop('crashed', event.message || undefined);
		await this.request({ type: 'init', wasm: wasm.buffer as ArrayBuffer, scratch }, [wasm.buffer as ArrayBuffer]);
	}

	/**
	 * Stops the worker, which hands all its memory back, and removes its scratch folder (here, so
	 * that no way of stopping it can leave the folder behind).
	 */
	stop(reason: StopReason = 'stopped', detail?: string): void {
		this.worker?.terminate();
		this.worker = undefined;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = undefined;
		if (this.scratch) {
			try {
				require('fs').rmSync(this.scratch, { recursive: true, force: true });
			}
			catch {
				// A file still held open (Windows): the sweep on a later start removes it.
			}
			this.scratch = undefined;
		}
		for (const request of this.pending.values()) request.reject(new ConverterStopped(reason, detail));
		this.pending.clear();
	}

	private request<T>(message: Request, transfer: Transferable[] = []): Promise<T> {
		const worker = this.worker;
		if (!worker) return Promise.reject(new ConverterStopped('stopped'));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			worker.postMessage({ ...message, id }, transfer);
		});
	}

	private onMessage(message: FromWorker): void {
		if (message.type === 'sink') {
			void this.onSinkCall(message);
			return;
		}
		const request = this.pending.get(message.id);
		if (!request) return;
		this.pending.delete(message.id);
		// A package that cannot be read keeps its kind of problem, for the window to say why in the reader's language.
		if (message.type === 'error') request.reject(message.problem ? new CabFormatError(message.message, message.problem) : new Error(message.message));
		else request.resolve(message.value);
	}

	private async onSinkCall(call: SinkCall): Promise<void> {
		const worker = this.worker;
		try {
			const sink = this.sink;
			if (!sink) throw new Error('no import is running');
			const [a, b, c] = call.args as [string, unknown, unknown];
			let value: unknown;
			switch (call.op) {
				case 'ensureFolder': value = await sink.ensureFolder(a); break;
				case 'writeText': value = await sink.writeText(a, b as string, typeof c === 'number' ? new Date(c) : undefined); break;
				case 'writeBinary': value = await sink.writeBinary(a, b as Uint8Array); break;
				case 'readText': value = await sink.readText(a); break;
				case 'listFiles': value = await sink.listFiles(a); break;
			}
			worker?.postMessage({ type: 'sink-reply', call: call.call, value });
		}
		catch (error) {
			worker?.postMessage({ type: 'sink-reply', call: call.call, error: String((error as Error)?.message ?? error) });
		}
	}

	/** What a download holds (it stays open in the worker until close). */
	open(input: string): Promise<OpenedDownload> {
		return this.request({ type: 'open', input });
	}

	/** Paths of a download's password-protected sections. */
	locked(input: string): Promise<string[]> {
		return this.request({ type: 'locked', input });
	}

	/** OneDrive notebooks' sections in OneNote's order, from the tables of contents in the local copy: each one's section paths. */
	order(input: string, notebooks: DownloadNotebook[]): Promise<string[][]> {
		return this.request({ type: 'order', input, notebooks });
	}

	/** A section's pages (ids, titles, times, levels), in order. */
	scan(input: string, section: DownloadSection): Promise<ScannedPage[]> {
		return this.request({ type: 'scan', input, section });
	}

	/** Converts a section: into the vault through `sink`, or (an update) into `staging`, a folder outside it. */
	convert(input: string, section: DownloadSection, dir: string, language: Language, options: SectionOptions, staging?: { path: string, names: SectionNames }): Promise<SectionResult> {
		const names = staging && { names: [...staging.names.names ?? []], taken: [...staging.names.taken ?? []] };
		return this.request({ type: 'convert', input, section, dir, language, options, ...(staging ? { staging: staging.path, names } : {}) });
	}

	/** Closes one download that changed on disk (with its temporary copies): the next request naming it reads it as it is now. */
	forget(input: string): Promise<void> {
		return this.request({ type: 'forget', input });
	}

	/** Closes every open download (removing the worker's temporary copies). */
	close(): Promise<void> {
		return this.request({ type: 'close' });
	}
}
