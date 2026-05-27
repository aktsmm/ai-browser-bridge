// Background Script - Service Worker
// サイドパネルの開閉制御、コンテキストメニュー

export default defineBackground({
  type: "module",

  main() {
    const openSidePanel = async (windowId: number): Promise<void> => {
      try {
        await browser.sidePanel.open({ windowId });
      } catch (error) {
        console.error(
          "Copilot Browser Bridge: Failed to open side panel",
          error,
        );
      }
    };

    const setPendingAction = async (
      pendingAction: { type: "question"; text: string } | { type: "summarize" },
    ): Promise<void> => {
      try {
        await browser.storage.local.set({ pendingAction });
      } catch (error) {
        console.error(
          "Copilot Browser Bridge: Failed to store pending action",
          error,
        );
      }
    };

    // アクションクリックでサイドパネルを開く
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        console.error(
          "Copilot Browser Bridge: Failed to set side panel behavior",
          error,
        );
      });

    // コンテキストメニュー作成
    browser.runtime.onInstalled.addListener(() => {
      browser.contextMenus.create({
        id: "askAboutSelection",
        title: "Copilot Bridgeで質問",
        contexts: ["selection"],
      });

      browser.contextMenus.create({
        id: "summarizePage",
        title: "このページを要約",
        contexts: ["page"],
      });
    });

    // コンテキストメニュークリック
    browser.contextMenus.onClicked.addListener(
      async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
        if (!tab?.windowId) return;

        // 選択テキストがある場合は送信
        if (info.menuItemId === "askAboutSelection" && info.selectionText) {
          // storage経由でサイドパネルに渡す
          await setPendingAction({
            type: "question",
            text: info.selectionText,
          });
        }

        if (info.menuItemId === "summarizePage") {
          await setPendingAction({
            type: "summarize",
          });
        }

        await openSidePanel(tab.windowId);
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
            if (typeof typedMessage.downloadId !== "number") {
              sendResponse({ success: false, error: "downloadId is required" });
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

    console.log("Copilot Browser Bridge: Background script loaded");
  },
});
