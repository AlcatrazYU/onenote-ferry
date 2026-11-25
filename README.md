# OneNote Ferry

English | [中文](#中文) | [日本語](#日本語) | [한국어](#한국어)

Ferry your OneNote notebooks into Obsidian, with highlights, layout order, links and original attachments intact, and keep them up to date.

> **Status: in development, not released yet.** Importing and checking for updates work, and are tested on macOS on the maintainer's own notebooks. Still to come before the first release: downloading straight from Microsoft inside the plugin, and Windows OneNote exports.

## What It Is For

OneNote Ferry is an Obsidian community plugin (with a command line version) for people who keep their OneNote notebooks on a personal OneDrive and want a faithful Markdown copy in Obsidian, including Mac users, whose OneNote only exports PDF.

It reads the original notebook files you get by downloading the folder that holds your notebooks from the OneDrive website (the zip, or the folder after unzipping), and converts them into an organized Markdown folder:

- text formatting, highlights (with their colors), web links, math as LaTeX
- links between notes, rewritten as links inside your vault
- original images and attachments, unchanged; printouts shown as the original PDF
- handwriting, drawn as a picture where it was written
- page hierarchy, with a contents page for each notebook and section
- a reading order for free-floating text boxes
- a report of what was converted, and of anything that could not be

## Importing

1. On the OneDrive website, download the folder that holds your notebooks.
2. In Obsidian, click the paper boat icon in the left ribbon, or run `Import from OneNote` from the command palette.
3. Choose the zip file or folder, and tick the notebooks and sections you want.
4. Click `Start import`. You can close the window: the import goes on, with its progress in the status bar.
5. When it ends, open the report it wrote.

## Checking for Updates

If you keep using OneNote, download the folder again later and run `Check for OneNote updates` (choosing the new download in the import window works too). Each notebook imported before is compared with your vault, section by section. Sections that changed, are new, or were cut off last time are ticked; a changed section opens to show its pages.

- Only the pages OneNote changed are replaced. Before a page is replaced, the vault's copy goes to `_previous versions/<time>/`. Pages OneNote did not change are not touched, so bookmarks, canvases and open tabs stay on them.
- A page changed in OneNote and also edited in Obsidian: the new version goes in, your version is kept in `_previous versions`, and both the window and the log point it out.
- Nothing is ever deleted. Pages and sections OneNote no longer has stay where they are. Pages you deleted in Obsidian come back only if you tick them.
- Each update writes a page in `_sync log` that lists what changed.
- If Obsidian quits during an update, the update is finished the next time Obsidian starts: each section ends up all old or all new.

## Privacy and Safety

Your OneNote files are only read, never modified. Conversion runs entirely on your own computer, and nothing is uploaded. The plugin writes only inside the folder you choose, and never deletes a file.

## Limits

- Developed and tested on macOS with a personal OneDrive account. Windows, Linux, and work or school accounts are not verified yet.
- The OneDrive website downloads the folder that holds your notebooks, not a single notebook.
- The free layout of a page (fonts, sizes, exact positions) is not reproduced. Text boxes are put in reading order, with an optional comment giving each one's position.
- Password-protected sections cannot be read: remove the password in OneNote and download again.
- Sections are sorted by name, because the download does not record their order.

## Languages

The interface follows Obsidian's language: English, Chinese, Japanese or Korean. The contents pages, notices and folder names written into your notes can be in English, Simplified Chinese, Traditional Chinese, Japanese or Korean.

## Development

```bash
npm install
npm run build:parser
npm test
node scripts/build-plugin.mjs --install "<your vault>/.obsidian/plugins/onenote-ferry"
```

`npm run build:parser` needs Rust and wasm-pack. The command line version converts a download with `node src/cli/main.ts <download> <output folder>`, and `node src/cli/main.ts sync <download> <output folder>` lists what an update would change (add `--apply` to update).

The full scope is described in [docs/requirements.md](docs/requirements.md) (in Chinese).

## License

MIT. See [LICENSE](LICENSE). OneNote Ferry includes code adapted from Joplin (MPL-2.0) and Obsidian Importer (MIT); see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## 中文

把 OneNote 笔记本摆渡到 Obsidian：高亮、版面顺序、链接和原始附件都保留，以后还能检查更新。

> **状态：开发中，还没有发布。** 导入和检查更新已经可以用，在 macOS 上用维护者自己的笔记本测试过。第一个公开版本之前还要做：在插件里直接从微软下载，以及支持 Windows 版 OneNote 的导出文件。

### 用途

OneNote Ferry（OneNote 摆渡）是一个 Obsidian 社区插件（附命令行版），面向笔记本存在个人 OneDrive 上、想在 Obsidian 里得到高还原 Markdown 的人，包括 OneNote 只能导出 PDF 的 Mac 用户。

它读取在 OneDrive 网页上下载装着笔记本的文件夹得到的原始笔记文件（zip，或解压后的文件夹），转成整理好的 Markdown 文件夹：

- 文字格式、高亮（保留颜色）、网页链接，数学公式转成 LaTeX
- 笔记间链接，改写为仓库内链接
- 原始图片和附件，不转码；打印页显示为原来的 PDF
- 手写，画成图片放在原来的位置
- 页面层级，每个笔记本和分区都有目录页
- 自由文本框排出阅读顺序
- 一份报告，写明转了什么、有什么没能转

### 导入

1. 在 OneDrive 网页上下载装着笔记本的文件夹。
2. 在 Obsidian 里点左侧功能区的纸船图标，或在命令面板里运行“从 OneNote 导入”。
3. 选择 zip 文件或文件夹，勾选要导入的笔记本和分区。
4. 点“开始导入”。可以关掉窗口，导入会继续，进度显示在状态栏。
5. 结束后打开它写的报告。

### 检查更新

如果还在继续用 OneNote，过一段时间重新下载这个文件夹，运行“检查 OneNote 更新”（在导入窗口里选进新的下载也一样）。以前导入过的笔记本会逐个分区和仓库比较；有更新、新分区、上次没写完的分区默认勾上，有更新的分区可以展开看每一页。

- 只换 OneNote 里改过的页面。换之前，仓库里那份先复制进 `_旧版本/<时间>/`。OneNote 里没改的页面一个字节不动，书签、白板、打开的标签页都留在原页面上。
- OneNote 里改了、你在 Obsidian 里也改过的页面：换成新版，你的版本留在 `_旧版本` 里，窗口和更新记录都会标出。
- 任何东西都不删除。OneNote 里已经没有的页面和分区留在原处。你在 Obsidian 里删掉的页面，勾选了才会补回。
- 每次更新在 `_更新记录` 里写一页，列出改了什么。
- 更新时退出了 Obsidian，下次打开时会自动处理完毕，每个分区要么全旧、要么全新。

### 隐私与安全

插件只读取 OneNote 文件，从不修改；转换全部在你的电脑上完成，不上传任何东西。插件只写你选的文件夹，从不删除文件。

### 限制

- 在 macOS 和个人 OneDrive 账号上开发和测试；Windows、Linux，以及工作或学校账号还没有验证。
- OneDrive 网页上只能下载装着笔记本的文件夹，不能单独下载一本笔记本。
- 不还原页面的自由版面（字体、字号、精确位置）。文本框排成阅读顺序，可选在每块前加一行注释写明它的位置。
- 设了密码的分区读不出：请在 OneNote 里取消密码后重新下载。
- 分区按名称排序，因为下载包里没有记下分区的顺序。

### 语言

界面跟随 Obsidian 的语言：English、中文、日本語、한국어。写进笔记的目录页、提示和文件夹名可以用 English、简体中文、繁體中文、日本語、한국어。

### 开发

见上方英文部分的 Development。完整的功能范围见 [docs/requirements.md](docs/requirements.md)。

### 许可

MIT，见 [LICENSE](LICENSE)。其中有改编自 Joplin（MPL-2.0）和 Obsidian Importer（MIT）的代码，见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

## 日本語

OneNote のノートブックを Obsidian へ運びます。ハイライト、レイアウトの順序、リンク、元の添付ファイルをそのまま残し、あとから更新を確認することもできます。

> **状況：開発中で、まだ公開していません。** インポートと更新の確認は動作し、macOS 上でメンテナー自身のノートブックで試験しています。最初の公開版までに、プラグイン内で Microsoft から直接ダウンロードする機能と、Windows 版 OneNote のエクスポートファイルへの対応を加える予定です。

### 目的

OneNote Ferry は、Obsidian コミュニティプラグイン（コマンドライン版つき）です。ノートブックを個人の OneDrive に保存していて、Obsidian で再現度の高い Markdown を得たい人、特に OneNote から PDF しか書き出せない Mac の利用者を想定しています。

OneDrive の Web サイトでノートブックが入っているフォルダーをダウンロードして得られる元のノートファイル（zip、または展開したフォルダー）を読み込み、整理された Markdown フォルダーに変換します。

- 文字の書式、ハイライト（色つき）、Web リンク、数式（LaTeX に変換）
- ノート間リンク（保管庫内のリンクに書き換え）
- 元の画像と添付ファイル（変換なし）、印刷イメージは元の PDF として表示
- 手書き（書かれた位置に画像として配置）
- ページの階層、ノートブックとセクションごとの目次ページ
- 自由配置のテキストボックスを読む順に並べる
- 変換できたもの、できなかったものを記したレポート

### インポート

1. OneDrive の Web サイトで、ノートブックが入っているフォルダーをダウンロードします。
2. Obsidian の左のリボンにある紙の船のアイコンをクリックするか、コマンドパレットで「OneNote からインポート」を実行します。
3. zip ファイルかフォルダーを選び、インポートするノートブックとセクションにチェックを入れます。
4. 「インポートを開始」をクリックします。画面を閉じてもインポートは続き、進行状況はステータスバーに表示されます。
5. 終わったら、作成されたレポートを開きます。

### 更新の確認

OneNote を使い続ける場合は、しばらくしてからフォルダーをもう一度ダウンロードし、「OneNote の更新を確認」を実行します（インポート画面で新しいダウンロードを選んでも同じです）。以前インポートしたノートブックをセクションごとに保管庫と比べます。更新のあるセクション、新しいセクション、前回完了しなかったセクションにはチェックが入り、更新のあるセクションは開いてページごとの変更を確認できます。

- 置き換えるのは OneNote で変更されたページだけです。置き換える前に、保管庫にある版を `_旧バージョン/<日時>/` にコピーします。OneNote で変更のないページには一切手を触れないので、ブックマーク、キャンバス、開いているタブはそのまま残ります。
- OneNote で変更され、Obsidian でも編集したページは、新しい版に置き換え、あなたの版は `_旧バージョン` に残します。画面と更新記録の両方で知らせます。
- 何も削除しません。OneNote にもうないページやセクションはその場に残ります。Obsidian で削除したページは、チェックを入れたときだけ戻します。
- 更新のたびに `_更新記録` に変更点を記したページを書きます。
- 更新中に Obsidian が終了した場合は、次に起動したときに処理を終えます。各セクションは、すべて古いままか、すべて新しくなるかのどちらかです。

### プライバシーと安全性

OneNote のファイルは読み込むだけで、変更しません。変換はすべてお使いのコンピューター上で行われ、何もアップロードしません。プラグインが書き込むのは選んだフォルダーの中だけで、ファイルを削除することはありません。

### 制限

- macOS と個人の OneDrive アカウントで開発、試験しています。Windows、Linux、職場または学校のアカウントはまだ確認していません。
- OneDrive の Web サイトでダウンロードできるのはノートブックが入っているフォルダーで、ノートブックを 1 冊ずつダウンロードすることはできません。
- ページの自由なレイアウト（フォント、文字サイズ、正確な位置）は再現しません。テキストボックスは読む順に並べ、オプションで各ブロックの位置を記したコメントを付けます。
- パスワードで保護されたセクションは読み込めません。OneNote でパスワードを解除してから、もう一度ダウンロードしてください。
- ダウンロードにセクションの順序が記録されていないため、セクションは名前順に並びます。

### 言語

画面は Obsidian の言語に合わせて、英語、中国語、日本語、韓国語で表示します。ノートに書き込む目次ページ、注記、フォルダー名には、英語、簡体字中国語、繁体字中国語、日本語、韓国語を使えます。

### 開発

英語の Development の項を参照してください。予定している機能範囲は [docs/requirements.md](docs/requirements.md)（中国語）にあります。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。Joplin（MPL-2.0）と Obsidian Importer（MIT）を元にしたコードを含みます。[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。

## 한국어

OneNote 전자 필기장을 Obsidian으로 옮겨 줍니다. 하이라이트, 레이아웃 순서, 링크, 원본 첨부 파일을 그대로 유지하고, 나중에 업데이트를 확인할 수도 있습니다.

> **상태: 개발 중이며 아직 공개하지 않았습니다.** 가져오기와 업데이트 확인은 작동하며, macOS에서 관리자 본인의 전자 필기장으로 시험했습니다. 첫 공개 버전 전에 플러그인 안에서 Microsoft로부터 바로 다운로드하는 기능과 Windows용 OneNote 내보내기 파일 지원을 더할 예정입니다.

### 용도

OneNote Ferry는 Obsidian 커뮤니티 플러그인(명령줄 버전 포함)입니다. 전자 필기장을 개인 OneDrive에 보관하며 Obsidian에서 충실한 Markdown 사본을 얻고 싶은 사람, 특히 OneNote에서 PDF만 내보낼 수 있는 Mac 사용자를 위한 것입니다.

OneDrive 웹사이트에서 전자 필기장이 든 폴더를 다운로드하면 얻을 수 있는 원본 노트 파일(zip 또는 압축을 푼 폴더)을 읽어, 정리된 Markdown 폴더로 변환합니다.

- 글자 서식, 하이라이트(색상 유지), 웹 링크, 수식(LaTeX로 변환)
- 노트 간 링크(보관함 안의 링크로 변환)
- 원본 이미지와 첨부 파일(변환 없음), 인쇄 페이지는 원래 PDF로 표시
- 손글씨(쓴 자리에 그림으로 배치)
- 페이지 계층, 전자 필기장과 섹션마다 목차 페이지
- 자유 배치 텍스트 상자를 읽는 순서대로 정렬
- 무엇을 변환했고 무엇을 변환하지 못했는지 적은 보고서

### 가져오기

1. OneDrive 웹사이트에서 전자 필기장이 든 폴더를 다운로드합니다.
2. Obsidian 왼쪽 리본의 종이배 아이콘을 클릭하거나, 명령 팔레트에서 "OneNote에서 가져오기"를 실행합니다.
3. zip 파일이나 폴더를 선택하고, 가져올 전자 필기장과 섹션을 선택합니다.
4. "가져오기 시작"을 클릭합니다. 창을 닫아도 가져오기는 계속되며, 진행 상황은 상태 표시줄에 나옵니다.
5. 끝나면 만들어진 보고서를 엽니다.

### 업데이트 확인

OneNote를 계속 쓴다면, 나중에 폴더를 다시 다운로드하고 "OneNote 업데이트 확인"을 실행합니다(가져오기 창에서 새 다운로드를 선택해도 같습니다). 이전에 가져온 전자 필기장을 섹션별로 보관함과 비교합니다. 업데이트가 있는 섹션, 새 섹션, 지난번에 끝나지 않은 섹션은 선택되어 있으며, 업데이트가 있는 섹션은 펼쳐서 페이지별 변경을 볼 수 있습니다.

- OneNote에서 바뀐 페이지만 바꿉니다. 바꾸기 전에 보관함에 있던 버전을 `_이전 버전/<시간>/`에 복사합니다. OneNote에서 바뀌지 않은 페이지는 전혀 건드리지 않으므로 북마크, 캔버스, 열린 탭이 그대로 남습니다.
- OneNote에서 바뀌었고 Obsidian에서도 수정한 페이지는 새 버전으로 바꾸고, 사용자의 버전은 `_이전 버전`에 남깁니다. 창과 업데이트 기록 모두에서 알려 줍니다.
- 아무것도 삭제하지 않습니다. OneNote에 더 이상 없는 페이지와 섹션은 그 자리에 남습니다. Obsidian에서 삭제한 페이지는 선택했을 때만 복원합니다.
- 업데이트할 때마다 `_업데이트 기록`에 바뀐 내용을 적은 페이지를 씁니다.
- 업데이트 중에 Obsidian이 종료되면, 다음에 Obsidian을 시작할 때 마무리합니다. 각 섹션은 모두 이전 상태이거나 모두 새 상태입니다.

### 개인정보와 안전

OneNote 파일은 읽기만 하고 수정하지 않습니다. 변환은 모두 사용자의 컴퓨터에서 이루어지며, 아무것도 업로드하지 않습니다. 플러그인은 선택한 폴더 안에만 쓰고, 파일을 삭제하지 않습니다.

### 제한

- macOS와 개인 OneDrive 계정에서 개발하고 시험했습니다. Windows, Linux, 회사 또는 학교 계정은 아직 확인하지 않았습니다.
- OneDrive 웹사이트에서는 전자 필기장이 든 폴더를 다운로드할 수 있을 뿐, 전자 필기장을 하나씩 다운로드할 수는 없습니다.
- 페이지의 자유로운 레이아웃(글꼴, 글자 크기, 정확한 위치)은 재현하지 않습니다. 텍스트 상자는 읽는 순서대로 정렬하고, 선택에 따라 각 블록 앞에 위치를 적은 주석을 붙입니다.
- 암호로 보호된 섹션은 읽을 수 없습니다. OneNote에서 암호를 해제한 뒤 다시 다운로드하세요.
- 다운로드에 섹션 순서가 기록되지 않으므로 섹션은 이름순으로 정렬됩니다.

### 언어

UI는 Obsidian 언어를 따르며, 영어, 중국어, 일본어, 한국어를 지원합니다. 노트에 쓰는 목차 페이지, 안내 문구, 폴더 이름은 영어, 중국어 간체, 중국어 번체, 일본어, 한국어로 쓸 수 있습니다.

### 개발

영어 부분의 Development를 참고하세요. 계획한 기능 범위는 [docs/requirements.md](docs/requirements.md)(중국어)에 있습니다.

### 라이선스

MIT. [LICENSE](LICENSE)를 참고하세요. Joplin(MPL-2.0)과 Obsidian Importer(MIT)를 바탕으로 한 코드가 포함되어 있습니다. [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)를 참고하세요.
