// Converts the public sample files with the WebAssembly parser and checks the result: a few facts
// known from the samples' own test suites, and the whole output against tests/samples/expected.
//
// Needs the parser build (`npm run build:parser`), so it is not part of `npm test`.
// Run: npm run test:samples
// After a reviewed change to the output: UPDATE=1 npm run test:samples rewrites the expected files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Adapter } from '../../src/core/adapter.ts';
import { en } from '../../src/core/strings.ts';
import { writeSection } from '../../src/core/write.ts';
import { memorySink } from '../helpers.ts';
import { makeZip } from '../zip-writer.ts';
import { entryDataOffset, readZipDirectory } from '../../src/core/zip.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXPECTED = join(ROOT, 'tests/samples/expected');
const UPDATE = process.env.UPDATE === '1';

interface WasmParser {
	parseSection(path: string): { takeJson(): string; readAsset(key: string): Uint8Array; free(): void };
}
const parserFile = join(ROOT, 'pkg/ferry.js');
const ferry = existsSync(parserFile) ? createRequire(import.meta.url)(parserFile) as WasmParser : undefined;

function sampleFiles(dir: string): string[] {
	return readdirSync(dir).sort().flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sampleFiles(path);
		return /\.one$/i.test(name) ? [path] : [];
	});
}
const SAMPLES = [join(ROOT, 'tests/samples/interop'), join(ROOT, 'tests/samples/aspose'), join(ROOT, 'parser/test-data')].flatMap(sampleFiles);

interface Converted {
	error?: string;
	parserErrors: string[];
	pages: { title: string, level: number, file: string, markdown: string }[];
	attachments: string[];
}

const cache = new Map<string, Promise<Converted>>();

/** Parses and converts one sample (English marks), all in memory. */
function convert(path: string): Promise<Converted> {
	if (!cache.has(path)) cache.set(path, (async () => {
		let parsed: ReturnType<WasmParser['parseSection']>;
		try {
			parsed = ferry!.parseSection(path);
		}
		catch (error) {
			return { error: String((error as Error)?.message ?? error).split('\n')[0], parserErrors: [], pages: [], attachments: [] };
		}
		try {
			const json = JSON.parse(parsed.takeJson());
			const section = new Adapter(en).section(json);
			const sink = memorySink();
			const report = await writeSection(section, { readAsset: async key => parsed.readAsset(key) }, sink, {
				dir: 'Section', label: 'Section', strings: en, boxMarkers: true, 
			});
			return {
				parserErrors: json.errors ?? [],
				pages: report.pages.map(page => ({
					title: page.title, level: page.level, file: page.file,
					markdown: (sink.files.get(`Section/${page.file}`) as string).replace(/^---\n[\s\S]*?\n---\n\n/, ''),
				})),
				attachments: [...sink.files.entries()].filter(([, v]) => typeof v !== 'string').map(([k, v]) => `${k} (${(v as Uint8Array).length} bytes)`).sort(),
			};
		}
		finally {
			parsed.free();
		}
	})());
	return cache.get(path)!;
}

