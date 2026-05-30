import { describe, expect, it, vi } from "vitest";
import { readUtf8Stream, type ReadableTextReader } from "./stream-reader";

function createReader(chunks: Array<string | Error>): ReadableTextReader & {
  cancel: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  const cancel = vi.fn(async () => undefined);

  return {
    cancel,
    read: vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      const next = chunks[index++];
      if (next instanceof Error) {
        throw next;
      }

      if (typeof next === "string") {
        return {
          done: false as const,
          value: new TextEncoder().encode(next),
        };
      }

      return {
        done: true as const,
        value: undefined,
      };
    }),
  };
}

describe("readUtf8Stream", () => {
  it("returns concatenated text without canceling on normal completion", async () => {
    const reader = createReader(["Hello ", "world"]);
    const snapshots: string[] = [];

    await expect(
      readUtf8Stream(reader, (content) => snapshots.push(content)),
    ).resolves.toBe("Hello world");

    expect(snapshots).toEqual(["Hello ", "Hello world"]);
    expect(reader.cancel).not.toHaveBeenCalled();
  });

  it("cancels the reader when streaming fails", async () => {
    const reader = createReader(["partial", new Error("stream failed")]);

    await expect(readUtf8Stream(reader)).rejects.toThrow("stream failed");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves the original stream error when best-effort cancel also fails", async () => {
    const reader = createReader(["partial", new Error("stream failed")]);
    reader.cancel.mockRejectedValueOnce(new Error("cancel failed"));

    await expect(readUtf8Stream(reader)).rejects.toThrow("stream failed");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });
});
