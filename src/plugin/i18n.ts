// The plugin's own interface text, in its four interface languages (English, Chinese, Japanese,
// Korean), following Obsidian's language. Not the marks written into notes: those are in
// src/core/strings.ts (and follow the reader too, but in five languages). Simplified Chinese
// quotes with “ ”, as Simplified Chinese does (「」 is for Traditional Chinese and Japanese).

export interface UiStrings {
	// Commands and the ribbon.
	commandImport: string;
	commandStop: string;

	// The status bar item while an import runs.
	statusReading: string;
	statusImporting(current: number, total: number): string;
	statusTooltip: string;

	// The settings page.
	settingsImport: string;
	settingsImportDesc: string;
	startImport: string;
	settingsDefaults: string;
	folder: string;
	folderDesc: string;
	vaultTop: string;
	badFolder: string;
	boxMarkers: string;
	boxMarkersDesc: string;
	fontColor: string;
	fontColorDesc: string;
	altText: string;
	altTextDesc: string;

	// The import window, before the import: what to import, and how.
	wizardTitle: string;
	/** The one line shown while nothing is chosen: where the download comes from and what to choose. */
	sourceEmpty: string;
	chooseBoth: string;
	chooseZips: string;
	chooseFolders: string;
	dialogTitle: string;
	dialogTitleZips: string;
	dialogTitleFolders: string;
	dialogUnavailable(error: string): string;
	reading: string;
	notebooksFound(count: number): string;
	noNotebooks: string;
	cannotRead(error: string): string;
	converterStopped: string;
	incompleteZip: string;
	remove: string;
	tree: string;
	/** Where the tree goes while no download is chosen. */
	treeEmpty: string;
	noSections: string;
	selectAll: string;
	deselectAll: string;
	imported: string;
	locked: string;
	incomplete: string;
	folderTaken: string;
	/** A notebook's folder is there, spelled in another case. */
	folderSpelling: string;
	/** A notebook that goes into the folder an earlier import of it left. */
	addingTo: string;
	settings: string;
	importInto: string;
	importIntoDesc: string;
	language: string;
	languageDesc: string;
	checking: string;
	nothingChosen: string;
	nothingToImport: string;
	/** Every notebook has a folder of its name in the target folder that is not ours. */
	allTaken: string;
	/** The notebooks chosen have no sections at all. */
	noSectionsAnywhere: string;
	folderUnreadable(error: string): string;
	/** "Open report" when its file is gone. */
	reportMissing: string;
	/** `unreadable` of the sections go along only to get a page that says why (password, cut-off download). */
	willImport(notebooks: number, sections: number, size: string, unreadable?: number): string;

	// The import window while the import runs.
	sectionCount(current: number, total: number): string;
	elapsed(time: string): string;
	closeHint: string;
	stop: string;
	stopping: string;

	// The import window once it has ended, and the notice when it ends while the window is closed.
	finished: string;
	stopped: string;
	failed: string;
	summary(notebooks: number, sections: number, pages: number, attachments: number): string;
	notConverted(count: number): string;
	leftOut(count: number): string;
	/** A stopped import left this notebook partly imported. */
	partial(name: string): string;
	openReport: string;
	close: string;
	/** The notice when an import ends while the window is closed; `outcome`: finished, stopped or failed. */
	finishedNotice(outcome: string): string;
	alreadyRunning: string;
	/** Notebooks found in the target folder when the import starts (put there meanwhile). */
	alreadyInFolder(names: string[]): string;
}

const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

