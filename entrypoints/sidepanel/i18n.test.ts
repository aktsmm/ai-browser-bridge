import { describe, expect, it } from "vitest";
import { translations } from "./i18n";

describe("branding", () => {
  it("uses the neutral app title in Japanese settings text", () => {
    expect(translations.ja.appTitle).toContain("AI Browser Bridge");
    expect(translations.ja.appTitle).not.toContain("GitHub Copilot");
    // Functional reference to the GitHub Copilot model list is retained (nominative use).
    expect(translations.ja.modelFetchFailed).toContain("GitHub Copilot");
  });

  it("uses the neutral app title in English settings text", () => {
    expect(translations.en.appTitle).toContain("AI Browser Bridge");
    expect(translations.en.appTitle).not.toContain("GitHub Copilot");
    // Functional reference to the GitHub Copilot model list is retained (nominative use).
    expect(translations.en.modelFetchFailed).toContain("GitHub Copilot");
  });
});

describe("i18n key parity", () => {
  it("keeps Japanese and English translation keys in sync", () => {
    const jaKeys = Object.keys(translations.ja).sort();
    const enKeys = Object.keys(translations.en).sort();
    const onlyInJa = jaKeys.filter((key) => !enKeys.includes(key));
    const onlyInEn = enKeys.filter((key) => !jaKeys.includes(key));
    expect(onlyInJa).toEqual([]);
    expect(onlyInEn).toEqual([]);
  });

  it("never leaves a translation value empty", () => {
    for (const lang of ["ja", "en"] as const) {
      const dict = translations[lang];
      for (const [key, value] of Object.entries(dict)) {
        expect(
          typeof value === "string" && value.length > 0,
          `${lang}.${key} must be a non-empty string`,
        ).toBe(true);
      }
    }
  });
});
