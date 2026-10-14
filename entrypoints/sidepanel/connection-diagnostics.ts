export class TaskBlockedError extends Error {}

export function formatChatError(
  error: unknown,
  connectionMessage: string,
): string {
  if (error instanceof TaskBlockedError) return error.message;
  const detail =
    error instanceof Error && error.message ? `\n\n${error.message}` : "";
  return `${connectionMessage}${detail}`;
}

export function formatConnectionFailureDetail(options: {
  ports: number[];
  error?: string;
  statusCode?: number;
  statusText?: string;
  language: "ja" | "en";
}): string {
  const endpoints = options.ports
    .map((port) => `http://127.0.0.1:${port}/health`)
    .join(" / ");

  if (options.language === "ja") {
    const base = options.error
      ? options.error
      : options.statusCode !== undefined
        ? `Health check failed (${options.statusCode} ${options.statusText || ""})`.trim()
        : "接続に失敗しました";
    return `${base}\n確認事項: VS Code 拡張または standalone bridge が起動中で、${endpoints} で待受しているか。`;
  }

  const base = options.error
    ? options.error
    : options.statusCode !== undefined
      ? `Health check failed (${options.statusCode} ${options.statusText || ""})`.trim()
      : "Connection failed";
  return `${base}\nCheck that the VS Code extension or standalone bridge is running and listening on ${endpoints}.`;
}
