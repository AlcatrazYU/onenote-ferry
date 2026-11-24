# OneNote Ferry

English | [中文](#中文) | [日本語](#日本語) | [한국어](#한국어)

Ferry your OneNote notebooks into Obsidian, with highlights, layout order, links and original attachments intact, and keep them in sync.

> **Status: early development.** There is nothing to install yet. This README will be filled in as the plugin takes shape.

## What It Is For

OneNote Ferry is a planned Obsidian community plugin (with a command line version) for people who use a Mac, keep their OneNote notebooks on a personal OneDrive, and want a faithful Markdown copy in Obsidian.

It reads the original notebook files you get by downloading the folder that holds your notebooks from the OneDrive website, and converts them into an organized Markdown folder:

- text formatting, highlights (with their colors), and web links
- links between notes, rewritten as links inside your vault
- original images and attachments, unchanged
- page hierarchy, with a table of contents for each notebook and section
- a reading order for free-floating text boxes
- later, incremental sync: only the sections that changed are updated

Your OneNote files are only read, never modified. Conversion runs entirely on your own computer.

The planned scope is described in [docs/requirements.md](docs/requirements.md) (in Chinese).

## License

MIT. See [LICENSE](LICENSE).

## 中文

把 OneNote 笔记本摆渡到 Obsidian：高亮、版面顺序、链接和原始附件都保留，以后还能同步更新。

> **状态：开发初期。** 目前还没有可以安装的版本，本说明会随开发逐步补全。

### 用途

OneNote Ferry（OneNote 摆渡）是一个计划中的 Obsidian 社区插件（附命令行版），面向用 Mac、笔记本存在个人 OneDrive 上、想在 Obsidian 里得到高还原 Markdown 的人。

它读取在 OneDrive 网页上下载装着笔记本的文件夹得到的原始笔记文件，转成整理好的 Markdown 文件夹：

- 文字格式、高亮（保留颜色）、网页链接
- 笔记间链接，改写为仓库内链接
- 原始图片和附件，不转码
- 页面层级，每个笔记本和分区都有目录
- 自由文本框排出阅读顺序
- 以后支持增量同步：只更新有变化的分区

程序只读取 OneNote 文件，从不修改；转换全部在你的电脑上完成。

计划中的功能范围见 [docs/requirements.md](docs/requirements.md)。

### 许可

MIT，见 [LICENSE](LICENSE)。

## 日本語

OneNote のノートブックを Obsidian へ運びます。ハイライト、レイアウトの順序、リンク、元の添付ファイルをそのまま残し、あとから同期もできます。

> **状況：開発初期です。** まだインストールできる版はありません。この説明は開発に合わせて書き足していきます。

### 目的

OneNote Ferry は、Obsidian コミュニティプラグイン（コマンドライン版つき）として計画しているツールです。Mac を使い、ノートブックを個人の OneDrive に保存していて、Obsidian で再現度の高い Markdown を得たい人を想定しています。

OneDrive の Web サイトでノートブックが入っているフォルダーをダウンロードして得られる元のノートファイルを読み込み、整理された Markdown フォルダーに変換します。

- 文字の書式、ハイライト（色つき）、Web リンク
- ノート間リンク（保管庫内のリンクに書き換え）
- 元の画像と添付ファイル（変換なし）
- ページの階層、ノートブックとセクションごとの目次
- 自由配置のテキストボックスを読む順に並べる
- 今後は差分同期：変更のあったセクションだけを更新

OneNote のファイルは読み込むだけで、変更しません。変換はすべてお使いのコンピューター上で行われます。

予定している機能範囲は [docs/requirements.md](docs/requirements.md)（中国語）にあります。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。

## 한국어

OneNote 전자 필기장을 Obsidian으로 옮겨 줍니다. 하이라이트, 레이아웃 순서, 링크, 원본 첨부 파일을 그대로 유지하고, 나중에 동기화할 수도 있습니다.

> **상태: 개발 초기입니다.** 아직 설치할 수 있는 버전이 없습니다. 이 설명은 개발에 맞춰 채워 나갈 예정입니다.

### 용도

OneNote Ferry는 Obsidian 커뮤니티 플러그인(명령줄 버전 포함)으로 계획 중인 도구입니다. Mac을 쓰고, 전자 필기장을 개인 OneDrive에 보관하며, Obsidian에서 충실한 Markdown 사본을 얻고 싶은 사람을 위한 것입니다.

OneDrive 웹사이트에서 전자 필기장이 든 폴더를 다운로드하면 얻을 수 있는 원본 노트 파일을 읽어, 정리된 Markdown 폴더로 변환합니다.

- 글자 서식, 하이라이트(색상 유지), 웹 링크
- 노트 간 링크(보관함 안의 링크로 변환)
- 원본 이미지와 첨부 파일(변환 없음)
- 페이지 계층, 전자 필기장과 섹션마다 목차
- 자유 배치 텍스트 상자를 읽는 순서대로 정렬
- 이후 증분 동기화: 변경된 섹션만 업데이트

OneNote 파일은 읽기만 하고 수정하지 않습니다. 변환은 모두 사용자의 컴퓨터에서 이루어집니다.

계획 중인 기능 범위는 [docs/requirements.md](docs/requirements.md)(중국어)에 있습니다.

### 라이선스

MIT. [LICENSE](LICENSE)를 참고하세요.
