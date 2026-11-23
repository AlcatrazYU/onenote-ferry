// File and folder names.

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f#^[\]]/g;

/** Characters a file name cannot hold (or Obsidian links cannot) become their full-width forms. */
const FULLWIDTH: Record<string, string> = {
	'/': '\uFF0F', '\\': '\uFF3C', ':': '\uFF1A', '*': '\uFF0A', '?': '\uFF1F', '"': '\uFF02',
	'<': '\uFF1C', '>': '\uFF1E', '|': '\uFF5C', '#': '\uFF03', '^': '\uFF3E', '[': '\uFF3B', ']': '\uFF3D',
};

/** A name safe for files on every system, at most `max` characters, never empty. */
export function safeName(name: string, fallback: string, max = 80): string {
	let s = name.replace(ILLEGAL, c => FULLWIDTH[c] ?? '');
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
