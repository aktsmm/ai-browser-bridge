import { defineConfig } from "wxt";

const LOCAL_PLACEHOLDER_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://localhost/*",
  "https://127.0.0.1/*",
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Copilot Browser Bridge",
    description: "ブラウザのページ内容をCopilot/ローカルLLMで解析・対話",
    version: process.env.npm_package_version || "0.1.11",
    icons: {
      16: "icon/16.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    permissions: [
      "activeTab",
      "tabs",
      "scripting",
      "storage",
      "sidePanel",
      "contextMenus",
      "downloads",
    ],
    // Regular page access uses activeTab + scripting on user-invoked tabs.
    // Keep static host access limited to local placeholder pages only.
    host_permissions: LOCAL_PLACEHOLDER_MATCHES,
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Copilot Browser Bridge",
    },
  },
});
