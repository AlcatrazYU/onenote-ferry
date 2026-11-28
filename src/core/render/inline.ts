// Renders a paragraph's text runs to Markdown.
// Adapted from Obsidian Importer (MIT), src/formats/onenote-file/convert.ts at commit fa9444a,
// with layered formatting, colour dots, link handling and escaping reworked.
// See THIRD_PARTY_LICENSES.md.
//
// Written as Markdown that reads the same in Obsidian's editing view as in its reading view, without
// turning into HTML what Markdown can write (§11.5 item 87). The editing view lets `**` and `*` open
// and close only where CommonMark does: punctuation at the edge of a bold stretch, next to a letter
// outside it, is left out of the stretch instead. HTML stays for what Markdown cannot write (a
// colour, an underline, a script); such text carries its own bold, italic and strikethrough, which
// Markdown around it does not reach in the editing view, and Markdown delimiters never touch its
// tags. In a paragraph with bold or italic, the asterisks of its own text are escaped.

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

/**
 * Escapes text written in HTML. The reading view still reads Markdown there, the editing view does
 * not (it shows a backslash as it is), so only what the reading view would take as Markdown is
 * escaped: brackets that make a link, wikilink or footnote (`[[`, `[^`, `^[`, `](`, `][`), doubled `=`
 * and `~`, and every `*`, `_`, `` ` ``, `$` and backslash (§11.5 item 88). In a link's text every
 * bracket is escaped: one would end the text, or start another.
 */
