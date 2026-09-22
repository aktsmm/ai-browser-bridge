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

export async function readPageWithRecovery(
  read: () => Promise<FrameResult[]>,
  waitForReady: () => Promise<void>,
): Promise<PageContextResult> {
  try {
    let result = combinePageFrames(await read());
    if (result.status === "empty") {
      await waitForReady();
      result = combinePageFrames(await read());
    }
    return result;
  } catch (error) {
    return {
      status: classifyPageError(error),
      content: "",
      frames: [],
      capturedAt: Date.now(),
    };
  }
}
