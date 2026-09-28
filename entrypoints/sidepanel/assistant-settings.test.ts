import { describe, expect, it } from "vitest";
import {
  buildChatContext,
  normalizeAssistantSettings,
} from "./assistant-settings";
import {
  buildContextInstructions,
  isChatContext,
} from "../../standalone-bridge/src/chat-context";

describe("assistant settings", () => {
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
});
