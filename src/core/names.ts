// File and folder names.

// eslint-disable-next-line no-control-regex -- control characters cannot be in a file name: they are what is looked for
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f#^[\]]/g;

/** Characters a file name cannot hold (or Obsidian links cannot) become their full-width forms. */
const FULLWIDTH: Record<string, string> = {
	'/': '\uFF0F', '\\': '\uFF3C', ':': '\uFF1A', '*': '\uFF0A', '?': '\uFF1F', '"': '\uFF02',
	'<': '\uFF1C', '>': '\uFF1E', '|': '\uFF5C', '#': '\uFF03', '^': '\uFF3E', '[': '\uFF3B', ']': '\uFF3D',
};

// CJK compatibility ideographs: variant forms someone may have chosen on purpose. NFC would
// replace most of them with the unified character, so they are left as they are.
const COMPATIBILITY_IDEOGRAPH = /([\uF900-\uFAFF]|[\u{2F800}-\u{2FA1F}])/u;

/**
 * Text in composed Unicode form (NFC), except that CJK compatibility ideographs are kept. Names that
 * came through some macOS file interfaces, and text copied from some files, arrive decomposed (a
 * voiced kana as two characters): it looks the same but does not match what people type when they
 * search or link. Used for names and for the text of pages; link targets are left as written.
 */
export function composedText(text: string): string {
	return text.split(COMPATIBILITY_IDEOGRAPH).map((part, i) => i % 2 ? part : part.normalize('NFC')).join('');
}

/** Names Windows keeps for devices, alone or before an extension (`CON`, `nul.txt`). */
const DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/i;

/**
 * A name safe for files on every system, at most `max` characters, never empty, composed (NFC).
 * Windows refuses names that end with a dot or a space, and device names: the dots go, and a
 * device name gets an underscore (`CON` becomes `CON_`).
 */
export function safeName(name: string, fallback: string, max = 80): string {
	let s = composedText(name).replace(ILLEGAL, c => FULLWIDTH[c] ?? '');
	s = s.replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
	if ([...s].length > max) s = [...s].slice(0, max).join('').trim();
	s = s.replace(/[. ]+$/, '').replace(DEVICE_NAME, '$1_');
	return s || fallback;
}

/**
 * `name (n)`, shortened first when needed so that the number survives `safeName`'s limit of `max`
 * characters (otherwise a long name and its numbered twin would get the same folder).
 */
export function numberedName(name: string, n: number, max = 120): string {
	const suffix = ` (${n})`;
	const base = [...name.replace(/\s+/g, ' ').trim()];
	return `${base.slice(0, Math.max(1, max - suffix.length)).join('').trim()}${suffix}`;
}

/** Joins path parts with `/`. */
export function joinPath(...parts: string[]): string {
	return parts.filter(part => part !== '').join('/');
}

/** Sorts names the way the original converter did: Chinese collation, numbers by value. */
export const nameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true });
