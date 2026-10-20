import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_POST_PRESETS } from "../entrypoints/sidepanel/assistant-settings";

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

  it("builds post pending actions from a preset menu item", () => {
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postPreset:formal-long" },
        { id: 789, url: "https://example.com/post", title: "Post" },
        [],
        DEFAULT_POST_PRESETS,
      ),
    ).toEqual({
      type: "post",
      tone: "formal",
      length: "long",
      countRule: "x",
      useCommonInstructions: true,
      tabId: 789,
      url: "https://example.com/post",
      title: "Post",
    });
  });

  it("maps every built-in preset to its tone and length", () => {
    const cases = [
      { id: "casual-short", tone: "casual", length: "short" },
      { id: "casual-long", tone: "casual", length: "long" },
      { id: "formal-short", tone: "formal", length: "short" },
      { id: "formal-long", tone: "formal", length: "long" },
    ] as const;
    for (const { id, tone, length } of cases) {
      expect(
        backgroundModule.buildPendingActionFromContextMenu(
          { menuItemId: `postPreset:${id}` },
          { id: 1, url: "https://example.com", title: "Example" },
          [],
          DEFAULT_POST_PRESETS,
        ),
      ).toEqual({
        type: "post",
        tone,
        length,
        countRule: "x",
        useCommonInstructions: true,
        tabId: 1,
        url: "https://example.com",
        title: "Example",
      });
    }
  });

  it("carries only the clicked preset's own instructions and opt-out", () => {
    const presets = [
      { ...DEFAULT_POST_PRESETS[0], id: "mine", instructions: "  Azure  " },
      {
        ...DEFAULT_POST_PRESETS[1],
        id: "plain",
        useCommonInstructions: false,
      },
    ];
    const tab = { id: 1, url: "https://example.com", title: "Example" };
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postPreset:mine" },
        tab,
        [],
        presets,
      ),
    ).toMatchObject({ instructions: "Azure", useCommonInstructions: true });
    const plain = backgroundModule.buildPendingActionFromContextMenu(
      { menuItemId: "postPreset:plain" },
      tab,
      [],
      presets,
    );
    expect(plain).toMatchObject({ useCommonInstructions: false });
    expect(plain).not.toHaveProperty("instructions");
  });

  it("ignores unknown preset ids and does not build from the parent id", () => {
    const tab = { id: 789, url: "https://example.com/post", title: "Post" };
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postPreset:missing" },
        tab,
        [],
        DEFAULT_POST_PRESETS,
      ),
    ).toBeNull();
    expect(
      backgroundModule.buildPendingActionFromContextMenu(
        { menuItemId: "postAboutPage" },
        tab,
        [],
        DEFAULT_POST_PRESETS,
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

  it("opens the side panel before awaiting any storage access", async () => {
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
    const loadPostPresets = vi.fn(async () => {
      events.push("presets-loaded");
      return [{ ...DEFAULT_POST_PRESETS[0], id: "mine" }];
    });

    const result = backgroundModule.handleContextMenuClick(
      { menuItemId: "postPreset:mine" } as chrome.contextMenus.OnClickData,
      { id: 123, windowId: 999, url: "https://example.com" } as chrome.tabs.Tab,
      {
        setPendingAction,
        openSidePanel,
        loadCustomPrompts: vi.fn(async () => []),
        loadPostPresets,
      },
    );

    // ここまで await していない時点で、パネルを開く呼び出しは済んでいる必要がある
    expect(events).toEqual(["open-called", "presets-loaded"]);
    expect(openSidePanel).toHaveBeenCalledWith(999);
    await vi.waitFor(() => expect(setPendingAction).toHaveBeenCalled());
    expect(setPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "post", id: expect.any(String) }),
    );
    resolveStore?.();
    await result;
  });

  it("opens the side panel for summarize without waiting for storage", async () => {
    const setPendingAction = vi.fn(() => new Promise<void>(() => undefined));
    const openSidePanel = vi.fn(async () => undefined);

    void backgroundModule.handleContextMenuClick(
      { menuItemId: "summarizePage" } as chrome.contextMenus.OnClickData,
      { id: 123, windowId: 999, url: "https://example.com" } as chrome.tabs.Tab,
      {
        setPendingAction,
        openSidePanel,
        loadCustomPrompts: vi.fn(async () => []),
        loadPostPresets: vi.fn(async () => []),
      },
    );

    expect(openSidePanel).toHaveBeenCalledWith(999);
    expect(setPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "summarize", id: expect.any(String) }),
    );
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
        loadPostPresets: vi.fn(async () => []),
      },
    );

    expect(setPendingAction).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
  });
});

describe("buildContextMenuSpecs", () => {
  it("loads preset instructions from storage only when a preset is clicked", async () => {
    const loadPostPresets = vi.fn(async () => [
      { ...DEFAULT_POST_PRESETS[0], id: "mine", instructions: "Azure" },
    ]);
    const loadCustomPrompts = vi.fn(async () => []);
    const setPendingAction = vi.fn(async () => undefined);
    const deps = {
      setPendingAction,
      openSidePanel: vi.fn(async () => undefined),
      loadCustomPrompts,
      loadPostPresets,
    };
    const tab = { id: 1, windowId: 9, url: "https://example.com" };

    await backgroundModule.handleContextMenuClick(
      { menuItemId: "summarizePage" } as chrome.contextMenus.OnClickData,
      tab as chrome.tabs.Tab,
      deps,
    );
    expect(loadPostPresets).not.toHaveBeenCalled();

    await backgroundModule.handleContextMenuClick(
      { menuItemId: "postPreset:mine" } as chrome.contextMenus.OnClickData,
      tab as chrome.tabs.Tab,
      deps,
    );
    expect(setPendingAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "post", instructions: "Azure" }),
    );
  });
  it("creates one child per preset under the post parent", () => {
    const specs = backgroundModule.buildContextMenuSpecs(
      [],
      [
        { ...DEFAULT_POST_PRESETS[0], id: "a", name: "  Azure " },
        { ...DEFAULT_POST_PRESETS[1], id: "b", name: "" },
      ],
    );
    const children = specs.filter(
      (spec) => spec.parentId === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(children).toEqual([
      {
        id: "postPreset:a",
        parentId: backgroundModule.POST_PARENT_MENU_ID,
        title: "Azure",
        contexts: ["page"],
      },
      {
        id: "postPreset:b",
        parentId: backgroundModule.POST_PARENT_MENU_ID,
        title: "Post",
        contexts: ["page"],
      },
    ]);
  });
  it("omits the post parent when every preset was deleted", () => {
    const ids = backgroundModule
      .buildContextMenuSpecs([], [])
      .map((spec) => spec.id);
    expect(ids).not.toContain(backgroundModule.POST_PARENT_MENU_ID);
  });
  it("registers the post submenu as a parent with the four built-in children", () => {
    const specs = backgroundModule.buildContextMenuSpecs([]);
    const parent = specs.find(
      (spec) => spec.id === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(parent).toBeDefined();
    expect(parent?.parentId).toBeUndefined();

    const children = specs.filter(
      (spec) => spec.parentId === backgroundModule.POST_PARENT_MENU_ID,
    );
    expect(children.map((spec) => spec.id)).toEqual(
      DEFAULT_POST_PRESETS.map((preset) => `postPreset:${preset.id}`),
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
