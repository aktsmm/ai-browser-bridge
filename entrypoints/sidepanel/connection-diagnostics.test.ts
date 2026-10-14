import { describe, expect, it } from "vitest";

import { formatConnectionFailureDetail } from "./connection-diagnostics";

describe("formatConnectionFailureDetail", () => {
  it("formats HTTP failures with a concrete bridge endpoint hint", () => {
    const message = formatConnectionFailureDetail({
      ports: [3210],
      statusCode: 503,
      statusText: "Service Unavailable",
      language: "en",
    });

    expect(message).toContain("Health check failed (503 Service Unavailable)");
    expect(message).toContain("http://127.0.0.1:3210/health");
  });

  it("formats generic errors in Japanese with the same endpoint hint", () => {
    const message = formatConnectionFailureDetail({
      ports: [3210, 3211],
      error: "Failed to fetch",
      language: "ja",
    });

    expect(message).toContain("Failed to fetch");
    expect(message).toContain("VS Code 拡張または standalone bridge が起動中");
    expect(message).toContain("http://127.0.0.1:3210/health");
    expect(message).toContain("http://127.0.0.1:3211/health");
  });
});
