export const DISPLAY_EDIT_ORIGINS_KEY = "displayEditOriginsV1";

export function displayEditOrigin(url: string | undefined): string {
  try {
    const parsed = new URL(url ?? "");
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.origin
      : "";
  } catch {
    return "";
  }
}

export function normalizeDisplayEditOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (origin): origin is string =>
          typeof origin === "string" && displayEditOrigin(origin) === origin,
      ),
    ),
  ].slice(0, 100);
}

export function canEditDisplay(options: {
  url?: string;
  mode: string;
  browserActionsEnabled: boolean;
  task: boolean;
  once: boolean;
  origins: readonly string[];
}): boolean {
  const origin = displayEditOrigin(options.url);
  return Boolean(
    origin &&
    options.browserActionsEnabled &&
    !options.task &&
    ["input", "automation"].includes(options.mode) &&
    (options.once || options.origins.includes(origin)),
  );
}
