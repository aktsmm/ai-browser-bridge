import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Chat,
  getQuickActions,
  isAssistantAlertMessage,
  getExecutionFeedback,
  markdownSanitizeSchema,
  separateToolLogs,
  shouldSubmitChat,
  isNearConversationEnd,
  appendPromptHistory,
  stepPromptHistory,
} from "./Chat";
import { getDownloadShowId } from "../download-id";
import { isAssistantAnswer, isDisplayActionRequest } from "../types";
import { PageContextStatus } from "./PageContextStatus";
import { buildIssueUrl } from "./IssueReportDialog";

describe("PageContextStatus", () => {
  it("keeps display action requests out of answer saves and quick actions", () => {
    const request = {
      role: "assistant" as const,
      content:
        '[Agent Mode: fixture]\n[ACTION: findDisplayText, {"text":"Heading"}]',
    };
    expect(isDisplayActionRequest(request)).toBe(true);
    expect(isAssistantAnswer(request)).toBe(false);
    expect(
      isAssistantAnswer({
        role: "assistant",
        content: "The display change was verified.",
      }),
    ).toBe(true);
    expect(
      isDisplayActionRequest({ role: "user", content: request.content }),
    ).toBe(false);
    expect(
      isDisplayActionRequest({
        role: "assistant",
        content:
          '[ACTION: replaceText, {"selector":"ref:e1","text":"A"}]\nUnverified [result]',
      }),
    ).toBe(false);
    expect(
      isDisplayActionRequest({
        role: "assistant",
        content:
          'Explanation with [ACTION: replaceText, {"selector":"ref:e1","text":"A"}]',
      }),
    ).toBe(false);
  });
  it("keeps status, truncated origin and retry in one compact row", () => {
    const html = renderToStaticMarkup(
      React.createElement(PageContextStatus, {
        state: {
          status: "empty",
          content: "",
          capturedAt: 1,
          frames: [],
        },
        origin: "https://rsvh.travel.rakuten.co.jp",
        language: "ja",
        busy: false,
        onRead: vi.fn(),
      }),
    );
    expect(html).toContain('title="https://rsvh.travel.rakuten.co.jp"');
    expect(html).toContain("truncate");
    expect(html).toContain("読み取れる内容がありません");
    expect(html).toContain("再読み取り");
    expect(html).not.toContain("mt-1");
  });
});

describe("prompt history", () => {
  it("retains only the 15 most recent sent prompts without adjacent duplicates", () => {
    let history: string[] = [];
    for (let index = 1; index <= 16; index++)
      history = appendPromptHistory(history, `Prompt ${index}`);
    expect(history).toHaveLength(15);
    expect(history[0]).toBe("Prompt 2");
    expect(appendPromptHistory(history, "Prompt 16")).toEqual(history);
  });

  it("walks upward through sent prompts and downward to the unsent draft", () => {
    const history = ["First", "Second"];
    expect(stepPromptHistory(history, null, "Draft", "up")).toEqual({
      index: 1,
      value: "Second",
    });
    expect(stepPromptHistory(history, 1, "Draft", "up")).toEqual({
      index: 0,
      value: "First",
    });
    expect(stepPromptHistory(history, 0, "Draft", "up")).toEqual({
      index: 0,
      value: "First",
    });
    expect(stepPromptHistory(history, 1, "Draft", "down")).toEqual({
      index: null,
      value: "Draft",
    });
    expect(stepPromptHistory(history, null, "Draft", "down")).toBeNull();
  });
});

