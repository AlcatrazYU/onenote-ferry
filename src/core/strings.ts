// Every piece of text the converter inserts into the user's notes or folder names.
// Nothing else in the core may hard-code such text.
//
// Two layers (see the project plan):
// - marks inside notes follow the notebook's language;
// - structure names (folders, file names) are fixed for one import, because links and
//   later syncs depend on them.
// Page property keys (title, onenote-id, ...) are not here: they are always English.

export type Language = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko';

export const LANGUAGES: readonly Language[] = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'];

export interface Strings {
	/** Comment before each text box on a page laid out in several columns. */
	boxMarker(index: number, total: number, leftCm: string, topCm: string): string;
	/** Shown where an embedded file has no data in the download. */
	missingAttachment(fileName: string): string;
	/** Shown where pictures have no data in the download; pictures in a row share one notice. `names`: the known file names. */
	missingImages(count: number, names: string[]): string;
	/** Shown where printout pages `first` to `last` (1-based) of a document have no data in the download. */
	missingPrintoutPages(document: string, first: number, last: number): string;
	/** Above handwriting written on a printout page that cannot be drawn under it (the notes follow on a blank page outline). */
	printoutNotes(document: string, page: number): string;
	unnamedFile: string;
	untitledPage: string;
	conflictPageSuffix: string;
	tocTitle(name: string): string;
	/** Heading in a section's contents page above the pages OneNote no longer has (they stay, §11.5 item 51). */
	noLongerInOneNote: string;
	sectionOrderNote: string;
	conversionFailedSuffix: string;
	/** After a section that is password protected (in the notebook's table of contents). */
	passwordProtectedSuffix: string;
	/** After a section left out because the import was cancelled (in the notebook's table of contents). */
	cancelledSuffix: string;
	/** After a section not chosen for import, in the notebook's table of contents. */
	notImportedSuffix: string;
	/** Why a password-protected section was not converted (report and command line). */
	passwordProtected: string;
	/** Why a section the download stopped inside was not converted (its table of contents, report and command line). */
	incompleteSection: string;
	/** Title of the collapsed callout holding an image's alternative text. */
	altTextTitle: string;
	/** The note in a section that could not be converted, with the parser's message. */
	conversionFailedNote(error: string): string;
	attachmentsFolder: string;
	/** File name of a table of contents, without the `.md` extension. */
	tocFileName: string;
	oldVersionsFolder: string;
	updateLogFolder: string;
	/** Inside an update's previous versions: files an update wrote and then took back (a section it could not finish). */
	notAppliedFolder: string;
	/** The import report's file name without its extension: `.md` to read, `.json` for programs (later syncs). */
	reportName: string;
	report: ReportStrings;
	update: UpdateStrings;
	/** `<page> - <image><nnn>`: the word for a picture in attachment names. */
	imageWord: string;
	/** `<page> - <ink><nn>`: the word for handwriting in attachment names. */
	inkWord: string;
}

/** The import report (written in the reader's language, not each notebook's). */
export interface ReportStrings {
	title: string;
	/** What the page is, and where each update's changes are: `logFolder` is the update log folder's name. */
	intro(logFolder: string): string;
	lastImport: string;
	time(time: string): string;
	/** The downloads an import came from (file or folder names, already escaped). */
	source(names: string[]): string;
	totals(notebooks: number, sections: number, pages: number, attachments: number): string;
	notConverted(sections: number): string;
	links(rewritten: number, unresolved: number): string;
	cancelled(sections: number): string;
	notebooks: string;
	/** Column heads of the notebooks table: notebook, imported, sections, pages, attachments, not converted. */
	columns: [string, string, string, string, string, string];
	attention: string;
	nothingToNote: string;
	/** A section that was not converted, and why (`name` is already escaped for Markdown). */
	sectionNotConverted(name: string, reason: string): string;
	/** Sections of one notebook left out because the import was stopped. */
	sectionsCancelled(sections: number): string;
	/** Notebooks the import was stopped before. */
	notStarted(notebooks: string[]): string;
	/** The last import had not ended when the report was written: still running, or Obsidian was closed during it. */
	unfinished: string;
	/** Sections listed without their earlier record (the report's data was deleted or changed). */
	recordsMissing: string;
	/** After a link to a page: pictures, attachments or printout pages with no data in the download. */
	missingItems(count: number): string;
	/** The last run was an update: what it changed is in its record (`record` is a link). */
	update(record: string): string;
}

/** What an update changed (§11.5 item 49), counted for its record. */
export interface UpdateCounts {
	sectionsUpdated: number;
	sectionsAdded: number;
	/** Sections without changes converted again with the settings chosen now. */
	sectionsReconverted: number;
	pagesAdded: number;
	pagesModified: number;
	pagesRemoved: number;
	/** Pages the user had deleted in Obsidian, brought back. */
	pagesRestored: number;
}

