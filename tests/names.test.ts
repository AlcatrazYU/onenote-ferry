// File and folder names: safe on every system, and notebooks that would share a folder told
// apart. Names are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctNames, folderKey, renameNotebook } from '../src/core/download.ts';
import type { DownloadNotebook } from '../src/core/download.ts';
import { numberedName, safeName } from '../src/core/names.ts';
import { en } from '../src/core/strings.ts';
import { notebookFolder } from '../src/core/write.ts';

const notebook = (name: string, path = name): DownloadNotebook => ({ name, path, sections: [{ path: `${path}/A.one`, notebook: name, groups: [], label: 'A', size: 1 }] });

test('names Windows refuses: no dot or space at the end, device names get an underscore', () => {
	assert.equal(safeName('Misc.', 'x'), 'Misc');
	assert.equal(safeName('Notes. . ', 'x'), 'Notes');
	assert.equal(safeName('...', 'x'), 'x');
	assert.equal(safeName('CON', 'x'), 'CON_');
	assert.equal(safeName('nul.txt', 'x'), 'nul_.txt');
	assert.equal(safeName('com1', 'x'), 'com1_');
	// Only the device names themselves.
	assert.equal(safeName('CONTENTS', 'x'), 'CONTENTS');
	assert.equal(safeName('Console notes', 'x'), 'Console notes');
	// Cut to the limit, then the end cleaned again.
	assert.equal(safeName(`${'a'.repeat(9)}.b`, 'x', 10), 'aaaaaaaaa');
});

test('a numbered name keeps its number within the limit', () => {
	assert.equal(numberedName('Ferry log', 2), 'Ferry log (2)');
	const long = 'L'.repeat(150);
	const second = numberedName(long, 2);
	assert.equal([...second].length, 120);
	assert.ok(second.endsWith(' (2)'));
	assert.notEqual(notebookFolder(second, en), notebookFolder(long, en));
	assert.notEqual(notebookFolder(numberedName(long, 3), en), notebookFolder(second, en));
});

test('notebooks that would get one folder are told apart, by the folder their names give', () => {
	const notebooks = [notebook('My Notes', 'a/My Notes'), notebook('My  Notes', 'b/My  Notes'), notebook('my notes', 'c/my notes'), notebook('C#'), notebook('C＃', 'C2')];
	distinctNames(notebooks);
	const folders = notebooks.map(n => notebookFolder(n.name, en));
	assert.equal(new Set(folders.map(folderKey)).size, folders.length, folders.join(' | '));
	assert.deepEqual(notebooks.map(n => n.name), ['My Notes', 'My Notes (2)', 'my notes (3)', 'C#', 'C＃ (2)']);
});

test('two notebooks with one long name get two folders', () => {
	const long = 'Lecture notes '.repeat(12).trim();
	const notebooks = distinctNames([notebook(long, 'a/x'), notebook(long, 'b/x')]);
	assert.notEqual(folderKey(notebookFolder(notebooks[0]!.name, en)), folderKey(notebookFolder(notebooks[1]!.name, en)));
});

test('a renamed notebook remembers its OneNote name, also when renamed again', () => {
	const n = notebook('Tides');
	renameNotebook(n, 'Tides (2)');
	renameNotebook(n, 'Tides (3)');
	assert.equal(n.sourceName, 'Tides');
	assert.equal(n.sections[0]!.notebook, 'Tides (3)');
});