describe("issue report preview", () => {
  it("includes only the user's report and minimal extension metadata by default", () => {
    const report = {
      title: "Page read fails",
      steps: "Open the travel page, then read it",
      expected: "Page text appears",
      actual: "No readable content",
      version: "0.1.25",
      mode: "automation",
      status: "empty",
      origin: "https://private.example",
      includeOrigin: false,
    };
    const url = new URL(buildIssueUrl(report));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/aktsmm/ai-browser-bridge/issues/new");
    expect(url.searchParams.get("title")).toBe(report.title);
    expect(url.searchParams.get("body")).toContain(report.steps);
    expect(url.searchParams.get("body")).toContain("Version: 0.1.25");
    expect(url.searchParams.get("body")).not.toContain(report.origin);
    expect(
      new URL(
        buildIssueUrl({ ...report, includeOrigin: true }),
      ).searchParams.get("body"),
    ).toContain(report.origin);
    expect(
      buildIssueUrl({
        ...report,
        title: "不".repeat(120),
        steps: "不".repeat(1500),
        expected: "不".repeat(1500),
        actual: "不".repeat(1500),
      }).length,
    ).toBeLessThan(8000);
  });
});

describe("getQuickActions", () => {
  it("offers saving on each answer even after a later reply or notice", () => {
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [
          { role: "assistant", content: "Earlier answer" },
          { role: "assistant", content: "Later answer" },
          { role: "assistant", kind: "notice", content: "Saved" },
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
    expect(html.match(/aria-label="Save answer"/g)).toHaveLength(2);
  });
  it("follows new content only when the reader is near the conversation end", () => {
    expect(
      isNearConversationEnd({
        scrollHeight: 1000,
        scrollTop: 400,
        clientHeight: 600,
      }),
    ).toBe(true);
    expect(
      isNearConversationEnd({
        scrollHeight: 1000,
        scrollTop: 352,
        clientHeight: 600,
      }),
    ).toBe(true);
    expect(
      isNearConversationEnd({
        scrollHeight: 1000,
        scrollTop: 351,
        clientHeight: 600,
      }),
    ).toBe(false);
    expect(
      isNearConversationEnd({
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 600,
      }),
    ).toBe(false);
  });
  it("never treats runtime notices or empty responses as savable answers", () => {
    expect(
      isAssistantAnswer({
        role: "assistant",
        kind: "notice",
        content: "Saved",
      }),
    ).toBe(false);
    expect(
      isAssistantAnswer({
        role: "assistant",
        kind: "error",
        content: "Failed",
      }),
    ).toBe(false);
    expect(isAssistantAnswer({ role: "assistant", content: "  " })).toBe(false);
    expect(isAssistantAnswer({ role: "assistant", content: "Answer" })).toBe(
      true,
    );
  });
  it("distinguishes verified results from lookup, failure and uncertain outcomes", () => {
    const notice = (result: string) => ({
      role: "assistant" as const,
      kind: "notice" as const,
      content: `🤖 [Loop 1/20] Execution result\r\n• ${result}`,
    });
    expect(
      getExecutionFeedback(
        notice("Display text found: ref:f0:d123. Nothing changed yet."),
        "en",
      )?.kind,
    ).toBe("found");
    expect(
      getExecutionFeedback(notice("Display text changed; not submitted"), "ja")
        ?.kind,
    ).toBe("verified");
    expect(
      getExecutionFeedback(
        notice("Error: eligible display text not found; nothing changed"),
        "en",
      )?.kind,
    ).toBe("failed");
    expect(
      getExecutionFeedback(
        notice("Error: display text search was incomplete; nothing changed"),
        "ja",
      )?.text,
    ).toContain("検索の確認範囲を超えた");
    expect(
      getExecutionFeedback(
        notice("Error: display text search was incomplete; nothing changed"),
        "en",
      )?.text,
    ).toContain("nothing changed");
    expect(
      getExecutionFeedback(
        notice("Error: more than one matching display text exists"),
        "ja",
      )?.text,
    ).toContain("同じ文言が複数");
    expect(
      getExecutionFeedback(
        notice("Error: display target changed or is restricted"),
        "ja",
      )?.text,
    ).toContain("現在の表示を確認");
    expect(
      getExecutionFeedback(
        notice("Error: display editing permission expired or was revoked"),
        "en",
      )?.text,
    ).toContain("permission is inactive");
    expect(isAssistantAlertMessage(notice("Error: target changed"))).toBe(true);
    expect(
      getExecutionFeedback(
        notice(
          "Error: display operation outcome is unverified; inspect the page",
        ),
        "ja",
      )?.kind,
    ).toBe("unverified");
    expect(
      getExecutionFeedback(
        notice(
          "Navigation requested; the next snapshot must confirm the destination",
        ),
        "en",
      )?.kind,
    ).toBe("unverified");
    expect(
      getExecutionFeedback(notice("Scrolled; refresh page context"), "en")
        ?.kind,
    ).toBe("review");
    expect(
      getExecutionFeedback(
        { ...notice("Display text changed; not submitted"), kind: undefined },
        "en",
      ),
    ).toBeUndefined();
    expect(
      getExecutionFeedback(
        { ...notice("Display text changed; not submitted"), role: "user" },
        "en",
      ),
    ).toBeUndefined();
  });
  it("shows failed execution feedback outside the collapsed details without answer actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [
          {
            role: "assistant",
            kind: "notice",
            content:
              "🤖 [Loop 1/20] Execution result\n• Error: target not found",
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
    expect(html.indexOf("The action could not be completed.")).toBeLessThan(
      html.indexOf("<details"),
    );
    expect(html).not.toContain("Save this answer");
  });
  it("moves only explicitly unexecuted report commands into labeled details", () => {
    const content =
      'Verified result. [ACTION: replaceText, {"selector":"ref:f0:d123","text":"A ] B"}] [ACTION: click, input[type="button"]]';
    expect(separateToolLogs(content).answer).toBe(content);
    const report = separateToolLogs(content, true, "en");
    expect(report.answer).toBe("Verified result.");
    expect(report.logs).toHaveLength(2);
    expect(report.logs.every((log) => log.startsWith("Not executed:"))).toBe(
      true,
    );
    expect(
      separateToolLogs("Report. [ACTION: click, ref:e1", true).answer,
    ).toContain("[ACTION:");
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [
          {
            role: "assistant",
            commandsNotExecuted: true,
            content: '[ACTION: findDisplayText, {"text":"Heading"}]',
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
    expect(html).toContain("Not executed:");
    expect(html).not.toContain("Display edit request");
  });
  it("does not submit while confirming IME composition or adding a newline", () => {
    expect(
      shouldSubmitChat({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
    expect(
      shouldSubmitChat({ key: "Enter", shiftKey: false, keyCode: 229 }),
    ).toBe(false);
    expect(shouldSubmitChat({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitChat({ key: "Enter", shiftKey: false })).toBe(true);
  });
  it.each(["notice", "error"] as const)(
    "does not offer answer actions on a %s",
    (kind) => {
      const html = renderToStaticMarkup(
        React.createElement(Chat, {
          messages: [
            {
              role: "assistant",
              content: "Task stopped before sending.",
              kind,
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
      expect(html).toContain(
        kind === "error" ? 'role="alert"' : 'role="status"',
      );
      expect(html).not.toContain("Save this answer");
      expect(html).not.toContain("Continue</button>");
      expect(html).not.toContain('aria-label="Copy"');
      expect(html).toContain('aria-label="Send"');
    },
  );
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
  it("keeps diagnostic logs behind a disclosure without removing the answer", () => {
    const content =
      "Final post\n🔧 Tool Execution: getHtml\n📋 Result: internal data\n";
    expect(separateToolLogs(content)).toEqual({
      answer: "Final post",
      logs: ["getHtml: internal data"],
    });
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        messages: [{ role: "assistant", content }],
        isLoading: false,
        onSendMessage: vi.fn(),
        onClearMessages: vi.fn(),
        onStopGeneration: vi.fn(),
        language: "en",
        onSaveMarkdown: vi.fn(),
        onSaveBlogDraft: vi.fn(),
      }),
    );
    expect(html).toContain("Final post");
    expect(html).toContain("<details");
    expect(html).toContain("Tool log");
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
