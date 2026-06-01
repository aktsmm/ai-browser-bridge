import type { ModelInfo } from "./types";

export function resolveSelectedCopilotModel(
  currentModel: string,
  availableModels: ModelInfo[],
): string {
  const copilotModels = availableModels.filter(
    (model) => model.provider === "copilot",
  );
  if (copilotModels.length === 0) {
    return currentModel;
  }

  const normalizedCurrentModel = currentModel.trim().toLowerCase();
  if (!normalizedCurrentModel) {
    return copilotModels[0].id;
  }

  const exactMatch = copilotModels.find(
    (model) => model.id.toLowerCase() === normalizedCurrentModel,
  );
  if (exactMatch) {
    return exactMatch.id;
  }

  const partialMatches = copilotModels.filter((model) => {
    const normalizedId = model.id.toLowerCase();
    return (
      normalizedId.includes(normalizedCurrentModel) ||
      normalizedCurrentModel.includes(normalizedId)
    );
  });

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  }

  return copilotModels[0].id;
}
