import type { ChatMessage } from "./types";

export function finishStoppedConversation(
  messages: readonly ChatMessage[],
  notice: string,
): ChatMessage[] {
  const result = [...messages];
  const last = result[result.length - 1];
  if (last?.role === "assistant" && !last.kind) {
    if (!last.content.trim()) result.pop();
    else result[result.length - 1] = { ...last, incomplete: true };
  }
  if (last?.kind !== "notice" || last.content !== notice) {
    result.push({ role: "assistant", kind: "notice", content: notice });
  }
  return result;
}

export type ReadableTextReader = Pick<
  ReadableStreamDefaultReader<Uint8Array>,
  "read" | "cancel"
>;

export async function readUtf8Stream(
  reader: ReadableTextReader,
  onText?: (content: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let content = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        content += decoder.decode();
        completed = true;
        return content;
      }

      content += decoder.decode(value, { stream: true });
      onText?.(content);
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}
