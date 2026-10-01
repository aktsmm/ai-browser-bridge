import React, { useState, useEffect, useRef } from "react";
import {
  ASSISTANT_SETTINGS_KEY,
  buildChatContext,
  normalizeAssistantSettings,
  type TaskOptions,
} from "./assistant-settings";
import { Settings } from "./components/Settings";
import { Chat } from "./components/Chat";
import { PageContextStatus } from "./components/PageContextStatus";
import { IssueReportDialog } from "./components/IssueReportDialog";
import type {
  LLMSettings,
  ChatMessage,
  ModelInfo,
  OperationMode,
  BrowserAction,
  SaveDestinationMode,
  BridgeCapabilities,
} from "./types";
import {
  executeBrowserAction,
  parseFirstBrowserAction,
  parseFileActionsFromResponse,
  captureScreenshot,
  setEvaluateActionEnabled,
  downloadTextFile,
} from "./browser-actions";
import type { Language } from "./i18n";
import { t } from "./i18n";
import { BRIDGE_CLIENT_HEADERS } from "./constants";
import { DEFAULT_SERVER_PORT, normalizeServerPort } from "./server-port";
import {
  DEFAULT_AGENT_LOOPS,
  clampAgentLoops,
  shouldEnableScreenshotFallback,
  shouldStopAutonomousLoopAfterFailures,
} from "./agent-loop-policy";
import {
  buildArtifactRelativePath,
  buildBlogDraftContent,
  buildSavedMarkdownContent,
  getAnswerArtifactInput,
} from "./artifact-template";
import { buildAttachmentDisplayText, type ChatAttachment } from "./attachments";
import { localizeFileOperationError } from "./file-operation-error";
import { fetchModelsWithRetry } from "./model-fetch";
import { readUtf8Stream, finishStoppedConversation } from "./stream-reader";
import {
  CUSTOM_PROMPTS_STORAGE_KEY,
  canDispatchPendingAction,
  type CustomPrompt,
  DEFAULT_CUSTOM_PROMPTS,
  getPendingActionTabId,
  normalizeCustomPrompts,
  type PendingAction,
  POST_URL_PLACEHOLDER,
  toPendingPrompt,
} from "./pending-action";
import {
  normalizeDownloadRelativePath,
  shouldFallbackToDownloadsFromWorkspaceError,
} from "./save-path";
import {
  defaultAllowEvaluateAction,
  resolveAllowEvaluateAction,
} from "./evaluate-setting-policy";
import { parseBridgeCapabilities } from "./bridge-capabilities";
import {
  formatConnectionFailureDetail,
  formatChatError,
  TaskBlockedError,
} from "./connection-diagnostics";
import {
  buildPageContentUnavailableContext,
  isPageContentUnavailableContext,
} from "./page-content-diagnostics";
import { resolveSelectedCopilotModel } from "./copilot-model-selection";
import {
  isPrivateBrowserTab,
  assertPageShareAllowed,
  privateTabBlockedMessage,
  markPrivateBrowserTab,
  loadPersonalProfile,
  normalizePersonalProfile,
  personalValues,
  redactPrivateText,
} from "./personal-profile";
import { effectiveBrowserActions } from "../../standalone-bridge/src/chat-context";
import {
  actionUsesPersonalProfile,
  forgetDisplayEdits,
  hasUndoableDisplayEdit,
  recoverDisplayEdits,
  inspectButtonClick,
  undoLastDisplayEdit,
} from "./browser-execution";
import { readPageWithRecovery, type PageContextResult } from "./page-context";
import {
  canEditDisplay,
  DISPLAY_EDIT_ORIGINS_KEY,
  displayEditOrigin,
  normalizeDisplayEditOrigins,
} from "./display-edit-permission";

const DEFAULT_SETTINGS: LLMSettings = {
  provider: "auto",
  copilot: {
    model: "gpt-4o",
  },
  lmStudio: {
    endpoint: "http://localhost:1234",
    model: "",
  },
};

const DEFAULT_SAVE_RELATIVE_PATH = "output/blog";
const APPROVED_BUTTON_ORIGINS_KEY = "approvedButtonOriginsV1";
const HIGH_RISK_ACTION_TYPES: ReadonlySet<BrowserAction["type"]> = new Set([
  "newTab",
  "closeTab",
  "evaluate",
  "playwright",
  "upload",
  "handleDialog",
  "drag",
  "clickXY",
]);

function isHighRiskAction(action: BrowserAction): boolean {
  return HIGH_RISK_ACTION_TYPES.has(action.type);
}

function isLanguage(value: unknown): value is Language {
  return value === "ja" || value === "en";
}

function isOperationMode(value: unknown): value is OperationMode {
  return value === "text" || value === "hybrid" || value === "screenshot";
}

function usesCopilotModelProvider(provider: LLMSettings["provider"]): boolean {
  return (
    provider === "auto" ||
    provider === "copilot" ||
    provider === "copilot-agent"
  );
}

function supportsAutonomousLoopProvider(
  provider: LLMSettings["provider"],
): boolean {
  return [
    "auto",
    "copilot",
    "copilot-agent",
    "copilot-sdk",
    "copilot-cli",
    "lm-studio",
  ].includes(provider);
}

function isValidLlmSettings(value: unknown): value is LLMSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LLMSettings>;
  if (
    candidate.provider !== "auto" &&
    candidate.provider !== "copilot" &&
    candidate.provider !== "copilot-agent" &&
    candidate.provider !== "copilot-sdk" &&
    candidate.provider !== "copilot-cli" &&
    candidate.provider !== "lm-studio"
  ) {
    return false;
  }

  if (
    !candidate.copilot ||
    typeof candidate.copilot.model !== "string" ||
    !candidate.lmStudio ||
    typeof candidate.lmStudio.endpoint !== "string" ||
    typeof candidate.lmStudio.model !== "string"
  ) {
    return false;
  }

  return true;
}

function normalizeLoadedLlmSettings(settings: LLMSettings): LLMSettings {
  if (settings.provider === "copilot") {
    return { ...settings, provider: "copilot-agent" };
  }

  if (
    settings.provider === "copilot-sdk" ||
    settings.provider === "copilot-cli"
  ) {
    return { ...settings, provider: "auto" };
  }

  return settings;
}

