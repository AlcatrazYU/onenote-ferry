// Reading a OneDrive download on disk with Node: a folder, or a zip read in place (sections stored
// in it go straight to the parser as byte ranges; compressed ones through a temporary copy).
// Shared by the command line and the plugin's worker (Obsidian is desktop only, so Node is there).

import { closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { findNotebooks } from '../core/download.ts';
import type { DownloadFile, DownloadNotebook, DownloadSection } from '../core/download.ts';
import type { ParsedSection } from '../core/importer.ts';
import { ENCRYPTION_MARKER_WINDOW, isPasswordProtected } from '../core/encryption.ts';
import { entryDataOffset, readZipDirectory, scanZipEntries, ZipFormatError } from '../core/zip.ts';
import type { RandomAccessFile, ZipEntry } from '../core/zip.ts';

/** Where the parser reads a section: a file, or (for a zip) a byte range the parser is told about. */
export interface Download {
	notebooks: DownloadNotebook[];
	/** A path the parser can open for this section (a temporary copy for a compressed zip entry). */
	parserPath(section: DownloadSection): Promise<string>;
	/** The first bytes of a section, to tell whether it is password protected. */
	head(section: DownloadSection, length: number): Promise<Uint8Array>;
	/** Removes what parserPath made for a section. */
	done(section: DownloadSection): void;
	/** Closes the download and removes every temporary copy. */
	close(): void;
}

/** Byte ranges inside a zip that the WebAssembly parser reads in place (parser/UPSTREAM.md, change 6). */
export const ranges: Map<string, { file: string, offset: number, length: number }> = (globalThis as any).__ONENOTE_FERRY_RANGES__ ??= new Map();

export function fileAccess(path: string): RandomAccessFile & { close(): void } {
	const fd = openSync(path, 'r');
	return {
		size: fstatSync(fd).size,
		async read(offset, length) {
			const buffer = Buffer.alloc(length);
			const n = readSync(fd, buffer, 0, length, offset);
			return new Uint8Array(buffer.buffer, buffer.byteOffset, n);
		},
		close: () => closeSync(fd),
	};
}

export function listFolder(root: string): DownloadFile[] {
	const files: DownloadFile[] = [];
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[]) {
		const path = join(entry.parentPath, entry.name);
		// A symbolic link counts as what it points to, as it did for the parser.
		const stat = entry.isSymbolicLink() ? statSync(path, { throwIfNoEntry: false }) : undefined;
		if (entry.isFile() || stat?.isFile()) files.push({ path: relative(root, path).split(sep).join('/'), size: (stat ?? statSync(path)).size });
	}
	return files;
}

/** The first bytes of a compressed zip entry, inflated in memory (enough to tell a password-protected section). */
async function inflatedHead(path: string, offset: number, compressedSize: number, length: number): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	let total = 0;
	const inflate = createInflateRaw();
	const source = createReadStream(path, { start: offset, end: offset + compressedSize - 1 });
	try {
		await new Promise<void>((resolve, reject) => {
			inflate.on('data', (chunk: Buffer) => {
				chunks.push(chunk);
				total += chunk.length;
				if (total >= length) resolve();
			});
			inflate.on('end', resolve);
			inflate.on('error', reject);
			source.on('error', reject);
			source.pipe(inflate);
		});
	}
	finally {
		source.destroy();
		inflate.destroy();
	}
	return new Uint8Array(Buffer.concat(chunks).subarray(0, length));
}

