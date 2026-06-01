# GitHub Copilot Browser Bridge (Chrome Extension)

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-live-brightgreen?logo=google-chrome)](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/aktsmm/copilot-browser-bridge?style=social)](https://github.com/aktsmm/copilot-browser-bridge)

🌐 ブラウザのページ内容をLLM（GitHub Copilot / ローカルLLM）で解析・対話・自動操作するChrome拡張機能

[English version](README.md)

## ✨ 特徴

- **ページ解析**: 現在表示中のWebページをLLMが理解し、質問に回答
- **ブラウザ自動操作**: クリック、入力、スクロールなどをLLMが自動実行
- **3つの動作モード**:
  - 📝 **テキストモード**: DOM解析ベース（高速・軽量）
  - 📸 **スクリーンショットモード**: Vision APIで視覚的理解
  - 🔄 **ハイブリッドモード**: テキスト優先、失敗時スクリーンショット
- **Playwright互換アクション**: ダブルクリック、右クリック、フォーム一括入力など

## 🚀 インストール

### 開発版（ローカルインストール）

1. このリポジトリをクローン
2. `npm install` で依存関係をインストール
3. `npm run build` でビルド
4. `chrome://extensions` を開く
5. 「デベロッパーモード」を有効化
6. 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3` フォルダを選択

### Chrome Web Store

✅ 公開中: [Chrome Web Store からインストール](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)

## 📋 必要条件

- **必須（常時）**: ローカル bridge server（[GitHub Copilot Browser Bridge for VS Code](https://github.com/aktsmm/copilot-browser-bridge-vscode) または `standalone-bridge` の standalone companion）
- **LLMプロバイダー**: **GitHub Copilot サブスクリプション**（Copilotプロバイダーを使う場合のみ）または **ローカルLLM**（LM Studio等）

> GitHub Copilot SDK / GitHub Copilot CLI provider を使う場合は、VS Code bridge または standalone companion のローカル bridge プロセスが必要です。Chrome Web Store 版単体ではローカル SDK / CLI プロセスを起動できません。

## 🎮 使い方

1. ローカル bridge を起動（VS Code 拡張の自動起動、または `standalone-bridge` で `npm run start -- --port 3210 --workspace-root ..`）
2. Chrome拡張機能のサイドパネルを開く
3. 任意のWebページで質問や操作指示を入力

### 操作例

```
「このページの内容を要約して」
「テストを受けるボタンをクリックして」
「フォームに名前を入力して送信して」
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
- **高リスク操作 / Evaluate操作の許可**: `newTab` / `closeTab` / Playwright `browser_evaluate` などの安全トグル。Chrome 拡張内の direct `evaluate` はセキュリティ上ブロックされ、Playwright Evaluate は既定で無効です
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

この拡張機能は、ユーザーのプライバシーを尊重します。

### データ収集について

- **個人情報の収集**: 行いません
- **データの外部送信**: ページ内容はローカルのVS Code拡張機能にのみ送信されます（localhost通信）
- **データの保存**: ユーザー設定のみローカルストレージに保存します
- **第三者への提供**: 一切行いません

### 権限の使用目的

| 権限             | 目的                                                             |
| ---------------- | ---------------------------------------------------------------- |
| activeTab        | 現在のページ内容を取得するため                                   |
| tabs             | タブ情報（URL、タイトル）を取得するため                          |
| scripting        | ページのDOM要素を解析するため                                    |
| storage          | ユーザー設定を保存するため                                       |
| sidePanel        | チャットUIを表示するため                                         |
| host_permissions | placeholder の content script をローカル開発ページに限定するため |

広い静的サイトアクセス権限は要求せず、現在のページ読み取りはユーザーが明示的にサイドパネルを開いたり拡張機能を起動したタブに対して `activeTab` 経由で行います。取得したページ内容はまずローカル bridge (`localhost`) にのみ送信され、その後はユーザーが選択した LLM プロバイダーへ送られます。

### LLMへのデータ送信

- **GitHub Copilot使用時**: ページ内容はローカル bridge 経由で GitHub Copilot サービスへ送信されます
- **ローカルLLM使用時**: すべてのデータはローカルで処理され、外部に送信されません

## 🔗 関連プロジェクト

- [GitHub Copilot Browser Bridge for VS Code](https://github.com/aktsmm/copilot-browser-bridge-vscode) - 必須のVS Code拡張機能

## 👤 Author

yamapan (https://github.com/aktsmm)
