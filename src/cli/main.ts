// Command line: converts OneDrive-downloaded notebooks into Markdown.
//
//   node src/cli/main.ts <download> <output folder> [options]
//
// <download> is the zip OneDrive gives (no need to unzip it), or a folder: one that holds notebook
// folders (as downloaded from OneDrive, unzipped), or one notebook folder.
// Sections are parsed by the WebAssembly build of the parser (npm run build:parser), or by the
// native `dump` binary when --dump is given (folders only).
// Options:
//   --dump <path>        use the native parser binary instead of WebAssembly
//   --parser-wasm <dir>  where the WebAssembly build is (default: build/parser-wasm)
//   --tmp <dir>          where to make this run's private scratch folder (default: the system temp
//                        folder); the scratch folder is removed at the end
//   --only "A|B"         convert only these notebooks (exact names)
//   --language <code>    language of inserted marks and folder names: en, zh-Hans, zh-Hant, ja, ko
//                        (default: the system's language, English when it has no marks of its own),
//                        or auto: each notebook's own language, read from its text first
//   --no-box-markers     no position comments before text boxes
//   --no-links           leave onenote: links between pages as they are
//   --no-font-color      drop font colours
//   --image-alt-text     write images' alternative text in a collapsed callout below them
//
//   node src/cli/main.ts plan <new download> <converted output folder> [options]
//
// Compares a new download with an earlier conversion and lists, per section, what is new, changed,
// unchanged or gone. Changes nothing. Options: --partial (the download holds only some sections:
// missing ones are not gone), --only, --language (by default each notebook's, read from the
// earlier conversion's folder names), --json <file>, --dump, --parser-wasm, --tmp.

import { closeSync, createReadStream, createWriteStream, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findNotebooks } from '../core/download.ts';
import type { DownloadFile, DownloadNotebook, DownloadSection } from '../core/download.ts';
import { ENCRYPTION_MARKER_WINDOW, isPasswordProtected } from '../core/encryption.ts';
import { importNotebooks, scanNotebook } from '../core/importer.ts';
import type { ImportHost, ParsedSection } from '../core/importer.ts';
import type { SectionSource, Sink } from '../core/io.ts';
import { STRINGS, isLanguage, LANGUAGES, markerLanguageFor } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { archiveLanguage, planNotebook, readArchive, scannedPages } from '../core/sync.ts';
import type { PlanItem, ScannedSection } from '../core/sync.ts';
import { notebookFolder } from '../core/write.ts';
import { entryDataOffset, readZipDirectory, scanZipEntries, ZipFormatError } from '../core/zip.ts';
import type { RandomAccessFile, ZipEntry } from '../core/zip.ts';

/** The marks for the person running the command: the system's language. */
const SYSTEM_LANGUAGE = markerLanguageFor(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale);

function parseArgs(argv: string[]) {
	const args = [...argv];
	const option = (name: string) => {
		const i = args.indexOf(name);
		if (i < 0) return undefined;
		const value = args[i + 1];
		args.splice(i, 2);
		return value;
	};
	const flag = (name: string) => {
		const i = args.indexOf(name);
		if (i < 0) return false;
		args.splice(i, 1);
		return true;
	};
	const parsed = {
		dump: option('--dump'),
		parserWasm: option('--parser-wasm') ?? fileURLToPath(new URL('../../build/parser-wasm', import.meta.url)),
		tmp: option('--tmp') ?? tmpdir(),
		only: option('--only')?.split('|').filter(Boolean),
		language: option('--language') ?? SYSTEM_LANGUAGE,
		languageGiven: false,
		boxMarkers: !flag('--no-box-markers'),
		keepFontColor: !flag('--no-font-color'),
		imageAltText: flag('--image-alt-text'),
		links: !flag('--no-links'),
		partial: flag('--partial'),
		json: option('--json'),
		input: '',
		output: '',
	};
	parsed.languageGiven = argv.includes('--language');
	[parsed.input, parsed.output] = args;
	return parsed;
}

