// The plugin's own interface text, in its four interface languages (English, Chinese, Japanese,
// Korean), following Obsidian's language. Not the marks written into notes: those are in
// src/core/strings.ts (and follow the reader too, but in five languages). Simplified Chinese
// quotes with “ ”, as Simplified Chinese does (「」 is for Traditional Chinese and Japanese).

export interface UiStrings {
	// Commands and the ribbon.
	commandImport: string;
	commandUpdate: string;
	commandStop: string;

	// The status bar item while an import runs.
	statusReading: string;
	statusImporting(current: number, total: number): string;
	statusUpdating(current: number, total: number): string;
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
	altText: string;
	altTextDesc: string;

	// The import window, before the import: what to import, and how.
	wizardTitle: string;
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
	locked: string;
	incomplete: string;
	folderTaken: string;
	/** A notebook's folder is there, spelled in another case. */
	folderSpelling: string;
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

	// The window when it updates notebooks imported before (§11.5 item 49): its title and first line
	// when opened to check for updates, and what the tree and the bottom say.
	updateTitle: string;
	/** Beside the settings heading while language and options are greyed: they apply to new notebooks only. */
	/** Under the bottom line, when sections updated because OneNote changed them are chosen with ones the settings apply to. */
	ownSettingsKept: string;
	/** A section without changes the user clicked: it is converted again with the settings chosen now. */
	reconvertMark: string;
	reconvertTip: string;
	sectionsReconverting(count: number): string;
	/** A section, or a notebook, being read. */
	checkingRow: string;
	unchanged: string;
	changed: string;
	/** Hover text of a changed section with pages edited on both sides. */
	bothEditedIn(count: number): string;
	newSection: string;
	unfinished: string;
	skipped: string;
	missing: string;
	missingTip: string;
	older: string;
	olderTip(folder: string): string;
	gone: string;
	/** Hover text: what is in the vault is left as it is. */
	keptAsIs: string;
	restorable(count: number): string;
	restorableTip: string;
	unreadable: string;
	different: string;
	differentTip: string;
	/** A notebook imported before that another download chosen holds a newer copy of: that one updates it. */
	duplicate: string;
	duplicateTip: string;
	/** A notebook never imported into the target folder, while others there are updated. */
	notImported: string;
	sectionsChanged(count: number): string;
	/** A notebook imported in part: some of its sections were left unticked then. */
	partlyImported: string;
	partlyImportedTip(skipped: number): string;
	pageAdded: string;
	pageModified: string;
	/** Hover text of a page OneNote retitled. */
	pageRetitled(was: string): string;
	pageBothEdited: string;
	pageBothEditedTip(folder: string): string;
	pageRemoved: string;
	pageDeleted: string;
	pageDeletedTip: string;
	pagesReordered(count: number): string;
	/** A section OneNote renamed or moved to another group: its name (with groups) before. */
	sectionWas(was: string): string;
	checkingUpdates(done: number, total: number): string;
	/** `folder`: where the versions replaced go (said when sections are updated). */
	willUpdate(updated: number, added: number, restored: number, reconverted: number, folder: string): string;
	bothEditedWarning(count: number, folder: string): string;
	noUpdates: string;
	noUpdatesReconvert: string;
	startUpdate: string;

	// The import window while the import runs.
	sectionCount(current: number, total: number): string;
	elapsed(time: string): string;
	closeHint: string;
	closeHintUpdate: string;
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

	// The window once an update has ended.
	updateFinished: string;
	updateStopped: string;
	updateFailed: string;
	updateSummary(updated: number, added: number, reconverted: number, pagesAdded: number, pagesModified: number, pagesRestored: number): string;
	/** Converted again: pages edited in Obsidian left as they were. */
	attnKeptEdited(count: number): string;
	/** New notebooks imported with the update: `summary` is what summary() says of them. */
	alsoImported(summary: string): string;
	attnBothEdited(count: number, folder: string): string;
	attnRolledBack(count: number): string;
	attnNotConverted(count: number): string;
	attnNotUpdated(count: number): string;
	attnKeptAside(count: number, folder: string): string;
	attnLeftOut(count: number): string;
	openRecord: string;
	recordMissing: string;
	/** The notice when Obsidian starts and an update cut off before has been finished or put back. */
	resumedNotice: string;
	resumeFailed(error: string): string;
	alreadyRunning: string;
	/** Notebooks found in the target folder when the import starts (put there meanwhile). */
	alreadyInFolder(names: string[]): string;

	// The page the browser shows once the Microsoft sign-in's answer has come back to the plugin.
	signInPageTitle: string;
	signInPageDone: string;
	signInPageFailed: string;

	// OneDrive as a source in the import window (Internal-10 §22.1).
	/** The row that adds OneDrive, in the import window and in the update window. */
	chooseOneDrive: string;
	chooseOneDriveUpdate: string;
	/** In its card: what it does (signing in first, when not signed in). */
	oneDriveAddDesc: string;
	oneDriveAddDescSignedIn: string;
	/**
	 * In the card on the rows that choose files or folders: what each takes, one source a line. The
	 * row that takes both (macOS) shows the first and the last; the row for files shows zips and exports.
	 */
	sourceZipsOrFolders: string;
	sourceZips: string;
	sourceFolders: string;
	sourceExports: string;
	oneDrive: string;
	oneDriveReading: string;
	otherFolder: string;
	/** While the browser shows Microsoft's sign-in page. */
	signInWaiting: string;
	cancelSignIn: string;
	/** Why signing in or reading OneDrive did not work, by SignInProblem. */
	signInProblems: Record<'cancelled' | 'needs-admin' | 'signed-out' | 'app-unavailable' | 'unreachable' | 'timed-out' | 'failed', string>;
	downloadingFiles(files: number, total: number, size: string, totalSize: string): string;
	statusDownloading(current: number, total: number): string;
	oneDriveFinding: string;
	/** The list kept from last time is shown while OneDrive is asked again. */
	oneDriveRefreshing: string;
	oneDriveReadingCount(done: number, total: number): string;
	/** Where the tree goes while OneDrive's notebooks are read. */
	oneDriveTreeWaiting: string;
	retry: string;
	reopenSignIn: string;
	folderPickerTitle: string;
	pickerHint: string;
	pickerChosen(count: number): string;
	addNotebooks: string;
	alreadyListed: string;
	folderEmpty: string;
	leftOutNotDownloaded(count: number): string;
	/** On the result of an import stopped while it downloaded from OneDrive. */
	downloadsKept: string;
	copyBusy: string;
	noSpace(size: string): string;

	// The settings page: the Microsoft account and the downloaded notebooks.
	/** The settings group for importing from OneDrive (the account and the download cache). */
	settingsOneDrive: string;
	settingsAccount: string;
	accountPersonal: string;
	accountOrganization: string;
	accountNone: string;
	/** Where the plugin's access is withdrawn, around a link to Microsoft's page; follows the account line as written (a leading space where the language puts one between sentences). */
	accountRevoke: { before: string, link: string, after: string };
	settingsCopy: string;
	/** The download cache: what it is for, how much it takes and where it is (`path` as shown, `~` for the home folder). */
	copyDesc(size: string, path: string): string;
	copyNone: string;
	deleteCopy: string;
	deleteCopyTitle: string;
	deleteCopyConfirm(size: string): string;
	signIn: string;
	signOut: string;
	cancel: string;
}

const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

