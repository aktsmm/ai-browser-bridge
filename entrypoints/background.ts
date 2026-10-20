// Background Script - Service Worker
// サイドパネルの開閉制御、コンテキストメニュー
import { isValidDownloadId } from "./sidepanel/download-id";
import {
  createDisplayEditOwner,
  type DisplayOwnerMessage,
} from "./sidepanel/display-edit-owner";
import {
  DISPLAY_EDIT_ORIGINS_KEY,
  normalizeDisplayEditOrigins,
} from "./sidepanel/display-edit-permission";
import {
  ASSISTANT_SETTINGS_KEY,
  DEFAULT_POST_PRESETS,
  normalizeAssistantSettings,
  type PostPreset,
} from "./sidepanel/assistant-settings";
import {
  CUSTOM_PROMPTS_STORAGE_KEY,
  DEFAULT_CUSTOM_PROMPTS,
  normalizeCustomPrompts,
} from "./sidepanel/pending-action";
import type { CustomPrompt, PendingAction } from "./sidepanel/pending-action";

/** カスタムプロンプトのコンテキストメニュー id 接頭辞。 */
export const CUSTOM_PROMPT_MENU_PREFIX = "customPrompt:";

/** ポストプリセットのコンテキストメニュー id 接頭辞。 */
export const POST_PRESET_MENU_PREFIX = "postPreset:";

/** ポスト作成サブメニューの親 id。 */
export const POST_PARENT_MENU_ID = "postAboutPage";

/** コンテキストメニュー1項目の生成仕様。`browser.contextMenus.create` にそのまま渡せる。 */
export type ContextMenuSpec = {
  id: string;
  title: string;
  contexts: ["page" | "selection", ...("page" | "selection")[]];
  parentId?: string;
};

/**
 * 登録すべきコンテキストメニュー項目の一覧を純粋関数として返す。
 * 静的項目（選択質問 / 要約 / ポスト親）＋ ポストプリセット（子）＋ 有効なカスタムプロンプトを、
 * 実際に `create` する順序で返す（親は子より前）。副作用を持たないためテスト可能。
 */
export function buildContextMenuSpecs(
  customPrompts: CustomPrompt[] = [],
  postPresets: readonly PostPreset[] = DEFAULT_POST_PRESETS,
): ContextMenuSpec[] {
  const specs: ContextMenuSpec[] = [
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
  ];

  if (postPresets.length > 0) {
    specs.push({
      id: POST_PARENT_MENU_ID,
      title: "このページでポストを作成",
      contexts: ["page"],
    });
    for (const preset of postPresets) {
      specs.push({
        id: `${POST_PRESET_MENU_PREFIX}${preset.id}`,
        parentId: POST_PARENT_MENU_ID,
        title: preset.name.trim() || "Post",
        contexts: ["page"],
      });
    }
  }

  for (const prompt of customPrompts) {
    const title = prompt.name.trim();
    const body = prompt.body.trim();
    if (!title || !body) continue;
    specs.push({
      id: `${CUSTOM_PROMPT_MENU_PREFIX}${prompt.id}`,
      title,
      contexts: ["page", "selection"],
    });
  }

  return specs;
}

type ContextMenuDeps = {
  setPendingAction: (pendingAction: PendingAction) => Promise<void>;
  openSidePanel: (windowId: number) => Promise<void>;
  loadCustomPrompts: () => Promise<CustomPrompt[]>;
  loadPostPresets: () => Promise<PostPreset[]>;
};

