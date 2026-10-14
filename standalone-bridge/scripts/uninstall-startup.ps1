<#
.SYNOPSIS
  install-startup.ps1 が作ったスタートアップのランチャーを削除する。
.DESCRIPTION
  既定は dry-run。-Apply を付けたときだけ削除する。起動中の bridge プロセスは停止しない。
#>
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'

$launcher = Join-Path ([Environment]::GetFolderPath('Startup')) 'ai-browser-bridge-standalone.vbs'
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Output "登録されていません: $launcher"
  return
}

Write-Output "Launcher : $launcher"
if (-not $Apply) {
  Write-Output 'dry-run: 削除していません。削除するには -Apply を付けて再実行してください。'
  return
}

Remove-Item -LiteralPath $launcher
Write-Output '削除しました。起動中の bridge はそのまま動き続けます（必要なら node プロセスを手動で終了してください）。'