const en: UiStrings = {
	commandImport: 'Import from OneNote',
	commandStop: 'Stop the OneNote import after the current section',

	statusReading: 'Reading the OneNote download...',
	statusImporting: (current, total) => `Importing OneNote ${n(current)}/${n(total)}`,
	statusTooltip: 'Click to open the import window',

	settingsImport: 'Import notebooks',
	settingsImportDesc: 'Turn OneNote notebooks downloaded from OneDrive into notes in this vault.',
	startImport: 'Start import',
	settingsDefaults: 'Defaults for new imports',
	folder: 'Folder',
	folderDesc: 'Imported notes go in this folder of the vault, with a subfolder for each notebook and each section.',
	vaultTop: 'the top of the vault',
	badFolder: 'A folder name cannot start with a dot.',
	boxMarkers: 'Text box positions',
	boxMarkersDesc: 'Pages laid out in columns come out with their text boxes one after another. When on, a hidden comment before each text box says where it sat on the page.',
	fontColor: 'Font colors',
	fontColorDesc: 'Keep the color of colored text.',
	altText: 'Picture alt text',
	altTextDesc: 'Keep the alt text a picture already has in the notes: written below the picture, collapsed.',

	wizardTitle: 'Import from OneNote',
	sourceEmpty: 'First download the folder that holds your notebooks on the OneDrive website, then import it here.',
	chooseBoth: 'Choose zip files or folders',
	chooseZips: 'Choose zip files',
	chooseFolders: 'Choose folders',
	dialogTitle: 'Choose the zip file or folder downloaded from OneDrive',
	dialogTitleZips: 'Choose the zip file downloaded from OneDrive',
	dialogTitleFolders: 'Choose the folder downloaded from OneDrive',
	dialogUnavailable: error => `The file dialog is not available: ${error}`,
	reading: 'Reading...',
	notebooksFound: count => plural(count, 'notebook', 'notebooks'),
	noNotebooks: 'No OneNote notebooks here.',
	cannotRead: error => `Could not read this: ${error}`,
	converterStopped: 'the converter stopped',
	incompleteZip: 'Incomplete download: only what arrived can be imported. Download it again to import everything.',
	remove: 'Remove',
	tree: 'Notebooks and sections to import',
	treeEmpty: 'Once you choose a zip file or folder, its notebooks and sections show here.',
	noSections: 'No sections',
	selectAll: 'Select all',
	deselectAll: 'Deselect all',
	imported: 'Imported',
	locked: 'Password protected',
	incomplete: 'Incomplete',
	folderTaken: 'Folder name taken',
	folderSpelling: 'Folder there in another case',
	addingTo: 'Adding to the notebook there',
	settings: 'Settings',
	importInto: 'Import into',
	importIntoDesc: 'Imported notes go in this folder of the vault, with a subfolder for each notebook and each section.',
	language: 'Language of contents pages and notices',
	languageDesc: 'The contents pages, notices and folder names the import creates use this language.',
	checking: 'Looking at the target folder...',
	nothingChosen: 'Nothing ticked.',
	nothingToImport: 'Nothing to import: every section is imported already or cannot be read.',
	allTaken: 'A folder of each notebook\'s name is in the target folder already, and it is not a notebook imported here. Choose another target folder.',
	noSectionsAnywhere: 'The notebooks chosen have no sections.',
	folderUnreadable: error => `The target folder cannot be read: ${error}`,
	reportMissing: 'The report is not there any more: it may have been moved or deleted.',
	willImport: (notebooks, sections, size, unreadable) => `${plural(sections, 'section', 'sections')} from ${plural(notebooks, 'notebook', 'notebooks')}${unreadable ? ` (${n(unreadable)} cannot be read)` : ''}, ${size}.`,

	sectionCount: (current, total) => `Section ${n(current)} of ${n(total)}`,
	elapsed: time => `${time} elapsed`,
	closeHint: 'You can close this window: the import goes on in the background. Click the progress bar at the bottom right to open it again.',
	stop: 'Stop',
	stopping: 'Stopping after the current section...',

	finished: 'Import finished',
	stopped: 'Import stopped',
	failed: 'Import failed',
	summary: (notebooks, sections, pages, attachments) => `${plural(notebooks, 'notebook', 'notebooks')}, ${plural(sections, 'section', 'sections')}, ${plural(pages, 'page', 'pages')}, ${plural(attachments, 'attachment', 'attachments')}.`,
	notConverted: count => `${plural(count, 'section', 'sections')} could not be converted. The report says why.`,
	leftOut: count => `${plural(count, 'section', 'sections')} not converted because the import was stopped.`,
	partial: name => `Only part of "${name}" was imported. Import again to complete it.`,
	openReport: 'Open report',
	close: 'Close',
	finishedNotice: outcome => `OneNote Ferry: ${outcome}. Click to see the result.`,
	alreadyRunning: 'An import is already running.',
	alreadyInFolder: names => `Already in the target folder: ${names.join(', ')}`,
};

