# AI Browser Bridge (Chrome Extension)

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-live-brightgreen?logo=google-chrome)](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/aktsmm/ai-browser-bridge?style=social)](https://github.com/aktsmm/ai-browser-bridge)

Chrome extension to analyze, interact, and automate browser pages with LLM (GitHub Copilot / Local LLM)

[Japanese / 日本語版はこちら](README_ja.md)

## Features

- **Page Analysis**: LLM understands the current web page and answers questions
- **Browser Automation**: LLM automatically performs clicks, inputs, scrolls, etc.
- **3 Operation Modes**:
  - Text Mode: DOM analysis-based (fast & lightweight)
  - Screenshot Mode: Visual understanding via Vision API
  - Hybrid Mode: Text-first, screenshot fallback
- **Playwright-compatible Actions**: Double-click, right-click, form fill, etc.
- **Right-click Menu & Quick Actions**: Summarize the page, generate a social post (with hashtags), or run your own custom prompts from the page context menu and the post-reply buttons. Custom prompt names and content are editable in Settings.

## Installation

### Development Version (Local Install)

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build
4. Open `chrome://extensions`
5. Enable "Developer mode"
6. Click "Load unpacked" -> Select `.output/chrome-mv3` folder

### Chrome Web Store

Available now: [Install from Chrome Web Store](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)

## Requirements

- **Required (always)**: A local bridge server: either [AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) or the standalone companion in `standalone-bridge`
- **LLM provider**: **GitHub Copilot subscription** (only when using Copilot provider) or **Local LLM** (LM Studio, etc.)

> GitHub Copilot SDK and GitHub Copilot CLI providers require a local bridge process. Use the VS Code extension bridge or start the standalone companion; the Chrome Web Store extension alone cannot start local SDK or CLI processes.

## Usage

1. Launch a local bridge: VS Code extension (auto-start available) or `npm run start -- --port 3210 --workspace-root ..` in `standalone-bridge`
2. Open Chrome extension side panel
3. Enter questions or operation instructions on any web page

### Examples

```
"Summarize the content of this page"
"Click the test button"
"Fill in the form and submit"
```

## Troubleshooting

- If summarize/translate says page text is unavailable:
  1. Reload the target page and retry once.
  2. Confirm the request is not on a system page (`chrome://`, `edge://`, `about:`, `chrome-extension://`).
  3. Reopen the side panel from the same tab and retry.
  4. If needed, paste the target page text directly into chat as fallback context.

## Settings

Configure from the side panel settings button:

- **Provider**: Auto / GitHub Copilot via VS Code / LM Studio
  - Auto prioritizes the VS Code Language Model API when the VS Code bridge is available. GitHub Copilot CLI is kept only as the last answer fallback.
  - GitHub Copilot SDK / CLI are shown in Bridge Status as diagnostic or advanced fallback routes, not as normal provider choices.
  - The **Auto route** section in Settings shows the provider order and status for the current operation mode
- **Bridge Status**: Shows the local bridge version and provider availability for VS Code LM, Copilot SDK, Copilot CLI, and LM Studio
- **Model Selection**: Shows only live user-visible Copilot models returned by the bridge. Static fallback models are not selectable when the live list is unavailable.
- **Browser Actions**: Allow or block automatic browser control from the side panel
- **File Operations**: Allow or block generated file saves through the bridge
- **Operation Mode**: Text / Screenshot / Hybrid
- **Max Loop Count**: Maximum automation iterations when using Agent / SDK / CLI / Auto providers
- **High-Risk Actions / Evaluate**: Optional safety toggles for actions such as `newTab`, `closeTab`, and Playwright `browser_evaluate`; direct `evaluate` actions in the Chrome extension are blocked for security, and Playwright Evaluate is disabled by default
- **Save Destination**: Save generated markdown either to the browser downloads folder or to a workspace-relative path via the local bridge
- **Default Save Path**: Configure a relative base path such as `output/blog`

### Save & Attachments

- **Deterministic save buttons**: The latest assistant response can be saved directly as Markdown or as a blog draft with source URL and timestamp metadata
- **Workspace fallback**: If workspace-relative save is selected but the local bridge has no workspace root, the extension falls back to the browser downloads folder
- **Drag & drop attachments (v1)**: Attach text files and images by dropping them onto the chat area or input area
- **PDF fallback**: PDF files are accepted as attachment context, but text extraction is intentionally skipped in v1

If the extension is connected to VS Code but the model list cannot be loaded, the settings panel shows a warning and disables Copilot model selection until refresh succeeds. If page text extraction fails for summarization or translation, the side panel stops before calling the LLM and asks you to reload, confirm the target URL, switch mode, or paste the text.

## Development

```bash
# Start dev server
npm run dev

# Run unit tests
npm run test

# Lint
npm run lint

# Type-check
npm run typecheck

# Build
npm run build

# Cross-extension consistency checks
npm run validate:bridge

# Create ZIP (for Chrome Web Store)
npm run zip
```

## License

CC BY-NC-SA 4.0 © [aktsmm](https://github.com/aktsmm)

## Third-Party Notices

- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)

## Privacy Policy

This extension respects user privacy.

### Data Collection

- **Personal Information**: Not collected
- **External Transmission**: Page content is only sent to the local bridge (localhost)
- **Data Storage**: Only user settings are stored in local storage
- **Third Party Sharing**: None

### Permission Usage

| Permission       | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| activeTab        | Get current page content                                        |
| tabs             | Get tab info (URL, title)                                       |
| scripting        | Analyze page DOM elements                                       |
| storage          | Save user settings                                              |
| sidePanel        | Display chat UI                                                 |
| host_permissions | Limit the placeholder content script to local development pages |

The extension no longer requests broad static site access. It reads the current page through `activeTab` when the user explicitly opens the side panel or triggers the extension, and page content is sent only to the local bridge on `localhost` and then to the provider selected by the user.

### LLM Data Transmission

- **GitHub Copilot**: Page content is sent to the GitHub Copilot service through the local bridge
- **Local LLM**: All data is processed locally, nothing sent externally

## Related Projects

- [AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) - VS Code bridge option
- [Standalone companion bridge](standalone-bridge/README.md) - Node bridge option without the VS Code extension

## Author

yamapan (https://github.com/aktsmm)
