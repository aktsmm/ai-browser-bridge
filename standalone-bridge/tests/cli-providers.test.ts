import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  buildCliEnvironment,
  buildCodexArgs,
  CliProviderClient,
  parseClaudeJsonl,
  parseCodexJsonl,
  resolveCliSpawnSpec,
  runBoundedCli,
  validateCliModelId,
} from "../src/cli-providers.js";

describe("standalone CLI provider contracts", () => {
  it("builds read-only Codex and tool-free Claude invocations", () => {
    const codexArgs = buildCodexArgs("gpt-5.4");
    expect(codexArgs).toEqual(
      expect.arrayContaining([
        "--sandbox",
        "read-only",
        "shell_tool",
        "browser_use",
        "computer_use",
        "hooks",
      ]),
    );
    expect(codexArgs).toContain("--model=gpt-5.4");
    expect(codexArgs.at(-1)).toBe("-");
    expect(buildClaudeArgs("copilot/claude-opus-5")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--safe-mode",
      "--tools=",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-chrome",
      "--model",
      "copilot/claude-opus-5",
    ]);
  });

  it("rejects option-like and malformed model IDs", () => {
    expect(() => validateCliModelId("--dangerously-skip-permissions")).toThrow(
      /invalid/i,
    );
    expect(() => validateCliModelId("model name")).toThrow(/invalid/i);
  });

  it("identifies the selected Claude connection in execution errors", async () => {
    const client = new CliProviderClient();
    await expect(
      client.runPrompt(
        {
          provider: "claude-code",
          connection: "direct",
          model: "invalid model",
        },
        "Synthetic prompt",
      ),
    ).rejects.toThrow(/claude-code \(direct\) failed/i);
  });

  it("resolves extensionless Windows npm shims through Node", () => {
    expect(
      resolveCliSpawnSpec(
        "codex-cli",
        "direct",
        "win32",
        "C:\\nvm4w\\nodejs\\codex",
      ).argsPrefix[0],
    ).toContain("@openai\\codex\\bin\\codex.js");
    expect(
      resolveCliSpawnSpec(
        "claude-code",
        "gateway",
        "win32",
        "C:\\nvm4w\\nodejs\\gw.cmd",
      ).argsPrefix,
    ).toEqual([
      "C:\\nvm4w\\nodejs\\node_modules\\copilot-anthropic-gateway\\dist\\cli.js",
      "claude",
    ]);
  });

  it("parses only provider result events", () => {
    expect(
      parseCodexJsonl(
        [
          '{"type":"thread.started"}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}',
          '{"type":"turn.completed"}',
        ].join("\n"),
      ),
    ).toBe("Hello");
    expect(
      parseClaudeJsonl(
        [
          '{"type":"system","subtype":"init"}',
          '{"type":"result","is_error":false,"result":"Hello"}',
        ].join("\n"),
      ),
    ).toBe("Hello");
  });

  it("passes prompts over stdin in an empty temporary cwd", async () => {
    const result = await runBoundedCli(
      { command: process.execPath, argsPrefix: [] },
      [
        "-e",
        "process.stdin.setEncoding('utf8');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({prompt:s,cwd:process.cwd()})))",
      ],
      "Synthetic prompt",
    );
    const output = JSON.parse(result.stdout) as { prompt: string; cwd: string };
    expect(output.prompt).toBe("Synthetic prompt");
    expect(output.cwd).toContain("ai-browser-bridge-");
    expect(result.exitCode).toBe(0);
  });

  it("sanitizes the child environment", () => {
    expect(
      buildCliEnvironment({
        PATH: "safe",
        GITHUB_TOKEN: "secret",
        ANTHROPIC_API_KEY: "secret",
      }),
    ).toEqual({ PATH: "safe" });
  });

  it("bounds child execution time", async () => {
    await expect(
      runBoundedCli(
        { command: process.execPath, argsPrefix: [] },
        ["-e", "setInterval(() => {}, 1000)"],
        "",
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out/i);
  });

  it("aborts a running child without leaving the request pending", async () => {
    const controller = new AbortController();
    const result = runBoundedCli(
      { command: process.execPath, argsPrefix: [] },
      ["-e", "setInterval(() => {}, 1000)"],
      "",
      { abortSignal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    await expect(result).rejects.toThrow(/aborted/i);
  });
});
