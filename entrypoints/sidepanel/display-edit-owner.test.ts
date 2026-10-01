import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisplayEditOwner } from "./display-edit-owner";
import { DISPLAY_EDIT_ORIGINS_KEY } from "./display-edit-permission";
import { runDisplayTextCommand } from "./display-text-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__aiBrowserBridgeDisplayV1");
});

describe("bounded display text scanning", () => {
  function setup() {
    vi.stubGlobal("self", { origin: "https://example.com" });
    vi.stubGlobal("location", { ancestorOrigins: [] });
    vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1 });
    const element = {
      children: { length: 0 },
      tagName: "SVG",
      shadowRoot: null,
    };
    const nextNode = vi.fn(() => element);
    const querySelectorAll = vi.fn(() => {
      throw new Error("Unbounded DOM collection is forbidden");
    });
    vi.stubGlobal("document", {
      querySelectorAll,
      createTreeWalker: vi.fn(() => ({ nextNode })),
    });
    vi.stubGlobal("performance", { now: vi.fn(() => 0) });
    return { nextNode, querySelectorAll };
  }
  it("walks lazily and stops at the node budget without materializing the DOM", () => {
    const { nextNode, querySelectorAll } = setup();
    expect(
      runDisplayTextCommand({
        type: "find",
        taskId: "task",
        origin: "https://example.com",
        text: "Heading",
      }),
    ).toEqual({ status: "incomplete" });
    expect(nextNode).toHaveBeenCalledTimes(50001);
    expect(querySelectorAll).not.toHaveBeenCalled();
  });
  it("checks the deadline before traversing another root", () => {
    const { nextNode } = setup();
    vi.mocked(performance.now).mockReturnValueOnce(0).mockReturnValue(201);
    expect(
      runDisplayTextCommand({
        type: "find",
        taskId: "task",
        origin: "https://example.com",
        text: "Heading",
      }),
    ).toEqual({ status: "incomplete" });
    expect(nextNode).not.toHaveBeenCalled();
  });
  it("never issues a handle for an early match when the remaining scan is incomplete", () => {
    const { nextNode } = setup();
    vi.stubGlobal("ShadowRoot", class {});
    vi.stubGlobal("getComputedStyle", () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      cursor: "auto",
    }));
    nextNode.mockReturnValueOnce({
      children: { length: 0 },
      tagName: "H2",
      shadowRoot: null,
      textContent: "Heading",
      isConnected: true,
      parentElement: null,
      getClientRects: () => [1],
      matches: () => false,
      getRootNode: () => document,
    } as never);
    expect(
      runDisplayTextCommand({
        type: "find",
        taskId: "task",
        origin: "https://example.com",
        text: "Heading",
      }),
    ).toEqual({ status: "incomplete" });
    const state = Reflect.get(globalThis, "__aiBrowserBridgeDisplayV1") as {
      handles: Map<string, unknown>;
    };
    expect(state.handles.size).toBe(0);
  });
  it("returns incomplete when ancestry inspection exhausts the search deadline", () => {
    const { nextNode } = setup();
    nextNode.mockReturnValueOnce({
      children: { length: 0 },
      tagName: "H2",
      shadowRoot: null,
      textContent: "Heading",
      isConnected: true,
      getClientRects: () => [1],
    } as never);
    vi.mocked(performance.now)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(201);
    expect(
      runDisplayTextCommand({
        type: "find",
        taskId: "task",
        origin: "https://example.com",
        text: "Heading",
      }),
    ).toEqual({ status: "incomplete" });
  });
});

