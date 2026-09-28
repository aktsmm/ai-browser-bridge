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
    name: "AI Browser Bridge",
    description:
      "Analyze and interact with browser pages using AI. Works with GitHub Copilot or local LLMs.",
    version: process.env.npm_package_version || "0.1.24",
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
    host_permissions: [
      ...LOCAL_PLACEHOLDER_MATCHES,
      "https://*/*",
      "http://*/*",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "AI Browser Bridge",
    },
  },
});
