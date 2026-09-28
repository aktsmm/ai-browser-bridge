import {
  BROWSER_ACTIONS,
  effectiveBrowserActions,
  type ChatContext,
  type TaskMode,
} from "../../standalone-bridge/src/chat-context";
import type { Language } from "./i18n";

export const ASSISTANT_SETTINGS_KEY = "assistantSettingsV1";
export interface AssistantProfile {
  id: string;
  name: string;
  instructions: string;
}
export interface AssistantSettings {
  version: 1;
  globalInstructions: string;
  responseLanguage: "inherit" | "ja" | "en";
  profiles: AssistantProfile[];
  selectedProfileId: string;
  mode: TaskMode;
  post: { name: string; instructions: string };
}
export interface TaskOptions {
  kind: "post" | "custom" | "summary";
  instructions?: string;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

export function normalizeAssistantSettings(value: unknown): AssistantSettings {
  const stored =
    value && typeof value === "object"
      ? (value as Partial<AssistantSettings>)
      : {};
  const usedIds = new Set<string>();
  const profiles: AssistantProfile[] = [];
  if (Array.isArray(stored.profiles)) {
    for (const candidate of stored.profiles.slice(0, 12)) {
      if (!candidate || typeof candidate !== "object") continue;
      const id = boundedText(candidate.id, 80);
      if (!id || usedIds.has(id)) continue;
      usedIds.add(id);
      profiles.push({
        id,
        name: boundedText(candidate.name, 80) || "Profile",
        instructions: boundedText(candidate.instructions, 8000),
      });
    }
  }
  if (!profiles.length)
    profiles.push({ id: "default", name: "Default", instructions: "" });
  return {
    version: 1,
    globalInstructions: boundedText(stored.globalInstructions, 8000),
    responseLanguage:
      stored.responseLanguage === "ja" || stored.responseLanguage === "en"
        ? stored.responseLanguage
        : "inherit",
    profiles,
    selectedProfileId: profiles.some(
      (profile) => profile.id === stored.selectedProfileId,
    )
      ? stored.selectedProfileId!
      : profiles[0].id,
    mode:
      stored.mode === "read-only" || stored.mode === "automation"
        ? stored.mode
        : "input",
    post: {
      name: boundedText(stored.post?.name, 80) || "Custom Post",
      instructions: boundedText(stored.post?.instructions, 8000),
    },
  };
}

export function buildChatContext(
  settings: AssistantSettings,
  target: ChatContext["target"],
  pageStatus: ChatContext["pageStatus"],
  task?: TaskOptions,
  browserActionsEnabled = true,
  uiLanguage: Language = "ja",
  displayEditingEnabled = false,
): ChatContext {
  const context: ChatContext = {
    version: 1,
    mode: task || !browserActionsEnabled ? "read-only" : settings.mode,
    displayEditingEnabled:
      !task &&
      browserActionsEnabled &&
      settings.mode !== "read-only" &&
      displayEditingEnabled,
    allowedActions: [...BROWSER_ACTIONS],
    globalInstructions: settings.globalInstructions,
    responseLanguage:
      settings.responseLanguage === "inherit"
        ? uiLanguage
        : settings.responseLanguage,
    profileInstructions:
      settings.profiles.find(
        (profile) => profile.id === settings.selectedProfileId,
      )?.instructions ?? "",
    taskInstructions:
      task?.kind === "post" && settings.post.instructions.trim()
        ? settings.post.instructions
        : (task?.instructions ?? ""),
    target,
    pageStatus,
  };
  context.allowedActions = effectiveBrowserActions(context);
  return context;
}
