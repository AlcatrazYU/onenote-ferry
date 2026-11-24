// Draws ink strokes as a standalone SVG, alone or laid over the picture they were written on.
// Adapted from Obsidian Importer (MIT), src/formats/onenote/ink-svg.ts at commit fa9444a.
// See THIRD_PARTY_LICENSES.md.

import type { InkStroke } from '../model.ts';
import { MIN_PEN_OPACITY } from '../model.ts';

const PADDING = 10;

/** A rectangle in the drawing's units (CSS pixels). */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A picture to draw under the strokes, as a data URL. */
export interface Underlay extends Rect {
	href: string;
}

export interface DrawingParts {
	/** Pictures under the strokes. */
	underlays?: Underlay[];
	/** Blank page outlines under the strokes, for notes written on a page that cannot be drawn here. */
	sheets?: Rect[];
}

/** Dark enough to vanish on a dark background. */
function isDark(color: string): boolean {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
	if (!m) return false;
	const [r, g, b] = m.slice(1).map(h => parseInt(h, 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2;
}

export function strokesToSvg(strokes: InkStroke[], parts: DrawingParts = {}): string | null {
	const drawable = strokes.filter(stroke => stroke.points.length > 0);
	const underlays = parts.underlays ?? [];
	const sheets = parts.sheets ?? [];
	if (drawable.length === 0 && underlays.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const stroke of drawable) {
		for (const point of stroke.points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
	}
	let padding = PADDING;
	for (const stroke of drawable) {
		if (Number.isFinite(stroke.width)) padding = Math.max(padding, stroke.width / 2);
	}
	// Strokes alone keep the arithmetic of the original converter, so their drawings stay byte for byte the same.
	let width = maxX - minX + padding * 2;
	let height = maxY - minY + padding * 2;
	let shiftX = 0, shiftY = 0;
	const rects = [...underlays, ...sheets];
	if (rects.length) {
		const left = Math.min(...rects.map(r => r.x), drawable.length ? minX - padding : Infinity);
		const top = Math.min(...rects.map(r => r.y), drawable.length ? minY - padding : Infinity);
		const right = Math.max(...rects.map(r => r.x + r.width), drawable.length ? maxX + padding : -Infinity);
		const bottom = Math.max(...rects.map(r => r.y + r.height), drawable.length ? maxY + padding : -Infinity);
		if (!drawable.length) {
			minX = left + padding;
			minY = top + padding;
		}
		shiftX = minX - padding - left;
		shiftY = minY - padding - top;
		width = right - left;
		height = bottom - top;
	}
	const X = (x: number) => round(x - minX + padding + shiftX);
	const Y = (y: number) => round(y - minY + padding + shiftY);

	// Handwriting over a picture or a page sits on white paper, as in OneNote. Handwriting alone sits
	// on the note: black ink would vanish in a dark theme, so it turns white there (SVG pictures in
	// Obsidian follow Obsidian's own light or dark setting; tested in the maintainer's sandbox).
	const paper = underlays.length > 0 || sheets.length > 0;
	const darkInk = (stroke: InkStroke) => !paper && stroke.opacity >= MIN_PEN_OPACITY && isDark(stroke.color);
	const body: string[] = [];
	if (paper) body.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
	if (drawable.some(darkInk)) body.push('<style>@media (prefers-color-scheme: dark) { .dark { stroke: #ffffff; } circle.dark { fill: #ffffff; } }</style>');
	for (const sheet of sheets) {
		body.push(`<rect x="${X(sheet.x)}" y="${Y(sheet.y)}" width="${round(sheet.width)}" height="${round(sheet.height)}" fill="#ffffff" stroke="#c8c8c8" stroke-width="1"/>`);
	}
	for (const underlay of underlays) {
		body.push(`<image x="${X(underlay.x)}" y="${Y(underlay.y)}" width="${round(underlay.width)}" height="${round(underlay.height)}" preserveAspectRatio="none" href="${underlay.href}"/>`);
	}
	for (const stroke of drawable) {
		const highlighter = stroke.opacity < MIN_PEN_OPACITY;
		// A highlighter darkens what is under it, as it does on paper and in OneNote.
		const look = (stroke.opacity < 1 ? ` opacity="${stroke.opacity.toFixed(2)}"` : '')
			+ (highlighter ? ' style="mix-blend-mode:multiply"' : '')
			+ (darkInk(stroke) ? ' class="dark"' : '');
		if (stroke.points.length === 1) {
			const { x, y } = stroke.points[0];
			body.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${round(stroke.width / 2)}" fill="${stroke.color}"${look}/>`);
			continue;
		}
		const pathData = stroke.points
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${X(point.x)} ${Y(point.y)}`)
			.join(' ');
		body.push(`<path d="${pathData}" stroke="${stroke.color}" stroke-width="${round(stroke.width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"${look}/>`);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">${body.join('\n')}</svg>`;
}

/** Hundredths of a unit are finer than any screen shows. */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}
