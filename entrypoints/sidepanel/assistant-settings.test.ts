import { describe, expect, it } from "vitest";
import {
  buildChatContext,
  normalizeAssistantSettings,
} from "./assistant-settings";
import { isChatContext } from "../../standalone-bridge/src/chat-context";

describe("assistant settings", () => {
  it("defaults to read only and preserves bounded, unique profiles", () => {
    expect(normalizeAssistantSettings(null).mode).toBe("read-only");
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
});
