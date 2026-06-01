import type { ModelInfo } from "./types";

export interface CopilotModelOption {
  value: string;
  label: string;
}

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

export function buildDisplayedCopilotModels(
  availableModels: ModelInfo[],
  _selectedModel: string,
): CopilotModelOption[] {
  const filteredModels = availableModels.filter(
    (model) => model.provider === "copilot" && isUserVisibleCopilotModel(model),
  );

  const copilotModels = filteredModels.filter(
    (model) => model.provider === "copilot",
  );

  return copilotModels.map((model) => ({ value: model.id, label: model.name }));
}
