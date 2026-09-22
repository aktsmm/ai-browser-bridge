import { describe, expect, it, vi, afterEach } from "vitest";
import { formatChatError, TaskBlockedError } from "./connection-diagnostics";
import {
  normalizePersonalProfile,
  personalValues,
  redactPrivateText,
  savePersonalProfile,
  PERSONAL_PROFILE_KEY,
  isPrivateBrowserTab,
  markPrivateBrowserTab,
  assertPageShareAllowed,
} from "./personal-profile";

afterEach(() => vi.unstubAllGlobals());
describe("personal profile", () => {
  it("does not label a deliberate privacy block as a connection failure", () => {
    expect(
      formatChatError(
        new TaskBlockedError("Protected tab"),
        "Connection failed",
      ),
    ).toBe("Protected tab");
    expect(
      formatChatError(new Error("Network error"), "Connection failed"),
    ).toBe("Connection failed\n\nNetwork error");
  });
  it("stores per-tab privacy markers without overwriting another panel's tabs", async () => {
    const stored: Record<string, unknown> = {};
    const set = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, values);
    });
    const get = vi.fn(async () => stored);
    vi.stubGlobal("chrome", { storage: { session: { get, set } } });
    await Promise.all([markPrivateBrowserTab(7), markPrivateBrowserTab(8)]);
    expect(await isPrivateBrowserTab(7)).toBe(true);
    expect(await isPrivateBrowserTab(8)).toBe(true);
    expect(await isPrivateBrowserTab(9)).toBe(false);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("honors legacy private tabs and propagates storage failures", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ privateBrowserTabs: [12] }),
          set: vi.fn().mockRejectedValue(new Error("Storage unavailable")),
        },
      },
    });
    expect(await isPrivateBrowserTab(12)).toBe(true);
    await expect(markPrivateBrowserTab(12)).rejects.toThrow(
      "Storage unavailable",
    );
  });
  it("retains only supported fields and defaults to session storage", () => {
    const profile = normalizePersonalProfile({
      fullName: "Example Person",
      password: "never-store",
    });
    expect(profile.remember).toBe(false);
    expect(personalValues(profile)).toEqual({ fullName: "Example Person" });
    expect(profile).not.toHaveProperty("password");
  });
  it("rechecks shared privacy state immediately before sending", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ "privateBrowserTab:4": true })
      .mockRejectedValueOnce(new Error("Read failed"));
    vi.stubGlobal("chrome", { storage: { session: { get } } });
    await expect(assertPageShareAllowed(4)).resolves.toBeUndefined();
    await expect(assertPageShareAllowed(4)).rejects.toThrow("will not be sent");
    await expect(assertPageShareAllowed(4)).rejects.toThrow("Read failed");
  });
  it("redacts literal and URL-encoded values without treating them as regex", () => {
    const profile = normalizePersonalProfile({
      fullName: "A+B Person",
      phone: "+1 (234)",
    });
    expect(
      redactPrivateText("A+B Person A%2BB%20Person +1 (234)", profile),
    ).toBe("[private] [private] [private]");
  });
  it("never writes a session-only profile to persistent storage", async () => {
    const local = { setAccessLevel: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const session = { set: vi.fn() };
    vi.stubGlobal("chrome", { storage: { local, session } });
    await savePersonalProfile(
      normalizePersonalProfile({ fullName: "Example" }),
    );
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).toHaveBeenCalledWith(PERSONAL_PROFILE_KEY);
    expect(session.set).toHaveBeenCalledOnce();
    expect(local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
});
