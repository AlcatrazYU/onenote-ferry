# OneNote Ferry

English | [中文](#中文) | [日本語](#日本語) | [한국어](#한국어)

Ferry your OneNote notebooks into Obsidian, with highlights, layout order, links and original attachments intact, and keep them up to date.

> **Status: in development, not released yet.** Importing, straight from OneDrive or from a downloaded folder, and checking for updates work, and are tested on macOS with a personal Microsoft account on the maintainer's own notebooks. Windows OneNote exports and a few more improvements are still to come before the first release.

## What It Is For

OneNote Ferry is an Obsidian community plugin (with a command line version) for people who keep their OneNote notebooks on a personal OneDrive and want a faithful Markdown copy in Obsidian, including Mac users, whose OneNote only exports PDF.

It reads the original notebook files, either straight from your OneDrive once you sign in to your Microsoft account, or from the folder that holds your notebooks, downloaded from the OneDrive website (the zip, or the folder after unzipping). It converts them into an organized Markdown folder:

- text formatting, highlights (with their colors), web links, math as LaTeX
- links between notes, rewritten as links inside your vault
- original images and attachments, unchanged; printouts shown as the original PDF
- handwriting, drawn as a picture where it was written
- page hierarchy, with a contents page for each notebook and section
- a reading order for free-floating text boxes
- a report of what was converted, and of anything that could not be

## Importing

The import window lists your notebooks and their sections, and you tick the ones you want. The notebooks can come from OneDrive or from a download.

**From OneDrive**

1. In Obsidian, click the paper boat icon in the left ribbon, or run `Import OneNote notes` from the command palette.
2. Choose `Import from OneDrive`, and sign in to your Microsoft account in the browser that opens.
3. Your notebooks are listed with their sections. Nothing is downloaded and nothing is ticked yet: tick the notebooks and sections you want. A notebook missing from the list can be added with `Look in another folder` (the folder icon on the OneDrive row).
4. Click `Start import`. Only the sections you ticked are downloaded, then imported. You can close the window: the import goes on, with its progress in the status bar.
5. When it ends, open the report it wrote.

**From a download**

1. On the OneDrive website, download the folder that holds your notebooks.
2. Open the import window as above, and choose `Choose zip files or folders`.
3. Tick the notebooks and sections you want, and click `Start import`.

When the target folder already holds some of these notebooks, the sections you tick are added to them, and a notebook imported only in part is marked `Partly imported`. The settings in the window apply to the sections imported now, except the language of contents pages and notices, which stays the notebook's.

## Checking for Updates

If you keep using OneNote, run `Check for OneNote updates` from the command palette.

- With OneDrive, choose `Check OneDrive for updates`. Each notebook imported before is first brought up to date in the plugin's downloaded copy, which downloads only the files that changed in OneDrive.
- With downloads, download the folder again and choose it (choosing a new download in the import window works too).

Each notebook imported before is then compared with your vault, section by section. Sections that changed, are new, or were cut off last time are ticked; a changed section opens to show its pages.

- Only the pages OneNote changed are replaced. Before a page is replaced, the vault's copy goes to `_previous versions/<time>/`. Pages OneNote did not change are not touched, so bookmarks, canvases and open tabs stay on them.
- A page changed in OneNote and also edited in Obsidian: the new version goes in, your version is kept in `_previous versions`, and both the window and the log point it out.
- To convert sections again with other settings, change the settings in the window, then click a section marked `No changes`, or its notebook, or `Select all` when nothing has updates: it shows `Convert again`. Its pages are written anew and the old ones go to `_previous versions`; pages you edited in Obsidian stay as they are. A section updated because OneNote changed it keeps its own settings.
- Nothing is ever deleted. Pages and sections OneNote no longer has stay where they are. Pages you deleted in Obsidian come back only if you tick them.
- Each update writes a page in `_sync log` that lists what changed. The `_conversion report` is the overview of every notebook in the folder; the two point to each other.
- Notebooks from OneDrive are recognized by their OneDrive ID, which each notebook's contents page keeps. A notebook renamed in OneNote is updated in place, and its folder takes the new name, unless you renamed the folder yourself or another folder has that name. A folder you renamed in Obsidian is still found. A copy of a notebook counts as a notebook of its own.
- If Obsidian quits during an update, the update is finished the next time Obsidian starts: each section ends up all old or all new.

## Microsoft Account and OneDrive

Importing from OneDrive is optional: importing a download needs no account and works offline.

- **Signing in.** You sign in on Microsoft's own page, in your browser, so the plugin never sees your password. Microsoft sends the answer back to a one-time address on your own computer (127.0.0.1).
- **Permissions.** The plugin asks to read your files (`Files.Read`), to stay signed in (`offline_access`), and for your basic sign-in profile (`openid`, `profile`), which tells a personal account from a work or school one. It cannot change or delete anything in your OneDrive. A sign-in page in the plugin's name that asks for more is not this plugin's.
- **Network.** The plugin connects only to Microsoft: its sign-in service, Microsoft Graph (`graph.microsoft.com`) to list notebooks and files, and Microsoft's file servers to download them. Your notes go straight from Microsoft to your computer. There is no other server and no telemetry, and nothing is uploaded.
- **Staying signed in.** The sign-in is kept in Obsidian's secret storage, not in the plugin's settings file. `Sign out` in the plugin's settings forgets it on this device. To withdraw the plugin's access altogether, go to account.live.com/consent/Manage for a personal account, or myapps.microsoft.com for a work or school account.
- **Download cache.** Notebooks downloaded from OneDrive are kept outside your vault, in your system's cache folder (on macOS, `~/Library/Caches/onenote-ferry/onedrive`), so that later only changes are downloaded. Checking a notebook for updates keeps the whole notebook there. The plugin checks for free disk space before downloading. Under `Download cache`, the plugin's settings show its size and location and can clear it; your notes in the vault stay.
- OneNote Ferry is an independent project, not made or endorsed by Microsoft. OneNote and OneDrive are trademarks of Microsoft.

## Privacy and Safety

Your OneNote files are only read, never modified: in OneDrive, the plugin only has permission to read. Conversion runs entirely on your own computer, and nothing is uploaded. The plugin writes only inside the folder you choose and its own downloaded copy, and never deletes anything in your vault.

## Limits

- Developed and tested on macOS with a personal Microsoft account. Windows and Linux are not verified yet. Work or school accounts are not verified either, and an organization may require its administrator to approve the plugin before you can sign in. Accounts in the Microsoft 365 operated by 21Vianet in China are not supported.
- Only notebooks in your own OneDrive are listed, not notebooks others share with you.
- A downloaded zip carries no notebook IDs, so notebooks from downloads are recognized by name: a notebook renamed in OneDrive, or whose folder you renamed in Obsidian, is taken for a new one; of two notebooks with the same name, the second is imported as `Name (2)`, and only the first is checked for updates.
- Password-protected sections cannot be read: remove the password in OneNote, then import or check for updates again. From OneDrive, a password only shows once the section is downloaded, so such a section can be ticked, downloaded, and then reported as not converted.
- The OneDrive website downloads the folder that holds your notebooks, not a single notebook.
- The free layout of a page (fonts, sizes, exact positions) is not reproduced. Text boxes are put in reading order, with an optional comment giving each one's position.
- Sections are sorted by name, because OneDrive's files do not record their order.
- A page moved to another section in OneNote ends up twice: in its old section, listed under `Pages no longer in OneNote`, and in the new one.
- A notebook keeps the language of its contents pages and notices. To change it, move the notebook's folder out of the target folder, then import the notebook again.

## Languages

The interface follows Obsidian's language: English, Chinese, Japanese or Korean. The contents pages, notices and folder names written into your notes can be in English, Simplified Chinese, Traditional Chinese, Japanese or Korean.

## Development

```bash
npm install
npm run build:parser
npm test
node scripts/build-plugin.mjs --install "<your vault>/.obsidian/plugins/onenote-ferry"
```

`npm run build:parser` needs Rust and wasm-pack. The command line version converts a download with `node src/cli/main.ts <download> <output folder>`, and `node src/cli/main.ts sync <download> <output folder>` lists what an update would change (add `--apply` to update). It reads downloads only, and does not sign in to OneDrive.

The full scope is described in [docs/requirements.md](docs/requirements.md) (in Chinese).

## License

MIT. See [LICENSE](LICENSE). OneNote Ferry includes code adapted from Joplin (MPL-2.0) and Obsidian Importer (MIT); see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## 中文

把 OneNote 笔记本摆渡到 Obsidian：高亮、版面顺序、链接和原始附件都保留，以后还能检查更新。

> **状态：开发中，还没有发布。** 导入（直接从 OneDrive，或从下载的文件夹）和检查更新已经可以用，在 macOS 上用个人微软账号和维护者自己的笔记本测试过。第一个公开版本之前，还要支持 Windows 版 OneNote 的导出文件，并做几处改进。

### 用途

OneNote Ferry（OneNote 摆渡）是一个 Obsidian 社区插件（附命令行版），面向笔记本存在个人 OneDrive 上、想在 Obsidian 里得到高还原 Markdown 的人，包括 OneNote 只能导出 PDF 的 Mac 用户。

它读取原始笔记文件：登录微软账号后直接从你的 OneDrive 读取，或者读取在 OneDrive 网页上下载的、装着笔记本的文件夹（zip，或解压后的文件夹）。然后转成整理好的 Markdown 文件夹：

- 文字格式、高亮（保留颜色）、网页链接，数学公式转成 LaTeX
- 笔记间链接，改写为仓库内链接
- 原始图片和附件，不转码；打印页显示为原来的 PDF
- 手写，画成图片放在原来的位置
- 页面层级，每个笔记本和分区都有目录页
- 自由文本框排出阅读顺序
- 一份报告，写明转了什么、有什么没能转

### 导入

导入窗口会列出笔记本和分区，勾选要导入的即可。笔记本可以来自 OneDrive，也可以来自下载的文件夹。

**从 OneDrive**

1. 在 Obsidian 里点左侧功能区的纸船图标，或在命令面板里运行“导入 OneNote 笔记”。
2. 选“从 OneDrive 导入”，在打开的浏览器里登录微软账号。
3. 窗口列出你的笔记本和分区。这时什么都没下载，也什么都没勾：勾选要导入的笔记本和分区。列表里没有的笔记本，可以用“在其他文件夹里找”（OneDrive 那一行的文件夹图标）加进来。
4. 点“开始导入”。只下载勾上的分区，下载完就导入。可以关掉窗口，导入会继续，进度显示在状态栏。
5. 结束后打开它写的报告。

**从下载的文件夹**

1. 在 OneDrive 网页上下载装着笔记本的文件夹。
2. 照上面打开导入窗口，选“选择 zip 文件或文件夹”。
3. 勾选要导入的笔记本和分区，点“开始导入”。

目标文件夹里已经有其中的笔记本时，勾上的分区会补进原来的笔记本；只导入了一部分的笔记本标“部分导入”。窗口里的设置用于这次导入的分区；目录和提示的语言沿用笔记本原来的。

### 检查更新

如果还在继续用 OneNote，在命令面板里运行“检查 OneNote 更新”。

- 用 OneDrive：选“从 OneDrive 检查更新”。每本以前导入过的笔记本，先在插件下载的副本里更新到最新，只下载 OneDrive 上变了的文件。
- 用下载的文件夹：重新下载这个文件夹，选进来（在导入窗口里选进新的下载也一样）。

然后，以前导入过的笔记本会逐个分区和仓库比较；有更新、新分区、上次没写完的分区默认勾上，有更新的分区可以展开看每一页。

- 只换 OneNote 里改过的页面。换之前，仓库里那份先复制进 `_旧版本/<时间>/`。OneNote 里没改的页面一个字节不动，书签、白板、打开的标签页都留在原页面上。
- OneNote 里改了、你在 Obsidian 里也改过的页面：换成新版，你的版本留在 `_旧版本` 里，窗口和更新记录都会标出。
- 想按别的设置重新转换：在窗口里改好设置，再点标着“无变化”的分区、它的笔记本，或者在没有更新时点“全选”，它们会标成“重新转换”。分区的页面全部重写，旧的放进 `_旧版本`；你在 Obsidian 里改过的页面保持原样。因 OneNote 有更新而更新的分区沿用自己原来的设置。
- 任何东西都不删除。OneNote 里已经没有的页面和分区留在原处。你在 Obsidian 里删掉的页面，勾选了才会补回。
- 每次更新在 `_更新记录` 里写一页，列出改了什么。`_转换报告` 是整个文件夹所有笔记本的总览，两页开头互相指引。
- 从 OneDrive 来的笔记本按 OneDrive 的编号认，编号记在每本笔记本的目录页里。在 OneNote 里改了名的笔记本照常原地更新，文件夹也改成新名字（你自己改过文件夹名，或新名字已被别的文件夹占用时除外）；在 Obsidian 里改了文件夹名也认得出。复制出来的笔记本算另一本。
- 更新时退出了 Obsidian，下次打开时会自动处理完毕，每个分区要么全旧、要么全新。

### 微软账号与 OneDrive

从 OneDrive 导入是可选的：导入下载的文件夹不需要账号，也不用联网。

- **登录**：在你的浏览器里、微软自己的页面上登录，插件看不到你的密码。微软把结果送回你电脑上的一个一次性地址（127.0.0.1）。
- **权限**：插件请求读取你的文件（`Files.Read`）、保持登录（`offline_access`）和基本的登录资料（`openid`、`profile`，用来分辨个人账号和工作或学校账号）。它不能修改或删除 OneDrive 里的任何东西。以本插件名义请求更多权限的登录页，不是本插件的。
- **联网**：插件只连接微软：登录服务、Microsoft Graph（`graph.microsoft.com`，列出笔记本和文件）和微软的文件服务器（下载文件）。笔记从微软直接到你的电脑；没有别的服务器，没有遥测，不上传任何东西。
- **保持登录**：登录信息存在 Obsidian 的密钥存储里，不在插件的设置文件里。在插件设置里点“退出登录”，就会忘掉这台设备上的登录。要彻底收回插件的访问权限，个人账号去 account.live.com/consent/Manage，工作或学校账号去 myapps.microsoft.com。
- **下载缓存**：从 OneDrive 下载的笔记本放在仓库外面、系统的缓存文件夹里（macOS 上是 `~/Library/Caches/onenote-ferry/onedrive`），以后只需下载变化的部分。检查更新时，以前导入过的笔记本会在这里保存整本。下载前会检查剩余空间。插件设置里的“下载缓存”显示占用和位置，也可以清除；仓库里的笔记不受影响。
- OneNote Ferry 是独立项目，不是微软制作的，也没有得到微软认可。OneNote 和 OneDrive 是微软的商标。

### 隐私与安全

插件只读取 OneNote 文件，从不修改：在 OneDrive 上它只有读取权限。转换全部在你的电脑上完成，不上传任何东西。插件只写你选的文件夹和它自己的下载副本，从不删除仓库里的任何东西。

### 限制

- 在 macOS 和个人微软账号上开发和测试；Windows、Linux 还没有验证。工作或学校账号也没有验证，有的组织要管理员先批准这个插件才能登录。世纪互联运营的中国版 Microsoft 365 账号不支持。
- 只列出你自己 OneDrive 里的笔记本，不列出别人共享给你的。
- 下载的 zip 里没有笔记本编号，所以用下载的文件夹时按名字认：在 OneDrive 上改了名、或在 Obsidian 里改了文件夹名的笔记本，会被当成新笔记本；两本同名的笔记本，第二本导入为“名字 (2)”，检查更新时只看第一本。
- 设了密码的分区读不出：请在 OneNote 里取消密码，再导入或检查更新。从 OneDrive 导入时，分区下载后才能看出有没有密码，所以这样的分区可能被勾上、下载，然后在报告里列为没有转换。
- OneDrive 网页上只能下载装着笔记本的文件夹，不能单独下载一本笔记本。
- 不还原页面的自由版面（字体、字号、精确位置）。文本框排成阅读顺序，可选在每块前加一行注释写明它的位置。
- 分区按名称排序，因为 OneDrive 上的文件没有记下分区的顺序。
- 在 OneNote 里把页面挪到别的分区后，仓库里会有两份：旧分区里那份（列在“OneNote 中已移除的页面”下）和新分区里的。
- 笔记本的目录和提示的语言不能改。要换语言，把这本的文件夹移出目标文件夹，再重新导入。

### 语言

界面跟随 Obsidian 的语言：English、中文、日本語、한국어。写进笔记的目录页、提示和文件夹名可以用 English、简体中文、繁體中文、日本語、한국어。

### 开发

见上方英文部分的 Development。命令行版只读取下载的文件夹，不登录 OneDrive。完整的功能范围见 [docs/requirements.md](docs/requirements.md)。

### 许可

MIT，见 [LICENSE](LICENSE)。其中有改编自 Joplin（MPL-2.0）和 Obsidian Importer（MIT）的代码，见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

## 日本語

OneNote のノートブックを Obsidian へ運びます。ハイライト、レイアウトの順序、リンク、元の添付ファイルをそのまま残し、あとから更新を確認することもできます。

> **状況：開発中で、まだ公開していません。** インポート（OneDrive から直接、またはダウンロードしたフォルダーから）と更新の確認は動作し、macOS 上で個人の Microsoft アカウントとメンテナー自身のノートブックで試験しています。最初の公開版までに、Windows 版 OneNote のエクスポートファイルへの対応といくつかの改良を加える予定です。

### 目的

OneNote Ferry は、Obsidian コミュニティプラグイン（コマンドライン版つき）です。ノートブックを個人の OneDrive に保存していて、Obsidian で再現度の高い Markdown を得たい人、特に OneNote から PDF しか書き出せない Mac の利用者を想定しています。

元のノートファイルを、Microsoft アカウントにサインインして OneDrive から直接、または OneDrive の Web サイトでダウンロードした、ノートブックが入っているフォルダー（zip、または展開したフォルダー）から読み込みます。そして整理された Markdown フォルダーに変換します。

- 文字の書式、ハイライト（色つき）、Web リンク、数式（LaTeX に変換）
- ノート間リンク（保管庫内のリンクに書き換え）
- 元の画像と添付ファイル（変換なし）、印刷イメージは元の PDF として表示
- 手書き（書かれた位置に画像として配置）
- ページの階層、ノートブックとセクションごとの目次ページ
- 自由配置のテキストボックスを読む順に並べる
- 変換できたもの、できなかったものを記したレポート

### インポート

インポート画面にノートブックとセクションが一覧表示されるので、必要なものにチェックを入れます。ノートブックは OneDrive からでも、ダウンロードしたフォルダーからでも読み込めます。

**OneDrive から**

1. Obsidian の左のリボンにある紙の船のアイコンをクリックするか、コマンドパレットで「OneNote のノートをインポート」を実行します。
2. 「OneDrive からインポート」を選び、開いたブラウザーで Microsoft アカウントにサインインします。
3. ノートブックとセクションが一覧表示されます。この時点では何もダウンロードされておらず、何もチェックされていません。インポートするノートブックとセクションにチェックを入れます。一覧にないノートブックは「ほかのフォルダーを探す」（OneDrive の行にあるフォルダーのアイコン）で追加できます。
4. 「インポートを開始」をクリックします。チェックを入れたセクションだけをダウンロードし、インポートします。画面を閉じてもインポートは続き、進行状況はステータスバーに表示されます。
5. 終わったら、作成されたレポートを開きます。

**ダウンロードしたフォルダーから**

1. OneDrive の Web サイトで、ノートブックが入っているフォルダーをダウンロードします。
2. 上と同じようにインポート画面を開き、「zip ファイルまたはフォルダーを選択」を選びます。
3. インポートするノートブックとセクションにチェックを入れ、「インポートを開始」をクリックします。

保存先のフォルダーにすでにその中のノートブックがある場合は、チェックを入れたセクションを元のノートブックに追加し、一部だけインポートしたノートブックには「一部インポート済み」と表示します。画面の設定は今回インポートするセクションに適用されます。目次と注記の言語はノートブックの元の言語のままです。

### 更新の確認

OneNote を使い続ける場合は、コマンドパレットで「OneNote の更新を確認」を実行します。

- OneDrive の場合は「OneDrive で更新を確認」を選びます。以前インポートしたノートブックを、まずプラグインのダウンロードしたコピーの中で最新にします。ダウンロードするのは OneDrive で変更されたファイルだけです。
- ダウンロードの場合は、フォルダーをもう一度ダウンロードして選びます（インポート画面で新しいダウンロードを選んでも同じです）。

そのあと、以前インポートしたノートブックをセクションごとに保管庫と比べます。更新のあるセクション、新しいセクション、前回完了しなかったセクションにはチェックが入り、更新のあるセクションは開いてページごとの変更を確認できます。

- 置き換えるのは OneNote で変更されたページだけです。置き換える前に、保管庫にある版を `_旧バージョン/<日時>/` にコピーします。OneNote で変更のないページには一切手を触れないので、ブックマーク、キャンバス、開いているタブはそのまま残ります。
- OneNote で変更され、Obsidian でも編集したページは、新しい版に置き換え、あなたの版は `_旧バージョン` に残します。画面と更新記録の両方で知らせます。
- 別の設定で変換し直すには、画面で設定を変えてから「変更なし」のセクションかそのノートブックをクリックします。更新がないときは「すべて選択」でも構いません。「変換し直す」と表示されます。ページはすべて書き直され、元の版は `_旧バージョン` に入ります。Obsidian で編集したページはそのまま残ります。OneNote で変更があって更新されるセクションは元の設定のままです。
- 何も削除しません。OneNote にもうないページやセクションはその場に残ります。Obsidian で削除したページは、チェックを入れたときだけ戻します。
- 更新のたびに `_更新記録` に変更点を記したページを書きます。`_変換レポート` はフォルダー内のすべてのノートブックの概要で、二つのページは互いを案内します。
- OneDrive からのノートブックは OneDrive の ID で見分け、ID は各ノートブックの目次ページに記録されます。OneNote で名前を変えたノートブックはその場で更新され、フォルダーも新しい名前に変わります（フォルダー名を自分で変えた場合や、その名前のフォルダーがすでにある場合を除く）。Obsidian でフォルダー名を変えても見つかります。コピーしたノートブックは別のノートブックとして扱います。
- 更新中に Obsidian が終了した場合は、次に起動したときに処理を終えます。各セクションは、すべて古いままか、すべて新しくなるかのどちらかです。

### Microsoft アカウントと OneDrive

OneDrive からのインポートは任意です。ダウンロードしたフォルダーのインポートには、アカウントもネットワーク接続も要りません。

- **サインイン**：ブラウザーで Microsoft 自身のページにサインインするので、プラグインがパスワードを見ることはありません。Microsoft は結果を、お使いのコンピューター上の一度きりのアドレス（127.0.0.1）に返します。
- **アクセス許可**：プラグインが求めるのは、ファイルの読み取り（`Files.Read`）、サインインの維持（`offline_access`）、基本的なサインイン情報（`openid`、`profile`。個人アカウントか職場または学校のアカウントかを見分けるため）だけです。OneDrive の中のものを変更したり削除したりはできません。このプラグインの名前でこれ以上の許可を求めるサインインページは、このプラグインのものではありません。
- **ネットワーク**：プラグインが接続するのは Microsoft だけです。サインインのサービス、Microsoft Graph（`graph.microsoft.com`、ノートブックとファイルの一覧）、Microsoft のファイルサーバー（ファイルのダウンロード）です。ノートは Microsoft からお使いのコンピューターへ直接届きます。ほかのサーバーはなく、テレメトリーもなく、何もアップロードしません。
- **サインインの維持**：サインイン情報は Obsidian のシークレットストレージに保存し、プラグインの設定ファイルには書きません。プラグインの設定で「サインアウト」すると、このデバイスのサインイン情報が消えます。プラグインのアクセス権そのものを取り消すには、個人アカウントは account.live.com/consent/Manage、職場または学校のアカウントは myapps.microsoft.com で行います。
- **ダウンロードキャッシュ**：OneDrive からダウンロードしたノートブックは、保管庫の外、システムのキャッシュフォルダー（macOS では `~/Library/Caches/onenote-ferry/onedrive`）に置き、次からは変更分だけをダウンロードします。更新を確認すると、以前インポートしたノートブックはここにまるごと保存されます。ダウンロードの前に空き容量を確認します。プラグインの設定の「ダウンロードキャッシュ」で、容量と場所を確認でき、クリアもできます。保管庫のノートはそのまま残ります。
- OneNote Ferry は独立したプロジェクトで、Microsoft が作成したものでも、Microsoft が認めたものでもありません。OneNote と OneDrive は Microsoft の商標です。

### プライバシーと安全性

OneNote のファイルは読み込むだけで、変更しません。OneDrive では、プラグインには読み取りの許可しかありません。変換はすべてお使いのコンピューター上で行われ、何もアップロードしません。プラグインが書き込むのは、選んだフォルダーと自身のダウンロードしたコピーの中だけで、保管庫の中のものを削除することはありません。

### 制限

- macOS と個人の Microsoft アカウントで開発、試験しています。Windows と Linux はまだ確認していません。職場または学校のアカウントも確認しておらず、組織によっては管理者がこのプラグインを承認するまでサインインできません。21Vianet が運営する中国版 Microsoft 365 のアカウントには対応していません。
- 一覧に出るのは自分の OneDrive にあるノートブックだけで、ほかの人から共有されたノートブックは出ません。
- ダウンロードした zip にはノートブックの ID がないため、ダウンロードからのノートブックは名前で見分けます。OneDrive で名前を変えたノートブックや、Obsidian でフォルダー名を変えたノートブックは、新しいノートブックとして扱われます。同じ名前のノートブックが二つあると、二つ目は「名前 (2)」としてインポートされ、更新の確認は一つ目だけが対象になります。
- パスワードで保護されたセクションは読み込めません。OneNote でパスワードを解除してから、もう一度インポートするか更新を確認してください。OneDrive からの場合、パスワードの有無はセクションをダウンロードしたあとでしかわからないため、そのようなセクションにチェックを入れるとダウンロードされ、レポートで変換できなかったものとして示されます。
- OneDrive の Web サイトでダウンロードできるのはノートブックが入っているフォルダーで、ノートブックを 1 冊ずつダウンロードすることはできません。
- ページの自由なレイアウト（フォント、文字サイズ、正確な位置）は再現しません。テキストボックスは読む順に並べ、オプションで各ブロックの位置を記したコメントを付けます。
- OneDrive のファイルにはセクションの順序が記録されていないため、セクションは名前順に並びます。
- OneNote でページをほかのセクションに移すと、保管庫には 2 つ残ります。元のセクションのもの（「OneNote にはもうないページ」の下に表示）と、新しいセクションのものです。
- ノートブックの目次と注記の言語は変えられません。変えるには、そのノートブックのフォルダーを保存先のフォルダーの外へ移してから、もう一度インポートします。

### 言語

画面は Obsidian の言語に合わせて、英語、中国語、日本語、韓国語で表示します。ノートに書き込む目次ページ、注記、フォルダー名には、英語、簡体字中国語、繁体字中国語、日本語、韓国語を使えます。

### 開発

英語の Development の項を参照してください。コマンドライン版はダウンロードしたフォルダーだけを読み込み、OneDrive にはサインインしません。予定している機能範囲は [docs/requirements.md](docs/requirements.md)（中国語）にあります。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。Joplin（MPL-2.0）と Obsidian Importer（MIT）を元にしたコードを含みます。[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。

## 한국어

OneNote 전자 필기장을 Obsidian으로 옮겨 줍니다. 하이라이트, 레이아웃 순서, 링크, 원본 첨부 파일을 그대로 유지하고, 나중에 업데이트를 확인할 수도 있습니다.

> **상태: 개발 중이며 아직 공개하지 않았습니다.** 가져오기(OneDrive에서 바로, 또는 다운로드한 폴더에서)와 업데이트 확인은 작동하며, macOS에서 개인 Microsoft 계정과 관리자 본인의 전자 필기장으로 시험했습니다. 첫 공개 버전 전에 Windows용 OneNote 내보내기 파일 지원과 몇 가지 개선을 더할 예정입니다.

### 용도

OneNote Ferry는 Obsidian 커뮤니티 플러그인(명령줄 버전 포함)입니다. 전자 필기장을 개인 OneDrive에 보관하며 Obsidian에서 충실한 Markdown 사본을 얻고 싶은 사람, 특히 OneNote에서 PDF만 내보낼 수 있는 Mac 사용자를 위한 것입니다.

원본 노트 파일을, Microsoft 계정으로 로그인해 OneDrive에서 바로 읽거나, OneDrive 웹사이트에서 다운로드한 전자 필기장이 든 폴더(zip 또는 압축을 푼 폴더)에서 읽습니다. 그리고 정리된 Markdown 폴더로 변환합니다.

- 글자 서식, 하이라이트(색상 유지), 웹 링크, 수식(LaTeX로 변환)
- 노트 간 링크(보관함 안의 링크로 변환)
- 원본 이미지와 첨부 파일(변환 없음), 인쇄 페이지는 원래 PDF로 표시
- 손글씨(쓴 자리에 그림으로 배치)
- 페이지 계층, 전자 필기장과 섹션마다 목차 페이지
- 자유 배치 텍스트 상자를 읽는 순서대로 정렬
- 무엇을 변환했고 무엇을 변환하지 못했는지 적은 보고서

### 가져오기

가져오기 창에 전자 필기장과 섹션이 나열되며, 원하는 것을 선택하면 됩니다. 전자 필기장은 OneDrive에서도, 다운로드한 폴더에서도 가져올 수 있습니다.

**OneDrive에서**

1. Obsidian 왼쪽 리본의 종이배 아이콘을 클릭하거나, 명령 팔레트에서 "OneNote 노트 가져오기"를 실행합니다.
2. "OneDrive에서 가져오기"를 선택하고, 열린 브라우저에서 Microsoft 계정으로 로그인합니다.
3. 전자 필기장과 섹션이 나열됩니다. 이때는 아무것도 다운로드하지 않았고 아무것도 선택되어 있지 않습니다. 가져올 전자 필기장과 섹션을 선택합니다. 목록에 없는 전자 필기장은 "다른 폴더에서 찾기"(OneDrive 줄의 폴더 아이콘)로 추가할 수 있습니다.
4. "가져오기 시작"을 클릭합니다. 선택한 섹션만 다운로드한 뒤 가져옵니다. 창을 닫아도 가져오기는 계속되며, 진행 상황은 상태 표시줄에 나옵니다.
5. 끝나면 만들어진 보고서를 엽니다.

**다운로드한 폴더에서**

1. OneDrive 웹사이트에서 전자 필기장이 든 폴더를 다운로드합니다.
2. 위와 같이 가져오기 창을 열고 "zip 파일 또는 폴더 선택"을 선택합니다.
3. 가져올 전자 필기장과 섹션을 선택하고 "가져오기 시작"을 클릭합니다.

대상 폴더에 그중 일부 전자 필기장이 이미 있으면, 선택한 섹션을 원래 전자 필기장에 추가하고, 일부만 가져온 전자 필기장에는 "일부만 가져옴"이라고 표시합니다. 창의 설정은 이번에 가져오는 섹션에 적용됩니다. 목차와 안내 문구의 언어는 전자 필기장의 원래 언어를 그대로 씁니다.

### 업데이트 확인

OneNote를 계속 쓴다면, 명령 팔레트에서 "OneNote 업데이트 확인"을 실행합니다.

- OneDrive를 쓴다면 "OneDrive에서 업데이트 확인"을 선택합니다. 이전에 가져온 전자 필기장을 먼저 플러그인이 다운로드한 사본에서 최신으로 맞추며, OneDrive에서 바뀐 파일만 다운로드합니다.
- 다운로드를 쓴다면 폴더를 다시 다운로드해 선택합니다(가져오기 창에서 새 다운로드를 선택해도 같습니다).

그다음 이전에 가져온 전자 필기장을 섹션별로 보관함과 비교합니다. 업데이트가 있는 섹션, 새 섹션, 지난번에 끝나지 않은 섹션은 선택되어 있으며, 업데이트가 있는 섹션은 펼쳐서 페이지별 변경을 볼 수 있습니다.

- OneNote에서 바뀐 페이지만 바꿉니다. 바꾸기 전에 보관함에 있던 버전을 `_이전 버전/<시간>/`에 복사합니다. OneNote에서 바뀌지 않은 페이지는 전혀 건드리지 않으므로 북마크, 캔버스, 열린 탭이 그대로 남습니다.
- OneNote에서 바뀌었고 Obsidian에서도 수정한 페이지는 새 버전으로 바꾸고, 사용자의 버전은 `_이전 버전`에 남깁니다. 창과 업데이트 기록 모두에서 알려 줍니다.
- 다른 설정으로 다시 변환하려면, 창에서 설정을 바꾼 뒤 "변경 없음"으로 표시된 섹션이나 그 전자 필기장을 클릭합니다. 업데이트가 없을 때는 "모두 선택"을 눌러도 됩니다. "다시 변환"으로 표시됩니다. 페이지를 모두 새로 쓰고, 이전 버전은 `_이전 버전`에 들어갑니다. Obsidian에서 수정한 페이지는 그대로 남습니다. OneNote에서 바뀌어 업데이트되는 섹션은 원래 설정을 유지합니다.
- 아무것도 삭제하지 않습니다. OneNote에 더 이상 없는 페이지와 섹션은 그 자리에 남습니다. Obsidian에서 삭제한 페이지는 선택했을 때만 복원합니다.
- 업데이트할 때마다 `_업데이트 기록`에 바뀐 내용을 적은 페이지를 씁니다. `_변환 보고서`는 폴더 안 모든 전자 필기장의 개요이며, 두 페이지는 서로를 안내합니다.
- OneDrive에서 가져온 전자 필기장은 OneDrive ID로 구분하며, ID는 각 전자 필기장의 목차 페이지에 기록됩니다. OneNote에서 이름을 바꾼 전자 필기장은 그 자리에서 업데이트되고, 폴더 이름도 새 이름으로 바뀝니다(폴더 이름을 직접 바꿨거나 그 이름의 폴더가 이미 있으면 제외). Obsidian에서 폴더 이름을 바꿔도 찾아냅니다. 복사한 전자 필기장은 별개의 전자 필기장으로 취급합니다.
- 업데이트 중에 Obsidian이 종료되면, 다음에 Obsidian을 시작할 때 마무리합니다. 각 섹션은 모두 이전 상태이거나 모두 새 상태입니다.

### Microsoft 계정과 OneDrive

OneDrive에서 가져오기는 선택 사항입니다. 다운로드한 폴더를 가져올 때는 계정도 네트워크 연결도 필요 없습니다.

- **로그인**: 브라우저에서 Microsoft의 자체 페이지에 로그인하므로, 플러그인은 비밀번호를 볼 수 없습니다. Microsoft는 결과를 사용자 컴퓨터의 일회용 주소(127.0.0.1)로 돌려보냅니다.
- **권한**: 플러그인이 요청하는 것은 파일 읽기(`Files.Read`), 로그인 유지(`offline_access`), 기본 로그인 정보(`openid`, `profile`, 개인 계정인지 회사 또는 학교 계정인지 구분하는 데 사용)뿐입니다. OneDrive 안의 어떤 것도 바꾸거나 삭제할 수 없습니다. 이 플러그인의 이름으로 그보다 많은 권한을 요청하는 로그인 페이지는 이 플러그인의 것이 아닙니다.
- **네트워크**: 플러그인은 Microsoft에만 연결합니다. 로그인 서비스, Microsoft Graph(`graph.microsoft.com`, 전자 필기장과 파일 목록), Microsoft의 파일 서버(파일 다운로드)입니다. 노트는 Microsoft에서 사용자 컴퓨터로 바로 옵니다. 다른 서버도, 원격 분석도 없으며, 아무것도 업로드하지 않습니다.
- **로그인 유지**: 로그인 정보는 Obsidian의 보안 저장소에 두고, 플러그인 설정 파일에는 쓰지 않습니다. 플러그인 설정에서 "로그아웃"하면 이 기기의 로그인 정보가 지워집니다. 플러그인의 접근 권한 자체를 거두려면 개인 계정은 account.live.com/consent/Manage, 회사 또는 학교 계정은 myapps.microsoft.com에서 할 수 있습니다.
- **다운로드 캐시**: OneDrive에서 다운로드한 전자 필기장은 보관함 밖, 시스템의 캐시 폴더(macOS에서는 `~/Library/Caches/onenote-ferry/onedrive`)에 두어, 다음부터는 바뀐 부분만 다운로드합니다. 업데이트를 확인하면 이전에 가져온 전자 필기장은 여기에 통째로 저장됩니다. 다운로드하기 전에 남은 공간을 확인합니다. 플러그인 설정의 "다운로드 캐시"에서 크기와 위치를 볼 수 있고 지울 수도 있습니다. 보관함의 노트는 그대로 남습니다.
- OneNote Ferry는 독립 프로젝트이며, Microsoft가 만들거나 승인한 것이 아닙니다. OneNote와 OneDrive는 Microsoft의 상표입니다.

### 개인정보와 안전

OneNote 파일은 읽기만 하고 수정하지 않습니다. OneDrive에서 플러그인에는 읽기 권한만 있습니다. 변환은 모두 사용자의 컴퓨터에서 이루어지며, 아무것도 업로드하지 않습니다. 플러그인은 선택한 폴더와 자체 다운로드 사본 안에만 쓰고, 보관함 안의 어떤 것도 삭제하지 않습니다.

### 제한

- macOS와 개인 Microsoft 계정에서 개발하고 시험했습니다. Windows와 Linux는 아직 확인하지 않았습니다. 회사 또는 학교 계정도 확인하지 않았으며, 조직에 따라 관리자가 이 플러그인을 승인해야 로그인할 수 있습니다. 21Vianet이 운영하는 중국판 Microsoft 365 계정은 지원하지 않습니다.
- 목록에는 자신의 OneDrive에 있는 전자 필기장만 나오며, 다른 사람이 공유한 전자 필기장은 나오지 않습니다.
- 내려받은 zip에는 전자 필기장 ID가 없으므로, 내려받은 전자 필기장은 이름으로 구분합니다. OneDrive에서 이름을 바꾸거나 Obsidian에서 폴더 이름을 바꾼 전자 필기장은 새 전자 필기장으로 취급됩니다. 이름이 같은 전자 필기장이 둘이면 두 번째는 "이름 (2)"로 가져오며, 업데이트 확인은 첫 번째만 대상입니다.
- 암호로 보호된 섹션은 읽을 수 없습니다. OneNote에서 암호를 해제한 뒤 다시 가져오거나 업데이트를 확인하세요. OneDrive에서 가져올 때는 섹션을 다운로드한 뒤에야 암호 여부를 알 수 있으므로, 그런 섹션을 선택하면 다운로드된 뒤 보고서에 변환하지 못한 것으로 표시됩니다.
- OneDrive 웹사이트에서는 전자 필기장이 든 폴더를 다운로드할 수 있을 뿐, 전자 필기장을 하나씩 다운로드할 수는 없습니다.
- 페이지의 자유로운 레이아웃(글꼴, 글자 크기, 정확한 위치)은 재현하지 않습니다. 텍스트 상자는 읽는 순서대로 정렬하고, 선택에 따라 각 블록 앞에 위치를 적은 주석을 붙입니다.
- OneDrive의 파일에는 섹션 순서가 기록되지 않으므로 섹션은 이름순으로 정렬됩니다.
- OneNote에서 페이지를 다른 섹션으로 옮기면 보관함에 두 개가 남습니다. 원래 섹션에 있는 것("OneNote에 더 이상 없는 페이지" 아래에 표시)과 새 섹션에 있는 것입니다.
- 전자 필기장의 목차와 안내 문구의 언어는 바꿀 수 없습니다. 바꾸려면 그 전자 필기장의 폴더를 대상 폴더 밖으로 옮긴 뒤 다시 가져옵니다.

### 언어

UI는 Obsidian 언어를 따르며, 영어, 중국어, 일본어, 한국어를 지원합니다. 노트에 쓰는 목차 페이지, 안내 문구, 폴더 이름은 영어, 중국어 간체, 중국어 번체, 일본어, 한국어로 쓸 수 있습니다.

### 개발

영어 부분의 Development를 참고하세요. 명령줄 버전은 다운로드한 폴더만 읽으며, OneDrive에 로그인하지 않습니다. 계획한 기능 범위는 [docs/requirements.md](docs/requirements.md)(중국어)에 있습니다.

### 라이선스

MIT. [LICENSE](LICENSE)를 참고하세요. Joplin(MPL-2.0)과 Obsidian Importer(MIT)를 바탕으로 한 코드가 포함되어 있습니다. [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)를 참고하세요.
