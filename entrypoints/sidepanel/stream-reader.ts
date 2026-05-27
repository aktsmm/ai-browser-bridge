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
