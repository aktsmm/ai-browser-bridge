import React from "react";
import {
  normalizeAssistantSettings,
  type AssistantSettings,
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
          postName: "投稿メニュー名",
          postInstructions: "カスタム投稿の指示",
          postHelp: "カスタム投稿の指示を空欄にすると？",
          postFallback:
            "組み込みのフォーマル・140字の指示を使います。入力した指示がある場合は、その指示を代わりに使います。",
          reset: "投稿設定を初期値に戻す",
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
          postName: "Post menu name",
          postInstructions: "Post instructions",
          postHelp: "What happens if Custom Post instructions are blank?",
          postFallback:
            "Custom Post uses the built-in formal 140-character prompt. Your instructions replace that prompt when provided.",
          reset: "Reset post preset",
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
      <label className="block text-sm">
        {labels.postName}
        <input
          className={inputClass}
          maxLength={80}
          value={
            language === "ja" && value.post.name === "Custom Post"
              ? "カスタム投稿"
              : value.post.name
          }
          onChange={(event) =>
            onChange({
              ...value,
              post: { ...value.post, name: event.target.value },
            })
          }
        />
      </label>
      <label className="block text-sm">
        {labels.postInstructions}
        <textarea
          className={inputClass}
          rows={4}
          maxLength={8000}
          value={value.post.instructions}
          onChange={(event) =>
            onChange({
              ...value,
              post: { ...value.post, instructions: event.target.value },
            })
          }
        />
      </label>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">{labels.postHelp}</summary>
        <p className="mt-1">{labels.postFallback}</p>
      </details>
      <button
        type="button"
        className="text-sm text-blue-700"
        onClick={() =>
          onChange({ ...value, post: normalizeAssistantSettings(null).post })
        }
      >
        {labels.reset}
      </button>
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
