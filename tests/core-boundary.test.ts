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

// Public content uses no dashes (U+2013, U+2014, U+2015); commas, colons or brackets instead.
test('public files contain no dash characters', () => {
	const ROOT = join(import.meta.dirname, '..');
	const files = [
		...sources(join(ROOT, 'src')),
		...sources(join(ROOT, 'tests')),
		...readdirSync(join(ROOT, 'docs')).filter(name => name.endsWith('.md')).map(name => join(ROOT, 'docs', name)),
		join(ROOT, 'README.md'),
		join(ROOT, 'THIRD_PARTY_LICENSES.md'),
	];
	const offenders = files.filter(file => /[\u2013\u2014\u2015]/.test(readFileSync(file, 'utf8')));
	assert.deepEqual(offenders, []);
});
