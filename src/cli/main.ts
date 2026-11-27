// Command line: converts OneDrive-downloaded notebooks into Markdown.
//
//   node src/cli/main.ts <download> <output folder> [options]
//
// <download> is the zip OneDrive gives, or a folder: one that holds notebook
// folders (as downloaded from OneDrive, unzipped), or one notebook folder. It can
// also be what OneNote for Windows exports: a notebook (.onepkg) or a section (.one).
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
//   --image-alt-text     write images' alternative text in a collapsed callout below them
//
//   node src/cli/main.ts plan <new download> <converted output folder> [options]
//
// Compares a new download with an earlier conversion and lists, per section, what is new, changed,
// unchanged or gone. Changes nothing. Options: --partial (the download holds only some sections:
// missing ones are not gone), --only, --language (by default each notebook's, read from the
// earlier conversion's folder names), --json <file>, --dump, --parser-wasm, --tmp.
//
//   node src/cli/main.ts sync <new download> <converted output folder> [--apply] [options]
//
// Updates an earlier conversion from a new download in place (§11.5 item 49): pages OneNote
// changed, added or removed, sections it renamed or moved; what is replaced goes to the previous
// versions folder, and nothing is deleted; pages OneNote deleted stay where they are, and pages
// deleted in the vault are not written back unless --restore-deleted is given. Without --apply it
// only lists what would change.
// Sections already converted are updated; --new also adds sections not converted before. An
// update cut off before (the command stopped) is finished first. Options: as for plan; --language
// also names the language of the record and of notebooks not converted before.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { DownloadSection } from '../core/download.ts';
import { importNotebooks, scanNotebook } from '../core/importer.ts';
import type { ImportHost, ParsedSection, SectionOptions } from '../core/importer.ts';
import type { SectionSource } from '../core/io.ts';
import { reportedNotebooks, writeReport } from '../core/report.ts';
import { STRINGS, isLanguage, LANGUAGES, markerLanguageFor } from '../core/strings.ts';
import type { Language } from '../core/strings.ts';
import { planNotebook, readArchive, scannedPages } from '../core/sync.ts';
import { recordedPlanOptions, resumeUpdates, unfinishedUpdates, updateNotebooks } from '../core/update.ts';
import type { UpdateHost, UpdateRequest } from '../core/update.ts';
import type { Archive, NotebookPlan, PagePlan, PlanItem, ScannedSection } from '../core/sync.ts';
import { notebookFolder, sectionKey } from '../core/write.ts';
import { incompleteZipMessage, openDownload, parseWithWasm, passwordProtected } from '../node/download.ts';
import { fileSink } from '../node/file-sink.ts';
import { ownStagingRoot, stagingPlaces, stagingRoot } from '../node/staging.ts';
import type { Download, WasmParser } from '../node/download.ts';

/** Paths as the disks of macOS and Windows compare them. */
const fold = (path: string) => path.normalize('NFC').toLowerCase();

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
		imageAltText: flag('--image-alt-text'),
		links: !flag('--no-links'),
		partial: flag('--partial'),
		apply: flag('--apply'),
		addNew: flag('--new'),
		restoreDeleted: flag('--restore-deleted'),
		json: option('--json'),
		input: '',
		output: '',
	};
	parsed.languageGiven = argv.includes('--language');
	[parsed.input, parsed.output] = args;
	return parsed;
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

/** Parses whole sections for converting them: the WebAssembly parser, or the native one (--dump). */
function sectionParser(options: ReturnType<typeof parseArgs>, download: Download, wasm: WasmParser | undefined, scratch: string): Pick<ImportHost, 'parse' | 'isPasswordProtected'> {
	const rawDir = join(scratch, 'raw');
	const jsonPath = join(scratch, 'section.json');
	return {
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
				rmSync(jsonPath, { force: true });
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
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.input || !options.output) {
		console.error('Usage: node src/cli/main.ts <download zip or folder, or a .onepkg or .one exported by OneNote for Windows> <output folder> [--dump <native parser>] [--parser-wasm DIR] [--tmp DIR] [--only "A|B"] [--language CODE] [--no-box-markers] [--no-links] [--image-alt-text]');
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
	// An update cut off in this folder is finished first (it may be in the middle of a section an import would write into).
	const unfinished = await unfinishedUpdates(sink);
	if (unfinished.length) {
		console.error(`An update of this folder was cut off and is not finished (${unfinished.join(', ')}). Run sync with --apply first: it finishes it.`);
		process.exitCode = 1;
		return;
	}
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	const scratch = scratchFolder(options.tmp);
	const started = Date.now();
	const download = await openDownload(options.input, join(scratch, 'zip'), !!wasm, wasm?.tocNames && (data => wasm.tocNames!(data)));
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
			...sectionParser(options, download, wasm, scratch),
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
		const sectionOptions = { boxMarkers: options.boxMarkers, imageAltText: options.imageAltText };
		const result = await importNotebooks(notebooks, host, { languageFor: notebook => fixed ?? languages.get(notebook.name)!, ...sectionOptions, links: options.links });
		if (result.links) console.log(`Links: ${result.links.resolved} of ${result.links.links} rewritten, ${result.links.unresolved} left as they were`);
		const seconds = Math.round((Date.now() - started) / 1000);
		await writeReport(sink, strings, result, { at: new Date(started), sources: [basename(options.input)], seconds, options: sectionOptions }, await host.listFolders());
		console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
	}
	finally {
		download.close();
	}
}

