import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type CliProviderKind = "codex-cli" | "claude-code";
export type ClaudeConnection = "direct" | "gateway";

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const CLI_PROVIDER_TIMEOUT_MS = 60_000;

export interface CliSpawnSpec {
  command: string;
  argsPrefix: string[];
}

const SAFE_ENV_KEYS = new Set([
  "APPDATA",
  "CODEX_HOME",
  "HOME",
  "LANG",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "windir",
]);

export function buildCliEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => SAFE_ENV_KEYS.has(key) && value !== undefined,
    ),
  );
}

function resolveOnPath(command: string, platform = process.platform): string {
  if (platform !== "win32") return command;
  const result = spawnSync("where.exe", [command], {
    cwd: tmpdir(),
    encoding: "utf8",
    shell: false,
  });
  return (
    result.stdout
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || command
  );
}

export function resolveCliSpawnSpec(
  provider: CliProviderKind,
  connection: ClaudeConnection = "direct",
  platform = process.platform,
  resolvedExecutable?: string,
): CliSpawnSpec {
  const executable =
    resolvedExecutable ??
    (provider === "codex-cli"
      ? resolveOnPath("codex", platform)
      : resolveOnPath(connection === "gateway" ? "gw" : "claude", platform));

  if (platform !== "win32" || executable.toLowerCase().endsWith(".exe")) {
    return {
      command: executable,
      argsPrefix: connection === "gateway" ? ["claude"] : [],
    };
  }

  const base = dirname(executable);
  const node = join(base, "node.exe");
  const entry =
    provider === "codex-cli"
      ? join(base, "node_modules", "@openai", "codex", "bin", "codex.js")
      : connection === "direct"
        ? join(base, "node_modules", "@anthropic-ai", "claude-code", "cli.js")
        : join(
            base,
            "node_modules",
            "copilot-anthropic-gateway",
            "dist",
            "cli.js",
          );
  if (!existsSync(node) || !existsSync(entry)) {
    throw new Error(`${provider} native Node entry could not be resolved`);
  }
  return {
    command: node,
    argsPrefix:
      provider === "codex-cli" || connection === "direct"
        ? [entry]
        : [entry, "claude"],
  };
}

function terminateOwnedProcess(
  child: ChildProcess,
  terminateTree: boolean,
): void {
  if (
    terminateTree &&
    process.platform === "win32" &&
    typeof child.pid === "number"
  ) {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    killer.once("error", () => child.kill());
    return;
  }
  child.kill();
}

export async function runBoundedCli(
  spec: CliSpawnSpec,
  args: string[],
  prompt: string,
  options: {
    abortSignal?: AbortSignal;
    timeoutMs?: number;
    terminateTree?: boolean;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  if (options.abortSignal?.aborted) {
    throw new Error("CLI provider request aborted");
  }

  const workingDirectory = mkdtempSync(join(tmpdir(), "ai-browser-bridge-"));
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, [...spec.argsPrefix, ...args], {
      cwd: workingDirectory,
      env: buildCliEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const removeWorkingDirectory = () => {
      try {
        rmSync(workingDirectory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50,
        });
      } catch {
        child.once("close", () => {
          try {
            rmSync(workingDirectory, { recursive: true, force: true });
          } catch {
            // The OS will reclaim the isolated temporary directory later.
          }
        });
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      options.abortSignal?.removeEventListener("abort", abortHandler);
      removeWorkingDirectory();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const stop = (message: string) => {
      terminateOwnedProcess(child, options.terminateTree !== false);
      finish(() => reject(new Error(message)));
    };
    const abortHandler = () => stop("CLI provider request aborted");
    const timeout = setTimeout(
      () => stop("CLI provider request timed out"),
      options.timeoutMs ?? CLI_PROVIDER_TIMEOUT_MS,
    );

    options.abortSignal?.addEventListener("abort", abortHandler, {
      once: true,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        stop("CLI provider stdout exceeded the output limit");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES) {
        stop("CLI provider stderr exceeded the output limit");
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) =>
      finish(() => resolve({ stdout, stderr, exitCode })),
    );
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") finish(() => reject(error));
    });
    child.stdin.end(prompt, "utf8");
  });
}

