/** X の重み付き文字数（twitter-text v3 の設定値）。emoji/URL の判定は近似で、数え方の根拠は X の公式 Counting characters。 */
export const X_STANDARD_LIMIT = 280;
export const X_LONG_LIMIT = 1000;
const URL_WEIGHT = 23;
const URL_PATTERN = /https?:\/\/[^\s]+/g;
const URL_TRAILING = /[.,;:!?)\]}'"」』）、。！？]+$/u;
const EMOJI_CLUSTER =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/** ポストの長さ指定に対応する上限（short=280 / long=日本語500字相当の1000）。 */
export function xPostLimit(length: "short" | "long"): number {
  return length === "long" ? X_LONG_LIMIT : X_STANDARD_LIMIT;
}

function codePointWeight(codePoint: number): number {
  if (codePoint <= 4351) return 1;
  if (codePoint >= 8192 && codePoint <= 8205) return 1;
  if (codePoint >= 8208 && codePoint <= 8223) return 1;
  if (codePoint >= 8242 && codePoint <= 8247) return 1;
  return 2;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function splitUnits(text: string): string[] {
  return segmenter
    ? Array.from(segmenter.segment(text), (item) => item.segment)
    : Array.from(text);
}

function unitWeight(unit: string): number {
  const codePoints = Array.from(unit);
  if (codePoints.length > 1 && EMOJI_CLUSTER.test(unit)) return 2;
  return codePoints.reduce(
    (sum, char) => sum + codePointWeight(char.codePointAt(0)!),
    0,
  );
}

function plainWeight(text: string): number {
  return splitUnits(text).reduce((sum, unit) => sum + unitWeight(unit), 0);
}

/** X が数える重み付き文字数。URL は長さに関わらず 23、CJK・絵文字は 2、その他は 1。 */
export function xWeightedLength(text: string): number {
  const normalized = text.normalize("NFC");
  let total = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(URL_TRAILING, "");
    total += plainWeight(normalized.slice(cursor, start)) + URL_WEIGHT;
    total += plainWeight(match[0].slice(url.length));
    cursor = start + match[0].length;
  }
  return total + plainWeight(normalized.slice(cursor));
}

/** 回答から投稿本文だけを取り出す（コードブロック・前置き行・外側の引用符を除く）。 */
export function extractPostBody(answer: string): string {
  let text = answer.replace(/\r\n/g, "\n").trim();
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  const lines = text.split("\n");
  if (
    lines.length > 1 &&
    /^(以下|こちら|ご要望|Here\b|Below\b|Sure\b)[^\n]*[:：]\s*$/i.test(lines[0])
  ) {
    text = lines.slice(1).join("\n").trim();
  }
  const quoted = text.match(/^[「"“]([\s\S]*)[」"”]$/);
  if (quoted) text = quoted[1].trim();
  return text;
}

/** 回答 index の直前のユーザー発話が持つ X 上限（なければ undefined）。 */
export function xLimitForAnswer(
  messages: ReadonlyArray<{ role: string; xPostLimit?: number }>,
  index: number,
): number | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].xPostLimit;
  }
  return undefined;
}
