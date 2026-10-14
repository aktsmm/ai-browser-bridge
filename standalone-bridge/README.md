# AI Browser Bridge Standalone Companion

VS Code 拡張を起動しなくても `localhost` bridge を提供する companion app です。Codex CLI / Claude Code / GitHub Copilot CLI / GitHub Copilot SDK / LM Studio を、VS Code なしで Chrome sidepanel から使えます。

## ポートと優先順位

- VS Code 拡張: 既定 `3210`、standalone: 既定 `3211`（衝突しないよう分けています）
- Chrome 拡張の接続先は既定で **自動**（VS Code → standalone の順に `/health` を試し、最初に応答した方を使う）
- Settings の「接続先」で VS Code のみ / standalone のみに固定できます。ポートも Settings で変更できます
- VS Code を後から起動した場合は、ヘッダーの再接続ボタンで再判定します

## できること

- Chrome sidepanel が既存の `/health` `/models` `/capabilities` `/chat` `/file` 契約で接続できる
- GitHub Copilot SDK / GitHub Copilot CLI / LM Studio をローカル Node プロセスで使える
- `workspace-relative` 保存を `--workspace-root` 配下に行える
- Playwright MCP HTTP endpoint (`/call`) が起動していれば `/playwright/status` と `/playwright` を proxy できる

## まだできないこと

- VS Code Language Model API (`copilot` / `copilot-agent`) は使えません
- Playwright MCP 自体の起動は行いません。既定では `http://127.0.0.1:3001/call` を確認します

## セットアップ

```powershell
cd standalone-bridge
npm ci
npm run build
```

## 起動

```powershell
cd standalone-bridge
npm run start -- --port 3211 --workspace-root ..
```

Playwright MCP endpoint を変える場合:

```powershell
npm run start -- --port 3211 --workspace-root .. --playwright-mcp-endpoint http://127.0.0.1:3001/call
```

開発時:

```powershell
npm run dev -- --port 3211 --workspace-root ..
```

## Windows でログオン時に自動起動する

管理者権限は不要です。`build` 済みであることを確認してから実行します。既定は dry-run で、`-Apply` を付けたときだけスタートアップフォルダーへ非表示のランチャーを作ります。

```powershell
.\scripts\install-startup.ps1                                  # dry-run
.\scripts\install-startup.ps1 -Apply -Port 3211 -WorkspaceRoot $HOME
.\scripts\uninstall-startup.ps1 -Apply                        # 解除（起動中の bridge は停止しません）
```

同じポートで既に bridge が動いていると、後から起動したプロセスは「ポート使用中」を出して終了します。

## オプション

- `--port`, `-p`: bridge port (既定: `3211`)
- `--workspace-root`, `-w`: `workspace-relative` 保存の基準ディレクトリ
- `--allow-origin`, `-o`: 追加の `chrome-extension://...` origin
- `--playwright-mcp-endpoint`: Playwright MCP HTTP `/call` endpoint (既定: `http://127.0.0.1:3001/call`)

環境変数でも指定できます。

- `COPILOT_BROWSER_BRIDGE_PORT`
- `COPILOT_BROWSER_BRIDGE_WORKSPACE_ROOT`
- `COPILOT_BROWSER_BRIDGE_ALLOWED_ORIGINS` (comma-separated)
- `COPILOT_BROWSER_BRIDGE_PLAYWRIGHT_MCP_ENDPOINT`

## Chrome 側の使い方

1. standalone bridge を起動する
2. Chrome extension の Settings で「接続先」を **自動** または **standalone のみ** にし、standalone ポートを合わせる
3. provider は **Auto / GitHub Copilot SDK / GitHub Copilot CLI / Codex CLI / Claude Code / LM Studio** を使う
4. `copilot` / `copilot-agent` は VS Code bridge 専用なので選ばない

## 検証

```powershell
npm run test
npm run lint
npm run build
```
