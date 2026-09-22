import React from "react";
import {
  normalizeAssistantSettings,
  type AssistantSettings,
} from "../assistant-settings";

export function AssistantPreferences({
  value,
  onChange,
  busy = false,
}: {
  value: AssistantSettings;
  onChange: (value: AssistantSettings) => void;
  busy?: boolean;
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
  const inputClass = "w-full min-w-0 p-2 border rounded text-sm mt-1";
  return (
    <section className="mb-5 space-y-3 border-b pb-4">
      <h3 className="text-sm font-semibold">Assistant instructions</h3>
      <label className="block text-sm">
        Global instructions
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
        Active profile
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
              {item.name}
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
          Add profile
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
          Delete profile
        </button>
      </div>
      <label className="block text-sm">
        Profile name
        <input
          className={inputClass}
          maxLength={80}
          value={profile.name}
          onChange={(event) => updateProfile({ name: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Profile instructions
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
        Post menu name
        <input
          className={inputClass}
          maxLength={80}
          value={value.post.name}
          onChange={(event) =>
            onChange({
              ...value,
              post: { ...value.post, name: event.target.value },
            })
          }
        />
      </label>
      <label className="block text-sm">
        Post instructions
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
      <button
        type="button"
        className="text-sm text-blue-700"
        onClick={() =>
          onChange({ ...value, post: normalizeAssistantSettings(null).post })
        }
      >
        Reset post preset
      </button>
      <label className="block text-sm">
        Browser operation
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
          <option value="read-only">Read only</option>
          <option value="input">Assist with input</option>
          <option value="automation">Browser automation</option>
        </select>
      </label>
    </section>
  );
}
