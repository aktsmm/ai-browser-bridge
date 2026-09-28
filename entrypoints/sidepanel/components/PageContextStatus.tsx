import React from "react";
import type { Language } from "../i18n";
import type { PageContextResult } from "../page-context";

export function PageContextStatus({
  state,
  origin,
  language,
  busy,
  reading = false,
  onRead,
}: {
  state: PageContextResult | null;
  origin: string;
  language: Language;
  busy: boolean;
  reading?: boolean;
  onRead: () => void;
}) {
  const labels =
    language === "ja"
      ? {
          ok: "ページ取得済み",
          partial: "一部を取得",
          empty: "読み取れる内容がありません",
          "permission-required": "サイトの許可が必要です",
          unsupported: "このページは対象外です",
          failed: "ページを取得できませんでした",
        }
      : {
          ok: "Page ready",
          partial: "Partial page",
          empty: "No readable content",
          "permission-required": "Site permission required",
          unsupported: "Unsupported page",
          failed: "Page unavailable",
        };
  return (
    <section
      aria-label={language === "ja" ? "ページ情報" : "Page context"}
      className="px-4 py-2 border-t bg-gray-50 min-w-0"
    >
      <div className="flex items-center justify-between gap-3">
        <div
          role="status"
          aria-live="polite"
          className="text-xs min-w-0 break-words"
        >
          {reading
            ? language === "ja"
              ? "ページを読み取り中…"
              : "Reading page..."
            : state
              ? labels[state.status]
              : language === "ja"
                ? "ページ未取得"
                : "Page not read"}
        </div>
        {state &&
          ["empty", "permission-required", "failed"].includes(state.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={onRead}
              className="shrink-0 text-xs text-blue-700 underline disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {language === "ja" ? "再読み取り" : "Retry reading"}
            </button>
          )}
      </div>
      {origin && (
        <div className="mt-1 text-xs text-gray-500 break-all">{origin}</div>
      )}
      {state?.status === "permission-required" && (
        <div className="mt-1 text-xs text-gray-500">
          {language === "ja"
            ? "ブラウザの拡張機能メニューでこのサイトへのアクセスを許可し、再読み取りしてください。"
            : "Allow site access in the browser's extension menu, then retry reading."}
        </div>
      )}
    </section>
  );
}
