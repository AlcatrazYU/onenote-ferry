// Where an update converts each section before it goes into the vault (§11.5 item 50.10): a folder
// of the user's own in the system's temporary folder (a temporary folder may be shared on a machine
// of several users), reachable by nobody else, with a folder per section that is removed once the
// section is in the vault or put back. The command line and the plugin both use it. These are the
// program's own temporary files, never the user's, so removing them is fine.

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { UpdateSink } from '../core/io.ts';
import type { UpdateHost } from '../core/update.ts';
import { fileSink } from './file-sink.ts';

/** The names a section's folder gets (mkdtemp's six characters); a journal naming any other is not followed. */
const STAGING_ID = /^section-[A-Za-z0-9]{6}$/;

/** The user's folder for staging in `tmp` (the system's temporary folder, or one given). */
export function stagingRoot(tmp: string): string {
	return join(tmp, `onenote-ferry-sync-${process.getuid?.() ?? 'user'}`);
}

/** Makes the staging folder when needed, and checks that it is the user's own and closed to others. */
export function ownStagingRoot(root: string): void {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const info = lstatSync(root);
	if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
		throw new Error(`${root} is not a folder of yours that only you can open: remove it`);
	}
}

export interface StagingPlaces extends Pick<UpdateHost, 'newStaging' | 'openStaging' | 'releaseStaging'> {
	/** The folder on disk of a place newStaging or openStaging gave. */
	pathOf(sink: UpdateSink): string | undefined;
}

/** Staging places in the user's staging folder in `tmp`. */
export function stagingPlaces(tmp: string): StagingPlaces {
	const root = stagingRoot(tmp);
	const paths = new WeakMap<UpdateSink, string>();
	const place = (dir: string) => {
		const sink = fileSink(dir);
		paths.set(sink, dir);
		return sink;
	};
	return {
		async newStaging() {
			ownStagingRoot(root);
			const dir = mkdtempSync(join(root, 'section-'));
			return { id: basename(dir), sink: place(dir) };
		},
		// The id comes from a journal in the vault: only a name made here is used.
		async openStaging(id) {
			return STAGING_ID.test(id) && existsSync(join(root, id)) ? place(join(root, id)) : undefined;
		},
		// A folder another program holds open (an antivirus or the search index, on Windows) is left
		// where it is: it never stops the update, and the sweep removes it later.
		async releaseStaging(id) {
			if (!STAGING_ID.test(id)) return;
			try {
				rmSync(join(root, id), { recursive: true, force: true, maxRetries: 3 });
			}
			catch {
				// Left for sweepStaging.
			}
		},
		pathOf: sink => paths.get(sink),
	};
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Removes staging folders left more than a week ago: a section being converted when Obsidian quit
 * leaves its folder, and no journal names it yet. One a journal still names is finished from it, or
 * put back without it, so nothing depends on it after so long.
 */
export function sweepStaging(tmp: string): void {
	const root = stagingRoot(tmp);
	let names: string[];
	try {
		names = readdirSync(root);
	}
	catch {
		return;
	}
	for (const name of names) {
		if (!STAGING_ID.test(name)) continue;
		try {
			if (Date.now() - statSync(join(root, name)).mtimeMs > WEEK) rmSync(join(root, name), { recursive: true, force: true });
		}
		catch {
			// Held open or gone: left for next time.
		}
	}
}

