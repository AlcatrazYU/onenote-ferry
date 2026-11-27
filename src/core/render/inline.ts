// Renders a paragraph's text runs to Markdown.
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/convert.ts at commit fa9444a,
// with layered formatting, colour dots, link handling and escaping reworked.
// See THIRD_PARTY_LICENSES.md.

import type { TextRun } from '../model.ts';
import { escapeInline } from '../markdown.ts';
import { highlightMarker } from './color.ts';

export interface InlineOptions {
	/** Turns an internal OneNote page title into a link target, or undefined to keep the original link. */
	resolveInternalLink?: (pageTitle: string) => string | undefined;
}

const INVISIBLE_MATH = /[\u2061-\u2064]/g;

// Preserve scripts before NFKC folds their glyphs to ordinary characters.
const SUPERSCRIPTS = '\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u207A\u207B\u207C\u207D\u207E\u207F\u2071\u00B9\u00B2\u00B3';
const SUPERSCRIPT_PLAIN = '0123456789+-=()ni123';
const SUBSCRIPTS = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u208A\u208B\u208C\u208D\u208E';
const SUBSCRIPT_PLAIN = '0123456789+-=()';

/** Separates two equal Markdown delimiters so they do not merge. */
const ZERO_WIDTH_SPACE = '\u200B';

function scriptRuns(text: string, glyphs: string, plain: string, marker: string): string {
	const pattern = new RegExp(`[${glyphs}]+`, 'g');
	return text.replace(pattern, match => {
		const decoded = [...match].map(character => plain[glyphs.indexOf(character)]).join('');
		return `${marker}{${decoded}}`;
	});
}

function toLatex(text: string): string {
	const scripted = scriptRuns(
		scriptRuns(text, SUPERSCRIPTS, SUPERSCRIPT_PLAIN, '^'),
		SUBSCRIPTS, SUBSCRIPT_PLAIN, '_');
	return scripted.normalize('NFKC').replace(INVISIBLE_MATH, '').trim();
}

/** Extracts `Page title` from `onenote:...#Page%20title&section-id=...`. */
export function internalPageTitle(url: string): string | undefined {
	if (!url.toLowerCase().startsWith('onenote:')) return undefined;
	const hash = url.indexOf('#');
	if (hash < 0) return undefined;
	const tail = url.slice(hash + 1);
	const separator = tail.indexOf('&');
	const encoded = tail.slice(0, separator < 0 ? tail.length : separator);
	if (encoded === '') return undefined;
	try {
		return decodeURIComponent(encoded);
	}
	catch {
		return encoded;
	}
}

/** Leaves an already-encoded URL alone instead of encoding its % again. */
export function linkTarget(url: string): string {
	let target = /%[0-9a-f]{2}/i.test(url) ? url : encodeURI(url);
	target = target.replace(/ /g, '%20');
	return /[()<>]/.test(target) ? `<${target.replace(/[<>]/g, c => encodeURIComponent(c))}>` : target;
}

const htmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function splitSpace(text: string): [string, string, string] {
	const leading = text.match(/^\s*/)![0];
	const trailing = text.length > leading.length ? text.match(/\s*$/)![0] : '';
	return [leading, text.slice(leading.length, text.length - trailing.length), trailing];
}

