// Messages between the plugin (Obsidian's window) and its worker.

import type { PackageProblem } from '../core/cab.ts';
import type { DownloadNotebook } from '../core/download.ts';
import type { IncompleteZip } from '../node/download.ts';

/** What a download holds, as the worker reads it. */
export interface OpenedDownload {
	notebooks: DownloadNotebook[];
	incomplete?: IncompleteZip;
}

/** What the window asks the worker; each carries an id the answer repeats. */
export type ToWorker =
	| { type: 'init', id: number, wasm: ArrayBuffer, scratch: string }
	/**
	 * Opens a download (a zip or a folder) and answers what it holds. Every request below names
	 * its download; one not open yet is opened first, so a fresh worker carries on where the
	 * last one stopped.
	 */
	| { type: 'open', id: number, input: string }
	/** Paths of the sections that are password protected (a quick look at each section's first bytes). */
	| { type: 'locked', id: number, input: string }
	/** Page ids, titles, times and levels of one section, in order (ScannedPage[]): nothing else is read out. */
	| { type: 'scan', id: number, input: string, section: unknown }
	/**
	 * Converts one section. Its files come back as sink calls, or, with `staging` (an update), go
	 * straight into that folder outside the vault; `names` keeps the file names an earlier import gave.
	 */
	| { type: 'convert', id: number, input: string, section: unknown, dir: string, language: string, options: unknown, staging?: string, names?: WireNames }
	/**
	 * Notebooks listed from OneDrive's file lists (DownloadNotebook[]), their sections put in OneNote's
	 * order from the tables of contents in the local copy `input`: answers each one's section paths (string[][]).
	 */
	| { type: 'order', id: number, input: string, notebooks: unknown }
	/** Closes one download, which changed on disk: the next request naming it opens it again. */
	| { type: 'forget', id: number, input: string }
	/** Closes every open download. */
	| { type: 'close', id: number };

/** SectionNames as a message carries them. */
export interface WireNames {
	names: [string, string][];
	taken: string[];
}

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
	/** `problem`: a `.onepkg` that cannot be read, and why (CabFormatError's kind). */
	| { type: 'error', id: number, message: string, problem?: PackageProblem }
	| SinkCall;
