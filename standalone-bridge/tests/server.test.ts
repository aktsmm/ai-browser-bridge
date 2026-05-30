import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StandaloneBridgeServer } from "../src/index.js";
const TRUSTED_HEADERS = { "X-Copilot-Bridge-Client": "chrome-extension" };
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
  let server: StandaloneBridgeServer;
  let baseUrl: string;
  let workspaceRoot: string;
  beforeEach(async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "bridge-standalone-"),
    );
    const port = await getFreePort();
    server = new StandaloneBridgeServer(port, "test", workspaceRoot, []);
    await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterEach(() => {
    server.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
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
      "lm-studio",
    ]);
  });
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
