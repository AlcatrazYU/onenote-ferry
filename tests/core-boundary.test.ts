// The core must run unchanged in Node (command line) and in Obsidian (plugin), so it may
// not reach for the disk, the process or the network itself: those come in through interfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(import.meta.dirname, '..', 'src', 'core');

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return entry.name.endsWith('.ts') ? [path] : [];
	});
}

test('core files import only other core files', () => {
	const offenders: string[] = [];
	for (const file of sources(CORE)) {
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
			if (!match[1].startsWith('.')) offenders.push(`${file}: ${match[1]}`);
		}
		for (const word of ['process.', 'require(', 'globalThis.fetch']) {
			if (text.includes(word)) offenders.push(`${file}: ${word}`);
		}
	}
	assert.deepEqual(offenders, []);
});

// Nothing the converter writes with can delete (§11.5 item 49): what an update replaces or OneNote
// no longer has is moved aside. The interfaces have no such method, the sinks implement none, and
// the core calls none (nor renames through Obsidian's FileManager, which rewrites links vault-wide).
test('the sinks offer no way to delete, and the core asks for none', () => {
	const ROOT = join(import.meta.dirname, '..');
	const io = readFileSync(join(CORE, 'io.ts'), 'utf8');
	const members = [...io.matchAll(/^\t(\w+)\??\(/gm)].map(match => match[1]!);
	assert.ok(members.includes('move') && members.includes('copy'));
	assert.deepEqual(members.filter(name => /delete|remove|trash|unlink|rm/i.test(name)), []);
	// Code only: comments may name what is not done.
	const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	const vaultSink = code(join(ROOT, 'src', 'plugin', 'vault-sink.ts'));
	const fileSink = code(join(ROOT, 'src', 'node', 'file-sink.ts'));
	const forbidden = /\.trash\(|trashFile|\.delete\(|\bunlink|\brm(dir)?(Sync)?\b|\.remove\(|renameFile/;
	const offenders = [['vault-sink.ts', vaultSink], ['fileSink', fileSink]].filter(([, text]) => forbidden.test(text!)).map(([name]) => name);
	for (const file of sources(CORE)) {
		const text = code(file);
		// Maps and sets have delete(); nothing else in the core may be asked to delete or trash.
		const calls = [...text.matchAll(/(\w+)\.(delete|remove|trash|trashFile|unlink|rm|rmdir|renameFile)\(/g)]
			.filter(match => !(match[2] === 'delete' && /^(?:[a-z]\w*)$/.test(match[1]!) && new RegExp(`(?:const|let|readonly|private readonly)\\s+${match[1]}\\s*(?::[^=]+)?=\\s*new (?:Map|Set)|${match[1]}\\s*=\\s*new (?:Map|Set)|${match[1]}: (?:Map|Set)<`).test(text)));
		offenders.push(...calls.map(match => `${file}: ${match[0]}`));
	}
	assert.deepEqual(offenders, []);
});

/** Text sources under a folder (Rust, Markdown, TOML, JavaScript), skipping build output and test data. */
function textFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return ['target', 'test-data', 'node_modules'].includes(entry.name) ? [] : textFiles(path);
		return /\.(rs|md|toml|js)$/.test(entry.name) ? [path] : [];
	});
}

// Public content uses no dashes (U+2013, U+2014, U+2015); commas, colons or brackets instead.
test('public files contain no dash characters', () => {
	const ROOT = join(import.meta.dirname, '..');
	const files = [
		...sources(join(ROOT, 'src')),
		...sources(join(ROOT, 'tests')),
		...readdirSync(join(ROOT, 'docs')).filter(name => name.endsWith('.md')).map(name => join(ROOT, 'docs', name)),
		join(ROOT, 'README.md'),
		join(ROOT, 'CONTRIBUTING.md'),
		join(ROOT, 'RELEASE_NOTES.md'),
		join(ROOT, 'THIRD_PARTY_LICENSES.md'),
		join(ROOT, '.github/workflows/release.yml'),
		...textFiles(join(ROOT, 'parser')),
		// The plugin's store listing (manifest.json), build scripts and settings files.
		...readdirSync(ROOT).filter(name => /\.(json|mjs)$|^\.npmrc$/.test(name)).map(name => join(ROOT, name)),
		...readdirSync(join(ROOT, 'scripts')).map(name => join(ROOT, 'scripts', name)),
	];
	const offenders = files.filter(file => /[\u2013\u2014\u2015]/.test(readFileSync(file, 'utf8')));
	assert.deepEqual(offenders, []);
});
