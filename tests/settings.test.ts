// The settings page as Obsidian 1.13 lists it (src/plugin/settings.ts, §11.5 items 98 and 99): what is
// stored, and what the download cache row says and offers for what the cache folder holds. Run in
// Node with the stand-in for Obsidian (tests/support); the cache folder is under a temporary home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemCacheFolder } from '../src/node/mirror.ts';
import { scansFolder } from '../src/node/scan-store.ts';
import { UI_LANGUAGES } from '../src/plugin/i18n.ts';
import type { SettingsHost } from '../src/plugin/settings.ts';

register('./support/hooks.mjs', import.meta.url);
const { FerrySettingTab } = await import('../src/plugin/settings.ts');

const ui = UI_LANGUAGES.en;

function tab() {
	const saved: unknown[] = [];
	const host = {
		ui,
		settings: { folder: 'OneNote', boxMarkers: true, imageAltText: false },
		microsoft: { signedIn: false },
		async saveSettings() {
			saved.push({ ...host.settings });
		},
		openWizard() {},
	};
	return { tab: new FerrySettingTab({} as never, host as unknown as SettingsHost), host, saved };
}

/** A row filled as Obsidian would: its description and the buttons it offers. */
function shown(settingTab: InstanceType<typeof FerrySettingTab>, name: string): { desc: unknown, buttons: string[] } {
	type Item = { name?: string, items?: Item[], render?: (setting: unknown, group: unknown) => void };
	const find = (items: Item[]): Item | undefined => {
		for (const item of items) {
			if (item.name === name) return item;
			const inner = item.items && find(item.items);
			if (inner) return inner;
		}
		return undefined;
	};
	const row = find(settingTab.getSettingDefinitions() as Item[]);
	assert.ok(row?.render, `a row named ${name}`);
	let desc: unknown;
	const buttons: string[] = [];
	const button = {
		setButtonText(text: string) {
			buttons.push(text);
			return button;
		},
		setDestructive: () => button,
		setCta: () => button,
		setDisabled: () => button,
		onClick: () => button,
	};
	const setting = {
		setDesc(text: unknown) {
			desc = text;
			return setting;
		},
		addButton(make: (b: typeof button) => void) {
			make(button);
			return setting;
		},
	};
	row.render(setting, undefined);
	return { desc, buttons };
}

test('stored through the plugin: a folder as a vault path; anything else is left alone', async () => {
	const { tab: settingTab, host, saved } = tab();
	await settingTab.setControlValue('folder', ' Notes / OneNote/ ');
	await settingTab.setControlValue('imageAltText', true);
	await settingTab.setControlValue('folder', 3);
	await settingTab.setControlValue('somethingElse', true);
	assert.deepEqual(host.settings, { folder: 'Notes/OneNote', boxMarkers: true, imageAltText: true });
	assert.equal(saved.length, 2);
});

test('the download cache: clearing is offered while it holds downloads or only what checks kept', () => {
	const home = mkdtempSync(join(tmpdir(), 'ferry-settings-'));
	const env = { HOME: process.env.HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, LOCALAPPDATA: process.env.LOCALAPPDATA };
	process.env.HOME = home;
	process.env.XDG_CACHE_HOME = join(home, '.cache');
	process.env.LOCALAPPDATA = join(home, 'AppData', 'Local');
	try {
		const { tab: settingTab } = tab();
		assert.deepEqual(shown(settingTab, ui.settingsCopy), { desc: ui.copyNone, buttons: [] }, 'nothing kept');
		// Only what a check for updates kept of a download's sections (page titles and times).
		const scans = scansFolder(systemCacheFolder());
		mkdirSync(scans, { recursive: true });
		writeFileSync(join(scans, 'kept.json'), '{"format":1}');
		assert.deepEqual(shown(settingTab, ui.settingsCopy), { desc: ui.copyChecksOnly, buttons: [ui.deleteCopy] });
	}
	finally {
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(home, { recursive: true, force: true });
	}
});
