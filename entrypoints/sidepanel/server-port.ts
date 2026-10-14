export const MIN_SERVER_PORT = 1;
export const MAX_SERVER_PORT = 65535;
export const DEFAULT_SERVER_PORT = 3210;
export const DEFAULT_STANDALONE_SERVER_PORT = 3211;

function parsePortCandidate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeServerPort(
  value: unknown,
  fallback = DEFAULT_SERVER_PORT,
): number {
  const candidate = parsePortCandidate(value);
  if (candidate === null) {
    return fallback;
  }

  return candidate >= MIN_SERVER_PORT && candidate <= MAX_SERVER_PORT
    ? candidate
    : fallback;
}
