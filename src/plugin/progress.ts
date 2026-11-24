// How an import shows its progress, the way Obsidian shows its own loading ("Loading
// workspace..."): a status bar item with a short text and a small progress line, using
// Obsidian's own classes for it (status-bar-item mod-loading, progress-bar-indicator), so it
// looks the same in every theme. Hovering shows the notebook and section; clicking opens a
// notice with the details.

import { Notice, ProgressBarComponent, setTooltip } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { UiStrings } from './i18n.ts';

export interface ProgressState {
	done: number;
	total: number;
	notebook: string;
	section: string;
	startedAt: number;
}

const elapsed = (ms: number) => {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export class ProgressDisplay {
	private readonly ui: UiStrings;
	private readonly statusEl: HTMLElement;
	private readonly textEl: HTMLElement;
	private readonly indicatorEl: HTMLElement;
	private readonly fillEl: HTMLElement;
	private notice?: Notice;
	private bar?: ProgressBarComponent;
	private countEl?: HTMLElement;
	private nameEl?: HTMLElement;
	private state?: ProgressState;
	private readonly timer: number;

	constructor(plugin: Plugin, ui: UiStrings) {
		this.ui = ui;
		this.statusEl = plugin.addStatusBarItem();
		this.statusEl.addClass('mod-loading', 'mod-clickable', 'onenote-ferry-status');
		this.textEl = this.statusEl.createSpan({ cls: 'onenote-ferry-status-text', text: ui.readingDownload });
		// Obsidian's own progress line: sliding back and forth until the number of sections is known.
		this.indicatorEl = this.statusEl.createDiv('progress-bar-indicator');
		this.indicatorEl.createDiv('progress-bar-line');
		this.fillEl = this.indicatorEl.createDiv('progress-bar-subline mod-increase');
		this.indicatorEl.createDiv('progress-bar-subline mod-decrease');
		this.statusEl.addEventListener('click', () => this.showDetails());
		setTooltip(this.statusEl, ui.readingDownload, { placement: 'top' });
		// The elapsed time moves on between sections too.
		this.timer = window.setInterval(() => this.render(), 1000);
		plugin.registerInterval(this.timer);
	}

	private detailsShowing(): boolean {
		const el = this.notice?.containerEl ?? this.notice?.noticeEl;
		return !!el?.isConnected;
	}

	/** A notice with the details (shown on a click on the status bar item). */
	showDetails(): void {
		if (this.detailsShowing()) return;
		const fragment = createFragment();
		const box = fragment.createDiv({ cls: 'onenote-ferry-progress' });
		box.createDiv({ cls: 'onenote-ferry-progress-title', text: this.ui.importing });
		this.bar = new ProgressBarComponent(box);
		this.countEl = box.createDiv({ cls: 'onenote-ferry-progress-count' });
		this.nameEl = box.createDiv({ cls: 'onenote-ferry-progress-name' });
		box.createDiv({ cls: 'onenote-ferry-progress-hint', text: this.ui.clickToHide });
		this.notice = new Notice(fragment, 0);
		this.render();
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
		this.textEl.setText(this.ui.statusImporting(state.done + 1, state.total));
		this.fillEl.setCssProps({ '--onenote-ferry-progress': String(fraction) });
		const time = this.ui.elapsed(elapsed(Date.now() - state.startedAt));
		setTooltip(this.statusEl, `${state.notebook} / ${state.section}\n${time}\n${this.ui.clickForDetails}`, { placement: 'top' });
		if (!this.detailsShowing()) return;
		this.bar?.setValue(Math.floor(fraction * 100));
		this.countEl?.setText(`${this.ui.sectionCount(state.done + 1, state.total)} · ${time}`);
		const name = `${state.notebook} / ${state.section}`;
		this.nameEl?.setText(name);
		this.nameEl?.setAttribute('title', name);
	}

	/** Ends the display: the status bar item and the notice go away. */
	finish(): void {
		window.clearInterval(this.timer);
		this.notice?.hide();
		this.statusEl.remove();
	}
}
