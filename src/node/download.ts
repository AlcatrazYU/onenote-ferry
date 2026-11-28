// Reading a OneDrive download on disk with Node: a folder, or a zip read in place (sections stored
// in it go straight to the parser as byte ranges; compressed ones through a temporary copy). Also
// what OneNote for Windows exports (§11.5 item 73): a section (`.one`), or a notebook packaged as
// `.onepkg`, unpacked into a temporary folder the first time one of its sections is needed.
// Shared by the command line and the plugin's worker (Obsidian is desktop only, so Node is there).

import { closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, inflateRawSync } from 'node:zlib';
import { extractCab, readCabIndex } from '../core/cab.ts';
import { findNotebooks, groupsKey, orderByTables, tableFiles } from '../core/download.ts';
import type { DownloadFile, DownloadNotebook, DownloadSection } from '../core/download.ts';
import type { ParsedSection } from '../core/importer.ts';
import { ENCRYPTION_MARKER_WINDOW, isPasswordProtected } from '../core/encryption.ts';
import { entryDataOffset, readZipDirectory, scanZipEntries, ZipFormatError } from '../core/zip.ts';
import type { RandomAccessFile, ZipEntry } from '../core/zip.ts';

/** Where the parser reads a section: a file, or (for a zip) a byte range the parser is told about. */
export interface Download {
	notebooks: DownloadNotebook[];
	/** A zip whose download stopped part way: what arrived whole is read, the rest is missing. */
	incomplete?: IncompleteZip;
	/** A path the parser can open for this section (a temporary copy for a compressed zip entry). */
	parserPath(section: DownloadSection): Promise<string>;
	/** The first bytes of a section, to tell whether it is password protected. */
	head(section: DownloadSection, length: number): Promise<Uint8Array>;
	/** Removes what parserPath made for a section. */
	done(section: DownloadSection): void;
	/** Closes the download and removes every temporary copy. */
	close(): void;
}

export interface IncompleteZip {
	/** Files that arrived whole. */
	files: number;
	/** The file the download stopped inside. */
	cutOff?: string;
	/** Where the zip could no longer be read (a byte offset). */
	lostAt?: number;
}

