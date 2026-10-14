import {
  BROWSER_ACTIONS,
  effectiveBrowserActions,
  type ChatContext,
  type TaskMode,
} from "../../standalone-bridge/src/chat-context";
import type { Language } from "./i18n";
import {
  getPostPrompt,
  type PostLength,
  type PostTone,
} from "./pending-action";

export const ASSISTANT_SETTINGS_KEY = "assistantSettingsV1";
export const MAX_POST_PRESETS = 10;
export interface AssistantProfile {
  id: string;
  name: string;
  instructions: string;
}
/** 独立したポスト作成プリセット。1 件を変更しても他に影響しない。 */
export interface PostPreset {
  id: string;
  name: string;
  /** 空のときは tone / length の組み込みプロンプトを使う。 */
  instructions: string;
  tone: PostTone;
  length: PostLength;
  useCommonInstructions: boolean;
}
export interface AssistantSettings {
  version: 1;
  globalInstructions: string;
  responseLanguage: "inherit" | "ja" | "en";
  profiles: AssistantProfile[];
  selectedProfileId: string;
  mode: TaskMode;
  posts: PostPreset[];
}
export interface TaskOptions {
  kind: "post" | "custom" | "summary";
  instructions?: string;
  /** false のとき、共通指示とプロフィール指示をこのタスクに適用しない。 */
  useCommonInstructions?: boolean;
}

export const DEFAULT_POST_PRESETS: readonly PostPreset[] = [
  {
    id: "casual-short",
    name: "カジュアル（140字）",
    instructions: "",
    tone: "casual",
    length: "short",
    useCommonInstructions: true,
  },
  {
    id: "casual-long",
    name: "カジュアル（500字・具体例つき）",
    instructions: "",
    tone: "casual",
    length: "long",
    useCommonInstructions: true,
  },
  {
    id: "formal-short",
    name: "フォーマル（140字）",
    instructions: "",
    tone: "formal",
    length: "short",
    useCommonInstructions: true,
  },
  {
    id: "formal-long",
    name: "フォーマル（500字・具体例つき）",
    instructions: "",
    tone: "formal",
    length: "long",
    useCommonInstructions: true,
  },
];

export function defaultPostPresets(): PostPreset[] {
  return DEFAULT_POST_PRESETS.map((preset) => ({ ...preset }));
}

export function createPostPreset(): PostPreset {
  return {
    id: crypto.randomUUID(),
    name: "New post",
    instructions: "",
    tone: "formal",
    length: "short",
    useCommonInstructions: true,
  };
}

/** プリセットの指示があればそれを、空なら tone / length の組み込みプロンプトを返す。 */
export function buildPostPresetPrompt(
  preset: Pick<PostPreset, "instructions" | "tone" | "length">,
  lang: Language,
  url?: string,
): string {
  return preset.instructions.trim()
    ? preset.instructions
    : getPostPrompt(lang, preset.tone, preset.length, url);
}

function normalizePostPresets(
  stored: Partial<AssistantSettings>,
): PostPreset[] {
  const legacy = (
    stored as { post?: { name?: unknown; instructions?: unknown } }
  ).post;
  if (!Array.isArray(stored.posts)) {
    // 旧形式の単一カスタム投稿は指示があるときだけ 1 件のプリセットに移行する
    const presets = defaultPostPresets();
    const instructions = boundedText(legacy?.instructions, 8000);
    if (instructions.trim()) {
      const name = boundedText(legacy?.name, 80);
      presets.push({
        id: "legacy-custom-post",
        name: !name || name === "Custom Post" ? "カスタム投稿" : name,
        instructions,
        tone: "formal",
        length: "short",
        useCommonInstructions: true,
      });
    }
    return presets;
  }
  const usedIds = new Set<string>();
  const presets: PostPreset[] = [];
  for (const candidate of stored.posts) {
    if (presets.length >= MAX_POST_PRESETS) break;
    if (!candidate || typeof candidate !== "object") continue;
    const id = boundedText(candidate.id, 80);
    if (!id || usedIds.has(id)) continue;
    usedIds.add(id);
    presets.push({
      id,
      name: boundedText(candidate.name, 80) || "Post",
      instructions: boundedText(candidate.instructions, 8000),
      tone: candidate.tone === "casual" ? "casual" : "formal",
      length: candidate.length === "long" ? "long" : "short",
      useCommonInstructions: candidate.useCommonInstructions !== false,
    });
  }
  return presets;
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
    posts: normalizePostPresets(stored),
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
  displayTextLookupSupported = false,
): ChatContext {
  const useCommon = task?.useCommonInstructions !== false;
  const context: ChatContext = {
    version: 1,
    ...(displayEditingEnabled && displayTextLookupSupported
      ? { displayTextLookupVersion: 1 as const }
      : {}),
    mode: task || !browserActionsEnabled ? "read-only" : settings.mode,
    displayEditingEnabled:
      !task &&
      browserActionsEnabled &&
      settings.mode !== "read-only" &&
      displayEditingEnabled,
    allowedActions: [...BROWSER_ACTIONS],
    globalInstructions: useCommon ? settings.globalInstructions : "",
    responseLanguage:
      settings.responseLanguage === "inherit"
        ? uiLanguage
        : settings.responseLanguage,
    profileInstructions: useCommon
      ? (settings.profiles.find(
          (profile) => profile.id === settings.selectedProfileId,
        )?.instructions ?? "")
      : "",
    taskInstructions: task?.instructions ?? "",
    target,
    pageStatus,
  };
  context.allowedActions = effectiveBrowserActions(context);
  return context;
}
