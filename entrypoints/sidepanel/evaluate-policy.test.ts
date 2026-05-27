import { describe, expect, it } from "vitest";
import {
  DIRECT_EVALUATE_DISABLED_REASON,
  getEvaluateBlockedMessage,
} from "./evaluate-policy";

describe("evaluate policy", () => {
  it("blocks direct evaluate with a deterministic message", () => {
    expect(getEvaluateBlockedMessage()).toContain(
      DIRECT_EVALUATE_DISABLED_REASON,
    );
  });
});