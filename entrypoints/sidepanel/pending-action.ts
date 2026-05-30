import type { Language } from "./i18n";

export function getSummarizePrompt(lang: Language): string {
  if (lang === "ja") {
    return [
      "このページ本文を要約してください。",
      "条件:",
      "- こちらで抽出済みのページ本文だけを根拠にしてください。",
      "- ブラウザ操作、ページ遷移、追加クリックはしないでください。",
      "- 日本語で、1) 3行概要、2) 主要ポイント5件、3) 重要な人物・組織・数値、4) 補足/注意点 の順でまとめてください。",
      "- 本文が取得できない場合は、その旨と確認してほしいURLを短く伝えてください。",
    ].join("\n");
  }

  return [
    "Summarize the current page text.",
    "Rules:",
    "- Use only the page text already extracted by this extension.",
    "- Do not navigate, click, or perform additional browser actions.",
    "- Respond with: 1) three-line summary, 2) five key points, 3) important people/organizations/numbers, 4) caveats or notes.",
    "- If the page text is unavailable, briefly say so and ask for the URL to check.",
  ].join("\n");
}

export function getSummarizeAndSavePrompt(lang: Language): string {
  return `${getSummarizePrompt(lang)}\n${
    lang === "ja"
      ? "- 最後に、この要約をMarkdownとして保存してください。"
      : "- Finally, save this summary as Markdown."
  }`;
}

export type PendingAction =
  | {
      type: "question";
      text: string;
      tabId?: number;
      url?: string;
      title?: string;
    }
  | {
      type: "summarize";
      tabId?: number;
      url?: string;
      title?: string;
    };

export function getPendingActionTabId(action: unknown): number | null {
  if (!action || typeof action !== "object") {
    return null;
  }

  const tabId = (action as Partial<PendingAction>).tabId;
  return typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
}

export function toPendingPrompt(
  action: unknown,
  lang: Language,
): string | null {
  if (!action || typeof action !== "object") {
    return null;
  }

  const candidate = action as Partial<PendingAction>;
  if (candidate.type === "question" && typeof candidate.text === "string") {
    const text = candidate.text.trim();
    return text.length > 0 ? text : null;
  }

  if (candidate.type === "summarize") {
    return getSummarizePrompt(lang);
  }

  return null;
}
