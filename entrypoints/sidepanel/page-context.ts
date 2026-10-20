import type { ChatContext } from "../../standalone-bridge/src/chat-context";

export interface FrameSnapshot {
  text: string;
  elements: string;
  textLength: number;
  elementCount: number;
  url: string;
  title: string;
}
export interface FrameResult {
  frameId: number;
  documentId?: string;
  result?: FrameSnapshot;
}
export interface PageContextResult {
  method?: "dom" | "image";
  status: ChatContext["pageStatus"];
  content: string;
  capturedAt: number;
  frames: { frameId: number; documentId?: string; origin?: string }[];
}

export function combinePageFrames(results: FrameResult[]): PageContextResult {
  const frames = results.filter(
    (frame) =>
      frame.result &&
      (frame.result.textLength > 0 || frame.result.elementCount > 0),
  );
  const elementParts: string[] = [];
  const textParts: string[] = [];
  for (const frame of frames.sort(
    (first, second) => first.frameId - second.frameId,
  )) {
    const snapshot = frame.result!;
    const label = `Frame ${frame.frameId}: ${snapshot.title} (${snapshot.url})`;
    if (snapshot.elements.trim())
      elementParts.push(
        `${label}\n${snapshot.elements.replace(/\[e(\d+)\]/g, `[f${frame.frameId}:e$1]`)}`,
      );
    if (snapshot.textLength > 0) textParts.push(`${label}\n${snapshot.text}`);
  }
  const elements = elementParts.join("\n\n");
  const text = textParts.join("\n\n");
  const truncated = elements.length > 6000 || text.length > 13000;
  return {
    status: !frames.length
      ? "empty"
      : truncated || results.some((frame) => !frame.result)
        ? "partial"
        : "ok",
    content: frames.length
      ? `### Elements\n${elements.slice(0, 6000)}\n\n### Page text\n${text.slice(0, 13000)}${truncated ? "\n[Content truncated]" : ""}`
      : "",
    capturedAt: Date.now(),
    frames: frames.map(({ frameId, documentId, result }) => {
      let origin: string | undefined;
      try {
        const url = new URL(result!.url);
        if (["https:", "http:"].includes(url.protocol)) origin = url.origin;
      } catch {
        origin = undefined;
      }
      return { frameId, documentId, origin };
    }),
  };
}

export function classifyPageError(error: unknown): ChatContext["pageStatus"] {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /cannot access|missing host permission|permission|extensions gallery|chrome web store/i.test(
      message,
    )
  )
    return "permission-required";
  return "failed";
}

const MAX_READ_RETRIES = 2;

function failedPage(status: PageContextResult["status"]): PageContextResult {
  return { status, content: "", frames: [], capturedAt: Date.now() };
}

/**
 * ページ本文を読み取り、空・一時的な失敗（読込中の遷移など）は準備完了を待って再試行する。
 * 権限不足は待っても直らないため再試行しない。
 */
export async function readPageWithRecovery(
  read: () => Promise<FrameResult[]>,
  waitForReady: () => Promise<void>,
): Promise<PageContextResult> {
  let last: PageContextResult | undefined;
  for (let attempt = 0; attempt <= MAX_READ_RETRIES; attempt++) {
    if (attempt > 0) {
      try {
        await waitForReady();
      } catch {
        // タブが遷移中で待機自体に失敗しても、そのまま再読み取りする
      }
    }
    try {
      last = combinePageFrames(await read());
      if (last.status !== "empty") return last;
    } catch (error) {
      const status = classifyPageError(error);
      if (status === "permission-required") return failedPage(status);
      last = failedPage(status);
    }
  }
  return last ?? failedPage("failed");
}

/** 読込中ページの完了待ち上限。裏の自動読み取りは短く、送信前の読み取りは長めに待つ。 */
export function pageLoadWaitMs(background: boolean): {
  initialMs: number;
  retryMs: number;
} {
  return background
    ? { initialMs: 3000, retryMs: 3000 }
    : { initialMs: 10000, retryMs: 5000 };
}

/** タブの読込状態が complete になるまで待つ。complete なら true、タイムアウト・タブ消失なら false。 */
export async function waitForTabComplete(
  getStatus: () => Promise<string | undefined>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 250;
  const attempts = Math.max(
    1,
    Math.ceil((options.timeoutMs ?? 10000) / intervalMs),
  );
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await getStatus();
    if (status === undefined) return false;
    if (status === "complete") return true;
    await sleep(intervalMs);
  }
  return false;
}
