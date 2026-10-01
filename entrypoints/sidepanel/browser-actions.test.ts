import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadTextFile,
  parseActionsFromResponse,
  parseFirstBrowserAction,
} from "./browser-actions";
import {
  actionUsesPersonalProfile,
  browserActionAllowed,
  forgetDisplayEdits,
  hasUndoableDisplayEdit,
  inspectButtonClick,
  parseFrameReference,
  resolveProfileValue,
  undoLastDisplayEdit,
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
  it("only protects a profile-authorized tab before using a personal field", () => {
    expect(
      actionUsesPersonalProfile({
        type: "type",
        selector: "ref:e1",
        text: "Plain text",
      }),
    ).toBe(false);
    expect(
      actionUsesPersonalProfile({
        type: "replaceText",
        selector: "ref:e1",
        text: "Demo label",
      }),
    ).toBe(false);
    expect(
      actionUsesPersonalProfile({
        type: "type",
        selector: "ref:e1",
        text: "{{profile.fullName}}",
      }),
    ).toBe(true);
    expect(
      actionUsesPersonalProfile(
        { type: "type", selector: "ref:e1", text: "Private Name" },
        { fullName: "Private Name" },
      ),
    ).toBe(true);
    expect(
      actionUsesPersonalProfile(
        { type: "type", selector: "ref:e1", text: "Different Name" },
        { fullName: "Private Name" },
      ),
    ).toBe(false);
    expect(
      actionUsesPersonalProfile({
        type: "fillForm",
        fields: [
          { selector: "ref:e1", value: "Plain text" },
          { selector: "ref:e2", value: "{{profile.custom1}}" },
        ],
      }),
    ).toBe(true);
  });
  it("blocks submit, script execution and input-mode navigation", () => {
    expect(
      browserActionAllowed(
        { type: "replaceText", selector: "ref:e1", text: "Sample" },
        context,
      ),
    ).toBe(false);
    expect(
      browserActionAllowed(
        { type: "replaceText", selector: "ref:e1", text: "Sample" },
        {
          ...context,
          displayEditingEnabled: true,
          allowedActions: [...context.allowedActions, "replaceText"],
        },
      ),
    ).toBe(true);
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
  it("parses only bounded, reference-targeted display edits", () => {
    expect(
      parseFirstBrowserAction(
        '[ACTION: replaceText, {"edits":[{"selector":"text=Do you need a break?","text":"Enjoy Work"}]}][ACTION: click, ref:e2]',
      ),
    ).toEqual({ error: "invalid-action" });
    expect(
      parseFirstBrowserAction('[ACTION: replaceText, {"selector":"ref:e1"'),
    ).toEqual({ error: "invalid-action" });
    expect(parseFirstBrowserAction("No operation requested")).toEqual({});
    expect(
      parseFirstBrowserAction(
        '[ACTION: replaceText, {"selector":"ref:e1","text":"Enjoy Work"}]',
      ),
    ).toEqual({
      action: { type: "replaceText", selector: "ref:e1", text: "Enjoy Work" },
    });
    expect(
      parseActionsFromResponse(
        '[ACTION: replaceText, {"selector":"ref:f3:e8","text":"Demo balance"}]',
      ),
    ).toEqual([
      { type: "replaceText", selector: "ref:f3:e8", text: "Demo balance" },
    ]);
    expect(
      parseActionsFromResponse(
        '[ACTION: replaceText, {"selector":"body","text":"Demo"}]',
      ),
    ).toEqual([]);
    expect(
      parseActionsFromResponse(
        '[ACTION: replaceText, {"selector":"ref:e1","text":""}]',
      ),
    ).toEqual([]);
    expect(
      parseActionsFromResponse(
        '[ACTION: replaceText, {"edits":[{"selector":"ref:e1","text":"Demo A"},{"selector":"ref:e2","text":"Demo B"}]}]',
      ),
    ).toEqual([
      {
        type: "replaceText",
        edits: [
          { selector: "ref:e1", text: "Demo A" },
          { selector: "ref:e2", text: "Demo B" },
        ],
      },
    ]);
    expect(
      parseActionsFromResponse(
        '[ACTION: replaceText, {"edits":[{"selector":"ref:e1","text":"A"},{"selector":"ref:e1","text":"B"}]}]',
      ),
    ).toEqual([]);
    expect(
      browserActionAllowed(
        { type: "replaceText", selector: "body", text: "Demo" },
        {
          ...context,
          displayEditingEnabled: true,
          allowedActions: [...context.allowedActions, "replaceText"],
        },
      ),
    ).toBe(false);
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
    expect(
      resolveProfileValue("{{profile.custom1}}", { custom1: "Private Org" }),
    ).toBe("Private Org");
    expect(() => resolveProfileValue("{{profile.custom1}}")).toThrow(
      "not authorized",
    );
    expect(() =>
      resolveProfileValue("{{profile.custom6}}", { custom6: "blocked" }),
    ).toThrow();
    expect(() =>
      resolveProfileValue("{{profile.password}}", { password: "not-allowed" }),
    ).toThrow();
  });
  afterEach(() => vi.unstubAllGlobals());
});

describe("generated file download completion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("waits for Chrome to complete before reporting the file as saved", async () => {
    let onChanged:
      | ((change: { id: number; state: { current: string } }) => void)
      | undefined;
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 7, state: "in_progress" }])
      .mockResolvedValue([{ id: 7, state: "complete" }]);
    const removeListener = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: (
          _message: unknown,
          callback: (response: unknown) => void,
        ) => callback({ success: true, downloadId: 7 }),
      },
      downloads: {
        search,
        onChanged: {
          addListener: (listener: typeof onChanged) => {
            onChanged = listener;
          },
          removeListener,
        },
      },
    });
    let settled = false;
    const saved = downloadTextFile("receipt.md", "fixture").then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    onChanged?.({ id: 7, state: { current: "complete" } });
    expect(await saved).toMatchObject({ success: true, downloadId: 7 });
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it.each(["complete", "interrupted"])(
    "handles an already %s download without waiting for another event",
    async (state) => {
      const removeListener = vi.fn();
      vi.stubGlobal("chrome", {
        runtime: {
          sendMessage: (
            _message: unknown,
            callback: (response: unknown) => void,
          ) => callback({ success: true, downloadId: 8 }),
        },
        downloads: {
          search: vi.fn().mockResolvedValue([{ id: 8, state }]),
          onChanged: { addListener: vi.fn(), removeListener },
        },
      });
      const result = await downloadTextFile("receipt.md", "fixture");
      expect(result.success).toBe(state === "complete");
      expect(result.error).toBe(
        state === "interrupted" ? "Download was interrupted" : undefined,
      );
      expect(removeListener).toHaveBeenCalledOnce();
    },
  );

  it("reports a stalled download as a failure and releases its listener", async () => {
    vi.useFakeTimers();
    try {
      const removeListener = vi.fn();
      vi.stubGlobal("chrome", {
        runtime: {
          sendMessage: (
            _message: unknown,
            callback: (response: unknown) => void,
          ) => callback({ success: true, downloadId: 9 }),
        },
        downloads: {
          search: vi.fn().mockResolvedValue([{ id: 9, state: "in_progress" }]),
          onChanged: { addListener: vi.fn(), removeListener },
        },
      });
      const pending = downloadTextFile("receipt.md", "fixture");
      await vi.advanceTimersByTimeAsync(30000);
      expect(await pending).toMatchObject({
        success: false,
        error: "Download did not complete",
      });
      expect(removeListener).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid download id without starting a completion wait", async () => {
    const search = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: (
          _message: unknown,
          callback: (response: unknown) => void,
        ) => callback({ success: true, downloadId: -1 }),
      },
      downloads: {
        search,
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    const result = await downloadTextFile("receipt.md", "fixture");
    expect(result.success).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });
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
  it("clicks only an approved ordinary button, never a submission button", async () => {
    class FakeButton {
      textContent = "領収書表示";
      type = "button";
      disabled = false;
      click = vi.fn();
      getClientRects = () => [{}];
      closest = () => null;
    }
    const button = new FakeButton();
    vi.stubGlobal("HTMLLabelElement", class {});
    vi.stubGlobal("HTMLButtonElement", FakeButton);
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLAnchorElement", class {});
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector === '[data-copilot-ref="e5"]' ? [button] : [],
    });
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: "https://example.com/" }),
      },
      scripting: {
        executeScript: vi.fn(async ({ func, args }) => [
          { result: await func(...args) },
        ]),
      },
    });
    const automation = buildChatContext(
      normalizeAssistantSettings({ mode: "automation" }),
      context.target,
      "ok",
    );
    const session = {
      context: automation,
      frames: [{ frameId: 0, documentId: "doc" }],
    };
    const action = { type: "click" as const, selector: "ref:e5" };
    const preview = await inspectButtonClick(action, {
      ...session,
      frames: [
        { frameId: 0, documentId: "doc", origin: "https://example.com" },
      ],
    });
    expect(preview).toEqual({
      selector: "ref:e5",
      documentId: "doc",
      origin: "https://example.com",
      label: "領収書表示",
    });
    const controller = new AbortController();
    const executeScript = chrome.scripting.executeScript as ReturnType<
      typeof vi.fn
    >;
    executeScript.mockImplementationOnce(async ({ func, args }) => {
      controller.abort();
      return [{ result: await func(...args) }];
    });
    expect(
      await inspectButtonClick(action, {
        ...session,
        signal: controller.signal,
        frames: [
          { frameId: 0, documentId: "doc", origin: "https://example.com" },
        ],
      }),
    ).toBeNull();
    expect(await executeBoundBrowserAction(action, session)).toContain(
      "approval is required",
    );
    expect(button.click).not.toHaveBeenCalled();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e5",
          documentId: "doc",
          label: "領収書表示",
        },
      }),
    ).toContain("outcome unverified");
    expect(button.click).toHaveBeenCalledOnce();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e5",
          documentId: "other-doc",
          label: "領収書表示",
        },
      }),
    ).toContain("Error");
    expect(
      await executeBoundBrowserAction(
        { ...action, doubleClick: true },
        {
          ...session,
          approvedClick: {
            selector: "ref:e5",
            documentId: "doc",
            label: "領収書表示",
          },
        },
      ),
    ).toContain("Error");
    expect(button.click).toHaveBeenCalledOnce();
    button.textContent = "別のボタン";
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e5",
          documentId: "doc",
          label: "領収書表示",
        },
      }),
    ).toContain("approved button changed");
    button.disabled = true;
    expect(
      await inspectButtonClick(action, {
        ...session,
        frames: [
          { frameId: 0, documentId: "doc", origin: "https://example.com" },
        ],
      }),
    ).toBeNull();
    button.disabled = false;
    button.textContent = "送信";
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: { selector: "ref:e5", documentId: "doc", label: "送信" },
      }),
    ).toContain("Error");
    expect(button.click).toHaveBeenCalledOnce();
  });
  it("requires site approval for same-origin download links and rejects foreign downloads", async () => {
    class FakeAnchor {
      href = "https://example.com/receipt.pdf";
      textContent = "Download receipt";
      target = "";
      click = vi.fn();
      getClientRects = () => [{}];
      hasAttribute = (name: string): boolean => name === "download";
      closest = () => null;
    }
    const link = new FakeAnchor();
    vi.stubGlobal("HTMLLabelElement", class {});
    vi.stubGlobal("HTMLAnchorElement", FakeAnchor);
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLButtonElement", class {});
    vi.stubGlobal("location", {
      href: "https://example.com/",
      origin: "https://example.com",
    });
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector === '[data-copilot-ref="e6"]' ? [link] : [],
    });
    vi.stubGlobal("chrome", {
      tabs: { get: vi.fn().mockResolvedValue({ url: "https://example.com/" }) },
      scripting: {
        executeScript: vi.fn(async ({ func, args }) => [
          { result: await func(...args) },
        ]),
      },
    });
    const session = {
      context: buildChatContext(
        normalizeAssistantSettings({ mode: "automation" }),
        context.target,
        "ok",
      ),
      frames: [
        { frameId: 0, documentId: "doc", origin: "https://example.com" },
      ],
    };
    const action = { type: "click" as const, selector: "ref:e6" };
    expect(await inspectButtonClick(action, session)).toMatchObject({
      label: "Download receipt",
    });
    expect(await executeBoundBrowserAction(action, session)).toContain(
      "approval is required",
    );
    expect(link.click).not.toHaveBeenCalled();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e6",
          documentId: "doc",
          label: "Download receipt",
          href: link.href,
        },
      }),
    ).toContain("outcome unverified");
    expect(link.click).toHaveBeenCalledOnce();
    link.href = "https://example.com/changed.pdf";
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e6",
          documentId: "doc",
          label: "Download receipt",
          href: "https://example.com/receipt.pdf",
        },
      }),
    ).toContain("Error");
    expect(link.click).toHaveBeenCalledOnce();
    link.href = "https://example.com/checkout?format=pdf";
    expect(await inspectButtonClick(action, session)).toBeNull();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e6",
          documentId: "doc",
          label: "Download receipt",
          href: link.href,
        },
      }),
    ).toContain("Error");
    expect(link.click).toHaveBeenCalledOnce();
    link.href = "https://example.com/%63heckout?format=pdf";
    expect(await inspectButtonClick(action, session)).toBeNull();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e6",
          documentId: "doc",
          label: "Download receipt",
          href: link.href,
        },
      }),
    ).toContain("Error");
    expect(link.click).toHaveBeenCalledOnce();
    link.hasAttribute = () => false;
    expect(await executeBoundBrowserAction(action, session)).toContain(
      "user action",
    );
    link.href = "https://example.com/%ZZ";
    expect(await executeBoundBrowserAction(action, session)).toContain(
      "user action",
    );
    link.hasAttribute = (name: string) => name === "download";
    link.href = "https://other.example/receipt.pdf";
    expect(await inspectButtonClick(action, session)).toBeNull();
    expect(
      await executeBoundBrowserAction(action, {
        ...session,
        approvedClick: {
          selector: "ref:e6",
          documentId: "doc",
          label: "Download receipt",
          href: "https://example.com/receipt.pdf",
        },
      }),
    ).toContain("Error");
    expect(link.click).toHaveBeenCalledOnce();
  });
  it("rejects URL-encoded destructive navigation without opening a new page", async () => {
    const update = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: "https://example.com/" }),
        update,
      },
    });
    const automation = buildChatContext(
      normalizeAssistantSettings({ mode: "automation" }),
      context.target,
      "ok",
    );
    expect(
      await executeBoundBrowserAction(
        { type: "navigate", url: "https://example.com/%63heckout" },
        { context: automation, frames: [] },
      ),
    ).toContain("user action");
    expect(
      await executeBoundBrowserAction(
        { type: "navigate", url: "https://example.com/%ZZ" },
        { context: automation, frames: [] },
      ),
    ).toContain("user action");
    expect(update).not.toHaveBeenCalled();
  });
  it("edits one display element without returning its original text and undoes only unchanged edits", async () => {
    class FakeElement {
      tagName = "P";
      children: Element[] = [];
      textContent = "Private balance";
      attributes = new Map<string, string>();
      getClientRects = () => [{}];
      closest = () => null;
      hasAttribute = (name: string) => this.attributes.has(name);
      setAttribute = (name: string, value: string) =>
        this.attributes.set(name, value);
      removeAttribute = (name: string) => this.attributes.delete(name);
    }
    const element = new FakeElement();
    const second = new FakeElement();
    second.textContent = "Real tenant";
    vi.stubGlobal("HTMLLabelElement", class {});
    vi.stubGlobal("getComputedStyle", () => ({ cursor: "auto" }));
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector === "*"
          ? []
          : selector === '[data-copilot-ref="e8"]'
            ? [element]
            : selector === '[data-copilot-ref="e9"]'
              ? [second]
              : [element, second].filter(
                  (candidate) =>
                    selector ===
                    `[data-copilot-edit-id="${candidate.attributes.get("data-copilot-edit-id")}"]`,
                ),
    });
    const mainDocument = document;
    const executeScript = vi.fn(
      async (injection: {
        func: (...args: any[]) => unknown;
        args: unknown[];
      }) => [{ result: await injection.func(...injection.args) }],
    );
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 2, url: "https://example.com/" }),
      },
      scripting: { executeScript },
    });
    const context = buildChatContext(
      normalizeAssistantSettings({ mode: "input" }),
      { tabId: 2, url: "https://example.com/" },
      "ok",
      undefined,
      true,
      "ja",
      true,
    );
    const session = {
      context,
      frames: [
        { frameId: 0, documentId: "doc", origin: "https://example.com" },
      ],
    };
    const action = {
      type: "replaceText" as const,
      selector: "ref:e8",
      text: "Demo balance",
    };
    const result = await executeBoundBrowserAction(action, session);
    expect(result).toBe("Display text changed; not submitted");
    expect(result).not.toContain("Private balance");
    expect(element.textContent).toBe("Demo balance");
    expect(hasUndoableDisplayEdit(2)).toBe(true);
    element.textContent = "SPA rewrite";
    expect(await undoLastDisplayEdit(2)).toBe(false);
    expect(element.textContent).toBe("SPA rewrite");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    element.textContent = "Demo balance";
    element.removeAttribute("data-copilot-edit-id");
    element.textContent = "Private balance";
    expect(await executeBoundBrowserAction(action, session)).toBe(
      "Display text changed; not submitted",
    );
    expect(await undoLastDisplayEdit(2)).toBe(true);
    expect(element.textContent).toBe("Private balance");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    const batch = {
      type: "replaceText" as const,
      edits: [
        { selector: "ref:e8", text: "Demo balance" },
        { selector: "ref:e9", text: "Demo tenant" },
      ],
    };
    expect(
      await executeBoundBrowserAction(
        {
          type: "replaceText",
          edits: [
            { selector: "ref:e8", text: "Demo balance" },
            { selector: "ref:f3:e9", text: "Demo tenant" },
          ],
        },
        session,
      ),
    ).toContain("one frame per action");
    expect(element.textContent).toBe("Private balance");
    second.tagName = "BUTTON";
    expect(await executeBoundBrowserAction(batch, session)).toContain(
      "nothing changed",
    );
    expect(element.textContent).toBe("Private balance");
    expect(second.textContent).toBe("Real tenant");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    second.tagName = "P";
    expect(await executeBoundBrowserAction(batch, session)).toBe(
      "Display text changed; not submitted",
    );
    expect(element.textContent).toBe("Demo balance");
    expect(second.textContent).toBe("Demo tenant");
    second.textContent = "SPA rewrite";
    expect(await undoLastDisplayEdit(2)).toBe(false);
    expect(element.textContent).toBe("Demo balance");
    expect(second.textContent).toBe("SPA rewrite");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    element.textContent = "Private balance";
    second.textContent = "Real tenant";
    element.removeAttribute("data-copilot-edit-id");
    second.removeAttribute("data-copilot-edit-id");
    expect(await executeBoundBrowserAction(batch, session)).toBe(
      "Display text changed; not submitted",
    );
    expect(await undoLastDisplayEdit(2)).toBe(true);
    expect(element.textContent).toBe("Private balance");
    expect(second.textContent).toBe("Real tenant");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    element.tagName = "BUTTON";
    expect(await executeBoundBrowserAction(action, session)).toContain(
      "nothing changed",
    );
    element.tagName = "P";
    expect(await executeBoundBrowserAction(action, session)).toBe(
      "Display text changed; not submitted",
    );
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector === "*"
          ? [
              {
                shadowRoot: {
                  querySelectorAll: (query: string) =>
                    query.startsWith("[data-copilot-edit-id=") ? [element] : [],
                },
              },
            ]
          : [],
    });
    expect(await undoLastDisplayEdit(2)).toBe(true);
    expect(element.textContent).toBe("Private balance");
    vi.stubGlobal("document", mainDocument);
    expect(await executeBoundBrowserAction(action, session)).toBe(
      "Display text changed; not submitted",
    );
    forgetDisplayEdits(2);
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    element.removeAttribute("data-copilot-edit-id");
    element.textContent = "Private balance";
    const otherSession = {
      ...session,
      context: {
        ...context,
        target: { tabId: 3, url: "https://example.com/" },
      },
    };
    expect(await executeBoundBrowserAction(action, session)).toBe(
      "Display text changed; not submitted",
    );
    expect(
      await executeBoundBrowserAction(
        { type: "replaceText", selector: "ref:e9", text: "Demo tenant" },
        otherSession,
      ),
    ).toBe("Display text changed; not submitted");
    expect(hasUndoableDisplayEdit(2)).toBe(true);
    expect(hasUndoableDisplayEdit(3)).toBe(true);
    expect(await undoLastDisplayEdit(2)).toBe(true);
    expect(second.textContent).toBe("Demo tenant");
    expect(hasUndoableDisplayEdit(3)).toBe(true);
    expect(await undoLastDisplayEdit(3)).toBe(true);
    expect(second.textContent).toBe("Real tenant");
    expect(hasUndoableDisplayEdit(2)).toBe(false);
    expect(hasUndoableDisplayEdit(3)).toBe(false);
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
