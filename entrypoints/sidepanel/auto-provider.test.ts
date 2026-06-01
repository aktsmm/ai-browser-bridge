import { describe, expect, it } from "vitest";

import {
  getAutoProviderLabel,
  getAutoProviderOrder,
  getCapabilityStatus,
} from "./auto-provider";

describe("Auto provider helpers", () => {
  it("uses VS Code LM first for text mode", () => {
    expect(getAutoProviderOrder("text")).toEqual(["vscode-lm", "copilot-cli"]);
  });

  it("uses VS Code LM first for browser-agent modes", () => {
    expect(getAutoProviderOrder("hybrid")).toEqual([
      "vscode-lm",
      "copilot-cli",
    ]);
    expect(getAutoProviderOrder("screenshot")).toEqual([
      "vscode-lm",
      "copilot-cli",
    ]);
  });

  it("renders compact provider labels and capability statuses", () => {
    expect(getAutoProviderLabel("vscode-lm")).toBe("VS Code LM");
    expect(getAutoProviderLabel("copilot-cli")).toBe("Copilot CLI");
    expect(
      getCapabilityStatus(
        {
          version: "test",
          recommended: { chat: "vscode-lm", agent: "vscode-lm" },
          providers: [
            {
              id: "copilot-cli",
              name: "GitHub Copilot CLI",
              status: "available",
            },
          ],
        },
        "copilot-cli",
      ),
    ).toBe("available");
  });
});
