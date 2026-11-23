// File and folder names.

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

/** A name safe for files on every system, at most `max` characters, never empty, composed (NFC). */
export function safeName(name: string, fallback: string, max = 80): string {
	let s = composedText(name).replace(ILLEGAL, c => FULLWIDTH[c] ?? '');
	s = s.replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
	if ([...s].length > max) s = [...s].slice(0, max).join('').trim();
	return s || fallback;
}

/** Joins path parts with `/`. */
export function joinPath(...parts: string[]): string {
	return parts.filter(part => part !== '').join('/');
}

/** Sorts names the way the original converter did: Chinese collation, numbers by value. */
export const nameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true });
