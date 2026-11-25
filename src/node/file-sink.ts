// Output in a folder on disk (the command line's): the core's Sink and UpdateSink with Node's file
// system. It has no way to delete (§11.5 item 49).

import { appendFileSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { UpdateSink } from '../core/io.ts';

/** Paths as the disks of macOS and Windows compare them. */
const fold = (path: string) => path.normalize('NFC').toLowerCase();

/**
 * Output in a folder on disk, for the command line. Nothing it is given reaches outside `root`,
 * whatever the path says (a journal changed by hand, say): such a path throws.
 */
export function fileSink(root: string): UpdateSink {
	const resolve = (path: string) => {
		const full = join(root, ...path.split('/'));
		const inside = relative(root, full);
		if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Outside the output folder: ${path}`);
		return full;
	};
	/**
	 * Where something is written: never through a symbolic link that leads out of the output folder
	 * (the deepest folder there must really be inside it), and never onto a symbolic link.
	 */
	/** Where something is written: never onto a symbolic link (a folder the user linked from elsewhere is theirs to write into). */
	const writable = (path: string) => {
		const full = resolve(path);
		// lstat, not exists: a link to nothing is still a link.
		if (lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`A symbolic link is at ${path}`);
		return full;
	};
	return {
		async ensureFolder(path) {
			mkdirSync(writable(path), { recursive: true });
		},
		async writeText(path, text, modified) {
			const full = writable(path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, text);
			if (modified) utimesSync(full, modified, modified);
		},
		async writeBinary(path, bytes) {
			const full = writable(path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, bytes);
		},
		async readText(path) {
			try {
				return readFileSync(resolve(path), 'utf8');
			}
			catch {
				return undefined;
			}
		},
		async listFiles(folder) {
			const start = resolve(folder);
			if (!existsSync(start)) return [];
			return (readdirSync(start, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
				.filter(entry => entry.isFile())
				.map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
		},
		async stat(path) {
			try {
				const info = statSync(resolve(path));
				return info.isFile() ? { mtime: info.mtimeMs, size: info.size } : undefined;
			}
			catch {
				return undefined;
			}
		},
		exists: path => existsSync(resolve(path)),
		async readBinary(path) {
			try {
				return readFileSync(resolve(path));
			}
			catch {
				return undefined;
			}
		},
		async move(from, to) {
			const target = writable(to);
			if (existsSync(target) && fold(from) !== fold(to)) throw new Error(`Something is at ${to} already`);
			mkdirSync(dirname(target), { recursive: true });
			renameSync(resolve(from), target);
		},
		async copy(from, to) {
			const target = writable(to);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(resolve(from), target, constants.COPYFILE_EXCL);
			const info = statSync(resolve(from));
			utimesSync(target, info.atime, info.mtime);
		},
		async appendText(path, text) {
			const full = writable(path);
			mkdirSync(dirname(full), { recursive: true });
			appendFileSync(full, text);
		},
	};
}
