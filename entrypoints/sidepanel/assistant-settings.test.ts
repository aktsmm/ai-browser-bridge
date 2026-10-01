import { describe, expect, it } from "vitest";
import {
  buildChatContext,
  normalizeAssistantSettings,
} from "./assistant-settings";
import {
  buildContextInstructions,
  isChatContext,
} from "../../standalone-bridge/src/chat-context";
import { t } from "./i18n";
import {
  canEditDisplay,
  displayEditOrigin,
  normalizeDisplayEditOrigins,
} from "./display-edit-permission";

describe("assistant settings", () => {
  it("remembers display editing only for exact, valid site origins", () => {
    const origins = normalizeDisplayEditOrigins([
      "https://example.com",
      "https://example.com",
      "https://example.com/path",
      "https://user:secret@example.com",
      "chrome://settings",
      "https://other.example",
      null,
    ]);
    expect(origins).toEqual(["https://example.com", "https://other.example"]);
    expect(
      normalizeDisplayEditOrigins({ "https://example.com": true }),
    ).toEqual([]);
    expect(displayEditOrigin("https://example.com/page")).toBe(
      "https://example.com",
    );
    const options = {
      url: "https://example.com/page",
      mode: "input",
      browserActionsEnabled: true,
      task: false,
      once: false,
      origins,
    };
    expect(canEditDisplay(options)).toBe(true);
    expect(canEditDisplay({ ...options, url: "https://sub.example.com" })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, url: "http://example.com" })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, mode: "read-only", once: true })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, task: true, once: true })).toBe(false);
    expect(canEditDisplay({ ...options, browserActionsEnabled: false })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, origins: [] })).toBe(false);
    expect(canEditDisplay({ ...options, once: true, origins: [] })).toBe(true);
    expect(canEditDisplay({ ...options, url: "", once: true })).toBe(false);
    expect(canEditDisplay({ ...options, mode: "unknown", once: true })).toBe(
      false,
    );
  });
  it("defaults to input assist and preserves bounded, unique profiles", () => {
    expect(normalizeAssistantSettings(null).mode).toBe("input");
    expect(normalizeAssistantSettings(null).responseLanguage).toBe("inherit");
    expect(
      normalizeAssistantSettings({ responseLanguage: "en" }).responseLanguage,
    ).toBe("en");
    expect(
      normalizeAssistantSettings({ responseLanguage: "fr" }).responseLanguage,
    ).toBe("inherit");
    expect(normalizeAssistantSettings({ mode: "read-only" }).mode).toBe(
      "read-only",
    );
    const settings = normalizeAssistantSettings({
      profiles: [{ id: "a", name: "A", instructions: "x" }, { id: "a" }],
      selectedProfileId: "missing",
    });
    expect(settings.profiles).toHaveLength(1);
    expect(settings.selectedProfileId).toBe("a");
  });
  it("applies post instructions only to the selected task", () => {
    const settings = normalizeAssistantSettings({
      globalInstructions: "Global",
      mode: "automation",
      post: { name: "Azure Post", instructions: "Azure audience" },
    });
    const target = { tabId: 1, url: "https://example.com/" };
    const post = buildChatContext(settings, target, "ok", {
      kind: "post",
      instructions: "default",
    });
    expect(post.taskInstructions).toBe("Azure audience");
    expect(post.allowedActions).toEqual([]);
    expect(isChatContext(post)).toBe(true);
    const chat = buildChatContext(settings, target, "ok");
    expect(chat.taskInstructions).toBe("");
    expect(chat.globalInstructions).toBe("Global");
    expect(chat.allowedActions).toContain("click");
    expect(
      buildChatContext(settings, target, "ok", undefined, false).allowedActions,
    ).toEqual([]);
  });
  it("uses the interface language for custom actions unless a response language is saved", () => {
    const settings = normalizeAssistantSettings({
      globalInstructions: "Keep answers concise",
    });
    const custom = {
      kind: "custom" as const,
      instructions: "Summarize the page",
    };
    const japanese = buildChatContext(
      settings,
      undefined,
      "ok",
      custom,
      true,
      "ja",
    );
    expect(japanese.responseLanguage).toBe("ja");
    expect(japanese.globalInstructions).toBe("Keep answers concise");
    expect(buildContextInstructions(japanese, "standalone")).toContain(
      "Reply in Japanese unless",
    );
    expect(
      buildChatContext(settings, undefined, "ok", custom, true, "en")
        .responseLanguage,
    ).toBe("en");

    const english = normalizeAssistantSettings({
      responseLanguage: "en",
      globalInstructions: "日本語で答えて",
    });
    const context = buildChatContext(
      english,
      undefined,
      "ok",
      custom,
      true,
      "ja",
    );
    expect(context.responseLanguage).toBe("en");
    expect(context.globalInstructions).toBe("日本語で答えて");
    expect(buildContextInstructions(context, "standalone")).toContain(
      "explicitly specify another language",
    );
    expect(isChatContext({ ...context, responseLanguage: "invalid" })).toBe(
      false,
    );
  });
  it("advertises display editing only for an explicitly enabled assistant task", () => {
    const settings = normalizeAssistantSettings({ mode: "input" });
    const target = { tabId: 2, url: "https://example.com/" };
    const ordinary = buildChatContext(settings, target, "ok");
    expect(ordinary.allowedActions).not.toContain("replaceText");
    expect(buildContextInstructions(ordinary, "standalone")).not.toContain(
      "[ACTION: replaceText",
    );
    const enabled = buildChatContext(
      settings,
      target,
      "ok",
      undefined,
      true,
      "ja",
      true,
    );
    expect(enabled.allowedActions).toContain("replaceText");
    expect(buildContextInstructions(enabled, "standalone")).toContain(
      "[ACTION: replaceText",
    );
    expect(buildContextInstructions(enabled, "standalone")).toContain(
      '"edits":[{',
    );
    expect(isChatContext({ ...enabled, displayEditingEnabled: "yes" })).toBe(
      false,
    );
    expect(
      buildChatContext(
        settings,
        target,
        "ok",
        { kind: "custom", instructions: "summary" },
        true,
        "ja",
        true,
      ).allowedActions,
    ).not.toContain("replaceText");
  });
  it("does not report a requested download as saved without a completion result", () => {
    const lookup = buildChatContext(
      normalizeAssistantSettings({ mode: "input" }),
      { tabId: 2, url: "https://example.com/" },
      "ok",
      undefined,
      true,
      "ja",
      true,
      true,
    );
    expect(lookup.allowedActions).toContain("findDisplayText");
    expect(isChatContext(lookup)).toBe(true);
    expect(isChatContext({ ...lookup, displayTextLookupVersion: 2 })).toBe(
      false,
    );
    expect(buildContextInstructions(lookup, "standalone")).toContain(
      "static headings inside forms",
    );
    expect(
      buildContextInstructions(
        { ...lookup, allowedActions: ["replaceText"] },
        "standalone",
      ),
    ).toContain("ref:f0:d<token>");
    expect(
      buildContextInstructions({ ...lookup, allowedActions: [] }, "standalone"),
    ).not.toContain("[ACTION: findDisplayText");
    expect(
      buildContextInstructions(
        {
          ...lookup,
          displayTextLookupVersion: undefined,
          allowedActions: ["replaceText"],
        },
        "standalone",
      ),
    ).toContain("do not target forms");
    const context = buildChatContext(
      normalizeAssistantSettings({ mode: "automation" }),
      { tabId: 2, url: "https://example.com/" },
      "ok",
    );
    expect(buildContextInstructions(context, "standalone")).toContain(
      "Download requested is not download completed",
    );
    expect(t("loopContinuationPrompt", "en")).toContain(
      "Do not report a download as complete without a verified completion result",
    );
    expect(t("loopContinuationPrompt", "ja")).toContain(
      "保存完了の検証結果がないダウンロードは完了と報告しないでください",
    );
    expect(t("downloadResults", "en")).toBe("File save results");
  });
});
