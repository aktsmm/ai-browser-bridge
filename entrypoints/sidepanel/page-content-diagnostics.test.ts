import { describe, expect, it } from "vitest";

import {
  buildPageContentUnavailableContext,
  isPageContentUnavailableContext,
} from "./page-content-diagnostics";

describe("buildPageContentUnavailableContext", () => {
  it("keeps extraction failures grounded in Japanese", () => {
    const context = buildPageContentUnavailableContext({
      lang: "ja",
      reason: "script-injection-failed",
      url: "https://www.linkedin.com/feed/",
      title: "LinkedIn Feed",
      detail: "Cannot access contents of the page",
    });

    expect(context).toContain("ページ本文の抽出に失敗しました");
    expect(context).toContain("LinkedIn Feed");
    expect(context).toContain("https://www.linkedin.com/feed/");
    expect(context).toContain("ページ本文を要約できません");
  });

  it("tells English models not to summarize missing text", () => {
    const context = buildPageContentUnavailableContext({
      lang: "en",
      reason: "unsupported-page",
      url: "chrome://extensions/",
    });

    expect(context).toContain("This page type cannot be read");
    expect(context).toContain("chrome://extensions/");
    expect(context).toContain(
      "Do not summarize unsupported or unavailable page text",
    );
  });

  it("detects unavailable-context markers in both locales", () => {
    const ja = buildPageContentUnavailableContext({
      lang: "ja",
      reason: "no-tab",
    });
    const en = buildPageContentUnavailableContext({
      lang: "en",
      reason: "no-tab",
    });

    expect(isPageContentUnavailableContext(ja)).toBe(true);
    expect(isPageContentUnavailableContext(en)).toBe(true);
    expect(isPageContentUnavailableContext("normal extracted text")).toBe(
      false,
    );
    expect(isPageContentUnavailableContext("   ")).toBe(false);
  });
});
