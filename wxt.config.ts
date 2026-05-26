import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Copilot Browser Bridge",
    description: "ブラウザのページ内容をCopilot/ローカルLLMで解析・対話",
    version: process.env.npm_package_version || "0.1.10",
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
    host_permissions: ["<all_urls>"],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Copilot Browser Bridge",
    },
  },
});


