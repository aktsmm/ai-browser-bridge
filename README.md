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
- **Policy-bound Input Assistance**: Fill verified form fields without final submission; optional navigation stays within the task policy. Playwright CLI is not an enabled runtime backend.
- **Right-click Menu & Quick Actions**: Summarize the page, generate a social post, or run your own custom prompts from the page context menu and the post-reply buttons. The post generator offers two tones (casual / formal) and two lengths (a roughly 140-character target, or a longer ~500-character version with extra detail) as a submenu, structures the output (takeaway, bullet points, source URL, hashtags), and inserts the current page URL automatically. The Chat quick actions include a length toggle (140 / 500) so all four variants are reachable. Custom prompt names and content are editable in Settings.

## Installation

### Assistant Instructions and Safe Input

Settings occupies the sidepanel while open, with **Assistant**, **Personal**, and **Connection** tabs. Arrow keys/Home/End move between tabs; Escape closes Settings and returns focus to its button. The chat draft and pending attachments remain intact when Settings opens or closes. Profiles can also be selected above the chat; profile replacement and clearing history are disabled while a response is running.

**Read current page** previews the page context without sending a model request. The status distinguishes an unread, ready, partial, unsupported or permission-required page; **Allow this site** is available only when permission is needed. Message text remains editable when the bridge is unavailable, but sending is disabled with a visible reason.

IME confirmation Enter does not submit a message; Shift+Enter inserts a newline. Attachment reads display progress and per-file errors without discarding successfully loaded files. Personal-profile edits and closing Settings are disabled during a save, with separate unsaved/saved/cleared/error feedback. Runtime notices and errors are not treated as answers and do not offer answer-specific copy/save/follow-up actions.

While reading earlier messages, incoming text no longer moves the conversation to the bottom. **Jump to latest** resumes following; sending a new message also resumes following. Each answer has its own Markdown/blog-draft save controls, including older answers. Exports use that answer's captured page title/URL rather than whichever tab is active when saving, and use unique, bounded filenames. A missing historical source is recorded as unknown rather than inferred. Save results also appear beside the selected answer.

Stopping removes an empty response placeholder and shows a stop notice. Received text remains available as **Partial response**; a stopped or disconnected stream is marked incomplete in both export formats. Save buttons are disabled while generation or another save is running. Completed answers are not marked partial.

- Update both the Chrome extension and its local bridge together. The sidepanel requires `contextVersion: 1` from `/capabilities`; an older bridge must be rebuilt/restarted before sending requests.
- Settings contains **Global instructions**, named assistant profiles, and **Post menu name / Post instructions**. Post and custom-menu tasks are isolated from ordinary chat history. Global/profile instructions apply to every request; post instructions apply only to a post task.
- **Browser operation** defaults to **Read only**. **Assist with input** permits form fields and selection without final submission. **Browser automation** additionally permits bounded navigation and safe link/selection interaction. Ambiguous buttons, uploads, arbitrary scripts and final submission require manual action. Existing legacy high-risk toggles do not override this policy.
- Page status reports DOM/image acquisition, partial/empty results and frame coverage. Empty DOM results receive one bounded retry. Open shadow roots and accessible frames are included; permission failures offer an explicit per-site grant. Browser-protected pages and inaccessible frames are not guaranteed readable.
- Personal profile values are stored separately, in browser-session storage by default. **Remember on this device** opts into local persistence, not sync or encrypted credential storage. Only name, email, phone, postal code and address are supported.
- First read the intended page, then select the personal-profile checkbox for that origin and submit one input task. The model receives field names/placeholders; values are resolved locally and masked from outgoing text. Input values are read back, and no submit action is executed. The run stops after profile input, and that tab is excluded from subsequent AI tasks for the browser session; continue manually or use a new tab. Automatic screenshots are disabled while a personal profile contains values.
- The active execution backend is **extension DOM**. Playwright CLI/MCP/CDP are not automatically installed, attached or advertised as connected. A verified external session and separate backend integration are still required.

