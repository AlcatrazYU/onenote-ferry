// The import window's bottom line while it is busy (busyLine, src/plugin/wizard.ts), which is also
// the status bar's while the window is hidden: during a check for updates, a OneDrive copy
// downloading on the way shows how much of it has come, so a long file does not look stuck
// (§11.5 item 89). Run in Node with the stand-in for Obsidian (tests/support).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { ImportSession } from '../src/plugin/session.ts';
import type { CopyProgress } from '../src/node/mirror.ts';
import { UI_LANGUAGES } from '../src/plugin/i18n.ts';

register('./support/hooks.mjs', import.meta.url);
const { busyLine } = await import('../src/plugin/wizard.ts');

const MB = 1024 * 1024;

/** A session busy with what `state` says, and nothing else. */
function session(state: Partial<Record<keyof ImportSession, unknown>>): ImportSession {
	return {
		updating: false, entry: 'update', downloads: [], folderError: undefined, reading: false,
		checking: false, findingLocked: false, checkingUpdates: false, checkProgress: { done: 44, total: 238 }, downloading: undefined,
		...state,
	} as unknown as ImportSession;
}

const copy = (bytes: number, totalBytes: number): CopyProgress => ({ files: 1, totalFiles: 3, sections: 0, totalSections: 2, bytes, totalBytes, current: 'Tides/Spring.one' });

test('a check for updates counts sections; a copy downloading on the way adds how much of it has come', () => {
	const { en, zh } = UI_LANGUAGES;
	assert.equal(busyLine(session({ checkingUpdates: true }), en), 'Checking for updates 44/238...');
	assert.equal(busyLine(session({ checkingUpdates: true, downloading: copy(120 * MB, 1946 * MB) }), en), 'Checking for updates 44/238: downloading 120 MB of 1.9 GB from OneDrive...');
	assert.equal(busyLine(session({ checkingUpdates: true, downloading: copy(120 * MB, 1946 * MB) }), zh), '正在检查更新 44/238：从 OneDrive 下载 120 MB / 1.9 GB...');
	// Downloading for an import, not a check: the import's own line, as before.
	assert.equal(busyLine(session({ downloading: copy(120 * MB, 1946 * MB) }), en), 'Downloading from OneDrive: 1 of 3 files, 120 MB of 1.9 GB');
	// Waiting for the user: nothing.
	assert.equal(busyLine(session({}), en), undefined);
});