export default function App() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [assistantSettings, setAssistantSettings] = useState(() =>
    normalizeAssistantSettings(null),
  );
  const pendingTaskRef = useRef<TaskOptions | undefined>(undefined);
  const isolatedTaskRef = useRef(false);
  const [pageState, setPageState] = useState<PageContextResult | null>(null);
  const pageStateRef = useRef<PageContextResult | null>(null);
  const [pageOrigin, setPageOrigin] = useState("");
  const [isReadingPage, setIsReadingPage] = useState(false);
  const readingPageRef = useRef(false);
  const [personalProfile, setPersonalProfile] = useState(() =>
    normalizePersonalProfile(null),
  );
  const personalProfileRef = useRef(personalProfile);
  const privacyReadyRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const [profileAuthorization, setProfileAuthorization] = useState("");
  const privateTabsRef = useRef(new Set<number>());
  useEffect(() => {
    privacyReadyRef.current = loadPersonalProfile()
      .then((profile) => {
        personalProfileRef.current = profile;
        setPersonalProfile(profile);
        return true;
      })
      .catch(() => false);
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);
  const savingAnswerRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showIssueReport, setShowIssueReport] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelFetchFailed, setModelFetchFailed] = useState(false);
  const [connectionErrorDetail, setConnectionErrorDetail] = useState<
    string | null
  >(null);
  const [modelFetchErrorDetail, setModelFetchErrorDetail] = useState<
    string | null
  >(null);
  const [bridgeCapabilities, setBridgeCapabilities] =
    useState<BridgeCapabilities | null>(null);
  const [capabilitiesErrorDetail, setCapabilitiesErrorDetail] = useState<
    string | null
  >(null);
  const [browserActionsEnabled, setBrowserActionsEnabled] = useState(true);
  const [clickApproval, setClickApproval] = useState<{
    origin: string;
    label: string;
    href?: string;
  } | null>(null);
  const [clickApprovalError, setClickApprovalError] = useState(false);
  const [savingClickApproval, setSavingClickApproval] = useState(false);
  const approvalCancelRef = useRef<HTMLButtonElement>(null);
  const clickApprovalResolver = useRef<((approved: boolean) => void) | null>(
    null,
  );
  useEffect(() => {
    if (!clickApproval) return;
    setClickApprovalError(false);
    const previousFocus = document.activeElement;
    approvalCancelRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [clickApproval]);
  const [approvedButtonOrigins, setApprovedButtonOrigins] = useState<
    Record<string, boolean>
  >({});
  useEffect(() => {
    void chrome.storage.local
      .get(APPROVED_BUTTON_ORIGINS_KEY)
      .then((stored) => {
        const value = stored[APPROVED_BUTTON_ORIGINS_KEY];
        if (value && typeof value === "object" && !Array.isArray(value))
          setApprovedButtonOrigins(value as Record<string, boolean>);
      });
    return () => {
      clickApprovalResolver.current?.(false);
    };
  }, []);
  const resolveClickApproval = (approved: boolean) => {
    clickApprovalResolver.current?.(approved);
    clickApprovalResolver.current = null;
    setClickApproval(null);
  };
  const [displayEditingEnabled, setDisplayEditingEnabled] = useState(false);
  const activeDisplayEditRef = useRef(false);
  const activeDisplayOriginRef = useRef("");
  const [displayEditOrigins, setDisplayEditOrigins] = useState<string[]>([]);
  const [displaySiteOrigin, setDisplaySiteOrigin] = useState("");
  const displaySiteOriginRef = useRef("");
  const displayOnceOriginRef = useRef("");
  const [displayPermissionReady, setDisplayPermissionReady] = useState(false);
  const [displayPermissionSaving, setDisplayPermissionSaving] = useState(false);
  const [displayPermissionError, setDisplayPermissionError] = useState(false);
  useEffect(() => {
    let disposed = false;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local" || !changes[DISPLAY_EDIT_ORIGINS_KEY]) return;
      const next = normalizeDisplayEditOrigins(
        changes[DISPLAY_EDIT_ORIGINS_KEY].newValue,
      );
      const previous = normalizeDisplayEditOrigins(
        changes[DISPLAY_EDIT_ORIGINS_KEY].oldValue,
      );
      if (
        previous.includes(activeDisplayOriginRef.current) &&
        !next.includes(activeDisplayOriginRef.current)
      ) {
        activeDisplayEditRef.current = false;
        abortControllerRef.current?.abort();
      }
      if (!disposed) setDisplayEditOrigins(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    void chrome.storage.local.get(DISPLAY_EDIT_ORIGINS_KEY).then(
      (stored) => {
        if (disposed) return;
        setDisplayEditOrigins(
          normalizeDisplayEditOrigins(stored[DISPLAY_EDIT_ORIGINS_KEY]),
        );
        setDisplayPermissionReady(true);
      },
      () => {
        if (!disposed) setDisplayPermissionError(true);
      },
    );
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  const saveDisplayPermission = async (origin: string, enabled: boolean) => {
    if (!origin || displayPermissionSaving) return false;
    setDisplayPermissionSaving(true);
    setDisplayPermissionError(false);
    try {
      const saved = await chrome.runtime.sendMessage({
        type: "display-edit",
        operation: "permission",
        origin,
        enabled,
      });
      if (!saved?.ok) throw new Error("Permission could not be saved");
      const next = normalizeDisplayEditOrigins(saved.origins);
      setDisplayEditOrigins(next);
      setDisplayPermissionReady(true);
      return true;
    } catch {
      setDisplayPermissionError(true);
      return false;
    } finally {
      setDisplayPermissionSaving(false);
    }
  };
  const [undoDisplayTabIds, setUndoDisplayTabIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  useEffect(() => {
    let disposed = false;
    const updateActiveTab = () => {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(
        ([tab]) => {
          if (!disposed) {
            setActiveTabId(tab?.id ?? null);
            const origin = displayEditOrigin(tab?.url);
            setDisplaySiteOrigin(origin);
            if (origin !== displaySiteOriginRef.current)
              setDisplayEditingEnabled(false);
            displaySiteOriginRef.current = origin;
            if (tab?.id !== undefined) {
              const tabId = tab.id;
              void recoverDisplayEdits(tabId)
                .then(() => {
                  if (disposed) return;
                  setUndoDisplayTabIds((previous) => {
                    const next = new Set(previous);
                    if (hasUndoableDisplayEdit(tabId)) next.add(tabId);
                    else next.delete(tabId);
                    return next;
                  });
                })
                .catch(() => undefined);
            }
            if (
              activeContentTabIdRef.current !== null &&
              tab?.id !== activeContentTabIdRef.current
            )
              abortControllerRef.current?.abort();
          }
        },
        () => {
          if (!disposed) setActiveTabId(null);
        },
      );
    };
    const onRemoved = (tabId: number) => {
      forgetDisplayEdits(tabId);
      setUndoDisplayTabIds((previous) => {
        if (!previous.has(tabId)) return previous;
        const next = new Set(previous);
        next.delete(tabId);
        return next;
      });
    };
    updateActiveTab();
    const onUpdated = (
      _tabId: number,
      change: Parameters<
        Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
      >[1],
    ) => {
      if (change.url) updateActiveTab();
    };
    chrome.tabs.onActivated.addListener(updateActiveTab);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(updateActiveTab);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, []);
  const [fileOperationsEnabled, setFileOperationsEnabled] = useState(true);
  const [language, setLanguage] = useState<Language>("ja");
  const [maxAgentLoops, setMaxAgentLoops] = useState(DEFAULT_AGENT_LOOPS);
  const [operationMode, setOperationMode] = useState<OperationMode>("hybrid");
  const [serverPort, setServerPort] = useState(DEFAULT_SERVER_PORT);
  const [allowHighRiskActions, setAllowHighRiskActions] = useState(true);
  const [allowEvaluateAction, setAllowEvaluateAction] = useState(
    defaultAllowEvaluateAction(),
  );
  const [saveDestinationMode, setSaveDestinationMode] =
    useState<SaveDestinationMode>("browser-downloads");
  const [saveRelativePath, setSaveRelativePath] = useState(
    DEFAULT_SAVE_RELATIVE_PATH,
  );
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>(() =>
    DEFAULT_CUSTOM_PROMPTS.map((prompt) => ({ ...prompt })),
  );
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightRequestRef = useRef(false);
  const screenshotPermissionWarnedRef = useRef(false);
  const screenshotFallbackWarnedRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const pendingPromptDispatchRef = useRef<string | null>(null);
  const pendingPromptTabIdRef = useRef<number | null>(null);
  const activeContentTabIdRef = useRef<number | null>(null);
  const languageRef = useRef<Language>("ja");

  // Load settings from storage
  useEffect(() => {
    chrome.storage.local.get(
      [
        "llmSettings",
        "browserActionsEnabled",
        "fileOperationsEnabled",
        "language",
        "maxAgentLoops",
        "operationMode",
        "serverPort",
        "allowHighRiskActions",
        "allowEvaluateAction",
        "saveDestinationMode",
        "saveRelativePath",
        CUSTOM_PROMPTS_STORAGE_KEY,
        ASSISTANT_SETTINGS_KEY,
        "pendingAction",
      ],
      (result: {
        llmSettings?: LLMSettings;
        browserActionsEnabled?: boolean;
        fileOperationsEnabled?: boolean;
        language?: Language;
        maxAgentLoops?: number;
        operationMode?: OperationMode;
        serverPort?: number;
        allowHighRiskActions?: boolean;
        allowEvaluateAction?: boolean;
        saveDestinationMode?: SaveDestinationMode;
        saveRelativePath?: string;
        customPrompts?: unknown;
        assistantSettingsV1?: unknown;
        pendingAction?: PendingAction;
      }) => {
        let effectiveServerPort = DEFAULT_SERVER_PORT;
        setAssistantSettings(
          normalizeAssistantSettings(result.assistantSettingsV1),
        );
        let effectiveAllowEvaluateAction = defaultAllowEvaluateAction();
        const effectiveLanguage = isLanguage(result.language)
          ? result.language
          : language;

        if (isValidLlmSettings(result.llmSettings)) {
          setSettings(normalizeLoadedLlmSettings(result.llmSettings));
        }
        if (result.browserActionsEnabled !== undefined) {
          setBrowserActionsEnabled(result.browserActionsEnabled);
        }
        if (result.fileOperationsEnabled !== undefined) {
          setFileOperationsEnabled(result.fileOperationsEnabled);
        }
        if (isLanguage(result.language)) {
          setLanguage(result.language);
        }
        if (result.maxAgentLoops !== undefined) {
          setMaxAgentLoops(clampAgentLoops(result.maxAgentLoops));
        }
        if (isOperationMode(result.operationMode)) {
          setOperationMode(result.operationMode);
        }
        if (result.serverPort !== undefined) {
          effectiveServerPort = normalizeServerPort(result.serverPort);
          setServerPort(effectiveServerPort);
        }
        if (typeof result.allowHighRiskActions === "boolean") {
          setAllowHighRiskActions(result.allowHighRiskActions);
        }
        effectiveAllowEvaluateAction = resolveAllowEvaluateAction({
          storedValue: result.allowEvaluateAction,
          shouldForceFullAutoMigration: false,
        });
        setAllowEvaluateAction(effectiveAllowEvaluateAction);
        if (
          result.saveDestinationMode === "browser-downloads" ||
          result.saveDestinationMode === "workspace-relative"
        ) {
          setSaveDestinationMode(result.saveDestinationMode);
        }
        if (typeof result.saveRelativePath === "string") {
          setSaveRelativePath(
            result.saveRelativePath || DEFAULT_SAVE_RELATIVE_PATH,
          );
        }

        if (result.customPrompts !== undefined) {
          setCustomPrompts(normalizeCustomPrompts(result.customPrompts));
        }

        setEvaluateActionEnabled(effectiveAllowEvaluateAction);

        const nextPendingPrompt = toPendingPrompt(
          result.pendingAction,
          effectiveLanguage,
        );
        if (nextPendingPrompt) {
          pendingTaskRef.current =
            result.pendingAction?.type === "post"
              ? { kind: "post", instructions: nextPendingPrompt }
              : result.pendingAction?.type === "customPrompt"
                ? { kind: "custom", instructions: nextPendingPrompt }
                : { kind: "summary" };
          pendingPromptTabIdRef.current = getPendingActionTabId(
            result.pendingAction,
          );
          setPendingPrompt(nextPendingPrompt);
        }

        settingsLoadedRef.current = true;
        void checkConnection(effectiveServerPort);
      },
    );
  }, []);

  // Listen for pendingAction changes (e.g. right-click context menu invoked
  // while the side panel is already open). Without this, the initial mount
  // useEffect only reads pendingAction once, so subsequent context-menu
  // triggers are silently dropped.
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local") {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(changes, "pendingAction")) {
        return;
      }
      const newValue = changes.pendingAction?.newValue;
      // Ignore removals (our own cleanup after dispatch).
      if (newValue === undefined || newValue === null) {
        return;
      }
      const prompt = toPendingPrompt(newValue, languageRef.current);
      if (prompt) {
        const pendingType = (newValue as PendingAction).type;
        pendingTaskRef.current =
          pendingType === "post"
            ? { kind: "post", instructions: prompt }
            : pendingType === "customPrompt"
              ? { kind: "custom", instructions: prompt }
              : { kind: "summary" };
        pendingPromptTabIdRef.current = getPendingActionTabId(newValue);
        setPendingPrompt(prompt);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => {
      chrome.storage.onChanged.removeListener(handler);
    };
  }, []);

  // Save settings to storage
  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return;
    }

    chrome.storage.local.set({
      llmSettings: settings,
      browserActionsEnabled,
      fileOperationsEnabled,
      language,
      maxAgentLoops,
      operationMode,
      serverPort,
      allowHighRiskActions,
      allowEvaluateAction,
      saveDestinationMode,
      saveRelativePath,
      [CUSTOM_PROMPTS_STORAGE_KEY]: customPrompts,
      [ASSISTANT_SETTINGS_KEY]: assistantSettings,
    });
  }, [
    settings,
    browserActionsEnabled,
    fileOperationsEnabled,
    language,
    maxAgentLoops,
    operationMode,
    serverPort,
    allowHighRiskActions,
    allowEvaluateAction,
    saveDestinationMode,
    saveRelativePath,
    customPrompts,
    assistantSettings,
  ]);

  useEffect(() => {
    setEvaluateActionEnabled(allowEvaluateAction);
  }, [allowEvaluateAction]);

  const getBridgeBaseUrl = (overridePort?: number) => {
    const targetPort = normalizeServerPort(overridePort ?? serverPort);
    return `http://127.0.0.1:${targetPort}`;
  };

  const getExtensionOrigin = () => {
    return chrome.runtime?.id
      ? `chrome-extension://${chrome.runtime.id}`
      : "chrome-extension://unknown";
  };

  const checkConnection = async (overridePort?: number) => {
    console.log("checkConnection called");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${getBridgeBaseUrl(overridePort)}/health`, {
        headers: BRIDGE_CLIENT_HEADERS,
        signal: controller.signal,
      });
      const connected = response.ok;
      console.log("Connection status:", connected);
      setIsConnected(connected);
      if (connected) {
        setConnectionErrorDetail(null);
        setModelFetchFailed(false);
        void fetchAvailableModels(overridePort);
        void fetchBridgeCapabilities(overridePort);
      } else {
        setAvailableModels([]);
        setBridgeCapabilities(null);
        setCapabilitiesErrorDetail(null);
        setModelFetchFailed(false);
        setModelFetchErrorDetail(null);
        setConnectionErrorDetail(
          formatConnectionFailureDetail({
            port: normalizeServerPort(overridePort ?? serverPort),
            statusCode: response.status,
            statusText: response.statusText,
            language,
          }),
        );
      }
    } catch (error) {
      console.log("Connection failed:", error);
      setIsConnected(false);
      setAvailableModels([]);
      setBridgeCapabilities(null);
      setCapabilitiesErrorDetail(null);
      setModelFetchFailed(false);
      setModelFetchErrorDetail(null);
      setConnectionErrorDetail(
        formatConnectionFailureDetail({
          port: normalizeServerPort(overridePort ?? serverPort),
          error: error instanceof Error ? error.message : String(error),
          language,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const fetchAvailableModels = async (overridePort?: number) => {
    try {
      const result = await fetchModelsWithRetry({
        baseUrl: getBridgeBaseUrl(overridePort),
        headers: BRIDGE_CLIENT_HEADERS,
        extensionOrigin: getExtensionOrigin(),
      });

      if (result.ok) {
        setAvailableModels(result.models);
        setModelFetchFailed(false);
        setModelFetchErrorDetail(null);
        setSettings((currentSettings) => {
          if (!usesCopilotModelProvider(currentSettings.provider)) {
            return currentSettings;
          }

          const resolvedModel = resolveSelectedCopilotModel(
            currentSettings.copilot.model,
            result.models,
          );

          if (resolvedModel === currentSettings.copilot.model) {
            return currentSettings;
          }

          return {
            ...currentSettings,
            copilot: {
              ...currentSettings.copilot,
              model: resolvedModel,
            },
          };
        });
      } else {
        setAvailableModels([]);
        setModelFetchFailed(true);
        setModelFetchErrorDetail(result.errorDetail);
        console.error("Failed to fetch models", result.errorDetail);
      }
    } catch (error) {
      setAvailableModels([]);
      setModelFetchFailed(true);
      setModelFetchErrorDetail(
        error instanceof Error ? error.message : String(error),
      );
      console.error("Failed to fetch models");
    }
  };

  const fetchBridgeCapabilities = async (overridePort?: number) => {
    try {
      const response = await fetch(
        `${getBridgeBaseUrl(overridePort)}/capabilities`,
        { headers: BRIDGE_CLIENT_HEADERS },
      );

      if (!response.ok) {
        setBridgeCapabilities(null);
        setCapabilitiesErrorDetail(
          `Capabilities request failed (${response.status} ${response.statusText})`,
        );
        return;
      }

      const payload = parseBridgeCapabilities(await response.json());
      if (!payload) {
        setBridgeCapabilities(null);
        setCapabilitiesErrorDetail(
          "Capabilities response had an invalid shape",
        );
        return;
      }

      setBridgeCapabilities(payload);
      setCapabilitiesErrorDetail(null);
    } catch (error) {
      setBridgeCapabilities(null);
      setCapabilitiesErrorDetail(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const buildBridgeHttpError = async (response: Response) => {
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {
      detail = "";
    }

    const summary = `Bridge request failed (${response.status} ${response.statusText})`;
    return detail ? `${summary}: ${detail}` : summary;
  };

  const handleServerPortChange = (nextPort: number) => {
    const normalizedPort = normalizeServerPort(nextPort);
    setServerPort(normalizedPort);
    chrome.storage.local.set({ serverPort: normalizedPort });
    void checkConnection(normalizedPort);
  };

  const postFileOperation = async (
    action: "create" | "append",
    path: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch(`${getBridgeBaseUrl()}/file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...BRIDGE_CLIENT_HEADERS,
        },
        body: JSON.stringify({
          action,
          path,
          content,
        }),
      });

      if (response.ok) {
        return { ok: true };
      }

      const payload = (await response.text()).trim();
      try {
        const parsed = JSON.parse(payload) as { error?: string };
        return {
          ok: false,
          error: parsed.error || payload || response.statusText,
        };
      } catch {
        return { ok: false, error: payload || response.statusText };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const withTimestampSuffix = (path: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const lastSlash = path.lastIndexOf("/");
    const directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
    const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const lastDot = filename.lastIndexOf(".");
    if (lastDot <= 0) {
      return `${directory}${filename}-${timestamp}`;
    }
    return `${directory}${filename.slice(0, lastDot)}-${timestamp}${filename.slice(lastDot)}`;
  };

  const saveTextArtifact = async (options: {
    relativePath: string;
    content: string;
    mimeType?: string;
  }) => {
    const normalizedPath = normalizeDownloadRelativePath(options.relativePath);

    if (saveDestinationMode === "workspace-relative") {
      let targetPath = normalizedPath;
      let workspaceResult = await postFileOperation(
        "create",
        targetPath,
        options.content,
      );

      if (
        !workspaceResult.ok &&
        workspaceResult.error?.includes("File already exists")
      ) {
        targetPath = withTimestampSuffix(targetPath);
        workspaceResult = await postFileOperation(
          "create",
          targetPath,
          options.content,
        );
      }

      if (workspaceResult.ok) {
        return {
          success: true,
          filename: targetPath,
          destinationMessage: t("savedToWorkspace", language),
        };
      }

      if (shouldFallbackToDownloadsFromWorkspaceError(workspaceResult.error)) {
        const downloadResult = await downloadTextFile(
          normalizedPath,
          options.content,
          options.mimeType || "text/markdown;charset=utf-8",
        );
        return {
          success: downloadResult.success,
          filename: downloadResult.filename,
          downloadId: downloadResult.downloadId,
          error: downloadResult.error,
          destinationMessage: t("savedToDownloads", language),
        };
      }

      return {
        success: false,
        filename: normalizedPath,
        error: localizeFileOperationError(workspaceResult.error, {
          invalidPath: t("saveFailureInvalidPath", language),
          pathEscapesWorkspace: t("saveFailurePathEscapesWorkspace", language),
          notAFile: t("saveFailureNotAFile", language),
          fileAlreadyExists: t("saveFailureFileAlreadyExists", language),
        }),
      };
    }

    const downloadResult = await downloadTextFile(
      normalizedPath,
      options.content,
      options.mimeType || "text/markdown;charset=utf-8",
    );

    return {
      success: downloadResult.success,
      filename: downloadResult.filename,
      downloadId: downloadResult.downloadId,
      error: downloadResult.error,
      destinationMessage: t("savedToDownloads", language),
    };
  };

  const getCurrentPageMetadata = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return {
      pageTitle: tab?.title || "Untitled Page",
      pageUrl: tab?.url || "",
    };
  };

  const pushSaveResultMessage = (result: {
    success: boolean;
    filename: string;
    error?: string;
    downloadId?: number;
    destinationMessage?: string;
  }) => {
    if (result.success) {
      const showLink = result.downloadId
        ? ` ([${t("showInFolder", language)}](download-show:${result.downloadId}))`
        : "";
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          role: "assistant",
          content: `📥 ${t("saveSuccess", language).replace("{path}", result.filename)}${showLink}\n\n📂 ${result.destinationMessage}`,
          kind: "notice",
        },
      ]);
      return;
    }

    setMessages((prev: ChatMessage[]) => [
      ...prev,
      {
        role: "assistant",
        content: `⚠️ ${t("saveFailure", language).replace("{reason}", result.error || t("saveFailureUnknownReason", language))}`,
        kind: "error",
      },
    ]);
  };

  const saveAssistantMarkdown = async (
    kind: "summary" | "blog-draft",
    message: ChatMessage,
  ) => {
    if (savingAnswerRef.current) return false;
    const artifact = getAnswerArtifactInput(message);
    if (!artifact) {
      pushSaveResultMessage({
        success: false,
        filename: "",
        error: t("saveFailureNoAssistantResponse", language),
      });
      return false;
    }

    savingAnswerRef.current = true;
    setIsSavingAnswer(true);
    try {
      const { pageTitle, createdAt } = artifact;
      const relativePath = buildArtifactRelativePath(
        saveRelativePath || DEFAULT_SAVE_RELATIVE_PATH,
        pageTitle,
        kind,
        createdAt,
        crypto.randomUUID(),
      );

      const content =
        kind === "blog-draft"
          ? buildBlogDraftContent(artifact)
          : buildSavedMarkdownContent(artifact);

      const result = await saveTextArtifact({
        relativePath,
        content,
        mimeType: "text/markdown;charset=utf-8",
      });
      pushSaveResultMessage(result);
      return result.success;
    } catch {
      pushSaveResultMessage({
        success: false,
        filename: "",
        error: t("saveFailureUnknownReason", language),
      });
      return false;
    } finally {
      savingAnswerRef.current = false;
      setIsSavingAnswer(false);
    }
  };

  const maybeWarnScreenshotPermission = (error: unknown) => {
    if (screenshotPermissionWarnedRef.current) return;
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("SCREENSHOT_PERMISSION") ||
      message.includes("activeTab")
    ) {
      screenshotPermissionWarnedRef.current = true;
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          role: "assistant",
          content: t("screenshotPermissionWarning", language),
          kind: "notice",
        },
      ]);
    }
  };

  const captureScreenshotForActiveContentTab = async (): Promise<string> => {
    if (Object.keys(personalValues(personalProfileRef.current)).length > 0)
      return "";
    const targetTabId = activeContentTabIdRef.current;
    if (targetTabId !== null && privateTabsRef.current.has(targetTabId))
      return "";
    if (typeof targetTabId === "number") {
      const tab = await chrome.tabs.get(targetTabId).catch(() => undefined);
      if (!tab?.active) {
        return "";
      }
    }

    return await captureScreenshot(targetTabId ?? undefined);
  };

  const extractPageContent = async (options?: {
    mode?: "interactive" | "content";
    autoScrollForLazyLoad?: boolean;
    displayEditing?: boolean;
  }): Promise<string> => {
    try {
      const targetTabId = activeContentTabIdRef.current;
      const tab =
        typeof targetTabId === "number"
          ? await chrome.tabs.get(targetTabId).catch(() => undefined)
          : (
              await chrome.tabs.query({
                active: true,
                currentWindow: true,
              })
            )[0];
      if (!tab?.id || !tab.url) {
        pageStateRef.current = {
          status: "failed",
          content: "",
          frames: [],
          capturedAt: Date.now(),
        };
        setPageState(pageStateRef.current);
        return buildPageContentUnavailableContext({
          lang: languageRef.current,
          reason: "no-tab",
        });
      }

      setPageOrigin(
        /^https?:\/\//.test(tab.url) ? new URL(tab.url).origin : "",
      );
      // chrome://, edge://, about: などのシステムページはスキップ
      if (
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:") ||
        tab.url.startsWith("chrome-extension://")
      ) {
        pageStateRef.current = {
          status: "unsupported",
          content: "",
          frames: [],
          capturedAt: Date.now(),
        };
        setPageState(pageStateRef.current);
        return buildPageContentUnavailableContext({
          lang: languageRef.current,
          reason: "unsupported-page",
          url: tab.url,
          title: tab.title,
        });
      }

      const mode = options?.mode ?? "interactive";
      const autoScrollForLazyLoad = options?.autoScrollForLazyLoad ?? false;
      const displayEditing =
        options?.displayEditing ?? activeDisplayEditRef.current;

      const injection = {
        target: { tabId: tab.id, allFrames: true },
        func: async (opts: {
          mode: "interactive" | "content";
          autoScrollForLazyLoad: boolean;
          displayEditing: boolean;
        }) => {
          const VIEWPORT_MARGIN_PX = 200;
          const MAX_VIEWPORT_CHARS = 12000;
          const MAX_FULL_CHARS = 45000;
          if (!document.body)
            return {
              text: "",
              elements: "",
              textLength: 0,
              elementCount: 0,
              url: location.href,
              title: document.title,
            };
          const roots: (Document | ShadowRoot)[] = [document];
          for (
            let rootIndex = 0;
            rootIndex < roots.length && roots.length < 100;
            rootIndex++
          ) {
            roots[rootIndex].querySelectorAll("*").forEach((element) => {
              if (element.shadowRoot && roots.length < 100)
                roots.push(element.shadowRoot);
            });
          }
          const queryAll = (selector: string) =>
            roots.flatMap((root) =>
              Array.from(root.querySelectorAll(selector)),
            );

          const shouldRejectParent = (parent: HTMLElement) => {
            const tag = parent.tagName;
            if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(tag)) {
              return true;
            }
            // Avoid password fields
            if (
              parent instanceof HTMLInputElement &&
              parent.type === "password"
            ) {
              return true;
            }
            const style = getComputedStyle(parent);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              !parent.getClientRects().length
            ) {
              return true;
            }
            return false;
          };

          const collectText = (
            onlyViewport: boolean,
            maxChars: number,
          ): string => {
            const chunks: string[] = [];
            let total = 0;
            for (const root of roots) {
              const walker = document.createTreeWalker(
                root === document
                  ? opts.mode === "content"
                    ? document.querySelector("article, main, [role='main']") ||
                      document.body
                    : document.body
                  : root,
                NodeFilter.SHOW_TEXT,
                {
                  acceptNode: (node) => {
                    const parent = node.parentElement as HTMLElement | null;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (shouldRejectParent(parent))
                      return NodeFilter.FILTER_REJECT;

                    if (onlyViewport) {
                      const rect = parent.getBoundingClientRect();
                      const within =
                        rect.bottom >= -VIEWPORT_MARGIN_PX &&
                        rect.top <= window.innerHeight + VIEWPORT_MARGIN_PX;
                      if (!within) return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                  },
                },
              );

              let node: Node | null;
              while ((node = walker.nextNode())) {
                const text = node.textContent?.trim();
                if (!text) continue;
                if (text.length === 0) continue;

                chunks.push(text);
                total += text.length + 1;
                if (total >= maxChars) break;
              }
              if (total >= maxChars) break;
            }

            return chunks.join("\n").slice(0, maxChars);
          };

          const autoScrollToLoad = async () => {
            const startY = window.scrollY;
            const step = Math.max(300, Math.floor(window.innerHeight * 0.9));
            let lastY = -1;
            for (let i = 0; i < 30; i++) {
              window.scrollBy(0, step);
              await new Promise((r) => setTimeout(r, 200));
              if (Math.abs(window.scrollY - lastY) < 2) break;
              lastY = window.scrollY;
              if (
                window.innerHeight + window.scrollY >=
                document.documentElement.scrollHeight - 2
              ) {
                break;
              }
            }
            window.scrollTo(0, startY);
            await new Promise((r) => setTimeout(r, 100));
          };

          if (opts.mode === "content" && opts.autoScrollForLazyLoad) {
            await autoScrollToLoad();
          }

          const scrollInfo = `ScrollY: ${Math.round(window.scrollY)} / ${Math.round(document.documentElement.scrollHeight)} (vh=${Math.round(window.innerHeight)})`;

          // Put viewport text first so the VS Code side (which may slice) keeps the most relevant content.
          const viewportText = collectText(true, MAX_VIEWPORT_CHARS);
          const fullText =
            opts.mode === "content" ? collectText(false, MAX_FULL_CHARS) : "";

          const selectedText =
            opts.mode === "content" ? fullText || viewportText : viewportText;
          const pageText = `${scrollInfo}\n${selectedText}`;

          // Playwright-style snapshot: structured element tree
          const elements: string[] = [];
          let refCounter = 0;
          const refMap = new Map<Element, string>();
          const maxRefs = 120; // prioritize current viewport but allow more overall

          // Helper: check if element is visible
          const isVisible = (el: Element): boolean => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const style = getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            )
              return false;
            return true;
          };

          // Helper: get element role and name
          const getElementInfo = (
            el: Element,
          ): { role: string; name: string; inputLike?: HTMLInputElement } => {
            const tag = el.tagName.toLowerCase();
            const explicitRole = el.getAttribute("role");
            const labelEl = tag === "label" ? (el as HTMLLabelElement) : null;
            const associatedInput =
              labelEl?.control ||
              (labelEl?.querySelector(
                "input, select, textarea",
              ) as HTMLInputElement | null);
            const inputEl = (associatedInput || el) as HTMLInputElement;
            const type = inputEl?.type || "";
            const ariaLabel = el.getAttribute("aria-label") || "";
            const text =
              (el as HTMLElement).textContent?.trim().slice(0, 40) || "";
            const placeholder = el.getAttribute("placeholder") || "";
            const value = ["radio", "checkbox", "button", "submit"].includes(
              type,
            )
              ? inputEl?.value?.slice(0, 20) || ""
              : "";
            const title = el.getAttribute("title") || "";

            // Determine role
            let role = explicitRole || "";
            if (!role) {
              if (tag === "button" || type === "button" || type === "submit")
                role = "button";
              else if (tag === "a") role = "link";
              else if (type === "radio") role = "radio";
              else if (type === "checkbox") role = "checkbox";
              else if (tag === "input") role = "textbox";
              else if (tag === "select") role = "combobox";
              else if (tag === "textarea") role = "textbox";
              else if (tag === "label" && type) role = type;
              else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag))
                role = "heading";
              else role = tag;
            }

            // Determine name
            let name = ariaLabel || title || "";
            if (!name) {
              if (role === "textbox")
                name =
                  inputEl.labels?.[0]?.textContent?.trim().slice(0, 60) ||
                  placeholder ||
                  inputEl.name ||
                  "Input";
              else if (role === "radio" || role === "checkbox")
                name = ariaLabel || text || value;
              else name = text.slice(0, 30);
            }

            return { role, name, inputLike: inputEl || undefined };
          };

          // Collect interactive elements in document order
          const interactiveSelectors = [
            "button",
            "a[href]",
            "input",
            "select",
            "textarea",
            "label",
            '[role="button"]',
            '[role="radio"]',
            '[role="checkbox"]',
            '[role="link"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="menuitemcheckbox"]',
            '[role="menuitemradio"]',
            '[role="option"]',
            '[aria-checked="true"]',
            '[aria-checked="false"]',
            '[aria-pressed="true"]',
            '[aria-pressed="false"]',
            "[onclick]",
            '[tabindex]:not([tabindex="-1"])',
            '[contenteditable="true"]',
          ];

          // Group elements by their parent group/fieldset for context
          const groups = new Map<
            string,
            { label: string; elements: string[] }
          >();
          let currentGroup = "main";

          const candidates: Array<{ el: Element; rect: DOMRect }> = [];
          const seen = new Set<Element>();

          queryAll(interactiveSelectors.join(", ")).forEach((el) => {
            if (!isVisible(el)) return;
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            candidates.push({ el, rect });
          });

          if (opts.mode === "interactive" && opts.displayEditing) {
            queryAll(
              "h1, h2, h3, h4, p, span, div, td, th, li, strong, em, small, dt, dd",
            ).forEach((el) => {
              const text = el.textContent?.trim() ?? "";
              if (
                seen.has(el) ||
                el.children.length ||
                !text ||
                text.length > 160 ||
                !isVisible(el) ||
                el.closest(
                  "a, button, form, [contenteditable], [role='button'], [role='link']",
                )
              )
                return;
              seen.add(el);
              candidates.push({ el, rect: el.getBoundingClientRect() });
            });
          }

          // Add pointer-cursor elements (often clickable divs/spans)
          queryAll("*").forEach((el) => {
            if (!isVisible(el)) return;
            const style = getComputedStyle(el);
            if (style.cursor === "pointer") {
              if (seen.has(el)) return;
              seen.add(el);
              const rect = el.getBoundingClientRect();
              candidates.push({ el, rect });
            }
          });

          // Prioritize elements near the current viewport so refs map to what user sees
          const viewportTop = -200;
          const viewportBottom = window.innerHeight + 400;

          queryAll("[data-copilot-ref]").forEach((element) =>
            element.removeAttribute("data-copilot-ref"),
          );

          candidates
            .sort((a, b) => a.rect.top - b.rect.top)
            .sort((a, b) => {
              const aIn =
                a.rect.top <= viewportBottom && a.rect.bottom >= viewportTop;
              const bIn =
                b.rect.top <= viewportBottom && b.rect.bottom >= viewportTop;
              if (aIn === bIn) return 0;
              return aIn ? -1 : 1;
            })
            .forEach(({ el }) => {
              if (refCounter >= maxRefs) return;
              const refId = `e${refCounter++}`;
              el.setAttribute("data-copilot-ref", refId);
              refMap.set(el, refId);

              const { role, name, inputLike } = getElementInfo(el);

              // Check if in a fieldset/group
              const fieldset = el.closest(
                'fieldset, [role="group"], [role="radiogroup"]',
              );
              if (fieldset) {
                const legend =
                  fieldset.querySelector("legend")?.textContent?.trim() ||
                  fieldset.getAttribute("aria-label") ||
                  (fieldset.getAttribute("aria-labelledby") &&
                    document
                      .getElementById(fieldset.getAttribute("aria-labelledby")!)
                      ?.textContent?.trim()) ||
                  "";
                if (legend && legend !== currentGroup) {
                  currentGroup = legend.slice(0, 50);
                  if (!groups.has(currentGroup)) {
                    groups.set(currentGroup, {
                      label: currentGroup,
                      elements: [],
                    });
                  }
                }
              }

              // Build element description
              const checked = inputLike?.checked ? " [checked]" : "";
              const disabled = inputLike?.disabled ? " [disabled]" : "";
              const desc = `[${refId}] ${role}${checked}${disabled} "${name}"`;

              if (groups.has(currentGroup)) {
                groups.get(currentGroup)!.elements.push(desc);
              } else {
                elements.push(desc);
              }
            });

          // Build output
          let output = "";

          // Add ungrouped elements
          if (elements.length > 0) {
            output += `### Main Elements\n`;
            elements.forEach((e) => (output += e + "\n"));
          }

          // Add grouped elements
          groups.forEach((group, label) => {
            if (group.elements.length > 0) {
              output += `\n### ${label}\n`;
              group.elements.forEach((e) => (output += "  " + e + "\n"));
            }
          });

          return {
            text: pageText,
            elements: opts.mode === "content" ? "" : output,
            textLength: selectedText.trim().length,
            elementCount: opts.mode === "content" ? 0 : refMap.size,
            url: location.href,
            title: document.title,
          };
        },
        args: [{ mode, autoScrollForLazyLoad, displayEditing }] as [
          {
            mode: "interactive" | "content";
            autoScrollForLazyLoad: boolean;
            displayEditing: boolean;
          },
        ],
      };
      let partialFrames = false;
      const result = await readPageWithRecovery(
        async () => {
          try {
            return await chrome.scripting.executeScript(injection);
          } catch {
            partialFrames = true;
            return await chrome.scripting.executeScript({
              ...injection,
              target: { tabId: tab.id! },
            });
          }
        },
        async () => {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            func: () =>
              new Promise<void>((resolve) => {
                const observer = new MutationObserver(() => finish());
                const timer = setTimeout(() => finish(), 700);
                const finish = () => {
                  clearTimeout(timer);
                  observer.disconnect();
                  resolve();
                };
                observer.observe(document.documentElement, {
                  subtree: true,
                  childList: true,
                  characterData: true,
                });
              }),
          });
        },
      );
      if (partialFrames && result.status === "ok") result.status = "partial";
      pageStateRef.current = result;
      setPageState(result);
      return (
        result.content ||
        buildPageContentUnavailableContext({
          lang: languageRef.current,
          reason: "script-injection-failed",
          url: tab.url,
          title: tab.title,
          detail: result.status,
        })
      );
    } catch (error) {
      console.warn("Failed to extract page content:", error);
      pageStateRef.current = {
        status: "failed",
        content: "",
        frames: [],
        capturedAt: Date.now(),
      };
      setPageState(pageStateRef.current);
      const targetTabId = activeContentTabIdRef.current;
      const tab =
        typeof targetTabId === "number"
          ? await chrome.tabs.get(targetTabId).catch(() => undefined)
          : undefined;
      return buildPageContentUnavailableContext({
        lang: languageRef.current,
        reason: "script-injection-failed",
        url: tab?.url,
        title: tab?.title,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const sendMessage = async (
    userMessage: string,
    attachments: ChatAttachment[] = [],
    task?: TaskOptions,
  ) => {
    if (
      !userMessage.trim() ||
      isLoading ||
      readingPageRef.current ||
      inFlightRequestRef.current
    )
      return;

    inFlightRequestRef.current = true;
    let editingForRun = false;
    let displayTaskId = "";
    const displayLookupSupported =
      bridgeCapabilities?.displayTextLookupVersion === 1;
    const history = task || isolatedTaskRef.current ? [] : messages;
    isolatedTaskRef.current = Boolean(task);

    // ポストのクイックアクション等で埋め込まれたURLプレースホルダを、
    // 現在ページの実URLへ決定論的に置換する（モデルにURLを創作させない）。
    let resolvedMessage = userMessage;
    if (resolvedMessage.includes(POST_URL_PLACEHOLDER)) {
      let pageUrl = "";
      try {
        ({ pageUrl } = await getCurrentPageMetadata());
      } catch {
        pageUrl = "";
      }
      resolvedMessage = resolvedMessage
        .split(POST_URL_PLACEHOLDER)
        .join(pageUrl);
    }

    const wantsContentOnly =
      Boolean(task) ||
      /\b(translate|translation|summarize|summary)\b/i.test(resolvedMessage) ||
      /(翻訳|要約|まとめ|全文|全内容|全部|記事|英文に)/.test(resolvedMessage);
    const autoScrollForLazyLoad = /(全文|全内容|全部|記事全体|最後まで)/.test(
      resolvedMessage,
    );

    const newUserMessage: ChatMessage = {
      role: "user",
      content: `${resolvedMessage}${buildAttachmentDisplayText(attachments, {
        heading: t("attachedFiles", language),
        pdfNote: t("pdfAttachmentFallback", language),
        textLabel: t("attachmentTextLabel", language),
        imageLabel: t("attachmentImageLabel", language),
      })}`.trim(),
    };

    setMessages([...history, newUserMessage]);
    setIsLoading(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Get page content based on operation mode
      if (!(await privacyReadyRef.current))
        throw new TaskBlockedError(
          "Privacy settings could not be loaded. Reload the extension before sending page information.",
        );
      const profileForRun = personalProfileRef.current;
      if (bridgeCapabilities?.contextVersion !== 1)
        throw new TaskBlockedError(
          "The connected bridge does not support assistant instructions and browser policy. Update/rebuild the bridge, restart it, and refresh its capabilities in Settings.",
        );
      let pageContent = "";
      let screenshotBase64 = "";
      const targetTab =
        activeContentTabIdRef.current !== null
          ? await chrome.tabs.get(activeContentTabIdRef.current)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      activeContentTabIdRef.current = targetTab?.id ?? null;
      const storedDisplayPermission = displayPermissionReady
        ? await chrome.storage.local.get(DISPLAY_EDIT_ORIGINS_KEY)
        : {};
      editingForRun = canEditDisplay({
        url: targetTab?.url,
        mode: assistantSettings.mode,
        browserActionsEnabled,
        task: Boolean(task),
        once:
          displayPermissionReady &&
          displayEditingEnabled &&
          displayOnceOriginRef.current === displayEditOrigin(targetTab?.url),
        origins: normalizeDisplayEditOrigins(
          storedDisplayPermission[DISPLAY_EDIT_ORIGINS_KEY],
        ),
      });
      activeDisplayEditRef.current = editingForRun;
      activeDisplayOriginRef.current = displayEditOrigin(targetTab?.url);
      if (
        targetTab?.id !== undefined &&
        (privateTabsRef.current.has(targetTab.id) ||
          (await isPrivateBrowserTab(targetTab.id)))
      )
        throw new TaskBlockedError(privateTabBlockedMessage(language));
      if (editingForRun && displayLookupSupported) {
        const started = await chrome.runtime.sendMessage({
          type: "display-edit",
          operation: "start",
          tabId: targetTab?.id,
          url: targetTab?.url,
          once:
            displayEditingEnabled &&
            displayOnceOriginRef.current === displayEditOrigin(targetTab?.url),
        });
        if (!started?.ok || typeof started.taskId !== "string")
          throw new TaskBlockedError(
            language === "ja"
              ? "表示編集の許可を確認できませんでした。選び直してください。"
              : "Display editing permission could not be verified. Select it again.",
          );
        displayTaskId = started.taskId;
      }
      const personalForRun =
        !task &&
        assistantSettings.mode !== "read-only" &&
        targetTab?.url &&
        profileAuthorization === new URL(targetTab.url).origin &&
        Object.keys(personalValues(profileForRun)).length > 0
          ? personalValues(profileForRun)
          : undefined;
      setProfileAuthorization("");
      const redact = (text: string) => redactPrivateText(text, profileForRun);
      const cleanMessages = (items: ChatMessage[]) =>
        items.map((message) => ({
          role: message.role,
          content: redact(message.content),
        }));

      if (operationMode === "screenshot") {
        // Screenshot mode: capture screenshot + DOM elements for ref-based clicking
        try {
          screenshotBase64 = await captureScreenshotForActiveContentTab();
          // Also get DOM elements for ref-based clicking
          const domContent = await extractPageContent({ mode: "interactive" });
          pageContent = screenshotBase64
            ? `${t("screenshotAttachedContext", language)}\n\n${domContent}`
            : domContent;
        } catch (e) {
          console.error("Screenshot failed:", e);
          maybeWarnScreenshotPermission(e);
          pageContent = await extractPageContent({ mode: "interactive" });
        }
      } else {
        // Text or Hybrid mode: extract text
        pageContent = await extractPageContent({
          mode:
            wantsContentOnly && (!editingForRun || displayLookupSupported)
              ? "content"
              : "interactive",
          autoScrollForLazyLoad: wantsContentOnly && autoScrollForLazyLoad,
        });
      }

      const visionAvailable =
        ["auto", "copilot", "copilot-agent"].includes(settings.provider) &&
        bridgeCapabilities?.providers.some(
          (provider) =>
            provider.id === "vscode-lm" &&
            provider.supportsVision === true &&
            provider.status === "available",
        );
      if (
        !screenshotBase64 &&
        operationMode === "hybrid" &&
        visionAvailable &&
        ["empty", "failed"].includes(pageStateRef.current?.status ?? "failed")
      ) {
        try {
          screenshotBase64 = await captureScreenshotForActiveContentTab();
        } catch {
          screenshotBase64 = "";
        }
      }
      if (
        screenshotBase64 &&
        !["ok", "partial"].includes(pageStateRef.current?.status ?? "failed")
      ) {
        pageContent =
          "Only the attached visible screenshot is available. This is not the full page text.";
        pageStateRef.current = {
          status: "partial",
          content: pageContent,
          frames: [],
          capturedAt: Date.now(),
          method: "image",
        };
        setPageState(pageStateRef.current);
      }
      if (
        (wantsContentOnly || assistantSettings.mode !== "read-only") &&
        isPageContentUnavailableContext(pageContent) &&
        !screenshotBase64
      ) {
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: "assistant",
            content: t("pageContentUnavailableNotice", language),
            kind: "notice",
          },
        ]);
        return;
      }

      // Send to VS Code extension
      const context = buildChatContext(
        assistantSettings,
        targetTab?.id !== undefined && targetTab.url?.match(/^https?:\/\//)
          ? { tabId: targetTab.id, url: targetTab.url }
          : undefined,
        pageStateRef.current?.status ?? "failed",
        task
          ? {
              ...task,
              instructions: task.instructions
                ?.split(POST_URL_PLACEHOLDER)
                .join(targetTab?.url ?? ""),
            }
          : undefined,
        browserActionsEnabled,
        language,
        editingForRun,
        displayLookupSupported,
      );
      if (!pageStateRef.current?.frames.length) context.allowedActions = [];
      context.profileFields = personalForRun ? Object.keys(personalForRun) : [];
      context.profileFieldLabels = personalForRun
        ? Object.fromEntries(
            profileForRun.customFields.flatMap((field, index) =>
              field.name.trim() && field.value.trim()
                ? [[`custom${index + 1}`, field.name.trim()]]
                : [],
            ),
          )
        : {};
      context.fileOperationsEnabled =
        context.mode === "automation" &&
        fileOperationsEnabled &&
        !personalForRun;
      const cleanContext = () => ({
        ...context,
        globalInstructions: redact(context.globalInstructions),
        profileInstructions: redact(context.profileInstructions),
        taskInstructions: redact(context.taskInstructions),
        target: context.target
          ? { ...context.target, url: redact(context.target.url) }
          : undefined,
      });
      await assertPageShareAllowed(targetTab?.id, language);
      const response = await fetch(`${getBridgeBaseUrl()}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...BRIDGE_CLIENT_HEADERS,
        },
        body: JSON.stringify({
          settings,
          messages: cleanMessages([...history, newUserMessage]),
          context: cleanContext(),
          pageContent: redact(pageContent),
          screenshot: screenshotBase64 || undefined,
          operationMode,
          attachments: attachments.map((attachment) => ({
            ...attachment,
            textContent: attachment.textContent
              ? redact(attachment.textContent)
              : undefined,
          })),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(await buildBridgeHttpError(response));
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Empty response stream from server");
      }
      const assistantResponsesForFileActions: string[] = [];
      const responseSource = {
        pageTitle: targetTab?.title || "Untitled Page",
        pageUrl: targetTab?.url || "",
      };

      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          source: responseSource,
          incomplete: true,
        },
      ]);

      const assistantMessage = await readUtf8Stream(reader, (content) => {
        setMessages((prev: ChatMessage[]) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content,
            source: responseSource,
            incomplete: true,
          };
          return newMessages;
        });
      });

      setMessages((previous) =>
        previous.map((message, index) =>
          index === previous.length - 1 &&
          message.role === "assistant" &&
          !message.kind
            ? { ...message, content: assistantMessage, incomplete: false }
            : message,
        ),
      );
      if (!assistantMessage.trim()) {
        const emptyMessage = t("emptyServerResponse", language);
        setMessages((prev: ChatMessage[]) => {
          const newMessages = [...prev];
          if (
            newMessages.length > 0 &&
            newMessages[newMessages.length - 1].role === "assistant" &&
            !newMessages[newMessages.length - 1].content.trim()
          ) {
            newMessages[newMessages.length - 1] = {
              role: "assistant",
              content: emptyMessage,
              kind: "error",
            };
            return newMessages;
          }
          return [
            ...newMessages,
            { role: "assistant", content: emptyMessage, kind: "error" },
          ];
        });
        return;
      }

      assistantResponsesForFileActions.push(assistantMessage);

      // Execute browser actions if enabled (with autonomous loop)
      console.log("[Agent] browserActionsEnabled:", browserActionsEnabled);
      console.log("[Agent] Provider:", settings.provider);
      console.log("[Agent] Initial response length:", assistantMessage.length);

      if (browserActionsEnabled && context.allowedActions.length > 0) {
        const safeMaxAgentLoops = clampAgentLoops(maxAgentLoops);
        let currentResponse = assistantMessage;
        let displayPhase: "normal" | "replace" | "report" = "normal";
        let displayCorrectionUsed = false;
        let displayLookups = 0;
        let loopCount = 0;
        let conversationHistory = [
          ...history,
          newUserMessage,
          { role: "assistant" as const, content: assistantMessage },
        ];

        console.log(
          "[Agent] Starting autonomous loop, maxLoops:",
          safeMaxAgentLoops,
        );
        let consecutiveErrors = 0;
        let consecutiveFailedActionLoops = 0;
        let stopForReview = false;
        let useScreenshotFallback = operationMode === "screenshot";

        while (
          loopCount < safeMaxAgentLoops &&
          !abortControllerRef.current?.signal.aborted
        ) {
          const firstAction = parseFirstBrowserAction(currentResponse);
          if (displayPhase === "report") break;
          const correctDisplayFormat = Boolean(
            firstAction.error &&
            displayTaskId &&
            !displayCorrectionUsed &&
            displayPhase === "normal",
          );
          if (firstAction.error) {
            setMessages((previous) => [
              ...previous,
              {
                role: "assistant",
                kind: "notice",
                content:
                  language === "ja"
                    ? "操作の形式が正しくないため実行しませんでした。表示編集には実際の ref が必要です。対象文言の取得からやり直してください。"
                    : "The action format was invalid; nothing was executed. Display editing requires an actual ref. Read the target text again.",
              },
            ]);
            if (!correctDisplayFormat) break;
            displayCorrectionUsed = true;
          }
          const parsedActions = firstAction.action ? [firstAction.action] : [];
          const blockedHighRiskActions = allowHighRiskActions
            ? []
            : parsedActions.filter(isHighRiskAction);
          const blockedActionTypes = Array.from(
            new Set(blockedHighRiskActions.map((action) => action.type)),
          );
          const executableActions = allowHighRiskActions
            ? parsedActions
            : parsedActions.filter((action) => !isHighRiskAction(action));

          console.log(
            `[Agent Loop] Loop ${loopCount}, Actions found: ${parsedActions.length}`,
            parsedActions.map((action) => action.type),
          );
          console.log(`[Agent Loop] Current response:`, "Response received");

          // Check if response indicates completion (only when NO actions found)
          if (parsedActions.length === 0 && !correctDisplayFormat) {
            // No actions to execute - check if truly done or just needs prompting
            const isCompletion = (() => {
              const lower = currentResponse.toLowerCase();
              // Very strict: only final completion phrases, not mid-task reports
              const jpFinal =
                /(以上で完了|すべて完了|タスク完了|作業が完了|全て完了|完了です。$|完了しました。$)/;
              const enFinal =
                /\b(all done|task completed|finished all|completed successfully)\b/;
              return jpFinal.test(currentResponse) || enFinal.test(lower);
            })();

            if (isCompletion) {
              console.log("[Agent Loop] Completion detected, stopping loop");
            } else {
              console.log("[Agent Loop] No actions found, stopping loop");
            }
            break;
          }

          // Actions found - continue regardless of any "完了" in text

          if (executableActions.length === 0 && !correctDisplayFormat) {
            loopCount++;
            const blockedOnlyResults = [
              `• ${t("highRiskActionBlocked", language).replace("{types}", blockedActionTypes.join(", "))}`,
              `• ${t("highRiskActionBlockedAll", language)}`,
            ];
            const blockedOnlyMessage = `🤖 [Loop ${loopCount}/${safeMaxAgentLoops}] ${t("executionResult", language)}\n${blockedOnlyResults.join("\n")}`;

            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: "assistant",
                content: blockedOnlyMessage,
                kind: "notice",
              },
            ]);
            break;
          }

          loopCount++;
          const actionResults: string[] = correctDisplayFormat
            ? [
                'Invalid display action format; nothing was executed. Use [ACTION: findDisplayText, {"text":"exact visible text"}] to obtain a real ref. Do not use text= selectors or create scripts.',
              ]
            : [];
          let errorCount = 0;

          if (blockedHighRiskActions.length > 0) {
            actionResults.push(
              `• ${t("highRiskActionBlocked", language).replace("{types}", blockedActionTypes.join(", "))}`,
            );
          }

          for (const action of executableActions) {
            try {
              if (action.type === "findDisplayText" && displayLookups >= 10) {
                actionResults.push(
                  "Error: display lookup limit reached; split the request into smaller batches",
                );
                stopForReview = true;
                break;
              }
              if (
                action.type === "findDisplayText" ||
                action.type === "replaceText"
              )
                context.fileOperationsEnabled = false;
              if (
                action.type === "findDisplayText" &&
                loopCount >= safeMaxAgentLoops
              ) {
                actionResults.push(
                  "Error: not enough task steps remain for lookup and replacement; increase the task limit before retrying",
                );
                stopForReview = true;
                break;
              }
              if (
                personalForRun &&
                actionUsesPersonalProfile(action, personalForRun) &&
                targetTab?.id !== undefined
              ) {
                privateTabsRef.current.add(targetTab.id);
                await markPrivateBrowserTab(targetTab.id);
                stopForReview = true;
              }
              // All modes now use improved local DOM operations
              // (Playwright-style: auto-wait, multiple click methods, etc.)
              const session = {
                context,
                frames: pageStateRef.current?.frames ?? [],
                personal: personalForRun,
                signal: abortControllerRef.current?.signal,
                displayTaskId,
                authorizeDisplayEdit: async () => {
                  const stored = await chrome.storage.local.get(
                    DISPLAY_EDIT_ORIGINS_KEY,
                  );
                  return (
                    activeDisplayEditRef.current &&
                    canEditDisplay({
                      url: context.target?.url,
                      mode: context.mode,
                      browserActionsEnabled,
                      task: Boolean(task),
                      once:
                        displayEditingEnabled &&
                        displayOnceOriginRef.current ===
                          displayEditOrigin(context.target?.url),
                      origins: normalizeDisplayEditOrigins(
                        stored[DISPLAY_EDIT_ORIGINS_KEY],
                      ),
                    })
                  );
                },
              };
              const button =
                action.type === "click"
                  ? await inspectButtonClick(action, session)
                  : null;
              let approvedClick: typeof button = null;
              if (button) {
                const stored = await chrome.storage.local.get(
                  APPROVED_BUTTON_ORIGINS_KEY,
                );
                if (session.signal?.aborted) {
                  actionResults.push("• Error: task cancelled");
                  stopForReview = true;
                  break;
                }
                const origins = stored[APPROVED_BUTTON_ORIGINS_KEY];
                const approved =
                  origins &&
                  typeof origins === "object" &&
                  !Array.isArray(origins) &&
                  (origins as Record<string, unknown>)[button.origin] === true;
                if (!approved) {
                  const granted = await new Promise<boolean>((resolve) => {
                    clickApprovalResolver.current = resolve;
                    setClickApproval({
                      origin: button.origin,
                      label: button.label,
                      href: button.href,
                    });
                  });
                  if (!granted) {
                    actionResults.push(
                      "• Error: button click was not approved",
                    );
                    errorCount++;
                    stopForReview = true;
                    break;
                  }
                }
                if (session.signal?.aborted) {
                  actionResults.push("• Error: task cancelled");
                  stopForReview = true;
                  break;
                }
                approvedClick = button;
              }
              const result = await executeBrowserAction(action, {
                ...session,
                approvedClick: approvedClick ?? undefined,
              });
              if (
                action.type === "replaceText" &&
                hasUndoableDisplayEdit(targetTab?.id ?? -1) &&
                targetTab?.id !== undefined
              ) {
                const editedTabId = targetTab.id;
                setUndoDisplayTabIds((previous) =>
                  new Set(previous).add(editedTabId),
                );
              }

              actionResults.push(`• ${result}`);
              if (
                action.type === "findDisplayText" &&
                result.startsWith("Display text found:")
              )
                displayLookups++;
              if (
                displayTaskId &&
                action.type === "findDisplayText" &&
                result.startsWith("Display text found:")
              )
                displayPhase = "replace";
              if (
                displayTaskId &&
                action.type === "replaceText" &&
                result === "Display text changed; not submitted"
              )
                displayPhase = "report";
              if (
                result.includes("not found") ||
                result.includes("Error") ||
                result.includes("error")
              ) {
                errorCount++;
                stopForReview = true;
              }
            } catch (error) {
              actionResults.push(
                `• Error: ${redact(error instanceof Error ? error.message : String(error))}`,
              );
              errorCount++;
              stopForReview = true;
            }

            // Short delay between actions (80-200ms)
            await new Promise((resolve) =>
              setTimeout(resolve, 80 + Math.random() * 120),
            );
          }

          // Track consecutive errors for hybrid mode fallback
          if (errorCount > 0) {
            consecutiveErrors++;
            if (errorCount === executableActions.length) {
              consecutiveFailedActionLoops++;
            } else {
              consecutiveFailedActionLoops = 0;
            }

            if (
              shouldEnableScreenshotFallback(
                operationMode,
                consecutiveErrors,
                useScreenshotFallback,
              )
            ) {
              console.log(
                "[Agent] Hybrid mode: switching to screenshot fallback after 3 consecutive errors",
              );
              useScreenshotFallback = true;
              actionResults.push(
                "📸 Switching to screenshot mode for better accuracy",
              );
            }
          } else {
            consecutiveErrors = 0;
            consecutiveFailedActionLoops = 0;
          }

          const resultMessage = `🤖 [Loop ${loopCount}/${safeMaxAgentLoops}] ${t("executionResult", language)}\n${actionResults.join("\n")}`;
          setMessages((prev: ChatMessage[]) => [
            ...prev,
            { role: "assistant", content: resultMessage, kind: "notice" },
          ]);
          if (stopForReview) break;

          if (
            shouldStopAutonomousLoopAfterFailures({
              operationMode,
              useScreenshotFallback,
              consecutiveFailedActionLoops,
            })
          ) {
            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: "assistant",
                content: t("repeatedActionFailures", language),
                kind: "notice",
              },
            ]);
            break;
          }

          // Only continue autonomous loop in agent mode
          // For chat mode, stop after first execution (user can click "つづけて" to continue)
          if (
            !supportsAutonomousLoopProvider(settings.provider) &&
            displayPhase === "normal" &&
            !correctDisplayFormat
          ) {
            console.log(
              "[Agent] Chat mode - stopping after first action. Use Agent mode for autonomous loop.",
            );
            break;
          }

          console.log("[Agent] Agent mode - continuing autonomous loop...");

          // Short wait between loops (0.5-1.0 seconds)
          const waitTime = 500 + Math.random() * 500;
          console.log(
            `[Agent] Waiting ${Math.round(waitTime / 1000)}s before next loop...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));

          // Get updated page content (with screenshot if in fallback mode)
          let updatedPageContent = "";
          let updatedScreenshot = "";

          if (useScreenshotFallback) {
            try {
              updatedScreenshot = await captureScreenshotForActiveContentTab();
              // Also get DOM elements for ref-based clicking
              const domContent = await extractPageContent({
                mode: "interactive",
              });
              updatedPageContent = updatedScreenshot
                ? `${t("screenshotAttachedShort", language)}\n\n${domContent}`
                : domContent;
              if (updatedScreenshot) {
                console.log("[Agent] Screenshot captured for fallback mode");
              }
            } catch (e) {
              console.error("Screenshot fallback failed:", e);
              maybeWarnScreenshotPermission(e);
              if (!screenshotFallbackWarnedRef.current) {
                screenshotFallbackWarnedRef.current = true;
                setMessages((prev: ChatMessage[]) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: t("screenshotFallbackFailed", language),
                    kind: "notice",
                  },
                ]);
              }
              updatedPageContent = await extractPageContent({
                mode: "interactive",
              });
            }
          } else {
            updatedPageContent = await extractPageContent({
              mode:
                wantsContentOnly && (!editingForRun || displayLookupSupported)
                  ? "content"
                  : "interactive",
              autoScrollForLazyLoad: wantsContentOnly && autoScrollForLazyLoad,
            });
          }

          // Add results to conversation
          const refreshedTab =
            targetTab?.id !== undefined
              ? await chrome.tabs.get(targetTab.id)
              : undefined;
          context.target =
            refreshedTab?.url && refreshedTab.id !== undefined
              ? { tabId: refreshedTab.id, url: refreshedTab.url }
              : undefined;
          context.pageStatus = pageStateRef.current?.status ?? "failed";
          context.allowedActions = effectiveBrowserActions(context);
          if (
            displayTaskId &&
            (displayPhase !== "normal" || correctDisplayFormat)
          ) {
            context.fileOperationsEnabled = false;
            context.allowedActions =
              displayPhase === "report"
                ? []
                : displayPhase === "replace"
                  ? ["findDisplayText", "replaceText"]
                  : ["findDisplayText"];
          }
          if (!context.allowedActions.length && displayPhase !== "report")
            break;
          conversationHistory = [
            ...conversationHistory,
            {
              role: "user" as const,
              content: t("loopContinuationPrompt", language)
                .replace("{loop}", String(loopCount))
                .replace("{results}", actionResults.join("\n")),
            },
          ];

          // Request next action from LLM
          try {
            const loopAbortController = abortControllerRef.current;
            if (!loopAbortController || loopAbortController.signal.aborted) {
              break;
            }

            await assertPageShareAllowed(targetTab?.id, language);
            const continueResponse = await fetch(`${getBridgeBaseUrl()}/chat`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...BRIDGE_CLIENT_HEADERS,
              },
              body: JSON.stringify({
                settings,
                messages: cleanMessages(conversationHistory),
                context: cleanContext(),
                pageContent: redact(updatedPageContent),
                screenshot: updatedScreenshot || undefined,
                operationMode: useScreenshotFallback
                  ? "screenshot"
                  : operationMode,
                attachments: [],
              }),
              signal: loopAbortController.signal,
            });

            if (!continueResponse.ok) {
              const continueError =
                await buildBridgeHttpError(continueResponse);
              console.error(continueError);
              setMessages((prev: ChatMessage[]) => [
                ...prev,
                {
                  role: "assistant",
                  content: `${t("connectionError", language)}\n\n${continueError}`,
                  kind: "error",
                },
              ]);
              break;
            }

            const continueReader = continueResponse.body?.getReader();
            if (!continueReader) {
              console.error("Continue response has no stream body");
              break;
            }

            const continuedSource = {
              pageTitle: refreshedTab?.title || "Untitled Page",
              pageUrl: refreshedTab?.url || "",
            };
            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: "assistant",
                content: "",
                source: continuedSource,
                commandsNotExecuted: displayPhase === "report",
                incomplete: true,
              },
            ]);

            currentResponse = await readUtf8Stream(
              continueReader,
              (content) => {
                setMessages((prev: ChatMessage[]) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content,
                    source: continuedSource,
                    commandsNotExecuted: displayPhase === "report",
                    incomplete: true,
                  };
                  return newMessages;
                });
              },
            );

            setMessages((previous) =>
              previous.map((message, index) =>
                index === previous.length - 1 &&
                message.role === "assistant" &&
                !message.kind
                  ? { ...message, content: currentResponse, incomplete: false }
                  : message,
              ),
            );
            if (
              displayPhase === "report" &&
              (currentResponse.includes("[ACTION:") ||
                currentResponse.includes("[FILE:") ||
                currentResponse.includes("__DOWNLOAD_FILE__:"))
            ) {
              setMessages((previous) => [
                ...previous,
                {
                  role: "assistant",
                  kind: "notice",
                  content:
                    language === "ja"
                      ? "結果報告内の追加操作は実行していません。"
                      : "Additional actions in the final report were not executed.",
                },
              ]);
            }
            if (!currentResponse.trim()) {
              setMessages((prev: ChatMessage[]) => {
                const newMessages = [...prev];
                if (
                  newMessages.length > 0 &&
                  newMessages[newMessages.length - 1].role === "assistant" &&
                  !newMessages[newMessages.length - 1].content.trim()
                ) {
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: t("emptyContinuationResponse", language),
                    kind: "error",
                  };
                  return newMessages;
                }
                return [
                  ...newMessages,
                  {
                    role: "assistant",
                    content: t("emptyContinuationResponse", language),
                    kind: "error",
                  },
                ];
              });
              break;
            }

            // Add LLM response to conversation history
            conversationHistory = [
              ...conversationHistory,
              { role: "assistant" as const, content: currentResponse },
            ];
            assistantResponsesForFileActions.push(currentResponse);
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              console.log("Autonomous loop cancelled by user");
              break;
            }
            throw error;
          }
        }

        if (loopCount >= safeMaxAgentLoops && displayPhase !== "report") {
          setMessages((prev: ChatMessage[]) => [
            ...prev,
            {
              role: "assistant",
              content: t("maxAgentLoopsReached", language).replace(
                "{count}",
                String(safeMaxAgentLoops),
              ),
              kind: "notice",
            },
          ]);
        }
      }

      // Execute file actions if enabled
      if (
        context.fileOperationsEnabled &&
        !abortControllerRef.current?.signal.aborted
      ) {
        const downloadResults: string[] = [];
        const downloadDestinations = new Set<string>();
        const processedFileMarkers = new Set<string>();

        const decodeBase64Utf8 = (b64: string) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return new TextDecoder("utf-8").decode(bytes);
        };

        // Pattern 1: New base64 download marker from VS Code agent tool
        const downloadRegex =
          /__DOWNLOAD_FILE__:([^:]+):([A-Za-z0-9+/=]+):__END_DOWNLOAD__/g;

        for (const responseText of assistantResponsesForFileActions) {
          let dlMatch;
          while ((dlMatch = downloadRegex.exec(responseText)) !== null) {
            const [, filePath, b64Content] = dlMatch;
            const markerKey = `b64:${filePath}:${b64Content}`;
            if (processedFileMarkers.has(markerKey)) {
              continue;
            }
            processedFileMarkers.add(markerKey);

            try {
              const content = decodeBase64Utf8(b64Content);
              const result = await saveTextArtifact({
                relativePath: filePath,
                content,
                mimeType: "text/plain;charset=utf-8",
              });
              if (result.success) {
                const showLink = result.downloadId
                  ? ` ([${t("showInFolder", language)}](download-show:${result.downloadId}))`
                  : "";
                downloadResults.push(`• ✓ ${result.filename}${showLink}`);
                if (result.destinationMessage)
                  downloadDestinations.add(result.destinationMessage);
              } else {
                downloadResults.push(
                  `• ✗ ${result.filename}: ${result.error || t("downloadFailedDefault", language)}`,
                );
              }
            } catch {
              downloadResults.push(
                `• ✗ ${t("base64DecodeError", language).replace("{path}", filePath)}`,
              );
            }
          }
          downloadRegex.lastIndex = 0;

          // Pattern 2: Legacy [FILE: create, ...] pattern
          const fileActions = parseFileActionsFromResponse(responseText);
          for (const action of fileActions) {
            const markerKey = `file:${action.type}:${action.path}:${action.content}`;
            if (processedFileMarkers.has(markerKey)) {
              continue;
            }
            processedFileMarkers.add(markerKey);

            const result = await saveTextArtifact({
              relativePath: action.path,
              content: action.content,
              mimeType: "text/plain;charset=utf-8",
            });
            if (result.success) {
              const showLink = result.downloadId
                ? ` ([${t("showInFolder", language)}](download-show:${result.downloadId}))`
                : "";
              downloadResults.push(`• ✓ ${result.filename}${showLink}`);
              if (result.destinationMessage)
                downloadDestinations.add(result.destinationMessage);
            } else {
              downloadResults.push(
                `• ✗ ${result.filename}: ${result.error || t("downloadFailedDefault", language)}`,
              );
            }
          }
        }

        if (downloadResults.length > 0) {
          const allSaved = downloadResults.every((result) =>
            result.startsWith("• ✓"),
          );
          const destinations = [...downloadDestinations].join("\n📂 ");
          setMessages((prev: ChatMessage[]) => [
            ...prev,
            {
              role: "assistant",
              content: `📥 ${t(allSaved ? "downloadComplete" : "downloadResults", language)}:\n${downloadResults.join("\n")}${destinations ? `\n\n📂 ${destinations}` : ""}`,
              kind: "notice",
            },
          ]);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled - don't show error
        console.log("Request cancelled by user");
      } else {
        if (!(error instanceof TaskBlockedError))
          console.error("Error sending message:", error);
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: "assistant",
            content: formatChatError(error, t("connectionError", language)),
            kind: error instanceof TaskBlockedError ? "notice" : "error",
          },
        ]);
      }
    } finally {
      if (displayTaskId) {
        void chrome.runtime
          .sendMessage({
            type: "display-edit",
            operation: "end",
            taskId: displayTaskId,
          })
          .catch(() => undefined);
      }
      activeDisplayEditRef.current = false;
      activeDisplayOriginRef.current = "";
      if (editingForRun) setDisplayEditingEnabled(false);
      if (abortControllerRef.current?.signal.aborted) {
        setMessages((previous) =>
          finishStoppedConversation(
            previous,
            language === "ja" ? "処理を停止しました。" : "Generation stopped.",
          ),
        );
      }
      activeContentTabIdRef.current = null;
      setIsLoading(false);
      abortControllerRef.current = null;
      inFlightRequestRef.current = false;
    }
  };

  useEffect(() => {
    if (
      !pendingPrompt ||
      !canDispatchPendingAction({
        isLoading,
        isReadingPage,
        isConnected,
        contextVersion: bridgeCapabilities?.contextVersion,
      })
    ) {
      return;
    }

    if (pendingPromptDispatchRef.current === pendingPrompt) {
      return;
    }

    const prompt = pendingPrompt;
    const targetTabId = pendingPromptTabIdRef.current;
    pendingPromptDispatchRef.current = prompt;
    activeContentTabIdRef.current = targetTabId;
    setPendingPrompt(null);
    pendingPromptTabIdRef.current = null;
    chrome.storage.local.remove("pendingAction");
    const task = pendingTaskRef.current;
    pendingTaskRef.current = undefined;
    void sendMessage(
      task?.kind === "post"
        ? language === "ja"
          ? "現在のページについて投稿文を作成してください。"
          : "Draft a post about the current page."
        : task?.kind === "custom"
          ? language === "ja"
            ? "選択したカスタム指示をこのページに適用してください。"
            : "Run the selected custom instruction on this page."
          : prompt,
      [],
      task,
    ).finally(() => {
      if (pendingPromptDispatchRef.current === prompt) {
        pendingPromptDispatchRef.current = null;
      }
      if (activeContentTabIdRef.current === targetTabId) {
        activeContentTabIdRef.current = null;
      }
    });
  }, [
    isLoading,
    isReadingPage,
    isConnected,
    bridgeCapabilities?.contextVersion,
    pendingPrompt,
  ]);

  const stopGeneration = () => {
    resolveClickApproval(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const closeSettings = () => {
    setShowSettings(false);
    settingsButtonRef.current?.focus();
  };
  const refreshPageContext = async () => {
    if (inFlightRequestRef.current || readingPageRef.current) return;
    readingPageRef.current = true;
    setIsReadingPage(true);
    try {
      if (!(await privacyReadyRef.current))
        throw new TaskBlockedError(
          language === "ja"
            ? "個人情報の保護設定を読み込めませんでした。"
            : "Privacy settings could not be loaded.",
        );
      const tab = (
        await chrome.tabs.query({ active: true, currentWindow: true })
      )[0];
      await assertPageShareAllowed(tab?.id, language);
      activeContentTabIdRef.current = tab?.id ?? null;
      await extractPageContent({ mode: "interactive" });
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          kind: "notice",
          content: error instanceof Error ? error.message : "Page unavailable",
        },
      ]);
    } finally {
      activeContentTabIdRef.current = null;
      readingPageRef.current = false;
      setIsReadingPage(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0 bg-gray-50">
      {clickApproval && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              language === "ja"
                ? "ブラウザ操作の許可"
                : "Approve browser action"
            }
            onKeyDown={(event) => {
              if (
                event.key === "Escape" &&
                !event.nativeEvent.isComposing &&
                !savingClickApproval
              ) {
                event.preventDefault();
                resolveClickApproval(false);
              }
              if (event.key === "Tab") {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not([disabled])",
                  ),
                );
                const first = buttons[0];
                const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
            className="w-full max-w-sm bg-white border p-4 space-y-3 shadow-lg"
          >
            <h2 className="font-semibold text-sm">
              {clickApproval.href
                ? language === "ja"
                  ? "ダウンロードの確認"
                  : "Confirm download"
                : language === "ja"
                  ? "ボタン操作の確認"
                  : "Confirm button click"}
            </h2>
            <p className="text-sm break-words">{clickApproval.label}</p>
            {clickApproval.href && (
              <p className="text-xs break-all text-gray-600">
                {new URL(clickApproval.href).pathname}
              </p>
            )}
            <p className="text-xs break-all text-gray-600">
              {clickApproval.origin}
            </p>
            <p className="text-xs text-gray-600">
              {language === "ja"
                ? "許可するとサイトの操作が実行されます。常に許可はこのサイトの通常ボタンとダウンロードリンクに適用されます。"
                : "The site's action will run. Always allow applies to ordinary buttons and download links on this site."}
            </p>
            {clickApprovalError && (
              <p role="alert" className="text-xs text-red-700">
                {language === "ja"
                  ? "許可を保存できませんでした。再試行するか、今回だけ許可してください。"
                  : "Could not save permission. Retry or allow this click only."}
              </p>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                ref={approvalCancelRef}
                type="button"
                disabled={savingClickApproval}
                className="border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-green-700"
                onClick={() => resolveClickApproval(false)}
              >
                {language === "ja" ? "キャンセル" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={savingClickApproval}
                className="border px-2 py-1 text-sm"
                onClick={() => resolveClickApproval(true)}
              >
                {language === "ja" ? "今回だけ" : "Once"}
              </button>
              <button
                type="button"
                disabled={savingClickApproval}
                className="bg-green-700 text-white px-2 py-1 text-sm"
                onClick={async () => {
                  const origin = clickApproval.origin;
                  setSavingClickApproval(true);
                  setClickApprovalError(false);
                  try {
                    const stored = await chrome.storage.local.get(
                      APPROVED_BUTTON_ORIGINS_KEY,
                    );
                    const current = stored[APPROVED_BUTTON_ORIGINS_KEY];
                    const next = {
                      ...(current &&
                      typeof current === "object" &&
                      !Array.isArray(current)
                        ? current
                        : {}),
                      [origin]: true,
                    };
                    await chrome.storage.local.set({
                      [APPROVED_BUTTON_ORIGINS_KEY]: next,
                    });
                    setApprovedButtonOrigins(next);
                    resolveClickApproval(true);
                  } catch {
                    setClickApprovalError(true);
                    approvalCancelRef.current?.focus();
                  } finally {
                    setSavingClickApproval(false);
                  }
                }}
              >
                {language === "ja"
                  ? "このサイトを常に許可"
                  : "Always allow this site"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showIssueReport && (
        <IssueReportDialog
          version={chrome.runtime.getManifest().version}
          mode={assistantSettings.mode}
          status={pageState?.status ?? "unknown"}
          origin={pageOrigin}
          language={language}
          onClose={() => setShowIssueReport(false)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg font-semibold">
            {t("appTitle", language)}
          </span>
          <span
            role="status"
            aria-label={isConnected ? "Connected" : "Disconnected"}
            className={`w-2 h-2 shrink-0 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowIssueReport(true)}
            className="w-8 h-8 flex items-center justify-center text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded focus-visible:ring-2 focus-visible:ring-green-700"
            title={language === "ja" ? "Issue を報告" : "Report an issue"}
            aria-label={language === "ja" ? "Issue を報告" : "Report an issue"}
          >
            !
          </button>
          <button
            onClick={() => {
              void checkConnection();
            }}
            className="p-2 hover:bg-gray-100 rounded"
            title={t("reconnect", language)}
            aria-label={t("reconnect", language)}
          >
            🔄
          </button>
          <button
            ref={settingsButtonRef}
            disabled={isSavingProfile}
            aria-expanded={showSettings}
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-gray-100 rounded"
            title={t("settings", language)}
            aria-label={t("settings", language)}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Connection Error Banner */}
      {pendingPrompt &&
        !canDispatchPendingAction({
          isLoading,
          isReadingPage,
          isConnected,
          contextVersion: bridgeCapabilities?.contextVersion,
        }) && (
          <div
            role="status"
            className="px-4 py-2 text-xs bg-amber-50 text-amber-900 border-b border-amber-200"
          >
            {language === "ja"
              ? "操作を待機しています。接続準備または現在の処理の完了待ちです。"
              : "Action queued: waiting for bridge readiness or the current task."}
          </div>
        )}
      {!isConnected && (
        <div className="px-4 py-2 bg-red-100 text-red-700 text-sm">
          <div>{t("connectionError", language)}</div>
          {connectionErrorDetail && (
            <div className="mt-1 text-xs break-all">
              {connectionErrorDetail}
            </div>
          )}
          <button
            onClick={() => {
              void checkConnection();
            }}
            className="mt-1 underline hover:no-underline"
          >
            {t("reconnectLink", language)}
          </button>
        </div>
      )}

      {isConnected && modelFetchFailed && (
        <div className="px-4 py-2 bg-amber-100 text-amber-800 text-sm border-b border-amber-200">
          <div>{t("modelFetchFailed", language)}</div>
          {modelFetchErrorDetail && (
            <div className="mt-1 text-xs break-all">
              {modelFetchErrorDetail}
            </div>
          )}
          <button
            onClick={() => {
              void fetchAvailableModels();
            }}
            className="mt-1 underline hover:no-underline"
          >
            {t("refresh", language)}
          </button>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <Settings
          taskRunning={isLoading}
          onSavingProfileChange={setIsSavingProfile}
          personalProfile={personalProfile}
          onPersonalProfileChange={(value) => {
            stopGeneration();
            setProfileAuthorization("");
            personalProfileRef.current = value;
            setPersonalProfile(value);
          }}
          assistantSettings={assistantSettings}
          onAssistantSettingsChange={(value) => {
            if (
              value.mode !== assistantSettings.mode ||
              value.selectedProfileId !== assistantSettings.selectedProfileId
            )
              stopGeneration();
            if (value.selectedProfileId !== assistantSettings.selectedProfileId)
              setMessages([]);
            setAssistantSettings(value);
          }}
          settings={settings}
          onSettingsChange={setSettings}
          onClose={closeSettings}
          isConnected={isConnected}
          availableModels={availableModels}
          modelFetchFailed={modelFetchFailed}
          bridgeCapabilities={bridgeCapabilities}
          capabilitiesErrorDetail={capabilitiesErrorDetail}
          onRefreshCapabilities={() => {
            void fetchBridgeCapabilities();
          }}
          onRefreshModels={() => {
            void fetchAvailableModels();
          }}
          browserActionsEnabled={browserActionsEnabled}
          onBrowserActionsChange={(enabled) => {
            if (!enabled) {
              stopGeneration();
              setDisplayEditingEnabled(false);
            }
            setBrowserActionsEnabled(enabled);
          }}
          fileOperationsEnabled={fileOperationsEnabled}
          onFileOperationsChange={(enabled) => {
            if (!enabled) stopGeneration();
            setFileOperationsEnabled(enabled);
          }}
          language={language}
          onLanguageChange={setLanguage}
          maxAgentLoops={maxAgentLoops}
          onMaxAgentLoopsChange={setMaxAgentLoops}
          operationMode={operationMode}
          onOperationModeChange={setOperationMode}
          serverPort={serverPort}
          onServerPortChange={handleServerPortChange}
          allowHighRiskActions={allowHighRiskActions}
          onAllowHighRiskActionsChange={setAllowHighRiskActions}
          allowEvaluateAction={allowEvaluateAction}
          onAllowEvaluateActionChange={setAllowEvaluateAction}
          saveDestinationMode={saveDestinationMode}
          onSaveDestinationModeChange={setSaveDestinationMode}
          saveRelativePath={saveRelativePath}
          onSaveRelativePathChange={setSaveRelativePath}
          customPrompts={customPrompts}
          onCustomPromptsChange={setCustomPrompts}
        />
      )}

      {/* Chat Area */}
      <div
        className={
          showSettings ? "hidden" : "flex flex-col flex-1 min-h-0 min-w-0"
        }
      >
        <div className="px-4 py-2 text-xs border-t bg-white flex flex-wrap gap-2 items-center">
          <select
            disabled={isLoading}
            aria-label={
              language === "ja" ? "指示プロフィール" : "Assistant profile"
            }
            value={assistantSettings.selectedProfileId}
            className="border rounded p-1 min-w-0 max-w-full disabled:opacity-50"
            onChange={(event) => {
              stopGeneration();
              setMessages([]);
              setAssistantSettings({
                ...assistantSettings,
                selectedProfileId: event.target.value,
              });
            }}
          >
            {assistantSettings.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name.trim() || "Profile"}
              </option>
            ))}
          </select>
          <select
            aria-label="Browser operation"
            className="border rounded p-1 min-w-0"
            value={assistantSettings.mode}
            onChange={(event) => {
              stopGeneration();
              if (event.target.value === "read-only")
                setDisplayEditingEnabled(false);
              setAssistantSettings({
                ...assistantSettings,
                mode: event.target.value as typeof assistantSettings.mode,
              });
            }}
          >
            <option value="read-only">Read only</option>
            <option value="input">Assist with input</option>
            <option value="automation">Browser automation</option>
          </select>
          {Object.entries(approvedButtonOrigins).filter(
            ([, approved]) => approved === true,
          ).length > 0 && (
            <details className="text-xs max-w-full">
              <summary className="cursor-pointer">
                {language === "ja"
                  ? "ボタン操作の許可サイト"
                  : "Approved button sites"}
              </summary>
              {Object.entries(approvedButtonOrigins)
                .filter(([, approved]) => approved === true)
                .map(([origin]) => (
                  <div
                    key={origin}
                    className="flex items-center gap-2 max-w-full"
                  >
                    <span className="truncate" title={origin}>
                      {origin}
                    </span>
                    <button
                      type="button"
                      className="text-red-700 shrink-0"
                      aria-label={`${origin} ${language === "ja" ? "の許可を解除" : "revoke permission"}`}
                      onClick={async () => {
                        const stored = await chrome.storage.local.get(
                          APPROVED_BUTTON_ORIGINS_KEY,
                        );
                        const current = stored[APPROVED_BUTTON_ORIGINS_KEY];
                        const next: Record<string, boolean> =
                          Object.fromEntries(
                            Object.entries(
                              current &&
                                typeof current === "object" &&
                                !Array.isArray(current)
                                ? current
                                : {},
                            ).filter(([, value]) => typeof value === "boolean"),
                          );
                        delete next[origin];
                        await chrome.storage.local.set({
                          [APPROVED_BUTTON_ORIGINS_KEY]: next,
                        });
                        setApprovedButtonOrigins(next);
                      }}
                    >
                      {language === "ja" ? "解除" : "Revoke"}
                    </button>
                  </div>
                ))}
            </details>
          )}
          <label className="flex items-center gap-1 min-w-0">
            <span>{language === "ja" ? "表示編集" : "Display editing"}</span>
            <select
              aria-label={
                language === "ja"
                  ? "表示編集の許可"
                  : "Display editing permission"
              }
              title={displaySiteOrigin}
              className="border rounded p-1 min-w-0 max-w-full disabled:opacity-50"
              value={
                displayEditOrigins.includes(displaySiteOrigin)
                  ? "site"
                  : displayEditingEnabled
                    ? "once"
                    : "off"
              }
              disabled={
                displayPermissionSaving ||
                !displaySiteOrigin ||
                !browserActionsEnabled ||
                assistantSettings.mode === "read-only"
              }
              onChange={async (event) => {
                const mode = event.target.value;
                const origin = displaySiteOrigin;
                stopGeneration();
                setDisplayEditingEnabled(false);
                if (await saveDisplayPermission(origin, mode === "site")) {
                  if (displaySiteOriginRef.current === origin) {
                    displayOnceOriginRef.current =
                      mode === "once" ? origin : "";
                    setDisplayEditingEnabled(mode === "once");
                  }
                }
              }}
            >
              <option value="off">
                {language === "ja" ? "許可しない" : "Off"}
              </option>
              <option value="once">
                {language === "ja" ? "今回だけ" : "This task"}
              </option>
              <option value="site">
                {language === "ja"
                  ? "このサイトでは常に許可"
                  : "Always on this site"}
              </option>
            </select>
          </label>
          {displayPermissionError && (
            <span role="alert" className="text-red-700">
              {language === "ja"
                ? "表示編集の許可を保存できませんでした。選び直してください。"
                : "Could not save display permission. Select it again."}
            </span>
          )}
          {displayEditOrigins.length > 0 && (
            <details className="text-xs max-w-full">
              <summary className="cursor-pointer">
                {language === "ja"
                  ? "表示編集の許可サイト"
                  : "Display editing sites"}
              </summary>
              {displayEditOrigins.map((origin) => (
                <div
                  key={origin}
                  className="flex items-center gap-2 max-w-full"
                >
                  <span className="truncate" title={origin}>
                    {origin}
                  </span>
                  <button
                    type="button"
                    className="text-red-700 shrink-0"
                    disabled={displayPermissionSaving}
                    aria-label={`${origin} ${language === "ja" ? "の表示編集許可を解除" : "revoke display permission"}`}
                    onClick={() => {
                      if (origin === activeDisplayOriginRef.current)
                        stopGeneration();
                      void saveDisplayPermission(origin, false);
                    }}
                  >
                    {language === "ja" ? "解除" : "Revoke"}
                  </button>
                </div>
              ))}
            </details>
          )}
          {activeTabId !== null && undoDisplayTabIds.has(activeTabId) && (
            <button
              type="button"
              disabled={isLoading}
              className="text-blue-700 disabled:opacity-40"
              onClick={async () => {
                const tabId = activeTabId;
                const [activeTab] = await chrome.tabs
                  .query({ active: true, currentWindow: true })
                  .catch(() => []);
                if (activeTab?.id !== tabId) {
                  setActiveTabId(activeTab?.id ?? null);
                  return;
                }
                const restored = await undoLastDisplayEdit(tabId);
                if (!hasUndoableDisplayEdit(tabId))
                  setUndoDisplayTabIds((previous) => {
                    const next = new Set(previous);
                    next.delete(tabId);
                    return next;
                  });
                setMessages((previous) => [
                  ...previous,
                  {
                    role: "assistant",
                    kind: "notice",
                    content: restored
                      ? language === "ja"
                        ? "直前の表示変更を元に戻しました。"
                        : "Last display edit undone."
                      : language === "ja"
                        ? "元の要素が変わったため復元できませんでした。"
                        : "Display changed; the last edit cannot be undone.",
                  },
                ]);
              }}
            >
              {language === "ja" ? "元に戻す" : "Undo display edit"}
            </button>
          )}
          {pageOrigin &&
            Object.keys(personalValues(personalProfile)).length > 0 &&
            assistantSettings.mode !== "read-only" && (
              <label className="flex gap-2 items-start break-all">
                <input
                  type="checkbox"
                  checked={profileAuthorization === pageOrigin}
                  disabled={isLoading}
                  onChange={(event) =>
                    setProfileAuthorization(
                      event.target.checked ? pageOrigin : "",
                    )
                  }
                />
                {language === "ja"
                  ? `次のタスクで ${pageOrigin} に個人プロフィールを使用`
                  : `Use personal profile on ${pageOrigin} for the next task`}
              </label>
            )}
        </div>
        <PageContextStatus
          state={pageState}
          origin={pageOrigin}
          language={language}
          busy={isLoading || isReadingPage}
          reading={isReadingPage}
          onRead={() => void refreshPageContext()}
        />
        <Chat
          isSavingAnswer={isSavingAnswer}
          disabledReason={
            isReadingPage
              ? language === "ja"
                ? "ページ読み取り中"
                : "Reading page..."
              : !isConnected
                ? language === "ja"
                  ? "ブリッジ未接続"
                  : "Bridge disconnected"
                : bridgeCapabilities?.contextVersion !== 1
                  ? language === "ja"
                    ? "設定でブリッジの対応状況を確認してください"
                    : "Check bridge compatibility in Settings"
                  : undefined
          }
          postName={
            language === "ja" && assistantSettings.post.name === "Custom Post"
              ? "カスタム投稿"
              : assistantSettings.post.name
          }
          messages={messages}
          isLoading={isLoading}
          onSendMessage={sendMessage}
          onClearMessages={() => {
            console.log("Clear messages called");
            setMessages([]);
          }}
          onStopGeneration={stopGeneration}
          language={language}
          customPrompts={customPrompts}
          onSaveMarkdown={(message) =>
            saveAssistantMarkdown("summary", message)
          }
          onSaveBlogDraft={(message) =>
            saveAssistantMarkdown("blog-draft", message)
          }
        />
      </div>
    </div>
  );
}