/** An update's record (written in the reader's language). Names and links come already escaped. */
export interface UpdateStrings {
	title(time: string): string;
	/**
	 * `folder`: where the versions the update replaced went (none when it replaced nothing);
	 * `report`: a link to the conversion report (an overview of every notebook in the folder).
	 */
	intro(folder?: string, report?: string): string;
	counts(counts: UpdateCounts): string;
	/** Stopped before every chosen section was updated. */
	stopped: string;
	/** Cut off (Obsidian closed, say) and finished later. */
	resumed: string;
	attention: string;
	nothingToNote: string;
	/** Before the list of pages changed on both sides. */
	bothEdited: string;
	/** A page changed on both sides: the new version, and the user's (a link to its copy). */
	bothEditedPage(page: string, yours: string): string;
	/** Above the pages a conversion again left as they were (edited in Obsidian). */
	keptEdited: string;
	yourVersion: string;
	rolledBack(section: string, reason: string): string;
	/** Why a section was put back: the update was cut off and its converted version was gone. */
	interrupted: string;
	notConverted(section: string, reason: string): string;
	/** A section that could be read but not updated: something is in a folder it needs. */
	notUpdated(section: string, reason: string): string;
	folderTaken(folder: string): string;
	/** Files that were not as the update expected (changed meanwhile), copied into `folder` before they were written over. */
	keptAside(files: number, folder: string): string;
	/** A notebook whose folder holds what the plugin did not write. */
	occupiedNotebook(notebook: string): string;
	/** A section imported before that is not in the vault any more, imported again because the user chose to. */
	missingSection(name: string): string;
	gone(sections: string[]): string;
	occupied(sections: string[]): string;
	different(notebook: string): string;
	/** Before the list of pages and sections that moved: links to them from elsewhere may break. */
	moved: string;
	changes: string;
	section(name: string, was?: string): string;
	newSection(name: string): string;
	/** A section converted again with the settings chosen now, and how many of its pages were written anew. */
	reconvertedSection(name: string, pages: number): string;
	added(page: string): string;
	/** A changed page, a link to its version before, and its title before when OneNote changed that. */
	modified(page: string, before: string, was?: string): string;
	before: string;
	/** A page OneNote deleted, which stays where it is. */
	removed(page: string): string;
	/** A page the user had deleted in Obsidian, written back because they chose to. */
	restored(page: string): string;
	/** Pages the user deleted in Obsidian, not written back (`pages` are links). */
	notRestored(pages: string[]): string;
	reordered(pages: number): string;
	/** After a page changed on both sides, in the list of changes. */
	bothEditedMark: string;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const num = (n: number) => n.toLocaleString('en-US');

export const en: Strings = {
	boxMarker: (index, total, left, top) => `<!-- Box ${index} of ${total}, position on page: left ${left} cm, top ${top} cm -->`,
	missingAttachment: name => `[Missing attachment: ${name}. The OneDrive download has no data for this file.]`,
	missingImages: (count, names) => count === 1
		? `[Missing image${names.length ? `: ${names[0]}` : ''}. The OneDrive download has no data for this image.]`
		: `[${count} missing images${names.length ? `: ${names.join(', ')}` : ''}. The OneDrive download has no data for these images.]`,
	missingPrintoutPages: (document, first, last) => first === last
		? `[Missing printout page ${first} of ${document}. The OneDrive download has no data for this page.]`
		: `[Missing printout pages ${first} to ${last} of ${document}. The OneDrive download has no data for these pages.]`,
	printoutNotes: (document, page) => `[Handwriting on page ${page} of ${document}, drawn where it sits on that page.]`,
	unnamedFile: 'unnamed file',
	untitledPage: 'Untitled',
	conflictPageSuffix: ' (conflict)',
	tocTitle: name => `${name} contents`,
	noLongerInOneNote: 'Pages no longer in OneNote',
	sectionOrderNote: '> Sections are sorted by name (files downloaded from OneDrive do not record the section order in OneNote).',
	conversionFailedSuffix: ' (conversion failed)',
	passwordProtectedSuffix: ' (password protected, not converted)',
	cancelledSuffix: ' (not converted: the import was cancelled)',
	notImportedSuffix: ' (not imported)',
	passwordProtected: 'This section is password protected and cannot be read. Remove its password protection in OneNote, then download it again.',
	incompleteSection: 'This section did not download completely. Download again to get it.',
	altTextTitle: 'Alt text',
	conversionFailedNote: error => `This section could not be converted. The parser reported: ${error}`,
	attachmentsFolder: '_attachments',
	tocFileName: '_contents',
	oldVersionsFolder: '_previous versions',
	updateLogFolder: '_sync log',
	notAppliedFolder: '_not applied',
	reportName: '_conversion report',
	report: {
		title: 'OneNote conversion report',
		intro: logFolder => `An overview of this folder: the notebooks in it, and what could not be converted. It is rewritten after each import or update. What each update changed in notebooks imported before is in "${logFolder}".`,
		lastImport: 'Last import',
		time: time => `Time: ${time}`,
		source: names => `From: ${names.join(', ')}`,
		totals: (notebooks, sections, pages, attachments) => [plural(notebooks, 'notebook', 'notebooks'), plural(sections, 'section', 'sections'), plural(pages, 'page', 'pages'), plural(attachments, 'attachment', 'attachments')].join(', '),
		notConverted: sections => `${plural(sections, 'section', 'sections')} not converted (listed below)`,
		links: (rewritten, unresolved) => `Links between pages: ${num(rewritten)} rewritten${unresolved ? `, ${num(unresolved)} left as they were (their page is not in this folder)` : ''}`,
		cancelled: sections => `The import was stopped: ${plural(sections, 'section was', 'sections were')} not converted.`,
		notebooks: 'Notebooks',
		columns: ['Notebook', 'Imported', 'Sections', 'Pages', 'Attachments', 'Not converted'],
		attention: 'Needs attention',
		nothingToNote: 'Nothing needs attention: every section imported was converted, with all its pictures and attachments.',
		sectionNotConverted: (name, reason) => `Section "${name}": ${reason}`,
		sectionsCancelled: sections => `${plural(sections, 'section was', 'sections were')} not converted because the import stopped. Import again to add the sections not imported yet to this notebook.`,
		notStarted: notebooks => `Notebooks not imported because the import stopped: ${notebooks.join(', ')}. Import again to add them.`,
		unfinished: 'This import has not finished yet, or Obsidian was closed during it. Import again to add the sections not imported yet.',
		recordsMissing: 'Some sections have no earlier record (the data of this report was deleted or changed), so the page and attachment counts here may be incomplete.',
		missingItems: count => `${plural(count, 'picture or attachment', 'pictures or attachments')} missing (the download has no data for ${count === 1 ? 'it' : 'them'})`,
		update: record => `This run updated notes imported before; what changed is in ${record}.`,
	},
	update: {
		title: time => `Sync log ${time}`,
		intro: (folder, report) => `What this update did to notebooks imported before, sections added to them included.${folder ? ` The versions it replaced are in "${folder}": delete that folder once you are happy with the new versions.` : ''}${report ? ` For all the notebooks in this folder, see ${report}.` : ''}`,
		counts: c => [
			c.sectionsUpdated ? plural(c.sectionsUpdated, 'section updated', 'sections updated') : '',
			c.sectionsAdded ? plural(c.sectionsAdded, 'new section', 'new sections') : '',
			c.sectionsReconverted ? plural(c.sectionsReconverted, 'section converted again', 'sections converted again') : '',
			c.pagesAdded ? plural(c.pagesAdded, 'page added', 'pages added') : '',
			c.pagesModified ? plural(c.pagesModified, 'page changed', 'pages changed') : '',
			c.pagesRemoved ? `${plural(c.pagesRemoved, 'page', 'pages')} no longer in OneNote (kept in the vault)` : '',
			c.pagesRestored ? `${plural(c.pagesRestored, 'page', 'pages')} brought back` : '',
		].filter(Boolean).join(', ') || 'No page changed',
		stopped: 'The update stopped before every section was done. Check for updates again to finish.',
		resumed: 'This update was cut off and was finished later; what happened to each section is below.',
		attention: 'Needs attention',
		nothingToNote: 'Nothing needs attention.',
		bothEdited: 'These pages were changed on both sides: in OneNote, and by you in Obsidian. They now hold the new version from OneNote. Your version is kept, so you can copy back what you want:',
		bothEditedPage: (page, yours) => `${page} (${yours})`,
		keptEdited: 'These pages were edited in Obsidian and stay as they were: they were not written with the new settings.',
		yourVersion: 'your version',
		rolledBack: (section, reason) => `Section "${section}" could not be finished and was put back as it was: ${reason}`,
		interrupted: 'the update was cut off, and the converted section was gone by the time it could go on',
		notConverted: (section, reason) => `Section "${section}" could not be read this time and was left as it was: ${reason}`,
		notUpdated: (section, reason) => `Section "${section}" was not updated this time and was left as it was: ${reason}`,
		folderTaken: folder => `the folder it needs, "${folder}", already holds something else`,
		keptAside: (files, folder) => `${plural(files, 'file was', 'files were')} not as the update expected (changed while it was cut off, say), and ${files === 1 ? 'was' : 'were'} copied into "${folder}" before being written over. Look at ${files === 1 ? 'it' : 'them'} before you delete the previous versions.`,
		occupiedNotebook: notebook => `The folder of notebook "${notebook}" holds files the plugin did not write, so nothing was written into it.`,
		missingSection: name => `Section "${name}" imported again (it was imported before and is not in the vault any more)`,
		gone: sections => `Not in the new download, left as they were: ${sections.join(', ')}`,
		occupied: sections => `Not written, because their folder holds files the plugin did not write: ${sections.join(', ')}`,
		different: notebook => `"${notebook}" in the vault has no page in common with the notebook of that name in the download. It is another notebook, so it was left as it was.`,
		moved: 'These pages and sections were renamed or moved. Links to them from other notes may need fixing:',
		changes: 'Changes',
		section: (name, was) => `Section "${name}"${was ? ` (was "${was}")` : ''}`,
		newSection: name => `New section "${name}"`,
		reconvertedSection: (name, pages) => `"${name}" converted again with the settings chosen now (${plural(pages, 'page', 'pages')} written anew)`,
		added: page => `Added: ${page}`,
		modified: (page, before, was) => `Changed: ${page} (${before}${was !== undefined ? `; was "${was}"` : ''})`,
		before: 'before',
		removed: page => `No longer in OneNote, kept in the vault: ${page}`,
		restored: page => `Brought back (deleted in Obsidian): ${page}`,
		notRestored: pages => `Pages you deleted in Obsidian were not brought back: ${pages.join(', ')}. To bring them back, tick them when you check for updates.`,
		reordered: pages => `${plural(pages, 'page', 'pages')} only moved or changed level`,
		bothEditedMark: ' (also edited in Obsidian)',
	},
	imageWord: 'image',
	inkWord: 'ink',
};

export const zhHans: Strings = {
	boxMarker: (index, total, left, top) => `<!-- 第${index}块（共${total}块） 页面位置：左 ${left} cm，上 ${top} cm -->`,
	missingAttachment: name => `〔附件缺失：${name}（OneDrive 下载包里没有这个文件的数据）〕`,
	missingImages: (count, names) => count === 1
		? `〔图片缺失${names.length ? `：${names[0]}` : ''}（OneDrive 下载包里没有这张图片的数据）〕`
		: `〔图片缺失 ${count} 张${names.length ? `：${names.join('、')}` : ''}（OneDrive 下载包里没有这些图片的数据）〕`,
	missingPrintoutPages: (document, first, last) => first === last
		? `〔打印页缺失：${document} 第 ${first} 页（OneDrive 下载包里没有这一页的数据）〕`
		: `〔打印页缺失：${document} 第 ${first} 到 ${last} 页（OneDrive 下载包里没有这些页面的数据）〕`,
	printoutNotes: (document, page) => `〔${document} 第 ${page} 页上的手写批注（按它在这一页上的位置画出）〕`,
	unnamedFile: '未命名文件',
	untitledPage: '无标题',
	conflictPageSuffix: '（冲突版本）',
	tocTitle: name => `${name} 目录`,
	noLongerInOneNote: 'OneNote 中已移除的页面',
	sectionOrderNote: '> 分区按名称排序（OneDrive 下载的文件里没有 OneNote 中的分区顺序）。',
	conversionFailedSuffix: '（转换失败）',
	passwordProtectedSuffix: '（有密码保护，未转换）',
	cancelledSuffix: '（未转换：导入已取消）',
	notImportedSuffix: '（未导入）',
	passwordProtected: '这个分区设了密码，无法读取。请在 OneNote 里取消它的密码保护，再重新下载。',
	incompleteSection: '这个分区没有下载完整，请重新下载。',
	altTextTitle: '替换文字',
	conversionFailedNote: error => `这个分区没能转换。解析器报告：${error}`,
	attachmentsFolder: '_附件',
	tocFileName: '_目录',
	oldVersionsFolder: '_旧版本',
	updateLogFolder: '_更新记录',
	notAppliedFolder: '_未完成',
	reportName: '_转换报告',
	report: {
		title: 'OneNote 转换报告',
		intro: logFolder => `这一页是这个文件夹的总览：有哪些笔记本，哪些内容没能转换。每次导入或更新后都会重写。每次更新改了哪些已导入的笔记，记在“${logFolder}”里。`,
		lastImport: '最近一次导入',
		time: time => `时间：${time}`,
		source: names => `来源：${names.join('、')}`,
		totals: (notebooks, sections, pages, attachments) => `${num(notebooks)} 本笔记本，${num(sections)} 个分区，${num(pages)} 页，${num(attachments)} 个附件`,
		notConverted: sections => `${num(sections)} 个分区没有转换（见下）`,
		links: (rewritten, unresolved) => `页面之间的链接：改写 ${num(rewritten)} 个${unresolved ? `，${num(unresolved)} 个保持原样（指向的页面不在这个文件夹里）` : ''}`,
		cancelled: sections => `导入中途停止：${num(sections)} 个分区没有转换。`,
		notebooks: '笔记本',
		columns: ['笔记本', '导入时间', '分区', '页面', '附件', '没有转换'],
		attention: '需要注意',
		nothingToNote: '没有需要注意的地方：导入的分区都已转换，图片和附件齐全。',
		sectionNotConverted: (name, reason) => `分区“${name}”：${reason}`,
		sectionsCancelled: sections => `${num(sections)} 个分区因导入中途停止没有转换。再导入一次，没导入的分区会补进这本笔记本。`,
		notStarted: notebooks => `因中途停止而没有导入的笔记本：${notebooks.join('、')}。再导入一次即可。`,
		unfinished: '这次导入还没有结束，或者中途退出了 Obsidian。再导入一次，没导入的分区会补进来。',
		recordsMissing: '有的分区以前的记录不在了（报告的数据被删掉或改动过），这里的页数和附件数可能不全。',
		missingItems: count => `缺少 ${num(count)} 处图片或附件（下载包里没有数据）`,
		update: record => `这次更新了已导入的笔记，详见${record}。`,
	},
	update: {
		title: time => `更新记录 ${time}`,
		intro: (folder, report) => `本页记录这次更新对已导入的笔记本做了什么，包括补进的分区。${folder ? `更新前的版本在“${folder}”中，确认新版无误后，可以删除这个文件夹。` : ''}${report ? `所有笔记本的总览见${report}。` : ''}`,
		counts: c => [
			c.sectionsUpdated ? `更新 ${num(c.sectionsUpdated)} 个分区` : '',
			c.sectionsAdded ? `新增 ${num(c.sectionsAdded)} 个分区` : '',
			c.sectionsReconverted ? `重新转换 ${num(c.sectionsReconverted)} 个分区` : '',
			c.pagesAdded ? `新增 ${num(c.pagesAdded)} 页` : '',
			c.pagesModified ? `修改 ${num(c.pagesModified)} 页` : '',
			c.pagesRemoved ? `OneNote 中移除 ${num(c.pagesRemoved)} 页（仓库中保留）` : '',
			c.pagesRestored ? `补回 ${num(c.pagesRestored)} 页` : '',
		].filter(Boolean).join('，') || '没有页面变化',
		stopped: '更新中途停止，部分分区未更新，再次检查更新即可。',
		resumed: '这次更新被中断，之后已处理完毕，各分区的结果见下。',
		attention: '需要注意',
		nothingToNote: '没有需要注意的地方。',
		bothEdited: '以下页面在 OneNote 和 Obsidian 中都有修改。现在是 OneNote 的新版，你的版本已另存，可以对照后把需要的内容移回：',
		bothEditedPage: (page, yours) => `${page}（${yours}）`,
		keptEdited: '以下页面在 Obsidian 中改过，保持原样，没有按新设置重写：',
		yourVersion: '你的版本',
		rolledBack: (section, reason) => `分区“${section}”未能更新，已恢复原状：${reason}`,
		interrupted: '更新中断后，转换好的新版已不存在',
		notConverted: (section, reason) => `分区“${section}”无法读取，保持原样：${reason}`,
		notUpdated: (section, reason) => `分区“${section}”未更新，保持原样：${reason}`,
		folderTaken: folder => `所需的文件夹“${folder}”已被占用`,
		keptAside: (files, folder) => `${num(files)} 个文件与预期不同（可能在更新中断后被修改过），覆盖前已另存到“${folder}”。删除旧版本前请先查看。`,
		occupiedNotebook: notebook => `笔记本“${notebook}”的文件夹中有不是插件写入的文件，保持原样。`,
		missingSection: name => `重新导入分区“${name}”（以前导入过，已不在仓库中）`,
		gone: sections => `下载中没有这些分区，仓库中的保持原样：${sections.join('、')}`,
		occupied: sections => `这些分区的文件夹中有不是插件写入的文件，保持原样：${sections.join('、')}`,
		different: notebook => `仓库中的“${notebook}”与下载中的同名笔记本没有相同页面，是另一本笔记本，保持原样。`,
		moved: '以下页面和分区已重命名或移动，其他笔记中指向它们的链接可能需要修改：',
		changes: '变化',
		section: (name, was) => `分区“${name}”${was ? `（原为“${was}”）` : ''}`,
		newSection: name => `新分区“${name}”`,
		reconvertedSection: (name, pages) => `按现在的设置重新转换“${name}”（重写 ${num(pages)} 页）`,
		added: page => `新增：${page}`,
		modified: (page, before, was) => `修改：${page}（${before}${was !== undefined ? `，原标题“${was}”` : ''}）`,
		before: '更新前',
		removed: page => `OneNote 中已移除，保留在原处：${page}`,
		restored: page => `补回在 Obsidian 中删除的页面：${page}`,
		notRestored: pages => `在 Obsidian 中删除的页面未补回：${pages.join('、')}。如需补回，检查更新时勾选这些页面。`,
		reordered: pages => `${num(pages)} 页仅调整了顺序或层级`,
		bothEditedMark: '（Obsidian 中也已修改）',
	},
	imageWord: '图',
	inkWord: '手写',
};

export const zhHant: Strings = {
	boxMarker: (index, total, left, top) => `<!-- 第${index}塊（共${total}塊） 頁面位置：左 ${left} cm，上 ${top} cm -->`,
	missingAttachment: name => `〔附件缺失：${name}（OneDrive 下載包裡沒有這個檔案的資料）〕`,
	missingImages: (count, names) => count === 1
		? `〔圖片缺失${names.length ? `：${names[0]}` : ''}（OneDrive 下載包裡沒有這張圖片的資料）〕`
		: `〔圖片缺失 ${count} 張${names.length ? `：${names.join('、')}` : ''}（OneDrive 下載包裡沒有這些圖片的資料）〕`,
	missingPrintoutPages: (document, first, last) => first === last
		? `〔列印頁缺失：${document} 第 ${first} 頁（OneDrive 下載包裡沒有這一頁的資料）〕`
		: `〔列印頁缺失：${document} 第 ${first} 到 ${last} 頁（OneDrive 下載包裡沒有這些頁面的資料）〕`,
	printoutNotes: (document, page) => `〔${document} 第 ${page} 頁上的手寫批註（按它在這一頁上的位置畫出）〕`,
	unnamedFile: '未命名檔案',
	untitledPage: '無標題',
	conflictPageSuffix: '（衝突版本）',
	tocTitle: name => `${name} 目錄`,
	noLongerInOneNote: 'OneNote 中已移除的頁面',
	sectionOrderNote: '> 節按名稱排序（OneDrive 下載的檔案裡沒有 OneNote 中的節順序）。',
	conversionFailedSuffix: '（轉換失敗）',
	passwordProtectedSuffix: '（有密碼保護，未轉換）',
	cancelledSuffix: '（未轉換：匯入已取消）',
	notImportedSuffix: '（未匯入）',
	passwordProtected: '這個節設了密碼，無法讀取。請在 OneNote 裡取消它的密碼保護，再重新下載。',
	incompleteSection: '這個節沒有下載完整，請重新下載。',
	altTextTitle: '替代文字',
	conversionFailedNote: error => `這個節沒能轉換。解析器報告：${error}`,
	attachmentsFolder: '_附件',
	tocFileName: '_目錄',
	oldVersionsFolder: '_舊版本',
	updateLogFolder: '_更新記錄',
	notAppliedFolder: '_未完成',
	reportName: '_轉換報告',
	report: {
		title: 'OneNote 轉換報告',
		intro: logFolder => `這一頁是這個資料夾的總覽：有哪些筆記本，哪些內容沒能轉換。每次匯入或更新後都會重寫。每次更新改了哪些已匯入的筆記，記在「${logFolder}」裡。`,
		lastImport: '最近一次匯入',
		time: time => `時間：${time}`,
		source: names => `來源：${names.join('、')}`,
		totals: (notebooks, sections, pages, attachments) => `${num(notebooks)} 本筆記本，${num(sections)} 個節，${num(pages)} 頁，${num(attachments)} 個附件`,
		notConverted: sections => `${num(sections)} 個節沒有轉換（見下）`,
		links: (rewritten, unresolved) => `頁面之間的連結：改寫 ${num(rewritten)} 個${unresolved ? `，${num(unresolved)} 個保持原樣（指向的頁面不在這個資料夾裡）` : ''}`,
		cancelled: sections => `匯入中途停止：${num(sections)} 個節沒有轉換。`,
		notebooks: '筆記本',
		columns: ['筆記本', '匯入時間', '節', '頁面', '附件', '沒有轉換'],
		attention: '需要注意',
		nothingToNote: '沒有需要注意的地方：匯入的節都已轉換，圖片和附件齊全。',
		sectionNotConverted: (name, reason) => `節「${name}」：${reason}`,
		sectionsCancelled: sections => `${num(sections)} 個節因匯入中途停止沒有轉換。再匯入一次，沒匯入的節會補進這本筆記本。`,
		notStarted: notebooks => `因中途停止而沒有匯入的筆記本：${notebooks.join('、')}。再匯入一次即可。`,
		unfinished: '這次匯入還沒有結束，或者中途退出了 Obsidian。再匯入一次，沒匯入的節會補進來。',
		recordsMissing: '有的節以前的紀錄不在了（報告的資料被刪除或改動過），這裡的頁數和附件數可能不全。',
		missingItems: count => `缺少 ${num(count)} 處圖片或附件（下載包裡沒有資料）`,
		update: record => `這次更新了已匯入的筆記，詳見${record}。`,
	},
	update: {
		title: time => `更新記錄 ${time}`,
		intro: (folder, report) => `本頁記錄這次更新對已匯入的筆記本做了什麼，包括補進的節。${folder ? `更新前的版本在「${folder}」中，確認新版無誤後，可以刪除這個資料夾。` : ''}${report ? `所有筆記本的總覽見${report}。` : ''}`,
		counts: c => [
			c.sectionsUpdated ? `更新 ${num(c.sectionsUpdated)} 個節` : '',
			c.sectionsAdded ? `新增 ${num(c.sectionsAdded)} 個節` : '',
			c.sectionsReconverted ? `重新轉換 ${num(c.sectionsReconverted)} 個節` : '',
			c.pagesAdded ? `新增 ${num(c.pagesAdded)} 頁` : '',
			c.pagesModified ? `修改 ${num(c.pagesModified)} 頁` : '',
			c.pagesRemoved ? `OneNote 中移除 ${num(c.pagesRemoved)} 頁（儲存庫中保留）` : '',
			c.pagesRestored ? `補回 ${num(c.pagesRestored)} 頁` : '',
		].filter(Boolean).join('，') || '沒有頁面變化',
		stopped: '更新中途停止，部分節未更新，再次檢查更新即可。',
		resumed: '這次更新被中斷，之後已處理完畢，各節的結果見下。',
		attention: '需要注意',
		nothingToNote: '沒有需要注意的地方。',
		bothEdited: '以下頁面在 OneNote 和 Obsidian 中都有修改。現在是 OneNote 的新版，你的版本已另存，可以對照後把需要的內容移回：',
		bothEditedPage: (page, yours) => `${page}（${yours}）`,
		keptEdited: '以下頁面在 Obsidian 中改過，保持原樣，沒有按新設定重寫：',
		yourVersion: '你的版本',
		rolledBack: (section, reason) => `節「${section}」未能更新，已恢復原狀：${reason}`,
		interrupted: '更新中斷後，轉換好的新版已不存在',
		notConverted: (section, reason) => `節「${section}」無法讀取，保持原樣：${reason}`,
		notUpdated: (section, reason) => `節「${section}」未更新，保持原樣：${reason}`,
		folderTaken: folder => `所需的資料夾「${folder}」已被佔用`,
		keptAside: (files, folder) => `${num(files)} 個檔案與預期不同（可能在更新中斷後被修改過），覆蓋前已另存到「${folder}」。刪除舊版本前請先查看。`,
		occupiedNotebook: notebook => `筆記本「${notebook}」的資料夾中有不是外掛寫入的檔案，保持原樣。`,
		missingSection: name => `重新匯入節「${name}」（以前匯入過，已不在儲存庫中）`,
		gone: sections => `下載中沒有這些節，儲存庫中的保持原樣：${sections.join('、')}`,
		occupied: sections => `這些節的資料夾中有不是外掛寫入的檔案，保持原樣：${sections.join('、')}`,
		different: notebook => `儲存庫中的「${notebook}」與下載中的同名筆記本沒有相同頁面，是另一本筆記本，保持原樣。`,
		moved: '以下頁面和節已重新命名或移動，其他筆記中指向它們的連結可能需要修改：',
		changes: '變化',
		section: (name, was) => `節「${name}」${was ? `（原為「${was}」）` : ''}`,
		newSection: name => `新的節「${name}」`,
		reconvertedSection: (name, pages) => `按現在的設定重新轉換「${name}」（重寫 ${num(pages)} 頁）`,
		added: page => `新增：${page}`,
		modified: (page, before, was) => `修改：${page}（${before}${was !== undefined ? `，原標題「${was}」` : ''}）`,
		before: '更新前',
		removed: page => `OneNote 中已移除，保留在原處：${page}`,
		restored: page => `補回在 Obsidian 中刪除的頁面：${page}`,
		notRestored: pages => `在 Obsidian 中刪除的頁面未補回：${pages.join('、')}。如需補回，檢查更新時勾選這些頁面。`,
		reordered: pages => `${num(pages)} 頁僅調整了順序或層級`,
		bothEditedMark: '（Obsidian 中也已修改）',
	},
	imageWord: '圖',
	inkWord: '手寫',
};

export const ja: Strings = {
	boxMarker: (index, total, left, top) => `<!-- 第${index}ブロック（全${total}ブロック） ページ上の位置：左 ${left} cm、上 ${top} cm -->`,
	missingAttachment: name => `〔添付ファイルなし：${name}（OneDrive のダウンロードにこのファイルのデータがありません）〕`,
	missingImages: (count, names) => count === 1
		? `〔画像なし${names.length ? `：${names[0]}` : ''}（OneDrive のダウンロードにこの画像のデータがありません）〕`
		: `〔画像なし ${count} 枚${names.length ? `：${names.join('、')}` : ''}（OneDrive のダウンロードにこれらの画像のデータがありません）〕`,
	missingPrintoutPages: (document, first, last) => first === last
		? `〔印刷イメージなし：${document} ${first} ページ目（OneDrive のダウンロードにこのページのデータがありません）〕`
		: `〔印刷イメージなし：${document} ${first} ページ目から ${last} ページ目（OneDrive のダウンロードにこれらのページのデータがありません）〕`,
	printoutNotes: (document, page) => `〔${document} の ${page} ページへの手書きメモ（そのページ上の位置どおりに描画）〕`,
	unnamedFile: '名前のないファイル',
	untitledPage: '無題',
	conflictPageSuffix: '（競合）',
	tocTitle: name => `${name} 目次`,
	noLongerInOneNote: 'OneNote にはもうないページ',
	sectionOrderNote: '> セクションは名前順です（OneDrive からダウンロードしたファイルには、OneNote でのセクションの並び順が含まれていません）。',
	conversionFailedSuffix: '（変換失敗）',
	passwordProtectedSuffix: '（パスワード保護のため未変換）',
	cancelledSuffix: '（未変換：インポートを中止しました）',
	notImportedSuffix: '（未インポート）',
	passwordProtected: 'このセクションはパスワードで保護されているため読み取れません。OneNote でパスワード保護を解除してから、もう一度ダウンロードしてください。',
	incompleteSection: 'このセクションは最後までダウンロードされていません。もう一度ダウンロードしてください。',
	altTextTitle: '代替テキスト',
	conversionFailedNote: error => `このセクションは変換できませんでした。解析器のメッセージ：${error}`,
	attachmentsFolder: '_添付ファイル',
	tocFileName: '_目次',
	oldVersionsFolder: '_旧バージョン',
	updateLogFolder: '_更新記録',
	notAppliedFolder: '_未完了',
	reportName: '_変換レポート',
	report: {
		title: 'OneNote 変換レポート',
		intro: logFolder => `このフォルダーの概要です。含まれるノートブックと、変換できなかった内容を示します。インポートや更新のたびに書き直されます。各更新でインポート済みのノートがどう変わったかは「${logFolder}」にあります。`,
		lastImport: '最新のインポート',
		time: time => `日時：${time}`,
		source: names => `読み込み元：${names.join('、')}`,
		totals: (notebooks, sections, pages, attachments) => `ノートブック ${num(notebooks)} 冊、セクション ${num(sections)} 個、${num(pages)} ページ、添付ファイル ${num(attachments)} 個`,
		notConverted: sections => `変換されなかったセクション ${num(sections)} 個（下記参照）`,
		links: (rewritten, unresolved) => `ページ間のリンク：${num(rewritten)} 件を書き換え${unresolved ? `、${num(unresolved)} 件はそのまま（リンク先のページがこのフォルダーにありません）` : ''}`,
		cancelled: sections => `インポートは途中で停止しました。${num(sections)} 個のセクションは変換されていません。`,
		notebooks: 'ノートブック',
		columns: ['ノートブック', 'インポート日時', 'セクション', 'ページ', '添付ファイル', '未変換'],
		attention: '確認が必要な項目',
		nothingToNote: '確認が必要な項目はありません。インポートしたセクションは、画像と添付ファイルも含めてすべて変換しました。',
		sectionNotConverted: (name, reason) => `セクション「${name}」：${reason}`,
		sectionsCancelled: sections => `${num(sections)} 個のセクションは、インポートが途中で停止したため変換されていません。もう一度インポートすると、残りのセクションがこのノートブックに追加されます。`,
		notStarted: notebooks => `途中で停止したためインポートされなかったノートブック：${notebooks.join('、')}。もう一度インポートすると追加されます。`,
		unfinished: 'このインポートはまだ終わっていないか、途中で Obsidian が終了しました。もう一度インポートすると、残りのセクションが追加されます。',
		recordsMissing: '以前の記録が残っていないセクションがあります（このレポートのデータが削除または変更されました）。ここのページ数と添付ファイル数は不完全な場合があります。',
		missingItems: count => `画像または添付ファイル ${num(count)} 個が欠けています（ダウンロードにデータがありません）`,
		update: record => `今回はインポート済みのノートを更新しました。変更点は${record}を参照してください。`,
	},
	update: {
		title: time => `更新記録 ${time}`,
		intro: (folder, report) => `今回の更新でインポート済みのノートブックがどう変わったかの記録です（追加したセクションを含む）。${folder ? `置き換えた以前の版は「${folder}」にあります。新しい版に問題がなければ、このフォルダーは削除してかまいません。` : ''}${report ? `すべてのノートブックの概要は${report}にあります。` : ''}`,
		counts: c => [
			c.sectionsUpdated ? `セクション ${num(c.sectionsUpdated)} 個を更新` : '',
			c.sectionsAdded ? `セクション ${num(c.sectionsAdded)} 個を追加` : '',
			c.sectionsReconverted ? `セクション ${num(c.sectionsReconverted)} 個を変換し直し` : '',
			c.pagesAdded ? `${num(c.pagesAdded)} ページを追加` : '',
			c.pagesModified ? `${num(c.pagesModified)} ページを変更` : '',
			c.pagesRemoved ? `OneNote にはもうない ${num(c.pagesRemoved)} ページ（保管庫には残しています）` : '',
			c.pagesRestored ? `${num(c.pagesRestored)} ページを戻しました` : '',
		].filter(Boolean).join('、') || 'ページの変更はありません',
		stopped: '更新は途中で停止しました。まだ更新していないセクションがあります。もう一度更新を確認すると続きを行います。',
		resumed: 'この更新は途中で中断され、その後に処理を終えました。各セクションの結果は以下のとおりです。',
		attention: '確認が必要な項目',
		nothingToNote: '確認が必要な項目はありません。',
		bothEdited: '次のページは両方で変更されています（OneNote で変更され、Obsidian でもあなたが変更しました）。現在は OneNote の新しい版です。あなたが変更した版は残してあるので、残したい内容を見比べて戻せます：',
		bothEditedPage: (page, yours) => `${page}（${yours}）`,
		keptEdited: '次のページは Obsidian で編集されていたため、そのまま残し、新しい設定では書き直していません：',
		yourVersion: 'あなたが変更した版',
		rolledBack: (section, reason) => `セクション「${section}」は更新を完了できなかったため、更新前の状態に戻しました：${reason}`,
		interrupted: '更新が途中で中断され、続きを行うときには変換済みの新しい版が残っていませんでした',
		notConverted: (section, reason) => `セクション「${section}」は今回読み込めなかったため、保管庫の内容はそのままです：${reason}`,
		notUpdated: (section, reason) => `セクション「${section}」は今回更新できなかったため、保管庫の内容はそのままです：${reason}`,
		folderTaken: folder => `必要なフォルダー「${folder}」にすでに別のものがあります`,
		keptAside: (files, folder) => `${num(files)} 個のファイルが更新の想定と違っていたため（更新の中断中に変更した場合など）、上書きする前に「${folder}」にコピーしました。以前のバージョンを削除する前に、これらのファイルを確認してください。`,
		occupiedNotebook: notebook => `ノートブック「${notebook}」のフォルダーにプラグインが書いていないファイルがあるため、書き込みませんでした。`,
		missingSection: name => `セクション「${name}」をもう一度インポートしました（以前インポートしたもので、保管庫に見つからなくなっていました）`,
		gone: sections => `新しいダウンロードにないセクション（保管庫の内容はそのままです）：${sections.join('、')}`,
		occupied: sections => `フォルダーにプラグインが書いていないファイルがあるため、書き込まなかったセクション：${sections.join('、')}`,
		different: notebook => `保管庫の「${notebook}」は、ダウンロードの同じ名前のノートブックと共通するページがありません。別のノートブックなので、そのままにしました。`,
		moved: '次のページとセクションは、名前や場所が変わりました。ほかのノートからのリンクは直す必要があるかもしれません：',
		changes: '変更点',
		section: (name, was) => `セクション「${name}」${was ? `（以前は「${was}」）` : ''}`,
		newSection: name => `新しいセクション「${name}」`,
		reconvertedSection: (name, pages) => `「${name}」を現在の設定で変換し直しました（${num(pages)} ページを書き直し）`,
		added: page => `追加：${page}`,
		modified: (page, before, was) => `変更：${page}（${before}${was !== undefined ? `、以前のタイトル「${was}」` : ''}）`,
		before: '更新前',
		removed: page => `OneNote にはもうないため、そのまま残しています：${page}`,
		restored: page => `Obsidian で削除したページを戻しました：${page}`,
		notRestored: pages => `Obsidian で削除したページは戻していません：${pages.join('、')}。戻したい場合は、更新を確認するときにチェックしてください。`,
		reordered: pages => `${num(pages)} ページは順序または階層だけが変わりました`,
		bothEditedMark: '（Obsidian でも編集済み）',
	},
	imageWord: '図',
	inkWord: '手書き',
};

export const ko: Strings = {
	boxMarker: (index, total, left, top) => `<!-- ${total}개 중 ${index}번째 블록, 페이지 위치: 왼쪽 ${left} cm, 위 ${top} cm -->`,
	missingAttachment: name => `〔첨부 파일 없음: ${name} (OneDrive 다운로드에 이 파일의 데이터가 없습니다)〕`,
	missingImages: (count, names) => count === 1
		? `〔그림 없음${names.length ? `: ${names[0]}` : ''} (OneDrive 다운로드에 이 그림의 데이터가 없습니다)〕`
		: `〔그림 ${count}개 없음${names.length ? `: ${names.join(', ')}` : ''} (OneDrive 다운로드에 이 그림들의 데이터가 없습니다)〕`,
	missingPrintoutPages: (document, first, last) => first === last
		? `〔인쇄물 페이지 없음: ${document} ${first}페이지 (OneDrive 다운로드에 이 페이지의 데이터가 없습니다)〕`
		: `〔인쇄물 페이지 없음: ${document} ${first}페이지부터 ${last}페이지까지 (OneDrive 다운로드에 이 페이지들의 데이터가 없습니다)〕`,
	printoutNotes: (document, page) => `〔${document} ${page}쪽에 쓴 손글씨 메모(그 쪽에서의 위치대로 그림)〕`,
	unnamedFile: '이름 없는 파일',
	untitledPage: '제목 없음',
	conflictPageSuffix: ' (충돌 버전)',
	tocTitle: name => `${name} 목차`,
	noLongerInOneNote: 'OneNote에 더 이상 없는 페이지',
	sectionOrderNote: '> 섹션은 이름순으로 정렬됩니다 (OneDrive에서 다운로드한 파일에는 OneNote의 섹션 순서가 들어 있지 않습니다).',
	conversionFailedSuffix: ' (변환 실패)',
	passwordProtectedSuffix: ' (암호로 보호되어 변환하지 않음)',
	cancelledSuffix: ' (가져오기를 취소하여 변환하지 않음)',
	notImportedSuffix: ' (가져오지 않음)',
	passwordProtected: '이 섹션은 암호로 보호되어 있어 읽을 수 없습니다. OneNote에서 암호 보호를 해제한 뒤 다시 다운로드하세요.',
	incompleteSection: '이 섹션은 끝까지 다운로드되지 않았습니다. 다시 다운로드하세요.',
	altTextTitle: '대체 텍스트',
	conversionFailedNote: error => `이 섹션은 변환하지 못했습니다. 파서 메시지: ${error}`,
	attachmentsFolder: '_첨부 파일',
	tocFileName: '_목차',
	oldVersionsFolder: '_이전 버전',
	updateLogFolder: '_업데이트 기록',
	notAppliedFolder: '_적용 안 됨',
	reportName: '_변환 보고서',
	report: {
		title: 'OneNote 변환 보고서',
		intro: logFolder => `이 폴더의 개요입니다. 들어 있는 전자 필기장과 변환하지 못한 내용을 보여 줍니다. 가져오거나 업데이트할 때마다 다시 씁니다. 업데이트마다 이전에 가져온 노트가 어떻게 바뀌었는지는 "${logFolder}"에 있습니다.`,
		lastImport: '최근 가져오기',
		time: time => `시간: ${time}`,
		source: names => `원본: ${names.join(', ')}`,
		totals: (notebooks, sections, pages, attachments) => `전자 필기장 ${num(notebooks)}개, 섹션 ${num(sections)}개, 페이지 ${num(pages)}개, 첨부 파일 ${num(attachments)}개`,
		notConverted: sections => `변환되지 않은 섹션 ${num(sections)}개 (아래 참조)`,
		links: (rewritten, unresolved) => `페이지 간 링크: ${num(rewritten)}개 변경${unresolved ? `, ${num(unresolved)}개는 그대로 둠 (연결된 페이지가 이 폴더에 없음)` : ''}`,
		cancelled: sections => `가져오기가 중간에 중지되었습니다. 섹션 ${num(sections)}개가 변환되지 않았습니다.`,
		notebooks: '전자 필기장',
		columns: ['전자 필기장', '가져온 시간', '섹션', '페이지', '첨부 파일', '변환 안 됨'],
		attention: '확인이 필요한 항목',
		nothingToNote: '확인이 필요한 항목이 없습니다. 가져온 섹션을 그림과 첨부 파일까지 모두 변환했습니다.',
		sectionNotConverted: (name, reason) => `섹션 "${name}": ${reason}`,
		sectionsCancelled: sections => `섹션 ${num(sections)}개는 가져오기가 중간에 중지되어 변환되지 않았습니다. 다시 가져오면 나머지 섹션이 이 전자 필기장에 추가됩니다.`,
		notStarted: notebooks => `가져오기가 중지되어 가져오지 않은 전자 필기장: ${notebooks.join(', ')}. 다시 가져오면 추가됩니다.`,
		unfinished: '이 가져오기가 아직 끝나지 않았거나 도중에 Obsidian이 종료되었습니다. 다시 가져오면 나머지 섹션이 추가됩니다.',
		recordsMissing: '이전 기록이 없는 섹션이 있습니다(이 보고서의 데이터가 삭제되었거나 바뀌었습니다). 여기의 페이지 수와 첨부 파일 수는 정확하지 않을 수 있습니다.',
		missingItems: count => `그림 또는 첨부 파일 ${num(count)}개 없음 (다운로드에 데이터가 없음)`,
		update: record => `이번에는 이전에 가져온 노트를 업데이트했습니다. 바뀐 내용은 ${record}에 있습니다.`,
	},
	update: {
		title: time => `업데이트 기록 ${time}`,
		intro: (folder, report) => `이번 업데이트로 이전에 가져온 전자 필기장에서 바뀐 내용입니다(추가한 섹션 포함).${folder ? ` 바꾼 이전 버전은 "${folder}"에 있습니다. 새 버전에 문제가 없으면 이 폴더를 삭제해도 됩니다.` : ''}${report ? ` 모든 전자 필기장의 개요는 ${report}에 있습니다.` : ''}`,
		counts: c => [
			c.sectionsUpdated ? `섹션 ${num(c.sectionsUpdated)}개 업데이트` : '',
			c.sectionsAdded ? `섹션 ${num(c.sectionsAdded)}개 추가` : '',
			c.sectionsReconverted ? `섹션 ${num(c.sectionsReconverted)}개 다시 변환` : '',
			c.pagesAdded ? `페이지 ${num(c.pagesAdded)}개 추가` : '',
			c.pagesModified ? `페이지 ${num(c.pagesModified)}개 변경` : '',
			c.pagesRemoved ? `OneNote에 더 이상 없는 페이지 ${num(c.pagesRemoved)}개 (보관함에는 남겨 둠)` : '',
			c.pagesRestored ? `페이지 ${num(c.pagesRestored)}개 복원` : '',
		].filter(Boolean).join(', ') || '바뀐 페이지 없음',
		stopped: '업데이트가 중간에 중지되어 아직 업데이트하지 않은 섹션이 있습니다. 업데이트를 다시 확인하면 마저 합니다.',
		resumed: '이 업데이트는 중간에 끊겼고, 그 뒤에 마무리했습니다. 섹션별 결과는 아래와 같습니다.',
		attention: '확인이 필요한 항목',
		nothingToNote: '확인이 필요한 항목이 없습니다.',
		bothEdited: '다음 페이지는 양쪽에서 바뀌었습니다. OneNote에서 바뀌었고, Obsidian에서도 직접 고쳤습니다. 지금은 OneNote의 새 버전이며, 사용자의 버전은 남겨 두었으니 필요한 내용을 비교해서 옮기면 됩니다:',
		bothEditedPage: (page, yours) => `${page} (${yours})`,
		keptEdited: '다음 페이지는 Obsidian에서 수정되어 그대로 두었으며, 새 설정으로 다시 쓰지 않았습니다:',
		yourVersion: '사용자의 버전',
		rolledBack: (section, reason) => `섹션 "${section}"은(는) 업데이트를 끝내지 못해 업데이트 전 상태로 되돌렸습니다: ${reason}`,
		interrupted: '업데이트가 중간에 끊겼고, 이어서 하려고 할 때 변환해 둔 새 버전이 없었습니다',
		notConverted: (section, reason) => `섹션 "${section}"은(는) 이번에 읽을 수 없어 보관함의 내용을 그대로 두었습니다: ${reason}`,
		notUpdated: (section, reason) => `섹션 "${section}"은(는) 이번에 업데이트하지 못해 보관함의 내용을 그대로 두었습니다: ${reason}`,
		folderTaken: folder => `필요한 폴더 "${folder}"에 이미 다른 것이 있습니다`,
		keptAside: (files, folder) => `파일 ${num(files)}개가 업데이트가 예상한 상태와 달라(업데이트가 끊긴 동안 고친 경우 등) 덮어쓰기 전에 "${folder}"에 복사했습니다. 이전 버전을 삭제하기 전에 이 파일들을 먼저 확인하세요.`,
		occupiedNotebook: notebook => `전자 필기장 "${notebook}"의 폴더에 플러그인이 쓰지 않은 파일이 있어 쓰지 않았습니다.`,
		missingSection: name => `섹션 "${name}"을(를) 다시 가져옴 (이전에 가져왔지만 보관함에서 찾을 수 없었음)`,
		gone: sections => `새 다운로드에 없는 섹션 (보관함의 내용은 그대로 둠): ${sections.join(', ')}`,
		occupied: sections => `폴더에 플러그인이 쓰지 않은 파일이 있어 쓰지 않은 섹션: ${sections.join(', ')}`,
		different: notebook => `보관함의 "${notebook}"은(는) 다운로드에 있는 같은 이름의 전자 필기장과 같은 페이지가 하나도 없습니다. 다른 전자 필기장이므로 그대로 두었습니다.`,
		moved: '다음 페이지와 섹션은 이름이나 위치가 바뀌었습니다. 다른 노트에서 연결한 링크는 고쳐야 할 수 있습니다:',
		changes: '바뀐 내용',
		section: (name, was) => `섹션 "${name}"${was ? ` (이전 이름 "${was}")` : ''}`,
		newSection: name => `새 섹션 "${name}"`,
		reconvertedSection: (name, pages) => `"${name}"을(를) 현재 설정으로 다시 변환했습니다(${num(pages)}페이지 다시 씀)`,
		added: page => `추가: ${page}`,
		modified: (page, before, was) => `변경: ${page} (${before}${was !== undefined ? `, 이전 제목 "${was}"` : ''})`,
		before: '업데이트 전',
		removed: page => `OneNote에 더 이상 없어 그대로 남겨 둠: ${page}`,
		restored: page => `Obsidian에서 삭제한 페이지를 복원함: ${page}`,
		notRestored: pages => `Obsidian에서 삭제한 페이지는 복원하지 않았습니다: ${pages.join(', ')}. 복원하려면 업데이트를 확인할 때 선택하세요.`,
		reordered: pages => `페이지 ${num(pages)}개는 순서나 수준만 바뀜`,
		bothEditedMark: ' (Obsidian에서도 수정됨)',
	},
	imageWord: '그림',
	inkWord: '손글씨',
};

export const STRINGS: Record<Language, Strings> = { 'en': en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, 'ja': ja, 'ko': ko };

export function isLanguage(value: string): value is Language {
	return (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The marks for a reader whose interface is in `locale` (Obsidian's language setting, such as
 * `zh` or `zh-TW`, or a system locale such as `ja_JP.UTF-8`): the reader's language, English
 * when it has no marks of its own. Marks follow the reader, not each notebook's content (see the
 * project notes, decision 37).
 */
export function markerLanguageFor(locale: string | undefined): Language {
	const parts = (locale ?? '').toLowerCase().replace(/_/g, '-').replace(/[.@].*$/, '').split('-');
	const [language, ...rest] = parts;
	if (language === 'ja') return 'ja';
	if (language === 'ko') return 'ko';
	// Chinese, and the Chinese languages whose locales say so (Cantonese, Min Nan, Hakka, Classical...).
	if (['zh', 'cmn', 'yue', 'nan', 'hak', 'lzh', 'wuu', 'gan', 'hsn'].includes(language)) {
		if (rest.includes('hant') || rest.some(part => ['tw', 'hk', 'mo'].includes(part))) return 'zh-Hant';
		if (rest.includes('hans') || rest.some(part => ['cn', 'sg', 'my'].includes(part))) return 'zh-Hans';
		// Cantonese and Classical Chinese are mostly written in traditional characters.
		return ['yue', 'lzh'].includes(language) ? 'zh-Hant' : 'zh-Hans';
	}
	return 'en';
}