export async function openDownload(input: string, tmp: string, inPlace: boolean): Promise<Download> {
	if (!/\.zip$/i.test(input)) {
		const notebooks = findNotebooks(listFolder(input), basename(input));
		return {
			notebooks,
			parserPath: async section => join(input, ...section.path.split('/')),
			async head(section, length) {
				const file = fileAccess(join(input, ...section.path.split('/')));
				try {
					return await file.read(0, Math.min(length, file.size));
				}
				finally {
					file.close();
				}
			},
			done() {},
			close() {},
		};
	}
	const zip = fileAccess(input);
	const entries = new Map<string, ZipEntry>();
	let listed: ZipEntry[];
	let cutOff: string | undefined;
	try {
		listed = await readZipDirectory(zip);
	}
	catch (error) {
		if (!(error instanceof ZipFormatError)) throw error;
		// No table of contents: a download that stopped part way. Keep what arrived whole.
		const scanned = await scanZipEntries(zip);
		listed = scanned.entries;
		cutOff = scanned.cutOff;
		console.warn(`The zip is incomplete (the download stopped part way): ${listed.filter(entry => !entry.name.endsWith('/')).length} files arrived whole${cutOff ? `, it ends inside ${cutOff}` : ''}${scanned.lostAt !== undefined ? `, and it could not be read past byte ${scanned.lostAt}` : ''}. Sections and notebooks after that are missing: download them again.`);
	}
	for (const entry of listed) if (!entry.name.endsWith('/')) entries.set(entry.name, entry);
	const files: DownloadFile[] = [...entries.values()].map(entry => ({ path: entry.name, size: entry.size }));
	if (cutOff && !entries.has(cutOff)) files.push({ path: cutOff, size: 0, incomplete: true });
	const notebooks = findNotebooks(files, basename(input).replace(/\.zip$/i, ''));
	const copies = new Map<string, string>();
	let copyCount = 0;
	const parserPath = async (section: DownloadSection): Promise<string> => {
		const entry = entries.get(section.path)!;
		const offset = await entryDataOffset(zip, entry);
		if (entry.method === 0 && inPlace) {
			// Read in place; the name ends with the section's file name, which the parser uses.
			const name = `${input}/${section.path}`;
			ranges.set(name, { file: input, offset, length: entry.size });
			return name;
		}
		// A temporary copy, in a folder of its own so it keeps the section's file name.
		const folder = join(tmp, String(copyCount++));
		const copy = join(folder, basename(section.path));
		mkdirSync(folder, { recursive: true });
		const source = createReadStream(input, { start: offset, end: offset + entry.compressedSize - 1 });
		// Never into a file that is already there (or a link someone left in its place).
		if (entry.method === 0) await pipeline(source, createWriteStream(copy, { flags: 'wx' }));
		else if (entry.method === 8) await pipeline(source, createInflateRaw(), createWriteStream(copy, { flags: 'wx' }));
		else throw new Error(`zip entry ${entry.name} uses compression method ${entry.method}`);
		copies.set(section.path, copy);
		return copy;
	};
	return {
		notebooks,
		parserPath,
		async head(section, length) {
			const entry = entries.get(section.path);
			if (!entry) return new Uint8Array(0);
			const offset = await entryDataOffset(zip, entry);
			if (entry.method === 0) return zip.read(offset, Math.min(length, entry.size));
			if (entry.method === 8) return inflatedHead(input, offset, entry.compressedSize, length);
			return new Uint8Array(0);
		},
		done(section) {
			ranges.delete(`${input}/${section.path}`);
			const copy = copies.get(section.path);
			if (copy) rmSync(dirname(copy), { recursive: true, force: true });
			copies.delete(section.path);
		},
		close() {
			zip.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}


/** Whether a section file is password protected (see core/encryption.ts). */
export async function passwordProtected(download: Download, section: DownloadSection): Promise<boolean> {
	return isPasswordProtected(await download.head(section, ENCRYPTION_MARKER_WINDOW));
}

/** The WebAssembly parser (`parser/ferry`, built for Node). */
export interface WasmParser {
	parseSection(path: string): { takeJson(): string; readAsset(key: string): Uint8Array; free(): void };
}

/** Parses a section of a download with the WebAssembly parser; release() frees it and its temporary copy. */
export async function parseWithWasm(parser: WasmParser, download: Download, section: DownloadSection): Promise<ParsedSection> {
	const path = await download.parserPath(section);
	let parsed: ReturnType<WasmParser['parseSection']>;
	try {
		parsed = parser.parseSection(path);
	}
	catch (error) {
		download.done(section);
		throw error;
	}
	const release = () => {
		parsed.free();
		download.done(section);
	};
	let json;
	try {
		json = JSON.parse(parsed.takeJson());
	}
	catch (error) {
		release();
		throw error;
	}
	return { json, source: { async readAsset(key) { return parsed.readAsset(key); } }, release };
}
