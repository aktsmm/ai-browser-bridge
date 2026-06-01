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
      { setPendingAction, openSidePanel },
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
      { setPendingAction, openSidePanel },
    );

    expect(setPendingAction).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
  });
});