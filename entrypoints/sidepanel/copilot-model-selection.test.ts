import { describe, expect, it } from "vitest";

import { resolveSelectedCopilotModel } from "./copilot-model-selection";
import type { ModelInfo } from "./types";

describe("resolveSelectedCopilotModel", () => {
  const liveModels: ModelInfo[] = [
    { provider: "copilot", id: "gpt-5.2", name: "GPT-5.2" },
    { provider: "copilot", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { provider: "lm-studio", id: "local", name: "LM Studio" },
  ];

  it("keeps exact live Copilot model selections", () => {
    expect(resolveSelectedCopilotModel("claude-sonnet-4", liveModels)).toBe(
      "claude-sonnet-4",
    );
  });

  it("maps unambiguous partial persisted model ids to the live id", () => {
    expect(resolveSelectedCopilotModel("sonnet-4", liveModels)).toBe(
      "claude-sonnet-4",
    );
  });

  it("falls back to the first live Copilot model for stale selections", () => {
    expect(resolveSelectedCopilotModel("gpt-4o", liveModels)).toBe("gpt-5.2");
    expect(resolveSelectedCopilotModel("", liveModels)).toBe("gpt-5.2");
  });

  it("keeps the current value when no live Copilot models are available", () => {
    expect(
      resolveSelectedCopilotModel("gpt-4o", [
        { provider: "lm-studio", id: "local", name: "LM Studio" },
      ]),
    ).toBe("gpt-4o");
  });
});
