// Every piece of text the converter inserts into the user's notes or folder names.
// Nothing else in the core may hard-code such text.
//
// Two layers (see the project plan):
// - marks inside notes follow the notebook's language;
// - structure names (folders, file names) are fixed for one import, because links and
//   later syncs depend on them.
// Page property keys (title, onenote-id, ...) are not here: they are always English.

export interface Strings {
	/** Comment before each text box on a page laid out in several columns. */
	boxMarker(index: number, total: number, leftCm: string, topCm: string): string;
	/** Shown where an embedded file has no data in the download. */
	missingAttachment(fileName: string): string;
	unnamedFile: string;
	untitledPage: string;
	conflictPageSuffix: string;
	tocTitle(name: string): string;
	sectionOrderNote: string;
	conversionFailedSuffix: string;
	attachmentsFolder: string;
	/** File name of a table of contents, without the `.md` extension. */
	tocFileName: string;
	oldVersionsFolder: string;
	updateLogFolder: string;
	reportFileName: string;
	/** `<page> - <image><nnn>`: the word for a picture in attachment names. */
	imageWord: string;
	/** `<page> - <ink><nn>`: the word for handwriting in attachment names. */
	inkWord: string;
}

export const zhHans: Strings = {
	boxMarker: (index, total, left, top) => `<!-- 第${index}块（共${total}块） 页面位置：左 ${left} cm，上 ${top} cm -->`,
	missingAttachment: name => `〔附件缺失：${name}（OneDrive 下载包里没有这个文件的数据）〕`,
	unnamedFile: '未命名文件',
	untitledPage: '无标题',
	conflictPageSuffix: '（冲突版本）',
	tocTitle: name => `${name} 目录`,
	sectionOrderNote: '> 分区按名称排序（OneDrive 下载的文件里没有 OneNote 中的分区顺序）。',
	conversionFailedSuffix: '（转换失败）',
	attachmentsFolder: '_附件',
	tocFileName: '_目录',
	oldVersionsFolder: '_旧版本',
	updateLogFolder: '_更新记录',
	reportFileName: '_转换报告.json',
	imageWord: '图',
	inkWord: '手写',
};
