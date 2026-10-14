import React from "react";
import {
  MAX_POST_PRESETS,
  createPostPreset,
  defaultPostPresets,
  normalizeAssistantSettings,
  type AssistantSettings,
  type PostPreset,
} from "../assistant-settings";
import type { Language } from "../i18n";

export function AssistantPreferences({
  value,
  onChange,
  busy = false,
  language = "en",
}: {
  value: AssistantSettings;
  onChange: (value: AssistantSettings) => void;
  busy?: boolean;
  language?: Language;
}) {
  const profile =
    value.profiles.find((item) => item.id === value.selectedProfileId) ??
    value.profiles[0];
  const updateProfile = (patch: Partial<typeof profile>) =>
    onChange({
      ...value,
      profiles: value.profiles.map((item) =>
        item.id === profile.id ? { ...item, ...patch } : item,
      ),
    });
  const updatePost = (id: string, patch: Partial<PostPreset>) =>
    onChange({
      ...value,
      posts: value.posts.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const movePost = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.posts.length) return;
    const posts = [...value.posts];
    [posts[index], posts[target]] = [posts[target], posts[index]];
    onChange({ ...value, posts });
  };
  const postsFull = value.posts.length >= MAX_POST_PRESETS;
  const labels =
    language === "ja"
      ? {
          responseLanguage: "回答言語",
          inheritLanguage: "画面の言語に従う（日本語）",
          languageHint:
            "質問や指示に別の言語が明示されていれば、そちらを優先します。",
          global: "共通の指示",
          active: "使用中のプロフィール",
          add: "プロフィールを追加",
          remove: "プロフィールを削除",
          name: "プロフィール名",
          instructions: "プロフィールの指示",
          posts: "ポストのプリセット",
          postName: "プリセット名（メニュー・ボタンに表示）",
          postInstructions: "ポストの指示",
          postHelp: "指示を空欄にすると？",
          postFallback:
            "トーンと長さに応じた組み込みの指示を使います。入力した指示がある場合は、その指示を代わりに使い、文字数ルールが「X の重み付きカウント」なら数え方の指示を末尾に足します。プリセット同士は独立しています。",
          tone: "文体",
          casual: "カジュアル",
          formal: "フォーマル",
          length: "長さ",
          short: "140字（X 上限 280）",
          long: "500字（X 上限 1000）",
          useCommon: "共通の指示とプロフィールの指示を適用する",
          countRule: "文字数ルール",
          countX: "X の重み付きカウント（指示と回答の文字数表示）",
          countNone: "なし",
          addPost: "プリセットを追加",
          duplicatePost: "複製",
          copySuffix: "（コピー）",
          removePost: "削除",
          moveUp: "上へ",
          moveDown: "下へ",
          reset: "ポスト設定を初期値に戻す",
          operation: "ブラウザ操作",
          readOnly: "読み取り専用",
          input: "入力支援",
          automation: "ブラウザ自動操作",
        }
      : {
          responseLanguage: "Response language",
          inheritLanguage: "Follow interface language (English)",
          languageHint:
            "An explicit language in the request or instructions takes precedence.",
          global: "Global instructions",
          active: "Active profile",
          add: "Add profile",
          remove: "Delete profile",
          name: "Profile name",
          instructions: "Profile instructions",
          posts: "Post presets",
          postName: "Preset name (shown in the menu and buttons)",
          postInstructions: "Post instructions",
          postHelp: "What happens if the instructions are blank?",
          postFallback:
            'The built-in prompt for the selected tone and length is used. Your instructions replace it when provided, and the X counting rule is appended when the character rule is "X weighted count". Presets are independent of each other.',
          tone: "Tone",
          casual: "Casual",
          formal: "Formal",
          length: "Length",
          short: "140 Japanese chars (X limit 280)",
          long: "500 Japanese chars (X limit 1000)",
          useCommon: "Apply global and profile instructions",
          countRule: "Character rule",
          countX: "X weighted count (adds the rule and shows the count)",
          countNone: "None",
          addPost: "Add preset",
          duplicatePost: "Duplicate",
          copySuffix: " (copy)",
          removePost: "Delete",
          moveUp: "Move up",
          moveDown: "Move down",
          reset: "Reset post presets",
          operation: "Browser operation",
          readOnly: "Read only",
          input: "Assist with input",
          automation: "Browser automation",
        };
  const inputClass = "w-full min-w-0 p-2 border rounded text-sm mt-1";
  return (
    <section className="mb-5 space-y-3 border-b pb-4">
      <h3 className="text-sm font-semibold">
        {language === "ja" ? "アシスタントへの指示" : "Assistant instructions"}
      </h3>
      <label className="block text-sm">
        {labels.responseLanguage}
        <select
          className={inputClass}
          value={value.responseLanguage}
          title={labels.languageHint}
          onChange={(event) =>
            onChange({
              ...value,
              responseLanguage: event.target
                .value as AssistantSettings["responseLanguage"],
            })
          }
        >
          <option value="inherit">{labels.inheritLanguage}</option>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="block text-sm">
        {labels.global}
        <textarea
          className={inputClass}
          rows={4}
          maxLength={8000}
          value={value.globalInstructions}
          onChange={(event) =>
            onChange({ ...value, globalInstructions: event.target.value })
          }
        />
      </label>
      <label className="block text-sm">
        {labels.active}
        <select
          disabled={busy}
          className={inputClass}
          value={value.selectedProfileId}
          onChange={(event) =>
            onChange({ ...value, selectedProfileId: event.target.value })
          }
        >
          {value.profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id === "default" &&
              item.name === "Default" &&
              language === "ja"
                ? "既定"
                : item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          disabled={busy || value.profiles.length >= 12}
          className="text-blue-700 disabled:opacity-40"
          onClick={() => {
            const created = {
              id: crypto.randomUUID(),
              name: "New profile",
              instructions: "",
            };
            onChange({
              ...value,
              selectedProfileId: created.id,
              profiles: [...value.profiles, created],
            });
          }}
        >
          {labels.add}
        </button>
        <button
          type="button"
          disabled={busy || value.profiles.length === 1}
          className="text-red-700 disabled:opacity-40"
          onClick={() =>
            onChange(
              normalizeAssistantSettings({
                ...value,
                profiles: value.profiles.filter(
                  (item) => item.id !== profile.id,
                ),
              }),
            )
          }
        >
          {labels.remove}
        </button>
      </div>
      <label className="block text-sm">
        {labels.name}
        <input
          className={inputClass}
          maxLength={80}
          value={profile.name}
          onChange={(event) => updateProfile({ name: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        {labels.instructions}
        <textarea
          className={inputClass}
          rows={3}
          maxLength={8000}
          value={profile.instructions}
          onChange={(event) =>
            updateProfile({ instructions: event.target.value })
          }
        />
      </label>
      <fieldset className="space-y-2 border-t pt-3">
        <legend className="text-sm font-semibold">{labels.posts}</legend>
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">{labels.postHelp}</summary>
          <p className="mt-1">{labels.postFallback}</p>
        </details>
        {value.posts.map((preset, index) => (
          <details key={preset.id} className="rounded border p-2">
            <summary className="cursor-pointer text-sm break-words">
              {preset.name}
            </summary>
            <div className="mt-2 space-y-2">
              <label className="block text-sm">
                {labels.postName}
                <input
                  className={inputClass}
                  maxLength={80}
                  value={preset.name}
                  onChange={(event) =>
                    updatePost(preset.id, { name: event.target.value })
                  }
                />
              </label>
              <div className="flex gap-2">
                <label className="block flex-1 text-sm">
                  {labels.tone}
                  <select
                    className={inputClass}
                    value={preset.tone}
                    onChange={(event) =>
                      updatePost(preset.id, {
                        tone: event.target.value as PostPreset["tone"],
                      })
                    }
                  >
                    <option value="casual">{labels.casual}</option>
                    <option value="formal">{labels.formal}</option>
                  </select>
                </label>
                <label className="block flex-1 text-sm">
                  {labels.length}
                  <select
                    className={inputClass}
                    value={preset.length}
                    onChange={(event) =>
                      updatePost(preset.id, {
                        length: event.target.value as PostPreset["length"],
                      })
                    }
                  >
                    <option value="short">{labels.short}</option>
                    <option value="long">{labels.long}</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                {labels.countRule}
                <select
                  className={inputClass}
                  value={preset.countRule}
                  onChange={(event) =>
                    updatePost(preset.id, {
                      countRule: event.target.value as PostPreset["countRule"],
                    })
                  }
                >
                  <option value="x">{labels.countX}</option>
                  <option value="none">{labels.countNone}</option>
                </select>
              </label>
              <label className="block text-sm">
                {labels.postInstructions}
                <textarea
                  className={inputClass}
                  rows={4}
                  maxLength={8000}
                  value={preset.instructions}
                  onChange={(event) =>
                    updatePost(preset.id, { instructions: event.target.value })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preset.useCommonInstructions}
                  onChange={(event) =>
                    updatePost(preset.id, {
                      useCommonInstructions: event.target.checked,
                    })
                  }
                />
                {labels.useCommon}
              </label>
              <div className="flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  aria-label={`${labels.moveUp}: ${preset.name}`}
                  disabled={index === 0}
                  className="text-blue-700 disabled:opacity-40"
                  onClick={() => movePost(index, -1)}
                >
                  {labels.moveUp}
                </button>
                <button
                  type="button"
                  aria-label={`${labels.moveDown}: ${preset.name}`}
                  disabled={index === value.posts.length - 1}
                  className="text-blue-700 disabled:opacity-40"
                  onClick={() => movePost(index, 1)}
                >
                  {labels.moveDown}
                </button>
                <button
                  type="button"
                  aria-label={`${labels.duplicatePost}: ${preset.name}`}
                  disabled={postsFull}
                  className="text-blue-700 disabled:opacity-40"
                  onClick={() =>
                    onChange({
                      ...value,
                      posts: [
                        ...value.posts.slice(0, index + 1),
                        {
                          ...preset,
                          id: crypto.randomUUID(),
                          name: `${preset.name}${labels.copySuffix}`.slice(
                            0,
                            80,
                          ),
                        },
                        ...value.posts.slice(index + 1),
                      ],
                    })
                  }
                >
                  {labels.duplicatePost}
                </button>
                <button
                  type="button"
                  aria-label={`${labels.removePost}: ${preset.name}`}
                  className="text-red-700"
                  onClick={() =>
                    onChange({
                      ...value,
                      posts: value.posts.filter(
                        (item) => item.id !== preset.id,
                      ),
                    })
                  }
                >
                  {labels.removePost}
                </button>
              </div>
            </div>
          </details>
        ))}
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            disabled={postsFull}
            className="text-blue-700 disabled:opacity-40"
            onClick={() =>
              onChange({
                ...value,
                posts: [...value.posts, createPostPreset()],
              })
            }
          >
            {labels.addPost}
          </button>
          <button
            type="button"
            className="text-blue-700"
            onClick={() => onChange({ ...value, posts: defaultPostPresets() })}
          >
            {labels.reset}
          </button>
        </div>
      </fieldset>
      <label className="block text-sm">
        {labels.operation}
        <select
          className={inputClass}
          value={value.mode}
          onChange={(event) =>
            onChange({
              ...value,
              mode: event.target.value as AssistantSettings["mode"],
            })
          }
        >
          <option value="read-only">{labels.readOnly}</option>
          <option value="input">{labels.input}</option>
          <option value="automation">{labels.automation}</option>
        </select>
      </label>
    </section>
  );
}