function escapeInHtml(text: string, inLink: boolean): string {
	const special = inLink ? /[\\*_`$[\]]|={2,}|~{2,}/g : /[\\*_`$]|\[(?=[[^])|(?<=\^)\[|\](?=[([])|={2,}|~{2,}/g;
	return text.replace(special, match => match.replace(/./g, '\\$&'));
}

/** A run written in HTML: a colour (always kept, §11.5 item 68), an underline (not a link's), a script. */
function inHtml(run: TextRun): boolean {
	return !run.math && (!!run.color || !!run.superscript || !!run.subscript || (!!run.underline && !run.hyperlinkUrl));
}

/**
 * The innermost layer: text, math, and the HTML-only styles (underline, scripts, colour). Text
 * written in HTML carries its own bold, italic and strikethrough, which Markdown around it does not
 * give it in the editing view.
 */
function renderLeaf(run: TextRun, options: InlineOptions, escapeStars: boolean): string {
	const [leading, core, trailing] = splitSpace(run.text);
	if (core === '') return run.text;

	if (run.math) {
		const latex = toLatex(core);
		return latex === '' ? '' : `${leading}$${latex}$${trailing}`;
	}
	if (!inHtml(run)) {
		const text = escapeInline(core);
		return leading + (escapeStars ? text.replace(/\*/g, '\\*') : text) + trailing;
	}

	let html = escapeInHtml(htmlEscape(core), !!run.hyperlinkUrl);
	if (run.superscript) html = `<sup>${html}</sup>`;
	if (run.subscript) html = `<sub>${html}</sub>`;
	if (run.underline && !run.hyperlinkUrl) html = `<u>${html}</u>`;
	if (run.strikethrough) html = `<s>${html}</s>`;
	if (run.italic) html = `<i>${html}</i>`;
	if (run.bold) html = `<b>${html}</b>`;
	if (run.color) html = `<span style="color:${run.color}">${html}</span>`;
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

/**
 * Bold and italic delimiters, written once a paragraph is laid out (see placeDelimiters), which may
 * move them past punctuation. Stand-ins for them come from a private-use plane.
 */
interface Delimiters {
	kinds: ('bold' | 'italic')[];
	/** The paragraph has bold or italic in Markdown: the asterisks of its own text are escaped. */
	escapeStars: boolean;
}

const STAND_IN = 0xF0000;

function wrapLayer(layer: Layer, value: string, content: string, options: InlineOptions, delimiters: Delimiters): string {
	const [leading, core, trailing] = splitSpace(content);
	if (core === '') return content;
	switch (layer) {
		case 'highlight': return `${leading}==${value}${core}==${trailing}`;
		case 'link': return `${leading}${linkMarkdown(core, value, options)}${trailing}`;
		case 'strike': return `${leading}~~${core}~~${trailing}`;
		case 'bold':
		case 'italic': {
			const k = delimiters.kinds.push(layer) - 1;
			return `${leading}${String.fromCodePoint(STAND_IN + 2 * k)}${core}${String.fromCodePoint(STAND_IN + 2 * k + 1)}${trailing}`;
		}
	}
}

const WHITESPACE = /\s/u, PUNCTUATION = /[\p{P}\p{S}]/u;
/** The tags written here: those of text written in HTML. */
const TAG = /^<\/?(?:b|i|s|u|sup|sub|span)(?: [^<>]*)?>$/;
/** What a backslash escapes: ASCII punctuation. Before anything else it is a character of its own. */
const ESCAPABLE = /^[!-/:-@[-`{-~]$/;

/**
 * Writes the bold and italic delimiters the stand-ins hold, as `**` and `*`. Where one would not
 * open or close by CommonMark's rule (the one Obsidian's editing view keeps), it moves inward past
 * the punctuation and spaces in its way, which are then left out of the style; a pair left with
 * nothing inside goes. Delimiters side by side move together, as they are read as one. They never
 * move into an HTML tag, across a line break, or between a backslash and what it escapes. The
 * editing view reads one UTF-16 unit on each side, so an emoji counts as a letter; a stand-in
 * counts as punctuation, as it is written.
 */
function placeDelimiters(text: string, delimiters: Delimiters): string {
	if (!delimiters.kinds.length) return text;
	const chars = [...text];
	const standIn = (c: string | undefined) => c !== undefined && c.codePointAt(0)! >= STAND_IN && c.codePointAt(0)! < STAND_IN + 2 * delimiters.kinds.length;
	const opening = (c: string) => (c.codePointAt(0)! - STAND_IN) % 2 === 0;
	const space = (c: string | undefined) => c === undefined || WHITESPACE.test(c);
	const punct = (c: string | undefined) => c !== undefined && (standIn(c) || (c.length === 1 && PUNCTUATION.test(c)));
	// Whether the character at i is escaped: an odd number of backslashes before it.
	const escaped = (i: number) => {
		let n = 0;
		while (i - n - 1 >= 0 && chars[i - n - 1] === '\\') n++;
		return n % 2 === 1;
	};
	// A backslash that is not itself escaped: a delimiter written right after it would be escaped.
	const bare = (i: number) => chars[i] === '\\' && !escaped(i);
	// Whether the `>` at i ends one of the tags written here (the text's own `<` is always escaped, its `>` is not).
	const tagEnd = (i: number) => {
		const from = chars.lastIndexOf('<', i);
		return from >= 0 && i - from < 64 && !escaped(from) && TAG.test(chars.slice(from, i + 1).join(''));
	};
	// What a delimiter may move past: punctuation or a space, but no other delimiter or line break (tags: below).
	const movable = (c: string | undefined) => c !== undefined && !standIn(c) && c !== '\n' && c !== '\r' && (punct(c) || space(c));
	for (let i = 0; i < chars.length;) {
		if (!standIn(chars[i])) {
			i++;
			continue;
		}
		let j = i;
		while (standIn(chars[j])) j++;
		const group = chars.slice(i, j);
		if (group.every(opening)) {
			// Opens: something other than a space after it, and not punctuation unless before it is too.
			for (;;) {
				const before = chars[i - 1], after = chars[j];
				if (!space(after) && (!punct(after) || space(before) || punct(before))) break;
				// A `<` after it starts a tag (the text's own are escaped, and it never splits an escape).
				if (!movable(after) || after === '<') break;
				// A backslash moves with the punctuation it escapes. Before anything else it stays a
				// character of its own, and the delimiter cannot go after it: it stops there.
				const step = bare(j) ? 2 : 1;
				if (step === 2 && !ESCAPABLE.test(chars[j + 1] ?? '')) break;
				chars.splice(i, 0, ...chars.splice(j, step));
				i += step;
				j += step;
			}
		}
		else if (!group.some(opening)) {
			for (;;) {
				const last = chars[i - 1], next = chars[j];
				if (!space(last) && (!punct(last) || space(next) || punct(next))) break;
				if (!movable(last) || (last === '<' && !escaped(i - 1)) || (last === '>' && tagEnd(i - 1))) break;
				const step = escaped(i - 1) ? 2 : 1;
				// Never right after a backslash of the text (one there already escapes it; leave it), and
				// never between a backslash and punctuation it does not escape.
				if (bare(i - 1) || bare(i - step - 1) || (step === 2 && !ESCAPABLE.test(last))) break;
				chars.splice(j - step, 0, ...chars.splice(i - step, step));
				i -= step;
				j -= step;
			}
		}
		i = j;
	}
	// A pair with nothing left inside goes (it held only punctuation).
	for (let removed = true; removed;) {
		removed = false;
		for (let i = 0; i + 1 < chars.length; i++) {
			const a = chars[i], b = chars[i + 1];
			if (standIn(a) && standIn(b) && opening(a) && b.codePointAt(0)! === a.codePointAt(0)! + 1) {
				chars.splice(i, 2);
				removed = true;
			}
		}
	}
	return chars.map(c => {
		if (!standIn(c)) return c;
		return delimiters.kinds[Math.floor((c.codePointAt(0)! - STAND_IN) / 2)] === 'bold' ? '**' : '*';
	}).join('');
}

/**
 * Formatting is nested: one highlight wraps every consecutive run of the same
 * colour, whatever else changes inside it, so a highlight is never cut up.
 */
function renderLayers(runs: TextRun[], level: number, options: InlineOptions, delimiters: Delimiters): string {
	if (level === LAYERS.length) return runs.map(run => renderLeaf(run, options, delimiters.escapeStars)).join('');
	const layer = LAYERS[level];
	let out = '';
	for (let i = 0; i < runs.length;) {
		const value = layerValue(runs[i], layer);
		let j = i + 1;
		while (j < runs.length && layerValue(runs[j], layer) === value) j++;
		const group = runs.slice(i, j);
		const inside = (part: TextRun[]) => renderLayers(part, level + 1, options, delimiters);
		if (value && (layer === 'bold' || layer === 'italic' || layer === 'strike')) {
			// Text written in HTML carries its own bold, italic and strikethrough (renderLeaf): at the
			// ends of the stretch it stays outside, so the Markdown delimiters never touch its tags.
			let start = 0, end = group.length;
			while (start < end && inHtml(group[start])) start++;
			while (end > start && inHtml(group[end - 1])) end--;
			out += inside(group.slice(0, start));
			if (start < end) out += wrapLayer(layer, value, inside(group.slice(start, end)), options, delimiters);
			out += inside(group.slice(Math.max(start, end)));
		}
		else out += value ? wrapLayer(layer, value, inside(group), options, delimiters) : inside(group);
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
	const delimiters: Delimiters = { kinds: [], escapeStars: merged.some(run => (run.bold || run.italic) && !run.math && !inHtml(run)) };
	return placeDelimiters(renderLayers(merged, 0, options, delimiters), delimiters)
		// Two different highlights (or two bold spans) side by side need a break to parse.
		// Not from an escaped character (a typed `\*` beside a delimiter is no `**`).
		.replace(/(?<!\\)(==|\*\*|~~)(?=\1[^\s=*~])/g, (m, d, offset, all) => all[offset - 1] && all[offset - 1] !== ' ' ? `${d}${ZERO_WIDTH_SPACE}` : m)
		.replace(/\r\n?/g, '\n').trim();
}
