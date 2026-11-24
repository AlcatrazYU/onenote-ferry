// The plugin's icon: a paper boat on a wave (notes carried across). Drawn on the 24 grid of
// Obsidian's own icons (Lucide), with no stroke width of its own, so it takes the user's icon
// stroke setting the way the built-in icons do.

import { addIcon } from 'obsidian';

export const ICON = 'onenote-ferry';

const PAPER_BOAT = [
	'M2 10.5 H7.5 L12 3 L16.5 10.5 H22 L18 16.5 H6 Z',
	'M2 21 Q4.5 18.5 7 21 T12 21 T17 21 T22 21',
];

/**
 * Registers the icon. Obsidian puts a custom icon's content in an svg with a 100 by 100 view box;
 * the group scales the 24 grid up to it, and the inherited stroke width scales with it.
 */
export function registerIcon(): void {
	const paths = PAPER_BOAT.map(d => `<path d="${d}"/>`).join('');
	addIcon(ICON, `<g transform="scale(${100 / 24})" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`);
}
