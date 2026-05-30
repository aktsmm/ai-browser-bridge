import { describe, expect, it } from "vitest";

import { getQuickActions } from "./Chat";

describe("getQuickActions", () => {
  it("uses grounded, non-navigating Japanese prompts", () => {
    const prompts = getQuickActions("ja").map((action) => action.prompt);

    expect(prompts.join("\n")).toContain("ブラウザ操作");
    expect(prompts.join("\n")).toContain("抽出済み本文");
    expect(prompts.join("\n")).toContain("Markdown");
    expect(prompts.every((prompt) => prompt.includes("ページ遷移"))).toBe(true);
  });

  it("uses grounded, non-navigating English prompts", () => {
    const prompts = getQuickActions("en").map((action) => action.prompt);

    expect(prompts.join("\n")).toContain("extracted page text");
    expect(prompts.join("\n")).toContain("Do not navigate");
    expect(prompts.join("\n")).toContain("Markdown");
    expect(prompts.every((prompt) => prompt.includes("Do not navigate"))).toBe(
      true,
    );
  });
});
