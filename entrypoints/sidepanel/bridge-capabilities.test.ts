import { describe, expect, it } from "vitest";

import { parseBridgeCapabilities } from "./bridge-capabilities";

describe("parseBridgeCapabilities", () => {
  it("accepts the bridge capabilities response shape", () => {
    const parsed = parseBridgeCapabilities({
      version: "0.1.16",
      contextVersion: 1,
      displayTextLookupVersion: 1,
      browserBackend: "extension-dom",
      bridge: "standalone",
      recommended: { chat: "vscode-lm", agent: "vscode-lm" },
      providers: [
        {
          id: "vscode-lm",
          name: "VS Code Language Model API",
          status: "available",
          supportsChat: true,
          supportsAgentLoop: true,
          userSelectable: true,
        },
        {
          id: "copilot-sdk",
          name: "GitHub Copilot SDK",
          status: "unknown",
          detail: "auth checked later",
          isExperimental: true,
          userSelectable: false,
        },
        {
          id: "codex-cli",
          name: "OpenAI Codex CLI",
          status: "available",
          supportsChat: true,
          supportsAgentLoop: true,
          supportsBrowserActions: true,
          userSelectable: true,
        },
        {
          id: "claude-code",
          name: "Claude Code",
          status: "available",
          supportsChat: true,
          userSelectable: true,
          connections: {
            direct: {
              status: "unavailable",
              detail: "Claude Code is not signed in.",
            },
            gateway: { status: "available" },
          },
        },
      ],
    });

    expect(parsed?.bridge).toBe("standalone");
    expect(parsed?.contextVersion).toBe(1);
    expect(parsed?.displayTextLookupVersion).toBe(1);
    expect(parsed?.browserBackend).toBe("extension-dom");
    expect(parsed?.providers.map((provider) => provider.id)).toContain(
      "codex-cli",
    );
    expect(parsed?.providers.map((provider) => provider.id)).toContain(
      "claude-code",
    );
    expect(
      parsed?.providers.find((provider) => provider.id === "claude-code")
        ?.connections?.direct,
    ).toEqual({
      status: "unavailable",
      detail: "Claude Code is not signed in.",
    });
  });

  it("rejects malformed provider payloads instead of crashing Settings", () => {
    expect(parseBridgeCapabilities(null)).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        providers: {},
        recommended: {},
      }),
    ).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        bridge: "bad-bridge",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          { id: "vscode-lm", name: "VS Code", status: "available" },
          { id: "copilot-sdk", name: "SDK", status: "unknown" },
        ],
      }),
    ).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [{ id: "evil", name: "Unexpected", status: "available" }],
      }),
    ).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [{ id: "vscode-lm", name: "VS Code", status: "owned" }],
      }),
    ).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        recommended: { chat: "", agent: "" },
        providers: [{ id: "vscode-lm", name: "VS Code", status: "available" }],
      }),
    ).toBeNull();
    expect(
      parseBridgeCapabilities({
        version: "0.1.16",
        recommended: { chat: "vscode-lm", agent: "copilot-cli" },
        providers: [{ id: "vscode-lm", name: "VS Code", status: "available" }],
      }),
    ).toBeNull();
  });
});
