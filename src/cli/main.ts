// Command line: converts a folder of OneDrive-downloaded notebooks into Markdown.
//
//   node src/cli/main.ts <input folder> <output folder> --dump <parser binary> [options]
//
// <input folder> holds notebook folders (as downloaded from OneDrive), or is one notebook folder.
// Options:
//   --dump <path>        the native section parser (`dump`); a WebAssembly build replaces it later
//   --tmp <dir>          scratch folder for parser output (default: the system temp folder)
//   --only "A|B"         convert only these notebooks (exact names)
//   --language <code>    language of inserted marks and folder names: en, zh-Hans, zh-Hant, ja, ko
//                        (default zh-Hans until per-notebook detection exists)
//   --no-box-markers     no position comments before text boxes
//   --no-font-color      drop font colours

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Adapter } from '../core/adapter.ts';
import type { SectionSource, Sink } from '../core/io.ts';
import { joinPath, nameCollator } from '../core/names.ts';
import { STRINGS, isLanguage, LANGUAGES } from '../core/strings.ts';
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
		tmp: option('--tmp') ?? join(tmpdir(), 'onenote-ferry'),
		only: option('--only')?.split('|').filter(Boolean),
		language: option('--language') ?? 'zh-Hans',
		boxMarkers: !flag('--no-box-markers'),
		keepFontColor: !flag('--no-font-color'),
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
	};
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

interface SectionResult extends NotebookTocEntry {
	report?: SectionReport;
	error?: string;
	stats?: unknown;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.input || !options.output || !options.dump) {
		console.error('Usage: node src/cli/main.ts <input folder> <output folder> --dump <parser> [--tmp DIR] [--only "A|B"] [--language CODE] [--no-box-markers] [--no-font-color]');
		process.exit(2);
	}
	if (!isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	const strings = STRINGS[options.language];
	const sink = fileSink(options.output);
	mkdirSync(options.tmp, { recursive: true });
	const rawDir = join(options.tmp, 'raw');
	const jsonPath = join(options.tmp, 'section.json');
	const started = Date.now();

	async function convertSection(onePath: string, notebookDir: string, groups: string[]): Promise<SectionResult> {
		const label = basename(onePath).replace(/\.one$/i, '');
		const dir = joinPath(notebookDir, sectionFolder(groups, label, strings));
		rmSync(rawDir, { recursive: true, force: true });
		mkdirSync(rawDir, { recursive: true });
		await sink.ensureFolder(dir);
		const result = spawnSync(options.dump!, [onePath, jsonPath, rawDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		if (result.status !== 0) {
			return { groups, section: label, failed: true, error: (result.stderr || String(result.error)).trim().slice(0, 500) };
		}
		const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
		const adapter = new Adapter(strings);
		const report = await writeSection(adapter.section(json), folderSource(rawDir), sink, {
			dir, label: json.name || label, strings, boxMarkers: options.boxMarkers, keepFontColor: options.keepFontColor,
		});
		rmSync(rawDir, { recursive: true, force: true });
		return { groups, section: label, report, stats: { parser: json.stats, parserErrors: json.errors, ...adapter.stats } };
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

	const notebooks = sectionFiles(options.input).length > 0
		? [options.input]
		: groupFolders(options.input).map(name => join(options.input, name));
	const summary: unknown[] = [];
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
	}
	if (existsSync(jsonPath)) rmSync(jsonPath);
	await sink.writeText(strings.reportFileName, JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), notebooks: summary }, null, 2));
	console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
