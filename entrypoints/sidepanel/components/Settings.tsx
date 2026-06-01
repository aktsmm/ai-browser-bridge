import React from "react";
import type {
  LLMSettings,
  ModelInfo,
  OperationMode,
  SaveDestinationMode,
  BridgeCapabilities,
} from "../types";
import type { Language } from "../i18n";
import { t } from "../i18n";
import {
  MAX_SERVER_PORT,
  MIN_SERVER_PORT,
  normalizeServerPort,
} from "../server-port";
import { buildDisplayedCopilotModels } from "../copilot-models";
import {
  getAutoProviderLabel,
  getAutoProviderOrder,
  getCapabilityStatus,
} from "../auto-provider";

interface SettingsProps {
  settings: LLMSettings;
  onSettingsChange: (settings: LLMSettings) => void;
  onClose: () => void;
  isConnected: boolean;
  availableModels: ModelInfo[];
  modelFetchFailed: boolean;
  bridgeCapabilities: BridgeCapabilities | null;
  capabilitiesErrorDetail: string | null;
  onRefreshCapabilities: () => void;
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
  saveDestinationMode: SaveDestinationMode;
  onSaveDestinationModeChange: (mode: SaveDestinationMode) => void;
  saveRelativePath: string;
  onSaveRelativePathChange: (path: string) => void;
}

const MIN_AGENT_LOOPS = 1;
const MAX_AGENT_LOOPS = 1000;
const DEFAULT_AGENT_LOOPS = 500;

function supportsAgentControls(provider: LLMSettings["provider"]): boolean {
  return provider === "auto" || provider === "copilot-agent";
}

function normalizeAgentLoops(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AGENT_LOOPS;
  }
  return Math.min(MAX_AGENT_LOOPS, Math.max(MIN_AGENT_LOOPS, parsed));
}

function findBridgeProvider(
  capabilities: BridgeCapabilities | null,
  providerId: BridgeCapabilities["providers"][number]["id"],
): BridgeCapabilities["providers"][number] | undefined {
  return capabilities?.providers.find((provider) => provider.id === providerId);
}

export function getBridgeProviderStatusLabel(
  status: BridgeCapabilities["providers"][number]["status"] | null,
  language: Language,
): string {
  if (language === "ja") {
    if (status === null) return "未取得";
    if (status === "available") return "利用可能";
    if (status === "unavailable") return "利用不可";
    return "未確認";
  }

  return status ?? "not checked";
}

function getBridgeProviderStatusClass(
  status: BridgeCapabilities["providers"][number]["status"] | null,
  baseClass: string,
): string {
  if (status === "available") return `${baseClass} text-green-700`;
  if (status === "unavailable") return `${baseClass} text-red-700`;
  return `${baseClass} text-gray-600`;
}

