import { describe, expect, it } from "vitest";

import {
  getPendingActionTabId,
  getSummarizeAndSavePrompt,
  normalizeCustomPrompts,
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

  it("converts post action to a localized prompt with hashtags", () => {
    const ja = toPendingPrompt({ type: "post" }, "ja");
    expect(ja).toContain("ハッシュタグ");
    expect(ja).toContain("ブラウザ操作やページ遷移はしないでください");
    const en = toPendingPrompt({ type: "post" }, "en");
    expect(en).toContain("hashtags");
    expect(en).toContain("Do not navigate");
  });

  it("returns the trimmed body for a custom prompt action", () => {
    expect(
      toPendingPrompt(
        { type: "customPrompt", text: "  dig deeper  " },
        "ja",
      ),
    ).toBe("dig deeper");
  });

  it("returns null when custom prompt text is empty or non-string", () => {
    expect(toPendingPrompt({ type: "customPrompt", text: "   " }, "ja")).toBeNull();
    expect(toPendingPrompt({ type: "customPrompt" }, "ja")).toBeNull();
  });
});

describe("normalizeCustomPrompts", () => {
  it("falls back to defaults for non-array input", () => {
    const result = normalizeCustomPrompts(undefined);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("body");
  });

  it("falls back to defaults for an empty array", () => {
    expect(normalizeCustomPrompts([]).length).toBeGreaterThanOrEqual(2);
  });

  it("coerces missing fields and drops invalid entries", () => {
    const result = normalizeCustomPrompts([
      { id: "a", name: "Keep", body: "Body" },
      null,
      { name: 42, body: undefined },
    ]);
    expect(result).toEqual([
      { id: "a", name: "Keep", body: "Body" },
      { id: "custom-3", name: "", body: "" },
    ]);
  });

  it("makes duplicate ids unique so context menu creation stays safe", () => {
    const result = normalizeCustomPrompts([
      { id: "dup", name: "First", body: "A" },
      { id: "dup", name: "Second", body: "B" },
    ]);
    const ids = result.map((prompt) => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result[0].id).toBe("dup");
    expect(result[1].id).not.toBe("dup");
  });
});
