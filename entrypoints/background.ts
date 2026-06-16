// Background Script - Service Worker
// サイドパネルの開閉制御、コンテキストメニュー
import { isValidDownloadId } from "./sidepanel/download-id";
import {
  CUSTOM_PROMPTS_STORAGE_KEY,
  DEFAULT_CUSTOM_PROMPTS,
  normalizeCustomPrompts,
} from "./sidepanel/pending-action";
import type { CustomPrompt, PendingAction } from "./sidepanel/pending-action";

/** カスタムプロンプトのコンテキストメニュー id 接頭辞。 */
export const CUSTOM_PROMPT_MENU_PREFIX = "customPrompt:";

type ContextMenuDeps = {
  setPendingAction: (pendingAction: PendingAction) => Promise<void>;
  openSidePanel: (windowId: number) => Promise<void>;
  loadCustomPrompts: () => Promise<CustomPrompt[]>;
};

export function buildPendingActionFromContextMenu(
  info: Pick<chrome.contextMenus.OnClickData, "menuItemId" | "selectionText">,
  tab?: Pick<chrome.tabs.Tab, "id" | "url" | "title">,
  customPrompts: CustomPrompt[] = [],
): PendingAction | null {
  if (info.menuItemId === "askAboutSelection" && info.selectionText) {
    return {
      type: "question",
      text: info.selectionText,
      tabId: tab?.id,
      url: tab?.url,
      title: tab?.title,
    };
  }

  if (info.menuItemId === "summarizePage") {
    return {
      type: "summarize",
      tabId: tab?.id,
      url: tab?.url,
      title: tab?.title,
    };
  }

  if (info.menuItemId === "postAboutPage") {
    return {
      type: "post",
      tabId: tab?.id,
      url: tab?.url,
      title: tab?.title,
    };
  }

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(CUSTOM_PROMPT_MENU_PREFIX)
  ) {
    const id = info.menuItemId.slice(CUSTOM_PROMPT_MENU_PREFIX.length);
    const prompt = customPrompts.find((item) => item.id === id);
    const body = prompt?.body.trim();
    if (!body) return null;
    return {
      type: "customPrompt",
      text: body,
      promptName: prompt?.name,
      tabId: tab?.id,
      url: tab?.url,
      title: tab?.title,
    };
  }

  return null;
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  deps: ContextMenuDeps,
): Promise<void> {
  if (typeof tab?.windowId !== "number") return;

  const isCustomPrompt =
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(CUSTOM_PROMPT_MENU_PREFIX);
  const customPrompts = isCustomPrompt ? await deps.loadCustomPrompts() : [];

  const pendingAction = buildPendingActionFromContextMenu(
    info,
    tab,
    customPrompts,
  );
  if (!pendingAction) return;

  const storePromise = deps.setPendingAction(pendingAction);
  const openPromise = deps.openSidePanel(tab.windowId);
  await Promise.all([storePromise, openPromise]);
}

