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
	/** The import report's file name without its extension: `.md` to read, `.json` for programs (later syncs). */
	reportName: string;
	report: ReportStrings;
	/** `<page> - <image><nnn>`: the word for a picture in attachment names. */
	imageWord: string;
	/** `<page> - <ink><nn>`: the word for handwriting in attachment names. */
	inkWord: string;
}

/** The import report (written in the reader's language, not each notebook's). */
export interface ReportStrings {
	title: string;
	intro: string;
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
	reportName: '_conversion report',
	report: {
		title: 'OneNote conversion report',
		intro: 'OneNote Ferry updates this page after each import. It covers every notebook imported into this folder.',
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
	reportName: '_转换报告',
	report: {
		title: 'OneNote 转换报告',
		intro: '每次导入后，OneNote Ferry 会更新这一页，列出导入到这个文件夹的所有笔记本。',
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
	reportName: '_轉換報告',
	report: {
		title: 'OneNote 轉換報告',
		intro: '每次匯入後，OneNote Ferry 會更新這一頁，列出匯入到這個資料夾的所有筆記本。',
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
	reportName: '_変換レポート',
	report: {
		title: 'OneNote 変換レポート',
		intro: 'OneNote Ferry はインポートのたびにこのページを更新します。このフォルダーにインポートしたすべてのノートブックの一覧です。',
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
	reportName: '_변환 보고서',
	report: {
		title: 'OneNote 변환 보고서',
		intro: 'OneNote Ferry는 가져올 때마다 이 페이지를 업데이트합니다. 이 폴더로 가져온 모든 전자 필기장을 보여 줍니다.',
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
