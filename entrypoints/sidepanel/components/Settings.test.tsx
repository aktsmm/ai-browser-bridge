import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getBridgeProviderStatusLabel, Settings } from "./Settings";
import type { BridgeCapabilities, LLMSettings } from "../types";
import { normalizeAssistantSettings } from "../assistant-settings";
import { PageContextStatus } from "./PageContextStatus";
import { AssistantPreferences } from "./AssistantPreferences";
import { PersonalProfileSettings } from "./PersonalProfileSettings";
import { normalizePersonalProfile } from "../personal-profile";

const noop = vi.fn();

function buildSettings(provider: LLMSettings["provider"]): LLMSettings {
  return {
    provider,
    copilot: { model: "gpt-4o" },
    lmStudio: { endpoint: "http://localhost:1234", model: "" },
    codexCli: { model: "" },
    claudeCode: { connection: "gateway", model: "" },
  };
}

function renderSettings(options?: {
  assistant?: boolean;
  provider?: LLMSettings["provider"];
  isConnected?: boolean;
  availableModels?: Array<{ provider: string; id: string; name: string }>;
  modelFetchFailed?: boolean;
  modelFetching?: boolean;
  capabilitiesRefreshing?: boolean;
  capabilities?: BridgeCapabilities | null;
  capabilitiesErrorDetail?: string | null;
  language?: "ja" | "en";
  operationMode?: "text" | "hybrid" | "screenshot";
  allowHighRiskActions?: boolean;
}) {
  return renderToStaticMarkup(
    <Settings
      assistantSettings={
        options?.assistant ? normalizeAssistantSettings(null) : undefined
      }
      onAssistantSettingsChange={noop}
      settings={buildSettings(options?.provider ?? "auto")}
      onSettingsChange={noop}
      onClose={noop}
      isConnected={options?.isConnected ?? true}
      availableModels={
        options?.availableModels ?? [
          { provider: "copilot", id: "gpt-4o", name: "GPT-4o" },
        ]
      }
      modelFetching={options?.modelFetching ?? false}
      modelFetchFailed={options?.modelFetchFailed ?? false}
      bridgeCapabilities={options?.capabilities ?? null}
      capabilitiesRefreshing={options?.capabilitiesRefreshing ?? false}
      capabilitiesErrorDetail={options?.capabilitiesErrorDetail ?? null}
      onRefreshCapabilities={noop}
      onRefreshModels={noop}
      browserActionsEnabled={true}
      onBrowserActionsChange={noop}
      fileOperationsEnabled={true}
      onFileOperationsChange={noop}
      language={options?.language ?? "en"}
      onLanguageChange={noop}
      maxAgentLoops={500}
      onMaxAgentLoopsChange={noop}
      operationMode={options?.operationMode ?? "hybrid"}
      onOperationModeChange={noop}
      serverPort={3210}
      onServerPortChange={noop}
      allowHighRiskActions={options?.allowHighRiskActions ?? true}
      onAllowHighRiskActionsChange={noop}
      allowEvaluateAction={false}
      onAllowEvaluateActionChange={noop}
      saveDestinationMode="browser-downloads"
      onSaveDestinationModeChange={noop}
      saveRelativePath="output/blog"
      onSaveRelativePathChange={noop}
      customPrompts={[]}
      onCustomPromptsChange={noop}
    />,
  );
}

