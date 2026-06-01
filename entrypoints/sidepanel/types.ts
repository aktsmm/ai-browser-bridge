export type OperationMode = "text" | "hybrid" | "screenshot";
export type SaveDestinationMode = "browser-downloads" | "workspace-relative";

export interface LLMSettings {
  provider:
    | "auto"
    | "copilot"
    | "copilot-agent"
    | "copilot-sdk"
    | "copilot-cli"
    | "lm-studio";
  copilot: {
    model: string;
  };
  lmStudio: {
    endpoint: string;
    model: string;
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  settings: LLMSettings;
  messages: ChatMessage[];
  pageContent: string;
  enableBrowserActions?: boolean;
  enableFileOperations?: boolean;
  attachments?: import("./attachments").ChatAttachment[];
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

export interface BridgeProviderCapability {
  id: "vscode-lm" | "copilot-sdk" | "copilot-cli" | "lm-studio";
  name: string;
  status: "available" | "unavailable" | "unknown";
  detail?: string;
  reason?: string;
  supportsChat?: boolean;
  supportsAgentLoop?: boolean;
  supportsBrowserActions?: boolean;
  supportsModelList?: boolean;
  supportsVision?: boolean;
  isExperimental?: boolean;
  userSelectable?: boolean;
  models?: ModelInfo[];
}

export interface BridgeCapabilities {
  version: string;
  bridge?: "vscode" | "standalone";
  providers: BridgeProviderCapability[];
  recommended: {
    chat: string;
    agent: string;
  };
}

// Browser Action Types (Playwright MCP compatible)
export type BrowserAction =
  | { type: "navigate"; url: string }
  | {
      type: "click";
      selector: string;
      doubleClick?: boolean;
      button?: "left" | "right" | "middle";
      modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
    }
  | {
      type: "type";
      selector: string;
      text: string;
      submit?: boolean;
      slowly?: boolean;
    }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "newTab"; url?: string }
  | { type: "closeTab" }
  | { type: "screenshot" }
  | { type: "getHtml"; selector?: string }
  | { type: "waitForSelector"; selector: string; timeout?: number }
  | { type: "waitForText"; text: string; timeout?: number }
  | { type: "waitForTextGone"; text: string; timeout?: number }
  // Form actions
  | { type: "radio"; selector: string; value?: string }
  | { type: "check"; selector: string }
  | { type: "uncheck"; selector: string }
  | { type: "select"; selector: string; value: string }
  | { type: "slider"; selector: string; value: number }
  | { type: "fillForm"; fields: FormField[] }
  | { type: "upload"; selector: string; files: string[] }
  // Mouse actions
  | { type: "drag"; startSelector: string; endSelector: string }
  | { type: "hover"; selector: string }
  | { type: "focus"; selector: string }
  | { type: "clickXY"; x: number; y: number; button?: "left" | "right" }
  // Dialog handling
  | { type: "handleDialog"; accept: boolean; promptText?: string }
  // Keyboard
  | { type: "pressKey"; key: string }
  // JavaScript evaluation (like browser_evaluate)
  | { type: "evaluate"; script: string; selector?: string }
  // Console & Network (like browser_console_messages, browser_network_requests)
  | { type: "getConsole"; level?: "error" | "warn" | "info" | "log" }
  | { type: "getNetwork"; includeStatic?: boolean }
  // Playwright passthrough
  | { type: "playwright"; action: string; params: Record<string, unknown> };

// Form field for fillForm action
export interface FormField {
  selector: string;
  value: string;
  type?: "text" | "checkbox" | "radio" | "select";
}
