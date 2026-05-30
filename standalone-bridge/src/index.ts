import { spawn, spawnSync } from "child_process";
import { readFileSync } from "fs";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
export type Provider =
  | "auto"
  | "copilot"
  | "copilot-agent"
  | "copilot-sdk"
  | "copilot-cli"
  | "lm-studio";
type Message = { role: "user" | "assistant" | "system"; content: string };
type Attachment = {
  id: string;
  name: string;
  kind: "text" | "image" | "pdf";
  mimeType: string;
  size: number;
  textContent?: string;
  dataUrl?: string;
  note?: string;
};
type ChatRequest = {
  settings: {
    provider: Provider;
    copilot: { model: string };
    lmStudio: { endpoint: string; model: string };
  };
  messages: Message[];
  pageContent: string;
  operationMode?: "text" | "hybrid" | "screenshot";
  attachments?: Attachment[];
};
type Capability = {
  id: "vscode-lm" | "copilot-sdk" | "copilot-cli" | "lm-studio";
  name: string;
  status: "available" | "unavailable" | "unknown";
  detail?: string;
};
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
const DEFAULT_ALLOWED_EXTENSION_ORIGINS = [
  "chrome-extension://nggfpdadfepkbpjfnpcihagbnnfpeian",
];
const MAX_PAGE_CONTENT_LENGTH = 50_000;
const MAX_ATTACHMENT_COUNT = 5;
const DEFAULT_PLAYWRIGHT_MCP_ENDPOINT = "http://127.0.0.1:3001/call";
const COPILOT_TIMEOUT_MS = 60_000;
const CLIENT_HEADER = "chrome-extension";
const ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;
const MAX_PLAYWRIGHT_SELECTOR_LENGTH = 5_000;
const MAX_PLAYWRIGHT_TEXT_LENGTH = 20_000;
const MAX_PLAYWRIGHT_KEY_LENGTH = 100;
const MAX_PLAYWRIGHT_RAW_LENGTH = 10_000;
const MAX_PLAYWRIGHT_OPTION_VALUE_LENGTH = 1_000;
const MAX_PLAYWRIGHT_FORM_FIELDS = 50;
const PLAYWRIGHT_MCP_TOOL_MAP = {
  browser_click: "mcp_playwright_browser_click",
  browser_type: "mcp_playwright_browser_type",
  browser_navigate: "mcp_playwright_browser_navigate",
  browser_navigate_back: "mcp_playwright_browser_navigate_back",
  browser_snapshot: "mcp_playwright_browser_snapshot",
  browser_drag: "mcp_playwright_browser_drag",
  browser_hover: "mcp_playwright_browser_hover",
  browser_select_option: "mcp_playwright_browser_select_option",
  browser_fill_form: "mcp_playwright_browser_fill_form",
  browser_wait_for: "mcp_playwright_browser_wait_for",
  browser_press_key: "mcp_playwright_browser_press_key",
  browser_tabs: "mcp_playwright_browser_tabs",
  browser_take_screenshot: "mcp_playwright_browser_take_screenshot",
  browser_close: "mcp_playwright_browser_close",
} as const;
function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function normalizeAllowedOrigins(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => ORIGIN_PATTERN.test(value));
}
function isAllowedOrigin(origin: string, configured: string[]): boolean {
  return new Set([
    ...DEFAULT_ALLOWED_EXTENSION_ORIGINS,
    ...normalizeAllowedOrigins(configured),
  ]).has(origin);
}
function hasTrustedClientHeader(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === CLIENT_HEADER;
}
function isSafeRelativePath(input: unknown): input is string {
  if (typeof input !== "string" || !input.trim()) return false;
  const normalized = input.replace(/\\/g, "/").trim();
  if (
    normalized.startsWith("/") ||
    normalized.includes("://") ||
    normalized.includes(":")
  )
    return false;
  if (normalized.endsWith("/")) return false;
  const segments = normalized.split("/");
  return !segments.some(
    (segment) => segment.length === 0 || segment === "." || segment === "..",
  );
}
function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): string | null {
  if (!isSafeRelativePath(relativePath)) return null;
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  const rootCompare = process.platform === "win32" ? root.toLowerCase() : root;
  const targetCompare =
    process.platform === "win32" ? target.toLowerCase() : target;
  if (
    targetCompare !== rootCompare &&
    !targetCompare.startsWith(`${rootCompare}${path.sep}`)
  )
    return null;
  return target;
}
function isAllowedLmStudioEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}
function isAllowedPlaywrightMcpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}
function isAllowedPlaywrightAction(action: string): boolean {
  return action in PLAYWRIGHT_MCP_TOOL_MAP;
}
function isSafeBrowserNavigationUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (trimmed === "about:blank") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function validatePlaywrightParams(
  action: string,
  params: Record<string, unknown>,
): ValidationResult<Record<string, unknown>> {
  if (action === "browser_evaluate") {
    return {
      ok: false,
      error: "browser_evaluate is blocked by the standalone bridge",
    };
  }

  if (action === "browser_navigate") {
    if (
      typeof params.url !== "string" ||
      !isSafeBrowserNavigationUrl(params.url)
    ) {
      return {
        ok: false,
        error: "browser_navigate requires a safe http(s) URL",
      };
    }
  }

  if (action === "browser_tabs") {
    const tabAction =
      typeof params.action === "string" ? params.action.trim() : "";
    const tabUrl = typeof params.url === "string" ? params.url.trim() : "";
    if (
      tabAction === "new" &&
      tabUrl.length > 0 &&
      !isSafeBrowserNavigationUrl(tabUrl)
    ) {
      return {
        ok: false,
        error: "browser_tabs new URL must be http(s) or about:blank",
      };
    }
  }

  const stringFieldChecks: Array<[string, number]> = [
    ["selector", MAX_PLAYWRIGHT_SELECTOR_LENGTH],
    ["startSelector", MAX_PLAYWRIGHT_SELECTOR_LENGTH],
    ["endSelector", MAX_PLAYWRIGHT_SELECTOR_LENGTH],
    ["element", MAX_PLAYWRIGHT_SELECTOR_LENGTH],
    ["ref", MAX_PLAYWRIGHT_SELECTOR_LENGTH],
    ["text", MAX_PLAYWRIGHT_TEXT_LENGTH],
    ["value", MAX_PLAYWRIGHT_TEXT_LENGTH],
    ["raw", MAX_PLAYWRIGHT_RAW_LENGTH],
  ];

  for (const [field, maxLength] of stringFieldChecks) {
    const value = params[field];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length > maxLength) {
        return {
          ok: false,
          error: `${field} must be a string <= ${maxLength} chars`,
        };
      }
    }
  }

  if (action === "browser_press_key") {
    if (
      typeof params.key !== "string" ||
      params.key.trim().length === 0 ||
      params.key.length > MAX_PLAYWRIGHT_KEY_LENGTH
    ) {
      return {
        ok: false,
        error: `browser_press_key key must be a non-empty string <= ${MAX_PLAYWRIGHT_KEY_LENGTH} chars`,
      };
    }
  }

  if (action === "browser_fill_form" && params.fields !== undefined) {
    if (
      !Array.isArray(params.fields) ||
      params.fields.length > MAX_PLAYWRIGHT_FORM_FIELDS
    ) {
      return {
        ok: false,
        error: `browser_fill_form fields must be an array of <= ${MAX_PLAYWRIGHT_FORM_FIELDS} items`,
      };
    }

    for (const field of params.fields) {
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        return {
          ok: false,
          error: "browser_fill_form field must be an object",
        };
      }
      const record = field as Record<string, unknown>;
      for (const key of ["name", "ref", "type", "value"] as const) {
        const value = record[key];
        if (
          value !== undefined &&
          (typeof value !== "string" ||
            value.length > MAX_PLAYWRIGHT_TEXT_LENGTH)
        ) {
          return {
            ok: false,
            error: `browser_fill_form field ${key} must be a string <= ${MAX_PLAYWRIGHT_TEXT_LENGTH} chars`,
          };
        }
      }
    }
  }

  if (action === "browser_select_option") {
    const value = params.value;
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        value.length > MAX_PLAYWRIGHT_OPTION_VALUE_LENGTH)
    ) {
      return {
        ok: false,
        error: `browser_select_option value must be a string <= ${MAX_PLAYWRIGHT_OPTION_VALUE_LENGTH} chars`,
      };
    }

    const values = params.values;
    if (values !== undefined) {
      if (
        !Array.isArray(values) ||
        values.length > MAX_PLAYWRIGHT_FORM_FIELDS
      ) {
        return {
          ok: false,
          error: `browser_select_option values must be an array of <= ${MAX_PLAYWRIGHT_FORM_FIELDS} items`,
        };
      }
      if (
        !values.every(
          (item) =>
            typeof item === "string" &&
            item.length <= MAX_PLAYWRIGHT_OPTION_VALUE_LENGTH,
        )
      ) {
        return {
          ok: false,
          error: `browser_select_option values must be strings <= ${MAX_PLAYWRIGHT_OPTION_VALUE_LENGTH} chars`,
        };
      }
    }
  }

  return { ok: true, value: params };
}
function validateChatRequest(
  body: unknown,
): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object")
    return { ok: false, error: "Invalid chat request body" };
  const request = body as Record<string, unknown>;
  const settings = request.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== "object")
    return { ok: false, error: "Invalid chat settings" };
  const provider = settings.provider;
  const allowedProviders = [
    "auto",
    "copilot",
    "copilot-agent",
    "copilot-sdk",
    "copilot-cli",
    "lm-studio",
  ];
  if (typeof provider !== "string" || !allowedProviders.includes(provider))
    return { ok: false, error: "Invalid provider" };
  if (provider !== "lm-studio") {
    const copilot = settings.copilot as Record<string, unknown> | undefined;
    if (!copilot || typeof copilot.model !== "string" || !copilot.model.trim())
      return { ok: false, error: "Invalid copilot settings" };
  }
  if (provider === "lm-studio") {
    const lmStudio = settings.lmStudio as Record<string, unknown> | undefined;
    if (
      !lmStudio ||
      typeof lmStudio.endpoint !== "string" ||
      typeof lmStudio.model !== "string"
    )
      return { ok: false, error: "Invalid lmStudio settings" };
    if (!lmStudio.endpoint.trim())
      return { ok: false, error: "Invalid lmStudio endpoint" };
    if (!isAllowedLmStudioEndpoint(lmStudio.endpoint))
      return {
        ok: false,
        error: "LM Studio endpoint must use a localhost or loopback address",
      };
  }
  if (typeof request.pageContent !== "string")
    return { ok: false, error: "Invalid pageContent" };
  if (request.pageContent.length > MAX_PAGE_CONTENT_LENGTH)
    return {
      ok: false,
      error: `pageContent exceeds ${MAX_PAGE_CONTENT_LENGTH} characters`,
    };
  if (!Array.isArray(request.messages))
    return { ok: false, error: "Invalid messages" };
  const roles = new Set(["user", "assistant", "system"]);
  for (const message of request.messages) {
    if (!message || typeof message !== "object")
      return { ok: false, error: "Invalid message item" };
    const item = message as Record<string, unknown>;
    if (typeof item.role !== "string" || !roles.has(item.role))
      return { ok: false, error: "Invalid message role" };
    if (typeof item.content !== "string")
      return { ok: false, error: "Invalid message content" };
  }
  if (request.attachments !== undefined) {
    if (!Array.isArray(request.attachments))
      return { ok: false, error: "Invalid attachments" };
    if (request.attachments.length > MAX_ATTACHMENT_COUNT)
      return {
        ok: false,
        error: `attachments exceed ${MAX_ATTACHMENT_COUNT} items`,
      };
  }
  return { ok: true, value: request as ChatRequest };
}
function buildSystemPrompt(pageContent: string, agentMode = false): string {
  const actionDoc = `Use ACTION commands only when browser interaction is needed. Examples: [ACTION: click, ref:e5], [ACTION: type, ref:e5, text], [ACTION: navigate, https://example.com], [ACTION: screenshot]. Use FILE commands for artifacts: [FILE: create, output/report.md, content]. Respond in the user's language.`;
  if (!pageContent.trim())
    return `You are a helpful browser assistant. ${actionDoc}`;
  const page = pageContent.slice(0, agentMode ? 12_000 : 20_000);
  return `You are a helpful browser assistant. Analyze the current page and answer concisely.\n\n---PAGE CONTENT---\n${page}\n---END PAGE CONTENT---\n\n${actionDoc}`;
}
function attachmentText(attachments: Attachment[] | undefined): string {
  if (!attachments?.length) return "";
  return `\n\nAttached files:\n${attachments
    .map((attachment) => {
      if (attachment.kind === "text" && attachment.textContent)
        return `- ${attachment.name} (text)\n${attachment.textContent}`;
      if (attachment.kind === "pdf")
        return `- ${attachment.name} (pdf) ${attachment.note || "Text extraction skipped."}`;
      return `- ${attachment.name} (${attachment.kind})`;
    })
    .join("\n")}`;
}
function buildPrompt(
  systemPrompt: string,
  messages: Message[],
  mode: "chat" | "agent",
  attachments?: Attachment[],
): string {
  const conversation = messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  const modeNote =
    mode === "agent"
      ? "Mode: browser-agent-lite. Do not request OS/file/MCP tools; emit only ACTION/FILE DSL."
      : "Mode: chat.";
  return [
    systemPrompt.trim() + attachmentText(attachments),
    "",
    modeNote,
    "Respond in the user's language.",
    "",
    conversation,
  ]
    .filter(Boolean)
    .join("\n");
}
function resolveCopilotCommand(): string {
  if (process.platform !== "win32") return "copilot";
  try {
    const result = spawnSync("where.exe", ["copilot"], {
      encoding: "utf8",
      shell: false,
    });
    return (
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || "copilot"
    );
  } catch {
    return "copilot";
  }
}
function buildSpawnSpec(command: string): {
  command: string;
  prefix: string[];
} {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".ps1"))
    return { command: "pwsh", prefix: ["-NoProfile", "-File", command] };
  return { command, prefix: [] };
}
function runCommand(
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new Error("GitHub Copilot CLI request aborted"));
    const spec = buildSpawnSpec(resolveCopilotCommand());
    const child = spawn(spec.command, [...spec.prefix, ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
      callback();
    };
    const abortHandler = () =>
      finish(() => {
        child.kill();
        reject(new Error("GitHub Copilot CLI request aborted"));
      });
    const timeout = setTimeout(
      () =>
        finish(() => {
          child.kill();
          reject(new Error("GitHub Copilot CLI timed out after 30000ms"));
        }),
      30_000,
    );
    signal?.addEventListener("abort", abortHandler, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) =>
      finish(() => resolve({ stdout, stderr, exitCode })),
    );
  });
}
async function isCliAvailable(): Promise<boolean> {
  try {
    return (await runCommand(["--version"])).exitCode === 0;
  } catch {
    return false;
  }
}
async function isSdkAvailable(): Promise<boolean> {
  try {
    await import("@github/copilot-sdk");
    return true;
  } catch {
    return false;
  }
}
async function runCliPrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await runCommand(["-p", prompt, "--silent"], signal);
  if (result.exitCode !== 0)
    throw new Error(
      result.stderr.trim() ||
        `GitHub Copilot CLI exited with code ${result.exitCode ?? "unknown"}`,
    );
  const output = result.stdout.trim();
  if (!output) throw new Error("GitHub Copilot CLI returned an empty response");
  return output;
}
async function runSdkPrompt(
  prompt: string,
  model: string,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<string> {
  const { CopilotClient } = (await import("@github/copilot-sdk")) as any;
  const client = new CopilotClient({
    workingDirectory: workspaceRoot,
    logLevel: "error",
  });
  let session: any;
  const timeout = setTimeout(() => {
    void session?.abort?.().catch(() => undefined);
  }, COPILOT_TIMEOUT_MS);
  const abortHandler = () => {
    void session?.abort?.().catch(() => undefined);
  };
  signal?.addEventListener("abort", abortHandler, { once: true });
  try {
    session = await client.createSession({
      model: model.trim() || undefined,
      streaming: false,
      enableConfigDiscovery: false,
      skipCustomInstructions: true,
      availableTools: [],
      excludedTools: ["builtin:*", "mcp:*", "custom:*"],
      onPermissionRequest: () => ({
        kind: "reject",
        feedback:
          "Standalone bridge blocks SDK tool requests. Use ACTION/FILE DSL instead.",
      }),
    });
    const response = await session.sendAndWait({ prompt }, COPILOT_TIMEOUT_MS);
    const content = response?.data?.content?.trim();
    if (!content)
      throw new Error("GitHub Copilot SDK returned an empty response");
    return content;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortHandler);
    await session?.disconnect?.().catch(() => undefined);
    await client.stop().catch(() => []);
  }
}
async function chatWithLMStudio(
  request: ChatRequest,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint =
    request.settings.lmStudio.endpoint || "http://localhost:1234";
  if (!isAllowedLmStudioEndpoint(endpoint))
    return "エラー: LM Studio エンドポイントは localhost または loopback のみ許可されています。";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.settings.lmStudio.model || "local-model",
        messages: [
          {
            role: "system",
            content: systemPrompt + attachmentText(request.attachments),
          },
          ...request.messages,
        ],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      return `エラー: LM Studio接続失敗 (${response.status})\n${await response.text().catch(() => "")}`;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (
      payload.choices?.[0]?.message?.content?.trim() ||
      "エラー: LM Studio returned an empty response"
    );
  } catch (error) {
    return `エラー: LM Studioに接続できません。\n\n確認事項:\n1. LM Studioが起動しているか\n2. サーバーがStartedになっているか (Local Server → Start)\n3. エンドポイントが正しいか (デフォルト: http://localhost:1234)\n\n詳細: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeout);
  }
}
export class StandaloneBridgeServer {
  private server: http.Server | null = null;
  constructor(
    private port: number,
    private version: string,
    private workspaceRoot: string,
    private allowedOrigins: string[],
    private playwrightMcpEndpoint = DEFAULT_PLAYWRIGHT_MCP_ENDPOINT,
  ) {}
  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.route(req, res);
    });
    return new Promise((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error("Server initialization failed"));
      server.once("listening", () => {
        console.log(
          `GitHub Copilot Browser Bridge standalone: listening on http://127.0.0.1:${this.port}`,
        );
        resolve();
      });
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1");
    });
  }
  stop(): void {
    this.server?.close();
    this.server = null;
  }
  private async route(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (origin && !isAllowedOrigin(origin, this.allowedOrigins))
      return json(res, 403, { error: "Forbidden origin" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Copilot-Bridge-Client",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const isHealth = url.pathname === "/health" && req.method === "GET";
    if (
      !isHealth &&
      !hasTrustedClientHeader(req.headers["x-copilot-bridge-client"])
    )
      return json(res, 401, { error: "Unauthorized client" });
    if (isHealth)
      return json(res, 200, {
        status: "ok",
        version: this.version,
        bridge: "standalone",
      });
    if (url.pathname === "/models" && req.method === "GET")
      return json(res, 200, await this.models());
    if (url.pathname === "/capabilities" && req.method === "GET")
      return json(res, 200, {
        version: this.version,
        bridge: "standalone",
        providers: await this.capabilities(),
        recommended: { chat: "copilot-sdk", agent: "copilot-sdk" },
      });
    if (url.pathname === "/playwright/status" && req.method === "GET")
      return this.handlePlaywrightStatus(res);
    if (url.pathname === "/playwright" && req.method === "POST")
      return this.handlePlaywrightAction(req, res);
    if (url.pathname === "/file" && req.method === "POST")
      return this.handleFile(req, res);
    if (url.pathname === "/chat" && req.method === "POST")
      return this.handleChat(req, res);
    return json(res, 404, { error: "Not found" });
  }
  private async models() {
    const models = [
      {
        provider: "copilot-sdk",
        id: "sdk-agent",
        name: "GitHub Copilot SDK (Agent)",
      },
      { provider: "lm-studio", id: "local", name: "LM Studio (Local)" },
    ];
    if (await isCliAvailable())
      models.push({
        provider: "copilot-cli",
        id: "cli-fallback",
        name: "GitHub Copilot CLI",
      });
    return models;
  }
  private async capabilities(): Promise<Capability[]> {
    const sdk = await isSdkAvailable();
    const cli = await isCliAvailable();
    return [
      {
        id: "vscode-lm",
        name: "VS Code Language Model API",
        status: "unavailable",
        detail: "The standalone bridge does not host VS Code language models.",
      },
      {
        id: "copilot-sdk",
        name: "GitHub Copilot SDK",
        status: sdk ? "available" : "unavailable",
        detail: sdk
          ? "Runtime authentication is checked on the first SDK request."
          : "@github/copilot-sdk could not be loaded by the standalone bridge process.",
      },
      {
        id: "copilot-cli",
        name: "GitHub Copilot CLI",
        status: cli ? "available" : "unavailable",
        detail: cli
          ? undefined
          : "Copilot CLI command was not available to the standalone bridge process.",
      },
      {
        id: "lm-studio",
        name: "LM Studio",
        status: "unknown",
        detail: "Endpoint health depends on the side panel LM Studio settings.",
      },
    ];
  }
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
  private async handlePlaywrightStatus(
    res: http.ServerResponse,
  ): Promise<void> {
    if (!isAllowedPlaywrightMcpEndpoint(this.playwrightMcpEndpoint)) {
      return json(res, 200, {
        available: false,
        version: this.version,
        detail: "Playwright MCP endpoint must use localhost or loopback.",
      });
    }

    const available = await this.isPlaywrightMcpAvailable();
    return json(res, 200, {
      available,
      version: this.version,
      detail: available
        ? undefined
        : "Playwright MCP did not respond on the configured endpoint.",
    });
  }
  private async isPlaywrightMcpAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        this.playwrightMcpEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "browser_tabs",
            arguments: { action: "list" },
          }),
        },
        1500,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
  private validatePlaywrightRequest(request: unknown): ValidationResult<{
    action: string;
    params: Record<string, unknown>;
  }> {
    if (!request || typeof request !== "object") {
      return { ok: false, error: "Invalid playwright request body" };
    }

    const body = request as Record<string, unknown>;
    const action =
      typeof body.action === "string" ? body.action.trim() : undefined;
    if (!action) return { ok: false, error: "Invalid playwright action" };
    if (!isAllowedPlaywrightAction(action)) {
      return { ok: false, error: `Unknown playwright action: ${action}` };
    }

    const params = body.params;
    if (
      params !== undefined &&
      (params === null || typeof params !== "object" || Array.isArray(params))
    ) {
      return { ok: false, error: "Invalid playwright params" };
    }

    const validatedParams = validatePlaywrightParams(
      action,
      (params ?? {}) as Record<string, unknown>,
    );
    if (!validatedParams.ok) return validatedParams;

    return { ok: true, value: { action, params: validatedParams.value } };
  }
  private async handlePlaywrightAction(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!isAllowedPlaywrightMcpEndpoint(this.playwrightMcpEndpoint)) {
      return json(res, 400, {
        success: false,
        error: "Playwright MCP endpoint must use localhost or loopback.",
      });
    }

    const raw = await this.readJson(req, res);
    if (raw === null) return;
    const validation = this.validatePlaywrightRequest(raw);
    if (!validation.ok) {
      return json(res, 400, { success: false, error: validation.error });
    }

    const result = await this.executePlaywrightMcpAction(
      validation.value.action,
      validation.value.params,
    );
    return json(res, result.success ? 200 : (result.statusCode ?? 502), result);
  }
  private async closeCurrentPlaywrightTabBestEffort(): Promise<void> {
    try {
      await this.fetchWithTimeout(
        this.playwrightMcpEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "browser_tabs",
            arguments: { action: "close" },
          }),
        },
        5000,
      );
    } catch {
      // Best-effort rollback only.
    }
  }
  private async executePlaywrightMcpAction(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    statusCode?: number;
    message?: string;
    error?: string;
    data?: unknown;
  }> {
    const mcpTool =
      PLAYWRIGHT_MCP_TOOL_MAP[action as keyof typeof PLAYWRIGHT_MCP_TOOL_MAP];
    if (!mcpTool) {
      return {
        success: false,
        statusCode: 400,
        error: `Unknown Playwright action: ${action}`,
      };
    }

    try {
      const tabAction =
        action === "browser_tabs" && typeof params.action === "string"
          ? params.action.trim()
          : "";
      const tabUrl =
        action === "browser_tabs" && typeof params.url === "string"
          ? params.url.trim()
          : "";

      if (tabAction === "new" && tabUrl.length > 0) {
        const openTabResponse = await this.callPlaywrightMcp("browser_tabs", {
          action: "new",
        });
        if (!openTabResponse.ok) return openTabResponse.error;

        const navigateResponse = await this.callPlaywrightMcp(
          "browser_navigate",
          { url: tabUrl },
        );
        if (!navigateResponse.ok) {
          await this.closeCurrentPlaywrightTabBestEffort();
          return navigateResponse.error;
        }

        return {
          success: true,
          message: `Executed ${action}`,
          data: {
            openTab: openTabResponse.data,
            navigate: navigateResponse.data,
          },
        };
      }

      const response = await this.callPlaywrightMcp(
        mcpTool.replace("mcp_playwright_", ""),
        params,
      );
      if (!response.ok) return response.error;
      return {
        success: true,
        message: `Executed ${action}`,
        data: response.data,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      return {
        success: false,
        statusCode: isTimeout ? 504 : 503,
        error: `Failed to execute ${action}: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
  private async callPlaywrightMcp(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<
    | { ok: true; data: unknown }
    | {
        ok: false;
        error: { success: false; statusCode: number; error: string };
      }
  > {
    const response = await this.fetchWithTimeout(
      this.playwrightMcpEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, arguments: args }),
      },
      10000,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        ok: false,
        error: {
          success: false,
          statusCode: 502,
          error: `MCP error: ${response.status} - ${errorText}`,
        },
      };
    }

    return { ok: true, data: await response.json() };
  }
  private async body(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 5 * 1024 * 1024) {
          reject(new Error("REQUEST_TOO_LARGE"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  private async readJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<unknown | null> {
    try {
      const body = await this.body(req);
      if (!body.trim()) {
        json(res, 400, { error: "Request body is required" });
        return null;
      }
      return JSON.parse(body);
    } catch (error) {
      json(
        res,
        error instanceof Error && error.message === "REQUEST_TOO_LARGE"
          ? 413
          : 400,
        {
          error:
            error instanceof Error && error.message === "REQUEST_TOO_LARGE"
              ? "Request body too large"
              : "Invalid JSON body",
        },
      );
      return null;
    }
  }
  private async handleChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const raw = await this.readJson(req, res);
    if (raw === null) return;
    const validation = validateChatRequest(raw);
    if (!validation.ok) return json(res, 400, { error: validation.error });
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });
    const abort = new AbortController();
    req.on("aborted", () => abort.abort());
    req.on("close", () => abort.abort());
    try {
      for await (const chunk of this.chat(validation.value, abort.signal)) {
        if (abort.signal.aborted || res.destroyed) break;
        res.write(chunk);
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          `\n\nエラー: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        res.end();
      }
    }
  }
  private async *chat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const agent = request.operationMode !== "text";
    const system = buildSystemPrompt(request.pageContent, agent);
    if (
      request.settings.provider === "copilot" ||
      request.settings.provider === "copilot-agent"
    ) {
      yield "エラー: この provider は VS Code bridge 専用です。standalone bridge では Auto / GitHub Copilot SDK / GitHub Copilot CLI / LM Studio を選択してください。";
      return;
    }
    if (request.settings.provider === "lm-studio") {
      yield await chatWithLMStudio(request, system, signal);
      return;
    }
    if (request.settings.provider === "copilot-cli") {
      yield "[GitHub Copilot CLI]\n\n";
      yield await runCliPrompt(
        buildPrompt(
          system,
          request.messages,
          agent ? "agent" : "chat",
          request.attachments,
        ),
        signal,
      );
      return;
    }
    try {
      yield "[GitHub Copilot SDK]\n\n";
      yield await runSdkPrompt(
        buildPrompt(
          system,
          request.messages,
          agent ? "agent" : "chat",
          request.attachments,
        ),
        request.settings.copilot.model,
        this.workspaceRoot,
        signal,
      );
    } catch (error) {
      if (request.settings.provider !== "auto") throw error;
      yield `\n\n[Auto fallback: copilot-sdk unavailable]\n`;
      yield "[GitHub Copilot CLI]\n\n";
      yield await runCliPrompt(
        buildPrompt(
          system,
          request.messages,
          agent ? "agent" : "chat",
          request.attachments,
        ),
        signal,
      );
    }
  }
  private async handleFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const raw = await this.readJson(req, res);
    if (raw === null) return;
    const body = raw as Record<string, unknown>;
    if (
      body.action !== "create" &&
      body.action !== "append" &&
      body.action !== "read" &&
      body.action !== "delete"
    )
      return json(res, 400, { error: "Invalid action" });
    if (!isSafeRelativePath(body.path))
      return json(res, 400, { error: "Invalid file path" });
    if (body.content !== undefined && typeof body.content !== "string")
      return json(res, 400, { error: "Invalid file content" });
    const target = resolveWorkspacePath(this.workspaceRoot, body.path);
    if (!target) return json(res, 400, { error: "Path escapes workspace" });
    try {
      if (body.action === "create") {
        await fs.mkdir(path.dirname(target), { recursive: true });
        try {
          await fs.access(target);
          return json(res, 409, { error: "File already exists" });
        } catch {
          await fs.writeFile(target, body.content || "", "utf8");
        }
      } else if (body.action === "append") {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.appendFile(target, body.content || "", "utf8");
      } else if (body.action === "read") {
        return json(res, 200, {
          success: true,
          content: await fs.readFile(target, "utf8"),
        });
      } else {
        await fs.rm(target, { force: true });
      }
      return json(res, 200, {
        success: true,
        message: `${body.action} ${body.path}`,
      });
    } catch (error) {
      return json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
function packageVersion(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    return (
      JSON.parse(
        readFileSync(path.resolve(currentDir, "../../package.json"), "utf8"),
      ).version || "0.1.0"
    );
  } catch {
    return "0.1.0";
  }
}
function parseArgs(argv: string[]) {
  let port = Number(process.env.COPILOT_BROWSER_BRIDGE_PORT || "3210");
  let workspaceRoot = path.resolve(
    process.env.COPILOT_BROWSER_BRIDGE_WORKSPACE_ROOT || process.cwd(),
  );
  let playwrightMcpEndpoint =
    process.env.COPILOT_BROWSER_BRIDGE_PLAYWRIGHT_MCP_ENDPOINT ||
    DEFAULT_PLAYWRIGHT_MCP_ENDPOINT;
  const origins = (process.env.COPILOT_BROWSER_BRIDGE_ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--port" || argv[i] === "-p") && argv[i + 1])
      port = Number(argv[++i]);
    else if (
      (argv[i] === "--workspace-root" || argv[i] === "-w") &&
      argv[i + 1]
    )
      workspaceRoot = path.resolve(argv[++i]);
    else if ((argv[i] === "--allow-origin" || argv[i] === "-o") && argv[i + 1])
      origins.push(argv[++i]);
    else if (argv[i] === "--playwright-mcp-endpoint" && argv[i + 1])
      playwrightMcpEndpoint = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: npm run start -- --port 3210 --workspace-root <path> [--allow-origin chrome-extension://...] [--playwright-mcp-endpoint http://127.0.0.1:3001/call]",
      );
      process.exit(0);
    }
  }
  return {
    port,
    workspaceRoot,
    origins: normalizeAllowedOrigins(origins),
    playwrightMcpEndpoint,
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const options = parseArgs(process.argv.slice(2));
  const server = new StandaloneBridgeServer(
    options.port,
    packageVersion(),
    options.workspaceRoot,
    options.origins,
    options.playwrightMcpEndpoint,
  );
  await server.start();
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
