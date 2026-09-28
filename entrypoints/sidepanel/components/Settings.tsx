import React from "react";
import { AssistantPreferences } from "./AssistantPreferences";
import type { AssistantSettings } from "../assistant-settings";
import {
  clampAgentLoops,
  DEFAULT_AGENT_LOOPS,
  MAX_AGENT_LOOPS,
} from "../agent-loop-policy";
import { PersonalProfileSettings } from "./PersonalProfileSettings";
import type { PersonalProfile } from "../personal-profile";
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
import type { CustomPrompt } from "../pending-action";
import {
  getAutoProviderLabel,
  getAutoProviderOrder,
  getCapabilityStatus,
} from "../auto-provider";

interface SettingsProps {
  taskRunning?: boolean;
  onSavingProfileChange?: (saving: boolean) => void;
  personalProfile?: PersonalProfile;
  onPersonalProfileChange?: (profile: PersonalProfile) => void;
  assistantSettings?: AssistantSettings;
  onAssistantSettingsChange?: (settings: AssistantSettings) => void;
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
  customPrompts: CustomPrompt[];
  onCustomPromptsChange: (prompts: CustomPrompt[]) => void;
}

function supportsAgentControls(provider: LLMSettings["provider"]): boolean {
  return [
    "auto",
    "copilot",
    "copilot-agent",
    "copilot-sdk",
    "copilot-cli",
    "lm-studio",
  ].includes(provider);
}

