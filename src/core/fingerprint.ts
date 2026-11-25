// A page's content as one short string (§11.5 item 59). OneNote leaves a page's last-modified time
// as it was when its text is edited, a paragraph deleted, a highlight or a picture changed (seen on
// real downloads), so what changed in OneNote is told by the content itself: the import records
// each page's fingerprint in its report, and a check for updates compares it with the download's.
//
// Left out, because OneNote changes them by itself: the widths of text boxes and pictures (when a
// page is opened), and a picture's recognised text and the alt text it fills in from it (when its
// image recognition finishes, after the page was written). The converter writes no recognised text,
// and alt text only when asked. Places (x, y) are kept: moving a text box changes the reading order.

/** Keys of the parser's page content whose values do not count as a change. */
const IGNORED = new Set(['w', 'ocr', 'alt']);

function withoutNoise(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutNoise);
	if (value === null || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) if (!IGNORED.has(key)) out[key] = withoutNoise(inner);
	return out;
}

/** The fingerprint of a page's content as the parser gives it (`contents` of a page). */
export async function pageFingerprint(contents: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(withoutNoise(contents ?? null)));
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes));
	return [...digest.slice(0, 10)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