describe("display editing owner", () => {
  const origin = "https://example.com";
  const url = `${origin}/page`;
  function setup() {
    const store: Record<string, unknown> = {
      [DISPLAY_EDIT_ORIGINS_KEY]: [origin],
    };
    const executeScript = vi
      .fn()
      .mockResolvedValue([
        { result: { status: "found", token: "a".repeat(32) } },
      ]);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ ...store })),
          set: vi.fn(async (next) => Object.assign(store, next)),
        },
      },
      tabs: { get: vi.fn(async () => ({ url })) },
      scripting: { executeScript },
    });
    return { owner: createDisplayEditOwner(), executeScript };
  }
  it("binds lookups to task/document and denies them after revoke or worker restart", async () => {
    const { owner, executeScript } = setup();
    const started = await owner.handle({
      type: "display-edit",
      operation: "start",
      tabId: 2,
      url,
    });
    expect(started.ok).toBe(true);
    const request = {
      type: "display-edit" as const,
      operation: "find" as const,
      taskId: started.taskId as string,
      text: "Do you need a break?",
      frames: [{ frameId: 0, documentId: "doc", origin }],
    };
    const found = await owner.handle(request);
    expect(found.result).toContain(`ref:f0:d${"a".repeat(32)}`);
    expect(executeScript.mock.calls[0][0].target).toEqual({
      tabId: 2,
      documentIds: ["doc"],
    });
    expect(executeScript.mock.calls[0][0].world).toBe("ISOLATED");
    await owner.handle({
      type: "display-edit",
      operation: "permission",
      origin,
      enabled: false,
    });
    expect((await owner.handle(request)).ok).toBe(false);
    expect((await createDisplayEditOwner().handle(request)).ok).toBe(false);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
  it("does not resurrect a task revoked while its permission read is pending", async () => {
    const { owner } = setup();
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const starting = owner.handle({
      type: "display-edit",
      operation: "start",
      tabId: 2,
      url,
      once: true,
    });
    await vi.waitFor(() =>
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1),
    );
    const revoke = owner.handle({
      type: "display-edit",
      operation: "permission",
      origin,
      enabled: false,
    });
    finish({ [DISPLAY_EDIT_ORIGINS_KEY]: [origin] });
    expect((await starting).ok).toBe(false);
    expect((await revoke).ok).toBe(true);
  });
  it("does not recover an undo record again after its document disappeared", async () => {
    const { owner, executeScript } = setup();
    const started = await owner.handle({
      type: "display-edit",
      operation: "start",
      tabId: 2,
      url,
    });
    executeScript.mockResolvedValueOnce([
      { result: { status: "changed", editId: "edit-one" } },
    ]);
    await owner.handle({
      type: "display-edit",
      operation: "edit",
      taskId: started.taskId as string,
      frames: [{ frameId: 0, documentId: "doc", origin }],
      edits: [{ selector: `ref:f0:d${"a".repeat(32)}`, text: "New heading" }],
    });
    expect(
      (
        await owner.handle({
          type: "display-edit",
          operation: "recover",
          tabId: 2,
        })
      ).edits,
    ).toHaveLength(1);
    executeScript.mockRejectedValueOnce(new Error("Document no longer exists"));
    await expect(
      owner.handle({
        type: "display-edit",
        operation: "undo",
        tabId: 2,
        url,
        documentId: "doc",
        editId: "edit-one",
      }),
    ).rejects.toThrow("Document no longer exists");
    expect(
      (
        await owner.handle({
          type: "display-edit",
          operation: "recover",
          tabId: 2,
        })
      ).edits,
    ).toEqual([]);
  });
  it("does not search another origin or silently pick across frames", async () => {
    const { owner, executeScript } = setup();
    const started = await owner.handle({
      type: "display-edit",
      operation: "start",
      tabId: 2,
      url,
    });
    const request = {
      type: "display-edit" as const,
      operation: "find" as const,
      taskId: started.taskId as string,
      text: "Heading",
      frames: [
        { frameId: 3, documentId: "other", origin: "https://other.example" },
      ],
    };
    expect((await owner.handle(request)).ok).toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
    const result = await owner.handle({
      ...request,
      frames: [
        { frameId: 0, documentId: "one", origin },
        { frameId: 3, documentId: "two", origin },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.result).toContain("more than one frame");
  });
  it("invalidates queued work immediately on revoke and reports already dispatched results", async () => {
    const { owner, executeScript } = setup();
    const started = await owner.handle({
      type: "display-edit",
      operation: "start",
      tabId: 2,
      url,
    });
    let finish!: (value: unknown) => void;
    executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = {
      type: "display-edit" as const,
      operation: "find" as const,
      taskId: started.taskId as string,
      text: "Heading",
      frames: [{ frameId: 0, documentId: "doc", origin }],
    };
    const pending = owner.handle(request);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(1));
    const queued = owner.handle(request);
    const revoke = owner.handle({
      type: "display-edit",
      operation: "permission",
      origin,
      enabled: false,
    });
    finish([{ result: { status: "found", token: "a".repeat(32) } }]);
    await pending;
    expect((await queued).ok).toBe(false);
    expect((await revoke).ok).toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
});
