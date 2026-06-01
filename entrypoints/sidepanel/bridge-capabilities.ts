import type { BridgeCapabilities, BridgeProviderCapability } from "./types";

const PROVIDER_IDS = new Set<BridgeProviderCapability["id"]>([
  "vscode-lm",
  "copilot-sdk",
  "copilot-cli",
  "lm-studio",
]);
const PROVIDER_STATUSES = new Set<BridgeProviderCapability["status"]>([
  "available",
  "unavailable",
  "unknown",
]);
const BRIDGE_TYPES = new Set<NonNullable<BridgeCapabilities["bridge"]>>([
  "vscode",
  "standalone",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderCapability(
  value: unknown,
): value is BridgeProviderCapability {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    PROVIDER_IDS.has(value.id as BridgeProviderCapability["id"]) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.status === "string" &&
    PROVIDER_STATUSES.has(value.status as BridgeProviderCapability["status"]) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.supportsChat === undefined ||
      typeof value.supportsChat === "boolean") &&
    (value.supportsAgentLoop === undefined ||
      typeof value.supportsAgentLoop === "boolean") &&
    (value.supportsBrowserActions === undefined ||
      typeof value.supportsBrowserActions === "boolean") &&
    (value.supportsModelList === undefined ||
      typeof value.supportsModelList === "boolean") &&
    (value.supportsVision === undefined ||
      typeof value.supportsVision === "boolean") &&
    (value.isExperimental === undefined ||
      typeof value.isExperimental === "boolean") &&
    (value.userSelectable === undefined ||
      typeof value.userSelectable === "boolean")
  );
}

export function parseBridgeCapabilities(
  value: unknown,
): BridgeCapabilities | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.version !== "string" || value.version.trim().length === 0) {
    return null;
  }

  if (
    value.bridge !== undefined &&
    (typeof value.bridge !== "string" ||
      !BRIDGE_TYPES.has(
        value.bridge as NonNullable<BridgeCapabilities["bridge"]>,
      ))
  ) {
    return null;
  }

  if (
    !Array.isArray(value.providers) ||
    !value.providers.every(isProviderCapability)
  ) {
    return null;
  }

  if (!isRecord(value.recommended)) {
    return null;
  }

  if (
    typeof value.recommended.chat !== "string" ||
    value.recommended.chat.trim().length === 0 ||
    typeof value.recommended.agent !== "string" ||
    value.recommended.agent.trim().length === 0
  ) {
    return null;
  }

  const providerIds = new Set(
    value.providers.map(
      (provider) => (provider as BridgeProviderCapability).id,
    ),
  );
  if (
    !providerIds.has(
      value.recommended.chat as BridgeProviderCapability["id"],
    ) ||
    !providerIds.has(value.recommended.agent as BridgeProviderCapability["id"])
  ) {
    return null;
  }

  return {
    version: value.version,
    bridge: value.bridge as BridgeCapabilities["bridge"] | undefined,
    providers: value.providers,
    recommended: {
      chat: value.recommended.chat,
      agent: value.recommended.agent,
    },
  };
}
