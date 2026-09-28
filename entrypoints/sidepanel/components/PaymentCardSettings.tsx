import React, { useEffect, useState } from "react";
import type { Language } from "../i18n";
import {
  clearPaymentCard,
  fillPaymentCardOnCurrentTab,
  loadPaymentCard,
  savePaymentCard,
  sealPaymentCard,
  type SealedPaymentCard,
} from "../payment-card";

export function PaymentCardSettings({ language }: { language: Language }) {
  const [stored, setStored] = useState<SealedPaymentCard | null>(null);
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const labels =
    language === "ja"
      ? {
          title: "カード情報（任意）",
          help: "保存と入力について",
          description:
            "番号と有効期限はパスフレーズで暗号化してこの端末に保存します。パスフレーズは保存しません。CVVは保存せず、本人が入力してください。AIにはカード情報を渡さず、購入も確定しません。",
          number: "カード番号",
          expiry: "有効期限（月/年）",
          passphrase: "パスフレーズ（12文字以上）",
          save: "暗号化して保存",
          fill: "現在のページのカード欄へ入力",
          remove: "保存したカードを消去",
          saved: "カードを暗号化して保存しました",
          filled:
            "カード欄へ入力しました。内容と購入前の確認を本人が行ってください。",
          missing:
            "このページに対応したカード欄がありません。ブラウザの決済オートフィルか手入力を使ってください。",
          failed:
            "カード情報を処理できませんでした。入力とパスフレーズを確認してください。",
          deleted: "カードを消去しました",
          confirm: "このサイトのカード欄に入力しますか？",
          confirmDelete: "保存したカード情報を消去しますか？",
        }
      : {
          title: "Payment card (optional)",
          help: "Storage and filling",
          description:
            "Number and expiration are encrypted with your passphrase on this device. The passphrase is not stored. CVV is never saved; enter it yourself. Card details are not sent to AI and no purchase is submitted.",
          number: "Card number",
          expiry: "Expiration (month/year)",
          passphrase: "Passphrase (at least 12 characters)",
          save: "Save encrypted card",
          fill: "Fill card fields on current page",
          remove: "Delete saved card",
          saved: "Encrypted card saved",
          filled:
            "Card fields filled. Review the details and complete any purchase yourself.",
          missing:
            "No supported card fields on this page. Use browser payment autofill or enter the details manually.",
          failed:
            "Could not process the card. Check the details and passphrase.",
          deleted: "Saved card deleted",
          confirm: "Fill card fields on this site?",
          confirmDelete: "Delete the saved card?",
        };

  useEffect(() => {
    void loadPaymentCard()
      .then(setStored)
      .catch(() => setStatus(labels.failed));
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sealed = await sealPaymentCard({ number, expiry }, passphrase);
      await savePaymentCard(sealed);
      setStored(sealed);
      setStatus(labels.saved);
      setNumber("");
      setExpiry("");
    } catch {
      setStatus(labels.failed);
    } finally {
      setPassphrase("");
      setBusy(false);
    }
  };

  const fill = async () => {
    if (busy || !stored) return;
    setBusy(true);
    try {
      const result = await fillPaymentCardOnCurrentTab(
        stored,
        passphrase,
        (origin) => window.confirm(`${labels.confirm}\n${origin}`),
      );
      if (result !== "cancelled")
        setStatus(result === "filled" ? labels.filled : labels.missing);
    } catch {
      setStatus(labels.failed);
    } finally {
      setPassphrase("");
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 space-y-3 border-t pt-4">
      <h4 className="text-sm font-semibold">{labels.title}</h4>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">{labels.help}</summary>
        <p className="mt-1">{labels.description}</p>
      </details>
      {stored && <p className="text-sm">•••• {stored.lastFour}</p>}
      <div className="grid gap-2">
        <label className="text-sm">
          {labels.number}
          <input
            className="w-full mt-1 p-2 border rounded"
            type="password"
            autoComplete="off"
            inputMode="numeric"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {labels.expiry}
          <input
            className="w-full mt-1 p-2 border rounded"
            autoComplete="off"
            placeholder="MM/YY"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {labels.passphrase}
          <input
            className="w-full mt-1 p-2 border rounded"
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          className="text-blue-700 disabled:opacity-40"
          disabled={busy || !number || !expiry || !passphrase}
          onClick={() => void save()}
        >
          {labels.save}
        </button>
        {stored && (
          <button
            type="button"
            className="text-blue-700 disabled:opacity-40"
            disabled={busy || !passphrase}
            onClick={() => void fill()}
          >
            {labels.fill}
          </button>
        )}
        {stored && (
          <button
            type="button"
            className="text-red-700 disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(labels.confirmDelete)) return;
              void clearPaymentCard()
                .then(() => {
                  setStored(null);
                  setStatus(labels.deleted);
                })
                .catch(() => setStatus(labels.failed));
            }}
          >
            {labels.remove}
          </button>
        )}
      </div>
      <div role="status" className="text-xs text-gray-600">
        {status}
      </div>
    </section>
  );
}