const zh: UiStrings = {
	commandImport: '从 OneNote 导入',
	commandStop: '在当前分区完成后停止 OneNote 导入',

	statusReading: '正在读取 OneNote 笔记...',
	statusImporting: (current, total) => `正在导入 OneNote ${n(current)}/${n(total)}`,
	statusTooltip: '点击打开导入窗口',

	settingsImport: '导入笔记本',
	settingsImportDesc: '把从 OneDrive 下载的 OneNote 笔记本转成这个仓库里的笔记。',
	startImport: '开始导入',
	settingsDefaults: '新导入的默认设置',
	folder: '文件夹',
	folderDesc: '导入的笔记放在仓库的这个文件夹里，每本笔记本、每个分区各占一个子文件夹。',
	vaultTop: '仓库的根目录',
	badFolder: '文件夹名不能以点开头。',
	boxMarkers: '文本框位置',
	boxMarkersDesc: '多栏排版的页面导入后，文本框会依次排成一列。开启后，在每个文本框前加一条隐藏注释，写明它在原页面上的位置。',
	fontColor: '字体颜色',
	fontColorDesc: '保留彩色文字的颜色。',
	altText: '图片替换文字',
	altTextDesc: '保留原笔记已有的图片替换文字，写在图片下方，默认收起。',

	wizardTitle: '从 OneNote 导入',
	sourceEmpty: '先在 OneDrive 网页上下载装着笔记本的文件夹，再在这里导入。',
	chooseBoth: '选择 zip 文件或文件夹',
	chooseZips: '选择 zip 文件',
	chooseFolders: '选择文件夹',
	dialogTitle: '选择从 OneDrive 下载的 zip 文件或文件夹',
	dialogTitleZips: '选择从 OneDrive 下载的 zip 文件',
	dialogTitleFolders: '选择从 OneDrive 下载的文件夹',
	dialogUnavailable: error => `无法打开选择文件的窗口：${error}`,
	reading: '正在读取...',
	notebooksFound: count => `${n(count)} 本笔记本`,
	noNotebooks: '这里没有 OneNote 笔记本。',
	cannotRead: error => `无法读取：${error}`,
	converterStopped: '转换程序停止了',
	incompleteZip: '这个 zip 没有下载完整，只能导入已下载的部分；要导入全部，请重新下载。',
	remove: '移除',
	tree: '要导入的笔记本和分区',
	treeEmpty: '选好 zip 文件或文件夹后，笔记本和分区会在这里显示。',
	noSections: '没有分区',
	selectAll: '全选',
	deselectAll: '取消全选',
	imported: '已导入',
	locked: '有密码',
	incomplete: '不完整',
	folderTaken: '同名文件夹已存在',
	folderSpelling: '已有大小写不同的同名文件夹',
	addingTo: '补进已有的笔记本',
	settings: '设置',
	importInto: '导入到',
	importIntoDesc: '导入的笔记放在仓库的这个文件夹里，每本笔记本、每个分区各占一个子文件夹。',
	language: '目录和提示的语言',
	languageDesc: '导入时生成的目录、提示和文件夹名都用这种语言。',
	checking: '正在查看目标文件夹...',
	nothingChosen: '还没有勾选任何分区。',
	nothingToImport: '没有可导入的分区：都已导入，或无法读取。',
	allTaken: '目标文件夹里已有这些笔记本的同名文件夹，而且不是在这里导入的笔记本。请换一个目标文件夹。',
	noSectionsAnywhere: '选中的笔记本里没有分区。',
	folderUnreadable: error => `无法读取目标文件夹：${error}`,
	reportMissing: '找不到报告文件，可能已被移动或删除。',
	willImport: (notebooks, sections, size, unreadable) => `将导入 ${n(notebooks)} 本笔记本、${n(sections)} 个分区${unreadable ? `（${n(unreadable)} 个无法读取）` : ''}，共 ${size}。`,

	sectionCount: (current, total) => `第 ${n(current)} / ${n(total)} 个分区`,
	elapsed: time => `已用 ${time}`,
	closeHint: '可以关掉窗口，导入会在后台继续；点击右下角的进度条可再打开本窗口。',
	stop: '停止',
	stopping: '当前分区完成后停止...',

	finished: '导入完成',
	stopped: '导入已停止',
	failed: '导入失败',
	summary: (notebooks, sections, pages, attachments) => `${n(notebooks)} 本笔记本，${n(sections)} 个分区，${n(pages)} 页，${n(attachments)} 个附件。`,
	notConverted: count => `${n(count)} 个分区没能转换，原因见报告。`,
	leftOut: count => `${n(count)} 个分区因中途停止而未转换。`,
	partial: name => `“${name}”只导入了一部分，再导入一次即可补齐。`,
	openReport: '打开报告',
	close: '关闭',
	finishedNotice: outcome => `OneNote Ferry：${outcome}，点击查看结果。`,
	alreadyRunning: '已经有一个导入正在进行。',
	alreadyInFolder: names => `目标文件夹里已经有：${names.join('、')}`,
};

