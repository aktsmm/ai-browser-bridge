import { describe, expect, it } from "vitest";

import {
  getPendingActionTabId,
  getSummarizeAndSavePrompt,
  toPendingPrompt,
} from "./pending-action";

describe("toPendingPrompt", () => {
  it("returns null for null or non-object input", () => {
    expect(toPendingPrompt(null, "ja")).toBeNull();
    expect(toPendingPrompt(undefined, "ja")).toBeNull();
    expect(toPendingPrompt("summarize", "ja")).toBeNull();
    expect(toPendingPrompt(42, "ja")).toBeNull();
  });

  it("returns null when type is unknown", () => {
    expect(toPendingPrompt({ type: "unknown" }, "ja")).toBeNull();
    expect(toPendingPrompt({}, "ja")).toBeNull();
  });

  it("converts summarize action to a localized prompt", () => {
    expect(toPendingPrompt({ type: "summarize" }, "ja")).toContain("3行概要");
    expect(toPendingPrompt({ type: "summarize" }, "ja")).toContain(
      "ブラウザ操作、ページ遷移、追加クリックはしないでください",
    );
    expect(toPendingPrompt({ type: "summarize" }, "en")).toContain(
      "three-line summary",
    );
    expect(toPendingPrompt({ type: "summarize" }, "en")).toContain(
      "Do not navigate",
    );
  });

  it("extracts the source tab id from a pending action", () => {
    expect(getPendingActionTabId({ type: "summarize", tabId: 123 })).toBe(123);
    expect(getPendingActionTabId({ type: "summarize", tabId: 1.5 })).toBeNull();
    expect(
      getPendingActionTabId({ type: "summarize", tabId: "123" }),
    ).toBeNull();
    expect(getPendingActionTabId(null)).toBeNull();
  });

  it("builds a structured summarize-and-save prompt", () => {
    expect(getSummarizeAndSavePrompt("ja")).toContain("3行概要");
    expect(getSummarizeAndSavePrompt("ja")).toContain(
      "Markdownとして保存してください",
    );
    expect(getSummarizeAndSavePrompt("en")).toContain("three-line summary");
    expect(getSummarizeAndSavePrompt("en")).toContain(
      "save this summary as Markdown",
    );
  });

  it("returns the trimmed text for a question action", () => {
    expect(
      toPendingPrompt({ type: "question", text: "  hello world  " }, "ja"),
    ).toBe("hello world");
  });

  it("returns null when question text is empty or whitespace only", () => {
    expect(toPendingPrompt({ type: "question", text: "" }, "ja")).toBeNull();
    expect(toPendingPrompt({ type: "question", text: "   " }, "ja")).toBeNull();
  });

  it("returns null when question text is missing or non-string", () => {
    expect(toPendingPrompt({ type: "question" }, "ja")).toBeNull();
    expect(
      toPendingPrompt({ type: "question", text: 123 as unknown }, "ja"),
    ).toBeNull();
  });
});
