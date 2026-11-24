// Messages between the plugin (Obsidian's window) and its worker.

/** What the window asks the worker; each carries an id the answer repeats. */
export type ToWorker =
	| { type: 'init', id: number, wasm: ArrayBuffer }
	/** Opens a download (a zip or a folder) and answers its notebooks. */
	| { type: 'open', id: number, input: string }
	/** The preview of one notebook of the open download. */
	| { type: 'scan', id: number, notebook: string }
	/** Converts one section; files come back as sink calls. */
	| { type: 'convert', id: number, section: unknown, notebookDir: string, language: string, options: unknown }
	| { type: 'close', id: number }
	| { type: 'memory', id: number };

/** A write (or read) the worker asks the window to do in the vault. */
export interface SinkCall {
	type: 'sink';
	call: number;
	op: 'ensureFolder' | 'writeText' | 'writeBinary' | 'readText' | 'listFiles';
	args: unknown[];
}

/** What the worker sends: answers, and sink calls. */
export type FromWorker =
	| { type: 'reply', id: number, value: unknown }
	| { type: 'error', id: number, message: string }
	| SinkCall;
