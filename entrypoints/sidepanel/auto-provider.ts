import type { BridgeCapabilities, OperationMode } from "./types";

export type AutoProviderId = "vscode-lm" | "copilot-cli";

// Keep this order in sync with vscode-extension/src/llm-router.ts.
// The validate:bridge script checks both copies so the Settings UI cannot drift
// from the bridge runtime behavior silently.
export function getAutoProviderOrder(
  operationMode: OperationMode,
): AutoProviderId[] {
  void operationMode;
  return ["vscode-lm", "copilot-cli"];
}

export function getAutoProviderLabel(providerId: AutoProviderId): string {
  if (providerId === "vscode-lm") {
    return "VS Code LM";
  }
  return "Copilot CLI";
}

export function getCapabilityStatus(
  capabilities: BridgeCapabilities | null,
  providerId: AutoProviderId,
): BridgeCapabilities["providers"][number]["status"] | null {
  return (
    capabilities?.providers.find((provider) => provider.id === providerId)
      ?.status ?? null
  );
}
