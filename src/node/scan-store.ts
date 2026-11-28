// What a check for updates read of each section, kept on disk so that the next check, after
// Obsidian or the plugin started again, reads only the sections whose file changed (§11.5 item 90).
// One small file per download (a zip, a folder, the OneDrive copy) in the system's cache folder,
// named by a hash of the download's path. Each section's pages are kept with the stamp of the file
// they were read from (downloadStamp: its size and time); the caller uses them only while the file
// is still like that. A file of another format or another version of the plugin, one for another
// download, or one that cannot be read counts as none. These are the plugin's own files: the vault
// is never touched.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScannedPage } from '../core/sync.ts';

/** A section's pages as read, and how its file was then. */
export interface KeptScan {
	stamp: string;
	pages: ScannedPage[];
}

/** Raised when what is kept, or what it means, changes. */
const FORMAT = 1;

/** Where the reads are kept, under a cache folder. */
export function scansFolder(cacheFolder: string): string {
	return join(cacheFolder, 'onenote-ferry', 'scans');
}

function fileOf(folder: string, input: string): string {
	return join(folder, `${createHash('sha1').update(input).digest('hex')}.json`);
}

/** What was kept for a download, by section path; empty when there is nothing usable. */
export async function readScans(folder: string, input: string, version: string): Promise<Map<string, KeptScan>> {
	const kept = new Map<string, KeptScan>();
	let data: unknown;
	try {
		data = JSON.parse(await readFile(fileOf(folder, input), 'utf8'));
	}
	catch {
		return kept;
	}
	const file = data as { format?: unknown, version?: unknown, input?: unknown, sections?: unknown };
	if (file?.format !== FORMAT || file.version !== version || file.input !== input || typeof file.sections !== 'object' || file.sections === null) return kept;
	for (const [path, scan] of Object.entries(file.sections as Record<string, Partial<KeptScan> | null>)) {
		if (typeof scan?.stamp === 'string' && Array.isArray(scan.pages)) kept.set(path, { stamp: scan.stamp, pages: scan.pages });
	}
	return kept;
}

/** Keeps a download's reads, replacing what was kept for it (written whole, then put in place). */
export async function writeScans(folder: string, input: string, version: string, scans: ReadonlyMap<string, KeptScan>): Promise<void> {
	await mkdir(folder, { recursive: true });
	const file = fileOf(folder, input);
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify({ format: FORMAT, version, input, sections: Object.fromEntries(scans) }));
		await rename(temporary, file);
	}
	catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
}
