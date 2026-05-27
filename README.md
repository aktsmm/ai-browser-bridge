# Copilot Browser Bridge (Chrome Extension)

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-live-brightgreen?logo=google-chrome)](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/aktsmm/copilot-browser-bridge?style=social)](https://github.com/aktsmm/copilot-browser-bridge)

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

- **Required (always)**: [Copilot Browser Bridge for VS Code](https://github.com/aktsmm/copilot-browser-bridge-vscode)
- **LLM provider**: **GitHub Copilot subscription** (only when using Copilot provider) or **Local LLM** (LM Studio, etc.)

## Usage

1. Launch VS Code extension (auto-start available)
2. Open Chrome extension side panel
3. Enter questions or operation instructions on any web page

### Examples

```
"Summarize the content of this page"
"Click the test button"
"Fill in the form and submit"
```

## Settings

Configure from the side panel settings button:

- **Provider**: Copilot (Chat) / Copilot (Agent) / LM Studio
- **Model Selection**: claude-sonnet, gpt-4o, etc.
- **Operation Mode**: Text / Screenshot / Hybrid
- **Max Loop Count**: Maximum iterations for automation when using Copilot (Agent)
- **High-Risk Actions / Evaluate**: Optional safety toggles for actions such as `newTab`, `closeTab`, and `evaluate`; Evaluate can only be enabled after high-risk actions are allowed

If the extension is connected to VS Code but the model list cannot be loaded, fallback models remain visible and the settings panel shows a warning so you can retry refresh instead of mistaking it for a disconnected state.

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
- **External Transmission**: Page content is only sent to local VS Code extension (localhost)
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

The extension no longer requests broad static site access. It reads the current page through `activeTab` when the user explicitly opens the side panel or triggers the extension, and page content is sent only to the local VS Code bridge on `localhost` and then to the provider selected by the user.

### LLM Data Transmission

- **GitHub Copilot**: Page content is sent to GitHub/OpenAI servers
- **Local LLM**: All data is processed locally, nothing sent externally

## Related Projects

- [Copilot Browser Bridge for VS Code](https://github.com/aktsmm/copilot-browser-bridge-vscode) - Required VS Code extension

## Author

yamapan (https://github.com/aktsmm)
