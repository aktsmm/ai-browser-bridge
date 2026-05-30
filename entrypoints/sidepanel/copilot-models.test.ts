import { describe, expect, it } from "vitest";
import { buildDisplayedCopilotModels } from "./copilot-models";
import type { ModelInfo } from "./types";

describe("buildDisplayedCopilotModels", () => {
  it("keeps the selected model visible when falling back", () => {
    expect(buildDisplayedCopilotModels([], "o3-mini")[0]).toEqual({
      value: "o3-mini",
      label: "o3-mini",
    });
  });

  it("prefers live Copilot models when available", () => {
    const models: ModelInfo[] = [
      { provider: "copilot", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { provider: "copilot", id: "o3-mini", name: "o3-mini" },
      { provider: "other", id: "random-model", name: "Random Model" },
    ];

    expect(buildDisplayedCopilotModels(models, "claude-sonnet-4")).toEqual([
      { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
      { value: "o3-mini", label: "o3-mini" },
    ]);
  });

  it("hides internal and utility Copilot models from the selector", () => {
    const models: ModelInfo[] = [
      {
        provider: "copilot",
        id: "claude-opus-4.7-1m-internal",
        name: "Claude Opus 4.7 (Internal only)",
      },
      {
        provider: "copilot",
        id: "copilot-utility-small",
        name: "GPT-4o mini (copilot-utility-small)",
      },
      {
        provider: "copilot",
        id: "oswe-vscode-modelD",
        name: "MAI-Code-1-Flash",
      },
      { provider: "copilot", id: "claude-opus-4", name: "Claude Opus 4" },
    ];

    expect(buildDisplayedCopilotModels(models, "claude-opus-4")).toEqual([
      { value: "claude-opus-4", label: "Claude Opus 4" },
    ]);
  });

  it("does not re-add a hidden model just because it is selected", () => {
    expect(
      buildDisplayedCopilotModels([], "claude-opus-4.7-1m-internal"),
    ).not.toContainEqual({
      value: "claude-opus-4.7-1m-internal",
      label: "claude-opus-4.7-1m-internal",
    });
  });

  it("keeps normal Copilot models and hides non-Copilot providers", () => {
    const models: ModelInfo[] = [
      { provider: "anthropic", id: "claude-opus-4", name: "Claude Opus 4" },
      {
        provider: "unknown",
        id: "custom-local-model",
        name: "Custom Local Model",
      },
      { provider: "copilot", id: "gpt-5.2", name: "GPT-5.2" },
    ];

    expect(buildDisplayedCopilotModels(models, "claude-opus-4")).toEqual([
      { value: "claude-opus-4", label: "claude-opus-4" },
      { value: "gpt-5.2", label: "GPT-5.2" },
    ]);
  });
});
