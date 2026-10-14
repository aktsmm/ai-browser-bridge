import {
  BROWSER_ACTIONS,
  effectiveBrowserActions,
  type ChatContext,
  type TaskMode,
} from "../../standalone-bridge/src/chat-context";
import type { Language } from "./i18n";
import {
  buildPostTaskPrompt,
  type PostCountRule,
  type PostLength,
  type PostTone,
} from "./pending-action";
import { xPostLimit } from "./x-char-count";

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
  /** x のとき X の重み付き文字数ルールを指示へ足し、回答に文字数と本文コピーを出す。 */
  countRule: PostCountRule;
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
  /** X の文字数上限。あると回答に文字数カウンターと本文コピーを出す。 */
  xPostLimit?: number;
}

export const DEFAULT_POST_PRESETS: readonly PostPreset[] = [
  {
    id: "casual-short",
    name: "カジュアル（140字）",
    instructions: "",
    tone: "casual",
    length: "short",
    countRule: "x",
    useCommonInstructions: true,
  },
  {
    id: "casual-long",
    name: "カジュアル（500字・具体例つき）",
    instructions: "",
    tone: "casual",
    length: "long",
    countRule: "x",
    useCommonInstructions: true,
  },
  {
    id: "formal-short",
    name: "フォーマル（140字）",
    instructions: "",
    tone: "formal",
    length: "short",
    countRule: "x",
    useCommonInstructions: true,
  },
  {
    id: "formal-long",
    name: "フォーマル（500字・具体例つき）",
    instructions: "",
    tone: "formal",
    length: "long",
    countRule: "x",
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
    countRule: "x",
    useCommonInstructions: true,
  };
}

/** プリセットの指示（空なら tone / length の組み込みプロンプト）を返す。countRule が x なら数え方の指示を足す。 */
export function buildPostPresetPrompt(
  preset: Pick<PostPreset, "instructions" | "tone" | "length" | "countRule">,
  lang: Language,
  url?: string,
): string {
  return buildPostTaskPrompt(
    {
      instructions: preset.instructions,
      tone: preset.tone,
      length: preset.length,
      countRule: preset.countRule,
      url,
    },
    lang,
  );
}

/** 文字数ルールが x のプリセットだけ、X の上限を返す。 */
export function presetXLimit(
  preset: Pick<PostPreset, "length" | "countRule">,
): number | undefined {
  return preset.countRule === "x" ? xPostLimit(preset.length) : undefined;
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
        countRule: "x",
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
      countRule: candidate.countRule === "none" ? "none" : "x",
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
