// The Obsidian plugin. M2 step 1 (validation): starts the parser in a Web Worker from the
// WebAssembly bundled into main.js, and parses a section given by path.

import { Notice, Plugin, normalizePath } from 'obsidian';
import workerSource from 'onenote-ferry:worker';
import wasmBase64 from 'onenote-ferry:wasm';

declare const require: (id: string) => any;

interface ParseResult {
	jsonLength: number;
	jsonSha1: string;
	assetCount: number;
	assetBytes: number;
	parseMs: number;
	assetsMs: number;
	wasmMiB: number;
}

function decodeBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export default class OneNoteFerryPlugin extends Plugin {
	/** How long onload took, in milliseconds (validation one). */
	loadMs = 0;
	private worker?: Worker;
	private workerUrl?: string;
	private nextId = 1;

	/** What the last validation pick returned (validation three). */
	lastPick?: string;

	async onload(): Promise<void> {
		const started = performance.now();
		this.addCommand({ id: 'validation-pick', name: 'Validation: pick a OneDrive download', callback: () => void this.validatePick() });
		this.loadMs = performance.now() - started;
	}

	/**
	 * Validation three: the system's own open dialog, for zips and folders outside the vault.
	 * Shows the paths it gives back and whether Node can read them.
	 */
	async validatePick(): Promise<void> {
		const { remote } = require('electron');
		const fs = require('fs');
		const result = await remote.dialog.showOpenDialog({
			title: 'OneNote Ferry: pick a OneDrive download (zip or folder)',
			properties: ['openFile', 'openDirectory', 'multiSelections'],
		});
		const picked = (result.filePaths as string[]).map(path => {
			try {
				const stat = fs.statSync(path);
				return { path, kind: stat.isDirectory() ? 'folder' : 'file', mb: Math.round(stat.size / 1048576) };
			}
			catch (error) {
				return { path, error: String(error) };
			}
		});
		this.lastPick = JSON.stringify({ canceled: result.canceled, picked });
		new Notice(result.canceled ? 'Nothing picked.' : picked.map(p => `${p.path} (${'kind' in p ? p.kind : 'unreadable'})`).join('\n'), 15000);
	}

	onunload(): void {
		this.stopWorker();
	}

	private stopWorker(): void {
		this.worker?.terminate();
		this.worker = undefined;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = undefined;
	}

	/** Starts the worker and the parser in it; answers how long each part took. */
	async startWorker(): Promise<{ decodeMs: number, startMs: number }> {
		this.stopWorker();
		const started = performance.now();
		const wasm = decodeBase64(wasmBase64);
		const decodeMs = performance.now() - started;
		this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		const ready = new Promise<{ startMs: number }>((resolve, reject) => {
			worker.onmessage = event => (event.data?.type === 'ready' ? resolve(event.data) : reject(new Error(JSON.stringify(event.data))));
			worker.onerror = event => reject(new Error(event.message));
		});
		worker.postMessage({ type: 'init', wasm: wasm.buffer }, [wasm.buffer]);
		const { startMs } = await ready;
		return { decodeMs: Math.round(decodeMs), startMs: Math.round(startMs) };
	}

	/** Parses one section in the worker, and records the longest stall of Obsidian's window meanwhile. */
	async parseInWorker(path: string): Promise<ParseResult & { longestStallMs: number }> {
		if (!this.worker) await this.startWorker();
		const worker = this.worker!;
		const id = this.nextId++;
		let last = performance.now(), longest = 0;
		const timer = window.setInterval(() => {
			const now = performance.now();
			longest = Math.max(longest, now - last - 50);
			last = now;
		}, 50);
		try {
			const result = await new Promise<ParseResult>((resolve, reject) => {
				worker.onmessage = event => {
					if (event.data?.id !== id) return;
					if (event.data.type === 'parsed') resolve(event.data);
					else reject(new Error(event.data.message));
				};
				worker.postMessage({ type: 'parse', id, path });
			});
			return { ...result, longestStallMs: Math.round(Math.max(0, longest)) };
		}
		finally {
			window.clearInterval(timer);
		}
	}

	/** For validation from the developer console: parse a section and report the timings. */
	async validateParse(path: string): Promise<string> {
		const start = this.worker ? undefined : await this.startWorker();
		const result = await this.parseInWorker(path);
		return JSON.stringify({ start, ...result, loadMs: Math.round(this.loadMs * 1000) / 1000 });
	}

	/** For validation: stop the worker, which hands its memory back. */
	validateStop(): string {
		this.stopWorker();
		return 'stopped';
	}

	/**
	 * For validation two: writes `pages` notes and `pictures` binary files into `folder` through
	 * the vault (or straight through the adapter), `batch` files at a time with a pause between
	 * batches, and reports the time, the window's longest stall and whether modification times stuck.
	 */
	async validateWrite(folder: string, pages: number, pictures: number, pictureKB: number, batch: number, mode: 'vault' | 'adapter'): Promise<string> {
		const vault = this.app.vault;
		const root = normalizePath(folder);
		await vault.createFolder(root).catch(() => undefined);
		const picture = new Uint8Array(pictureKB * 1024).map((_, i) => (i * 31) % 251);
		const page = '---\ntitle: "Sample"\n---\n\n' + 'Invented text for a write test. '.repeat(150);
		const mtime = Date.UTC(2020, 0, 2, 3, 4, 5);
		let last = performance.now(), longest = 0;
		const timer = window.setInterval(() => {
			const now = performance.now();
			longest = Math.max(longest, now - last - 50);
			last = now;
		}, 50);
		const started = performance.now();
		const total = pages + pictures;
		const subfolders = new Set<string>();
		for (let i = 0; i < total; i++) {
			const sub = `${root}/s${Math.floor(i / 500)}`;
			if (!subfolders.has(sub)) {
				subfolders.add(sub);
				if (mode === 'vault') await vault.createFolder(sub).catch(() => undefined);
				else await vault.adapter.mkdir(sub);
			}
			const isPage = i < pages;
			const path = `${sub}/${isPage ? `page ${i}.md` : `picture ${i}.png`}`;
			if (mode === 'vault') {
				if (isPage) await vault.create(path, page, { mtime });
				else await vault.createBinary(path, picture.buffer, { mtime });
			}
			else if (isPage) await vault.adapter.write(path, page, { mtime });
			else await vault.adapter.writeBinary(path, picture.buffer, { mtime });
			if ((i + 1) % batch === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
		}
		const writeMs = performance.now() - started;
		window.clearInterval(timer);
		const probe = `${root}/s0/page 0.md`;
		const stat = await vault.adapter.stat(probe);
		return JSON.stringify({
			mode, files: total, writeMs: Math.round(writeMs), filesPerSecond: Math.round(total / (writeMs / 1000)),
			longestStallMs: Math.round(Math.max(0, longest)), mtimeKept: stat?.mtime === mtime,
			vaultFiles: vault.getFiles().length,
		});
	}
}
