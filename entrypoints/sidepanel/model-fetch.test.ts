import { describe, expect, it, vi } from "vitest";
import { fetchModelsWithRetry, MODEL_FETCH_TIMEOUT_MS } from "./model-fetch";

describe("fetchModelsWithRetry", () => {
  const baseUrl = "http://localhost:3210";
  const headers = { "X-Copilot-Bridge-Client": "chrome-extension" };
  const extensionOrigin = "chrome-extension://exampleextensionidexampleext";

  it("retries once after an abort and then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { provider: "copilot", id: "gpt-4o", name: "GPT-4o" },
          ]),
          { status: 200 },
        ),
      );

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      models: [{ provider: "copilot", id: "gpt-4o", name: "GPT-4o" }],
      errorDetail: null,
    });
  });

  it("returns a helpful forbidden-origin detail for 403", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain("rejected for this extension origin");
    expect(result.errorDetail).toContain("Extension origin:");
    expect(result.errorDetail).toContain(extensionOrigin);
  });

  it("points users to update or reload the VS Code bridge when an old bridge requires Origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Origin header is required" }), {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain("older VS Code bridge");
    expect(result.errorDetail).toContain("Update/reload the VS Code extension");
    expect(result.errorDetail).toContain("Origin header is required");
    expect(result.errorDetail).not.toContain("allowedExtensionOrigins");
    expect(result.errorDetail).not.toContain('{"error"');
  });

  it("treats a non-empty partial provider list as success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { provider: "lm-studio", id: "local", name: "LM Studio (Local)" },
          ]),
          { status: 200 },
        ),
      );

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      models: [
        { provider: "lm-studio", id: "local", name: "LM Studio (Local)" },
      ],
      errorDetail: null,
    });
  });

  it("treats an empty array as a diagnosable failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain("returned no models");
  });

  it("includes timeout diagnostics after the last failed attempt", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );

    const result = await fetchModelsWithRetry({
      baseUrl,
      headers,
      extensionOrigin,
      fetchImpl,
      timeoutMs: MODEL_FETCH_TIMEOUT_MS,
      maxAttempts: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain(
      `Timed out after ${MODEL_FETCH_TIMEOUT_MS}ms`,
    );
  });
});