function normalizeAgentLoops(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AGENT_LOOPS;
  }
  return clampAgentLoops(parsed);
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
  taskRunning = false,
  onSavingProfileChange,
  personalProfile,
  onPersonalProfileChange,
  assistantSettings,
  onAssistantSettingsChange,
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
  customPrompts,
  onCustomPromptsChange,
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
  const sections = [
    ...(assistantSettings && onAssistantSettingsChange ? ["assistant"] : []),
    ...(personalProfile && onPersonalProfileChange ? ["personal"] : []),
    "connection",
  ];
  const [section, setSection] = React.useState(sections[0]);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  const sectionLabel = (name: string) =>
    language === "ja"
      ? ({
          assistant: "指示・投稿",
          personal: "個人情報",
          connection: "接続・動作",
        }[name] ?? name)
      : ({
          assistant: "Assistant",
          personal: "Personal",
          connection: "Connection",
        }[name] ?? name);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto bg-white"
      role="region"
      aria-labelledby="settings-heading"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          !savingProfile
        ) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="sticky top-0 z-10 bg-white border-b px-4 pt-3">
        <div className="flex items-center justify-between mb-2">
          <h2 id="settings-heading" className="font-semibold">
            {t("settingsTitle", language)}
          </h2>
          <button
            ref={closeButtonRef}
            disabled={savingProfile}
            onClick={onClose}
            title={language === "ja" ? "設定を閉じる" : "Close settings"}
            aria-label={language === "ja" ? "設定を閉じる" : "Close settings"}
            className="w-9 h-9 shrink-0 text-gray-500 hover:bg-gray-100 rounded focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            ✕
          </button>
        </div>
        <div
          role="tablist"
          aria-label={t("settingsTitle", language)}
          className="flex min-w-0 gap-1"
        >
          {sections.map((name, index) => (
            <button
              key={name}
              type="button"
              id={`settings-tab-${name}`}
              role="tab"
              aria-selected={section === name}
              aria-controls={`settings-section-${name}`}
              tabIndex={section === name ? 0 : -1}
              className={`flex-1 min-w-0 px-2 py-2 text-sm border-b-2 focus-visible:ring-2 focus-visible:ring-blue-500 ${section === name ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600"}`}
              onClick={() => setSection(name)}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!offset && event.key !== "Home" && event.key !== "End")
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sections.length - 1
                      : (index + offset + sections.length) % sections.length;
                setSection(sections[next]);
                document
                  .getElementById(`settings-tab-${sections[next]}`)
                  ?.focus();
              }}
            >
              {sectionLabel(name)}
            </button>
          ))}
        </div>
      </div>
      {assistantSettings && onAssistantSettingsChange && (
        <div
          id="settings-section-assistant"
          role="tabpanel"
          aria-labelledby="settings-tab-assistant"
          hidden={section !== "assistant"}
          className="p-4"
        >
          <AssistantPreferences
            value={assistantSettings}
            onChange={onAssistantSettingsChange}
            busy={taskRunning}
            language={language}
          />
        </div>
      )}
      {personalProfile && onPersonalProfileChange && (
        <div
          id="settings-section-personal"
          role="tabpanel"
          aria-labelledby="settings-tab-personal"
          hidden={section !== "personal"}
          className="p-4"
        >
          <PersonalProfileSettings
            value={personalProfile}
            onChange={onPersonalProfileChange}
            language={language}
            onSavingChange={(saving) => {
              setSavingProfile(saving);
              onSavingProfileChange?.(saving);
            }}
          />
        </div>
      )}
      <div
        id="settings-section-connection"
        role="tabpanel"
        aria-labelledby="settings-tab-connection"
        hidden={section !== "connection"}
        className="p-4"
      >
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
                    lmStudio: {
                      ...settings.lmStudio,
                      endpoint: e.target.value,
                    },
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
              checked={
                fileOperationsEnabled &&
                (!assistantSettings || assistantSettings.mode === "automation")
              }
              disabled={Boolean(
                assistantSettings && assistantSettings.mode !== "automation",
              )}
              title={
                assistantSettings && assistantSettings.mode !== "automation"
                  ? "Automatic file saving is unavailable in this mode"
                  : undefined
              }
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

        {/* Custom Prompts */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t("customPrompts", language)}
          </label>
          <p className="text-xs text-gray-500 mb-2">
            {t("customPromptsDesc", language)}
          </p>
          {customPrompts.map((prompt, index) => (
            <div key={prompt.id} className="mb-3 p-3 border rounded bg-gray-50">
              <input
                type="text"
                value={prompt.name}
                onChange={(e) => {
                  const next = customPrompts.map((item, i) =>
                    i === index ? { ...item, name: e.target.value } : item,
                  );
                  onCustomPromptsChange(next);
                }}
                className="w-full p-2 border rounded mb-2"
                placeholder={t("customPromptNamePlaceholder", language)}
                aria-label={`${t("customPromptName", language)} ${index + 1}`}
              />
              <textarea
                value={prompt.body}
                onChange={(e) => {
                  const next = customPrompts.map((item, i) =>
                    i === index ? { ...item, body: e.target.value } : item,
                  );
                  onCustomPromptsChange(next);
                }}
                className="w-full p-2 border rounded text-sm"
                rows={3}
                placeholder={t("customPromptBodyPlaceholder", language)}
                aria-label={`${t("customPromptBody", language)} ${index + 1}`}
              />
            </div>
          ))}
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
        {!assistantSettings && (
          <>
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
                  onChange={(e) =>
                    onAllowHighRiskActionsChange(e.target.checked)
                  }
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
                    <p
                      id={evaluateHintId}
                      className="text-xs text-gray-500 mt-1"
                    >
                      {t("allowEvaluateActionDisabledHint", language)}
                    </p>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={allowEvaluateAction}
                  onChange={(e) =>
                    onAllowEvaluateActionChange(e.target.checked)
                  }
                  disabled={isEvaluateActionDisabled}
                  aria-describedby={
                    isEvaluateActionDisabled ? evaluateHintId : undefined
                  }
                  className="w-5 h-5 text-blue-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </label>
            </div>

            {/* Max Agent Loops (only show for agent mode) */}
          </>
        )}
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
              max={MAX_AGENT_LOOPS}
              value={clampAgentLoops(maxAgentLoops)}
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
                ? `自律実行の最大繰り返し回数 (デフォルト: ${DEFAULT_AGENT_LOOPS})`
                : `Maximum iterations for autonomous execution (default: ${DEFAULT_AGENT_LOOPS})`}
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
    </div>
  );
}
