export type Language = "ja" | "en";

export const translations = {
  ja: {
    // Header
    appTitle: "🤖 GitHub Copilot Browser Bridge",
    reconnect: "再接続",
    settings: "設定",

    // Connection
    connectionError:
      "⚠️ VS Codeとの接続に失敗しました。VS Codeが起動しているか確認してください。",
    reconnectLink: "再接続",

    // Chat
    welcome: "👋",
    welcomeMessage: "ページについて質問してください",
    welcomeExample: "例: このページを要約して",
    inputPlaceholder: "メッセージを入力...",
    send: "送信",
    stop: "停止",
    clear: "🗑️ クリア",
    executionResult: "🤖 実行結果:",
    copy: "コピー",
    copied: "コピー済み",
    screenshotPermissionWarning:
      "⚠️ スクリーンショット権限が未付与です。拡張機能アイコンを一度クリックするか、権限変更後は拡張を削除→再インストールしてください。",
    emptyServerResponse:
      "⚠️ サーバーから空の応答が返されました。もう一度お試しください。",
    emptyContinuationResponse:
      "⚠️ 続行応答が空だったため、自律実行を停止しました。",
    maxAgentLoopsReached:
      "⚠️ 最大ループ回数 ({count}) に達したため、自律実行を停止しました。",
    repeatedActionFailures:
      "⚠️ 同じ失敗が続いたため、自律実行を停止しました。ページ状態を確認してから再試行してください。",
    systemPageUnsupported:
      "[システムページ: {url}] - このページの内容は取得できません",
    highRiskActionBlocked:
      "⚠️ 高リスク操作は設定で無効のためスキップしました: {types}",
    highRiskActionBlockedAll:
      "⚠️ 提案された操作はすべて高リスクのため実行しませんでした。設定の「高リスク操作を許可」を有効にすると続行できます。",
    fullAutoMigrationNotice:
      "ℹ️ UX改善のため初回のみフルオート設定へ移行しました（ブラウザ操作/高リスク操作）。Evaluate は既定で無効のままです。必要なら設定で変更できます。",
    loopContinuationPrompt:
      "アクション実行結果 (Loop {loop}):\n{results}\n\n続けてください。エラーがあれば別の方法を試してください。完了したら「完了」と報告してください。",
    showInFolder: "フォルダで表示",
    downloadFailedDefault: "ダウンロードに失敗しました",
    base64DecodeError: "Base64デコードエラー: {path}",
    downloadComplete: "ダウンロード完了",
    downloadDestination: "保存先: ブラウザのダウンロードフォルダ",
    saveDestination: "保存先モード",
    saveDestinationDesc: "生成ファイルの保存先を選びます",
    saveDestinationDownloads: "ブラウザのダウンロードフォルダ",
    saveDestinationWorkspace: "VS Code ワークスペース相対",
    saveRelativePath: "既定の相対保存パス",
    saveRelativePathDesc:
      "例: output/blog。未設定またはワークスペース未オープン時はブラウザのダウンロードへ保存します。",
    saveMarkdownAction: "保存",
    saveBlogDraftAction: "ブログ用に保存",
    attachFiles: "添付",
    attachedFiles: "添付ファイル",
    attachmentTextLabel: "テキスト",
    attachmentImageLabel: "画像",
    dropFilesHere: "ここにファイルをドロップ",
    attachmentUnsupported:
      "このファイル形式は未対応です。text / image / pdf を使ってください。",
    attachmentTooLarge: "ファイルが大きすぎます。サイズを小さくして再試行してください。",
    attachmentLimitReached: "添付は最大 {count} 件までです。",
    pdfAttachmentFallback:
      "PDF は v1 では本文抽出しません。ファイル名のみコンテキストに含めます。",
    screenshotAttachedContext:
      "[スクリーンショット添付済み - 画像を見て現在の状態を理解してください]",
    screenshotAttachedShort: "[スクリーンショット添付済み]",
    saveSuccess: "保存しました: {path}",
    saveFailure: "保存に失敗しました: {reason}",
    saveFailureUnknownReason: "不明なエラー",
    saveFailureNoAssistantResponse: "保存対象の assistant 応答がありません",
    saveFailureInvalidPath: "保存パスが不正です",
    saveFailurePathEscapesWorkspace:
      "保存パスがワークスペースの外を指しています",
    saveFailureNotAFile: "保存先がファイルではありません",
    saveFailureFileAlreadyExists: "同名のファイルが既に存在します",
    savedToWorkspace: "保存先: VS Code ワークスペース",
    savedToDownloads: "保存先: ブラウザのダウンロードフォルダ",

    // Settings
    settingsTitle: "設定",
    provider: "プロバイダー",
    model: "モデル",
    refresh: "🔄 更新",
    modelNotConnected:
      "※ VS Code未接続のため GitHub Copilot の既定モデルを表示中",
    modelFetchFailed:
      "⚠️ VS Code への接続はありますが、GitHub Copilot のモデル一覧取得に失敗しました。更新を再試行してください。",
    endpoint: "エンドポイント",
    modelName: "モデル名 (空欄で自動検出)",
    browserActions: "ブラウザ操作",
    browserActionsDesc: "AIがブラウザを自動操作",
    fileOperations: "ファイル操作",
    fileOperationsDesc: "AIがワークスペースにファイル作成",
    language: "言語",
    serverPort: "サーバーポート",
    serverPortDesc: "VS Code拡張サーバーの接続先ポート (1-65535)",
    allowHighRiskActions: "高リスク操作を許可",
    allowHighRiskActionsDesc:
      "newTab / closeTab / Playwright browser_evaluate などの高リスク操作を実行可能にします。無効時は自動実行しません。",
    allowEvaluateAction: "Playwright Evaluate操作を許可",
    allowEvaluateActionDesc:
      "高リスク操作。Playwright browser_evaluate を必要時のみ有効化し、意図しないスクリプト実行に注意してください。Chrome 拡張内の direct evaluate は常にブロックされます。",
    allowEvaluateActionDisabledHint:
      "「高リスク操作を許可」が無効の間は Playwright Evaluate 操作を変更できません。",
    copilotAgentDesc: "GitHub Copilot Agent, @workspace, ツール使用可",
    modelSelectAria: "モデル選択",
  },
  en: {
    // Header
    appTitle: "🤖 GitHub Copilot Browser Bridge",
    reconnect: "Reconnect",
    settings: "Settings",

    // Connection
    connectionError:
      "⚠️ Failed to connect to VS Code. Please check if VS Code is running.",
    reconnectLink: "Reconnect",

    // Chat
    welcome: "👋",
    welcomeMessage: "Ask questions about the page",
    welcomeExample: "Example: Summarize this page",
    inputPlaceholder: "Enter message...",
    send: "Send",
    stop: "Stop",
    clear: "🗑️ Clear",
    executionResult: "🤖 Execution Result:",
    copy: "Copy",
    copied: "Copied",
    screenshotPermissionWarning:
      "⚠️ Screenshot permission is not granted. Click the extension icon once, or reinstall the extension after changing permissions.",
    emptyServerResponse:
      "⚠️ Server returned an empty response. Please try again.",
    emptyContinuationResponse:
      "⚠️ Continuation response was empty, so autonomous execution was stopped.",
    maxAgentLoopsReached:
      "⚠️ Reached maximum loop count ({count}), so autonomous execution was stopped.",
    repeatedActionFailures:
      "⚠️ Autonomous execution stopped after repeated action failures. Check the current page state and try again.",
    systemPageUnsupported:
      "[System page: {url}] - Cannot access content on this page",
    highRiskActionBlocked:
      "⚠️ High-risk actions are disabled in settings and were skipped: {types}",
    highRiskActionBlockedAll:
      '⚠️ All suggested actions were high-risk and were not executed. Enable "Allow High-Risk Actions" in settings to continue.',
    fullAutoMigrationNotice:
      "ℹ️ To improve UX, settings were migrated to full-auto once (Browser Actions / High-Risk Actions). Evaluate remains disabled by default. You can change it in Settings anytime.",
    loopContinuationPrompt:
      'Action execution result (Loop {loop}):\n{results}\n\nPlease continue. If there are errors, try another approach. Report "completed" once finished.',
    showInFolder: "Show in folder",
    downloadFailedDefault: "Download failed",
    base64DecodeError: "Base64 decode error: {path}",
    downloadComplete: "Download complete",
    downloadDestination: "Saved to: browser downloads folder",
    saveDestination: "Save Destination",
    saveDestinationDesc: "Choose where generated files should be saved",
    saveDestinationDownloads: "Browser downloads folder",
    saveDestinationWorkspace: "VS Code workspace-relative",
    saveRelativePath: "Default relative save path",
    saveRelativePathDesc:
      "Example: output/blog. If empty or no workspace is open, files fall back to browser downloads.",
    saveMarkdownAction: "Save",
    saveBlogDraftAction: "Save for Blog",
    attachFiles: "Attach",
    attachedFiles: "Attached files",
    attachmentTextLabel: "text",
    attachmentImageLabel: "image",
    dropFilesHere: "Drop files here",
    attachmentUnsupported:
      "This file type is not supported yet. Use text, image, or PDF files.",
    attachmentTooLarge:
      "The file is too large. Reduce the size and try again.",
    attachmentLimitReached: "You can attach up to {count} files.",
    pdfAttachmentFallback:
      "PDF text extraction is not included in v1. Only the file name will be sent as context.",
    screenshotAttachedContext:
      "[Screenshot attached - use the image to understand the current page state]",
    screenshotAttachedShort: "[Screenshot attached]",
    saveSuccess: "Saved: {path}",
    saveFailure: "Save failed: {reason}",
    saveFailureUnknownReason: "Unknown error",
    saveFailureNoAssistantResponse: "No assistant response is available to save",
    saveFailureInvalidPath: "The save path is invalid",
    saveFailurePathEscapesWorkspace:
      "The save path points outside the workspace",
    saveFailureNotAFile: "The target save path is not a file",
    saveFailureFileAlreadyExists:
      "A file with the same name already exists",
    savedToWorkspace: "Saved to: VS Code workspace",
    savedToDownloads: "Saved to: browser downloads folder",

    // Settings
    settingsTitle: "Settings",
    provider: "Provider",
    model: "Model",
    refresh: "🔄 Refresh",
    modelNotConnected:
      "※ Showing default GitHub Copilot models (VS Code not connected)",
    modelFetchFailed:
      "⚠️ Connected to VS Code, but failed to load the GitHub Copilot model list. Please refresh and try again.",
    endpoint: "Endpoint",
    modelName: "Model name (auto-detect if empty)",
    browserActions: "Browser Actions",
    browserActionsDesc: "AI controls browser automatically",
    fileOperations: "File Operations",
    fileOperationsDesc: "AI creates files in workspace",
    language: "Language",
    serverPort: "Server Port",
    serverPortDesc: "Target port of the VS Code bridge server (1-65535)",
    allowHighRiskActions: "Allow High-Risk Actions",
    allowHighRiskActionsDesc:
      "Allows high-risk actions such as newTab / closeTab / Playwright browser_evaluate. When disabled, these actions are not executed.",
    allowEvaluateAction: "Allow Playwright Evaluate Action",
    allowEvaluateActionDesc:
      "High-risk operation. Enable Playwright browser_evaluate only when needed and review generated scripts carefully. Direct evaluate actions in the Chrome extension are always blocked.",
    allowEvaluateActionDisabledHint:
      'You cannot change Playwright Evaluate while "Allow High-Risk Actions" is disabled.',
    copilotAgentDesc: "GitHub Copilot Agent, @workspace, tools enabled",
    modelSelectAria: "Model selection",
  },
};

export function t(key: keyof typeof translations.ja, lang: Language): string {
  const dictionary =
    lang === "ja" || lang === "en" ? translations[lang] : translations.en;
  return dictionary[key];
}
