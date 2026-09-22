import { describe, expect, it } from "vitest";
import {
  clampAgentLoops,
  FATAL_AUTONOMOUS_ERROR_THRESHOLD,
  SCREENSHOT_FALLBACK_ERROR_THRESHOLD,
  shouldEnableScreenshotFallback,
  shouldStopAutonomousLoopAfterFailures,
} from "./agent-loop-policy";

describe("agent loop policy", () => {
  it("uses the same bounded loop limit for storage, UI and execution", () => {
    expect(clampAgentLoops(Number.NaN)).toBe(20);
    expect(clampAgentLoops(1000)).toBe(50);
    expect(clampAgentLoops(-1)).toBe(1);
    expect(clampAgentLoops(3.6)).toBe(4);
  });
  it("enables screenshot fallback only for hybrid mode after threshold", () => {
    expect(
      shouldEnableScreenshotFallback(
        "hybrid",
        SCREENSHOT_FALLBACK_ERROR_THRESHOLD,
        false,
      ),
    ).toBe(true);
    expect(
      shouldEnableScreenshotFallback(
        "text",
        SCREENSHOT_FALLBACK_ERROR_THRESHOLD,
        false,
      ),
    ).toBe(false);
    expect(shouldEnableScreenshotFallback("hybrid", 1, false)).toBe(false);
    expect(
      shouldEnableScreenshotFallback(
        "hybrid",
        SCREENSHOT_FALLBACK_ERROR_THRESHOLD,
        true,
      ),
    ).toBe(false);
  });

  it("stops autonomous loop only after repeated full failures", () => {
    expect(
      shouldStopAutonomousLoopAfterFailures({
        operationMode: "text",
        useScreenshotFallback: false,
        consecutiveFailedActionLoops: FATAL_AUTONOMOUS_ERROR_THRESHOLD,
      }),
    ).toBe(true);

    expect(
      shouldStopAutonomousLoopAfterFailures({
        operationMode: "hybrid",
        useScreenshotFallback: false,
        consecutiveFailedActionLoops: FATAL_AUTONOMOUS_ERROR_THRESHOLD,
      }),
    ).toBe(false);

    expect(
      shouldStopAutonomousLoopAfterFailures({
        operationMode: "hybrid",
        useScreenshotFallback: true,
        consecutiveFailedActionLoops: FATAL_AUTONOMOUS_ERROR_THRESHOLD,
      }),
    ).toBe(true);
  });
});
