import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getBridgeProviderStatusLabel, Settings } from "./Settings";
import type { BridgeCapabilities, LLMSettings } from "../types";

const noop = vi.fn();

function buildSettings(provider: LLMSettings["provider"]): LLMSettings {
  return {
    provider,
    copilot: { model: "gpt-4o" },
    lmStudio: { endpoint: "http://localhost:1234", model: "" },
  };
}

function renderSettings(options?: {
  provider?: LLMSettings["provider"];
  isConnected?: boolean;
  availableModels?: Array<{ provider: string; id: string; name: string }>;
  modelFetchFailed?: boolean;
  capabilities?: BridgeCapabilities | null;
  capabilitiesErrorDetail?: string | null;
  language?: "ja" | "en";
  operationMode?: "text" | "hybrid" | "screenshot";
  allowHighRiskActions?: boolean;
}) {
  return renderToStaticMarkup(
    <Settings
      settings={buildSettings(options?.provider ?? "auto")}
      onSettingsChange={noop}
      onClose={noop}
      isConnected={options?.isConnected ?? true}
      availableModels={
        options?.availableModels ?? [
          { provider: "copilot", id: "gpt-4o", name: "GPT-4o" },
        ]
      }
      modelFetchFailed={options?.modelFetchFailed ?? false}
      bridgeCapabilities={options?.capabilities ?? null}
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
  it("renders primary provider choices and keeps SDK/CLI out of normal selection", () => {
    const html = renderSettings();

    expect(html).toContain("Auto (Recommended)");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("GitHub Copilot via VS Code");
    expect(html).not.toContain("GitHub Copilot via VS Code (Chat)");
    expect(html).not.toContain("GitHub Copilot via VS Code (Agent)");
    expect(html).toContain("LM Studio");
    expect(html).toContain(
      "SDK and CLI are shown in bridge status as diagnostic/fallback routes",
    );
    expect(html).not.toContain("GitHub Copilot SDK (Agent)");
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
      "通常は Auto を使ってください。SDK / CLI は bridge 状態の診断と fallback 用に表示され、通常の provider としては選択しません。",
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

  it("hides the Copilot model selector for the explicit CLI provider", () => {
    const html = renderSettings({ provider: "copilot-cli" });

    expect(html).toContain("SDK and CLI are shown in bridge status");
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
