import React, { useState } from "react";
import {
  PERSONAL_FIELDS,
  normalizePersonalProfile,
  savePersonalProfile,
  type PersonalProfile,
} from "../personal-profile";

const LABELS = {
  fullName: "Full name",
  email: "Email",
  phone: "Phone",
  postalCode: "Postal code",
  address: "Address",
};
export function PersonalProfileSettings({
  value,
  onChange,
  onSavingChange,
}: {
  value: PersonalProfile;
  onChange: (value: PersonalProfile) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
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
    setStatus("Saving...");
    try {
      const normalized = normalizePersonalProfile(profile);
      await savePersonalProfile(normalized);
      onChange(normalized);
      setStatus(
        !PERSONAL_FIELDS.some((field) => normalized[field])
          ? "Profile cleared"
          : normalized.remember
            ? "Saved on this device"
            : "Saved for this browser session",
      );
    } catch {
      setFailed(true);
      setStatus("Profile could not be saved");
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  return (
    <section className="mb-5 border-b pb-4 space-y-3">
      <h3 className="text-sm font-semibold">Personal profile</h3>
      <fieldset
        disabled={saving}
        aria-busy={saving}
        className="space-y-3 min-w-0"
      >
        {PERSONAL_FIELDS.map((field) => (
          <label key={field} className="block text-sm">
            {LABELS[field]}
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
                setStatus("Unsaved changes");
              }}
            />
          </label>
        ))}
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.remember}
            onChange={(event) => {
              onChange({ ...value, remember: event.target.checked });
              setFailed(false);
              setStatus("Unsaved changes");
            }}
          />
          Remember on this device
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            disabled={saving}
            className="text-blue-700"
            onClick={() => void save(value)}
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
          <button
            type="button"
            disabled={saving}
            className="text-red-700"
            onClick={() => void save(normalizePersonalProfile(null))}
          >
            Clear profile
          </button>
        </div>
      </fieldset>
      <div
        className={`text-xs ${failed ? "text-red-700" : "text-gray-600"}`}
        role={failed ? "alert" : "status"}
      >
        {status}
      </div>
    </section>
  );
}