const en: UiStrings = {
	commandImport: 'Import OneNote notes',
	commandUpdate: 'Check for OneNote updates',
	commandStop: 'Stop the OneNote import or update after the current section',

	statusReading: 'Reading the OneNote download...',
	statusImporting: (current, total) => `Importing OneNote ${n(current)}/${n(total)}`,
	statusUpdating: (current, total) => `Updating OneNote ${n(current)}/${n(total)}`,
	statusTooltip: 'Click to open the import window',

	settingsImport: 'Import notebooks',
	settingsImportDesc: 'Converts the OneNote notebooks in your OneDrive into notes in this vault.',
	startImport: 'Start import',
	settingsDefaults: 'Defaults for new imports',
	folder: 'Folder',
	folderDesc: 'Imported notes are stored in this folder, with a subfolder for each notebook and section.',
	vaultTop: 'the top of the vault',
	badFolder: 'A folder name cannot start with a dot.',
	boxMarkers: 'Text box positions',
	boxMarkersDesc: 'Pages laid out in columns come out with their text boxes one after another. When on, a hidden comment before each text box says where it sat on the page.',
	altText: 'Picture alt text',
	altTextDesc: 'Keep the alt text a picture already has in the notes: written below the picture, collapsed.',

	wizardTitle: 'Import OneNote notes',
	chooseBoth: 'Choose files or folders',
	chooseZips: 'Choose files',
	chooseFolders: 'Choose folders',
	dialogTitle: 'Choose the zip file or folder downloaded from OneDrive, or a file exported by OneNote for Windows',
	dialogTitleZips: 'Choose the zip file downloaded from OneDrive, or a file exported by OneNote for Windows',
	dialogTitleFolders: 'Choose the folder downloaded from OneDrive',
	dialogUnavailable: error => `The file dialog is not available: ${error}`,
	reading: 'Reading...',
	notebooksFound: count => plural(count, 'notebook', 'notebooks'),
	noNotebooks: 'No OneNote notebooks here.',
	cannotRead: error => `Could not read this: ${error}`,
	converterStopped: 'the converter stopped unexpectedly',
	incompleteZip: 'This download is incomplete: only the parts it contains can be imported. Download it again to import everything.',
	remove: 'Remove',
	tree: 'Notebooks and sections',
	treeEmpty: 'Once you choose where to import from, the notebooks and sections show here.',
	noSections: 'No sections',
	selectAll: 'Select all',
	deselectAll: 'Deselect all',
	locked: 'Password protected',
	incomplete: 'Incomplete',
	folderTaken: 'Folder name taken',
	folderSpelling: 'Folder there in another case',
	settings: 'Settings',
	importInto: 'Import into',
	importIntoDesc: 'Imported notes are stored in this folder, with a subfolder for each notebook and section.',
	language: 'Language of contents pages and notices',
	languageDesc: 'The contents pages, notices and folder names the import creates use this language.',
	checking: 'Looking at the target folder...',
	nothingChosen: 'Nothing ticked.',
	nothingToImport: 'Nothing to import: every section is imported already or cannot be read.',
	allTaken: 'The target folder already has folders with these names that were not imported by OneNote Ferry. Choose another target folder.',
	noSectionsAnywhere: 'The notebooks chosen have no sections.',
	folderUnreadable: error => `The target folder cannot be read: ${error}`,
	reportMissing: 'The report is not there any more: it may have been moved or deleted.',
	willImport: (notebooks, sections, size, unreadable) => `${plural(sections, 'section', 'sections')} from ${plural(notebooks, 'notebook', 'notebooks')}${unreadable ? ` (${n(unreadable)} cannot be read)` : ''}, ${size}.`,

	updateTitle: 'Check for OneNote updates',
	ownSettingsKept: 'Sections updated because OneNote changed them keep their own settings.',
	reconvertMark: 'Convert again',
	reconvertTip: 'Click to convert again with the settings chosen now',
	sectionsReconverting: count => `${plural(count, 'section', 'sections')} to convert again`,
	checkingRow: 'Checking...',
	unchanged: 'No changes',
	changed: 'Changed',
	bothEditedIn: count => `${plural(count, 'page', 'pages')} also edited in Obsidian`,
	newSection: 'New section',
	unfinished: 'Unfinished last time',
	skipped: 'Not chosen last time',
	missing: 'No longer in the vault',
	missingTip: 'Imported before; tick to import it again where it was',
	older: 'Download is older',
	olderTip: folder => `The download's pages are older than the vault's; if ticked, the download's version replaces the vault's, and the current one goes to "${folder}"`,
	gone: 'Not in the download',
	keptAsIs: 'What is in the vault stays as it is',
	restorable: count => `${plural(count, 'page', 'pages')} to bring back`,
	restorableTip: 'Pages deleted in Obsidian; tick to bring them back from the download',
	unreadable: 'Cannot be read',
	different: 'Another notebook of this name',
	differentTip: 'It has no page in common with the notebook of this name in the vault, which stays as it is; to import this one, choose another target folder',
	duplicate: 'Using the newer copy',
	duplicateTip: 'This notebook is in another place you chose too, with newer pages: the update uses that copy',
	notImported: 'Not imported',
	sectionsChanged: count => `${plural(count, 'section', 'sections')} changed`,
	partlyImported: 'Partly imported',
	partlyImportedTip: skipped => `${plural(skipped, 'section was', 'sections were')} not chosen last time; open the notebook to tick and add them`,
	pageAdded: 'New',
	pageModified: 'Changed',
	pageRetitled: was => `Was titled "${was}"`,
	pageBothEdited: 'Also edited in Obsidian',
	pageBothEditedTip: folder => `The new version from OneNote goes in; yours goes to "${folder}"`,
	pageRemoved: 'No longer in OneNote',
	pageDeleted: 'Deleted in Obsidian',
	pageDeletedTip: 'Tick to bring it back',
	pagesReordered: count => `${plural(count, 'page', 'pages')} only moved or changed level`,
	sectionWas: was => `Was "${was}"`,
	checkingUpdates: (done, total) => `Checking for updates ${n(done)}/${n(total)}...`,
	willUpdate: (updated, added, restored, reconverted, folder) => {
		const parts = [updated ? `update ${plural(updated, 'section', 'sections')}` : '', added ? `add ${plural(added, 'section', 'sections')}` : '', reconverted ? `convert ${plural(reconverted, 'section', 'sections')} again` : '', restored ? `bring back ${plural(restored, 'page', 'pages')}` : ''].filter(Boolean);
		return `Will ${parts.join(', ')}.${updated || reconverted ? ` The current versions go to "${folder}".` : ''}`;
	},
	bothEditedWarning: (count, folder) => `${plural(count, 'page', 'pages')} also edited in Obsidian: your ${count === 1 ? 'version goes' : 'versions go'} to "${folder}" too.`,
	noUpdates: 'No updates found.',
	noUpdatesReconvert: 'No updates found. Click a section to convert it again with the settings chosen now.',
	startUpdate: 'Start update',

	sectionCount: (current, total) => `Section ${n(current)} of ${n(total)}`,
	elapsed: time => `${time} elapsed`,
	closeHint: 'If you close this window, the import continues in the background. Click the progress at the bottom right to open it again.',
	closeHintUpdate: 'If you close this window, the update continues in the background. Click the progress at the bottom right to open it again.',
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
	updateFinished: 'Update finished',
	updateStopped: 'Update stopped',
	updateFailed: 'Update failed',
	updateSummary: (updated, added, reconverted, pagesAdded, pagesModified, pagesRestored) => {
		const sections = [updated ? `${plural(updated, 'section', 'sections')} updated` : '', added ? `${plural(added, 'section', 'sections')} added` : '', reconverted ? `${plural(reconverted, 'section', 'sections')} converted again` : ''].filter(Boolean).join(', ');
		const pages = [pagesAdded ? plural(pagesAdded, 'page added', 'pages added') : '', pagesModified ? plural(pagesModified, 'page changed', 'pages changed') : '', pagesRestored ? plural(pagesRestored, 'page brought back', 'pages brought back') : ''].filter(Boolean).join(', ');
		return sections || pages ? `${[sections, pages].filter(Boolean).join('; ')}.` : 'No section was updated.';
	},
	alsoImported: summary => `Also imported: ${summary}`,
	attnBothEdited: (count, folder) => `${plural(count, 'page', 'pages')} also edited in Obsidian: your ${count === 1 ? 'version is' : 'versions are'} in "${folder}".`,
	attnKeptEdited: count => `${plural(count, 'page', 'pages')} edited in Obsidian stayed as ${count === 1 ? 'it was' : 'they were'}, not written with the new settings.`,
	attnRolledBack: count => `${plural(count, 'section', 'sections')} could not be updated: put back as before.`,
	attnNotConverted: count => `${plural(count, 'section', 'sections')} could not be read: left as before.`,
	attnNotUpdated: count => `${plural(count, 'section', 'sections')} not updated: the folder needed holds something else.`,
	attnKeptAside: (count, folder) => `${plural(count, 'file', 'files')} saved aside before being written over. Look at ${count === 1 ? 'it' : 'them'} before deleting "${folder}".`,
	attnLeftOut: count => `${plural(count, 'section', 'sections')} not updated because the update was stopped. Check for updates again to finish.`,
	openRecord: 'Open sync log',
	recordMissing: 'The sync log is not there any more: it may have been moved or deleted.',
	resumedNotice: 'OneNote Ferry: the update interrupted last time has been dealt with. Click to see its sync log.',
	resumeFailed: error => `OneNote Ferry: the update interrupted last time could not be dealt with: ${error}`,
	alreadyRunning: 'An import is already running.',
	alreadyInFolder: names => `Already in the target folder: ${names.join(', ')}`,

	signInPageTitle: 'OneNote Ferry',
	signInPageDone: 'Signed in. You can close this page and go back to Obsidian.',
	signInPageFailed: 'Sign-in failed. Return to Obsidian to try again.',

	chooseOneDrive: 'Import from OneDrive',
	chooseOneDriveUpdate: 'Check OneDrive for updates',
	oneDriveAddDesc: 'Sign in to your Microsoft account and read the notebooks in your OneDrive',
	oneDriveAddDescSignedIn: 'Reads the notebooks in your OneDrive',
	sourceZipsOrFolders: 'A zip file downloaded from the OneDrive website or its unzipped folder',
	sourceZips: 'A zip file downloaded from the OneDrive website',
	sourceFolders: 'A folder downloaded from the OneDrive website and unzipped',
	sourceExports: 'A notebook (.onepkg) or section (.one) exported by OneNote for Windows',
	oneDrive: 'OneDrive',
	oneDriveReading: 'Reading the notebooks in OneDrive...',
	otherFolder: 'Look in another folder',
	signInWaiting: 'Sign in to your Microsoft account in your browser. Work or school accounts may need an administrator\'s approval.',
	cancelSignIn: 'Cancel',
	signInProblems: {
		cancelled: 'Sign-in was cancelled.',
		'needs-admin': 'Sign-in requires an administrator\'s approval.',
		'signed-out': 'Your sign-in is no longer valid. Sign in again.',
		'app-unavailable': 'Sign-in is unavailable at the moment. Try again later.',
		unreachable: 'Cannot connect to Microsoft. Check your network and try again.',
		'timed-out': 'Sign-in timed out. Try again.',
		failed: 'Sign-in failed.',
	},
	downloadingFiles: (files, total, size, totalSize) => `Downloading from OneDrive: ${n(files)} of ${plural(total, 'file', 'files')}, ${size} of ${totalSize}`,
	statusDownloading: (current, total) => `Downloading ${n(current)}/${n(total)}`,
	oneDriveFinding: 'Looking for notebooks in OneDrive...',
	oneDriveRefreshing: 'Getting the latest list from OneDrive...',
	oneDriveReadingCount: (done, total) => `Reading OneDrive: ${n(done)} of ${plural(total, 'notebook', 'notebooks')}`,
	oneDriveTreeWaiting: 'The notebooks in OneDrive are listed here once they are read.',
	retry: 'Try again',
	reopenSignIn: 'Open the sign-in page again',
	folderPickerTitle: 'Find notebooks in other folders',
	pickerHint: 'Open folders and tick the notebooks to add.',
	pickerChosen: count => `${plural(count, 'notebook', 'notebooks')} ticked`,
	addNotebooks: 'Add',
	alreadyListed: 'Already listed',
	folderEmpty: 'No folders or notebooks here.',
	leftOutNotDownloaded: count => `${plural(count, 'section', 'sections')} could not be downloaded from OneDrive: not imported.`,
	downloadsKept: 'What was already downloaded is kept: importing again picks up where it stopped.',
	copyBusy: 'Another window is downloading from OneDrive. Try again in a moment.',
	noSpace: size => `Not enough disk space to download: ${size} needed.`,

	settingsOneDrive: 'OneDrive',
	settingsAccount: 'Microsoft account',
	accountPersonal: 'Signed in with a personal account.',
	accountOrganization: 'Signed in with a work or school account.',
	accountNone: 'Not signed in. Sign in to import notebooks straight from OneDrive.',
	accountRevoke: { before: ' To withdraw access, go to ', link: 'app permissions in your Microsoft account', after: '.' },
	settingsCopy: 'Download cache',
	copyDesc: (size, path) => `Original files downloaded from OneDrive, so that checking for updates downloads only what changed. Currently ${size}, in ${path}.`,
	copyNone: 'Original files downloaded from OneDrive, so that checking for updates downloads only what changed. Empty.',
	deleteCopy: 'Clear',
	deleteCopyTitle: 'Clear download cache',
	deleteCopyConfirm: size => `Clear the download cache (${size})? Notes in the vault are not affected; files are downloaded again when needed.`,
	signIn: 'Sign in',
	signOut: 'Sign out',
	cancel: 'Cancel',
};

