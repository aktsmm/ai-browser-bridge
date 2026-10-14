import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_POST_PRESETS,
  createPostPreset,
  normalizeAssistantSettings,
} from "../assistant-settings";
import { AssistantPreferences } from "./AssistantPreferences";

function render(postCount: number, language: "ja" | "en" = "en") {
  const base = normalizeAssistantSettings(null);
  const posts = Array.from({ length: postCount }, (_, index) => ({
    ...createPostPreset(),
    id: `p${index}`,
    name: `Post ${index}`,
  }));
  return renderToStaticMarkup(
    <AssistantPreferences
      value={{ ...base, posts }}
      onChange={vi.fn()}
      language={language}
    />,
  );
}

function buttonFor(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${label}</button>`));
  expect(match, `button "${label}" must be rendered`).not.toBeNull();
  return match![0];
}

describe("AssistantPreferences post presets", () => {
  it("renders one independent editor per preset", () => {
    const html = render(3);
    for (const name of ["Post 0", "Post 1", "Post 2"]) {
      expect(html).toContain(name);
    }
    expect(html.match(/>Delete<\/button>/g)).toHaveLength(3);
  });

  it("allows adding while below the preset limit", () => {
    expect(buttonFor(render(2), "Add preset")).not.toContain('disabled=""');
  });

  it("disables add and duplicate at the preset limit", () => {
    const html = render(MAX_POST_PRESETS);
    expect(buttonFor(html, "Add preset")).toContain('disabled=""');
    for (const duplicate of html.match(/<button[^>]*>Duplicate<\/button>/g) ??
      []) {
      expect(duplicate).toContain('disabled=""');
    }
  });

  it("keeps remove available even at the limit", () => {
    const html = render(MAX_POST_PRESETS);
    for (const remove of html.match(/<button[^>]*>Delete<\/button>/g) ?? []) {
      expect(remove).not.toContain('disabled=""');
    }
  });

  it("disables move-up on the first and move-down on the last preset", () => {
    const html = render(2);
    const ups = html.match(/<button[^>]*>Move up<\/button>/g) ?? [];
    const downs = html.match(/<button[^>]*>Move down<\/button>/g) ?? [];
    expect(ups[0]).toContain('disabled=""');
    expect(ups[1]).not.toContain('disabled=""');
    expect(downs[0]).not.toContain('disabled=""');
    expect(downs[1]).toContain('disabled=""');
  });

  it("renders the empty state without crashing", () => {
    const html = render(0, "ja");
    expect(html).toContain("ポストのプリセット");
  });
});
