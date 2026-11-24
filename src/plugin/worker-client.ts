// The window's side of the worker: starts it from the code and WebAssembly bundled into main.js,
// sends it requests, and does the vault writes it asks for.

import workerSource from 'onenote-ferry:worker';
import wasmBase64 from 'onenote-ferry:wasm';
import type { DownloadNotebook, DownloadSection } from '../core/download.ts';
import type { NotebookScan, SectionOptions, SectionResult } from '../core/importer.ts';
import type { Sink } from '../core/io.ts';
import type { Language } from '../core/strings.ts';
import type { FromWorker, SinkCall, ToWorker } from './protocol.ts';

type Request = ToWorker extends infer T ? T extends { id: number } ? Omit<T, 'id'> : never : never;

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
	private readonly pending = new Map<number, { resolve(value: any): void, reject(error: Error): void }>();
	/** Where the worker's writes go while an import runs. */
	sink?: Sink;

	get running(): boolean {
		return this.worker !== undefined;
	}

	/** Starts the worker and the parser in it. */
	async start(): Promise<void> {
		this.stop();
		const wasm = decodeBase64(wasmBase64);
		this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		worker.onmessage = event => this.onMessage(event.data as FromWorker);
		// A worker that fails (or runs out of memory) answers nothing more: every waiting request fails with it.
		worker.onerror = event => this.stop(`the converter stopped: ${event.message || 'unknown error'}`);
		await this.request({ type: 'init', wasm: wasm.buffer as ArrayBuffer }, [wasm.buffer as ArrayBuffer]);
	}

	/** Stops the worker, which hands all its memory back. */
	stop(reason = 'the converter was stopped'): void {
		this.worker?.terminate();
		this.worker = undefined;
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = undefined;
		for (const request of this.pending.values()) request.reject(new Error(reason));
		this.pending.clear();
	}

	private request<T>(message: Request, transfer: Transferable[] = []): Promise<T> {
		const worker = this.worker;
		if (!worker) return Promise.reject(new Error('the converter is not running'));
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
		if (message.type === 'error') request.reject(new Error(message.message));
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

	open(input: string): Promise<DownloadNotebook[]> {
		return this.request({ type: 'open', input });
	}

	scan(notebook: string): Promise<NotebookScan> {
		return this.request({ type: 'scan', notebook });
	}

	convert(section: DownloadSection, notebookDir: string, language: Language, options: SectionOptions): Promise<SectionResult> {
		return this.request({ type: 'convert', section, notebookDir, language, options });
	}

	close(): Promise<void> {
		return this.request({ type: 'close' });
	}

	memory(): Promise<{ wasmBytes: number }> {
		return this.request({ type: 'memory' });
	}
}
