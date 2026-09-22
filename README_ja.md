# AI Browser Bridge (Chrome Extension)

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-live-brightgreen?logo=google-chrome)](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/aktsmm/ai-browser-bridge?style=social)](https://github.com/aktsmm/ai-browser-bridge)

🌐 ブラウザのページ内容をLLM（GitHub Copilot / ローカルLLM）で解析・対話・自動操作するChrome拡張機能

[English version](README.md)

## ✨ 特徴

- **ページ解析**: 現在表示中のWebページをLLMが理解し、質問に回答
- **ブラウザ自動操作**: クリック、入力、スクロールなどをLLMが自動実行
- **3つの動作モード**:
  - 📝 **テキストモード**: DOM解析ベース（高速・軽量）
  - 📸 **スクリーンショットモード**: Vision APIで視覚的理解
  - 🔄 **ハイブリッドモード**: テキスト優先、失敗時スクリーンショット
- **ポリシー付き入力支援**: 検証した入力欄へ値を入力し、最終送信は本人操作に残します。Playwright CLIは実行経路として有効化していません。
- **右クリックメニュー＆クイックアクション**: ページの要約、SNS向けポスト生成、自分で設定したカスタムプロンプトを、右クリックメニューと応答後のボタンから実行できます。ポスト生成は、2つのトーン（カジュアル / フォーマル）と2つの長さ（約140字を目安、または具体例を足した約500字を目安）をサブメニューから選べ、構成（結論・箇条書き・引用元URL・ハッシュタグ）を整え、開いているページのURLを自動挿入します。チャットのクイックアクションには長さトグル（140 / 500）があり、4種すべてを切り替えられます。カスタムプロンプトの名前と内容は設定画面で編集できます。

## 🚀 インストール

### 開発版（ローカルインストール）

1. このリポジトリをクローン
2. `npm install` で依存関係をインストール
3. `npm run build` でビルド
4. `chrome://extensions` を開く
5. 「デベロッパーモード」を有効化
6. 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3` フォルダを選択

### 実拡張の回帰テスト

`npm run build` 後、`npm run test:installed` で専用の表示Chromiumに実拡張を読み込めます。導入済みPlaywrightとChromiumが必要です。モジュールが見つからない場合は `--playwright-module` で指定します。PowerShellでワークスペースの既存環境を使う実行例は `npm.cmd run test:installed -- --playwright-module=../../split-shortcut/node_modules/playwright/index.mjs` です。`npm.cmd` と値付きオプションで引数の欠落を防ぎます。

Chrome APIはモックせず、ストレージ、タブ・ドキュメント指定、iframe／Shadow DOM取得、フォーム入力の読み戻し、未送信、バックグラウンドからの実ダウンロードと保存本文を確認します。接続情報を遅らせた起動キュー保持と、未許可ホストのモデル送信前停止も検証します。通常ブラウザには接続せず、一時プロファイル・ダウンロードは終了時に削除します。画面証跡は既定で `.output/installed-extension-evidence` に保存し、`--output-dir` で変更できます。

モデル応答はローカルfixtureです。また、実拡張ページを専用タブで開くため、Chromeのネイティブサイドパネルそのもの、権限の承認・撤回、実モデルとの接続、通常プロファイルへのCLI接続は未検証です。権限ダイアログは自動承認しません。

右クリックの待機操作は、ブリッジ接続・機能確認・現在の処理が完了するまで保持します。起動直後に操作が消える代わりに、待機状態を表示して準備完了後に実行します。

### Chrome Web Store

✅ 公開中: [Chrome Web Store からインストール](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)

## 📋 必要条件

- **必須（常時）**: ローカル bridge server（[AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) または `standalone-bridge` の standalone companion）
- **LLMプロバイダー**: **GitHub Copilot サブスクリプション**（Copilotプロバイダーを使う場合のみ）または **ローカルLLM**（LM Studio等）

> GitHub Copilot SDK / GitHub Copilot CLI provider を使う場合は、VS Code bridge または standalone companion のローカル bridge プロセスが必要です。Chrome Web Store 版単体ではローカル SDK / CLI プロセスを起動できません。

## 🎮 使い方

1. ローカル bridge を起動（VS Code 拡張の自動起動、または `standalone-bridge` で `npm run start -- --port 3210 --workspace-root ..`）
2. Chrome拡張機能のサイドパネルを開く
3. 任意のWebページで質問や操作指示を入力

### 操作例

### カスタム指示と入力支援

設定は「指示・投稿」「個人情報」「接続・動作」のタブに分かれます。矢印キー・Home・Endでタブ移動、Escで設定を閉じられます。開閉してもチャットの下書きと添付は保持します。チャット上部でも指示プロフィールを選択でき、応答生成中はプロフィールの入れ替えと履歴消去を無効にします。

「ページを読み取る」でモデルを呼ばずにページを確認できます。未取得・取得済み・部分取得・対象外・権限不足を表示し、必要時だけ「このサイトを許可」を表示します。接続未準備の間は理由を表示して送信を無効にしますが、下書きは編集できます。

IME変換確定のEnterでは送信しません。添付は読み込み中とファイル別エラーを表示し、成功分を残します。個人プロフィール保存中は編集と設定の閉じる操作を無効にし、未保存・保存済み・消去済み・失敗を区別します。操作結果や停止通知は回答と分け、回答用のコピー・保存・継続操作を表示しません。

過去の会話を読み返している間は、本文が追加されてもスクロール位置を保持します。「最新の応答へ」または新しい質問の送信で自動追従を再開します。過去の回答にも個別の保存ボタンがあり、保存時に開いている別タブではなく、回答生成時のページ名・URLと選択した本文を保存します。参照元がない履歴は不明として扱い、保存名は重複を避ける識別子付きです。保存結果は選んだ回答の近くにも表示します。

停止時は空の応答枠を除いて停止通知を表示し、受信済み本文を「中断した部分回答」として残します。中止・通信切断による部分回答はMarkdown・ブログ下書きにも未完了と記録します。生成中・保存中は保存ボタンを無効にし、正常終了した回答は部分回答として扱いません。

個人情報の入力先は、許可したサイトと同じオリジンの検証済みドキュメントに限定します。別サイト・オリジン不明のiframeへの入力は拒否します。設定の読み込みとタブ別の保護登録を入力前に完了させ、ストレージ障害時は送信・入力を停止します。複数要素に一致するセレクタも拒否します。

ループ上限は設定・保存・実行すべてで1～50回、既定20回です。現行ポリシーでは旧高リスク操作トグルを表示しません。自動ファイル出力は自動操作モード以外と個人情報タスクで無効です。本人が押す保存ボタンとは別の許可です。

開発依存にはWXT関連とVitestの監査警告が残っています。信頼済みfixtureの有限テストだけを実行し、開発サーバーを外部公開したり、不明なアーカイブ・画像を処理したりしないでください。`npm audit fix --force` は使用せず、WXT・Sharp・Vitestの移行互換性を別途確認します。Chromeの実行時依存監査は警告0件ですが、全依存の監査完了を意味しません。

- Chrome拡張とローカルブリッジは同時に更新してください。新しいサイドパネルは `/capabilities` の `contextVersion: 1` を確認します。旧ブリッジでは更新・再起動を案内して停止します。
- **Global instructions** は共通指示、**Active profile** は名前付きプロフィールです。**Post menu name / Post instructions** で投稿用の名前と専用指示を編集できます。投稿・カスタムメニューの履歴は通常チャットと分離します。
- **Browser operation** は **Read only** が既定です。**Assist with input** は入力・選択、**Browser automation** は追加で限定的な移動・リンク操作を許可します。効果が不明なボタン、最終送信、アップロード、任意スクリプトは自動実行しません。
- ページ情報はアクセス可能なフレームと開いたShadow DOMも対象にします。空の結果は一度だけ待機して再取得し、権限不足はサイト単位の許可操作を表示します。保護ページなどの取得は保証しません。
- 個人プロフィールは既定でブラウザセッション内だけに保存します。**Remember on this device** で端末内保存を選択できますが、同期や資格情報保管庫ではありません。パスワード・MFA・決済情報は対象外です。
- 対象ページを一度読み取った後、サイト名付きのチェックボックスで次の入力タスクに限り使用を許可します。値はローカルで補完し、モデルへ送るテキストからマスクします。入力後は実値を読み戻して停止し、そのタブをブラウザセッション中の後続AI操作から除外します。以降は本人操作または新規タブを使ってください。個人情報が登録されている間、自動スクリーンショット送信は無効です。
- 現在の実行経路は拡張機能のDOM操作です。Playwright CLI/MCP/CDPは自動導入・接続しておらず、別途セッション確認と実行経路の統合が必要です。

```
「このページの内容を要約して」
「テストを受けるボタンをクリックして」
「フォームに名前を入力して、送信せず止めて」
```

## 🩹 トラブルシュート

- 要約/翻訳で「ページ本文を取得できない」と表示される場合:
  1. 対象ページを再読み込みして再実行する
  2. `chrome://` `edge://` `about:` `chrome-extension://` などのシステムページでないことを確認する
  3. 同じタブからサイドパネルを開き直して再実行する
  4. 必要ならページ本文をチャットに貼り付けてフォールバックする

## ⚙️ 設定

サイドパネルの設定ボタンから以下を設定可能:

- **プロバイダー**: Auto / GitHub Copilot via VS Code / LM Studio
  - Auto は VS Code bridge 利用時に VS Code Language Model API を優先します。GitHub Copilot CLI は最後の回答 fallback としてのみ使います
  - GitHub Copilot SDK / CLI は通常の provider 選択ではなく、Bridge 状態の診断または advanced fallback として表示します
  - 設定画面の **Auto 経路** で、現在の動作モードに応じた provider 順序と状態を確認できます
- **Bridge 状態**: local bridge version と各 provider（VS Code LM / Copilot SDK / Copilot CLI / LM Studio）の利用状態を確認できます
- **モデル選択**: bridge から実際に返った user-visible な Copilot モデルだけを表示します。live list が取得できない時は固定 fallback model を選択可能にしません
- **ブラウザ操作**: サイドパネルからの自動ブラウザ操作を許可/無効化できます
- **ファイル操作**: bridge 経由の生成ファイル保存を許可/無効化できます
- **動作モード**: テキスト / スクリーンショット / ハイブリッド
- **最大ループ数**: Agent / SDK / CLI / Auto 利用時の自動操作の最大繰り返し回数
- **高リスク操作 / Evaluate操作の許可**: 互換性のため残す旧設定です。新しいタスクポリシーの制限を解除することはできません。
- **保存先モード**: 生成した Markdown をブラウザのダウンロードフォルダ、または bridge の workspace-root 相対パスへ保存できます
- **既定の相対保存パス**: `output/blog` のような既定 path を設定できます

### 保存と添付

- **deterministic 保存ボタン**: 最新の assistant 応答をそのまま Markdown またはブログ下書きとして保存できます
- **workspace fallback**: workspace 相対保存を選んでいても、VS Code で workspace が開いていない場合はブラウザのダウンロードへフォールバックします
- **D&D 添付 (v1)**: text ファイルと画像をチャット面または入力欄へそのままドロップして添付できます
- **PDF fallback**: PDF は添付コンテキストとして受け付けますが、v1 では本文抽出を行いません

VS Code とは接続できているのにモデル一覧の取得に失敗した場合は、設定パネルに警告を表示し、更新が成功するまで Copilot モデル選択を無効化します。要約/翻訳などでページ本文を取得できない場合は、LLM へ送る前にサイドパネルで停止し、再読み込み・対象URL確認・モード変更・本文貼り付けを促します。

### Evaluate 許可境界の確認手順

1. 設定で **Evaluate操作の許可** を OFF にする
2. `waitForSelector` を実行し、通常のDOM操作として実行されることを確認する
3. 明示的な `playwright browser_evaluate` 指示は拒否されることを確認する
4. 必要時のみ Evaluate を ON にし、実行後は OFF に戻す

## 🔧 開発

```bash
# 開発サーバー起動
npm run dev

# 単体テスト
npm run test

# Lint
npm run lint

# 型チェック
npm run typecheck

# ビルド
npm run build

# Chrome / VS Code 間の整合チェック
npm run validate:bridge

# ZIP作成（Chrome Web Store用）
npm run zip
```

## 📄 ライセンス

CC BY-NC-SA 4.0 © [aktsmm](https://github.com/aktsmm)

## 📑 サードパーティ通知

- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)

## 🔒 プライバシーポリシー

0.1.23向け更新（2026-09-22）。利用者が選択した情報をブラウザ支援のために処理します。開発者への解析・広告テレメトリ送信は行いません。

### データ収集について

- **送信情報**: 質問、指示、ページ本文・URL・タイトル、添付、有効なスクリーンショットをローカルブリッジへ送り、その先の選択したモデル（GitHub Copilot等）へ送信します。プロバイダーへ渡したくない情報は入力・添付しないでください。
- **保存**: 設定と指示プロフィールは拡張機能のローカル領域、会話はサイドパネルのメモリに保持します。本人が保存した回答はダウンロードまたはブリッジの指定先へ書き込みます。
- **任意の個人プロフィール**: 氏名・メール・電話・郵便番号・住所は既定でブラウザセッション内に保存し、端末保存を選択した場合だけローカル永続化します。同期・暗号化資格情報保管庫ではありません。Clear profileで保存値を消去できます。パスワード・MFA・決済情報は対象外です。
- **入力先とモデル**: モデルには許可した項目名・参照記号を渡し、実値はローカルで補完します。入力先ページは送信ボタンを押す前から実値を読めます。保存済みの値は送信テキストからマスクし、値登録中は画像送信を停止します。プロフィール入力後のタブは同じブラウザセッションの後続AI操作から除外します。ただし任意のページ・画像・添付からすべての個人情報を除去する保証ではありません。
- **開発者による利用**: 販売・広告利用・開発者向け解析送信は行いません。選択したモデルと入力先サイトには各提供者のポリシーが適用されます。拡張を削除すると拡張内保存領域が削除されますが、保存済みファイルは別途削除してください。

### 権限の使用目的

| 権限             | 目的                                                             |
| ---------------- | ---------------------------------------------------------------- |
| activeTab        | 現在のページ内容を取得するため                                   |
| tabs             | タブ情報（URL、タイトル）を取得するため                          |
| scripting        | ページのDOM要素を解析するため                                    |
| storage          | 設定・指示・任意の個人プロフィール・保護状態を保存するため |
| sidePanel        | チャットUIを表示するため                                         |
| host_permissions | placeholder の content script をローカル開発ページに限定するため |
| optional_host_permissions | 利用者が明示的に許可したサイトの本文取得・DOM操作 |
| contextMenus | 右クリックから対象ページのタスクを開始 |
| downloads | 利用者が要求した回答ファイルを保存 |

静的ホスト権限はループバックに限定しています。ページ取得には有効な一時activeTab権限またはサイト単位の明示許可が必要で、サイドパネルを開いたままにするだけでは別のタブのアクセス権限は得られません。取得情報はローカルブリッジを経由して選択したモデルへ送ります。

### LLMへのデータ送信

- **GitHub Copilot使用時**: ページ内容はローカル bridge 経由で GitHub Copilot サービスへ送信されます
- **ローカルLLM使用時**: ブリッジはループバックのエンドポイントだけを受け付けます。そのサーバーがさらに外部へ転送するかはサーバー側の設定に依存します。

## 🔗 関連プロジェクト

- [AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) - 必須のVS Code拡張機能

## 👤 Author

yamapan (https://github.com/aktsmm)