describe("Settings provider UI", () => {
  it("localizes personal profile help and free-form fields", () => {
    const japanese = renderToStaticMarkup(
      <PersonalProfileSettings
        value={normalizePersonalProfile(null)}
        onChange={noop}
        language="ja"
      />,
    );
    expect(japanese).toContain("この端末のブラウザ拡張内に保存");
    expect(japanese).toContain("その他の項目");
    expect(japanese).toContain("項目を追加");
    expect(japanese).not.toContain("Remember on this device");
    const english = renderToStaticMarkup(
      <PersonalProfileSettings
        value={normalizePersonalProfile(null)}
        onChange={noop}
        language="en"
      />,
    );
    expect(english).toContain("How is this used?");
  });
  it("localizes assistant fields and explains the blank custom post preset", () => {
    const japanese = renderSettings({ assistant: true, language: "ja" });
    expect(japanese).toContain("共通の指示");
    expect(japanese).toContain("回答言語");
    expect(japanese).toContain("画面の言語に従う（日本語）");
    expect(japanese).toContain("カスタム投稿の指示を空欄にすると？");
    expect(japanese).toContain("フォーマル・140字");
    expect(japanese).toContain('value="カスタム投稿"');
    expect(japanese).toContain("<details");
    expect(japanese).not.toContain("Global instructions");

    const english = renderSettings({ assistant: true, language: "en" });
    expect(english).toContain("Global instructions");
    expect(english).toContain("Follow interface language (English)");
    expect(english).toContain("built-in formal 140-character prompt");
  });
  it("locks profile replacement while a task is running", () => {
    const html = renderToStaticMarkup(
      <AssistantPreferences
        value={normalizeAssistantSettings({
          profiles: [
            { id: "a", name: "A", instructions: "" },
            { id: "b", name: "B", instructions: "" },
          ],
        })}
        onChange={noop}
        busy
      />,
    );
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add profile/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete profile/);
  });
  it("does not confuse model generation with page acquisition", () => {
    const html = renderToStaticMarkup(
      <PageContextStatus
        state={{
          status: "ok",
          content: "page",
          frames: [{ frameId: 0 }],
          capturedAt: 0,
        }}
        origin="https://example.com"
        language="en"
        busy={true}
        onRead={noop}
      />,
    );
    expect(html).toContain("Page ready");
    expect(html).not.toContain("Reading page...");
    expect(html).not.toContain("Read current page");
    expect(html).not.toContain("frames");
  });
  it("presents page permission recovery without internal status codes", () => {
    const html = renderToStaticMarkup(
      <PageContextStatus
        state={{
          status: "permission-required",
          content: "",
          frames: [],
          capturedAt: 0,
        }}
        origin="https://example.com"
        language="en"
        busy={false}
        onRead={noop}
      />,
    );
    expect(html).toContain("Site permission required");
    expect(html).not.toContain("Allow this site");
    expect(html).toContain("Allow site access in the browser");
    expect(html).toContain("Retry reading");
    expect(html).not.toContain("permission-required");
  });
  it("uses an accessible full-height settings view with keyboard tabs", () => {
    const html = renderSettings({ assistant: true });
    expect(html).toContain('aria-label="Close settings"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="settings-tab-assistant"');
    expect(html).toContain('role="tabpanel"');
    expect(html).not.toContain("max-h-[70vh]");
  });
  it("matches runtime limits and hides unavailable legacy controls", () => {
    const html = renderSettings({ assistant: true, provider: "lm-studio" });
    expect(html).toContain('max="50"');
    expect(html).toContain("default: 20");
    expect(html).not.toContain('max="1000"');
    expect(html).not.toContain('id="evaluate-action-hint"');
    expect(html).toContain("Automatic file saving is unavailable in this mode");
  });
  it("renders explicit CLI provider choices while keeping fallback-only routes hidden", () => {
    const html = renderSettings();

    expect(html).toContain("Auto (Recommended)");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("GitHub Copilot via VS Code");
    expect(html).not.toContain("GitHub Copilot via VS Code (Chat)");
    expect(html).not.toContain("GitHub Copilot via VS Code (Agent)");
    expect(html).toContain("LM Studio");
    expect(html).toContain("OpenAI Codex CLI");
    expect(html).toContain("Claude Code");
    expect(html).toContain("run only when explicitly selected");
    expect(html).not.toContain("GitHub Copilot SDK (Agent)");
  });

  it("shows Codex and Claude provider-specific controls", () => {
    const codex = renderSettings({ provider: "codex-cli" });
    expect(codex).toContain("Codex model (optional)");
    expect(codex).toContain("Leave blank for CLI default");

    const claude = renderSettings({ provider: "claude-code" });
    expect(claude).toContain("Connection");
    expect(claude).toContain("Direct");
    expect(claude).toContain("GW");
    expect(claude).toContain("copilot/claude-opus-5");
  });

  it("disables only the unavailable Claude connection and explains recovery", () => {
    const html = renderSettings({
      provider: "claude-code",
      capabilities: {
        version: "test",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          { id: "vscode-lm", name: "VS Code", status: "available" },
          {
            id: "claude-code",
            name: "Claude Code",
            status: "available",
            connections: {
              direct: {
                status: "unavailable",
                detail: "Sign in with Claude Code, then refresh.",
              },
              gateway: { status: "available" },
            },
          },
        ],
      },
    });

    const connectionInputs = html.match(
      /<input[^>]*name="claude-connection"[^>]*>/g,
    );
    expect(connectionInputs).toHaveLength(2);
    expect(connectionInputs?.[0]).toContain('disabled=""');
    expect(connectionInputs?.[0]).not.toContain('checked=""');
    expect(connectionInputs?.[1]).not.toContain('disabled=""');
    expect(connectionInputs?.[1]).toContain('checked=""');
    expect(html).toContain("Sign in with Claude Code, then refresh.");
    expect(html).toContain(">available</span>");
  });

  it("keeps legacy bridge routes selectable but marks their status unknown", () => {
    const html = renderSettings({
      provider: "claude-code",
      capabilities: {
        version: "legacy",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          { id: "vscode-lm", name: "VS Code", status: "available" },
          { id: "claude-code", name: "Claude Code", status: "available" },
        ],
      },
    });
    const connectionInputs = html.match(
      /<input[^>]*name="claude-connection"[^>]*>/g,
    );
    expect(connectionInputs).toHaveLength(2);
    expect(
      connectionInputs?.every((input) => !input.includes("disabled")),
    ).toBe(true);
    expect(html).toContain("Connection status is unavailable");
    expect(html).toContain(">unknown</span>");
  });

  it("shows a recovery alert when both Claude connections are unavailable", () => {
    const html = renderSettings({
      provider: "claude-code",
      capabilities: {
        version: "test",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          { id: "vscode-lm", name: "VS Code", status: "available" },
          {
            id: "claude-code",
            name: "Claude Code",
            status: "unavailable",
            connections: {
              direct: { status: "unavailable" },
              gateway: { status: "unavailable" },
            },
          },
        ],
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Claude Code connections are unavailable");
    expect(html).toContain("select another provider above");
  });

  it("localizes Auto label and shows unchecked Auto route status", () => {
    const html = renderSettings({ language: "ja", provider: "auto" });

    expect(html).toContain("Auto (推奨)");
    expect(html).toContain("Auto 経路");
    expect(html).toContain("未取得");
  });

  it("shows the current Auto provider order for browser-agent modes", () => {
    const html = renderSettings({
      provider: "auto",
      operationMode: "hybrid",
      capabilities: {
        version: "0.1.16-test",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          {
            id: "copilot-sdk",
            name: "GitHub Copilot SDK",
            status: "available",
          },
          {
            id: "vscode-lm",
            name: "VS Code Language Model API",
            status: "available",
          },
          {
            id: "copilot-cli",
            name: "GitHub Copilot CLI",
            status: "unavailable",
          },
        ],
      },
    });

    expect(html).toContain("Auto route");
    expect(html).toContain(
      "Auto prioritizes VS Code LM. CLI is used only as the last answer fallback.",
    );
    expect(html.indexOf("1. VS Code LM")).toBeLessThan(
      html.indexOf("2. Copilot CLI"),
    );
  });

  it("shows VS Code LM first for Auto text mode", () => {
    const html = renderSettings({ provider: "auto", operationMode: "text" });

    expect(html).toContain(
      "Auto prioritizes VS Code LM. CLI is used only as the last answer fallback.",
    );
    expect(html.indexOf("1. VS Code LM")).toBeLessThan(
      html.indexOf("2. Copilot CLI"),
    );
  });

  it("hides Auto route details for explicit providers", () => {
    const html = renderSettings({ provider: "copilot-agent" });

    expect(html).not.toContain("Auto route");
    expect(html).not.toContain("1. Copilot SDK");
    expect(html).not.toContain("not checked");
  });

  it("localizes new provider helper text and bridge status labels", () => {
    const html = renderSettings({
      language: "ja",
      capabilities: {
        version: "0.1.16-test",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          {
            id: "vscode-lm",
            name: "VS Code Language Model API",
            status: "available",
          },
          {
            id: "copilot-sdk",
            name: "GitHub Copilot SDK",
            status: "unavailable",
            isExperimental: true,
            userSelectable: false,
          },
          { id: "copilot-cli", name: "GitHub Copilot CLI", status: "unknown" },
        ],
      },
    });

    expect(html).toContain("利用可能な bridge provider を自動選択");
    expect(html).toContain("Experimental / advanced fallback");
    expect(html).toContain(
      "Auto は既存経路だけを使います。Codex CLI と Claude Code は選択したときだけ実行します。",
    );
    expect(html).toContain("利用可能");
    expect(html).toContain("利用不可");
    expect(html).toContain("未確認");
  });

  it("maps provider status labels by locale", () => {
    expect(getBridgeProviderStatusLabel("available", "ja")).toBe("利用可能");
    expect(getBridgeProviderStatusLabel("unavailable", "ja")).toBe("利用不可");
    expect(getBridgeProviderStatusLabel("unknown", "ja")).toBe("未確認");
    expect(getBridgeProviderStatusLabel(null, "ja")).toBe("未取得");
    expect(getBridgeProviderStatusLabel("available", "en")).toBe("available");
    expect(getBridgeProviderStatusLabel(null, "en")).toBe("not checked");
  });

  it("renders bridge capabilities and provider status details", () => {
    const html = renderSettings({
      capabilities: {
        version: "0.1.16-test",
        bridge: "standalone",
        recommended: { chat: "vscode-lm", agent: "vscode-lm" },
        providers: [
          {
            id: "vscode-lm",
            name: "VS Code Language Model API",
            status: "available",
          },
          {
            id: "copilot-sdk",
            name: "GitHub Copilot SDK",
            status: "unknown",
            detail: "Runtime auth is checked on first request.",
          },
          {
            id: "copilot-cli",
            name: "GitHub Copilot CLI",
            status: "unavailable",
          },
          { id: "lm-studio", name: "LM Studio", status: "unknown" },
        ],
      },
    });

    expect(html).toContain("Bridge status");
    expect(html).toContain("Bridge version: 0.1.16-test");
    expect(html).toContain("Bridge type: standalone");
    expect(html).toContain("VS Code Language Model API");
    expect(html).toContain("available");
    expect(html).toContain("GitHub Copilot SDK");
    expect(html).toContain("Runtime auth is checked on first request.");
    expect(html).toContain("GitHub Copilot CLI");
    expect(html).toContain("unavailable");
  });

  it("shows bridge connection and capability errors in settings", () => {
    expect(renderSettings({ isConnected: false })).toContain(
      "Local bridge is not connected.",
    );

    expect(
      renderSettings({
        capabilitiesErrorDetail:
          "Capabilities request failed (401 Unauthorized)",
      }),
    ).toContain("Capabilities request failed (401 Unauthorized)");
  });

  it("shows refresh progress and disables duplicate refresh actions", () => {
    const html = renderSettings({
      modelFetching: true,
      capabilitiesRefreshing: true,
    });
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html.match(/Refreshing\.\.\./g)).toHaveLength(2);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);

    const claude = renderSettings({
      provider: "claude-code",
      capabilitiesRefreshing: true,
    });
    expect(claude).toContain('<fieldset aria-busy="true">');
  });

  it("hides the Copilot model selector for the explicit CLI provider", () => {
    const html = renderSettings({ provider: "copilot-cli" });

    expect(html).toContain(
      "Codex CLI and Claude Code run only when explicitly selected",
    );
    expect(html).not.toContain('aria-label="Model selection"');
  });

  it("explains disabled model selection with aria-describedby", () => {
    const html = renderSettings({
      availableModels: [],
      modelFetchFailed: true,
    });

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-describedby="copilot-model-help"');
    expect(html).toContain('id="copilot-model-help"');
    expect(html).toContain("failed to load the GitHub Copilot model list");
  });

  it("links the disabled evaluate toggle to its dependency hint", () => {
    const html = renderSettings({ allowHighRiskActions: false });

    expect(html).toContain('id="evaluate-action-hint"');
    expect(html).toContain('aria-describedby="evaluate-action-hint"');
  });
});
