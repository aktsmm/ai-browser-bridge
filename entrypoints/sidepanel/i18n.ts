export type Language = "ja" | "en";

export const translations = {
  ja: {
    // Header
    appTitle: "🤖 Copilot Bridge",
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
      "ℹ️ UX改善のため初回のみフルオート設定へ移行しました（ブラウザ操作/高リスク操作/Evaluate）。必要なら設定で変更できます。",
    loopContinuationPrompt:
      "アクション実行結果 (Loop {loop}):\n{results}\n\n続けてください。エラーがあれば別の方法を試してください。完了したら「完了」と報告してください。",
    showInFolder: "フォルダで表示",
    downloadFailedDefault: "ダウンロードに失敗しました",
    base64DecodeError: "Base64デコードエラー: {path}",
    downloadComplete: "ダウンロード完了",
    downloadDestination: "保存先: ブラウザのダウンロードフォルダ",

    // Settings
    settingsTitle: "設定",
    provider: "プロバイダー",
    model: "モデル",
    refresh: "🔄 更新",
    modelNotConnected: "※ VS Code未接続のため既定モデル表示中",
    modelFetchFailed:
      "⚠️ VS Code への接続はありますが、モデル一覧の取得に失敗しました。更新を再試行してください。",
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
      "newTab / closeTab / evaluate などの高リスク操作を実行可能にします。無効時は自動実行しません。",
    allowEvaluateAction: "Evaluate操作を許可",
    allowEvaluateActionDesc:
      "高リスク操作。必要時のみ有効化し、意図しないスクリプト実行に注意してください。",
    allowEvaluateActionDisabledHint:
      "「高リスク操作を許可」が無効の間は Evaluate 操作を変更できません。",
    copilotAgentDesc: "@workspace, ツール使用可",
    modelSelectAria: "モデル選択",
  },
  en: {
    // Header
    appTitle: "🤖 Copilot Bridge",
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
      "ℹ️ To improve UX, settings were migrated to full-auto once (Browser Actions / High-Risk Actions / Evaluate). You can change them in Settings anytime.",
    loopContinuationPrompt:
      'Action execution result (Loop {loop}):\n{results}\n\nPlease continue. If there are errors, try another approach. Report "completed" once finished.',
    showInFolder: "Show in folder",
    downloadFailedDefault: "Download failed",
    base64DecodeError: "Base64 decode error: {path}",
    downloadComplete: "Download complete",
    downloadDestination: "Saved to: browser downloads folder",

    // Settings
    settingsTitle: "Settings",
    provider: "Provider",
    model: "Model",
    refresh: "🔄 Refresh",
    modelNotConnected: "※ Default models (VS Code not connected)",
    modelFetchFailed:
      "⚠️ Connected to VS Code, but failed to load the model list. Please refresh and try again.",
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
      "Allows high-risk actions such as newTab / closeTab / evaluate. When disabled, these actions are not executed.",
    allowEvaluateAction: "Allow Evaluate Action",
    allowEvaluateActionDesc:
      "High-risk operation. Enable only when needed and review generated scripts carefully.",
    allowEvaluateActionDisabledHint:
      'You cannot change Evaluate while "Allow High-Risk Actions" is disabled.',
    copilotAgentDesc: "@workspace, tools enabled",
    modelSelectAria: "Model selection",
  },
};

export function t(key: keyof typeof translations.ja, lang: Language): string {
  const dictionary =
    lang === "ja" || lang === "en" ? translations[lang] : translations.en;
  return dictionary[key];
}
