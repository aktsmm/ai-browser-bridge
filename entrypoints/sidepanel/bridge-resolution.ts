export type BridgeMode = "auto" | "vscode" | "standalone";
export type BridgeKind = "vscode" | "standalone";

export interface ResolvedBridge {
  kind: BridgeKind;
  port: number;
  baseUrl: string;
}

export interface BridgeResolutionFailure {
  /** 試行したポート（試行順）。 */
  triedPorts: number[];
  /** 最後に失敗した probe の詳細。 */
  lastError?: string;
  lastStatus?: { code: number; text: string };
}

export type BridgeProbeResult =
  | { ok: true }
  | { ok: false; error?: string; status?: { code: number; text: string } };

export const RESOLVED_BRIDGE_STORAGE_KEY = "resolvedBridgeBaseUrl";

export function normalizeBridgeMode(value: unknown): BridgeMode {
  return value === "vscode" || value === "standalone" ? value : "auto";
}

export function bridgeBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * mode に従い /health が通る最初の bridge を返す。auto は VS Code → standalone の順。
 * probe は例外を投げず結果で返す。
 */
export async function resolveBridge(options: {
  mode: BridgeMode;
  vscodePort: number;
  standalonePort: number;
  probe: (baseUrl: string) => Promise<BridgeProbeResult>;
}): Promise<
  | { ok: true; bridge: ResolvedBridge }
  | { ok: false; failure: BridgeResolutionFailure }
> {
  const candidates: Array<{ kind: BridgeKind; port: number }> = [];
  if (options.mode !== "standalone")
    candidates.push({ kind: "vscode", port: options.vscodePort });
  if (options.mode !== "vscode")
    candidates.push({ kind: "standalone", port: options.standalonePort });

  const failure: BridgeResolutionFailure = { triedPorts: [] };
  for (const candidate of candidates) {
    const baseUrl = bridgeBaseUrl(candidate.port);
    failure.triedPorts.push(candidate.port);
    const result = await options.probe(baseUrl);
    if (result.ok) {
      return { ok: true, bridge: { ...candidate, baseUrl } };
    }
    failure.lastError = result.error;
    failure.lastStatus = result.status;
  }
  return { ok: false, failure };
}
