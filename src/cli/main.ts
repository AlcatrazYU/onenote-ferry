// Command line: converts OneDrive-downloaded notebooks into Markdown.
//
//   node src/cli/main.ts <download> <output folder> [options]
//
// <download> is the zip OneDrive gives, or a folder: one that holds notebook
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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { DownloadSection } from '../core/download.ts';
import { importNotebooks, scanNotebook } from '../core/importer.ts';
import type { ImportHost, ParsedSection } from '../core/importer.ts';
import type { SectionSource, Sink } from '../core/io.ts';
import { writeReport } from '../core/report.ts';
import { STRINGS, isLanguage, LANGUAGES, markerLanguageFor } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { planNotebook, readArchive, scannedPages } from '../core/sync.ts';
import type { Archive, NotebookPlan, PagePlan, PlanItem, ScannedSection } from '../core/sync.ts';
import { notebookFolder } from '../core/write.ts';
import { incompleteZipMessage, openDownload, parseWithWasm, passwordProtected } from '../node/download.ts';
import type { WasmParser } from '../node/download.ts';

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
		async writeText(path, text, modified) {
			mkdirSync(dirname(resolve(path)), { recursive: true });
			writeFileSync(resolve(path), text);
			if (modified) utimesSync(resolve(path), modified, modified);
		},
		async writeBinary(path, bytes) {
			mkdirSync(dirname(resolve(path)), { recursive: true });
			writeFileSync(resolve(path), bytes);
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
		async stat(path) {
			try {
				const info = statSync(resolve(path));
				return info.isFile() ? { mtime: info.mtimeMs, size: info.size } : undefined;
			}
			catch {
				return undefined;
			}
		},
	};
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
	if (download.incomplete) console.warn(incompleteZipMessage(download.incomplete));
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
				if (wasm) return parseWithWasm(wasm, download, section);
				const path = await download.parserPath(section);
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
		const sectionOptions = { boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor, imageAltText: options.imageAltText };
		const result = await importNotebooks(notebooks, host, { languageFor: notebook => fixed ?? languages.get(notebook.name)!, ...sectionOptions, links: options.links });
		if (result.links) console.log(`Links: ${result.links.resolved} of ${result.links.links} rewritten, ${result.links.unresolved} left as they were`);
		if (existsSync(jsonPath)) rmSync(jsonPath);
		const seconds = Math.round((Date.now() - started) / 1000);
		await writeReport(sink, strings, result, { at: new Date(started), sources: [basename(options.input)], seconds, options: sectionOptions }, await host.listFolders());
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
	if (download.incomplete) console.warn(incompleteZipMessage(download.incomplete));
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

		const plans: { notebook: string, identity: NotebookPlan['identity'], items: PlanItem[] }[] = [];
		for (const notebook of download.notebooks) {
			const name = notebook.name;
			if (options.only && !options.only.includes(name)) continue;
			// The notebook's folder in the language it was imported in (its contents page says which).
			let archive: Archive | undefined;
			for (const language of given ? [given] : [SYSTEM_LANGUAGE, ...LANGUAGES]) {
				archive = await readArchive(sink, notebookFolder(name, STRINGS[language]));
				if (archive) break;
			}
			const strings = STRINGS[given ?? archive?.language ?? SYSTEM_LANGUAGE];
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
			const { identity, items } = planNotebook(name, scanned, archive, strings, { partial: options.partial });
			plans.push({ notebook: name, identity, items });
			if (identity === 'different') console.log(`  [different notebook] ${name}: a notebook of this name is in the folder, with no page in common`);
			for (const item of items) {
				if (item.status === 'same') continue;
				const edited = [...item.modified, ...item.removed, ...item.reordered].filter(page => page.userEdited).length;
				const detail = [['added', item.added], ['modified', item.modified], ['removed', item.removed], ['reordered', item.reordered]]
					.filter(([, list]) => (list as PagePlan[]).length > 0).map(([label, list]) => `${label} ${(list as PagePlan[]).length}`)
					.concat(edited ? [`edited in the vault ${edited}`] : [], item.older ? ['older than the vault'] : []).join(', ');
				const moved = item.old && item.new && item.old.normalize('NFC').toLowerCase() !== item.new.normalize('NFC').toLowerCase();
				console.log(`  [${item.status}] ${item.key}${moved ? ` (was ${item.old})` : ''}${detail ? `: ${detail}` : ''}${item.error ? `: ${item.error}` : ''}`);
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
