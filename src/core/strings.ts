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
	/** Why a password-protected section was not converted (report and command line). */
	passwordProtected: string;
	/** Title of the collapsed callout holding an image's alternative text. */
	altTextTitle: string;
	/** The note in a section that could not be converted, with the parser's message. */
	conversionFailedNote(error: string): string;
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
	passwordProtected: 'This section is password protected and cannot be read. Remove its password protection in OneNote, then download it again.',
	altTextTitle: 'Alt text',
	conversionFailedNote: error => `This section could not be converted. The parser reported: ${error}`,
	attachmentsFolder: '_attachments',
	tocFileName: '_contents',
	oldVersionsFolder: '_previous versions',
	updateLogFolder: '_sync log',
	reportFileName: '_conversion report.json',
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
	passwordProtected: '这个分区设了密码，无法读取。请在 OneNote 里取消它的密码保护，再重新下载。',
	altTextTitle: '替换文字',
	conversionFailedNote: error => `这个分区没能转换。解析器报告：${error}`,
	attachmentsFolder: '_附件',
	tocFileName: '_目录',
	oldVersionsFolder: '_旧版本',
	updateLogFolder: '_更新记录',
	reportFileName: '_转换报告.json',
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
	sectionOrderNote: '> 分區按名稱排序（OneDrive 下載的檔案裡沒有 OneNote 中的分區順序）。',
	conversionFailedSuffix: '（轉換失敗）',
	passwordProtectedSuffix: '（有密碼保護，未轉換）',
	passwordProtected: '這個分區設了密碼，無法讀取。請在 OneNote 裡取消它的密碼保護，再重新下載。',
	altTextTitle: '替代文字',
	conversionFailedNote: error => `這個分區沒能轉換。解析器報告：${error}`,
	attachmentsFolder: '_附件',
	tocFileName: '_目錄',
	oldVersionsFolder: '_舊版本',
	updateLogFolder: '_更新記錄',
	reportFileName: '_轉換報告.json',
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
	passwordProtected: 'このセクションはパスワードで保護されているため読み取れません。OneNote でパスワード保護を解除してから、もう一度ダウンロードしてください。',
	altTextTitle: '代替テキスト',
	conversionFailedNote: error => `このセクションは変換できませんでした。解析器のメッセージ：${error}`,
	attachmentsFolder: '_添付ファイル',
	tocFileName: '_目次',
	oldVersionsFolder: '_旧バージョン',
	updateLogFolder: '_更新記録',
	reportFileName: '_変換レポート.json',
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
	sectionOrderNote: '> 섹션은 이름순으로 정렬됩니다 (OneDrive에서 내려받은 파일에는 OneNote의 섹션 순서가 들어 있지 않습니다).',
	conversionFailedSuffix: ' (변환 실패)',
	passwordProtectedSuffix: ' (암호로 보호되어 변환하지 않음)',
	passwordProtected: '이 섹션은 암호로 보호되어 있어 읽을 수 없습니다. OneNote에서 암호 보호를 해제한 뒤 다시 내려받으세요.',
	altTextTitle: '대체 텍스트',
	conversionFailedNote: error => `이 섹션은 변환하지 못했습니다. 파서 메시지: ${error}`,
	attachmentsFolder: '_첨부 파일',
	tocFileName: '_목차',
	oldVersionsFolder: '_이전 버전',
	updateLogFolder: '_업데이트 기록',
	reportFileName: '_변환 보고서.json',
	imageWord: '그림',
	inkWord: '손글씨',
};

export const STRINGS: Record<Language, Strings> = { 'en': en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, 'ja': ja, 'ko': ko };

export function isLanguage(value: string): value is Language {
	return (LANGUAGES as readonly string[]).includes(value);
}
