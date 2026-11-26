// Just enough of Obsidian's module for the plugin's session logic to run in Node: folders and
// files of a vault, and the classes the settings page extends (never shown here).

export function normalizePath(path) {
	return path.replace(/[  ]/g, ' ').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').normalize('NFC');
}

export class TAbstractFile {
	constructor(name, parent) {
		this.name = name;
		this.parent = parent;
		this.path = parent && parent.path ? `${parent.path}/${name}` : name;
	}
}

export class TFile extends TAbstractFile {}

export class TFolder extends TAbstractFile {
	constructor(name, parent) {
		super(name, parent);
		this.children = [];
	}

	isRoot() {
		return !this.parent;
	}
}

export class AbstractInputSuggest {}
export class PluginSettingTab {}
export class Setting {}
// Named by modules the session reaches (the settings page, OneDrive), not used in these tests.
export class ButtonComponent {}
export class Modal {}
export class Notice {}
export async function requestUrl() {
	throw new Error('no network in tests');
}
