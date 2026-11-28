// A page's content as one short string (§11.5 item 59). OneNote leaves a page's last-modified time
// as it was when its text is edited, a paragraph deleted, a highlight or a picture changed (seen on
// real downloads), so what changed in OneNote is told by the content itself: the import records
// each page's fingerprint in its report, and a check for updates compares it with the download's.
//
// Left out, because OneNote changes them by itself: the widths of text boxes and pictures (when a
// page is opened), and a picture's recognised text and the alt text it fills in from it (when its
// image recognition finishes, after the page was written). The converter writes no recognised text,
// and alt text only when asked. Places (x, y) are kept: moving a text box changes the reading order.

// The fingerprint hashes the parser's page content as it is, so it changes when that content gains
// or changes a key, though OneNote changed nothing (§11.5 item 79). Each fingerprint therefore says
// which way it was made ("v2:…"), and only fingerprints made the same way are compared; a page
// recorded another way (or before versions, with none) is told by its time, as before fingerprints,
// until it is written again. Raise FINGERPRINT_VERSION with any change to the parser's page JSON.

/** How fingerprints are made now: raise it whenever the parser's page JSON changes (§11.5 item 79). */
export const FINGERPRINT_VERSION = 2;

/** Keys of the parser's page content whose values do not count as a change. */
const IGNORED = new Set(['w', 'ocr', 'alt']);

function withoutNoise(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutNoise);
	if (value === null || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) if (!IGNORED.has(key)) out[key] = withoutNoise(inner);
	return out;
}

/** The fingerprint of a page's content as the parser gives it (`contents` of a page), with the way it was made. */
export async function pageFingerprint(contents: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(withoutNoise(contents ?? null)));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
	return `v${FINGERPRINT_VERSION}:${[...digest.slice(0, 10)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Whether two fingerprints were made the same way, so that comparing them tells whether the content changed. */
export function comparable(a: string, b: string): boolean {
	const way = (fingerprint: string) => /^v\d+:/.exec(fingerprint)?.[0];
	return way(a) !== undefined && way(a) === way(b);
}
