import { describe, expect, it } from "vitest";
import {
  defaultAllowEvaluateAction,
  resolveAllowEvaluateAction,
} from "./evaluate-setting-policy";

describe("evaluate setting policy", () => {
  it("defaults evaluate to disabled", () => {
    expect(defaultAllowEvaluateAction()).toBe(false);
  });

  it("keeps evaluate disabled during full-auto migration", () => {
    expect(
      resolveAllowEvaluateAction({
        storedValue: true,
        shouldForceFullAutoMigration: true,
      }),
    ).toBe(false);
  });

  it("uses stored value for non-migration users", () => {
    expect(
      resolveAllowEvaluateAction({
        storedValue: true,
        shouldForceFullAutoMigration: false,
      }),
    ).toBe(true);
    expect(
      resolveAllowEvaluateAction({
        storedValue: undefined,
        shouldForceFullAutoMigration: false,
      }),
    ).toBe(false);
  });
});