/** The innermost layer: text, math, and the HTML-only styles (underline, scripts, colour). */
function renderLeaf(run: TextRun, options: InlineOptions): string {
	const [leading, core, trailing] = splitSpace(run.text);
	if (core === '') return run.text;

	if (run.math) {
		const latex = toLatex(core);
		return latex === '' ? '' : `${leading}$${latex}$${trailing}`;
	}

	const underline = run.underline && !run.hyperlinkUrl;
	// Font colours are OneNote's own: always kept, as `<span style="color:...">` (§11.5 item 68).
	const color = run.color;
	if (!underline && !run.superscript && !run.subscript && !color) return leading + escapeInline(core) + trailing;

	// Markdown is not parsed inside inline HTML, so HTML styles go innermost around plain text.
	// Markdown is still parsed inside inline HTML, so its special characters need escaping too.
	let html = htmlEscape(core).replace(/([\\*_\[\]~=`$])/g, '\\$1');
	if (run.superscript) html = `<sup>${html}</sup>`;
	if (run.subscript) html = `<sub>${html}</sub>`;
	if (underline) html = `<u>${html}</u>`;
	if (color) html = `<span style="color:${color}">${html}</span>`;
	return leading + html + trailing;
}

type Layer = 'highlight' | 'link' | 'strike' | 'bold' | 'italic';
/** Outermost first: a highlight never gets cut by a style change inside it. */
const LAYERS: Layer[] = ['highlight', 'link', 'strike', 'bold', 'italic'];

function layerValue(run: TextRun, layer: Layer): string {
	switch (layer) {
		case 'highlight': return highlightMarker(run.highlight);
		case 'link': return run.math ? '' : run.hyperlinkUrl ?? '';
		case 'strike': return run.strikethrough && !run.math ? '1' : '';
		case 'bold': return run.bold && !run.math ? '1' : '';
		case 'italic': return run.italic && !run.math ? '1' : '';
	}
}

function linkMarkdown(text: string, url: string, options: InlineOptions): string {
	// A link that names its page by id is matched by that id later (links.ts), never by title here:
	// a page of the same title in this section may be a copy, not the page the link means.
	const pageTitle = /page-id=/i.test(url) ? undefined : internalPageTitle(url);
	const target = pageTitle ? options.resolveInternalLink?.(pageTitle) : undefined;
	return target ? `[${text}](<${target}>)` : `[${text}](${linkTarget(url)})`;
}

function wrapLayer(layer: Layer, value: string, content: string, options: InlineOptions): string {
	const [leading, core, trailing] = splitSpace(content);
	if (core === '') return content;
	switch (layer) {
		case 'highlight': return `${leading}==${value}${core}==${trailing}`;
		case 'link': return `${leading}${linkMarkdown(core, value, options)}${trailing}`;
		case 'strike': return `${leading}~~${core}~~${trailing}`;
		case 'bold': return `${leading}**${core}**${trailing}`;
		case 'italic': return `${leading}*${core}*${trailing}`;
	}
}

/**
 * Formatting is nested: one highlight wraps every consecutive run of the same
 * colour, whatever else changes inside it, so a highlight is never cut up.
 */
function renderLayers(runs: TextRun[], level: number, options: InlineOptions): string {
	if (level === LAYERS.length) return runs.map(run => renderLeaf(run, options)).join('');
	const layer = LAYERS[level];
	let out = '';
	for (let i = 0; i < runs.length;) {
		const value = layerValue(runs[i], layer);
		let j = i + 1;
		while (j < runs.length && layerValue(runs[j], layer) === value) j++;
		const inner = renderLayers(runs.slice(i, j), level + 1, options);
		out += value ? wrapLayer(layer, value, inner, options) : inner;
		i = j;
	}
	return out;
}

function sameFormat(a: TextRun, b: TextRun): boolean {
	return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline
		&& !!a.strikethrough === !!b.strikethrough && !!a.superscript === !!b.superscript
		&& !!a.subscript === !!b.subscript && !!a.math === !!b.math
		&& (a.hyperlinkUrl ?? '') === (b.hyperlinkUrl ?? '')
		&& highlightMarker(a.highlight) === highlightMarker(b.highlight)
		&& (a.color ?? '') === (b.color ?? '');
}

/** OneNote splits runs on every font change; joining equal ones avoids `====`. */
function mergeRuns(runs: TextRun[]): TextRun[] {
	const merged: TextRun[] = [];
	for (const run of runs) {
		if (run.text === '') continue;
		const last = merged[merged.length - 1];
		if (last && sameFormat(last, run)) last.text += run.text;
		else merged.push({ ...run });
	}
	return merged;
}

export function renderRuns(runs: TextRun[], options: InlineOptions): string {
	const merged = mergeRuns(runs);
	return renderLayers(merged, 0, options)
		// Two different highlights (or two bold spans) side by side need a break to parse.
		.replace(/(==|\*\*|~~)(?=\1[^\s=*~])/g, (m, d, offset, all) => all[offset - 1] && all[offset - 1] !== ' ' ? `${d}${ZERO_WIDTH_SPACE}` : m)
		.replace(/\r\n?/g, '\n').trim();
}
