<#
.SYNOPSIS
  standalone bridge を Windows ログオン時に非表示で自動起動する（管理者権限不要）。
.DESCRIPTION
  既定は dry-run（何も書き込まない）。-Apply を付けたときだけスタートアップフォルダへランチャーを作る。
  事前に standalone-bridge で `npm ci` と `npm run build` を済ませておくこと。
#>
[CmdletBinding()]
param(
  [int]$Port = 3211,
  [string]$WorkspaceRoot = $HOME,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$bridgeRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $bridgeRoot 'out\src\index.js'
$startupDir = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startupDir 'ai-browser-bridge-standalone.vbs'

$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { throw 'node が見つかりません。Node.js をインストールしてください。' }
if (-not (Test-Path -LiteralPath $entry)) {
  throw "ビルド済みファイルがありません: $entry`nstandalone-bridge で 'npm ci' と 'npm run build' を実行してください。"
}
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port が範囲外です: $Port" }
if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) { throw "WorkspaceRoot が存在しません: $WorkspaceRoot" }

# VBScript の文字列リテラル内では " を "" にする
function ConvertTo-VbsArg([string]$value) { '""' + $value + '""' }
$command = '"' + ((ConvertTo-VbsArg $node.Source) + ' ' + (ConvertTo-VbsArg $entry) +
  " --port $Port --workspace-root " + (ConvertTo-VbsArg $WorkspaceRoot)) + '"'
$content = "CreateObject(""WScript.Shell"").Run $command, 0, False`r`n"

Write-Output "Launcher : $launcher"
Write-Output "Command  : $($node.Source) $entry --port $Port --workspace-root $WorkspaceRoot"
if (-not $Apply) {
  Write-Output 'dry-run: 変更していません。反映するには -Apply を付けて再実行してください。'
  return
}

[System.IO.File]::WriteAllText($launcher, $content, [System.Text.Encoding]::Unicode)
Write-Output "登録しました。次回ログオン時に起動します。今すぐ起動するには: wscript.exe `"$launcher`""
