// Runs in a Web Worker inside Obsidian, where Node integration is on: reading the download, the
// parser (WebAssembly) and the whole conversion of a section happen here, so that Obsidian's
// window never waits for them. Files are written by the window (Obsidian's vault lives there):
// every write is a message to it, answered when the file is written.

import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import { convertSection, scanNotebook } from '../core/importer.ts';
import type { SectionHost, SectionOptions } from '../core/importer.ts';
import type { Sink } from '../core/io.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { openDownload, parseWithWasm, passwordProtected } from '../node/download.ts';
import type { Download, WasmParser } from '../node/download.ts';
import type { SinkCall, ToWorker } from './protocol.ts';

declare const require: (id: string) => any;

let ferry: (WasmParser & { memoryBytes(): number }) | undefined;

/** The parser, started on first use from the WebAssembly bytes the plugin handed over. */
function parser(): WasmParser & { memoryBytes(): number } {
	if (!ferry) ferry = require('../../build/parser-wasm/ferry.js');
	return ferry!;
}

function post(message: unknown, transfer: Transferable[] = []): void {
	(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(message, transfer);
}

// Writes go to the window and come back answered.
let nextCall = 1;
const calls = new Map<number, { resolve(value: any): void, reject(error: Error): void }>();

function callWindow<T>(op: SinkCall['op'], args: unknown[], transfer: Transferable[] = []): Promise<T> {
	const call = nextCall++;
	return new Promise<T>((resolve, reject) => {
		calls.set(call, { resolve, reject });
		post({ type: 'sink', call, op, args }, transfer);
	});
}

const sink: Sink = {
	ensureFolder: path => callWindow('ensureFolder', [path]),
	writeText: (path, text, modified) => callWindow('writeText', [path, text, modified?.getTime()]),
	writeBinary: (path, bytes) => {
		// A copy of its own to hand over: the original may still be needed here.
		const copy = bytes.slice();
		return callWindow('writeBinary', [path, copy], [copy.buffer]);
	},
	readText: path => callWindow('readText', [path]),
	listFiles: folder => callWindow('listFiles', [folder]),
};

let download: Download | undefined;
let scratch: string | undefined;

function closeDownload(): void {
	download?.close();
	download = undefined;
	if (scratch) rmSync(scratch, { recursive: true, force: true });
	scratch = undefined;
}

const host: SectionHost = {
	sink,
	parse: section => parseWithWasm(parser(), download!, section),
	isPasswordProtected: section => passwordProtected(download!, section),
};

async function handle(message: ToWorker): Promise<unknown> {
	switch (message.type) {
		case 'init': {
			(globalThis as { __ONENOTE_FERRY_WASM__?: Uint8Array }).__ONENOTE_FERRY_WASM__ = new Uint8Array(message.wasm);
			const started = performance.now();
			parser();
			return { startMs: performance.now() - started };
		}
		case 'open': {
			closeDownload();
			// A private scratch folder for temporary copies of compressed sections.
			scratch = mkdtempSync(join(tmpdir(), 'onenote-ferry-'));
			download = await openDownload(message.input, join(scratch, 'zip'), true);
			return download.notebooks satisfies DownloadNotebook[];
		}
		case 'scan': {
			const notebook = download!.notebooks.find(n => n.name === message.notebook);
			if (!notebook) throw new Error(`no notebook named ${message.notebook}`);
			return scanNotebook(notebook, host);
		}
		case 'convert':
			return convertSection(message.section as DownloadSection, message.notebookDir, STRINGS[message.language as Language], host, message.options as SectionOptions);
		case 'close':
			closeDownload();
			return null;
		case 'memory':
			return { wasmBytes: ferry ? ferry.memoryBytes() : 0 };
	}
}

self.onmessage = (event: MessageEvent<ToWorker | { type: 'sink-reply', call: number, value?: unknown, error?: string }>) => {
	const message = event.data;
	if (message.type === 'sink-reply') {
		const call = calls.get(message.call);
		calls.delete(message.call);
		if (message.error !== undefined) call?.reject(new Error(message.error));
		else call?.resolve(message.value);
		return;
	}
	handle(message).then(
		value => post({ type: 'reply', id: message.id, value }),
		error => post({ type: 'error', id: message.id, message: String((error as Error)?.message ?? error) }),
	);
};
