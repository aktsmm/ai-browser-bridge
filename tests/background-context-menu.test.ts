import { beforeAll, describe, expect, it, vi } from "vitest";

type BackgroundModule = typeof import("../entrypoints/background");

let backgroundModule: BackgroundModule;

beforeAll(async () => {
  vi.stubGlobal("defineBackground", (config: unknown) => config);
  backgroundModule = await import("../entrypoints/background");
});

describe("background context menu actions", () => {
  it("builds summarize pending actions from the context menu tab", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "summarizePage" },
        { id: 123, url: "https://example.com", title: "Example" },
      ),
    ).toEqual({
      type: "summarize",
      tabId: 123,
      url: "https://example.com",
      title: "Example",
    });
  });

  it("builds question pending actions from selected text", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "askAboutSelection", selectionText: "  selected text  " },
        { id: 456, url: "https://example.com/page", title: "Page" },
      ),
    ).toEqual({
      type: "question",
      text: "  selected text  ",
      tabId: 456,
      url: "https://example.com/page",
      title: "Page",
    });
  });

  it("builds post pending actions from the page context submenu", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postFormalLong" },
        { id: 789, url: "https://example.com/post", title: "Post" },
      ),
    ).toEqual({
      type: "post",
      tone: "formal",
      length: "long",
      tabId: 789,
      url: "https://example.com/post",
      title: "Post",
    });
  });

  it("maps every post submenu item to its tone and length", () => {
    const cases = [
      { id: "postCasualShort", tone: "casual", length: "short" },
      { id: "postCasualLong", tone: "casual", length: "long" },
      { id: "postFormalShort", tone: "formal", length: "short" },
      { id: "postFormalLong", tone: "formal", length: "long" },
    ] as const;
    for (const { id, tone, length } of cases) {
      expect(
        backgroundModule.buildPendingActionFromContextMenu(
          { menuItemId: id },
          { id: 1, url: "https://example.com", title: "Example" },
        ),
      ).toEqual({
        type: "post",
        tone,
        length,
        tabId: 1,
        url: "https://example.com",
        title: "Example",
      });
    }
  });

  it("does not build a post action from the parent menu id alone", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postAboutPage" },
        { id: 789, url: "https://example.com/post", title: "Post" },
      ),
    ).toBeNull();
  });

  it("resolves custom prompt menu items to their stored body", () => {
    const customPrompts = [
      { id: "custom-1", name: "Deep dive", body: "  Dig deeper  " },
    ];
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: `${backgroundModule.CUSTOM_PROMPT_MENU_PREFIX}custom-1` },
        { id: 1, url: "https://example.com", title: "Example" },
        customPrompts,
      ),
    ).toEqual({
      type: "customPrompt",
      text: "Dig deeper",
      promptName: "Deep dive",
      tabId: 1,
      url: "https://example.com",
      title: "Example",
    });
  });

  it("ignores custom prompt menu items with empty body", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: `${backgroundModule.CUSTOM_PROMPT_MENU_PREFIX}custom-1` },
        { id: 1 },
        [{ id: "custom-1", name: "Empty", body: "   " }],
      ),
    ).toBeNull();
  });

  it("opens the side panel without waiting for pending action storage", async () => {
    const events: string[] = [];
    let resolveStore: (() => void) | undefined;
    const setPendingAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          events.push("store-started");
          resolveStore = resolve;
        }),
    );
    const openSidePanel = vi.fn(async () => {
      events.push("open-called");
    });

    const result = backgroundModule.handleContextMenuClick(
      { menuItemId: "summarizePage" } as chrome.contextMenus.OnClickData,
      { id: 123, windowId: 999, url: "https://example.com" } as chrome.tabs.Tab,
      {
        setPendingAction,
        openSidePanel,
        loadCustomPrompts: vi.fn(async () => []),
      },
    );

    expect(events).toEqual(["store-started", "open-called"]);
    expect(openSidePanel).toHaveBeenCalledWith(999);
    resolveStore?.();
    await result;
  });

  it("does not open the side panel for unrelated menu actions", async () => {
    const setPendingAction = vi.fn(async () => undefined);
    const openSidePanel = vi.fn(async () => undefined);

    await backgroundModule.handleContextMenuClick(
      { menuItemId: "unknown" } as chrome.contextMenus.OnClickData,
      { id: 123, windowId: 999 } as chrome.tabs.Tab,
      {
        setPendingAction,
        openSidePanel,
        loadCustomPrompts: vi.fn(async () => []),
      },
    );

    expect(setPendingAction).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
  });
});

describe("buildContextMenuSpecs", () => {
  it("registers the post submenu as a parent with four children", () => {
    const specs = backgroundModule.buildContextMenuSpecs([]);
    const parent = specs.find(
      (spec) => spec.id === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(parent).toBeDefined();
    expect(parent?.parentId).toBeUndefined();

    const children = specs.filter(
      (spec) => spec.parentId === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(children.map((spec) => spec.id).sort()).toEqual(
      Object.keys(backgroundModule.POST_MENU_ITEMS).sort(),
    );
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.contexts).toEqual(["page"]);
    }
  });

  it("creates each parent before its children", () => {
    const specs = backgroundModule.buildContextMenuSpecs([]);
    const parentIndex = specs.findIndex(
      (spec) => spec.id === backgroundModule.POST_PARENT_MENU_ID,
    );
    const firstChildIndex = specs.findIndex(
      (spec) => spec.parentId === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(parentIndex).toBeLessThan(firstChildIndex);
  });

  it("includes the static selection and summarize entries", () => {
    const ids = backgroundModule.buildContextMenuSpecs([]).map((s) => s.id);
    expect(ids).toContain("askAboutSelection");
    expect(ids).toContain("summarizePage");
  });

  it("pins the static entries' order, contexts and titles", () => {
    const specs = backgroundModule.buildContextMenuSpecs([]);
    expect(specs.slice(0, 3)).toEqual([
      {
        id: "askAboutSelection",
        title: "AI Browser Bridgeで質問",
        contexts: ["selection"],
      },
      {
        id: "summarizePage",
        title: "このページを要約",
        contexts: ["page"],
      },
      {
        id: backgroundModule.POST_PARENT_MENU_ID,
        title: "このページでポストを作成",
        contexts: ["page"],
      },
    ]);
  });

  it("gives custom prompt entries page and selection contexts", () => {
    const specs = backgroundModule.buildContextMenuSpecs([
      { id: "a1", name: "有効", body: "本文あり" },
    ]);
    const custom = specs.find((s) => s.id === "customPrompt:a1");
    expect(custom?.contexts).toEqual(["page", "selection"]);
  });

  it("appends valid custom prompts and skips empty ones", () => {
    const specs = backgroundModule.buildContextMenuSpecs([
      { id: "a1", name: "有効", body: "本文あり" },
      { id: "a2", name: "  ", body: "本文あり" },
      { id: "a3", name: "名前あり", body: "   " },
    ]);
    const customIds = specs
      .map((s) => s.id)
      .filter((id) => id.startsWith("customPrompt:"));
    expect(customIds).toEqual(["customPrompt:a1"]);
  });
});
