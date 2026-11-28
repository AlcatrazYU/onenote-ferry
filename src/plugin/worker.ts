// Runs in a Web Worker inside Obsidian, where Node integration is on: reading the download, the
// parser (WebAssembly) and the whole conversion of a section happen here, so that Obsidian's
// window never waits for them. Files are written by the window (Obsidian's vault lives there):
// every write is a message to it, answered when the file is written.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DownloadSection } from '../core/download.ts';
import { convertSection } from '../core/importer.ts';
import type { SectionHost, SectionOptions } from '../core/importer.ts';
import type { Sink } from '../core/io.ts';
import { STRINGS } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { scannedPages } from '../core/sync.ts';
import type { ScannedPage } from '../core/sync.ts';
import { openDownload, parseWithWasm, passwordProtected } from '../node/download.ts';
import type { Download, WasmParser } from '../node/download.ts';
import { fileSink } from '../node/file-sink.ts';
import { copyOf } from './bytes.ts';
import type { OpenedDownload, SinkCall, ToWorker } from './protocol.ts';

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
		const copy = copyOf(bytes);
		return callWindow('writeBinary', [path, copy], [copy.buffer]);
	},
	readText: path => callWindow('readText', [path]),
	listFiles: folder => callWindow('listFiles', [folder]),
};

/**
 * The private folder the window made for this worker (and removes when it stops it, however it
 * stops). Each download gets a folder in it for its temporary copies, made only when one is needed.
 */
let scratchRoot = '';
let scratchCount = 0;

/** Open downloads by their path, each with its scratch folder for temporary copies. */
const downloads = new Map<string, { download: Download, scratch: string }>();

async function opened(input: string): Promise<Download> {
	const open = downloads.get(input);
	if (open) return open.download;
	if (!scratchRoot) throw new Error('the converter has no scratch folder');
	const scratch = join(scratchRoot, String(scratchCount++));
	try {
		const download = await openDownload(input, join(scratch, 'zip'), true, data => parser().tocNames!(data));
		downloads.set(input, { download, scratch });
		return download;
	}
	catch (error) {
		rmSync(scratch, { recursive: true, force: true });
		throw error;
	}
}

/** Closes the open downloads of these paths (all of them when none are given), with their temporary copies. */
function closeAll(inputs?: string[]): void {
	for (const input of inputs ?? [...downloads.keys()]) {
		const open = downloads.get(input);
		if (!open) continue;
		downloads.delete(input);
		try {
			open.download.close();
		}
		finally {
			rmSync(open.scratch, { recursive: true, force: true });
		}
	}
}

/** An update's section goes straight into its staging folder outside the vault; an import's into the vault, through the window. */
const hostFor = (download: Download, staging?: string): SectionHost => ({
	sink: staging ? fileSink(staging) : sink,
	parse: section => parseWithWasm(parser(), download, section),
	isPasswordProtected: section => passwordProtected(download, section),
});

async function handle(message: ToWorker): Promise<unknown> {
	switch (message.type) {
		case 'init': {
			scratchRoot = message.scratch;
			(globalThis as { __ONENOTE_FERRY_WASM__?: Uint8Array }).__ONENOTE_FERRY_WASM__ = new Uint8Array(message.wasm);
			const started = performance.now();
			parser();
			return { startMs: performance.now() - started };
		}
		case 'open': {
			const download = await opened(message.input);
			return { notebooks: download.notebooks, incomplete: download.incomplete } satisfies OpenedDownload;
		}
		case 'locked': {
			const download = await opened(message.input);
			const locked: string[] = [];
			for (const section of download.notebooks.flatMap(notebook => notebook.sections)) {
				if (section.incomplete) continue;
				if (await passwordProtected(download, section).catch(() => false)) locked.push(section.path);
			}
			return locked;
		}
		case 'scan': {
			const download = await opened(message.input);
			const parsed = await parseWithWasm(parser(), download, message.section as DownloadSection);
			try {
				return await scannedPages(parsed.json) satisfies ScannedPage[];
			}
			finally {
				parsed.release();
			}
		}
		case 'convert': {
			const download = await opened(message.input);
			const names = message.names ? { names: new Map(message.names.names), taken: new Set(message.names.taken) } : undefined;
			return convertSection(message.section as DownloadSection, message.dir, STRINGS[message.language as Language], hostFor(download, message.staging), message.options as SectionOptions, names);
		}
		case 'forget':
			closeAll([message.input]);
			return null;
		case 'close':
			closeAll();
			return null;
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
