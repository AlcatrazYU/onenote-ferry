// Shared builders for tests: invented parser JSON and an in-memory sink.

import type { SectionSource, Sink } from '../src/core/io.ts';

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

export interface MemorySink extends Sink {
	files: Map<string, string | Uint8Array>;
	folders: Set<string>;
	times: Map<string, Date>;
}

export function memorySink(): MemorySink {
	const files = new Map<string, string | Uint8Array>();
	const folders = new Set<string>();
	const times = new Map<string, Date>();
	return {
		files, folders, times,
		async ensureFolder(path) { folders.add(path); },
		async writeText(path, text) { files.set(path, text); },
		async writeBinary(path, bytes) { files.set(path, bytes); },
		async setModifiedTime(path, time) { times.set(path, time); },
		async readText(path) { const v = files.get(path); return typeof v === 'string' ? v : undefined; },
		async listFiles(folder) { return [...files.keys()].filter(p => folder === '' || p.startsWith(`${folder}/`)); },
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
