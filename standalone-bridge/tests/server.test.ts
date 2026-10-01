import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StandaloneBridgeServer,
  buildSystemPrompt,
  buildRestrictedCopilotCliArgs,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_HISTORY_LENGTH,
} from "../src/index.js";
const TRUSTED_HEADERS = { "X-Copilot-Bridge-Client": "chrome-extension" };
const sdkProbe = vi.hoisted(() => ({
  hold: false,
  started: false,
  aborted: false,
  release: undefined as (() => void) | undefined,
}));
const cliProbe = {
  availabilityCalls: [] as Array<{
    provider: "codex-cli" | "claude-code";
    connection?: "direct" | "gateway";
    forceRefresh?: boolean;
  }>,
  calls: [] as Array<{
    settings: {
      provider: "codex-cli" | "claude-code";
      model: string;
      connection?: "direct" | "gateway";
    };
    prompt: string;
  }>,
  async isAvailable(
    provider: "codex-cli" | "claude-code",
    connection?: "direct" | "gateway",
    forceRefresh?: boolean,
  ) {
    cliProbe.availabilityCalls.push({
      provider,
      connection,
      forceRefresh,
    });
    return provider === "codex-cli" || connection === "gateway";
  },
  async runPrompt(
    settings: {
      provider: "codex-cli" | "claude-code";
      model: string;
      connection?: "direct" | "gateway";
    },
    prompt: string,
  ) {
    cliProbe.calls.push({ settings, prompt });
    return `Synthetic ${settings.provider} reply`;
  },
};
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {
    async createSession() {
      return {
        sendAndWait: async () => {
          sdkProbe.started = true;
          if (sdkProbe.hold)
            await new Promise<void>((resolve) => {
              sdkProbe.release = resolve;
            });
          else await new Promise<void>((resolve) => setImmediate(resolve));
          return { data: { content: "Delayed synthetic SDK reply" } };
        },
        abort: async () => {
          sdkProbe.aborted = true;
          sdkProbe.release?.();
        },
        disconnect: async () => {},
      };
    }
    async stop() {
      return [];
    }
  },
}));
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("Failed to acquire a free port")));
      }
    });
  });
}
function startFakeMcpServer(
  handler: (body: Record<string, unknown>) => {
    status?: number;
    body: unknown;
  },
): Promise<{
  endpoint: string;
  calls: Record<string, unknown>[];
  stop: () => Promise<void>;
}> {
  const calls: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      calls.push(body);
      const result = handler(body);
      res.writeHead(result.status ?? 200, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(result.body));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() =>
          reject(new Error("Failed to start fake MCP server")),
        );
        return;
      }
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/call`,
        calls,
        stop: () =>
          new Promise((stopResolve) => server.close(() => stopResolve())),
      });
    });
  });
}
describe("standalone bridge server", () => {
  it("denies native CLI tools rather than relying on page/prompt instructions", () => {
    expect(buildRestrictedCopilotCliArgs("Synthetic prompt")).toEqual([
      "-p",
      "Synthetic prompt",
      "--silent",
      "--available-tools=__browser_bridge_no_native_tools__",
      "--deny-tool=shell",
      "--deny-tool=write",
      "--deny-tool=read",
      "--no-custom-instructions",
      "--no-ask-user",
    ]);
  });
  let server: StandaloneBridgeServer;
  let baseUrl: string;
  let workspaceRoot: string;
  beforeEach(async () => {
    sdkProbe.hold = false;
    sdkProbe.started = false;
    sdkProbe.aborted = false;
    sdkProbe.release = undefined;
    cliProbe.calls = [];
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "bridge-standalone-"),
    );
    const port = await getFreePort();
    server = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      undefined,
      cliProbe,
    );
    await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterEach(() => {
    server.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  it.each([
    {
      name: "message count",
      contents: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => "a"),
    },
    {
      name: "message length",
      contents: ["a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)],
    },
    {
      name: "history length",
      contents: [
        ...Array.from(
          { length: MAX_CHAT_HISTORY_LENGTH / MAX_CHAT_MESSAGE_LENGTH },
          () => "a".repeat(MAX_CHAT_MESSAGE_LENGTH),
        ),
        "a",
      ],
    },
  ])(
    "rejects oversized $name before invoking the provider",
    async ({ contents }) => {
      const response = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { provider: "copilot-sdk", copilot: { model: "" } },
          pageContent: "Synthetic page",
          messages: contents.map((content) => ({ role: "user", content })),
        }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("before retrying");
      expect(sdkProbe.started).toBe(false);
    },
  );
  it("accepts the cumulative history boundary without silently trimming it", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { provider: "copilot-sdk", copilot: { model: "" } },
        pageContent: "Synthetic page",
        messages: Array.from(
          { length: MAX_CHAT_HISTORY_LENGTH / MAX_CHAT_MESSAGE_LENGTH },
          () => ({
            role: "user",
            content: "a".repeat(MAX_CHAT_MESSAGE_LENGTH),
          }),
        ),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Delayed synthetic SDK reply");
    expect(sdkProbe.started).toBe(true);
  });
  it("keeps a delayed provider reply alive after the request body completes", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          provider: "copilot-sdk",
          copilot: { model: "" },
          lmStudio: { endpoint: "http://127.0.0.1:1234", model: "" },
        },
        messages: [
          { role: "user", content: "Reply on this synthetic test only." },
        ],
        pageContent: "Synthetic local page",
        operationMode: "text",
        context: {
          version: 1,
          mode: "read-only",
          allowedActions: [],
          pageStatus: "ok",
          globalInstructions: "",
          profileInstructions: "",
          taskInstructions: "",
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Delayed synthetic SDK reply");
  });
  it("aborts the provider when the response connection is cancelled", async () => {
    sdkProbe.hold = true;
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        settings: {
          provider: "copilot-sdk",
          copilot: { model: "" },
          lmStudio: { endpoint: "http://localhost:1234", model: "" },
        },
        messages: [{ role: "user", content: "Synthetic cancellation test" }],
        pageContent: "Synthetic page",
        operationMode: "text",
      }),
    }).catch(() => undefined);
    await vi.waitFor(() => expect(sdkProbe.started).toBe(true));
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(sdkProbe.aborted).toBe(true));
  });
  it("coalesces repeated starts and can restart without losing the server", async () => {
    const first = server.start();
    expect(server.start()).toBe(first);
    await first;
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    server.stop();
    const restarting = server.start();
    expect(server.start()).toBe(restarting);
    await restarting;
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  });
  it("settles a cancelled startup", async () => {
    const transient = new StandaloneBridgeServer(
      await getFreePort(),
      "test",
      workspaceRoot,
      [],
    );
    const starting = transient.start();
    const rejected = expect(starting).rejects.toThrow(
      "Server startup cancelled",
    );
    transient.stop();
    await rejected;
  });
  it("allows the health check without auth headers", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; bridge: string };
    expect(body.status).toBe("ok");
    expect(body.bridge).toBe("standalone");
  });
  it("rejects protected routes without the trusted client header", async () => {
    const response = await fetch(`${baseUrl}/models`);
    expect(response.status).toBe(401);
  });
  it("authorizes trusted clients without an Origin header", async () => {
    const response = await fetch(`${baseUrl}/__unknown_route__`, {
      headers: TRUSTED_HEADERS,
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Not found");
  });
  it("returns capabilities to trusted extension clients", async () => {
    const response = await fetch(`${baseUrl}/capabilities`, {
      headers: TRUSTED_HEADERS,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recommended: { chat: string; agent: string };
      bridge: string;
      providers: Array<{ id: string }>;
    };
    expect(body.recommended).toEqual({
      chat: "copilot-sdk",
      agent: "copilot-sdk",
    });
    expect(body.bridge).toBe("standalone");
    expect(body.providers.map((provider) => provider.id)).toEqual([
      "vscode-lm",
      "copilot-sdk",
      "copilot-cli",
      "codex-cli",
      "claude-code",
      "lm-studio",
    ]);
    expect(body.providers).toContainEqual(
      expect.objectContaining({
        id: "vscode-lm",
        status: "unavailable",
        userSelectable: false,
      }),
    );
    expect(body.providers).toContainEqual(
      expect.objectContaining({
        id: "copilot-sdk",
        isExperimental: true,
        userSelectable: false,
      }),
    );
  });
  it.each([
    { provider: "codex-cli", settings: {} },
    { provider: "claude-code", settings: {} },
    {
      provider: "claude-code",
      settings: { claudeCode: { connection: "invalid", model: "claude" } },
    },
  ])("rejects invalid $provider settings", async ({ provider, settings }) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { provider, ...settings },
        pageContent: "Synthetic page",
        messages: [{ role: "user", content: "Synthetic request" }],
      }),
    });
    expect(response.status).toBe(400);
    expect(sdkProbe.started).toBe(false);
    expect(cliProbe.calls).toHaveLength(0);
  });
  it("rejects an unknown provider without entering SDK fallback", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { provider: "unknown-provider" },
        pageContent: "Synthetic page",
        messages: [{ role: "user", content: "Synthetic request" }],
      }),
    });
    expect(response.status).toBe(400);
    expect(sdkProbe.started).toBe(false);
    expect(cliProbe.calls).toHaveLength(0);
  });
  it("keeps a VS Code-only provider out of SDK fallback", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { provider: "copilot", copilot: { model: "synthetic" } },
        pageContent: "Synthetic page",
        messages: [{ role: "user", content: "Synthetic request" }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("VS Code bridge");
    expect(sdkProbe.started).toBe(false);
    expect(cliProbe.calls).toHaveLength(0);
  });
  it("reports Claude Direct and GW availability without swapping routes", async () => {
    cliProbe.availabilityCalls.length = 0;
    const response = await fetch(`${baseUrl}/capabilities`, {
      headers: TRUSTED_HEADERS,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      providers: Array<{
        id: string;
        connections?: {
          direct?: { status: string };
          gateway?: { status: string };
        };
      }>;
    };
    const claude = body.providers.find(
      (provider) => provider.id === "claude-code",
    );
    expect(claude?.connections?.direct?.status).toBe("unavailable");
    expect(claude?.connections?.gateway?.status).toBe("available");
    expect(cliProbe.availabilityCalls).toEqual([
      { provider: "codex-cli", connection: "direct", forceRefresh: true },
      { provider: "claude-code", connection: "direct", forceRefresh: true },
      { provider: "claude-code", connection: "gateway", forceRefresh: true },
    ]);
  });
  it.each([
    {
      provider: "codex-cli",
      providerSettings: { codexCli: { model: "gpt-5.4" } },
      expected: {
        provider: "codex-cli",
        model: "gpt-5.4",
      },
    },
    {
      provider: "claude-code",
      providerSettings: {
        claudeCode: { connection: "gateway", model: "copilot/claude-opus-5" },
      },
      expected: {
        provider: "claude-code",
        connection: "gateway",
        model: "copilot/claude-opus-5",
      },
    },
  ])(
    "dispatches $provider explicitly without entering Auto fallback",
    async ({ provider, providerSettings, expected }) => {
      const response = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { ...TRUSTED_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { provider, ...providerSettings },
          pageContent: "Synthetic page",
          messages: [{ role: "user", content: "Synthetic request" }],
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`Synthetic ${provider} reply`);
      expect(cliProbe.calls).toHaveLength(1);
      expect(cliProbe.calls[0].settings).toEqual(expected);
      expect(sdkProbe.started).toBe(false);
    },
  );
  it("supports workspace-relative file creation", async () => {
    const response = await fetch(`${baseUrl}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
      body: JSON.stringify({
        action: "create",
        path: "output/hello.md",
        content: "hello",
      }),
    });
    expect(response.status).toBe(200);
    expect(
      fs.readFileSync(path.join(workspaceRoot, "output", "hello.md"), "utf8"),
    ).toBe("hello");
  });
  it("reports Playwright as unavailable", async () => {
    const response = await fetch(`${baseUrl}/playwright/status`, {
      headers: TRUSTED_HEADERS,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { available: boolean };
    expect(body.available).toBe(false);
  });
  it("reports Playwright as available when the MCP endpoint responds", async () => {
    const fakeMcp = await startFakeMcpServer((body) => ({
      body: { ok: true, echo: body },
    }));
    const port = await getFreePort();
    const mcpBackedServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      fakeMcp.endpoint,
    );
    await mcpBackedServer.start();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/playwright/status`,
        {
          headers: TRUSTED_HEADERS,
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { available: boolean };
      expect(body.available).toBe(true);
      expect(fakeMcp.calls[0]).toEqual({
        tool: "browser_tabs",
        arguments: { action: "list" },
      });
    } finally {
      mcpBackedServer.stop();
      await fakeMcp.stop();
    }
  });
  it("proxies Playwright actions to the configured MCP endpoint", async () => {
    const fakeMcp = await startFakeMcpServer((body) => ({
      body: { success: true, echo: body },
    }));
    const port = await getFreePort();
    const mcpBackedServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      fakeMcp.endpoint,
    );
    await mcpBackedServer.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/playwright`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
        body: JSON.stringify({
          action: "browser_click",
          params: { ref: "e1" },
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success: boolean;
        data: unknown;
      };
      expect(body.success).toBe(true);
      expect(fakeMcp.calls[0]).toEqual({
        tool: "browser_click",
        arguments: { ref: "e1" },
      });
    } finally {
      mcpBackedServer.stop();
      await fakeMcp.stop();
    }
  });
  it("splits browser_tabs new with a URL into new tab and navigate MCP calls", async () => {
    const fakeMcp = await startFakeMcpServer((body) => ({
      body: { success: true, echo: body },
    }));
    const port = await getFreePort();
    const mcpBackedServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      fakeMcp.endpoint,
    );
    await mcpBackedServer.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/playwright`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
        body: JSON.stringify({
          action: "browser_tabs",
          params: { action: "new", url: "https://example.com/path" },
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(fakeMcp.calls).toEqual([
        { tool: "browser_tabs", arguments: { action: "new" } },
        {
          tool: "browser_navigate",
          arguments: { url: "https://example.com/path" },
        },
      ]);
    } finally {
      mcpBackedServer.stop();
      await fakeMcp.stop();
    }
  });
  it("rolls back a newly opened tab when browser_tabs URL navigation fails", async () => {
    const fakeMcp = await startFakeMcpServer((body) => {
      if (body.tool === "browser_navigate") {
        return { status: 500, body: { error: "navigation failed" } };
      }
      return { body: { success: true, echo: body } };
    });
    const port = await getFreePort();
    const mcpBackedServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      fakeMcp.endpoint,
    );
    await mcpBackedServer.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/playwright`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
        body: JSON.stringify({
          action: "browser_tabs",
          params: { action: "new", url: "https://example.com/path" },
        }),
      });
      expect(response.status).toBe(502);
      const body = (await response.json()) as {
        success: boolean;
        error: string;
      };
      expect(body.success).toBe(false);
      expect(body.error).toContain("MCP error: 500");
      expect(fakeMcp.calls).toEqual([
        { tool: "browser_tabs", arguments: { action: "new" } },
        {
          tool: "browser_navigate",
          arguments: { url: "https://example.com/path" },
        },
        { tool: "browser_tabs", arguments: { action: "close" } },
      ]);
    } finally {
      mcpBackedServer.stop();
      await fakeMcp.stop();
    }
  });
  it("rejects unsafe Playwright MCP endpoints before proxying", async () => {
    const port = await getFreePort();
    const unsafeEndpointServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      "https://example.com/call",
    );
    await unsafeEndpointServer.start();
    try {
      const statusResponse = await fetch(
        `http://127.0.0.1:${port}/playwright/status`,
        { headers: TRUSTED_HEADERS },
      );
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.json()).toMatchObject({
        available: false,
        detail: "Playwright MCP endpoint must use localhost or loopback.",
      });

      const actionResponse = await fetch(
        `http://127.0.0.1:${port}/playwright`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
          body: JSON.stringify({
            action: "browser_click",
            params: { ref: "e1" },
          }),
        },
      );
      expect(actionResponse.status).toBe(400);
      expect(await actionResponse.json()).toMatchObject({
        success: false,
        error: "Playwright MCP endpoint must use localhost or loopback.",
      });
    } finally {
      unsafeEndpointServer.stop();
    }
  });
  it("rejects unsafe Playwright requests before they reach MCP", async () => {
    const fakeMcp = await startFakeMcpServer((body) => ({
      body: { success: true, echo: body },
    }));
    const port = await getFreePort();
    const mcpBackedServer = new StandaloneBridgeServer(
      port,
      "test",
      workspaceRoot,
      [],
      fakeMcp.endpoint,
    );
    await mcpBackedServer.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/playwright`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...TRUSTED_HEADERS },
        body: JSON.stringify({
          action: "browser_navigate",
          params: { url: "javascript:alert(1)" },
        }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        success: boolean;
        error: string;
      };
      expect(body.success).toBe(false);
      expect(body.error).toBe("browser_navigate requires a safe http(s) URL");
      expect(fakeMcp.calls).toHaveLength(0);
    } finally {
      mcpBackedServer.stop();
      await fakeMcp.stop();
    }
  });
  it("rejects requests from a disallowed Origin", async () => {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { ...TRUSTED_HEADERS, Origin: "https://evil.example.com" },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Forbidden origin");
  });
  it("rejects a CORS preflight from a disallowed Origin", async () => {
    const response = await fetch(`${baseUrl}/models`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-copilot-bridge-client",
      },
    });
    expect(response.status).toBe(403);
  });
});

describe("standalone prompt context", () => {
  it("tells the model not to summarize unavailable page text", () => {
    const prompt = buildSystemPrompt("");

    expect(prompt).toContain("page text was not provided");
    expect(prompt).toContain(
      "Do not infer or summarize unavailable page content",
    );
  });
});
