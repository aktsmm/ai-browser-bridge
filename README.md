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

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/copilot-browser-bridge/nggfpdadfepkbpjfnpcihagbnnfpeian) or follow the [local development install steps](#development-version-local-install). Start the [required local bridge](#requirements) before sending a question.

### Assistant Instructions and Safe Input

Settings occupies the sidepanel while open, with **Assistant**, **Personal**, and **Connection** tabs. Arrow keys/Home/End move between tabs; Escape closes Settings and returns focus to its button. The chat draft and pending attachments remain intact when Settings opens or closes. Profiles can also be selected above the chat; profile replacement and clearing history are disabled while a response is running.

Sending a question or page action reads the page automatically. The status distinguishes a ready, partial, unsupported or permission-required page; retry reading is available when acquisition fails. If site access has been restricted in the browser, allow it from the extension menu before retrying. Message text remains editable when the bridge is unavailable, but sending is disabled with a visible reason.

IME confirmation Enter does not submit a message; Shift+Enter inserts a newline. Attachment reads display progress and per-file errors without discarding successfully loaded files. Personal-profile edits and closing Settings are disabled during a save, with separate unsaved/saved/cleared/error feedback. Runtime notices and errors are not treated as answers and do not offer answer-specific copy/save/follow-up actions.

While reading earlier messages, incoming text no longer moves the conversation to the bottom. **Jump to latest** resumes following; sending a new message also resumes following. Each answer has its own Markdown/blog-draft save controls, including older answers. Exports use that answer's captured page title/URL rather than whichever tab is active when saving, and use unique, bounded filenames. A missing historical source is recorded as unknown rather than inferred. Save results also appear beside the selected answer.

Stopping removes an empty response placeholder and shows a stop notice. Received text remains available as **Partial response**; a stopped or disconnected stream is marked incomplete in both export formats. Save buttons are disabled while generation or another save is running. Completed answers are not marked partial.

Browser execution notices show a visible summary before their collapsed details: target found, verified result, failure or unverified outcome. Duplicate/missing/changed targets and inactive display permission have distinct messages. Unverified results never imply cancellation or success. Additional commands emitted in a display-edit final report are not executed; they move to details labeled **Not executed**, and the panel says so explicitly. Ordinary answers and the original conversation content are preserved.

- Update both the Chrome extension and its local bridge together. The sidepanel requires `contextVersion: 1` from `/capabilities`; an older bridge must be rebuilt/restarted before sending requests.
- Settings contains **Global instructions**, named assistant profiles, **Response language**, and **Post menu name / Post instructions**. Response language defaults to the interface language (Japanese or English), including right-click custom instructions; a saved Japanese/English choice overrides that fallback. An explicitly requested language in the question or global/profile/task instructions takes precedence. Post and custom-menu tasks are isolated from ordinary chat history. Global/profile instructions apply to every request; post instructions apply only to a post task.
- **Browser operation** defaults to **Assist with input** for new settings; existing selections are preserved. **Read only** remains available. **Browser automation** additionally permits bounded navigation and safe link/selection interaction. Ordinary `type=button` controls and same-origin `download` links require approval once or a persistent, revocable per-origin grant. Submit-type and visibly destructive buttons and URL paths stay blocked, including URL-encoded paths; site scripts can still have effects that cannot be inferred from a label, so only grant persistent access to trusted sites. Browser downloads of generated text report Saved only after Chrome confirms completion or report an interruption/timeout. A click on a site's download link is not proof that its file completed; the assistant must say so when completion is unverified. Post tasks remain read-only.
- The page-read status, site origin and retry control share a compact row. In the chat input, Up/Down cycles through the last 15 prompts sent in this panel session and restores an unsent draft; clearing the chat clears this history. The header's **Report an issue** button previews an editable GitHub issue draft with extension version, operation mode and page status. Site origin is included only if selected; prompts, page content, attachments and logs are never attached automatically. GitHub opens only after confirmation, and the user submits the issue there.
- **Display editing** offers **Off**, **This task**, and **Always on this site**. The last option remembers the exact site origin locally and avoids repeated approval; switch to Off or revoke a site from **Display editing sites** to remove permission. Read-only and post/custom tasks never inherit it. With a bridge advertising `displayTextLookupVersion: 1`, the assistant searches exact visible text independently of the normal 120-ref snapshot limit, then uses a document-bound display handle to change it. Static headings inside forms, including short leaf text inside a heading, are supported; controls, labels, links, buttons, hidden/interactive containers and foreign-origin frames are protected. Duplicate, incomplete or stale matches stop without selecting a different element. An invalid display ACTION gets one bounded correction attempt; the final report cannot execute another operation. Display-only requests are collapsed rather than offering answer-save controls. Up to 10 verified targets in one frame can be changed together. **Undo display edit** restores the last unchanged batch on the edited tab, and re-editing is allowed after a fresh lookup. Undo remains a user-invoked recovery action after revocation. Reloads or application re-renders can remove changes or invalidate undo. Old bridges retain legacy numeric refs and exclude forms; update the bridge for targeted editing. No server-side data or final submission is changed, but page scripts can observe the edited DOM. Original page text/screenshots may reach the selected model before editing; this is not a way to hide secrets from the model.
- Page content is read automatically when a question or page action is sent. Empty DOM results receive up to two bounded retries (three reads total); a persistently empty page remains empty. Open shadow roots and accessible frames are included; browser-protected pages and inaccessible frames are not guaranteed readable. Web page read access is requested at installation, rather than one site at a time; reading alone does not submit a page to the model.
- Personal profile values are stored separately, in browser-session storage by default. **Remember on this device** opts into local persistence, not sync or encrypted credential storage. Name, email, phone, postal code, address and up to five named custom fields are supported. Card and password values are not allowed in custom fields.
- Optional payment-card number and expiration are encrypted with a user passphrase in extension-local storage. The passphrase and CVV are not stored. Filling requires the passphrase and explicit approval for the current site; only visible top-frame fields marked with standard card autocomplete attributes are supported. Card values are not sent to the model; the tab is excluded from later AI page reads. Complete purchases manually.
- First read the intended page, then select the personal-profile checkbox for that origin and submit one input task. The model receives field names/placeholders; values are resolved locally and masked from outgoing text. A task that does not enter a registered profile value leaves the tab available for later AI tasks. Input values are read back, and no submit action is executed. The run stops after profile input, and that tab is excluded from subsequent AI tasks for the browser session; continue manually or use a new tab. Automatic screenshots are disabled while a personal profile contains values.
- The active execution backend is **extension DOM**. Playwright CLI/MCP/CDP are not automatically installed, attached or advertised as connected. A verified external session and separate backend integration are still required.

### Development Validation

Both local bridges reject chat histories above 200 messages, 100,000 characters in one message, or 500,000 characters across message contents before calling a provider. The limits use JavaScript string length, accept exact boundaries, and do not silently trim history. Shorten an oversized message or clear the chat history before retrying. `validate:bridge` checks that both implementations declare the same limits.

The standalone SDK route accepts an empty model string as its SDK default. Completed request bodies do not cancel delayed replies, while a disconnected response aborts provider work. CLI fallback arguments restrict the available native-tool list to an unregistered sentinel, explicitly deny read/write/shell, disable custom instructions and disable tool prompts; prompt text alone is not the security boundary. The installed CLI accepted these arguments in the verification run.

`--display-only --native-panel` additionally opens Chrome's actual docked sidepanel in the disposable profile and verifies the synthetic heading edit, completed result report and idle send control. `--display-only --live-display` explicitly opts into real GitHub Copilot SDK requests using the SDK default model, including the native sidepanel path. The SDK bridge uses a temporary workspace with built-in/MCP/file tools disabled; the local test proxy pins the upstream provider so fixture model IDs and Auto/CLI fallback cannot mask the route. This may use your signed-in Copilot entitlement. No normal browser or authenticated user page is accessed. Native/model summaries are saved under the ignored evidence directory, and owned bridges/profiles close afterward. Regular fixture runs remain deterministic and make no live-model requests.

Display-text lookup walks elements lazily with a TreeWalker instead of materializing the entire DOM. A 50,000-node, 10,000-candidate, 100-root budget and a best-effort 200ms search deadline stop incomplete scans without issuing a matching handle. Deadline checks include ancestry inspection. Native layout/traversal calls cannot be preempted, so this is not a strict wall-clock guarantee. The focused installed fixture also verifies refusal on 51,000 synthetic SVG elements without changing the heading, input or submission count.

Add `--display-only` to the installed-extension command to run the focused display-editing fixture. It checks a form heading with 120 ordinary refs, persistent and one-task permission, repeated edits/undo, two edited tabs with independent undo after panel reload, duplicate and replaced-element denial, parser correction, report-only enforcement, unchanged inputs/zero submissions, full-page summary compatibility and 320/480px layouts. The deterministic fixture is not evidence of live model or authenticated-site behavior.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate:bridge` and `npm run build`. The bridge consistency check requires the sibling VS Code repository and verifies that both independently packaged bridges share the same chat-context contract.

`npm run test:installed` loads the built extension into a disposable, headed Chromium profile. It requires an existing Playwright installation with its Chromium binary; it does not install software or attach to your normal browser. When Playwright is not resolvable locally, supply its entry point explicitly:

```powershell
npm run build
npm.cmd run test:installed -- --playwright-module=../../split-shortcut/node_modules/playwright/index.mjs
```

The PowerShell example uses `npm.cmd` to preserve option forwarding and the sibling workspace's Playwright; replace the module path for another installation. `--output-dir=<path>` changes the screenshot destination (default `.output/installed-extension-evidence`). The test uses real `chrome.storage`, `chrome.tabs`, `chrome.scripting`, document IDs and background downloads, and checks the downloaded Markdown bytes. It also verifies input/read-back without submission, first-time button approval followed by another button click without a prompt after a sidepanel reload, keyboard cancellation, revocation, and an approved same-origin fixture PDF download checked via Chrome's downloads API. Playwright manages temporary download filenames, so the fixture's generic download icon/name does not establish how files appear in a normal profile. Display editing is tested only by `--display-only`, which negotiates the current display capability and opaque-handle protocol; the generic fixture deliberately does not exercise legacy numeric-ref display edits. Other generic checks cover delayed bridge readiness and reading a second HTTP site without a site-specific grant. Temporary browser profiles and downloaded fixtures are removed on exit; only screenshots remain.

The model/bridge response is a local deterministic fixture. The sidepanel document runs as a real extension page in an owned tab, not in Chrome's native docked sidepanel. Chrome host permission grants/revocation, live providers and normal-profile CLI attachment are not implied by a passing test. The test does not approve browser permission dialogs automatically; button approval is a separate sidepanel control.

Pending context-menu actions are retained while bridge capabilities are loading, disconnected, or a task/page read is active. They run after the supported bridge contract and idle state are available; the panel shows a queued status instead of discarding the action on startup.

Personal input requires the captured document's origin to match the authorized site; foreign or unknown-origin frames are rejected. Privacy settings must finish loading before a request can leave the extension. A separate session-storage marker is committed for each protected tab before input begins, preventing one sidepanel from overwriting another panel's markers. Storage failure stops input. Ambiguous selectors are rejected and DOM references are regenerated for each snapshot.

The loop limit is 1-50, with a default of 20, consistently across settings, stored values and execution. Legacy high-risk/evaluate controls are hidden under the current task policy. Automatic file output is unavailable outside automation mode and during personal-profile tasks; explicit save buttons retain their separate user-invoked behavior.

#### Development Dependency Guard

The 2026-10-01 migration uses stable WXT 0.21.4, Vitest 5.0.1 and Sharp 0.35.4 with explicit Chrome API types. Development requires Node 22.12 or newer within the Vitest-supported release lines. Full dependency audits for Chrome, VS Code and standalone report zero findings, and their public-URL lockfiles were verified with `npm ci` under the configured registry. Tests, typechecks/builds, Sharp SVG-to-PNG conversion and the installed display fixture passed. Continue using finite trusted-fixture tests and review future dependency updates; do not use `npm audit fix --force` or expose development/test servers to untrusted clients. Audit status is a dated observation, not a permanent guarantee.

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

- **Provider**: Auto / GitHub Copilot via VS Code / OpenAI Codex CLI / Claude Code / LM Studio
  - Auto prioritizes the VS Code Language Model API when the VS Code bridge is available. GitHub Copilot CLI is kept only as the last answer fallback.
  - OpenAI Codex CLI and Claude Code run only when explicitly selected and are never added to Auto fallback.
  - Claude Code supports direct `claude` and `GW` connections. Direct uses Claude Code's configured authentication/billing route; GW uses the explicitly selected gateway backend.
  - Bridge Status probes Direct authentication and GW installation separately. Only a known-unavailable route is disabled; use **Refresh** after signing in or repairing a route.
  - New CLI routes use an isolated temporary working directory with built-in tools, MCP, and Chrome integration disabled. Leave the model blank to use the CLI default.
  - GitHub Copilot SDK / CLI remain diagnostic or advanced fallback routes in Bridge Status.
  - The **Auto route** section in Settings shows the provider order and status for the current operation mode
- **Bridge Status**: Shows provider availability for VS Code LM, Copilot SDK, Copilot CLI, Codex CLI, Claude Code, and LM Studio
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

Updated for version 0.1.25 (2026-09-29). AI Browser Bridge processes information you choose to use with its browser-assistant features. It does not send analytics or advertising telemetry to the developer.

### Data Collection

- **Page and chat data**: Your requests, instructions, selected page text, URL/title, attachments and any enabled screenshots are sent to the local bridge. That bridge sends the request to the provider you select, including GitHub Copilot when selected. Do not submit sensitive page content or attachments you do not intend to share with that provider.
- **Settings and conversation**: Settings and instruction profiles are stored in extension-local storage. Current conversation state is held in the sidepanel's memory. Explicitly saved answers are downloaded or written through the configured local bridge.
- **Optional personal profile and payment card**: Name, email, phone, postal code, address and five custom fields are stored in browser-session storage by default. Remember on this device opts into extension-local persistence, not sync or encryption. Card details and passwords cannot be stored as custom fields. Optionally, payment-card number and expiration can be stored in a separate passphrase-encrypted extension-local vault; the passphrase and CVV are not saved. These card values are not sent to the model or developer; after you confirm the destination site, the extension fills supported card fields locally.
- **Profile-assisted input**: The model receives authorized field names/placeholders; the extension resolves values locally. The destination page can read entered values before submission. Exact saved values are masked from outbound text; screenshots are disabled while profile values are present. After a profile-assisted operation the tab is excluded from subsequent AI tasks for that browser session. These measures are not a general guarantee that arbitrary page text, images or user attachments contain no personal information.
- **Developer use**: No sale of user data, advertising use, or developer-hosted analytics endpoint. Selected model providers and destination websites process data under their own policies. Removing the extension removes its extension storage; saved files must be deleted separately.

### Permission Usage

| Permission       | Purpose                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| activeTab        | Get current page content                                                        |
| tabs             | Get tab info (URL, title)                                                       |
| scripting        | Analyze page DOM elements                                                       |
| storage          | Save settings, instructions, optional profile, encrypted card and privacy state |
| sidePanel        | Display chat UI                                                                 |
| host_permissions | Read HTTP(S) pages by default and access local bridge pages                     |
| contextMenus     | Run selected page tasks from the context menu                                   |
| downloads        | Save answers requested by the user                                              |

Broad HTTP(S) access is requested at installation and can be restricted through browser site-access controls. Browser-protected pages remain unavailable. Page content is sent to the local bridge and the selected model only when the user initiates a chat or page task, not on every tab switch.

### LLM Data Transmission

- **GitHub Copilot**: Page content is sent to the GitHub Copilot service through the local bridge
- **Local LLM**: The bridge accepts loopback model endpoints only. Whether the selected local server forwards data further depends on that server's configuration.

## Related Projects

- [AI Browser Bridge for VS Code](https://github.com/aktsmm/ai-browser-bridge-vscode) - VS Code bridge option
- [Standalone companion bridge](standalone-bridge/README.md) - Node bridge option without the VS Code extension

## Author

yamapan (https://github.com/aktsmm)
