import type { ModelInfo } from "./types";

export interface CopilotModelOption {
  value: string;
  label: string;
}

export const FALLBACK_COPILOT_MODELS: CopilotModelOption[] = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "o1", label: "o1" },
  { value: "o1-mini", label: "o1 mini" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

function isUserVisibleCopilotModel(model: ModelInfo): boolean {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  const combined = `${id} ${name}`;

  if (
    ["internal only", "internal", "copilot-utility", "oswe-", "modeld"].some(
      (marker) => combined.includes(marker),
    )
  ) {
    return false;
  }

  return true;
}

function isUserVisibleCopilotModelId(modelId: string): boolean {
  return isUserVisibleCopilotModel({
    provider: "copilot",
    id: modelId,
    name: modelId,
  });
}

function ensureSelectedModelOption(
  models: CopilotModelOption[],
  selectedModel: string,
): CopilotModelOption[] {
  if (
    !selectedModel ||
    models.some((model) => model.value === selectedModel) ||
    !isUserVisibleCopilotModelId(selectedModel)
  ) {
    return models;
  }

  return [{ value: selectedModel, label: selectedModel }, ...models];
}

export function buildDisplayedCopilotModels(
  availableModels: ModelInfo[],
  selectedModel: string,
): CopilotModelOption[] {
  const filteredModels = availableModels.filter(
    (model) => model.provider === "copilot" && isUserVisibleCopilotModel(model),
  );

  const copilotModels = filteredModels.filter(
    (model) => model.provider === "copilot",
  );

  const modelOptions =
    copilotModels.length > 0
      ? copilotModels.map((model) => ({ value: model.id, label: model.name }))
      : [...FALLBACK_COPILOT_MODELS];

  return ensureSelectedModelOption(modelOptions, selectedModel);
}