const zh: UiStrings = {
	commandImport: '导入 OneNote 笔记',
	commandUpdate: '检查 OneNote 更新',
	commandStop: '在当前分区完成后停止 OneNote 导入或更新',

	statusReading: '正在读取 OneNote 笔记...',
	statusImporting: (current, total) => `正在导入 OneNote ${n(current)}/${n(total)}`,
	statusUpdating: (current, total) => `正在更新 OneNote ${n(current)}/${n(total)}`,
	statusTooltip: '点击打开导入窗口',

	settingsImport: '导入笔记本',
	settingsImportDesc: '将 OneDrive 上的 OneNote 笔记本转换为本仓库中的笔记。',
	startImport: '开始导入',
	settingsDefaults: '新导入的默认设置',
	folder: '文件夹',
	folderDesc: '导入的笔记存放在此文件夹中，每本笔记本和每个分区各有一个子文件夹。',
	vaultTop: '仓库的根目录',
	badFolder: '文件夹名不能以点开头。',
	boxMarkers: '文本框位置',
	boxMarkersDesc: '多栏排版的页面导入后，文本框会依次排成一列。开启后，在每个文本框前加一条隐藏注释，写明它在原页面上的位置。',
	altText: '图片替换文字',
	altTextDesc: '保留原笔记已有的图片替换文字，写在图片下方，默认收起。',

	wizardTitle: '导入 OneNote 笔记',
	chooseBoth: '选择文件或文件夹',
	chooseZips: '选择文件',
	chooseFolders: '选择文件夹',
	dialogTitle: '选择从 OneDrive 下载的 zip 文件或文件夹，或 Windows 版 OneNote 导出的文件',
	dialogTitleZips: '选择从 OneDrive 下载的 zip 文件，或 Windows 版 OneNote 导出的文件',
	dialogTitleFolders: '选择从 OneDrive 下载的文件夹',
	dialogUnavailable: error => `无法打开选择文件的窗口：${error}`,
	reading: '正在读取...',
	notebooksFound: count => `${n(count)} 本笔记本`,
	noNotebooks: '这里没有 OneNote 笔记本。',
	cannotRead: error => `无法读取：${error}`,
	converterStopped: '转换程序意外停止',
	incompleteZip: 'zip 文件不完整，只能导入其中已有的部分。如需全部导入，请重新下载。',
	remove: '移除',
	tree: '笔记本和分区',
	treeEmpty: '选好从哪里导入后，笔记本和分区会在这里显示。',
	noSections: '没有分区',
	selectAll: '全选',
	deselectAll: '取消全选',
	locked: '有密码',
	incomplete: '不完整',
	folderTaken: '同名文件夹已存在',
	folderSpelling: '已有大小写不同的同名文件夹',
	settings: '设置',
	importInto: '导入到',
	importIntoDesc: '导入的笔记存放在此文件夹中，每本笔记本和每个分区各有一个子文件夹。',
	language: '目录和提示的语言',
	languageDesc: '导入时生成的目录、提示和文件夹名都用这种语言。',
	checking: '正在查看目标文件夹...',
	nothingChosen: '还没有勾选任何分区。',
	nothingToImport: '没有可导入的分区：都已导入，或无法读取。',
	allTaken: '目标文件夹中已有同名文件夹，且不是由 OneNote Ferry 导入的。请选择其他目标文件夹。',
	noSectionsAnywhere: '选中的笔记本里没有分区。',
	folderUnreadable: error => `无法读取目标文件夹：${error}`,
	reportMissing: '找不到报告文件，可能已被移动或删除。',
	willImport: (notebooks, sections, size, unreadable) => `将导入 ${n(notebooks)} 本笔记本、${n(sections)} 个分区${unreadable ? `（${n(unreadable)} 个无法读取）` : ''}，共 ${size}。`,

	updateTitle: '检查 OneNote 更新',
	ownSettingsKept: '有更新的分区沿用原来的设置。',
	reconvertMark: '重新转换',
	reconvertTip: '点击后按现在的设置重新转换',
	sectionsReconverting: count => `${n(count)} 个分区重新转换`,
	checkingRow: '正在检查...',
	unchanged: '无变化',
	changed: '有更新',
	bothEditedIn: count => `其中 ${n(count)} 页在 Obsidian 中也已修改`,
	newSection: '新分区',
	unfinished: '上次未完成',
	skipped: '上次未选',
	missing: '已不在仓库中',
	missingTip: '以前导入过，勾选后重新导入到原来的位置',
	older: '下载的版本较旧',
	olderTip: folder => `下载中的页面比仓库中的旧，勾选后换成下载中的内容，现有版本放进“${folder}”`,
	gone: '下载中没有',
	keptAsIs: '仓库中的保持原样',
	restorable: count => `可补回 ${n(count)} 页`,
	restorableTip: '这些页面在 Obsidian 中删除过，勾选后从下载中补回',
	unreadable: '无法读取',
	different: '同名的另一本笔记本',
	differentTip: '与仓库中的同名笔记本没有相同页面，不会改动；要导入这一本，请换一个目标文件夹',
	duplicate: '以较新的一份为准',
	duplicateTip: '选中的来源里另有一份这本笔记本，页面较新，更新用那一份',
	notImported: '未导入',
	sectionsChanged: count => `${n(count)} 个分区有更新`,
	partlyImported: '部分导入',
	partlyImportedTip: skipped => `另有 ${n(skipped)} 个分区上次未选，展开后勾选即可补充导入`,
	pageAdded: '新增',
	pageModified: '修改',
	pageRetitled: was => `原标题“${was}”`,
	pageBothEdited: 'Obsidian 中也已修改',
	pageBothEditedTip: folder => `将换成 OneNote 的新版，你的版本放进“${folder}”`,
	pageRemoved: 'OneNote 中已移除',
	pageDeleted: 'Obsidian 中已删除',
	pageDeletedTip: '勾选后补回',
	pagesReordered: count => `${n(count)} 页仅调整了顺序或层级`,
	sectionWas: was => `原为“${was}”`,
	checkingUpdates: (done, total) => `正在检查更新 ${n(done)}/${n(total)}...`,
	willUpdate: (updated, added, restored, reconverted, folder) => {
		const parts = [updated ? `更新 ${n(updated)} 个分区` : '', added ? `新增 ${n(added)} 个分区` : '', reconverted ? `重新转换 ${n(reconverted)} 个分区` : '', restored ? `补回 ${n(restored)} 页` : ''].filter(Boolean);
		return `将${parts.join('、')}${updated || reconverted ? `，更新前的版本会放进“${folder}”` : ''}。`;
	},
	bothEditedWarning: (count, folder) => `其中 ${n(count)} 页在 Obsidian 中也已修改，你的版本同样会放进“${folder}”。`,
	noUpdates: '没有发现更新。',
	noUpdatesReconvert: '没有发现更新。点击分区可以按现在的设置重新转换。',
	startUpdate: '开始更新',

	sectionCount: (current, total) => `第 ${n(current)} / ${n(total)} 个分区`,
	elapsed: time => `已用 ${time}`,
	closeHint: '关闭窗口后，导入将在后台继续；点击右下角的进度可重新打开此窗口。',
	closeHintUpdate: '关闭窗口后，更新将在后台继续；点击右下角的进度可重新打开此窗口。',
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
	updateFinished: '更新完成',
	updateStopped: '更新已停止',
	updateFailed: '更新失败',
	updateSummary: (updated, added, reconverted, pagesAdded, pagesModified, pagesRestored) => {
		const sections = [updated ? `更新 ${n(updated)} 个分区` : '', added ? `新增 ${n(added)} 个分区` : '', reconverted ? `重新转换 ${n(reconverted)} 个分区` : ''].filter(Boolean).join('、');
		const pages = [pagesAdded ? `新增 ${n(pagesAdded)} 页` : '', pagesModified ? `修改 ${n(pagesModified)} 页` : ''].filter(Boolean).join('、');
		const restored = pagesRestored ? `补回 ${n(pagesRestored)} 页` : '';
		if (!sections) return restored ? `${restored}。` : '没有分区更新。';
		return `${sections}${pages ? `，共${pages}` : ''}${restored ? `，${restored}` : ''}。`;
	},
	alsoImported: summary => `新导入 ${summary}`,
	attnBothEdited: (count, folder) => `${n(count)} 页在 Obsidian 中也已修改，你的版本在“${folder}”中。`,
	attnKeptEdited: count => `${n(count)} 页在 Obsidian 中改过，保持原样，没有按新设置重写。`,
	attnRolledBack: count => `${n(count)} 个分区未能更新，已恢复原状。`,
	attnNotConverted: count => `${n(count)} 个分区无法读取，保持原样。`,
	attnNotUpdated: count => `${n(count)} 个分区所需的文件夹已被占用，保持原样。`,
	attnKeptAside: (count, folder) => `${n(count)} 个文件覆盖前已另存，删除“${folder}”前请先查看。`,
	attnLeftOut: count => `${n(count)} 个分区因中途停止而未更新，再次检查更新即可。`,
	openRecord: '打开更新记录',
	recordMissing: '找不到更新记录，可能已被移动或删除。',
	resumedNotice: 'OneNote Ferry：上次中断的更新已处理完毕，点击查看更新记录。',
	resumeFailed: error => `OneNote Ferry：上次中断的更新未能处理完毕：${error}`,
	alreadyRunning: '已经有一个导入正在进行。',
	alreadyInFolder: names => `目标文件夹里已经有：${names.join('、')}`,

	signInPageTitle: 'OneNote Ferry',
	signInPageDone: '登录成功，可以关闭此页面并返回 Obsidian。',
	signInPageFailed: '登录失败，请返回 Obsidian 重试。',

	chooseOneDrive: '从 OneDrive 导入',
	chooseOneDriveUpdate: '从 OneDrive 检查更新',
	oneDriveAddDesc: '登录微软账号后直接读取 OneDrive 上的笔记本',
	oneDriveAddDescSignedIn: '直接读取 OneDrive 上的笔记本',
	sourceZipsOrFolders: '从 OneDrive 网页上下载的 zip 文件或解压后的文件夹',
	sourceZips: '从 OneDrive 网页上下载的 zip 文件',
	sourceFolders: '从 OneDrive 网页上下载并解压的文件夹',
	sourceExports: '用 Windows 版 OneNote 导出的笔记本（.onepkg）或分区（.one）',
	oneDrive: 'OneDrive',
	oneDriveReading: '正在读取 OneDrive 上的笔记本...',
	otherFolder: '在其他文件夹里找',
	signInWaiting: '请在浏览器中登录微软账号。工作或学校账号可能需要管理员批准。',
	cancelSignIn: '取消',
	signInProblems: {
		cancelled: '登录已取消。',
		'needs-admin': '需要管理员批准后才能登录。',
		'signed-out': '登录已失效，请重新登录。',
		'app-unavailable': '暂时无法登录，请稍后重试。',
		unreachable: '无法连接到微软，请检查网络后重试。',
		'timed-out': '登录超时，请重试。',
		failed: '登录失败。',
	},
	downloadingFiles: (files, total, size, totalSize) => `正在从 OneDrive 下载：${n(files)}/${n(total)} 个文件，${size} / ${totalSize}`,
	statusDownloading: (current, total) => `正在下载 ${n(current)}/${n(total)}`,
	oneDriveFinding: '正在查找 OneDrive 上的笔记本...',
	oneDriveRefreshing: '正在读取 OneDrive 上的最新清单...',
	oneDriveReadingCount: (done, total) => `正在读取 OneDrive：${n(done)}/${n(total)} 本笔记本`,
	oneDriveTreeWaiting: '读取完成后，OneDrive 上的笔记本将在此列出。',
	retry: '重试',
	reopenSignIn: '重新打开登录页',
	folderPickerTitle: '在其他文件夹里找笔记本',
	pickerHint: '点开文件夹，勾选要加入的笔记本。',
	pickerChosen: count => `已勾选 ${n(count)} 本笔记本`,
	addNotebooks: '加入',
	alreadyListed: '已在列表中',
	folderEmpty: '这里没有文件夹或笔记本。',
	leftOutNotDownloaded: count => `${n(count)} 个分区未能从 OneDrive 下载，未导入。`,
	downloadsKept: '已下载的部分已保留，再次导入时将继续下载。',
	copyBusy: '另一个窗口正在从 OneDrive 下载，请稍后再试。',
	noSpace: size => `磁盘空间不足，下载需要 ${size}。`,

	settingsOneDrive: 'OneDrive',
	settingsAccount: '微软账号',
	accountPersonal: '已用个人账号登录。',
	accountOrganization: '已用工作或学校账号登录。',
	accountNone: '未登录。登录后可直接从 OneDrive 导入笔记本。',
	accountRevoke: { before: '如需撤销授权，请前往 ', link: 'Microsoft 账户的应用权限页面', after: '。' },
	settingsCopy: '下载缓存',
	copyDesc: (size, path) => `从 OneDrive 下载的原始文件，用于检查更新时只下载有变化的部分。当前占用 ${size}，位于 ${path}。`,
	copyNone: '从 OneDrive 下载的原始文件，用于检查更新时只下载有变化的部分。目前为空。',
	deleteCopy: '清除',
	deleteCopyTitle: '清除下载缓存',
	deleteCopyConfirm: size => `清除 ${size} 的下载缓存？仓库里的笔记不受影响，以后需要时会重新下载。`,
	signIn: '登录',
	signOut: '退出登录',
	cancel: '取消',
};