export function Settings({
  settings,
  onSettingsChange,
  onClose,
  isConnected,
  availableModels,
  modelFetchFailed,
  bridgeCapabilities,
  capabilitiesErrorDetail,
  onRefreshCapabilities,
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
  saveDestinationMode,
  onSaveDestinationModeChange,
  saveRelativePath,
  onSaveRelativePathChange,
}: SettingsProps) {
  const displayModels = buildDisplayedCopilotModels(
    availableModels,
    settings.copilot.model,
  );
  const hasLiveCopilotModels = displayModels.length > 0;
  const selectedModelIsLive = displayModels.some(
    (model) => model.value === settings.copilot.model,
  );
  const usesCopilotModel =
    settings.provider === "auto" ||
    settings.provider === "copilot" ||
    settings.provider === "copilot-agent";
  const vscodeLmCapability = findBridgeProvider(
    bridgeCapabilities,
    "vscode-lm",
  );
  const vscodeLmUnavailable =
    bridgeCapabilities !== null && vscodeLmCapability?.status !== "available";
  const modelHelpId = "copilot-model-help";
  const evaluateHintId = "evaluate-action-hint";
  const modelHelpText =
    !isConnected && availableModels.length === 0
      ? t("modelNotConnected", language)
      : isConnected && modelFetchFailed && availableModels.length === 0
        ? t("modelFetchFailed", language)
        : !hasLiveCopilotModels
          ? t("modelUnavailableOption", language)
          : "";

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
  const showAgentControls = supportsAgentControls(settings.provider);
  const autoProviderOrder = getAutoProviderOrder(operationMode);

  return (
    <div className="p-4 bg-white border-b max-h-[70vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">{t("settingsTitle", language)}</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          ✕
        </button>
      </div>

      {/* Provider Selection */}
      <fieldset className="mb-4">
        <legend className="block text-sm font-medium text-gray-700 mb-2">
          {t("provider", language)}
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="provider"
              checked={settings.provider === "auto"}
              onChange={() =>
                onSettingsChange({ ...settings, provider: "auto" })
              }
              className="text-blue-600"
            />
            <div>
              <span>
                {language === "ja" ? "Auto (推奨)" : "Auto (Recommended)"}
              </span>
              <p className="text-xs text-gray-500">
                {language === "ja"
                  ? "利用可能な bridge provider を自動選択し、必要に応じて fallback します。"
                  : "Uses the best available bridge provider and keeps fallback enabled."}
              </p>
            </div>
          </label>
          <label
            className={`flex items-center gap-2 ${vscodeLmUnavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="provider"
              checked={settings.provider === "copilot-agent"}
              disabled={vscodeLmUnavailable}
              onChange={() =>
                onSettingsChange({ ...settings, provider: "copilot-agent" })
              }
              className="text-blue-600"
            />
            <div>
              <span>GitHub Copilot via VS Code</span>
              <p className="text-xs text-gray-500">
                {language === "ja"
                  ? "動作モードに応じて VS Code LM の Chat / Agent 経路を使います。"
                  : "Uses the VS Code LM chat or agent route based on the operation mode."}
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
        <p className="mt-2 text-xs text-gray-500">
          {language === "ja"
            ? "通常は Auto を使ってください。SDK / CLI は bridge 状態の診断と fallback 用に表示され、通常の provider としては選択しません。"
            : "Use Auto for normal work. SDK and CLI are shown in bridge status as diagnostic/fallback routes, not primary provider choices."}
        </p>
      </fieldset>

      {settings.provider === "auto" && (
        <div className="mb-4 rounded border border-blue-100 bg-blue-50 p-3">
          <div className="text-sm font-medium text-blue-900">
            {language === "ja" ? "Auto 経路" : "Auto route"}
          </div>
          <p className="mt-1 text-xs text-blue-800">
            {language === "ja"
              ? "Auto は VS Code LM を優先し、CLI は最後の回答 fallback としてのみ使います。"
              : "Auto prioritizes VS Code LM. CLI is used only as the last answer fallback."}
          </p>
          <ol className="mt-2 flex flex-wrap gap-2 text-xs">
            {autoProviderOrder.map((providerId, index) => {
              const status = getCapabilityStatus(
                bridgeCapabilities,
                providerId,
              );
              return (
                <li
                  key={providerId}
                  className="rounded border border-blue-200 bg-white px-2 py-1 text-blue-900"
                >
                  <span className="font-medium">
                    {index + 1}. {getAutoProviderLabel(providerId)}
                  </span>
                  <span
                    className={getBridgeProviderStatusClass(status, "ml-1")}
                  >
                    {getBridgeProviderStatusLabel(status, language)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">
            {language === "ja" ? "Bridge 状態" : "Bridge status"}
          </div>
          <button
            type="button"
            onClick={() => onRefreshCapabilities()}
            className="text-xs text-blue-600 hover:underline"
          >
            {t("refresh", language)}
          </button>
        </div>
        {!isConnected && (
          <p className="text-xs text-gray-500">
            {language === "ja"
              ? "ローカル bridge 未接続です。"
              : "Local bridge is not connected."}
          </p>
        )}
        {isConnected && capabilitiesErrorDetail && (
          <p className="text-xs text-amber-700 break-all">
            {capabilitiesErrorDetail}
          </p>
        )}
        {isConnected && bridgeCapabilities && (
          <div className="space-y-1">
            <div className="text-xs text-gray-500">
              Bridge version: {bridgeCapabilities.version}
            </div>
            {bridgeCapabilities.bridge && (
              <div className="text-xs text-gray-500">
                Bridge type: {bridgeCapabilities.bridge}
              </div>
            )}
            {bridgeCapabilities.providers.map((provider) => {
              const statusClass = getBridgeProviderStatusClass(
                provider.status,
                "",
              );
              return (
                <div key={provider.id} className="text-xs">
                  <span className="font-medium text-gray-700">
                    {provider.name}
                  </span>{" "}
                  <span className={statusClass}>
                    {getBridgeProviderStatusLabel(provider.status, language)}
                  </span>
                  {provider.detail && (
                    <div className="ml-3 text-gray-500 break-words">
                      {provider.detail}
                    </div>
                  )}
                  {(provider.isExperimental ||
                    provider.userSelectable === false) && (
                    <div className="ml-3 text-gray-500 break-words">
                      {provider.isExperimental
                        ? language === "ja"
                          ? "Experimental / advanced fallback"
                          : "Experimental / advanced fallback"
                        : language === "ja"
                          ? "通常の provider 選択には表示しません"
                          : "Hidden from normal provider selection"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Copilot Settings */}
      {usesCopilotModel && (
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
            value={selectedModelIsLive ? settings.copilot.model : ""}
            disabled={!hasLiveCopilotModels}
            aria-describedby={modelHelpText ? modelHelpId : undefined}
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
            {!selectedModelIsLive && (
              <option value="" disabled>
                {t("modelUnavailableOption", language)}
              </option>
            )}
            {displayModels.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          {modelHelpText && (
            <p
              id={modelHelpId}
              className={`text-xs mt-1 ${modelFetchFailed ? "text-amber-600" : "text-gray-500"}`}
            >
              {modelHelpText}
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

      <div className="mb-4 pt-4 border-t">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("saveDestination", language)}
        </label>
        <select
          value={saveDestinationMode}
          onChange={(e) =>
            onSaveDestinationModeChange(e.target.value as SaveDestinationMode)
          }
          className="w-full p-2 border rounded bg-white"
          aria-label={t("saveDestination", language)}
        >
          <option value="browser-downloads">
            {t("saveDestinationDownloads", language)}
          </option>
          <option value="workspace-relative">
            {t("saveDestinationWorkspace", language)}
          </option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {t("saveDestinationDesc", language)}
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("saveRelativePath", language)}
        </label>
        <input
          type="text"
          value={saveRelativePath}
          onChange={(e) => onSaveRelativePathChange(e.target.value)}
          className="w-full p-2 border rounded"
          placeholder="output/blog"
          aria-label={t("saveRelativePath", language)}
        />
        <p className="text-xs text-gray-500 mt-1">
          {t("saveRelativePathDesc", language)}
        </p>
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
              <p id={evaluateHintId} className="text-xs text-gray-500 mt-1">
                {t("allowEvaluateActionDisabledHint", language)}
              </p>
            )}
          </div>
          <input
            type="checkbox"
            checked={allowEvaluateAction}
            onChange={(e) => onAllowEvaluateActionChange(e.target.checked)}
            disabled={isEvaluateActionDisabled}
            aria-describedby={
              isEvaluateActionDisabled ? evaluateHintId : undefined
            }
            className="w-5 h-5 text-blue-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
      </div>

      {/* Max Agent Loops (only show for agent mode) */}
      {showAgentControls && (
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
      {showAgentControls && (
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
