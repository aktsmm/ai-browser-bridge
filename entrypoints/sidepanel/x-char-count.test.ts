import { describe, expect, it } from "vitest";
import {
  X_LONG_LIMIT,
  X_STANDARD_LIMIT,
  extractPostBody,
  xLimitForAnswer,
  xPostLimit,
  xWeightedLength,
} from "./x-char-count";

describe("xWeightedLength", () => {
  it("matches the documented example", () => {
    expect(xWeightedLength("Hello, world! 👋")).toBe(16);
  });

  it("counts CJK as 2 so 140 Japanese characters fill the 280 limit", () => {
    expect(xWeightedLength("あ".repeat(140))).toBe(280);
    expect(xWeightedLength("あ".repeat(141))).toBe(282);
    expect(xWeightedLength("a".repeat(280))).toBe(280);
  });

  it("counts every URL as 23 regardless of length", () => {
    expect(xWeightedLength("https://example.com")).toBe(23);
    expect(xWeightedLength("https://example.com/very/long/path?x=1#frag")).toBe(
      23,
    );
    expect(xWeightedLength("見て https://example.com")).toBe(28);
  });

  it("keeps trailing punctuation outside the URL", () => {
    expect(xWeightedLength("https://example.com。")).toBe(25);
    expect(xWeightedLength("https://example.com.")).toBe(24);
  });

  it("counts any emoji sequence as 2", () => {
    expect(xWeightedLength("👾")).toBe(2);
    expect(xWeightedLength("🙋🏽")).toBe(2);
    expect(xWeightedLength("👨‍👩‍👧‍👦")).toBe(2);
    expect(xWeightedLength("🇯🇵")).toBe(2);
  });

  it("normalizes to NFC and counts line breaks and hashtags normally", () => {
    expect(xWeightedLength("cafe\u0301")).toBe(4);
    expect(xWeightedLength("café")).toBe(4);
    expect(xWeightedLength("a\nb")).toBe(3);
    expect(xWeightedLength("#abc")).toBe(4);
    expect(xWeightedLength("#日本語")).toBe(7);
  });

  it("returns 0 for empty text", () => {
    expect(xWeightedLength("")).toBe(0);
  });
});

describe("xPostLimit", () => {
  it("maps short to 280 and long to 1000", () => {
    expect(xPostLimit("short")).toBe(X_STANDARD_LIMIT);
    expect(xPostLimit("long")).toBe(X_LONG_LIMIT);
    expect(X_STANDARD_LIMIT).toBe(280);
    expect(X_LONG_LIMIT).toBe(1000);
  });
});

describe("extractPostBody", () => {
  it("returns plain post text unchanged", () => {
    expect(extractPostBody("  結論です\n\n・要点\n\n#tag \n")).toBe(
      "結論です\n\n・要点\n\n#tag",
    );
  });

  it("unwraps a single fenced block", () => {
    expect(extractPostBody("```text\n本文\n#tag\n```")).toBe("本文\n#tag");
  });

  it("drops a leading preface line", () => {
    expect(extractPostBody("以下が投稿案です：\n本文")).toBe("本文");
    expect(extractPostBody("Here is the post:\nBody text")).toBe("Body text");
  });

  it("keeps a first line that is real content", () => {
    expect(extractPostBody("以下の3点が重要です\n・A")).toBe(
      "以下の3点が重要です\n・A",
    );
  });

  it("removes wrapping quotes", () => {
    expect(extractPostBody("「本文です」")).toBe("本文です");
  });
});

describe("xLimitForAnswer", () => {
  it("uses the nearest preceding user message", () => {
    const messages = [
      { role: "user", xPostLimit: 280 },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
    ];
    expect(xLimitForAnswer(messages, 1)).toBe(280);
    expect(xLimitForAnswer(messages, 3)).toBeUndefined();
  });
});