function fileSink(root: string): Sink {
	const resolve = (path: string) => join(root, ...path.split('/'));
	return {
		async ensureFolder(path) {
			mkdirSync(resolve(path), { recursive: true });
		},
		async writeText(path, text) {
			mkdirSync(dirname(resolve(path)), { recursive: true });
			writeFileSync(resolve(path), text);
		},
		async writeBinary(path, bytes) {
			mkdirSync(dirname(resolve(path)), { recursive: true });
			writeFileSync(resolve(path), bytes);
		},
		async setModifiedTime(path, time) {
			utimesSync(resolve(path), time, time);
		},
		async readText(path) {
			try {
				return readFileSync(resolve(path), 'utf8');
			}
			catch {
				return undefined;
			}
		},
		async listFiles(folder) {
			const start = resolve(folder);
			if (!existsSync(start)) return [];
			return (readdirSync(start, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
				.filter(entry => entry.isFile())
				.map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
		},
	};
}

/** The WebAssembly parser (`parser/ferry`, built for Node). */
interface WasmParser {
	parseSection(path: string): { takeJson(): string; readAsset(key: string): Uint8Array; free(): void };
}

function loadWasmParser(dir: string): WasmParser {
	const file = join(dir, 'ferry.js');
	if (!existsSync(file)) {
		console.error(`No WebAssembly parser at ${dir}. Build it with: npm run build:parser (or pass --dump <native parser>)`);
		process.exit(2);
	}
	return createRequire(import.meta.url)(file) as WasmParser;
}

function folderSource(dir: string): SectionSource {
	return {
		async readAsset(key) {
			return readFileSync(join(dir, key));
		},
	};
}

/** Where the parser reads a section: a file, or (for a zip) a byte range the parser is told about. */
interface Download {
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
const ranges: Map<string, { file: string, offset: number, length: number }> = (globalThis as any).__ONENOTE_FERRY_RANGES__ ??= new Map();

function fileAccess(path: string): RandomAccessFile & { close(): void } {
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

function listFolder(root: string): DownloadFile[] {
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

async function openDownload(input: string, tmp: string, inPlace: boolean): Promise<Download> {
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

/**
 * This run's scratch folder: new, with a random name and only the user's own access (mkdtemp), so
 * nobody else on the machine can put files or links in it beforehand. Removed when the run ends.
 */
function scratchFolder(base: string): string {
	mkdirSync(base, { recursive: true });
	const folder = mkdtempSync(join(base, 'onenote-ferry-'));
	process.on('exit', () => rmSync(folder, { recursive: true, force: true }));
	return folder;
}

/** Whether a section file is password protected (see core/encryption.ts). */
async function passwordProtected(download: Download, section: DownloadSection): Promise<boolean> {
	return isPasswordProtected(await download.head(section, ENCRYPTION_MARKER_WINDOW));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.input || !options.output) {
		console.error('Usage: node src/cli/main.ts <download zip or folder> <output folder> [--dump <native parser>] [--parser-wasm DIR] [--tmp DIR] [--only "A|B"] [--language CODE] [--no-box-markers] [--no-font-color] [--no-links] [--image-alt-text]');
		process.exit(2);
	}
	if (options.language !== 'auto' && !isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: auto, ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	const fixed = options.language === 'auto' ? undefined : options.language as Language;
	// The report and anything not tied to one notebook: the reader's language.
	const strings = STRINGS[fixed ?? SYSTEM_LANGUAGE];
	const sink = fileSink(options.output);
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	const scratch = scratchFolder(options.tmp);
	const rawDir = join(scratch, 'raw');
	const jsonPath = join(scratch, 'section.json');
	const started = Date.now();
	const download = await openDownload(options.input, join(scratch, 'zip'), !!wasm);
	try {
		const notebooks = download.notebooks.filter(notebook => !options.only || options.only.includes(notebook.name));
		if (notebooks.length === 0) {
			console.error(download.notebooks.length === 0
				? `No OneNote notebooks found in ${options.input}.`
				: `No notebook named ${options.only!.map(name => `"${name}"`).join(' or ')}. The download holds: ${download.notebooks.map(n => `"${n.name}"`).join(', ')}.`);
			process.exitCode = 1;
			return;
		}

		const host: ImportHost = {
			sink,
			async parse(section): Promise<ParsedSection> {
				const path = await download.parserPath(section);
				if (wasm) {
					let parsed;
					try {
						parsed = wasm.parseSection(path);
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
				rmSync(rawDir, { recursive: true, force: true });
				mkdirSync(rawDir, { recursive: true });
				const result = spawnSync(options.dump!, [path, jsonPath, rawDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
				if (result.status !== 0) {
					download.done(section);
					throw new Error((result.stderr || String(result.error)).trim());
				}
				const release = () => {
					rmSync(rawDir, { recursive: true, force: true });
					download.done(section);
				};
				let json;
				try {
					json = JSON.parse(readFileSync(jsonPath, 'utf8'));
				}
				catch (error) {
					release();
					throw error;
				}
				return { json, source: folderSource(rawDir), release };
			},
			isPasswordProtected: section => passwordProtected(download, section),
			async listFolders() {
				if (!existsSync(options.output)) return [];
				return readdirSync(options.output).filter(name => statSync(join(options.output, name), { throwIfNoEntry: false })?.isDirectory());
			},
			onProgress({ notebook, section }) {
				if (section === notebooks.find(n => n.name === notebook)?.sections[0]) console.log(`Notebook "${notebook}"`);
			},
			onSectionDone(_notebook, section, result) {
				const state = result.locked ? result.error : result.error ? `failed: ${result.error}` : `${result.report!.pageCount} pages, ${result.report!.attachments} attachments`;
				console.log(`  ${[...section.groups, `${section.label}.one`].join(' / ')}: ${state}`);
			},
		};
		const languages = new Map<string, Language>();
		if (!fixed) {
			for (const notebook of notebooks) {
				const scan = await scanNotebook(notebook, host);
				languages.set(notebook.name, scan.language ?? SYSTEM_LANGUAGE);
				console.log(`Notebook "${notebook.name}": ${scan.language ?? 'too little text to tell'}`);
			}
		}
		const result = await importNotebooks(notebooks, host, {
			stringsFor: notebook => STRINGS[fixed ?? languages.get(notebook.name)!],
			boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor, imageAltText: options.imageAltText, links: options.links,
		});
		if (result.links) console.log(`Links: ${result.links.resolved} of ${result.links.links} rewritten, ${result.links.unresolved} left as they were`);
		if (existsSync(jsonPath)) rmSync(jsonPath);
		const summary = result.notebooks.map(notebook => ({ notebook: notebook.notebook, sections: notebook.sections }));
		await sink.writeText(strings.reportFileName, JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), links: result.links, notebooks: summary }, null, 2));
		console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
	}
	finally {
		download.close();
	}
}

async function plan(argv: string[]) {
	const options = parseArgs(argv);
	if (!options.input || !options.output) {
		console.error('Usage: node src/cli/main.ts plan <new download zip or folder> <converted output folder> [--partial] [--only "A|B"] [--language CODE] [--json FILE] [--dump <native parser>]');
		process.exit(2);
	}
	if (options.language !== 'auto' && !isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: auto, ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	// Each notebook is compared in the language it was converted in (its folder names say which),
	// unless --language names one.
	const given = options.languageGiven && options.language !== 'auto' ? options.language as Language : undefined;
	const sink = fileSink(options.output);
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	const scratch = scratchFolder(options.tmp);
	const jsonPath = join(scratch, 'scan.json');
	const download = await openDownload(options.input, join(scratch, 'zip'), !!wasm);
	try {

		// Page ids, titles and modification times only: attachments are not read out.
		async function readSection(section: DownloadSection): Promise<any> {
			const path = await download.parserPath(section);
			try {
				if (wasm) {
					const parsed = wasm.parseSection(path);
					try {
						return JSON.parse(parsed.takeJson());
					}
					finally {
						parsed.free();
					}
				}
				const result = spawnSync(options.dump!, [path, jsonPath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
				if (result.status !== 0) throw new Error((result.stderr || String(result.error)).trim().slice(0, 500));
				return JSON.parse(readFileSync(jsonPath, 'utf8'));
			}
			finally {
				download.done(section);
			}
		}

		const plans: { notebook: string, items: PlanItem[] }[] = [];
		for (const notebook of download.notebooks) {
			const name = notebook.name;
			if (options.only && !options.only.includes(name)) continue;
			const strings = STRINGS[given ?? await archiveLanguage(sink, notebookFolder(name, STRINGS[SYSTEM_LANGUAGE])) ?? SYSTEM_LANGUAGE];
			const scanned: ScannedSection[] = [];
			for (const section of notebook.sections) {
				const key = [name, ...section.groups, section.label].join('/');
				if (section.incomplete) {
					scanned.push({ key, groups: section.groups, label: section.label, error: strings.incompleteSection });
					continue;
				}
				try {
					scanned.push({ key, groups: section.groups, label: section.label, pages: scannedPages(await readSection(section)) });
				}
				catch (error) {
					const locked = await passwordProtected(download, section).catch(() => false);
					scanned.push({ key, groups: section.groups, label: section.label, error: locked ? strings.passwordProtected : String((error as Error)?.message ?? error).slice(0, 500) });
				}
			}
			const archive = await readArchive(sink, notebookFolder(name, strings), strings);
			const items = planNotebook(name, scanned, archive, strings, options.partial);
			plans.push({ notebook: name, items });
			for (const item of items) {
				if (item.status === 'same') continue;
				const detail = [['added', item.added], ['modified', item.modified], ['removed', item.removed]]
					.filter(([, list]) => list && (list as string[]).length > 0).map(([label, list]) => `${label} ${(list as string[]).length}`).join(', ');
				console.log(`  [${item.status}] ${item.key}${item.old && item.new && item.old.normalize('NFC') !== item.new.normalize('NFC') ? ` (was ${item.old})` : ''}${detail ? `: ${detail}` : ''}${item.error ? `: ${item.error}` : ''}`);
			}
		}
		const totals: Record<string, number> = {};
		for (const p of plans) for (const item of p.items) totals[item.status] = (totals[item.status] ?? 0) + 1;
		console.log(`Plan: ${Object.entries(totals).map(([status, n]) => `${n} ${status}`).join(', ') || 'nothing to compare'}`);
		if (options.json) writeFileSync(options.json, JSON.stringify(plans, null, 2));
	}
	finally {
		download.close();
	}
}

(process.argv[2] === 'plan' ? plan(process.argv.slice(3)) : main()).catch(error => {
	console.error(error);
	process.exit(1);
});
