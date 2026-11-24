// Writes the converted notes into the vault through Obsidian's Vault interface (as the plugin
// guidelines ask), under one folder of the vault. Paths from the core are relative to that folder.

import { normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { Sink } from '../core/io.ts';

/** The bytes as an ArrayBuffer of their own (the vault takes ArrayBuffers). */
function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? bytes.buffer as ArrayBuffer
		: bytes.slice().buffer as ArrayBuffer;
}

const key = (text: string) => text.normalize('NFC').toLowerCase();

/**
 * A vault folder path as the vault spells it: where a folder by another case or Unicode form is
 * there already (`onenote` for `OneNote`), its spelling, since the disk would take it as the same.
 */
export function vaultSpelling(app: App, path: string): string {
	if (!path) return '';
	let node: TFolder = app.vault.getRoot();
	const parts = path.split('/');
	const found: string[] = [];
	for (const [i, part] of parts.entries()) {
		const match = node.children.find((child): child is TFolder => child instanceof TFolder && key(child.name) === key(part));
		if (!match) return [...found, ...parts.slice(i)].join('/');
		found.push(match.name);
		node = match;
	}
	return found.join('/');
}

export class VaultSink implements Sink {
	private readonly app: App;
	/** The vault folder everything goes under ('' for the vault's root), as the vault spells it. */
	readonly root: string;

	constructor(app: App, root: string) {
		this.app = app;
		this.root = root === '' || root === '/' ? '' : vaultSpelling(app, normalizePath(root));
	}

	private full(path: string): string {
		return normalizePath(this.root ? `${this.root}/${path}` : path);
	}

	private async makeFolder(full: string): Promise<void> {
		if (!full || full === '/' || this.app.vault.getFolderByPath(full)) return;
		const parent = full.includes('/') ? full.slice(0, full.lastIndexOf('/')) : '';
		if (parent) await this.makeFolder(parent);
		try {
			await this.app.vault.createFolder(full);
		}
		catch (error) {
			// Made meanwhile is fine; anything else is not.
			if (!this.app.vault.getFolderByPath(full)) throw error;
		}
	}

	private parentOf(full: string): string {
		return full.includes('/') ? full.slice(0, full.lastIndexOf('/')) : '';
	}

	async ensureFolder(path: string): Promise<void> {
		await this.makeFolder(this.full(path));
	}

	async writeText(path: string, text: string, modified?: Date): Promise<void> {
		const full = this.full(path);
		const options = modified ? { mtime: modified.getTime() } : undefined;
		const file = this.app.vault.getFileByPath(full);
		if (file) {
			await this.app.vault.modify(file, text, options);
			return;
		}
		await this.makeFolder(this.parentOf(full));
		await this.app.vault.create(full, text, options);
	}

	async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
		const full = this.full(path);
		const file = this.app.vault.getFileByPath(full);
		if (file) {
			await this.app.vault.modifyBinary(file, arrayBuffer(bytes));
			return;
		}
		await this.makeFolder(this.parentOf(full));
		await this.app.vault.createBinary(full, arrayBuffer(bytes));
	}

	async readText(path: string): Promise<string | undefined> {
		const file = this.app.vault.getFileByPath(this.full(path));
		return file ? this.app.vault.read(file) : undefined;
	}

	async listFiles(folder: string): Promise<string[]> {
		const start = folder ? this.app.vault.getFolderByPath(this.full(folder)) : this.rootFolder();
		if (!start) return [];
		const files: string[] = [];
		const walk = (node: TFolder) => {
			for (const child of node.children) {
				if (child instanceof TFile) files.push(this.relative(child.path));
				else if (child instanceof TFolder) walk(child);
			}
		};
		walk(start);
		return files;
	}

	/** From the vault's own record of the file: nothing is read from disk. */
	async stat(path: string): Promise<{ mtime: number, size: number } | undefined> {
		const file = this.app.vault.getFileByPath(this.full(path));
		return file ? { mtime: file.stat.mtime, size: file.stat.size } : undefined;
	}

	/** Folders directly under the root. */
	listFolders(): string[] {
		const root = this.rootFolder();
		return root ? root.children.filter((child): child is TFolder => child instanceof TFolder).map(child => child.name) : [];
	}

	/** Whether something (a file or a folder) is at this path under the root. */
	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(this.full(path)) !== null;
	}

	/**
	 * Whether something directly under the root has this name, ignoring case and Unicode form (as
	 * the disks of macOS and Windows do), so an import never lands in a folder by another spelling.
	 */
	hasChild(name: string): boolean {
		const root = this.rootFolder();
		return !!root && root.children.some(child => key(child.name) === key(name));
	}

	/** The vault path of a path under the root. */
	vaultPath(path: string): string {
		return this.full(path);
	}

	private rootFolder(): TFolder | null {
		return this.root ? this.app.vault.getFolderByPath(this.root) : this.app.vault.getRoot();
	}

	private relative(vaultPath: string): string {
		return this.root ? vaultPath.slice(this.root.length + 1) : vaultPath;
	}
}
