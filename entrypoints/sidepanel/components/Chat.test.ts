import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Chat,
  getQuickActions,
  isAssistantAlertMessage,
  markdownSanitizeSchema,
} from "./Chat";
import { getDownloadShowId } from "../download-id";

describe("getQuickActions", () => {
  it("uses grounded, non-navigating Japanese prompts", () => {
    const prompts = getQuickActions("ja").map((action) => action.prompt);

    expect(prompts.join("\n")).toContain("ブラウザ操作");
    expect(prompts.join("\n")).toContain("抽出済み本文");
    expect(prompts.join("\n")).toContain("Markdown");
    expect(prompts.join("\n")).toContain("保存や新しいブラウザ操作");
    expect(prompts.every((prompt) => prompt.includes("ページ遷移"))).toBe(true);
  });

  it("uses grounded, non-navigating English prompts", () => {
    const prompts = getQuickActions("en").map((action) => action.prompt);

    expect(prompts.join("\n")).toContain("extracted page text");
    expect(prompts.join("\n")).toContain("Do not navigate");
    expect(prompts.join("\n")).toContain("Markdown");
    expect(prompts.join("\n")).toContain("Do not save files");
    expect(prompts.every((prompt) => prompt.includes("Do not navigate"))).toBe(
      true,
    );
  });

  it("includes a post quick action with hashtags in both languages", () => {
    const ja = getQuickActions("ja").find(
      (action) => action.label === "ポスト軽（140）",
    );
    expect(ja?.prompt).toContain("ハッシュタグ");

    const en = getQuickActions("en").find(
      (action) => action.label === "Post casual (140)",
    );
    expect(en?.prompt).toContain("hashtags");
  });

  it("reflects the post length parameter in labels and prompts", () => {
    const jaShort = getQuickActions("ja", "short");
    expect(
      jaShort.find((a) => a.label === "ポスト軽（140）")?.prompt,
    ).toContain("140字以内");
    expect(
      jaShort.find((a) => a.label === "ポスト硬（140）")?.prompt,
    ).toContain("140字以内");
    const jaLong = getQuickActions("ja", "long");
    expect(jaLong.find((a) => a.label === "ポスト軽（500）")?.prompt).toContain(
      "500字以内",
    );
    expect(jaLong.find((a) => a.label === "ポスト硬（500）")?.prompt).toContain(
      "500字以内",
    );
    // 4種すべてが長さトグルで到達可能（casual/formal × short/long）
    expect(jaShort.some((a) => a.label === "ポスト硬（140）")).toBe(true);
    expect(jaLong.some((a) => a.label === "ポスト軽（500）")).toBe(true);
  });

  it("keeps internal download-show links available for click handling", () => {
    expect(markdownSanitizeSchema.protocols?.href).toContain("download-show");
  });

  it("renders custom prompt buttons after an assistant reply", () => {
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [{ role: "assistant", content: "Here is the answer." }],
        isLoading: false,
        onSendMessage: vi.fn(),
        onClearMessages: vi.fn(),
        onStopGeneration: vi.fn(),
        language: "en",
        customPrompts: [
          { id: "custom-1", name: "Deep dive", body: "Dig deeper" },
          { id: "custom-2", name: "", body: "" },
        ],
        onSaveMarkdown: vi.fn(),
        onSaveBlogDraft: vi.fn(),
      }),
    );

    expect(html).toContain("Deep dive");
  });

  it("accepts only numeric internal download-show ids", () => {
    expect(getDownloadShowId("download-show:123")).toBe(123);
    expect(getDownloadShowId("download-show:abc")).toBeNull();
    expect(getDownloadShowId("download-show:1?x=2")).toBeNull();
    expect(getDownloadShowId("download-show:10000001")).toBeNull();
    expect(getDownloadShowId("https://example.com")).toBeNull();
  });

  it("marks warning assistant messages as alerts", () => {
    expect(
      isAssistantAlertMessage({
        role: "assistant",
        content: "⚠️ The page text could not be extracted.",
      }),
    ).toBe(true);
    expect(
      isAssistantAlertMessage({ role: "assistant", content: "Normal reply" }),
    ).toBe(false);
  });

  it("renders warning messages and controls with accessible names", () => {
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [
          {
            role: "assistant",
            content: "⚠️ The page text could not be extracted.",
          },
        ],
        isLoading: false,
        onSendMessage: vi.fn(),
        onClearMessages: vi.fn(),
        onStopGeneration: vi.fn(),
        language: "en",
        onSaveMarkdown: vi.fn(),
        onSaveBlogDraft: vi.fn(),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Attach"');
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain('title="Enter message..."');
  });
});
