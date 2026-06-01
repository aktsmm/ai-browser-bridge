import { describe, expect, it } from "vitest";

import { parseBridgeCapabilities } from "./bridge-capabilities";

describe("parseBridgeCapabilities", () => {
  it("accepts the bridge capabilities response shape", () => {
    const parsed = parseBridgeCapabilities({
      version: "0.1.16",
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
      ],
    });

    expect(parsed?.bridge).toBe("standalone");
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
