// How an import shows its progress outside the import window, the way Obsidian shows its own
// loading ("Loading workspace..."): a status bar item with a short text and a small progress line,
// using Obsidian's own classes for it (status-bar-item mod-loading, progress-bar-indicator), so it
// looks the same in every theme. Hovering shows the notebook and section; clicking opens the
// import window, which has the details and the stop button. Before an import, the same item says
// what the hidden window is still doing (reading, checking for updates), and goes once it is done.

import { setTooltip } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { UiStrings } from './i18n.ts';

export interface ProgressState {
	done: number;
	total: number;
	notebook: string;
	section: string;
	startedAt: number;
	/** An update is running (with new notebooks imported first, if any). */
	updating?: boolean;
	/** Sections chosen from OneDrive are being downloaded (files, not sections, are counted). */
	downloading?: boolean;
}

export const elapsed = (ms: number) => {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export class ProgressDisplay {
	private readonly ui: UiStrings;
	private readonly statusEl: HTMLElement;
	private readonly textEl: HTMLElement;
	private readonly indicatorEl: HTMLElement;
	private readonly fillEl: HTMLElement;
	private state?: ProgressState;
	private readonly timer: number;

	constructor(plugin: Plugin, ui: UiStrings, open: () => void) {
		this.ui = ui;
		this.statusEl = plugin.addStatusBarItem();
		this.statusEl.addClass('mod-loading', 'mod-clickable', 'onenote-ferry-status');
		this.textEl = this.statusEl.createSpan({ cls: 'onenote-ferry-status-text', text: ui.statusReading });
		// Obsidian's own progress line: sliding back and forth until the number of sections is known.
		this.indicatorEl = this.statusEl.createDiv('progress-bar-indicator');
		this.indicatorEl.createDiv('progress-bar-line');
		this.fillEl = this.indicatorEl.createDiv('progress-bar-subline mod-increase');
		this.indicatorEl.createDiv('progress-bar-subline mod-decrease');
		this.statusEl.addEventListener('click', open);
		setTooltip(this.statusEl, `${ui.statusReading}\n${ui.statusTooltip}`, { placement: 'top' });
		// The elapsed time moves on between sections too.
		this.timer = window.setInterval(() => this.render(), 1000);
		plugin.registerInterval(this.timer);
	}

	/** What the import window does while it is hidden, before an import (§11.5 item 83): the words, with the line sliding. */
	busy(text: string): void {
		this.textEl.setText(text);
		setTooltip(this.statusEl, `${text}\n${this.ui.statusTooltip}`, { placement: 'top' });
	}

	update(state: ProgressState): void {
		if (!this.state) {
			// The number of sections is known: from sliding to filling.
			this.indicatorEl.querySelector('.mod-decrease')?.remove();
			this.fillEl.removeClass('mod-increase');
			this.fillEl.addClass('onenote-ferry-status-fill');
		}
		this.state = state;
		this.render();
	}

	private render(): void {
		const state = this.state;
		if (!state) return;
		const fraction = state.total ? state.done / state.total : 0;
		const ui = this.ui, current = Math.min(state.done + 1, state.total);
		this.textEl.setText(state.downloading ? ui.statusDownloading(current, state.total) : state.updating ? ui.statusUpdating(current, state.total) : ui.statusImporting(current, state.total));
		this.fillEl.setCssProps({ '--onenote-ferry-progress': String(fraction) });
		const time = this.ui.elapsed(elapsed(Date.now() - state.startedAt));
		setTooltip(this.statusEl, `${state.notebook} / ${state.section}\n${time}\n${this.ui.statusTooltip}`, { placement: 'top' });
	}

	/** Ends the display: the status bar item goes away. */
	finish(): void {
		window.clearInterval(this.timer);
		this.statusEl.remove();
	}
}