const ja: UiStrings = {
	commandImport: 'OneNote のノートをインポート',
	commandUpdate: 'OneNote の更新を確認',
	commandStop: '現在のセクションが終わったら OneNote のインポートまたは更新を停止',

	statusReading: 'OneNote のファイルを読み込み中...',
	statusImporting: (current, total) => `OneNote をインポート中 ${n(current)}/${n(total)}`,
	statusUpdating: (current, total) => `OneNote を更新中 ${n(current)}/${n(total)}`,
	statusTooltip: 'クリックするとインポート画面を開きます',

	settingsImport: 'ノートブックをインポート',
	settingsImportDesc: 'OneDrive にある OneNote のノートブックを、この保管庫のノートに変換します。',
	startImport: 'インポートを開始',
	settingsDefaults: '新しいインポートの既定値',
	folder: 'フォルダー',
	folderDesc: 'インポートしたノートはこのフォルダーに保存され、ノートブックとセクションごとにサブフォルダーが作られます。',
	vaultTop: '保管庫の一番上',
	badFolder: 'フォルダー名をドットで始めることはできません。',
	boxMarkers: 'テキストボックスの位置',
	boxMarkersDesc: '段組みのページは、インポートするとテキストボックスが順に一列に並びます。オンにすると、各テキストボックスの前に元のページでの位置を記した非表示のコメントを入れます。',
	altText: '画像の代替テキスト',
	altTextDesc: '元のノートにある画像の代替テキストを残し、画像の下に折りたたんで書きます。',

	wizardTitle: 'OneNote のノートをインポート',
	chooseBoth: 'ファイルまたはフォルダーを選択',
	chooseZips: 'ファイルを選択',
	chooseFolders: 'フォルダーを選択',
	dialogTitle: 'OneDrive からダウンロードした zip ファイルかフォルダー、または Windows 版 OneNote でエクスポートしたファイルを選ぶ',
	dialogTitleZips: 'OneDrive からダウンロードした zip ファイル、または Windows 版 OneNote でエクスポートしたファイルを選ぶ',
	dialogTitleFolders: 'OneDrive からダウンロードしたフォルダーを選ぶ',
	dialogUnavailable: error => `ファイルを選ぶ画面を開けません：${error}`,
	reading: '読み込み中...',
	notebooksFound: count => `ノートブック ${n(count)} 冊`,
	noNotebooks: 'ここに OneNote のノートブックはありません。',
	cannotRead: error => `読み込めません：${error}`,
	converterStopped: '変換処理が予期せず停止しました',
	incompleteZip: 'ダウンロードが不完全なため、含まれている部分だけをインポートできます。すべてをインポートするには、もう一度ダウンロードしてください。',
	remove: 'リストから削除',
	tree: 'ノートブックとセクション',
	treeEmpty: 'どこからインポートするかを選ぶと、ここにノートブックとセクションが並びます。',
	noSections: 'セクションなし',
	selectAll: 'すべて選択',
	deselectAll: 'すべて選択解除',
	locked: 'パスワード保護',
	incomplete: '不完全',
	folderTaken: '同じ名前のフォルダーがあります',
	folderSpelling: '大文字と小文字だけが違う同じ名前のフォルダーがあります',
	settings: '設定',
	importInto: 'インポート先',
	importIntoDesc: 'インポートしたノートはこのフォルダーに保存され、ノートブックとセクションごとにサブフォルダーが作られます。',
	language: '目次と注記の言語',
	languageDesc: 'インポートで作る目次、注記、フォルダー名に使います。',
	checking: 'インポート先を確認中...',
	nothingChosen: 'チェックが入っていません。',
	nothingToImport: 'インポートできるセクションはありません。すべてインポート済みか、読み込めません。',
	allTaken: 'インポート先に同じ名前のフォルダーがすでにあり、OneNote Ferry でインポートしたものではありません。別のインポート先を選んでください。',
	noSectionsAnywhere: '選んだノートブックにはセクションがありません。',
	folderUnreadable: error => `インポート先を読み込めません：${error}`,
	reportMissing: 'レポートのファイルが見つかりません。移動または削除された可能性があります。',
	willImport: (notebooks, sections, size, unreadable) => `ノートブック ${n(notebooks)} 冊のセクション ${n(sections)} 個${unreadable ? `（うち ${n(unreadable)} 個は読み込めません）` : ''}をインポートします。合計 ${size}。`,

	updateTitle: 'OneNote の更新を確認',
	ownSettingsKept: '更新のあるセクションは元の設定のままです。',
	reconvertMark: '変換し直す',
	reconvertTip: 'クリックすると、現在の設定で変換し直します',
	sectionsReconverting: count => `セクション ${n(count)} 個を変換し直し`,
	checkingRow: '確認中...',
	unchanged: '変更なし',
	changed: '更新あり',
	bothEditedIn: count => `うち ${n(count)} ページは Obsidian でも編集済み`,
	newSection: '新しいセクション',
	unfinished: '前回未完了',
	skipped: '前回未選択',
	missing: '保管庫にありません',
	missingTip: '以前インポートしたセクションで、チェックすると元の場所にもう一度インポートします',
	older: 'ダウンロードの方が古い',
	olderTip: folder => `ダウンロードのページは保管庫のものより古く、チェックするとダウンロードの内容に置き換え、今の版は「${folder}」に移します`,
	gone: 'ダウンロードにありません',
	keptAsIs: '保管庫のものはそのままです',
	restorable: count => `${n(count)} ページを戻せます`,
	restorableTip: 'Obsidian で削除したページで、チェックするとダウンロードから戻します',
	unreadable: '読み込めません',
	different: '同じ名前の別のノートブック',
	differentTip: '保管庫にある同じ名前のノートブックと共通のページがないため変更せず、別のインポート先を選ぶとインポートできます',
	duplicate: '新しいほうを使用',
	duplicateTip: '選んだ中にこのノートブックがもう一つあり、そちらのページのほうが新しいため、更新にはそちらを使います',
	notImported: '未インポート',
	sectionsChanged: count => `${n(count)} 個のセクションに更新あり`,
	partlyImported: '一部インポート済み',
	partlyImportedTip: skipped => `前回選択しなかったセクションが ${n(skipped)} 個あり、展開してチェックすると追加できます`,
	pageAdded: '追加',
	pageModified: '変更',
	pageRetitled: was => `元のタイトル「${was}」`,
	pageBothEdited: 'Obsidian でも編集済み',
	pageBothEditedTip: folder => `OneNote の新しい版に置き換え、あなたの版は「${folder}」に移します`,
	pageRemoved: 'OneNote にありません',
	pageDeleted: 'Obsidian で削除済み',
	pageDeletedTip: 'チェックすると戻します',
	pagesReordered: count => `${n(count)} ページは順序か階層だけが変わりました`,
	sectionWas: was => `元は「${was}」`,
	checkingUpdates: (done, total) => `更新を確認中 ${n(done)}/${n(total)}...`,
	willUpdate: (updated, added, restored, reconverted, folder) => {
		const parts = [updated ? `セクション ${n(updated)} 個を更新` : '', added ? `セクション ${n(added)} 個を追加` : '', reconverted ? `セクション ${n(reconverted)} 個を変換し直し` : '', restored ? `${n(restored)} ページを戻す` : ''].filter(Boolean);
		return `${parts.join('、')}予定です。${updated || reconverted ? `更新前の版は「${folder}」に移します。` : ''}`;
	},
	bothEditedWarning: (count, folder) => `うち ${n(count)} ページは Obsidian でも編集済みです。あなたの版も「${folder}」に移します。`,
	noUpdates: '更新はありません。',
	noUpdatesReconvert: '更新はありません。セクションをクリックすると、現在の設定で変換し直せます。',
	startUpdate: '更新を開始',

	sectionCount: (current, total) => `セクション ${n(current)} / ${n(total)}`,
	elapsed: time => `経過 ${time}`,
	closeHint: 'この画面を閉じても、インポートはバックグラウンドで続行されます。右下の進行状況をクリックすると、再び開けます。',
	closeHintUpdate: 'この画面を閉じても、更新はバックグラウンドで続行されます。右下の進行状況をクリックすると、再び開けます。',
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
	updateFinished: '更新完了',
	updateStopped: '更新を停止しました',
	updateFailed: '更新に失敗しました',
	updateSummary: (updated, added, reconverted, pagesAdded, pagesModified, pagesRestored) => {
		const sections = [updated ? `セクション ${n(updated)} 個を更新` : '', added ? `セクション ${n(added)} 個を追加` : '', reconverted ? `セクション ${n(reconverted)} 個を変換し直し` : ''].filter(Boolean).join('、');
		const pages = [pagesAdded ? `${n(pagesAdded)} ページ追加` : '', pagesModified ? `${n(pagesModified)} ページ変更` : '', pagesRestored ? `${n(pagesRestored)} ページ復元` : ''].filter(Boolean).join('、');
		if (!sections) return pagesRestored ? `${n(pagesRestored)} ページを戻しました。` : '更新したセクションはありません。';
		return `${sections}${pages ? `（${pages}）` : ''}。`;
	},
	alsoImported: summary => `新しくインポート：${summary}`,
	attnBothEdited: (count, folder) => `${n(count)} ページは Obsidian でも編集されていました。あなたの版は「${folder}」にあります。`,
	attnKeptEdited: count => `${n(count)} ページは Obsidian で編集されていたため、そのまま残しました（新しい設定では書き直していません）。`,
	attnRolledBack: count => `${n(count)} 個のセクションは更新できなかったため、元に戻しました。`,
	attnNotConverted: count => `${n(count)} 個のセクションは読み込めないため、そのままです。`,
	attnNotUpdated: count => `${n(count)} 個のセクションは必要なフォルダーにほかのものがあるため、そのままです。`,
	attnKeptAside: (count, folder) => `${n(count)} 個のファイルは上書きする前に別に保存しました。「${folder}」を削除する前に確認してください。`,
	attnLeftOut: count => `停止したため、${n(count)} 個のセクションは更新されていません。もう一度更新を確認すると続きを行います。`,
	openRecord: '更新記録を開く',
	recordMissing: '更新記録のファイルが見つかりません。移動または削除された可能性があります。',
	resumedNotice: 'OneNote Ferry：前回中断した更新の処理を終えました。クリックで更新記録を表示します。',
	resumeFailed: error => `OneNote Ferry：前回中断した更新の処理を終えられませんでした：${error}`,
	alreadyRunning: 'インポートはすでに実行中です。',
	alreadyInFolder: names => `インポート先にすでにあります：${names.join('、')}`,

	signInPageTitle: 'OneNote Ferry',
	signInPageDone: 'サインインしました。このページを閉じて Obsidian に戻ってください。',
	signInPageFailed: 'サインインできませんでした。Obsidian に戻ってもう一度お試しください。',

	chooseOneDrive: 'OneDrive からインポート',
	chooseOneDriveUpdate: 'OneDrive で更新を確認',
	oneDriveAddDesc: 'Microsoft アカウントにサインインして、OneDrive のノートブックを直接読み込みます',
	oneDriveAddDescSignedIn: 'OneDrive のノートブックを直接読み込みます',
	sourceZipsOrFolders: 'OneDrive の Web サイトでダウンロードした zip ファイルまたは展開したフォルダー',
	sourceZips: 'OneDrive の Web サイトでダウンロードした zip ファイル',
	sourceFolders: 'OneDrive の Web サイトでダウンロードして展開したフォルダー',
	sourceExports: 'Windows 版 OneNote でエクスポートしたノートブック（.onepkg）またはセクション（.one）',
	oneDrive: 'OneDrive',
	oneDriveReading: 'OneDrive のノートブックを読み込んでいます...',
	otherFolder: 'ほかのフォルダーを探す',
	signInWaiting: 'ブラウザーで Microsoft アカウントにサインインしてください。職場または学校のアカウントは、管理者の承認が必要な場合があります。',
	cancelSignIn: 'キャンセル',
	signInProblems: {
		cancelled: 'サインインはキャンセルされました。',
		'needs-admin': 'サインインには管理者の承認が必要です。',
		'signed-out': 'サインインが無効になりました。もう一度サインインしてください。',
		'app-unavailable': '現在サインインできません。しばらくしてからもう一度お試しください。',
		unreachable: 'Microsoft に接続できません。ネットワークを確認してからお試しください。',
		'timed-out': 'サインインがタイムアウトしました。もう一度お試しください。',
		failed: 'サインインできませんでした。',
	},
	downloadingFiles: (files, total, size, totalSize) => `OneDrive からダウンロード中：${n(files)}/${n(total)} ファイル、${size} / ${totalSize}`,
	statusDownloading: (current, total) => `ダウンロード中 ${n(current)}/${n(total)}`,
	oneDriveFinding: 'OneDrive でノートブックを探しています...',
	oneDriveRefreshing: 'OneDrive から最新の一覧を取得しています...',
	oneDriveReadingCount: (done, total) => `OneDrive を読み込み中：ノートブック ${n(done)}/${n(total)} 冊`,
	oneDriveTreeWaiting: 'OneDrive のノートブックは、読み込みが終わるとここに並びます。',
	retry: '再試行',
	reopenSignIn: 'サインインページをもう一度開く',
	folderPickerTitle: 'ほかのフォルダーのノートブックを探す',
	pickerHint: 'フォルダーを開いて、加えるノートブックにチェックを入れてください。',
	pickerChosen: count => `ノートブック ${n(count)} 冊を選択`,
	addNotebooks: '追加',
	alreadyListed: '一覧にあります',
	folderEmpty: 'フォルダーもノートブックもありません。',
	leftOutNotDownloaded: count => `セクション ${n(count)} 個を OneDrive からダウンロードできず、インポートしませんでした。`,
	downloadsKept: 'ダウンロード済みの分は残してあり、もう一度インポートすると続きからダウンロードします。',
	copyBusy: '別のウィンドウが OneDrive からダウンロード中です。しばらくしてからお試しください。',
	noSpace: size => `ディスクの空きが足りません。ダウンロードに ${size} 必要です。`,

	settingsOneDrive: 'OneDrive',
	settingsAccount: 'Microsoft アカウント',
	accountPersonal: '個人アカウントでサインインしています。',
	accountOrganization: '職場または学校のアカウントでサインインしています。',
	accountNone: 'サインインしていません。サインインすると、OneDrive から直接ノートブックをインポートできます。',
	accountRevoke: { before: 'アクセス許可を取り消すには、', link: 'Microsoft アカウントのアプリのアクセス許可', after: 'を開いてください。' },
	settingsCopy: 'ダウンロードキャッシュ',
	copyDesc: (size, path) => `OneDrive からダウンロードした元のファイルで、更新の確認で変更された部分だけをダウンロードするために使います。現在 ${size}、場所は ${path} です。`,
	copyNone: 'OneDrive からダウンロードした元のファイルで、更新の確認で変更された部分だけをダウンロードするために使います。現在は空です。',
	deleteCopy: 'クリア',
	deleteCopyTitle: 'ダウンロードキャッシュをクリア',
	deleteCopyConfirm: size => `ダウンロードキャッシュ（${size}）をクリアしますか？保管庫のノートには影響しません。必要なときに再びダウンロードします。`,
	signIn: 'サインイン',
	signOut: 'サインアウト',
	cancel: 'キャンセル',
};

