import { describe, expect, it } from "vitest";
import {
  MAX_POST_PRESETS,
  buildChatContext,
  buildPostPresetPrompt,
  presetXLimit,
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
    };
    expect(canEditDisplay(options)).toBe(true);
    expect(canEditDisplay({ ...options, url: "https://sub.example.com" })).toBe(
      true,
    );
    expect(canEditDisplay({ ...options, mode: "read-only" })).toBe(false);
    expect(canEditDisplay({ ...options, task: true })).toBe(false);
    expect(canEditDisplay({ ...options, browserActionsEnabled: false })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, url: "" })).toBe(false);
    expect(canEditDisplay({ ...options, url: "chrome://settings" })).toBe(
      false,
    );
    expect(canEditDisplay({ ...options, mode: "unknown" })).toBe(false);
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
  it("applies instructions only to the task that carries them", () => {
    const settings = normalizeAssistantSettings({
      globalInstructions: "Global",
      mode: "automation",
    });
    const target = { tabId: 1, url: "https://example.com/" };
    const post = buildChatContext(settings, target, "ok", {
      kind: "post",
      instructions: "Azure audience",
    });
    expect(post.taskInstructions).toBe("Azure audience");
    expect(post.globalInstructions).toBe("Global");
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
  it("drops global and profile instructions when a post opts out", () => {
    const settings = normalizeAssistantSettings({
      globalInstructions: "Global",
      profiles: [{ id: "p", name: "P", instructions: "Profile" }],
    });
    const optedOut = buildChatContext(settings, undefined, "ok", {
      kind: "post",
      instructions: "mine",
      useCommonInstructions: false,
    });
    expect(optedOut.globalInstructions).toBe("");
    expect(optedOut.profileInstructions).toBe("");
    expect(optedOut.taskInstructions).toBe("mine");
    const optedIn = buildChatContext(settings, undefined, "ok", {
      kind: "post",
      instructions: "mine",
    });
    expect(optedIn.globalInstructions).toBe("Global");
    expect(optedIn.profileInstructions).toBe("Profile");
  });
  it("starts with the four built-in post presets", () => {
    const { posts } = normalizeAssistantSettings(null);
    expect(posts.map((post) => `${post.tone}-${post.length}`)).toEqual([
      "casual-short",
      "casual-long",
      "formal-short",
      "formal-long",
    ]);
    expect(posts.every((post) => post.instructions === "")).toBe(true);
    expect(posts.every((post) => post.useCommonInstructions)).toBe(true);
  });
  it("keeps post presets independent, bounded and unique", () => {
    const many = Array.from({ length: 15 }, (_, index) => ({
      id: `p${index}`,
      name: `P${index}`,
      instructions: `i${index}`,
      tone: "casual",
      length: "long",
      useCommonInstructions: false,
    }));
    const settings = normalizeAssistantSettings({
      posts: [{ id: "dup", name: "A" }, { id: "dup", name: "B" }, ...many],
    });
    expect(settings.posts).toHaveLength(MAX_POST_PRESETS);
    expect(settings.posts[0]).toMatchObject({
      id: "dup",
      name: "A",
      tone: "formal",
      length: "short",
      useCommonInstructions: true,
    });
    expect(new Set(settings.posts.map((post) => post.id)).size).toBe(
      settings.posts.length,
    );
    expect(settings.posts[1]).toMatchObject({
      useCommonInstructions: false,
      tone: "casual",
      length: "long",
    });
  });
  it("allows deleting every post preset", () => {
    expect(normalizeAssistantSettings({ posts: [] }).posts).toEqual([]);
  });
  it("migrates a legacy single custom post only when it has instructions", () => {
    const legacy = normalizeAssistantSettings({
      post: { name: "Azure Post", instructions: "Azure audience" },
    });
    expect(legacy.posts).toHaveLength(5);
    expect(legacy.posts[4]).toMatchObject({
      name: "Azure Post",
      instructions: "Azure audience",
      tone: "formal",
      length: "short",
    });
    expect(
      normalizeAssistantSettings({
        post: { name: "Custom Post", instructions: "   " },
      }).posts,
    ).toHaveLength(4);
    expect(
      normalizeAssistantSettings({
        post: { name: "Custom Post", instructions: "x" },
      }).posts[4].name,
    ).toBe("カスタム投稿");
  });
  it("builds a preset prompt from its instructions or its tone and length", () => {
    const base = { tone: "casual", length: "short", countRule: "x" } as const;
    const custom = buildPostPresetPrompt(
      { ...base, instructions: "  custom  " },
      "ja",
    );
    expect(custom.startsWith("custom\n")).toBe(true);
    expect(custom).toContain("重み付き");
    expect(
      buildPostPresetPrompt(
        { ...base, countRule: "none", instructions: "  custom  " },
        "ja",
      ),
    ).toBe("custom");
    const builtin = buildPostPresetPrompt({ ...base, instructions: "" }, "ja");
    expect(builtin).toContain("全体280以内");
    expect(builtin).toContain("カジュアル");
  });
  it("limits the X counter to presets that use the X rule", () => {
    expect(presetXLimit({ length: "short", countRule: "x" })).toBe(280);
    expect(presetXLimit({ length: "long", countRule: "x" })).toBe(1000);
    expect(
      presetXLimit({ length: "short", countRule: "none" }),
    ).toBeUndefined();
    const { posts } = normalizeAssistantSettings({
      posts: [
        { id: "a", name: "A", countRule: "none" },
        { id: "b", name: "B" },
      ],
    });
    expect(posts.map((post) => post.countRule)).toEqual(["none", "x"]);
    expect(
      normalizeAssistantSettings(null).posts.every(
        (post) => post.countRule === "x",
      ),
    ).toBe(true);
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
