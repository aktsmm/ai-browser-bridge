import { describe, expect, it } from "vitest";
import {
  buildArtifactRelativePath,
  buildBlogDraftContent,
  buildSavedMarkdownContent,
  slugifyArtifactSegment,
  getAnswerArtifactInput,
} from "./artifact-template";

describe("artifact templates", () => {
  it("distinguishes rapid saves and bounds long page-title filenames", () => {
    const date = new Date("2026-09-22T12:00:00Z");
    const first = buildArtifactRelativePath(
      "output/blog",
      "Very long title ".repeat(40),
      "summary",
      date,
      "save-one",
    );
    const second = buildArtifactRelativePath(
      "output/blog",
      "Very long title ".repeat(40),
      "summary",
      date,
      "save-two",
    );
    expect(first).not.toBe(second);
    expect(first.split("/").at(-1)!.length).toBeLessThan(180);
    expect(first).toContain("-save-one.md");
  });
  it("exports the selected answer with its original source, not the current tab", () => {
    const input = getAnswerArtifactInput({
      role: "assistant",
      content: "Earlier answer",
      source: {
        pageTitle: "Original page",
        pageUrl: "https://original.example/",
      },
    });
    expect(input?.assistantContent).toBe("Earlier answer");
    expect(input?.pageUrl).toBe("https://original.example/");
    expect(
      getAnswerArtifactInput({ role: "assistant", content: "Legacy answer" })
        ?.pageUrl,
    ).toBe("");
    expect(
      getAnswerArtifactInput({
        role: "assistant",
        content: "Saved",
        kind: "notice",
      }),
    ).toBeNull();
  });
  it("marks interrupted answers as partial in both export formats", () => {
    const input = getAnswerArtifactInput({
      role: "assistant",
      content: "Partial text",
      incomplete: true,
    })!;
    expect(buildSavedMarkdownContent(input)).toContain(
      "Partial (generation interrupted)",
    );
    expect(buildBlogDraftContent(input)).toContain(
      "Partial (generation interrupted)",
    );
  });
  it("slugifies titles for filenames", () => {
    expect(slugifyArtifactSegment("Hello, GitHub Copilot! 2026")).toBe(
      "hello-github-copilot-2026",
    );
  });

  it("builds blog artifact paths under the configured base path", () => {
    const createdAt = new Date("2026-05-27T12:34:56.000Z");
    expect(
      buildArtifactRelativePath(
        "output/blog",
        "Product Update",
        "blog-draft",
        createdAt,
      ),
    ).toContain("output/blog/");
  });

  it("builds saved markdown content with URL and assistant body", () => {
    const content = buildSavedMarkdownContent({
      pageTitle: "Example",
      pageUrl: "https://example.com",
      assistantContent: "Summary body",
      createdAt: new Date("2026-05-27T12:00:00.000Z"),
    });

    expect(content).toContain("# Example");
    expect(content).toContain("https://example.com");
    expect(content).toContain("Summary body");
  });

  it("builds blog draft content with primary sources section", () => {
    const content = buildBlogDraftContent({
      pageTitle: "Example",
      pageUrl: "https://example.com",
      assistantContent: "Notes body",
      createdAt: new Date("2026-05-27T12:00:00.000Z"),
    });

    expect(content).toContain("## Draft Notes");
    expect(content).toContain("## Primary Sources");
  });
});
