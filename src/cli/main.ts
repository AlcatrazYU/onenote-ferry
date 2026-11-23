// Command line: converts a folder of OneDrive-downloaded notebooks into Markdown.
//
//   node src/cli/main.ts <input folder> <output folder> [options]
//
// <input folder> holds notebook folders (as downloaded from OneDrive), or is one notebook folder.
// Sections are parsed by the WebAssembly build of the parser (npm run build:parser), or by the
// native `dump` binary when --dump is given.
// Options:
//   --dump <path>        use the native parser binary instead of WebAssembly
//   --parser-wasm <dir>  where the WebAssembly build is (default: build/parser-wasm)
//   --tmp <dir>          scratch folder for parser output (default: the system temp folder)
//   --only "A|B"         convert only these notebooks (exact names)
//   --language <code>    language of inserted marks and folder names: en, zh-Hans, zh-Hant, ja, ko
//                        (default zh-Hans until per-notebook detection exists)
//   --no-box-markers     no position comments before text boxes
//   --no-links           leave onenote: links between pages as they are
//   --no-font-color      drop font colours
//
//   node src/cli/main.ts plan <new download folder> <converted output folder> [options]
//
// Compares a new download with an earlier conversion and lists, per section, what is new, changed,
// unchanged or gone. Changes nothing. Options: --partial (the download holds only some sections:
// missing ones are not gone), --only, --language (as used for the conversion), --json <file>,
// --dump, --parser-wasm, --tmp.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Adapter } from '../core/adapter.ts';
import type { SectionSource, Sink } from '../core/io.ts';
import { joinPath, nameCollator } from '../core/names.ts';
import { STRINGS, isLanguage, LANGUAGES } from '../core/strings.ts';
import { buildLinkIndex, relinkPages } from '../core/links.ts';
import type { SectionRef } from '../core/links.ts';
import { planNotebook, readArchive, scannedPages } from '../core/sync.ts';
import type { PlanItem, ScannedSection } from '../core/sync.ts';
import { notebookFolder, notebookToc, sectionFolder, writeSection } from '../core/write.ts';
import type { NotebookTocEntry, SectionReport } from '../core/write.ts';

const RECYCLE_BIN = 'OneNote_RecycleBin';

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
		tmp: option('--tmp') ?? join(tmpdir(), 'onenote-ferry'),
		only: option('--only')?.split('|').filter(Boolean),
		language: option('--language') ?? 'zh-Hans',
		boxMarkers: !flag('--no-box-markers'),
		keepFontColor: !flag('--no-font-color'),
		links: !flag('--no-links'),
		partial: flag('--partial'),
		json: option('--json'),
		input: '',
		output: '',
	};
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

const isFolder = (path: string) => {
	try {
		return statSync(path).isDirectory();
	}
	catch {
		return false;
	}
};
const sectionFiles = (dir: string) => readdirSync(dir).filter(name => /\.one$/i.test(name)).sort(nameCollator.compare);
const groupFolders = (dir: string) => readdirSync(dir)
	.filter(name => name !== RECYCLE_BIN && !name.startsWith('.') && isFolder(join(dir, name)))
	.sort(nameCollator.compare);

/** Notebook folders in an input folder, or the input folder itself when it is one notebook. */
function listNotebooks(input: string): string[] {
	return sectionFiles(input).length > 0 ? [input] : groupFolders(input).map(name => join(input, name));
}