/** What to tell someone about an incomplete zip (the command line prints it). */
export function incompleteZipMessage(zip: IncompleteZip): string {
	return `The zip is incomplete (the download stopped part way): ${zip.files} ${zip.files === 1 ? 'file' : 'files'} arrived whole${zip.cutOff ? `, it ends inside ${zip.cutOff}` : ''}${zip.lostAt !== undefined ? `, and it could not be read past byte ${zip.lostAt}` : ''}. Sections and notebooks after that are missing; download the zip again to get them.`;
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

/** Tables of contents are small: a larger one is not read, and its folder keeps the order by name. */
const TABLE_LIMIT = 16 * 1024 * 1024;

/**
 * Puts each notebook's sections in the order OneNote shows them, from its tables of contents
 * (§11.5 item 76): `read` gives the bytes of the files asked for, `tocNames` (the parser's) the
 * names a table lists. A table that cannot be read leaves its folder in the order by name.
 */
async function orderSections(notebooks: DownloadNotebook[], files: DownloadFile[], read: (paths: Set<string>) => Promise<Map<string, Uint8Array>>, tocNames: (data: Uint8Array) => string[]): Promise<void> {
	const tables = notebooks.map(notebook => tableFiles(notebook, files));
	const wanted = new Set(tables.flatMap(table => [...table.values()]).filter(path => (files.find(file => file.path === path)?.size ?? 0) <= TABLE_LIMIT));
	if (!wanted.size) return;
	let bytes: Map<string, Uint8Array>;
	try {
		bytes = await read(wanted);
	}
	catch {
		return;
	}
	notebooks.forEach((notebook, i) => {
		const names = new Map<string, string[]>();
		for (const [key, path] of tables[i]!) {
			const data = bytes.get(path);
			if (!data) continue;
			try {
				names.set(key, tocNames(data));
			}
			catch {
				// Unreadable: this folder keeps the order by name.
			}
		}
		orderByTables(notebook, groups => names.get(groupsKey(groups)));
	});
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

/**
 * What a download is like on disk now, so that one changed since it was read is told (§11.5 item
 * 83): a file's size and time; a folder's sections and tables of contents, each with its size and
 * time. With `section` (its path in the download), the file it is read from: in a folder, its own;
 * in a zip or an export, the whole file. Undefined when it is not there any more.
 */
export function downloadStamp(input: string, section?: string): string | undefined {
	const of = (info: { size: number, mtimeMs: number }) => `${info.size}:${info.mtimeMs}`;
	const stat = statSync(input, { throwIfNoEntry: false });
	if (!stat) return undefined;
	if (!stat.isDirectory()) return of(stat);
	if (section !== undefined) {
		const file = statSync(join(input, ...section.split('/')), { throwIfNoEntry: false });
		return file && of(file);
	}
	const parts: string[] = [];
	for (const entry of readdirSync(input, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[]) {
		if (!/\.one(toc2)?$/i.test(entry.name)) continue;
		const path = join(entry.parentPath, entry.name);
		const info = statSync(path, { throwIfNoEntry: false });
		if (info?.isFile()) parts.push(`${relative(input, path).split(sep).join('/')}\u0000${of(info)}`);
	}
	return parts.sort().join('\n');
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

/** The first bytes of a file. */
async function fileHead(path: string, length: number): Promise<Uint8Array> {
	const file = fileAccess(path);
	try {
		return await file.read(0, Math.min(length, file.size));
	}
	finally {
		file.close();
	}
}

/** A section exported by OneNote for Windows: a notebook of that one section, named after it. */
function openSectionFile(input: string): Download {
	const name = basename(input).replace(/\.one$/i, '');
	const section: DownloadSection = { notebook: name, groups: [], label: name, path: basename(input), size: statSync(input).size };
	return {
		notebooks: [{ name, path: '', sections: [section] }],
		parserPath: async () => input,
		head: (_, length) => fileHead(input, length),
		done() {},
		close() {},
	};
}

/**
 * A notebook packaged by OneNote for Windows: its sections are listed from the package's index;
 * the package is unpacked into `tmp` once, when the first section is needed.
 */
async function openPackage(input: string, tmp: string, tocNames?: (data: Uint8Array) => string[]): Promise<Download> {
	const pkg = fileAccess(input);
	let notebooks: DownloadNotebook[];
	try {
		const entries = await readCabIndex(pkg);
		const files = entries.map(entry => ({ path: entry.path, size: entry.size }));
		notebooks = findNotebooks(files, basename(input).replace(/\.onepkg$/i, ''));
		if (tocNames) await orderSections(notebooks, files, async paths => {
			const pieces = new Map<string, Buffer[]>();
			await extractCab(pkg, async (entry, piece) => {
				if (!pieces.has(entry.path)) pieces.set(entry.path, []);
				pieces.get(entry.path)!.push(Buffer.from(piece));
			}, entry => paths.has(entry.path));
			return new Map([...pieces].map(([path, parts]) => [path, new Uint8Array(Buffer.concat(parts))]));
		}, tocNames);
	}
	catch (error) {
		pkg.close();
		throw error;
	}
	const folder = join(tmp, 'package');
	const target = (path: string) => {
		const parts = path.split('/').filter(part => part !== '' && part !== '.');
		// Nothing outside the folder, whatever names the package holds.
		if (!parts.length || parts.includes('..') || /^[A-Za-z]:/.test(parts[0]!)) throw new Error(`The package holds a file with a name that cannot be unpacked: ${path}`);
		return join(folder, ...parts);
	};
	let unpacked: Promise<void> | undefined;
	const unpack = () => unpacked ??= (async () => {
		mkdirSync(folder, { recursive: true });
		const open = new Map<string, number>();
		try {
			await extractCab(pkg, async (entry, piece) => {
				let fd = open.get(entry.path);
				if (fd === undefined) {
					const path = target(entry.path);
					mkdirSync(dirname(path), { recursive: true });
					// Never into a file that is already there (or a link someone left in its place).
					fd = openSync(path, 'wx');
					open.set(entry.path, fd);
				}
				for (let written = 0; written < piece.length;) written += writeSync(fd, piece, written, piece.length - written);
			}, entry => /\.(one|onetoc2)$/i.test(entry.path));
		}
		finally {
			for (const fd of open.values()) closeSync(fd);
		}
	})();
	return {
		notebooks,
		async parserPath(section) {
			await unpack();
			return target(section.path);
		},
		async head(section, length) {
			await unpack();
			return fileHead(target(section.path), length);
		},
		done() {},
		close() {
			pkg.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

/**
 * Opens a download: a zip or folder from the OneDrive website, or what OneNote for Windows exports.
 * With `tocNames` (the parser's), sections come in the order their notebook's tables of contents give.
 */
export async function openDownload(input: string, tmp: string, inPlace: boolean, tocNames?: (data: Uint8Array) => string[]): Promise<Download> {
	if (/\.one$/i.test(input)) return openSectionFile(input);
	if (/\.onepkg$/i.test(input)) return openPackage(input, tmp, tocNames);
	if (!/\.zip$/i.test(input)) {
		const listed = listFolder(input);
		const notebooks = findNotebooks(listed, basename(input));
		if (tocNames) await orderSections(notebooks, listed, async paths => new Map([...paths].map(path => [path, new Uint8Array(readFileSync(join(input, ...path.split('/'))))] as [string, Uint8Array])), tocNames);
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
	let incomplete: IncompleteZip | undefined;
	try {
		try {
			listed = await readZipDirectory(zip);
		}
		catch (error) {
			if (!(error instanceof ZipFormatError)) throw error;
			// No table of contents: a download that stopped part way. Keep what arrived whole.
			const scanned = await scanZipEntries(zip);
			listed = scanned.entries;
			cutOff = scanned.cutOff;
			incomplete = { files: listed.filter(entry => !entry.name.endsWith('/')).length, cutOff, lostAt: scanned.lostAt };
		}
	}
	catch (error) {
		// Not a zip that can be read at all: nothing stays open.
		zip.close();
		throw error;
	}
	for (const entry of listed) if (!entry.name.endsWith('/')) entries.set(entry.name, entry);
	const files: DownloadFile[] = [...entries.values()].map(entry => ({ path: entry.name, size: entry.size }));
	if (cutOff && !entries.has(cutOff)) files.push({ path: cutOff, size: 0, incomplete: true });
	const notebooks = findNotebooks(files, basename(input).replace(/\.zip$/i, ''));
	if (tocNames) await orderSections(notebooks, files, async paths => {
		const out = new Map<string, Uint8Array>();
		for (const path of paths) {
			const entry = entries.get(path);
			if (!entry || (entry.method !== 0 && entry.method !== 8) || entry.compressedSize > TABLE_LIMIT) continue;
			const offset = await entryDataOffset(zip, entry);
			const stored = await zip.read(offset, entry.compressedSize);
			// Inflated no further than the limit: a table that says it is small but is not (§11.5 item 79) is left out.
			try {
				out.set(path, entry.method === 0 ? stored : new Uint8Array(inflateRawSync(stored, { maxOutputLength: TABLE_LIMIT })));
			}
			catch {
				continue;
			}
		}
		return out;
	}, tocNames);
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
		if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip entry ${entry.name} uses compression method ${entry.method}`);
		// A temporary copy, in a folder of its own so it keeps the section's file name.
		const folder = join(tmp, String(copyCount++));
		const copy = join(folder, basename(section.path));
		mkdirSync(folder, { recursive: true });
		const source = createReadStream(input, { start: offset, end: offset + entry.compressedSize - 1 });
		// Never into a file that is already there (or a link someone left in its place).
		if (entry.method === 0) await pipeline(source, createWriteStream(copy, { flags: 'wx' }));
		else await pipeline(source, createInflateRaw(), createWriteStream(copy, { flags: 'wx' }));
		copies.set(section.path, copy);
		return copy;
	};
	return {
		notebooks,
		incomplete,
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
	parseSection(path: string): { takeJson(): string; readAsset(key: string): Uint8Array; rowProfile?(key: string): Float32Array | undefined; free(): void };
	/** The names a table of contents (its bytes) lists, in OneNote's order; empty when it cannot be read. */
	tocNames?(data: Uint8Array): string[];
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
	return {
		json,
		source: {
			async readAsset(key) { return parsed.readAsset(key); },
			async rowProfile(key) { return parsed.rowProfile?.(key) ?? undefined; },
		},
		release,
	};
}