export function validateCliModelId(model: string): string {
  const value = model.trim();
  if (!value) return "";
  if (value.startsWith("-") || !MODEL_ID_PATTERN.test(value)) {
    throw new Error("Invalid CLI model ID");
  }
  return value;
}

export function buildCodexArgs(model: string): string[] {
  const validatedModel = validateCliModelId(model);
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--disable",
    "shell_tool",
    "--disable",
    "browser_use",
    "--disable",
    "browser_use_external",
    "--disable",
    "browser_use_full_cdp_access",
    "--disable",
    "computer_use",
    "--disable",
    "in_app_browser",
    "--disable",
    "apps",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--disable",
    "code_mode_host",
    ...(validatedModel ? [`--model=${validatedModel}`] : []),
    "-",
  ];
}

export function buildClaudeArgs(model: string): string[] {
  const validatedModel = validateCliModelId(model);
  return [
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
    ...(validatedModel ? ["--model", validatedModel] : []),
  ];
}

export function parseCodexJsonl(output: string): string {
  let result = "";
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string };
      error?: { message?: string };
    };
    if (event.type === "turn.failed" || event.type === "error") {
      throw new Error(event.error?.message || "Codex CLI request failed");
    }
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      result += event.item.text;
    }
  }
  if (!result.trim()) throw new Error("Codex CLI returned an empty response");
  return result.trim();
}

export function parseClaudeJsonl(output: string): string {
  let result = "";
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as {
      type?: string;
      result?: string;
      is_error?: boolean;
      errors?: string[];
    };
    if (event.type !== "result") continue;
    if (event.is_error) {
      throw new Error(event.errors?.join("; ") || "Claude Code request failed");
    }
    if (typeof event.result === "string") result = event.result;
  }
  if (!result.trim()) throw new Error("Claude Code returned an empty response");
  return result.trim();
}

export interface CliProviderSettings {
  provider: CliProviderKind;
  model: string;
  connection?: ClaudeConnection;
}

export class CliProviderClient {
  private availability = new Map<string, boolean>();

  async isAvailable(
    provider: CliProviderKind,
    connection: ClaudeConnection = "direct",
    forceRefresh = false,
  ): Promise<boolean> {
    const key = `${provider}:${connection}`;
    if (!forceRefresh && this.availability.has(key)) {
      return this.availability.get(key) ?? false;
    }
    try {
      const resolved = resolveCliSpawnSpec(provider, connection);
      const spec =
        provider === "claude-code" && connection === "gateway"
          ? { ...resolved, argsPrefix: resolved.argsPrefix.slice(0, -1) }
          : resolved;
      const result = await runBoundedCli(
        spec,
        provider === "codex-cli"
          ? ["login", "status"]
          : connection === "gateway"
            ? ["help"]
            : ["auth", "status"],
        "",
        { timeoutMs: 10_000, terminateTree: connection !== "gateway" },
      );
      const available = result.exitCode === 0;
      this.availability.set(key, available);
      return available;
    } catch {
      this.availability.set(key, false);
      return false;
    }
  }

  async runPrompt(
    settings: CliProviderSettings,
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const connection = settings.connection ?? "direct";
    try {
      const spec = resolveCliSpawnSpec(settings.provider, connection);
      const args =
        settings.provider === "codex-cli"
          ? buildCodexArgs(settings.model)
          : buildClaudeArgs(settings.model);
      const result = await runBoundedCli(spec, args, prompt, {
        abortSignal,
        terminateTree: true,
      });
      if (result.exitCode !== 0) {
        throw new Error(`exited with code ${result.exitCode ?? "unknown"}`);
      }
      return settings.provider === "codex-cli"
        ? parseCodexJsonl(result.stdout)
        : parseClaudeJsonl(result.stdout);
    } catch (error) {
      const route =
        settings.provider === "claude-code" ? ` (${connection})` : "";
      throw new Error(
        `${settings.provider}${route} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