export default defineBackground({
  type: "module",

  main() {
    const openSidePanel = async (windowId: number): Promise<void> => {
      try {
        await browser.sidePanel.open({ windowId });
      } catch (error) {
        console.error(
          "GitHub Copilot Browser Bridge: Failed to open side panel",
          error,
        );
      }
    };

    const setPendingAction = async (
      pendingAction: PendingAction,
    ): Promise<void> => {
      try {
        await browser.storage.local.set({ pendingAction });
      } catch (error) {
        console.error(
          "GitHub Copilot Browser Bridge: Failed to store pending action",
          error,
        );
      }
    };

    const loadCustomPrompts = async (): Promise<CustomPrompt[]> => {
      try {
        const stored = await browser.storage.local.get(
          CUSTOM_PROMPTS_STORAGE_KEY,
        );
        return normalizeCustomPrompts(stored[CUSTOM_PROMPTS_STORAGE_KEY]);
      } catch (error) {
        console.error(
          "GitHub Copilot Browser Bridge: Failed to load custom prompts",
          error,
        );
        return DEFAULT_CUSTOM_PROMPTS.map((prompt) => ({ ...prompt }));
      }
    };

    // コンテキストメニューを（静的 + カスタムプロンプト）再構築する
    const setupContextMenus = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        browser.contextMenus.removeAll(() => resolve());
      });

      browser.contextMenus.create({
        id: "askAboutSelection",
        title: "GitHub Copilot Browser Bridgeで質問",
        contexts: ["selection"],
      });

      browser.contextMenus.create({
        id: "summarizePage",
        title: "このページを要約",
        contexts: ["page"],
      });

      browser.contextMenus.create({
        id: "postAboutPage",
        title: "このページでポストを作成",
        contexts: ["page"],
      });

      const customPrompts = await loadCustomPrompts();
      customPrompts.forEach((prompt) => {
        const title = prompt.name.trim();
        const body = prompt.body.trim();
        if (!title || !body) return;
        browser.contextMenus.create({
          id: `${CUSTOM_PROMPT_MENU_PREFIX}${prompt.id}`,
          title,
          contexts: ["page", "selection"],
        });
      });
    };

    // アクションクリックでサイドパネルを開く
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        console.error(
          "GitHub Copilot Browser Bridge: Failed to set side panel behavior",
          error,
        );
      });

    // コンテキストメニュー作成
    browser.runtime.onInstalled.addListener(() => {
      void setupContextMenus();
    });

    // カスタムプロンプト変更時にメニューを再構築
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[CUSTOM_PROMPTS_STORAGE_KEY]) {
        void setupContextMenus();
      }
    });

    // コンテキストメニュークリック
    browser.contextMenus.onClicked.addListener(
      async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
        await handleContextMenuClick(info, tab, {
          setPendingAction,
          openSidePanel,
          loadCustomPrompts,
        });
      },
    );

    // メッセージハンドラ（ダウンロード等）
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => {
        if (!message || typeof message !== "object") {
          return;
        }

        const typedMessage = message as {
          type: string;
          filename?: string;
          content?: string;
          mimeType?: string;
          downloadId?: number;
        };

        if (typedMessage.type === "download-file") {
          const { filename, content, mimeType } = typedMessage;

          if (typeof content !== "string") {
            sendResponse({
              success: false,
              error: "content must be a string",
            });
            return;
          }

          if (filename !== undefined && typeof filename !== "string") {
            sendResponse({
              success: false,
              error: "filename must be a string",
            });
            return;
          }

          if (mimeType !== undefined && typeof mimeType !== "string") {
            sendResponse({
              success: false,
              error: "mimeType must be a string",
            });
            return;
          }

          const encodeUtf8ToBase64 = (value: string): string => {
            const bytes = new TextEncoder().encode(value);
            let binary = "";
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(
                ...bytes.subarray(i, i + chunkSize),
              );
            }
            return btoa(binary);
          };

          const encodedContent = encodeUtf8ToBase64(content);
          const dataUrl = `data:${mimeType || "text/plain;charset=utf-8"};base64,${encodedContent}`;
          void browser.downloads
            .download({
              url: dataUrl,
              filename: filename || "download.txt",
              saveAs: false,
            })
            .then((downloadId) => {
              sendResponse({ success: true, downloadId });
            })
            .catch((error: unknown) => {
              sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return true; // async response
        }

        if (typedMessage.type === "show-download") {
          try {
            if (!isValidDownloadId(typedMessage.downloadId)) {
              sendResponse({
                success: false,
                error: "valid downloadId is required",
              });
              return;
            }
            browser.downloads.show(typedMessage.downloadId);
            sendResponse({ success: true });
          } catch (e) {
            sendResponse({
              success: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }
      },
    );

    console.log("GitHub Copilot Browser Bridge: Background script loaded");
  },
});