/** The text of a page without Markdown marks, for checks that should not depend on formatting. */
const plain = (markdown: string) => markdown.split('\n').map(line => line.replace(/^[\s>#*|-]+/, '').trim()).filter(Boolean);
const sample = (name: string) => SAMPLES.find(path => path.endsWith(`/${name}`))!;

test('the parser build is there', () => assert.ok(ferry, `missing ${parserFile}: run npm run build:parser`));

// Facts from the samples' own test suites (Aspose.Note FOSS for Python, tests/test_aspose_note_history.py).
test('page history: the current version of a page is the one converted', async () => {
	const history = await convert(sample('SimpleHistory.one'));
	assert.equal(history.pages.length, 1);
	assert.equal(plain(history.pages[0].markdown).at(-1), 'Third text');
	// Aspose checks the last piece of text on the page, which here is the last table cell.
	assert.match((await convert(sample('SimpleTable.one'))).pages[0].markdown, /\| 0 \|\n?$/);
	const aligned = (await convert(sample('3ImagesWithDifferentAlignment.one'))).pages[0].markdown;
	assert.equal([...aligned.matchAll(/Image in the outline with (\w+) alignment/g)].map(m => m[1]).at(-1), 'left');
});

test('desktop files with page history keep their pages', async () => {
	for (const name of ['AttachedFileWithTag.one', 'FormattedRichText.one', 'ImageWithTag.one', 'OnePageWithFile.one', 'SimpleImageFromSeparateFile.one', 'TableWithTag.one', 'FileSyncWOPI_OneNoteWithODB.one']) {
		const result = await convert(sample(name));
		assert.equal(result.error, undefined, name);
		assert.deepEqual(result.parserErrors, [], name);
		assert.equal(result.pages.length, 1, name);
	}
});

test('sub-pages keep their level', async () => {
	const result = await convert(sample('Issue1Subpages.one'));
	assert.deepEqual(result.pages.map(page => page.level), [0, 1]);
});

test('a password-protected section is reported as unreadable, not converted', async () => {
	const result = await convert(sample('Encryption.one'));
	assert.ok(result.error, 'expected an error');
	assert.equal(result.pages.length, 0);
});

test('every sample converts to the expected output', async () => {
	for (const path of SAMPLES) {
		const result = await convert(path);
		const name = relative(ROOT, path);
		const text = [
			`# ${name}`,
			'',
			'```json',
			JSON.stringify({ error: result.error, parserErrors: result.parserErrors, pages: result.pages.map(({ title, level, file }) => ({ title, level, file })), attachments: result.attachments }, null, 1),
			'```',
			...result.pages.flatMap(page => ['', `## ${page.file}`, '', page.markdown]),
			'',
		].join('\n');
		const expectedFile = join(EXPECTED, `${name.replace(/[\\/]/g, '__')}.md.txt`);
		if (UPDATE) {
			mkdirSync(dirname(expectedFile), { recursive: true });
			writeFileSync(expectedFile, text);
			continue;
		}
		assert.ok(existsSync(expectedFile), `no expected output for ${name}: review the output, then run UPDATE=1 npm run test:samples`);
		assert.equal(text, readFileSync(expectedFile, 'utf8'), name);
	}
});

// Parser change 6 (parser/UPSTREAM.md): a section stored in a zip is read in place, from its byte
// range, and gives exactly what the same file gives.
test('sections read in place from a zip give the same result as the files', async () => {
	const files = SAMPLES.filter(path => !/Encryption/.test(path));
	const zip = makeZip(files.map(path => ({ name: `Documents/Samples/${relative(ROOT, path).replace(/[\\/]/g, '__')}`, data: readFileSync(path) })), { descriptors: 'both', zip64: 'offset' });
	const zipPath = join(mkdtempSync(join(tmpdir(), 'onenote-ferry-samples-')), 'samples.zip');
	writeFileSync(zipPath, zip);
	const file = { size: zip.length, async read(offset: number, length: number) { return zip.slice(offset, offset + length); } };
	const ranges: Map<string, unknown> = (globalThis as any).__ONENOTE_FERRY_RANGES__ ??= new Map();
	const sha = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
	try {
		for (const entry of await readZipDirectory(file)) {
			const path = files.find(p => entry.name.endsWith(relative(ROOT, p).replace(/[\\/]/g, '__')))!;
			const name = `${zipPath}/${entry.name}`;
			ranges.set(name, { file: zipPath, offset: await entryDataOffset(file, entry), length: entry.size });
			const read = (source: string) => {
				const parsed = ferry!.parseSection(source);
				try {
					const json = parsed.takeJson();
					const keys = [...new Set([...json.matchAll(/"asset":"([0-9a-f]{40}\.[a-z0-9]+)"/g)].map(m => m[1]))];
					return { json: json.replace(/"name":"[^"]*"/, '"name":""'), assets: keys.map(key => sha(parsed.readAsset(key))) };
				}
				finally {
					parsed.free();
				}
			};
			assert.deepEqual(read(name), read(path), entry.name);
			ranges.delete(name);
		}
	}
	finally {
		rmSync(dirname(zipPath), { recursive: true, force: true });
	}
});
