// Shared builders for tests: invented parser JSON and an in-memory sink.

import type { SectionSource, UpdateSink } from '../src/core/io.ts';

// Parser JSON (shape of the `dump` output), with invented content.

export const run = (text: string, extra: Record<string, unknown> = {}) => ({ text, bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, highlight: null, color: null, link: false, href: null, latex: null, ...extra });
export const rich = (runs: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'rich', runs, styleId: null, tags: null, inks: [], ...extra });
export const element = (contents: unknown[], children: unknown[] = [], extra: Record<string, unknown> = {}) => ({ type: 'element', level: 1, list: null, contents, children, ...extra });
export const outline = (items: unknown[], place: { x?: number, y?: number, w?: number } = {}) => ({ type: 'outline', x: place.x ?? null, y: place.y ?? null, w: place.w ?? null, items });
export const asset = (name: string, size = 10) => ({ asset: name, size });
export const pageJson = (title: string, contents: unknown[], extra: Record<string, unknown> = {}) => ({ id: `{${title}}`, title, level: 1, created: 1700000000, updated: 1700003600, contents, ...extra });
export const sectionJson = (name: string, pages: unknown[]) => ({ name, pages, stats: {}, errors: [] });

/** One ink stroke: first point absolute, later points as deltas (HIMETRIC). */
export const stroke = (transparency = 0, points: number[][] = [[0, 0], [1270, 1270]]) => ({ points, width: 30, height: 30, color: 0x0000ff, transparency, tip: 0 });

export interface MemorySink extends UpdateSink {
	files: Map<string, string | Uint8Array>;
	folders: Set<string>;
	times: Map<string, Date>;
}

/** Paths as a disk that ignores case (and Obsidian, which composes them) tells them apart. */
const fold = (path: string) => path.normalize('NFC').toLowerCase();

/** Output in memory. `exists` and the checks before moving or copying ignore case, as the disks of macOS and Windows do. */
export function memorySink(): MemorySink {
	const files = new Map<string, string | Uint8Array>();
	const folders = new Set<string>();
	const times = new Map<string, Date>();
	const bytesOf = (v: string | Uint8Array) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);
	const exists = (path: string) => [...files.keys(), ...folders].some(p => fold(p) === fold(path) || fold(p).startsWith(`${fold(path)}/`));
	return {
		files, folders, times,
		async ensureFolder(path) { folders.add(path); },
		async writeText(path, text, modified) { files.set(path, text); if (modified) times.set(path, modified); else times.delete(path); },
		async writeBinary(path, bytes) { files.set(path, bytes); times.delete(path); },
		async readText(path) { const v = files.get(path); return typeof v === 'string' ? v : undefined; },
		async readBinary(path) { const v = files.get(path); return v === undefined ? undefined : bytesOf(v); },
		async listFiles(folder) { return [...files.keys()].filter(p => folder === '' || p.startsWith(`${folder}/`)); },
		async stat(path) {
			const v = files.get(path);
			if (v === undefined) return undefined;
			return { mtime: times.get(path)?.getTime() ?? 0, size: bytesOf(v).length };
		},
		async exists(path) { return exists(path); },
		async move(from, to) {
			if (exists(to) && fold(from) !== fold(to)) throw new Error(`move: ${to} exists`);
			// As a disk refuses it.
			if (fold(to).startsWith(`${fold(from)}/`)) throw new Error(`move: ${to} is inside ${from}`);
			const moved = [...files.keys()].filter(p => p === from || p.startsWith(`${from}/`));
			if (!moved.length && !folders.has(from)) throw new Error(`move: no ${from}`);
			for (const p of moved) {
				const target = to + p.slice(from.length);
				files.set(target, files.get(p)!);
				if (times.has(p)) times.set(target, times.get(p)!);
				if (target !== p) {
					files.delete(p);
					times.delete(p);
				}
			}
			for (const f of [...folders]) {
				if (f === from || f.startsWith(`${from}/`)) {
					folders.delete(f);
					folders.add(to + f.slice(from.length));
				}
			}
		},
		async copy(from, to) {
			const v = files.get(from);
			if (v === undefined) throw new Error(`copy: no ${from}`);
			if (exists(to)) throw new Error(`copy: ${to} exists`);
			files.set(to, typeof v === 'string' ? v : v.slice());
			if (times.has(from)) times.set(to, times.get(from)!);
		},
		async appendText(path, text) {
			const v = files.get(path);
			files.set(path, (typeof v === 'string' ? v : '') + text);
		},
	};
}

export function memorySource(assets: Record<string, string>): SectionSource {
	return {
		async readAsset(key) {
			if (!(key in assets)) throw new Error(`missing ${key}`);
			return new TextEncoder().encode(assets[key]);
		},
	};
}
