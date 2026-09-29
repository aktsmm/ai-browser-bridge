import React, { useEffect, useRef, useState } from "react";
import type { Language } from "../i18n";

interface IssueReportInput {
  title: string;
  steps: string;
  expected: string;
  actual: string;
  version: string;
  mode: string;
  status: string;
  origin: string;
  includeOrigin: boolean;
}
const MAX_ISSUE_TITLE_LENGTH = 80;
const MAX_ISSUE_DETAIL_LENGTH = 200;

export function buildIssueBody(report: IssueReportInput): string {
  return [
    "## Steps to reproduce",
    report.steps.trim().slice(0, MAX_ISSUE_DETAIL_LENGTH) || "Not provided",
    "",
    "## Expected",
    report.expected.trim().slice(0, MAX_ISSUE_DETAIL_LENGTH) || "Not provided",
    "",
    "## Actual",
    report.actual.trim().slice(0, MAX_ISSUE_DETAIL_LENGTH) || "Not provided",
    "",
    "## Environment",
    `Version: ${report.version}`,
    `Mode: ${report.mode}`,
    `Page status: ${report.status}`,
    ...(report.includeOrigin && report.origin
      ? [`Site origin: ${report.origin}`]
      : []),
  ].join("\n");
}

export function buildIssueUrl(report: IssueReportInput): string {
  const url = new URL("https://github.com/aktsmm/ai-browser-bridge/issues/new");
  url.searchParams.set(
    "title",
    report.title.trim().slice(0, MAX_ISSUE_TITLE_LENGTH),
  );
  url.searchParams.set("body", buildIssueBody(report));
  return url.toString();
}

export function IssueReportDialog({
  version,
  mode,
  status,
  origin,
  language,
  onClose,
}: Pick<IssueReportInput, "version" | "mode" | "status" | "origin"> & {
  language: Language;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [includeOrigin, setIncludeOrigin] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  const report = {
    title,
    steps,
    expected,
    actual,
    version,
    mode,
    status,
    origin,
    includeOrigin,
  };
  const japanese = language === "ja";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={japanese ? "Issue を報告" : "Report an issue"}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white border shadow-lg p-4 space-y-3"
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            !opening
          ) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
              ),
            );
            if (event.shiftKey && document.activeElement === controls[0]) {
              event.preventDefault();
              controls.at(-1)?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === controls.at(-1)
            ) {
              event.preventDefault();
              controls[0]?.focus();
            }
          }
        }}
      >
        <h2 className="text-sm font-semibold">
          {japanese ? "Issue を報告" : "Report an issue"}
        </h2>
        <label className="block text-xs">
          {japanese ? "件名" : "Title"}
          <input
            className="mt-1 w-full border p-2 text-sm"
            maxLength={MAX_ISSUE_TITLE_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-xs">
          {japanese ? "再現手順" : "Steps to reproduce"}
          <textarea
            className="mt-1 w-full border p-2 text-sm resize-y"
            rows={2}
            maxLength={MAX_ISSUE_DETAIL_LENGTH}
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
          />
        </label>
        <label className="block text-xs">
          {japanese ? "期待した結果" : "Expected"}
          <textarea
            className="mt-1 w-full border p-2 text-sm resize-y"
            rows={2}
            maxLength={MAX_ISSUE_DETAIL_LENGTH}
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </label>
        <label className="block text-xs">
          {japanese ? "実際の結果" : "Actual"}
          <textarea
            className="mt-1 w-full border p-2 text-sm resize-y"
            rows={2}
            maxLength={MAX_ISSUE_DETAIL_LENGTH}
            value={actual}
            onChange={(event) => setActual(event.target.value)}
          />
        </label>
        {origin && (
          <label className="flex items-start gap-2 text-xs break-all">
            <input
              type="checkbox"
              checked={includeOrigin}
              onChange={(event) => setIncludeOrigin(event.target.checked)}
            />
            {japanese
              ? `サイトのドメインを含める: ${origin}`
              : `Include site origin: ${origin}`}
          </label>
        )}
        <div className="text-xs text-gray-600">
          {japanese ? "含める環境情報" : "Environment"}: {version} / {mode} /{" "}
          {status}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer">
            {japanese ? "送信内容を確認" : "Preview issue text"}
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words bg-gray-50 p-2">
            {buildIssueBody(report)}
          </pre>
        </details>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {japanese
              ? "GitHub を開けませんでした。"
              : "Could not open GitHub."}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            ref={closeRef}
            type="button"
            disabled={opening}
            className="border px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            {japanese ? "キャンセル" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={
              opening || !title.trim() || !steps.trim() || !actual.trim()
            }
            className="bg-green-700 text-white px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={async () => {
              setOpening(true);
              setError(false);
              try {
                await chrome.tabs.create({ url: buildIssueUrl(report) });
                onClose();
              } catch {
                setError(true);
              } finally {
                setOpening(false);
              }
            }}
          >
            {japanese ? "GitHub で確認" : "Review on GitHub"}
          </button>
        </div>
      </div>
    </div>
  );
}
