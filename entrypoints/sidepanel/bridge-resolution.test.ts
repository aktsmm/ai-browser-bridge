import { describe, expect, it, vi } from "vitest";
import {
  normalizeBridgeMode,
  resolveBridge,
  type BridgeProbeResult,
} from "./bridge-resolution";

const base = { vscodePort: 3210, standalonePort: 3211 };
const up = (urls: string[]) =>
  vi.fn(
    async (url: string): Promise<BridgeProbeResult> =>
      urls.includes(url)
        ? { ok: true }
        : { ok: false, error: `refused ${url}` },
  );

describe("resolveBridge", () => {
  it("prefers VS Code in auto mode when both are up", async () => {
    const probe = up(["http://127.0.0.1:3210", "http://127.0.0.1:3211"]);
    const result = await resolveBridge({ ...base, mode: "auto", probe });
    expect(result).toEqual({
      ok: true,
      bridge: { kind: "vscode", port: 3210, baseUrl: "http://127.0.0.1:3210" },
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("falls back to standalone in auto mode when VS Code is down", async () => {
    const probe = up(["http://127.0.0.1:3211"]);
    const result = await resolveBridge({ ...base, mode: "auto", probe });
    expect(result).toEqual({
      ok: true,
      bridge: {
        kind: "standalone",
        port: 3211,
        baseUrl: "http://127.0.0.1:3211",
      },
    });
    expect(probe.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3210",
      "http://127.0.0.1:3211",
    ]);
  });

  it("reports every tried port when nothing responds", async () => {
    const result = await resolveBridge({
      ...base,
      mode: "auto",
      probe: up([]),
    });
    expect(result).toEqual({
      ok: false,
      failure: {
        triedPorts: [3210, 3211],
        lastError: "refused http://127.0.0.1:3211",
        lastStatus: undefined,
      },
    });
  });

  it("does not fall back when a mode is pinned", async () => {
    const vscodeOnly = up(["http://127.0.0.1:3211"]);
    const pinnedVscode = await resolveBridge({
      ...base,
      mode: "vscode",
      probe: vscodeOnly,
    });
    expect(pinnedVscode.ok).toBe(false);
    expect(vscodeOnly).toHaveBeenCalledTimes(1);

    const standaloneOnly = up(["http://127.0.0.1:3210"]);
    const pinnedStandalone = await resolveBridge({
      ...base,
      mode: "standalone",
      probe: standaloneOnly,
    });
    expect(pinnedStandalone.ok).toBe(false);
    expect(standaloneOnly.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3211",
    ]);
  });

  it("keeps the HTTP status of a failing probe", async () => {
    const result = await resolveBridge({
      ...base,
      mode: "vscode",
      probe: async () => ({
        ok: false,
        status: { code: 500, text: "Internal Server Error" },
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { lastStatus: { code: 500 } },
    });
  });
});

describe("normalizeBridgeMode", () => {
  it("defaults to auto for unknown values", () => {
    expect(normalizeBridgeMode(undefined)).toBe("auto");
    expect(normalizeBridgeMode("x")).toBe("auto");
    expect(normalizeBridgeMode("vscode")).toBe("vscode");
    expect(normalizeBridgeMode("standalone")).toBe("standalone");
  });
});
