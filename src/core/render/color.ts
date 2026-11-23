// Colour rules: which highlight dot a background colour gets, and which font colours are kept.

function hsl(color: string): { h: number, s: number, l: number, d: number } | undefined {
	const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return undefined;
	const [r, g, b] = match.slice(1).map(part => parseInt(part, 16) / 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
	// HSL saturation, so Office's pale tints (e.g. #ebf1dd) keep their hue.
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (d !== 0) {
		h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s, l, d };
}

/** Picks a colour dot by hue, so a pale yellow stays yellow. */
export function highlightMarker(color: string | undefined): string {
	if (!color) return '';
	const c = hsl(color);
	if (!c) return '🟡';
	if (c.s < 0.15 || c.d < 0.02) return c.l > 0.5 ? '⚪' : '⚫';
	if (c.h < 15 || c.h >= 345) return '🔴';
	if (c.h < 40) return '🟠';
	if (c.h < 70) return '🟡';
	if (c.h < 165) return '🟢';
	if (c.h < 260) return '🔵';
	return '🟣';
}

/** Keeps a font colour only when it is clearly an emphasis colour (red, blue...), not near-black or grey text pasted from the web. */
export function emphasisColor(color: string | undefined): string | undefined {
	if (!color) return undefined;
	const c = hsl(color);
	if (!c) return undefined;
	return c.s >= 0.4 && c.l >= 0.2 && c.l <= 0.8 ? color.toLowerCase() : undefined;
}