const ja: UiStrings = {
	commandImport: 'OneNote からインポート',
	commandStop: '現在のセクションが終わったら OneNote のインポートを停止',

	statusReading: 'OneNote のファイルを読み込み中...',
	statusImporting: (current, total) => `OneNote をインポート中 ${n(current)}/${n(total)}`,
	statusTooltip: 'クリックするとインポート画面を開きます',

	settingsImport: 'ノートブックをインポート',
	settingsImportDesc: 'OneDrive からダウンロードした OneNote のノートブックを、この保管庫のノートにします。',
	startImport: 'インポートを開始',
	settingsDefaults: '新しいインポートの既定値',
	folder: 'フォルダー',
	folderDesc: 'インポートしたノートは保管庫のこのフォルダーに入ります。ノートブックとセクションごとにサブフォルダーができます。',
	vaultTop: '保管庫の一番上',
	badFolder: 'フォルダー名をドットで始めることはできません。',
	boxMarkers: 'テキストボックスの位置',
	boxMarkersDesc: '段組みのページは、インポートするとテキストボックスが順に一列に並びます。オンにすると、各テキストボックスの前に元のページでの位置を記した非表示のコメントを入れます。',
	fontColor: 'フォントの色',
	fontColorDesc: '色付きの文字の色を残します。',
	altText: '画像の代替テキスト',
	altTextDesc: '元のノートにある画像の代替テキストを残し、画像の下に折りたたんで書きます。',

	wizardTitle: 'OneNote からインポート',
	sourceEmpty: 'まず Web 版の OneDrive でノートブックの入ったフォルダーをダウンロードし、ここでインポートしてください。',
	chooseBoth: 'zip ファイルまたはフォルダーを選択',
	chooseZips: 'zip ファイルを選択',
	chooseFolders: 'フォルダーを選択',
	dialogTitle: 'OneDrive からダウンロードした zip ファイルかフォルダーを選ぶ',
	dialogTitleZips: 'OneDrive からダウンロードした zip ファイルを選ぶ',
	dialogTitleFolders: 'OneDrive からダウンロードしたフォルダーを選ぶ',
	dialogUnavailable: error => `ファイルを選ぶ画面を開けません：${error}`,
	reading: '読み込み中...',
	notebooksFound: count => `ノートブック ${n(count)} 冊`,
	noNotebooks: 'ここに OneNote のノートブックはありません。',
	cannotRead: error => `読み込めません：${error}`,
	converterStopped: '変換処理が停止しました',
	incompleteZip: 'ダウンロードが不完全です。届いた部分だけインポートできます。すべてインポートするには、もう一度ダウンロードしてください。',
	remove: 'リストから削除',
	tree: 'インポートするノートブックとセクション',
	treeEmpty: 'zip ファイルかフォルダーを選ぶと、ノートブックとセクションがここに表示されます。',
	noSections: 'セクションなし',
	selectAll: 'すべて選択',
	deselectAll: 'すべて選択解除',
	imported: 'インポート済み',
	locked: 'パスワード保護',
	incomplete: '不完全',
	folderTaken: '同じ名前のフォルダーがあります',
	folderSpelling: '大文字と小文字だけが違う同じ名前のフォルダーがあります',
	addingTo: 'インポート済みのノートブックに追加',
	settings: '設定',
	importInto: 'インポート先',
	importIntoDesc: 'インポートしたノートは保管庫のこのフォルダーに入ります。ノートブックとセクションごとにサブフォルダーができます。',
	language: '目次と注記の言語',
	languageDesc: 'インポートで作る目次、注記、フォルダー名に使います。',
	checking: 'インポート先を確認中...',
	nothingChosen: 'チェックが入っていません。',
	nothingToImport: 'インポートできるセクションはありません。すべてインポート済みか、読み込めません。',
	allTaken: 'インポート先には各ノートブックと同じ名前のフォルダーがすでにあり、ここにインポートしたノートブックではありません。別のインポート先を選んでください。',
	noSectionsAnywhere: '選んだノートブックにはセクションがありません。',
	folderUnreadable: error => `インポート先を読み込めません：${error}`,
	reportMissing: 'レポートのファイルが見つかりません。移動または削除された可能性があります。',
	willImport: (notebooks, sections, size, unreadable) => `ノートブック ${n(notebooks)} 冊のセクション ${n(sections)} 個${unreadable ? `（うち ${n(unreadable)} 個は読み込めません）` : ''}をインポートします。合計 ${size}。`,

	sectionCount: (current, total) => `セクション ${n(current)} / ${n(total)}`,
	elapsed: time => `経過 ${time}`,
	closeHint: 'この画面を閉じても、インポートはバックグラウンドで続きます。右下の進行状況バーをクリックすると、また開きます。',
	stop: '停止',
	stopping: '現在のセクションが終わったら停止します...',

	finished: 'インポート完了',
	stopped: 'インポートを停止しました',
	failed: 'インポートに失敗しました',
	summary: (notebooks, sections, pages, attachments) => `ノートブック ${n(notebooks)}、セクション ${n(sections)}、ページ ${n(pages)}、添付ファイル ${n(attachments)}。`,
	notConverted: count => `${n(count)} 個のセクションを変換できませんでした。理由はレポートにあります。`,
	leftOut: count => `停止したため、${n(count)} 個のセクションは変換されていません。`,
	partial: name => `「${name}」は一部だけインポートされました。もう一度インポートすると残りが追加されます。`,
	openReport: 'レポートを開く',
	close: '閉じる',
	finishedNotice: outcome => `OneNote Ferry：${outcome}。クリックで結果を表示します。`,
	alreadyRunning: 'インポートはすでに実行中です。',
	alreadyInFolder: names => `インポート先にすでにあります：${names.join('、')}`,
};