const ko: UiStrings = {
	commandImport: 'OneNote 노트 가져오기',
	commandUpdate: 'OneNote 업데이트 확인',
	commandStop: '현재 섹션을 마친 뒤 OneNote 가져오기 또는 업데이트 중지',

	statusReading: 'OneNote 파일을 읽는 중...',
	statusImporting: (current, total) => `OneNote 가져오는 중 ${n(current)}/${n(total)}`,
	statusUpdating: (current, total) => `OneNote 업데이트 중 ${n(current)}/${n(total)}`,
	statusTooltip: '클릭하면 가져오기 창이 열립니다',

	settingsImport: '전자 필기장 가져오기',
	settingsImportDesc: 'OneDrive에 있는 OneNote 전자 필기장을 이 보관함의 노트로 변환합니다.',
	startImport: '가져오기 시작',
	settingsDefaults: '새 가져오기의 기본값',
	folder: '폴더',
	folderDesc: '가져온 노트는 이 폴더에 저장되며, 전자 필기장과 섹션마다 하위 폴더가 만들어집니다.',
	vaultTop: '보관함 최상위 폴더',
	badFolder: '폴더 이름은 점으로 시작할 수 없습니다.',
	boxMarkers: '텍스트 상자 위치',
	boxMarkersDesc: '여러 열로 된 페이지는 가져오면 텍스트 상자가 위에서 아래로 차례로 놓입니다. 켜면 각 텍스트 상자 앞에 원래 페이지에서의 위치를 적은 숨은 주석을 넣습니다.',
	altText: '그림 대체 텍스트',
	altTextDesc: '원래 노트에 있는 그림 대체 텍스트를 유지해 그림 아래에 접힌 상태로 씁니다.',

	wizardTitle: 'OneNote 노트 가져오기',
	chooseBoth: '파일 또는 폴더 선택',
	chooseZips: '파일 선택',
	chooseFolders: '폴더 선택',
	dialogTitle: 'OneDrive에서 다운로드한 zip 파일이나 폴더, 또는 Windows용 OneNote에서 내보낸 파일 선택',
	dialogTitleZips: 'OneDrive에서 다운로드한 zip 파일, 또는 Windows용 OneNote에서 내보낸 파일 선택',
	dialogTitleFolders: 'OneDrive에서 다운로드한 폴더 선택',
	dialogUnavailable: error => `파일 선택 창을 열 수 없습니다: ${error}`,
	reading: '읽는 중...',
	notebooksFound: count => `전자 필기장 ${n(count)}개`,
	noNotebooks: '여기에는 OneNote 전자 필기장이 없습니다.',
	cannotRead: error => `읽을 수 없습니다: ${error}`,
	converterStopped: '변환이 예기치 않게 중지되었습니다',
	incompleteZip: '다운로드가 완전하지 않아 포함된 부분만 가져올 수 있습니다. 전부 가져오려면 다시 다운로드하세요.',
	remove: '제거',
	tree: '전자 필기장과 섹션',
	treeEmpty: '어디에서 가져올지 고르면 여기에 전자 필기장과 섹션이 나옵니다.',
	noSections: '섹션 없음',
	selectAll: '모두 선택',
	deselectAll: '모두 선택 해제',
	locked: '암호 보호',
	incomplete: '불완전',
	folderTaken: '같은 이름의 폴더가 있음',
	folderSpelling: '대소문자만 다른 같은 이름의 폴더가 있음',
	settings: '설정',
	importInto: '가져올 위치',
	importIntoDesc: '가져온 노트는 이 폴더에 저장되며, 전자 필기장과 섹션마다 하위 폴더가 만들어집니다.',
	language: '목차와 안내 문구의 언어',
	languageDesc: '가져올 때 만드는 목차, 안내 문구, 폴더 이름에 쓰입니다.',
	checking: '대상 폴더를 확인하는 중...',
	nothingChosen: '선택한 항목이 없습니다.',
	nothingToImport: '가져올 수 있는 섹션이 없습니다. 모두 이미 가져왔거나 읽을 수 없습니다.',
	allTaken: '대상 폴더에 같은 이름의 폴더가 이미 있으며, OneNote Ferry로 가져온 것이 아닙니다. 다른 대상 폴더를 선택하세요.',
	noSectionsAnywhere: '선택한 전자 필기장에 섹션이 없습니다.',
	folderUnreadable: error => `대상 폴더를 읽을 수 없습니다: ${error}`,
	reportMissing: '보고서 파일을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다.',
	willImport: (notebooks, sections, size, unreadable) => `전자 필기장 ${n(notebooks)}개의 섹션 ${n(sections)}개${unreadable ? `(그중 ${n(unreadable)}개는 읽을 수 없음)` : ''}를 가져옵니다. 모두 ${size}.`,

	updateTitle: 'OneNote 업데이트 확인',
	ownSettingsKept: '업데이트가 있는 섹션은 원래 설정을 그대로 씁니다.',
	reconvertMark: '다시 변환',
	reconvertTip: '클릭하면 현재 설정으로 다시 변환합니다',
	sectionsReconverting: count => `섹션 ${n(count)}개 다시 변환`,
	checkingRow: '확인 중...',
	unchanged: '변경 없음',
	changed: '업데이트 있음',
	bothEditedIn: count => `그중 ${n(count)}페이지는 Obsidian에서도 수정됨`,
	newSection: '새 섹션',
	unfinished: '지난번 미완료',
	skipped: '지난번 선택 안 함',
	missing: '보관함에 없음',
	missingTip: '이전에 가져온 섹션으로, 선택하면 원래 위치로 다시 가져옵니다',
	older: '다운로드가 더 오래됨',
	olderTip: folder => `다운로드의 페이지가 보관함의 페이지보다 오래되었으며, 선택하면 다운로드의 내용으로 바꾸고 지금 버전은 "${folder}"(으)로 옮깁니다`,
	gone: '다운로드에 없음',
	keptAsIs: '보관함의 내용은 그대로 둡니다',
	restorable: count => `${n(count)}페이지 복원 가능`,
	restorableTip: 'Obsidian에서 삭제한 페이지로, 선택하면 다운로드에서 복원합니다',
	unreadable: '읽을 수 없음',
	different: '이름만 같은 다른 전자 필기장',
	differentTip: '보관함에 있는 같은 이름의 전자 필기장과 공통된 페이지가 없어 바꾸지 않으며, 다른 대상 폴더를 선택하면 가져올 수 있습니다',
	duplicate: '더 새로운 사본 사용',
	duplicateTip: '고른 곳에 이 전자 필기장이 하나 더 있고 그쪽 페이지가 더 새로워, 업데이트에는 그쪽을 씁니다',
	notImported: '가져오지 않음',
	sectionsChanged: count => `섹션 ${n(count)}개 업데이트 있음`,
	partlyImported: '일부만 가져옴',
	partlyImportedTip: skipped => `지난번에 선택하지 않은 섹션이 ${n(skipped)}개 있으며, 펼쳐서 선택하면 추가할 수 있습니다`,
	pageAdded: '추가',
	pageModified: '수정',
	pageRetitled: was => `원래 제목 "${was}"`,
	pageBothEdited: 'Obsidian에서도 수정됨',
	pageBothEditedTip: folder => `OneNote의 새 버전으로 바꾸고, 사용자의 버전은 "${folder}"(으)로 옮깁니다`,
	pageRemoved: 'OneNote에 없음',
	pageDeleted: 'Obsidian에서 삭제됨',
	pageDeletedTip: '선택하면 복원합니다',
	pagesReordered: count => `${n(count)}페이지는 순서나 수준만 바뀜`,
	sectionWas: was => `원래 "${was}"`,
	checkingUpdates: (done, total) => `업데이트 확인 중 ${n(done)}/${n(total)}...`,
	willUpdate: (updated, added, restored, reconverted, folder) => {
		const parts = [updated ? `섹션 ${n(updated)}개 업데이트` : '', added ? `섹션 ${n(added)}개 추가` : '', reconverted ? `섹션 ${n(reconverted)}개 다시 변환` : '', restored ? `${n(restored)}페이지 복원` : ''].filter(Boolean);
		return `${parts.join(', ')} 예정입니다.${updated || reconverted ? ` 업데이트 전 버전은 "${folder}"(으)로 옮깁니다.` : ''}`;
	},
	bothEditedWarning: (count, folder) => `그중 ${n(count)}페이지는 Obsidian에서도 수정되었습니다. 사용자의 버전도 "${folder}"(으)로 옮깁니다.`,
	noUpdates: '업데이트가 없습니다.',
	noUpdatesReconvert: '업데이트가 없습니다. 섹션을 클릭하면 현재 설정으로 다시 변환할 수 있습니다.',
	startUpdate: '업데이트 시작',

	sectionCount: (current, total) => `섹션 ${n(current)} / ${n(total)}`,
	elapsed: time => `경과 ${time}`,
	closeHint: '창을 닫아도 가져오기는 백그라운드에서 계속됩니다. 오른쪽 아래의 진행 상황을 클릭하면 다시 열 수 있습니다.',
	closeHintUpdate: '창을 닫아도 업데이트는 백그라운드에서 계속됩니다. 오른쪽 아래의 진행 상황을 클릭하면 다시 열 수 있습니다.',
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
	updateFinished: '업데이트 완료',
	updateStopped: '업데이트 중지됨',
	updateFailed: '업데이트 실패',
	updateSummary: (updated, added, reconverted, pagesAdded, pagesModified, pagesRestored) => {
		const sections = [updated ? `섹션 ${n(updated)}개 업데이트` : '', added ? `섹션 ${n(added)}개 추가` : '', reconverted ? `섹션 ${n(reconverted)}개 다시 변환` : ''].filter(Boolean).join(', ');
		const pages = [pagesAdded ? `${n(pagesAdded)}페이지 추가` : '', pagesModified ? `${n(pagesModified)}페이지 수정` : '', pagesRestored ? `${n(pagesRestored)}페이지 복원` : ''].filter(Boolean).join(', ');
		if (!sections) return pagesRestored ? `${n(pagesRestored)}페이지를 복원했습니다.` : '업데이트한 섹션이 없습니다.';
		return `${sections}${pages ? ` (${pages})` : ''}.`;
	},
	alsoImported: summary => `새로 가져옴: ${summary}`,
	attnBothEdited: (count, folder) => `${n(count)}페이지는 Obsidian에서도 수정되어 있었습니다. 사용자의 버전은 "${folder}"에 있습니다.`,
	attnKeptEdited: count => `${n(count)}페이지는 Obsidian에서 수정되어 그대로 두었습니다(새 설정으로 다시 쓰지 않음).`,
	attnRolledBack: count => `섹션 ${n(count)}개를 업데이트하지 못해 원래대로 되돌렸습니다.`,
	attnNotConverted: count => `섹션 ${n(count)}개는 읽을 수 없어 그대로 두었습니다.`,
	attnNotUpdated: count => `섹션 ${n(count)}개는 필요한 폴더에 다른 것이 있어 그대로 두었습니다.`,
	attnKeptAside: (count, folder) => `파일 ${n(count)}개를 덮어쓰기 전에 따로 저장했습니다. "${folder}"을(를) 삭제하기 전에 확인하세요.`,
	attnLeftOut: count => `중지해서 섹션 ${n(count)}개는 업데이트되지 않았습니다. 업데이트를 다시 확인하면 이어서 합니다.`,
	openRecord: '업데이트 기록 열기',
	recordMissing: '업데이트 기록 파일을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다.',
	resumedNotice: 'OneNote Ferry: 지난번 중단된 업데이트를 마무리했습니다. 클릭하면 업데이트 기록을 봅니다.',
	resumeFailed: error => `OneNote Ferry: 지난번 중단된 업데이트를 마무리하지 못했습니다: ${error}`,
	alreadyRunning: '가져오기가 이미 진행 중입니다.',
	alreadyInFolder: names => `대상 폴더에 이미 있습니다: ${names.join(', ')}`,

	signInPageTitle: 'OneNote Ferry',
	signInPageDone: '로그인했습니다. 이 페이지를 닫고 Obsidian으로 돌아가세요.',
	signInPageFailed: '로그인하지 못했습니다. Obsidian으로 돌아가 다시 시도하세요.',

	chooseOneDrive: 'OneDrive에서 가져오기',
	chooseOneDriveUpdate: 'OneDrive에서 업데이트 확인',
	oneDriveAddDesc: 'Microsoft 계정에 로그인해 OneDrive의 전자 필기장을 바로 읽습니다',
	oneDriveAddDescSignedIn: 'OneDrive의 전자 필기장을 바로 읽습니다',
	sourceZipsOrFolders: 'OneDrive 웹사이트에서 다운로드한 zip 파일 또는 압축을 푼 폴더',
	sourceZips: 'OneDrive 웹사이트에서 다운로드한 zip 파일',
	sourceFolders: 'OneDrive 웹사이트에서 다운로드해 압축을 푼 폴더',
	sourceExports: 'Windows용 OneNote에서 내보낸 전자 필기장(.onepkg) 또는 섹션(.one)',
	oneDrive: 'OneDrive',
	oneDriveReading: 'OneDrive의 전자 필기장을 읽는 중...',
	otherFolder: '다른 폴더에서 찾기',
	signInWaiting: '브라우저에서 Microsoft 계정에 로그인하세요. 회사 또는 학교 계정은 관리자의 승인이 필요할 수 있습니다.',
	cancelSignIn: '취소',
	signInProblems: {
		cancelled: '로그인을 취소했습니다.',
		'needs-admin': '로그인하려면 관리자의 승인이 필요합니다.',
		'signed-out': '로그인이 더 이상 유효하지 않습니다. 다시 로그인하세요.',
		'app-unavailable': '지금은 로그인할 수 없습니다. 잠시 후 다시 시도하세요.',
		unreachable: 'Microsoft에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도하세요.',
		'timed-out': '로그인 시간이 초과되었습니다. 다시 시도하세요.',
		failed: '로그인하지 못했습니다.',
	},
	downloadingFiles: (files, total, size, totalSize) => `OneDrive에서 다운로드 중: 파일 ${n(files)}/${n(total)}개, ${size} / ${totalSize}`,
	statusDownloading: (current, total) => `다운로드 중 ${n(current)}/${n(total)}`,
	oneDriveFinding: 'OneDrive에서 전자 필기장을 찾는 중...',
	oneDriveRefreshing: 'OneDrive에서 최신 목록을 받는 중...',
	oneDriveReadingCount: (done, total) => `OneDrive 읽는 중: 전자 필기장 ${n(done)}/${n(total)}개`,
	oneDriveTreeWaiting: '읽기가 끝나면 OneDrive의 전자 필기장이 여기에 표시됩니다.',
	retry: '다시 시도',
	reopenSignIn: '로그인 페이지 다시 열기',
	folderPickerTitle: '다른 폴더에서 전자 필기장 찾기',
	pickerHint: '폴더를 열고 추가할 전자 필기장에 체크하세요.',
	pickerChosen: count => `전자 필기장 ${n(count)}개 선택`,
	addNotebooks: '추가',
	alreadyListed: '이미 목록에 있음',
	folderEmpty: '폴더나 전자 필기장이 없습니다.',
	leftOutNotDownloaded: count => `섹션 ${n(count)}개를 OneDrive에서 다운로드하지 못해 가져오지 않았습니다.`,
	downloadsKept: '이미 다운로드한 부분은 남겨 두었으며, 다시 가져오면 이어서 다운로드합니다.',
	copyBusy: '다른 창에서 OneDrive를 다운로드하는 중입니다. 잠시 후 다시 시도하세요.',
	noSpace: size => `디스크 공간이 부족합니다. 다운로드에 ${size}가 필요합니다.`,

	settingsOneDrive: 'OneDrive',
	settingsAccount: 'Microsoft 계정',
	accountPersonal: '개인 계정으로 로그인했습니다.',
	accountOrganization: '회사 또는 학교 계정으로 로그인했습니다.',
	accountNone: '로그인하지 않았습니다. 로그인하면 OneDrive에서 바로 전자 필기장을 가져올 수 있습니다.',
	accountRevoke: { before: ' 접근 권한을 취소하려면 ', link: 'Microsoft 계정의 앱 권한 페이지', after: '로 이동하세요.' },
	settingsCopy: '다운로드 캐시',
	copyDesc: (size, path) => `OneDrive에서 다운로드한 원본 파일로, 업데이트를 확인할 때 바뀐 부분만 다운로드하는 데 쓰입니다. 현재 ${size}, 위치는 ${path}입니다.`,
	copyNone: 'OneDrive에서 다운로드한 원본 파일로, 업데이트를 확인할 때 바뀐 부분만 다운로드하는 데 쓰입니다. 현재 비어 있습니다.',
	deleteCopy: '지우기',
	deleteCopyTitle: '다운로드 캐시 지우기',
	deleteCopyConfirm: size => `다운로드 캐시(${size})를 지울까요? 보관함의 노트에는 영향이 없으며, 필요할 때 다시 다운로드합니다.`,
	signIn: '로그인',
	signOut: '로그아웃',
	cancel: '취소',
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
