import type { Language } from "./i18n";

/** ユーザーが設定画面で編集できるカスタムプロンプト1件。 */
export interface CustomPrompt {
  id: string;
  name: string;
  body: string;
}

/** カスタムプロンプトの保存先キー（chrome.storage.local）。 */
export const CUSTOM_PROMPTS_STORAGE_KEY = "customPrompts";

/** カスタムプロンプトの枠数（固定）。 */
export const CUSTOM_PROMPT_COUNT = 2;

/** 初回・未設定時に表示する既定のカスタムプロンプト。 */
export const DEFAULT_CUSTOM_PROMPTS: CustomPrompt[] = [
  {
    id: "custom-1",
    name: "深掘り",
    body: [
      "抽出済みのこのページ本文を根拠に、最も重要なポイントを1つ選び、背景・具体例・注意点を詳しく掘り下げてください。",
      "ブラウザ操作やページ遷移はしないでください。",
    ].join("\n"),
  },
  {
    id: "custom-2",
    name: "やさしく",
    body: [
      "直前の内容を、専門用語を避けて初心者にもわかるようにやさしく言い換えてください。",
      "ブラウザ操作やページ遷移はしないでください。",
    ].join("\n"),
  },
];

/**
 * 渡された値を CustomPrompt[] として正規化する。
 * 不正な要素は除外し、name/body を文字列に整える。
 */
export function normalizeCustomPrompts(value: unknown): CustomPrompt[] {
  if (!Array.isArray(value)) {
    return DEFAULT_CUSTOM_PROMPTS.map((prompt) => ({ ...prompt }));
  }

  const normalized: CustomPrompt[] = [];
  const usedIds = new Set<string>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as Partial<CustomPrompt>;
    const fallback = DEFAULT_CUSTOM_PROMPTS[index];
    let id =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : (fallback?.id ?? `custom-${index + 1}`);
    // id は context menu の create() で一意である必要があるため重複を解消する
    while (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);
    const name = typeof candidate.name === "string" ? candidate.name : "";
    const body = typeof candidate.body === "string" ? candidate.body : "";
    normalized.push({ id, name, body });
  });

  return normalized.length > 0
    ? normalized
    : DEFAULT_CUSTOM_PROMPTS.map((prompt) => ({ ...prompt }));
}

export function getPostPrompt(lang: Language): string {
  if (lang === "ja") {
    return [
      "開いているこのページについて、X（旧Twitter）に投稿するポストを作ってください。",
      "条件:",
      "- こちらで抽出済みのページ本文だけを根拠にしてください。",
      "- ブラウザ操作やページ遷移はしないでください。",
      "- 日本語で、テンション高めでワクワクが伝わる文体にしてください。",
      "- 140〜280字程度。絵文字を数個使ってOKです。",
      "- 末尾に関連するハッシュタグを2〜4個付けてください。",
      "- 投稿本文だけを出力してください（前置きや説明は不要）。",
    ].join("\n");
  }

  return [
    "Write an X (formerly Twitter) post about the current page.",
    "Rules:",
    "- Use only the page text already extracted by this extension.",
    "- Do not navigate, click, or perform additional browser actions.",
    "- Write in an upbeat, high-energy, exciting tone.",
    "- Keep it around 140-280 characters. A few emojis are welcome.",
    "- Add 2-4 relevant hashtags at the end.",
    "- Output only the post text (no preamble or explanation).",
  ].join("\n");
}

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
    }
  | {
      type: "post";
      tabId?: number;
      url?: string;
      title?: string;
    }
  | {
      type: "customPrompt";
      text: string;
      promptName?: string;
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
  if (
    (candidate.type === "question" || candidate.type === "customPrompt") &&
    typeof candidate.text === "string"
  ) {
    const text = candidate.text.trim();
    return text.length > 0 ? text : null;
  }

  if (candidate.type === "summarize") {
    return getSummarizePrompt(lang);
  }

  if (candidate.type === "post") {
    return getPostPrompt(lang);
  }

  return null;
}
