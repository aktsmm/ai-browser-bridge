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
import {
  fillPaymentCardOnCurrentTab,
  openPaymentCard,
  sealPaymentCard,
  savePaymentCard,
  PAYMENT_CARD_KEY,
} from "./payment-card";

afterEach(() => vi.unstubAllGlobals());
describe("personal profile", () => {
  it("encrypts optional payment details before saving and never persists a security code", async () => {
    const card = { number: "4111 1111 1111 1111", expiry: "12/29" };
    const sealed = await sealPaymentCard(card, "a strong test passphrase");
    expect(JSON.stringify(sealed)).not.toContain("4111111111111111");
    expect(sealed.lastFour).toBe("1111");
    expect(sealed).not.toHaveProperty("cvv");
    expect(await openPaymentCard(sealed, "a strong test passphrase")).toEqual({
      number: "4111111111111111",
      expiry: "12/29",
    });
    await expect(
      openPaymentCard(sealed, "incorrect passphrase"),
    ).rejects.toThrow();
    const local = { setAccessLevel: vi.fn(), set: vi.fn() };
    vi.stubGlobal("chrome", { storage: { local } });
    await savePaymentCard(sealed);
    expect(local.set).toHaveBeenCalledWith({ [PAYMENT_CARD_KEY]: sealed });
    expect(local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
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
  it("requires site approval and marks the tab private before filling payment fields", async () => {
    const sealed = await sealPaymentCard(
      { number: "4111111111111111", expiry: "12/29" },
      "a strong test passphrase",
    );
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: true }])
      .mockResolvedValueOnce([{ result: 2 }]);
    const mark = vi.fn(async () => {});
    const confirmSite = vi.fn(() => true);
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([{ id: 9, url: "https://shop.example/checkout" }]),
        get: vi
          .fn()
          .mockResolvedValue({ url: "https://shop.example/checkout" }),
      },
      permissions: { contains: vi.fn().mockResolvedValue(true) },
      scripting: { executeScript },
      storage: { session: { set: mark } },
    });
    expect(
      await fillPaymentCardOnCurrentTab(
        sealed,
        "a strong test passphrase",
        confirmSite,
      ),
    ).toBe("filled");
    expect(confirmSite).toHaveBeenCalledWith("https://shop.example");
    expect(mark).toHaveBeenCalledWith({ "privateBrowserTab:9": true });
    expect(mark.mock.invocationCallOrder[0]).toBeLessThan(
      executeScript.mock.invocationCallOrder[1],
    );
    expect(executeScript.mock.calls[1][0].args).toEqual([
      "4111111111111111",
      "12/29",
    ]);
    expect(executeScript).toHaveBeenCalledTimes(2);
    class TestInput {
      autocomplete: string;
      disabled = false;
      readOnly = false;
      currentValue = "";
      dispatchEvent = vi.fn();
      getClientRects = () => [{}];
      constructor(autocomplete: string) {
        this.autocomplete = autocomplete;
      }
    }
    Object.defineProperty(TestInput.prototype, "value", {
      set(this: TestInput, value: string) {
        this.currentValue = value;
      },
    });
    const cardField = new TestInput("cc-number");
    const cvvField = new TestInput("cc-csc");
    vi.stubGlobal("HTMLInputElement", TestInput);
    vi.stubGlobal("document", {
      querySelectorAll: () => [cardField, cvvField],
    });
    expect(
      executeScript.mock.calls[1][0].func("4111111111111111", "12/29"),
    ).toBe(1);
    expect(cardField.currentValue).toBe("4111111111111111");
    expect(cvvField.currentValue).toBe("");
  });
  it("does not decrypt or inspect payment fields when the site is declined", async () => {
    const sealed = await sealPaymentCard(
      { number: "4111111111111111", expiry: "12/29" },
      "a strong test passphrase",
    );
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([{ id: 9, url: "https://shop.example/checkout" }]),
      },
      scripting: { executeScript },
    });
    expect(await fillPaymentCardOnCurrentTab(sealed, "", () => false)).toBe(
      "cancelled",
    );
    expect(executeScript).not.toHaveBeenCalled();
  });
  it("normalizes custom fields and redacts their values", () => {
    const profile = normalizePersonalProfile({
      customFields: [
        { name: "Organization", value: "Private Org" },
        { name: "", value: "ignored" },
      ],
    });
    expect(personalValues(profile)).toEqual({ custom1: "Private Org" });
    expect(redactPrivateText("Private Org", profile)).toBe("[private]");
    expect(
      normalizePersonalProfile({
        customFields: Array(10).fill({ name: "N", value: "V" }),
      }).customFields,
    ).toHaveLength(5);
  });
  it("rejects plaintext card details in free-form fields", async () => {
    const profile = normalizePersonalProfile({
      customFields: [{ name: "Card number", value: "4111 1111 1111 1111" }],
    });
    expect(personalValues(profile)).toEqual({});
    const local = { setAccessLevel: vi.fn(), set: vi.fn() };
    vi.stubGlobal("chrome", { storage: { local } });
    await expect(savePersonalProfile(profile)).rejects.toThrow(
      "dedicated entry",
    );
    expect(local.set).not.toHaveBeenCalled();
  });
  it("rechecks shared privacy state immediately before sending", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ "privateBrowserTab:4": true })
      .mockRejectedValueOnce(new Error("Read failed"));
    vi.stubGlobal("chrome", { storage: { session: { get } } });
    await expect(assertPageShareAllowed(4)).resolves.toBeUndefined();
    await expect(assertPageShareAllowed(4, "ja")).rejects.toThrow(
      "AIへ送りません",
    );
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
