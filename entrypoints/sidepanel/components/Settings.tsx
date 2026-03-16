import React from "react";
import type { LLMSettings, ModelInfo, OperationMode } from "../types";
import type { Language } from "../i18n";
import { t } from "../i18n";
import {
  MAX_SERVER_PORT,
  MIN_SERVER_PORT,
  normalizeServerPort,
} from "../server-port";

interface SettingsProps {
  settings: LLMSettings;
  onSettingsChange: (settings: LLMSettings) => void;
  onClose: () => void;
  isConnected: boolean;
  availableModels: ModelInfo[];
  onRefreshModels: () => void;
  browserActionsEnabled: boolean;
  onBrowserActionsChange: (enabled: boolean) => void;
  fileOperationsEnabled: boolean;
  onFileOperationsChange: (enabled: boolean) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  maxAgentLoops: number;
  onMaxAgentLoopsChange: (max: number) => void;
  operationMode: OperationMode;
  onOperationModeChange: (mode: OperationMode) => void;
  serverPort: number;
  onServerPortChange: (port: number) => void;
  allowHighRiskActions: boolean;
  onAllowHighRiskActionsChange: (enabled: boolean) => void;
  allowEvaluateAction: boolean;
  onAllowEvaluateActionChange: (enabled: boolean) => void;
}

const FALLBACK_COPILOT_MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "o1", label: "o1" },
  { value: "o1-mini", label: "o1 mini" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
] as const;

// Filter to show only Anthropic, OpenAI, and Google models
const ALLOWED_VENDORS = ["anthropic", "openai", "google", "copilot"];
const ALLOWED_FAMILIES = [
  // OpenAI
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4",
  "gpt-4-turbo",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  // Anthropic
  "claude-3.5-sonnet",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "claude-sonnet-4",
  "claude-opus-4",
  // Google
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-pro",
];

const MIN_AGENT_LOOPS = 1;
const MAX_AGENT_LOOPS = 1000;
const DEFAULT_AGENT_LOOPS = 500;

function normalizeAgentLoops(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AGENT_LOOPS;
  }
  return Math.min(MAX_AGENT_LOOPS, Math.max(MIN_AGENT_LOOPS, parsed));
}

