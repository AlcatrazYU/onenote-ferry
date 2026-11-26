// The thin line along the OneDrive row (wizard.ts): what it shows next, from what it showed and
// what goes on now. Kept apart, without Obsidian, so its rules are tested: it shows progress when
// that can be told and slides when not; within one measure it only goes forward; and a change of
// way soon after the last one waits, so quick back-and-forth never shows (Internal-10 §23.6, §25).

/** What the line counts: notebooks read, a check for updates (sections read), bytes of a download; none. */
export type LineMeasure = 'reading' | 'check' | 'list' | 'download' | 'none';
export type LineMode = 'idle' | 'slide' | 'bar';

/** How the line shows, since when, counting what. */
export interface LineShown {
	measure: LineMeasure;
	mode: LineMode;
	/** Percent, when it shows progress. */
	value: number;
	since: number;
}

/**
 * The line's next look. `fraction`: how far (0 to 1), undefined when that cannot be told, null when
 * nothing goes on. Answers what to paint, what is shown from now on, and, when a change waits, in
 * how many milliseconds to look again.
 */
export function nextLine(shown: LineShown | undefined, measure: LineMeasure, fraction: number | undefined | null, now: number, holdMs: number): { paint: { mode: LineMode, value: number }, shown: LineShown | undefined, wait?: number } {
	let mode: LineMode = fraction === null ? 'idle' : fraction === undefined ? 'slide' : 'bar';
	let value = fraction == null ? 30 : Math.floor(fraction * 100);
	// Within one measure the line only goes forward: once it counts, it does not slide again, and it
	// does not run back (more to read, found on the way, makes the count smaller).
	if (shown?.measure === measure && shown.mode === 'bar') {
		if (mode === 'slide') {
			mode = 'bar';
			value = shown.value;
		}
		else if (mode === 'bar') value = Math.max(shown.value, value);
	}
	// A change of way soon after the last one waits: it shows only if it lasts.
	if (shown && shown.mode !== mode && now - shown.since < holdMs) {
		return { paint: { mode: shown.mode, value: shown.value }, shown, wait: holdMs - (now - shown.since) };
	}
	return { paint: { mode, value }, shown: shown?.mode === mode ? { ...shown, measure, value } : { measure, mode, value, since: now } };
}