### Development Validation

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate:bridge` and `npm run build`. The bridge consistency check requires the sibling VS Code repository and verifies that both independently packaged bridges share the same chat-context contract.

`npm run test:installed` loads the built extension into a disposable, headed Chromium profile. It requires an existing Playwright installation with its Chromium binary; it does not install software or attach to your normal browser. When Playwright is not resolvable locally, supply its entry point explicitly:

```powershell
npm run build
npm.cmd run test:installed -- --playwright-module=../../split-shortcut/node_modules/playwright/index.mjs
```

The PowerShell example uses `npm.cmd` to preserve option forwarding and the sibling workspace's Playwright; replace the module path for another installation. `--output-dir=<path>` changes the screenshot destination (default `.output/installed-extension-evidence`). The test uses real `chrome.storage`, `chrome.tabs`, `chrome.scripting`, document IDs and background downloads, and checks the downloaded Markdown bytes. It also verifies input/read-back without submission, delayed bridge readiness and denied-host blocking before a model request. Temporary browser profiles and downloaded fixtures are removed on exit; only screenshots remain.

The model/bridge response is a local deterministic fixture. The sidepanel document runs as a real extension page in an owned tab, not in Chrome's native docked sidepanel. Successful permission grants/revocation, live providers and normal-profile CLI attachment are not implied by a passing test. The test does not approve browser permission dialogs automatically.

Pending context-menu actions are retained while bridge capabilities are loading, disconnected, or a task/page read is active. They run after the supported bridge contract and idle state are available; the panel shows a queued status instead of discarding the action on startup.

Personal input requires the captured document's origin to match the authorized site; foreign or unknown-origin frames are rejected. Privacy settings must finish loading before a request can leave the extension. A separate session-storage marker is committed for each protected tab before input begins, preventing one sidepanel from overwriting another panel's markers. Storage failure stops input. Ambiguous selectors are rejected and DOM references are regenerated for each snapshot.

The loop limit is 1-50, with a default of 20, consistently across settings, stored values and execution. Legacy high-risk/evaluate controls are hidden under the current task policy. Automatic file output is unavailable outside automation mode and during personal-profile tasks; explicit save buttons retain their separate user-invoked behavior.

#### Development Dependency Guard

The 2026-09-22 compatible-range updates leave development-only audit findings in WXT's tooling and Vitest; `npm audit --omit=dev` reports no Chrome runtime findings. Run finite tests on trusted fixtures only. Do not expose a Vitest/Vite development server to untrusted clients, process untrusted archives/images through the affected tooling, or use `npm audit fix --force` as an unreviewed fix. WXT, Sharp and Vitest migrations require separate compatibility checks before release. A passing build is not a clean full dependency audit.

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
"Fill in the form and stop before submission"
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
- **High-Risk Actions / Evaluate**: Legacy settings retained for compatibility. The verified task policy blocks arbitrary scripts, uploads and unverified Playwright routes regardless of these settings.
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

Updated for version 0.1.23 (2026-09-22). AI Browser Bridge processes information you choose to use with its browser-assistant features. It does not send analytics or advertising telemetry to the developer.

### Data Collection

- **Page and chat data**: Your requests, instructions, selected page text, URL/title, attachments and any enabled screenshots are sent to the local bridge. That bridge sends the request to the provider you select, including GitHub Copilot when selected. Do not submit sensitive page content or attachments you do not intend to share with that provider.
- **Settings and conversation**: Settings and instruction profiles are stored in extension-local storage. Current conversation state is held in the sidepanel's memory. Explicitly saved answers are downloaded or written through the configured local bridge.
- **Optional personal profile**: Name, email, phone, postal code and address are stored in browser-session storage by default. Saving with Remember on this device opts into extension-local persistence, not browser sync or an encrypted credential vault. Clear profile removes the saved values. Passwords, MFA and payment credentials are not supported fields.
- **Profile-assisted input**: The model receives authorized field names/placeholders; the extension resolves values locally. The destination page can read entered values before submission. Exact saved values are masked from outbound text; screenshots are disabled while profile values are present. After a profile-assisted operation the tab is excluded from subsequent AI tasks for that browser session. These measures are not a general guarantee that arbitrary page text, images or user attachments contain no personal information.
- **Developer use**: No sale of user data, advertising use, or developer-hosted analytics endpoint. Selected model providers and destination websites process data under their own policies. Removing the extension removes its extension storage; saved files must be deleted separately.

### Permission Usage

| Permission       | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| activeTab        | Get current page content                                        |
| tabs             | Get tab info (URL, title)                                       |
| scripting        | Analyze page DOM elements                                       |
| storage          | Save settings, instructions, optional personal profile and privacy state |
| sidePanel        | Display chat UI                                                 |
| host_permissions | Limit the placeholder content script to local development pages |
| optional_host_permissions | User-approved access to an individual site's page content and DOM |
| contextMenus | Run selected page tasks from the context menu |
| downloads | Save answers requested by the user |

Static host access is limited to loopback endpoints. Page reading requires a valid temporary `activeTab` grant or explicit optional permission for that site; keeping the sidepanel open does not itself grant access to every selected tab. Context is sent to the local bridge and then the selected model provider.

### LLM Data Transmission

- **GitHub Copilot**: Page content is sent to the GitHub Copilot service through the local bridge
- **Local LLM**: The bridge accepts loopback model endpoints only. Whether the selected local server forwards data further depends on that server's configuration.

## Related Projects

- [AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) - VS Code bridge option
- [Standalone companion bridge](standalone-bridge/README.md) - Node bridge option without the VS Code extension

## Author

yamapan (https://github.com/aktsmm)
