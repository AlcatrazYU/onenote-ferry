// Markdown escaping helpers.
// Adapted from Obsidian Importer (MIT), src/markdown.ts at commit fa9444a.
// See THIRD_PARTY_LICENSES.md.

/** Escapes plain text that Markdown would reinterpret structurally. */
export function escapeInline(text: string): string {
	return text.replace(/[[\]`<]/g, '\\$&');
}

/** Escapes what would turn a line into a heading, list item, quote, table row, fence or rule. */
export function escapeLineStart(line: string): string {
	// A backslash before a digit is shown as is, so a numbered line escapes its period instead.
	return line
		.replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2')
		.replace(/^(\s*)(#{1,6}(?=\s|$)|>|\||[-*+](?=\s)|`{3,}|~{3,}|-{3,}$|={3,}$)/, '$1\\$2');
}
