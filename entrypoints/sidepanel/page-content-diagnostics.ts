import type { Language } from "./i18n";

export type PageContentUnavailableReason =
  | "no-tab"
  | "unsupported-page"
  | "script-injection-failed";

const PAGE_CONTENT_UNAVAILABLE_MARKERS = [
  "### ページ本文の取得状況",
  "### Page Content Status",
] as const;

export function isPageContentUnavailableContext(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }

  return PAGE_CONTENT_UNAVAILABLE_MARKERS.some((marker) =>
    text.startsWith(marker),
  );
}

export function buildPageContentUnavailableContext(options: {
  lang: Language;
  reason: PageContentUnavailableReason;
  url?: string;
  title?: string;
  detail?: string;
}): string {
  const title = options.title?.trim();
  const url = options.url?.trim();
  const detail = options.detail?.trim();

  if (options.lang === "ja") {
    const reason =
      options.reason === "no-tab"
        ? "対象タブを特定できませんでした"
        : options.reason === "unsupported-page"
          ? "この種類のページは拡張機能から本文を取得できません"
          : "ページ本文の抽出に失敗しました";

    return [
      "### ページ本文の取得状況",
      reason,
      title ? `タイトル: ${title}` : "",
      url ? `URL: ${url}` : "",
      detail ? `詳細: ${detail}` : "",
      "この情報だけではページ本文を要約できません。ユーザーにページ本文の貼り付け、再読み込み、または対象URLの確認を依頼してください。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const reason =
    options.reason === "no-tab"
      ? "The target tab could not be identified."
      : options.reason === "unsupported-page"
        ? "This page type cannot be read by the extension."
        : "The extension failed to extract the page text.";

  return [
    "### Page Content Status",
    reason,
    title ? `Title: ${title}` : "",
    url ? `URL: ${url}` : "",
    detail ? `Detail: ${detail}` : "",
    "Do not summarize unsupported or unavailable page text. Ask the user to paste the page text, reload the page, or confirm the target URL.",
  ]
    .filter(Boolean)
    .join("\n");
}