export function Settings({
  settings,
  onSettingsChange,
  onClose,
  isConnected,
  availableModels,
  onRefreshModels,
  browserActionsEnabled,
  onBrowserActionsChange,
  fileOperationsEnabled,
  onFileOperationsChange,
  language,
  onLanguageChange,
  maxAgentLoops,
  onMaxAgentLoopsChange,
  operationMode,
  onOperationModeChange,
  serverPort,
  onServerPortChange,
  allowHighRiskActions,
  onAllowHighRiskActionsChange,
  allowEvaluateAction,
  onAllowEvaluateActionChange,
}: SettingsProps) {
  // Filter models to Anthropic, OpenAI, Google only
  const filteredModels = availableModels.filter(
    (m) =>
      ALLOWED_VENDORS.some((v) => m.provider.toLowerCase().includes(v)) ||
      ALLOWED_FAMILIES.some((f) => m.id.toLowerCase().includes(f)),
  );

  const copilotModels = filteredModels.filter((m) => m.provider === "copilot");
  const displayModels =
    copilotModels.length > 0
      ? copilotModels.map((m) => ({ value: m.id, label: m.name }))
      : FALLBACK_COPILOT_MODELS;

  const [serverPortInput, setServerPortInput] = React.useState(
    String(serverPort),
  );

  React.useEffect(() => {
    setServerPortInput(String(serverPort));
  }, [serverPort]);

  const commitServerPortInput = () => {
    const normalizedPort = normalizeServerPort(serverPortInput);
    setServerPortInput(String(normalizedPort));
    onServerPortChange(normalizedPort);
  };

  const isEvaluateActionDisabled = !allowHighRiskActions;

  return (
    <div className="p-4 bg-white border-b max-h-[70vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">{t("settingsTitle", language)}</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          ✕
        </button>
      </div>

      {/* Provider Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("provider", language)}
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="provider"
              checked={settings.provider === "copilot"}
              onChange={() =>
                onSettingsChange({ ...settings, provider: "copilot" })
              }
              className="text-blue-600"
            />
            <span>Copilot (Chat)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="provider"
              checked={settings.provider === "copilot-agent"}
              onChange={() =>
                onSettingsChange({ ...settings, provider: "copilot-agent" })
              }
              className="text-blue-600"
            />
            <div>
              <span>Copilot (Agent)</span>
              <p className="text-xs text-gray-500">
                {t("copilotAgentDesc", language)}
              </p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="provider"
              checked={settings.provider === "lm-studio"}
              onChange={() =>
                onSettingsChange({ ...settings, provider: "lm-studio" })
              }
              className="text-blue-600"
            />
            <span>LM Studio</span>
          </label>
        </div>
      </div>

      {/* Copilot Settings */}
      {(settings.provider === "copilot" ||
        settings.provider === "copilot-agent") && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              {t("model", language)}
            </label>
            <button
              onClick={() => onRefreshModels()}
              className="text-xs text-blue-600 hover:underline"
            >
              {t("refresh", language)}
            </button>
          </div>
          <select
            value={settings.copilot.model}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                copilot: {
                  ...settings.copilot,
                  model: e.target.value,
                },
              })
            }
            className="w-full p-2 border rounded bg-white"
            aria-label={t("modelSelectAria", language)}
          >
            {displayModels.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          {!isConnected && copilotModels.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {t("modelNotConnected", language)}
            </p>
          )}
        </div>
      )}

      {/* LM Studio Settings */}
      {settings.provider === "lm-studio" && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t("endpoint", language)}
            </label>
            <input
              type="text"
              value={settings.lmStudio.endpoint}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  lmStudio: { ...settings.lmStudio, endpoint: e.target.value },
                })
              }
              placeholder="http://localhost:1234"
              className="w-full p-2 border rounded"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t("modelName", language)}
            </label>
            <input
              type="text"
              value={settings.lmStudio.model}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  lmStudio: { ...settings.lmStudio, model: e.target.value },
                })
              }
              placeholder="auto"
              className="w-full p-2 border rounded"
            />
          </div>
        </>
      )}

      {/* Browser Actions Toggle */}
      <div className="mb-4 pt-4 border-t">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-gray-700">
              {t("browserActions", language)}
            </span>
            <p className="text-xs text-gray-500">
              {t("browserActionsDesc", language)}
            </p>
          </div>
          <input
            type="checkbox"
            checked={browserActionsEnabled}
            onChange={(e) => onBrowserActionsChange(e.target.checked)}
            className="w-5 h-5 text-blue-600 rounded"
          />
        </label>
      </div>

      {/* File Operations Toggle */}
      <div className="mb-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-gray-700">
              {t("fileOperations", language)}
            </span>
            <p className="text-xs text-gray-500">
              {t("fileOperationsDesc", language)}
            </p>
          </div>
          <input
            type="checkbox"
            checked={fileOperationsEnabled}
            onChange={(e) => onFileOperationsChange(e.target.checked)}
            className="w-5 h-5 text-blue-600 rounded"
          />
        </label>
      </div>

      {/* Language Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("language", language)}
        </label>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as Language)}
          className="w-full p-2 border rounded bg-white"
          aria-label="Language selection"
        >
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </div>

      {/* Server Port */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("serverPort", language)}
        </label>
        <input
          type="number"
          min={MIN_SERVER_PORT}
          max={MAX_SERVER_PORT}
          value={serverPortInput}
          onChange={(e) => setServerPortInput(e.target.value)}
          onBlur={commitServerPortInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitServerPortInput();
            }
          }}
          className="w-full p-2 border rounded"
          aria-label={t("serverPort", language)}
        />
        <p className="text-xs text-gray-500 mt-1">
          {t("serverPortDesc", language)}
        </p>
      </div>

      {/* High-Risk Action Toggle */}
      <div className="mb-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-gray-700">
              {t("allowHighRiskActions", language)}
            </span>
            <p className="text-xs text-gray-500">
              {t("allowHighRiskActionsDesc", language)}
            </p>
          </div>
          <input
            type="checkbox"
            checked={allowHighRiskActions}
            onChange={(e) => onAllowHighRiskActionsChange(e.target.checked)}
            className="w-5 h-5 text-blue-600 rounded"
          />
        </label>
      </div>

      {/* Evaluate Action Toggle */}
      <div className="mb-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-gray-700">
              {t("allowEvaluateAction", language)}
            </span>
            <p className="text-xs text-gray-500">
              {t("allowEvaluateActionDesc", language)}
            </p>
            {isEvaluateActionDisabled && (
              <p className="text-xs text-gray-500 mt-1">
                {t("allowEvaluateActionDisabledHint", language)}
              </p>
            )}
          </div>
          <input
            type="checkbox"
            checked={allowEvaluateAction}
            onChange={(e) => onAllowEvaluateActionChange(e.target.checked)}
            disabled={isEvaluateActionDisabled}
            className="w-5 h-5 text-blue-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
      </div>

      {/* Max Agent Loops (only show for agent mode) */}
      {settings.provider === "copilot-agent" && (
        <div className="mb-4">
          <label
            htmlFor="maxAgentLoops"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            {language === "ja" ? "最大ループ回数" : "Max Agent Loops"}
          </label>
          <input
            id="maxAgentLoops"
            type="number"
            min={1}
            max={1000}
            value={maxAgentLoops}
            onChange={(e) =>
              onMaxAgentLoopsChange(normalizeAgentLoops(e.target.value))
            }
            className="w-full p-2 border rounded"
            aria-label={
              language === "ja" ? "最大ループ回数" : "Max Agent Loops"
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            {language === "ja"
              ? "自律実行の最大繰り返し回数 (デフォルト: 500)"
              : "Maximum iterations for autonomous execution (default: 500)"}
          </p>
        </div>
      )}

      {/* Operation Mode (only show for agent mode) */}
      {settings.provider === "copilot-agent" && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {language === "ja" ? "操作モード" : "Operation Mode"}
          </label>
          <select
            value={operationMode}
            onChange={(e) =>
              onOperationModeChange(e.target.value as OperationMode)
            }
            className="w-full p-2 border rounded bg-white"
            aria-label="Operation mode selection"
          >
            <option value="text">
              {language === "ja"
                ? "📝 テキスト (高速・軽量)"
                : "📝 Text (Fast & Light)"}
            </option>
            <option value="hybrid">
              {language === "ja"
                ? "🔄 ハイブリッド (失敗時に画像)"
                : "🔄 Hybrid (Image on failure)"}
            </option>
            <option value="screenshot">
              {language === "ja"
                ? "📸 スクリーンショット (安定)"
                : "📸 Screenshot (Stable)"}
            </option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {language === "ja"
              ? operationMode === "text"
                ? "DOMからテキスト抽出（最速）"
                : operationMode === "hybrid"
                  ? "テキストで失敗時にスクリーンショットへフォールバック"
                  : "常にスクリーンショットを使用（最も安定）"
              : operationMode === "text"
                ? "Extract text from DOM (fastest)"
                : operationMode === "hybrid"
                  ? "Fallback to screenshot on text failure"
                  : "Always use screenshot (most stable)"}
          </p>
        </div>
      )}
    </div>
  );
}