interface SectionResult extends NotebookTocEntry {
	dir?: string;
	report?: SectionReport;
	error?: string;
	stats?: unknown;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.input || !options.output) {
		console.error('Usage: node src/cli/main.ts <input folder> <output folder> [--dump <native parser>] [--parser-wasm DIR] [--tmp DIR] [--only "A|B"] [--language CODE] [--no-box-markers] [--no-font-color] [--no-links]');
		process.exit(2);
	}
	if (!isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	const strings = STRINGS[options.language];
	const sink = fileSink(options.output);
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	mkdirSync(options.tmp, { recursive: true });
	const rawDir = join(options.tmp, 'raw');
	const jsonPath = join(options.tmp, 'section.json');
	const started = Date.now();

	async function convertSection(onePath: string, notebookDir: string, groups: string[]): Promise<SectionResult> {
		const label = basename(onePath).replace(/\.one$/i, '');
		const dir = joinPath(notebookDir, sectionFolder(groups, label, strings));
		await sink.ensureFolder(dir);
		let json: any;
		let source: SectionSource;
		let release = () => {};
		if (wasm) {
			let parsed;
			try {
				parsed = wasm.parseSection(onePath);
			}
			catch (error) {
				return { groups, section: label, failed: true, error: String((error as Error)?.message ?? error).slice(0, 500) };
			}
			json = JSON.parse(parsed.takeJson());
			source = { async readAsset(key) { return parsed.readAsset(key); } };
			release = () => parsed.free();
		}
		else {
			rmSync(rawDir, { recursive: true, force: true });
			mkdirSync(rawDir, { recursive: true });
			const result = spawnSync(options.dump!, [onePath, jsonPath, rawDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
			if (result.status !== 0) {
				return { groups, section: label, failed: true, error: (result.stderr || String(result.error)).trim().slice(0, 500) };
			}
			json = JSON.parse(readFileSync(jsonPath, 'utf8'));
			source = folderSource(rawDir);
			release = () => rmSync(rawDir, { recursive: true, force: true });
		}
		try {
			const adapter = new Adapter(strings);
			const report = await writeSection(adapter.section(json), source, sink, {
				dir, label: json.name || label, strings, boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor,
			});
			return { groups, section: label, dir, report, stats: { parser: json.stats, parserErrors: json.errors, ...adapter.stats } };
		}
		finally {
			release();
		}
	}

	async function walk(dir: string, notebookDir: string, groups: string[], out: SectionResult[]) {
		for (const file of sectionFiles(dir)) {
			const result = await convertSection(join(dir, file), notebookDir, groups);
			out.push(result);
			const state = result.error ? `failed: ${result.error}` : `${result.report!.pageCount} pages, ${result.report!.attachments} attachments`;
			console.log(`  ${[...groups, file].join(' / ')}: ${state}`);
		}
		for (const group of groupFolders(dir)) await walk(join(dir, group), notebookDir, [...groups, group], out);
	}

	const notebooks = listNotebooks(options.input);
	const summary: unknown[] = [];
	const converted: SectionRef[] = [];
	const writtenPages: string[] = [];
	for (const notebookPath of notebooks) {
		const name = basename(notebookPath);
		if (options.only && !options.only.includes(name)) continue;
		console.log(`Notebook "${name}"`);
		const notebookDir = notebookFolder(name, strings);
		await sink.ensureFolder(notebookDir);
		const sections: SectionResult[] = [];
		await walk(notebookPath, notebookDir, [], sections);
		await sink.writeText(joinPath(notebookDir, `${strings.tocFileName}.md`), notebookToc(name, sections, strings));
		summary.push({ notebook: name, sections });
		for (const section of sections) {
			if (!section.report || !section.dir) continue;
			converted.push({ source: [name, ...section.groups, section.section].map(s => s.normalize('NFC')), toc: joinPath(section.dir, `${strings.tocFileName}.md`) });
			writtenPages.push(...section.report.pages.map(page => joinPath(section.dir!, page.file)));
		}
	}
	let links: unknown;
	if (options.links) {
		// Links can point into any notebook in the output folder, so they are fixed once everything is written.
		const notebookFolders = readdirSync(options.output).filter(name => !name.startsWith('_') && !name.startsWith('.') && isFolder(join(options.output, name))).sort();
		const index = await buildLinkIndex(sink, notebookFolders, converted, strings);
		const stats = await relinkPages(sink, writtenPages, index);
		links = stats;
		console.log(`Links: ${stats.resolved} of ${stats.links} rewritten, ${stats.unresolved} left as they were`);
	}
	if (existsSync(jsonPath)) rmSync(jsonPath);
	await sink.writeText(strings.reportFileName, JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), links, notebooks: summary }, null, 2));
	console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
}

async function plan(argv: string[]) {
	const options = parseArgs(argv);
	if (!options.input || !options.output) {
		console.error('Usage: node src/cli/main.ts plan <new download folder> <converted output folder> [--partial] [--only "A|B"] [--language CODE] [--json FILE] [--dump <native parser>]');
		process.exit(2);
	}
	if (!isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	const strings = STRINGS[options.language];
	const sink = fileSink(options.output);
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	mkdirSync(options.tmp, { recursive: true });
	const jsonPath = join(options.tmp, 'scan.json');

	// Page ids, titles and modification times only: attachments are not read out.
	function readSection(onePath: string): any {
		if (wasm) {
			const parsed = wasm.parseSection(onePath);
			try {
				return JSON.parse(parsed.takeJson());
			}
			finally {
				parsed.free();
			}
		}
		const result = spawnSync(options.dump!, [onePath, jsonPath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		if (result.status !== 0) throw new Error((result.stderr || String(result.error)).trim().slice(0, 500));
		return JSON.parse(readFileSync(jsonPath, 'utf8'));
	}

	const plans: { notebook: string, items: PlanItem[] }[] = [];
	for (const notebookPath of listNotebooks(options.input)) {
		const name = basename(notebookPath);
		if (options.only && !options.only.includes(name)) continue;
		const scanned: ScannedSection[] = [];
		const walk = (dir: string, groups: string[]) => {
			for (const file of sectionFiles(dir)) {
				const label = file.replace(/\.one$/i, '');
				const key = [name, ...groups, label].join('/');
				try {
					scanned.push({ key, groups, label, pages: scannedPages(readSection(join(dir, file))) });
				}
				catch (error) {
					scanned.push({ key, groups, label, error: String((error as Error)?.message ?? error).slice(0, 500) });
				}
			}
			for (const group of groupFolders(dir)) walk(join(dir, group), [...groups, group]);
		};
		walk(notebookPath, []);
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

(process.argv[2] === 'plan' ? plan(process.argv.slice(3)) : main()).catch(error => {
	console.error(error);
	process.exit(1);
});