/**
 * plan, and sync: reads each notebook of the new download (page ids, titles and times only),
 * plans it against the output folder and lists what would change; `sync --apply` then updates.
 */
async function plan(argv: string[], command: 'plan' | 'sync') {
	const options = parseArgs(argv);
	if (!options.input || !options.output) {
		console.error(command === 'plan'
			? 'Usage: node src/cli/main.ts plan <new download zip or folder> <converted output folder> [--partial] [--only "A|B"] [--language CODE] [--json FILE] [--dump <native parser>]'
			: 'Usage: node src/cli/main.ts sync <new download zip or folder> <converted output folder> [--apply] [--new] [--restore-deleted] [--partial] [--only "A|B"] [--language CODE] [--json FILE] [--dump <native parser>] [--tmp DIR]');
		process.exit(2);
	}
	if (options.language !== 'auto' && !isLanguage(options.language)) {
		console.error(`Unknown language "${options.language}". Use one of: auto, ${LANGUAGES.join(', ')}`);
		process.exit(2);
	}
	// Each notebook is compared in the language it was converted in (its folder names say which),
	// unless --language names one.
	const given = options.languageGiven && options.language !== 'auto' ? options.language as Language : undefined;
	// The record of an update, and notebooks not converted before: the reader's language.
	const reader = STRINGS[given ?? SYSTEM_LANGUAGE];
	const sink = fileSink(options.output);
	const wasm = options.dump ? undefined : loadWasmParser(options.parserWasm);
	const scratch = scratchFolder(options.tmp);
	const jsonPath = join(scratch, 'scan.json');
	const listFolders = async () => (existsSync(options.output) ? readdirSync(options.output).filter(name => statSync(join(options.output, name), { throwIfNoEntry: false })?.isDirectory()) : []);
	// Where sync converts each section first: kept until the section is in, outside the scratch folder
	// (removed when the command ends), so an update the command was stopped in can be finished.
	const stagingFolder = stagingRoot(options.tmp);
	const staging = stagingPlaces(options.tmp);
	if (command === 'sync' && options.apply) {
		// One update of a folder at a time: a second one would take the first one's journal for a cut-off one.
		ownStagingRoot(stagingFolder);
		const lock = join(stagingFolder, `lock-${createHash('sha256').update(existsSync(options.output) ? realpathSync(options.output) : resolvePath(options.output)).digest('hex').slice(0, 16)}`);
		const other = existsSync(lock) ? Number(readFileSync(lock, 'utf8')) : NaN;
		let running = false;
		try {
			running = !isNaN(other) && other !== process.pid && process.kill(other, 0);
		}
		catch {
			running = false;
		}
		if (running) {
			console.error(`Another sync of ${options.output} is running (process ${other}). Wait for it to end.`);
			process.exitCode = 1;
			return;
		}
		writeFileSync(lock, String(process.pid));
		process.on('exit', () => rmSync(lock, { force: true }));
		const resumed = await resumeUpdates({ vault: sink, ...staging, listFolders });
		for (const result of resumed.finished) console.log(`Finished an update that was cut off: ${result.record}`);
		for (const journal of resumed.ignored) console.warn(`Left alone: ${journal} was changed since the update wrote it, so it is not followed. The sections it was updating are checked again below.`);
	}
	const download = await openDownload(options.input, join(scratch, 'zip'), !!wasm, wasm?.tocNames && (data => wasm.tocNames!(data)));
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
		// What the report recorded (names and groups of sections then, sections imported), as the update plans with it.
		const reported = await reportedNotebooks(sink, reader);
		const requests: UpdateRequest[] = [];
		for (const notebook of download.notebooks) {
			const name = notebook.name;
			if (options.only && !options.only.includes(name)) continue;
			// The notebook's folder in the language it was imported in (its contents page says which).
			let archive: Archive | undefined;
			let folder = notebookFolder(name, STRINGS[given ?? SYSTEM_LANGUAGE]);
			for (const language of given ? [given] : [SYSTEM_LANGUAGE, ...LANGUAGES]) {
				const candidate = notebookFolder(name, STRINGS[language]);
				archive = await readArchive(sink, candidate, reported.find(entry => fold(entry.dir) === fold(candidate))?.sections);
				if (archive) {
					folder = candidate;
					break;
				}
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
					scanned.push({ key, groups: section.groups, label: section.label, pages: await scannedPages(await readSection(section)) });
				}
				catch (error) {
					const locked = await passwordProtected(download, section).catch(() => false);
					scanned.push({ key, groups: section.groups, label: section.label, error: locked ? strings.passwordProtected : String((error as Error)?.message ?? error).slice(0, 500) });
				}
			}
			const recorded = recordedPlanOptions(reported.find(entry => fold(entry.dir) === fold(folder)), folder);
			const { identity, items } = planNotebook(name, scanned, archive, strings, { partial: options.partial, ...recorded });
			plans.push({ notebook: name, identity, items });
			// sync updates what is converted already (and, with --new, adds the rest); not from a download older than the vault.
			const deletedHere = (item: PlanItem) => item.added.filter(page => page.userDeleted);
			// Not into a folder of that name that is not ours, nor a notebook of that name that is another one.
			const occupied = !archive && (await sink.listFiles(notebookFolder(name, strings))).length > 0;
			if (occupied) console.log(`  [not ours] ${name}: a folder of this name holds files the plugin did not write; nothing is written into it`);
			const chosen = identity === 'different' || occupied ? [] : items.filter(item => (item.status === 'changed' || item.status === 'unfinished' || (options.addNew && (item.status === 'new' || item.status === 'skipped' || item.status === 'missing')) || (options.restoreDeleted && deletedHere(item).length > 0)) && !item.older);
			const restore = options.restoreDeleted ? new Set(chosen.flatMap(item => deletedHere(item).map(page => page.id))) : undefined;
			requests.push({ notebook, scanned, chosen: new Set(chosen.map(item => sectionKey(item.groups, item.label))), partial: options.partial, ...(restore ? { restore } : {}) });
			if (identity === 'different') console.log(`  [different notebook] ${name}: a notebook of this name is in the folder, with no page in common`);
			for (const item of items) {
				const deleted = item.added.filter(page => page.userDeleted).length;
				if (item.status === 'same' && !deleted) continue;
				const edited = [...item.modified, ...item.reordered].filter(page => page.userEdited).length;
				const added = item.added.filter(page => !page.userDeleted);
				const detail = [['added', added], ['modified', item.modified], ['deleted in OneNote (kept in the vault)', item.removed], ['reordered', item.reordered]]
					.filter(([, list]) => (list as PagePlan[]).length > 0).map(([label, list]) => `${label} ${(list as PagePlan[]).length}`)
					.concat(edited ? [`edited in the vault ${edited}`] : [], deleted ? [`deleted in the vault ${deleted} (${options.restoreDeleted ? 'to be brought back' : 'not brought back; --restore-deleted brings them back'})`] : [], item.older ? ['older than the vault'] : []).join(', ');
				const moved = item.old && item.new && item.old.normalize('NFC').toLowerCase() !== item.new.normalize('NFC').toLowerCase();
				console.log(`  [${item.status}] ${item.key}${moved ? ` (was ${item.old})` : ''}${detail ? `: ${detail}` : ''}${item.error ? `: ${item.error}` : ''}`);
			}
		}
		const totals: Record<string, number> = {};
		for (const p of plans) for (const item of p.items) totals[item.status] = (totals[item.status] ?? 0) + 1;
		console.log(`Plan: ${Object.entries(totals).map(([status, n]) => `${n} ${status}`).join(', ') || 'nothing to compare'}`);
		if (options.json) writeFileSync(options.json, JSON.stringify(plans, null, 2));
		if (command === 'plan') return;
		const count = requests.reduce((n, request) => n + request.chosen.size, 0);
		if (!count) {
			console.log('Nothing to update.');
			return;
		}
		if (!options.apply) {
			console.log(`Would update ${count} section${count === 1 ? '' : 's'}. Nothing was written: run again with --apply to update.`);
			return;
		}
		const defaults: SectionOptions = { boxMarkers: options.boxMarkers, imageAltText: options.imageAltText };
		const host: UpdateHost = {
			vault: sink, ...staging, ...sectionParser(options, download, wasm, scratch), listFolders,
			onSectionDone(notebook, section, outcome) {
				console.log(`  ${[notebook, ...section.groups, section.label].join(' / ')}: ${outcome}`);
			},
		};
		const started = Date.now();
		const result = await updateNotebooks(requests, host, { at: new Date(started), strings: reader, languageFor: () => given ?? SYSTEM_LANGUAGE, defaults, links: options.links, sources: [basename(options.input)] });
		if (!result) {
			console.log('Nothing to update.');
			return;
		}
		if (result.links) console.log(`Links: ${result.links.resolved} rewritten in ${result.links.filesChanged} pages`);
		console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s. Record: ${result.record}.${existsSync(join(options.output, ...result.backup.split('/'))) ? ` Previous versions: ${result.backup}` : ''}`);
	}
	finally {
		download.close();
	}
}

const command = process.argv[2];
(command === 'plan' || command === 'sync' ? plan(process.argv.slice(3), command) : main()).catch(error => {
	console.error(error);
	process.exit(1);
});
