// The plugin's own interface text, in its four interface languages (English, Chinese, Japanese,
// Korean). Not the marks written into notes: those are in src/core/strings.ts.

export interface UiStrings {
	importing: string;
	sectionCount(current: number, total: number): string;
	elapsed(time: string): string;
	/** The status bar item while an import runs. */
	statusImporting(current: number, total: number): string;
	readingDownload: string;
	clickForDetails: string;
	clickToHide: string;
}

const en: UiStrings = {
	importing: 'OneNote Ferry: importing',
	sectionCount: (current, total) => `Section ${current} of ${total}`,
	elapsed: time => `${time} elapsed`,
	statusImporting: (current, total) => `Importing OneNote ${current}/${total}`,
	readingDownload: 'Reading the OneNote download...',
	clickForDetails: 'Click for details',
	clickToHide: 'Click to hide. The import goes on.',
};

const zh: UiStrings = {
	importing: 'OneNote Ferry：正在导入',
	sectionCount: (current, total) => `第 ${current} / ${total} 个分区`,
	elapsed: time => `已用 ${time}`,
	statusImporting: (current, total) => `正在导入 OneNote ${current}/${total}`,
	readingDownload: '正在读取 OneNote 下载包...',
	clickForDetails: '点击查看详情',
	clickToHide: '点击可收起，导入会继续。',
};

const ja: UiStrings = {
	importing: 'OneNote Ferry：インポート中',
	sectionCount: (current, total) => `セクション ${current} / ${total}`,
	elapsed: time => `経過 ${time}`,
	statusImporting: (current, total) => `OneNote をインポート中 ${current}/${total}`,
	readingDownload: 'OneNote のダウンロードを読み込み中...',
	clickForDetails: 'クリックで詳細を表示',
	clickToHide: 'クリックで閉じます。インポートは続きます。',
};

const ko: UiStrings = {
	importing: 'OneNote Ferry: 가져오는 중',
	sectionCount: (current, total) => `섹션 ${current} / ${total}`,
	elapsed: time => `경과 ${time}`,
	statusImporting: (current, total) => `OneNote 가져오는 중 ${current}/${total}`,
	readingDownload: 'OneNote 다운로드를 읽는 중...',
	clickForDetails: '클릭하면 자세히 보기',
	clickToHide: '클릭하면 닫힙니다. 가져오기는 계속됩니다.',
};

/** The interface text for Obsidian's language (`zh`, `zh-TW`, `ja`, `ko`...); English otherwise. */
export function uiStrings(language: string): UiStrings {
	const code = language.toLowerCase();
	if (code.startsWith('zh')) return zh;
	if (code === 'ja' || code.startsWith('ja-')) return ja;
	if (code === 'ko' || code.startsWith('ko-')) return ko;
	return en;
}