const ko: UiStrings = {
	commandImport: 'OneNote에서 가져오기',
	commandStop: '현재 섹션을 마친 뒤 OneNote 가져오기 중지',

	statusReading: 'OneNote 파일을 읽는 중...',
	statusImporting: (current, total) => `OneNote 가져오는 중 ${n(current)}/${n(total)}`,
	statusTooltip: '클릭하면 가져오기 창이 열립니다',

	settingsImport: '전자 필기장 가져오기',
	settingsImportDesc: 'OneDrive에서 다운로드한 OneNote 전자 필기장을 이 보관함의 노트로 바꿉니다.',
	startImport: '가져오기 시작',
	settingsDefaults: '새 가져오기의 기본값',
	folder: '폴더',
	folderDesc: '가져온 노트는 보관함의 이 폴더에 들어갑니다. 전자 필기장과 섹션마다 하위 폴더가 생깁니다.',
	vaultTop: '보관함 최상위 폴더',
	badFolder: '폴더 이름은 점으로 시작할 수 없습니다.',
	boxMarkers: '텍스트 상자 위치',
	boxMarkersDesc: '여러 열로 된 페이지는 가져오면 텍스트 상자가 위에서 아래로 차례로 놓입니다. 켜면 각 텍스트 상자 앞에 원래 페이지에서의 위치를 적은 숨은 주석을 넣습니다.',
	fontColor: '글꼴 색',
	fontColorDesc: '색이 있는 글자의 색을 유지합니다.',
	altText: '그림 대체 텍스트',
	altTextDesc: '원래 노트에 있는 그림 대체 텍스트를 유지해 그림 아래에 접힌 상태로 씁니다.',

	wizardTitle: 'OneNote에서 가져오기',
	sourceEmpty: '먼저 웹에서 OneDrive를 열고 전자 필기장이 든 폴더를 다운로드한 뒤, 여기서 가져오세요.',
	chooseBoth: 'zip 파일 또는 폴더 선택',
	chooseZips: 'zip 파일 선택',
	chooseFolders: '폴더 선택',
	dialogTitle: 'OneDrive에서 다운로드한 zip 파일이나 폴더 선택',
	dialogTitleZips: 'OneDrive에서 다운로드한 zip 파일 선택',
	dialogTitleFolders: 'OneDrive에서 다운로드한 폴더 선택',
	dialogUnavailable: error => `파일 선택 창을 열 수 없습니다: ${error}`,
	reading: '읽는 중...',
	notebooksFound: count => `전자 필기장 ${n(count)}개`,
	noNotebooks: '여기에는 OneNote 전자 필기장이 없습니다.',
	cannotRead: error => `읽을 수 없습니다: ${error}`,
	converterStopped: '변환이 중지되었습니다',
	incompleteZip: '다운로드가 완전하지 않습니다. 받은 부분만 가져올 수 있으며, 전부 가져오려면 다시 다운로드하세요.',
	remove: '제거',
	tree: '가져올 전자 필기장과 섹션',
	treeEmpty: 'zip 파일이나 폴더를 선택하면 전자 필기장과 섹션이 여기에 표시됩니다.',
	noSections: '섹션 없음',
	selectAll: '모두 선택',
	deselectAll: '모두 선택 해제',
	imported: '가져옴',
	locked: '암호 보호',
	incomplete: '불완전',
	folderTaken: '같은 이름의 폴더가 있음',
	folderSpelling: '대소문자만 다른 같은 이름의 폴더가 있음',
	addingTo: '이미 가져온 전자 필기장에 추가',
	settings: '설정',
	importInto: '가져올 위치',
	importIntoDesc: '가져온 노트는 보관함의 이 폴더에 들어갑니다. 전자 필기장과 섹션마다 하위 폴더가 생깁니다.',
	language: '목차와 안내 문구의 언어',
	languageDesc: '가져올 때 만드는 목차, 안내 문구, 폴더 이름에 쓰입니다.',
	checking: '대상 폴더를 확인하는 중...',
	nothingChosen: '선택한 항목이 없습니다.',
	nothingToImport: '가져올 수 있는 섹션이 없습니다. 모두 이미 가져왔거나 읽을 수 없습니다.',
	allTaken: '대상 폴더에 각 전자 필기장과 같은 이름의 폴더가 이미 있으며, 여기로 가져온 전자 필기장이 아닙니다. 다른 대상 폴더를 선택하세요.',
	noSectionsAnywhere: '선택한 전자 필기장에 섹션이 없습니다.',
	folderUnreadable: error => `대상 폴더를 읽을 수 없습니다: ${error}`,
	reportMissing: '보고서 파일을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다.',
	willImport: (notebooks, sections, size, unreadable) => `전자 필기장 ${n(notebooks)}개의 섹션 ${n(sections)}개${unreadable ? `(그중 ${n(unreadable)}개는 읽을 수 없음)` : ''}를 가져옵니다. 모두 ${size}.`,

	sectionCount: (current, total) => `섹션 ${n(current)} / ${n(total)}`,
	elapsed: time => `경과 ${time}`,
	closeHint: '이 창을 닫아도 가져오기는 백그라운드에서 계속됩니다. 오른쪽 아래 진행 막대를 클릭하면 다시 열립니다.',
	stop: '중지',
	stopping: '현재 섹션을 마친 뒤 중지합니다...',

	finished: '가져오기 완료',
	stopped: '가져오기 중지됨',
	failed: '가져오기 실패',
	summary: (notebooks, sections, pages, attachments) => `전자 필기장 ${n(notebooks)}개, 섹션 ${n(sections)}개, 페이지 ${n(pages)}개, 첨부 파일 ${n(attachments)}개.`,
	notConverted: count => `섹션 ${n(count)}개를 변환하지 못했습니다. 이유는 보고서에 있습니다.`,
	leftOut: count => `중지해서 섹션 ${n(count)}개는 변환되지 않았습니다.`,
	partial: name => `일부만 가져온 전자 필기장: "${name}". 다시 가져오면 나머지가 추가됩니다.`,
	openReport: '보고서 열기',
	close: '닫기',
	finishedNotice: outcome => `OneNote Ferry: ${outcome}. 클릭하면 결과를 봅니다.`,
	alreadyRunning: '가져오기가 이미 진행 중입니다.',
	alreadyInFolder: names => `대상 폴더에 이미 있습니다: ${names.join(', ')}`,
};

export const UI_LANGUAGES = { en, zh, ja, ko };

/** The interface text for Obsidian's language (`zh`, `zh-TW`, `ja`, `ko`...); English otherwise. */
export function uiStrings(language: string): UiStrings {
	const code = language.toLowerCase();
	if (code.startsWith('zh')) return zh;
	if (code === 'ja' || code.startsWith('ja-')) return ja;
	if (code === 'ko' || code.startsWith('ko-')) return ko;
	return en;
}

/** Sizes as people read them: 820 KB, 12.3 MB, 1.7 GB. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	const rounded = (value: number) => value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	let value = bytes / 1024, unit = 0;
	// Compared after rounding, so 1,048,575 bytes is 1 MB rather than 1024 KB.
	while (rounded(value) >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${rounded(value)} ${units[unit]}`;
}

/** Each marker language by its own name, for the language menu. */
export const LANGUAGE_NAMES: Record<string, string> = { 'en': 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', 'ja': '日本語', 'ko': '한국어' };
