import { afterEach, describe, expect, it, vi } from "vitest";

import { parseActionsFromResponse } from "./browser-actions";
import {
  browserActionAllowed,
  parseFrameReference,
  resolveProfileValue,
} from "./browser-execution";
import { executeBoundBrowserAction } from "./browser-execution";
import {
  buildChatContext,
  normalizeAssistantSettings,
} from "./assistant-settings";

describe("bound browser execution policy", () => {
  const context = buildChatContext(
    normalizeAssistantSettings({ mode: "input" }),
    { tabId: 2, url: "https://example.com/" },
    "ok",
  );
  it("blocks submit, script execution and input-mode navigation", () => {
    expect(
      browserActionAllowed(
        { type: "type", selector: "ref:e1", text: "data", submit: true },
        context,
      ),
    ).toBe(false);
    expect(
      browserActionAllowed(
        { type: "evaluate", script: "document.forms[0].submit()" },
        context,
      ),
    ).toBe(false);
    expect(
      browserActionAllowed(
        { type: "navigate", url: "https://other.example/" },
        context,
      ),
    ).toBe(false);
    expect(
      browserActionAllowed(
        { type: "type", selector: "ref:e1", text: "data" },
        context,
      ),
    ).toBe(true);
  });
  it("keeps frame identity separate from the local element ref", () => {
    expect(parseFrameReference("ref:f3:e8")).toEqual({
      frameId: 3,
      selector: "ref:e8",
    });
    expect(parseFrameReference("#input")).toEqual({
      frameId: 0,
      selector: "#input",
    });
  });
  it("resolves personal fields locally only when explicitly available", () => {
    expect(
      resolveProfileValue("{{profile.fullName}}", {
        fullName: "Example Person",
      }),
    ).toBe("Example Person");
    expect(() => resolveProfileValue("{{profile.fullName}}")).toThrow(
      "not authorized",
    );
    expect(() =>
      resolveProfileValue("{{profile.password}}", { password: "not-allowed" }),
    ).toThrow();
  });
  afterEach(() => vi.unstubAllGlobals());
});

describe("parseActionsFromResponse security bounds", () => {
  afterEach(() => vi.unstubAllGlobals());
  const context = buildChatContext(
    normalizeAssistantSettings({ mode: "input" }),
    { tabId: 2, url: "https://example.com/" },
    "ok",
  );
  it("ignores negative and oversized optional timeouts", () => {
    expect(
      parseActionsFromResponse("[ACTION: waitForSelector, #ready,-1]"),
    ).toEqual([
      { type: "waitForSelector", selector: "#ready,-1", timeout: undefined },
    ]);
    expect(
      parseActionsFromResponse("[ACTION: waitForText, Complete,99999999]"),
    ).toEqual([
      { type: "waitForText", text: "Complete,99999999", timeout: undefined },
    ]);
  });

  it("preserves bounded optional timeouts", () => {
    expect(
      parseActionsFromResponse("[ACTION: waitForTextGone, Loading,5000]"),
    ).toEqual([{ type: "waitForTextGone", text: "Loading", timeout: 5000 }]);
  });

  it("uses the captured tab and document rather than the active tab", async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValue([{ result: "Field value verified; not submitted" }]);
    const query = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 2, url: "https://example.com/" }),
        query,
      },
      scripting: { executeScript },
    });
    const result = await executeBoundBrowserAction(
      { type: "type", selector: "ref:f3:e8", text: "{{profile.fullName}}" },
      {
        context,
        frames: [
          {
            frameId: 3,
            documentId: "verified-document",
            origin: "https://example.com",
          },
        ],
        personal: { fullName: "Example Person" },
      },
    );
    expect(result).not.toContain("Example Person");
    expect(query).not.toHaveBeenCalled();
    expect(executeScript.mock.calls[0][0].target).toEqual({
      tabId: 2,
      documentIds: ["verified-document"],
    });
    expect(executeScript.mock.calls[0][0].args[0]).toMatchObject({
      selector: "ref:e8",
      text: "Example Person",
    });
  });
  it("rejects target drift and cancellation before injecting any input", async () => {
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi
          .fn()
          .mockResolvedValue({ id: 2, url: "https://other.example/" }),
      },
      scripting: { executeScript },
    });
    const action = { type: "type" as const, selector: "ref:e1", text: "Test" };
    expect(
      await executeBoundBrowserAction(action, { context, frames: [] }),
    ).toContain("target page changed");
    const controller = new AbortController();
    controller.abort();
    expect(
      await executeBoundBrowserAction(action, {
        context,
        frames: [],
        signal: controller.signal,
      }),
    ).toContain("cancelled");
    expect(executeScript).not.toHaveBeenCalled();
  });
  it.each(["https://other.example", undefined, "null"])(
    "does not disclose personal data to frame origin %s",
    async (origin) => {
      const executeScript = vi.fn();
      vi.stubGlobal("chrome", {
        tabs: {
          get: vi
            .fn()
            .mockResolvedValue({ id: 2, url: "https://example.com/" }),
        },
        scripting: { executeScript },
      });
      const result = await executeBoundBrowserAction(
        {
          type: "fillForm",
          fields: [{ selector: "ref:f3:e8", value: "{{profile.fullName}}" }],
        },
        {
          context,
          frames: [{ frameId: 3, documentId: "foreign-document", origin }],
          personal: { fullName: "Private Test" },
        },
      );
      expect(result).toContain("does not include this frame origin");
      expect(executeScript).not.toHaveBeenCalled();
    },
  );
  it("truncates malformed raw Playwright params", () => {
    const longRaw = "{" + "x".repeat(12_000);
    const [action] = parseActionsFromResponse(
      `[ACTION: playwright, browser_click, ${longRaw}]`,
    );

    expect(action).toMatchObject({
      type: "playwright",
      action: "browser_click",
    });
    if (!action || action.type !== "playwright") {
      throw new Error("Expected playwright action");
    }
    expect(String(action.params.raw).length).toBeLessThan(10_050);
    expect(String(action.params.raw)).toContain("[truncated]");
  });
  it("rejects an ambiguous selector inside the injected executor", async () => {
    vi.stubGlobal("document", {
      querySelectorAll: vi.fn((selector: string) =>
        selector === "*" ? [] : [{}, {}],
      ),
    });
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 2, url: "https://example.com/" }),
      },
      scripting: {
        executeScript: vi.fn(
          async (injection: {
            func: (action: unknown) => Promise<string>;
            args: unknown[];
          }) => [{ result: await injection.func(injection.args[0]) }],
        ),
      },
    });
    expect(
      await executeBoundBrowserAction(
        { type: "type", selector: "input", text: "Test" },
        { context, frames: [{ frameId: 0, documentId: "doc" }] },
      ),
    ).toContain("element not found");
  });
  it("does not navigate when cancelled during permission lookup", async () => {
    const controller = new AbortController();
    const update = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 2, url: "https://example.com/" }),
        update,
      },
      permissions: {
        contains: vi.fn(async () => {
          controller.abort();
          return true;
        }),
      },
    });
    const automation = buildChatContext(
      normalizeAssistantSettings({ mode: "automation" }),
      context.target,
      "ok",
    );
    expect(
      await executeBoundBrowserAction(
        { type: "navigate", url: "https://other.example/" },
        { context: automation, frames: [], signal: controller.signal },
      ),
    ).toContain("cancelled");
    expect(update).not.toHaveBeenCalled();
  });
});
