import React, { useState } from "react";
import {
  PERSONAL_FIELDS,
  normalizePersonalProfile,
  savePersonalProfile,
  type PersonalProfile,
} from "../personal-profile";
import type { Language } from "../i18n";
import { PaymentCardSettings } from "./PaymentCardSettings";

export function PersonalProfileSettings({
  value,
  onChange,
  onSavingChange,
  language = "en",
}: {
  value: PersonalProfile;
  onChange: (value: PersonalProfile) => void;
  onSavingChange?: (saving: boolean) => void;
  language?: Language;
}) {
  const labels =
    language === "ja"
      ? {
          title: "個人プロフィール",
          fullName: "氏名",
          email: "メールアドレス",
          phone: "電話番号",
          postalCode: "郵便番号",
          address: "住所",
          help: "何のために使いますか？",
          purpose:
            "許可したサイトで、AIが氏名や住所などの入力を補助するための情報です。購入の確定は自動で行いません。",
          storage:
            "この端末のブラウザ拡張内に保存します。「この端末に記憶」をオフにした場合はブラウザセッション中のみ保持します。次のタスクでサイトごとに許可した項目だけがフォーム入力に使われます。",
          remember: "この端末に記憶",
          save: "プロフィールを保存",
          saving: "保存中...",
          clear: "プロフィールを消去",
          unsaved: "未保存の変更",
          failed: "保存できませんでした",
          cleared: "プロフィールを消去しました",
          saved: "この端末に保存しました",
          session: "このブラウザセッションに保存しました",
          other: "その他の項目",
          otherName: "項目名",
          otherValue: "値",
          add: "項目を追加",
          remove: "項目を削除",
          otherHint:
            "カード情報やパスワードはここに入力せず、カードは下の専用欄を使ってください。",
        }
      : {
          title: "Personal profile",
          fullName: "Full name",
          email: "Email",
          phone: "Phone",
          postalCode: "Postal code",
          address: "Address",
          help: "How is this used?",
          purpose:
            "Helps AI fill in your name, address and other fields on a site you authorize. Final purchase remains your action.",
          storage:
            "Stored in this device's browser extension. Without Remember on this device, it lasts only for this browser session. Only fields authorized for the next task on a specific site may be used to fill forms.",
          remember: "Remember on this device",
          save: "Save profile",
          saving: "Saving...",
          clear: "Clear profile",
          unsaved: "Unsaved changes",
          failed: "Profile could not be saved",
          cleared: "Profile cleared",
          saved: "Saved on this device",
          session: "Saved for this browser session",
          other: "Other fields",
          otherName: "Field name",
          otherValue: "Value",
          add: "Add field",
          remove: "Remove field",
          otherHint:
            "Do not put card details or passwords here. Use the protected card section below.",
        };
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = React.useRef(false);
  const save = async (profile: PersonalProfile) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setFailed(false);
    setStatus(labels.saving);
    try {
      const normalized = normalizePersonalProfile(profile);
      await savePersonalProfile(normalized);
      onChange(normalized);
      setStatus(
        !PERSONAL_FIELDS.some((field) => normalized[field]) &&
          !normalized.customFields.some((field) => field.value)
          ? labels.cleared
          : normalized.remember
            ? labels.saved
            : labels.session,
      );
    } catch {
      setFailed(true);
      setStatus(labels.failed);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  return (
    <section className="mb-5 border-b pb-4 space-y-3">
      <h3 className="text-sm font-semibold">{labels.title}</h3>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">{labels.help}</summary>
        <p className="mt-1">{labels.purpose}</p>
        <p className="mt-1">{labels.storage}</p>
      </details>
      <fieldset
        disabled={saving}
        aria-busy={saving}
        className="space-y-3 min-w-0"
      >
        {PERSONAL_FIELDS.map((field) => (
          <label key={field} className="block text-sm">
            {labels[field]}
            <input
              type={field === "email" ? "email" : "text"}
              autoComplete="off"
              className="w-full min-w-0 mt-1 p-2 border rounded text-sm"
              maxLength={
                field === "address"
                  ? 1000
                  : field === "email"
                    ? 254
                    : field === "phone"
                      ? 80
                      : field === "postalCode"
                        ? 40
                        : 200
              }
              value={value[field]}
              onChange={(event) => {
                onChange({ ...value, [field]: event.target.value });
                setFailed(false);
                setStatus(labels.unsaved);
              }}
            />
          </label>
        ))}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{labels.other}</h4>
          <p className="text-xs text-gray-600">{labels.otherHint}</p>
          {value.customFields.map((field, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <label className="text-sm flex-1 min-w-32">
                {labels.otherName}
                <input
                  className="w-full mt-1 p-2 border rounded"
                  maxLength={60}
                  value={field.name}
                  onChange={(event) => {
                    const customFields = value.customFields.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, name: event.target.value }
                          : item,
                    );
                    onChange({ ...value, customFields });
                    setStatus(labels.unsaved);
                  }}
                />
              </label>
              <label className="text-sm flex-1 min-w-32">
                {labels.otherValue}
                <input
                  className="w-full mt-1 p-2 border rounded"
                  maxLength={500}
                  value={field.value}
                  onChange={(event) => {
                    const customFields = value.customFields.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, value: event.target.value }
                          : item,
                    );
                    onChange({ ...value, customFields });
                    setStatus(labels.unsaved);
                  }}
                />
              </label>
              <button
                type="button"
                className="text-red-700 text-sm"
                onClick={() => {
                  onChange({
                    ...value,
                    customFields: value.customFields.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  });
                  setStatus(labels.unsaved);
                }}
              >
                {labels.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={value.customFields.length >= 5}
            className="text-blue-700 text-sm disabled:opacity-40"
            onClick={() => {
              onChange({
                ...value,
                customFields: [...value.customFields, { name: "", value: "" }],
              });
              setStatus(labels.unsaved);
            }}
          >
            {labels.add}
          </button>
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.remember}
            onChange={(event) => {
              onChange({ ...value, remember: event.target.checked });
              setFailed(false);
              setStatus(labels.unsaved);
            }}
          />
          {labels.remember}
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            disabled={saving}
            className="text-blue-700"
            onClick={() => void save(value)}
          >
            {saving ? labels.saving : labels.save}
          </button>
          <button
            type="button"
            disabled={saving}
            className="text-red-700"
            onClick={() => void save(normalizePersonalProfile(null))}
          >
            {labels.clear}
          </button>
        </div>
      </fieldset>
      <div
        className={`text-xs ${failed ? "text-red-700" : "text-gray-600"}`}
        role={failed ? "alert" : "status"}
      >
        {status}
      </div>
      <PaymentCardSettings language={language} />
    </section>
  );
}