export function buildPendingActionFromContextMenu(
  info: Pick<chrome.contextMenus.OnClickData, "menuItemId" | "selectionText">,
  tab?: Pick<chrome.tabs.Tab, "id" | "url" | "title">,
  customPrompts: CustomPrompt[] = [],
  postPresets: readonly PostPreset[] = [],
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

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(POST_PRESET_MENU_PREFIX)
  ) {
    const id = info.menuItemId.slice(POST_PRESET_MENU_PREFIX.length);
    const preset = postPresets.find((item) => item.id === id);
    if (!preset) return null;
    const instructions = preset.instructions.trim();
    return {
      type: "post",
      tone: preset.tone,
      length: preset.length,
      ...(instructions ? { instructions } : {}),
      countRule: preset.countRule,
      useCommonInstructions: preset.useCommonInstructions,
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

function opensSidePanel(
  info: Pick<chrome.contextMenus.OnClickData, "menuItemId" | "selectionText">,
): boolean {
  const id = info.menuItemId;
  if (typeof id !== "string") return false;
  return (
    id === "summarizePage" ||
    (id === "askAboutSelection" && Boolean(info.selectionText)) ||
    id.startsWith(POST_PRESET_MENU_PREFIX) ||
    id.startsWith(CUSTOM_PROMPT_MENU_PREFIX)
  );
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  deps: ContextMenuDeps,
): Promise<void> {
  if (typeof tab?.windowId !== "number") return;

  // sidePanel.open() はユーザー操作の直後でないと失敗するため、ストレージ読込など
  // 非同期処理の前に同期的に呼び出す。
  const openPromise = opensSidePanel(info)
    ? deps.openSidePanel(tab.windowId)
    : Promise.resolve();

  const isCustomPrompt =
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(CUSTOM_PROMPT_MENU_PREFIX);
  const customPrompts = isCustomPrompt ? await deps.loadCustomPrompts() : [];
  const isPostPreset =
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(POST_PRESET_MENU_PREFIX);
  const postPresets = isPostPreset ? await deps.loadPostPresets() : [];

  const pendingAction = buildPendingActionFromContextMenu(
    info,
    tab,
    customPrompts,
    postPresets,
  );
  if (!pendingAction) {
    await openPromise;
    return;
  }

  const storePromise = deps.setPendingAction({
    ...pendingAction,
    id: crypto.randomUUID(),
  });
  await Promise.all([storePromise, openPromise]);
}

export default defineBackground({
  type: "module",

  main() {
    const openSidePanel = async (windowId: number): Promise<void> => {
      try {
        await browser.sidePanel.open({ windowId });
      } catch (error) {
        console.error("AI Browser Bridge: Failed to open side panel", error);
      }
    };

    const setPendingAction = async (
      pendingAction: PendingAction,
    ): Promise<void> => {
      try {
        await browser.storage.local.set({ pendingAction });
      } catch (error) {
        console.error(
          "AI Browser Bridge: Failed to store pending action",
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
          "AI Browser Bridge: Failed to load custom prompts",
          error,
        );
        return DEFAULT_CUSTOM_PROMPTS.map((prompt) => ({ ...prompt }));
      }
    };

    const loadPostPresets = async (): Promise<PostPreset[]> => {
      try {
        const stored = await browser.storage.local.get(ASSISTANT_SETTINGS_KEY);
        return normalizeAssistantSettings(stored[ASSISTANT_SETTINGS_KEY]).posts;
      } catch (error) {
        console.error("AI Browser Bridge: Failed to load post presets", error);
        return [];
      }
    };

    // コンテキストメニューを（静的 + ポストプリセット + カスタムプロンプト）再構築する
    const setupContextMenus = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        browser.contextMenus.removeAll(() => resolve());
      });

      const customPrompts = await loadCustomPrompts();
      const postPresets = await loadPostPresets();
      for (const spec of buildContextMenuSpecs(customPrompts, postPresets)) {
        browser.contextMenus.create(spec);
      }
    };

    // アクションクリックでサイドパネルを開く
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        console.error(
          "AI Browser Bridge: Failed to set side panel behavior",
          error,
        );
      });

    // コンテキストメニュー作成
    browser.runtime.onInstalled.addListener(() => {
      void setupContextMenus();
    });

    // カスタムプロンプト変更時にメニューを再構築
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (
        areaName === "local" &&
        (changes[CUSTOM_PROMPTS_STORAGE_KEY] || changes[ASSISTANT_SETTINGS_KEY])
      ) {
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
          loadPostPresets,
        });
      },
    );

    const displayOwner = createDisplayEditOwner();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[DISPLAY_EDIT_ORIGINS_KEY])
        displayOwner.revokeOrigins(
          normalizeDisplayEditOrigins(
            changes[DISPLAY_EDIT_ORIGINS_KEY].newValue,
          ),
        );
    });
    // メッセージハンドラ（ダウンロード等）
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
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

        if (typedMessage.type === "display-edit") {
          if (
            sender.id !== chrome.runtime.id ||
            sender.url !== chrome.runtime.getURL("sidepanel.html")
          ) {
            sendResponse({ ok: false });
            return;
          }
          let responded = false;
          const timer = setTimeout(() => {
            responded = true;
            sendResponse({
              ok: false,
              result:
                "Error: display operation outcome is unverified; inspect the page before retrying",
            });
          }, 10000);
          void displayOwner
            .handle(message as DisplayOwnerMessage)
            .then(
              (result) => {
                if (!responded) sendResponse(result);
              },
              () => {
                if (!responded)
                  sendResponse({
                    ok: false,
                    result: "Error: display operation could not be verified",
                  });
              },
            )
            .finally(() => clearTimeout(timer));
          return true;
        }

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

    console.log("AI Browser Bridge: Background script loaded");
  },
});
