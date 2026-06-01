import { describe, expect, it } from "vitest";
import { buildDisplayedCopilotModels } from "./copilot-models";
import type { ModelInfo } from "./types";

describe("buildDisplayedCopilotModels", () => {
  it("does not show fallback models without a live Copilot model list", () => {
    expect(buildDisplayedCopilotModels([], "o3-mini")).toEqual([]);
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

  it("does not re-add a hidden or stale model just because it is selected", () => {
    expect(
      buildDisplayedCopilotModels([], "claude-opus-4.7-1m-internal"),
    ).not.toContainEqual({
      value: "claude-opus-4.7-1m-internal",
      label: "claude-opus-4.7-1m-internal",
    });
    expect(buildDisplayedCopilotModels([], "gpt-4o")).toEqual([]);
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
      { value: "gpt-5.2", label: "GPT-5.2" },
    ]);
  });
});
