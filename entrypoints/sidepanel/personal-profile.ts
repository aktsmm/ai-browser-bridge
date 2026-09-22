import { TaskBlockedError } from "./connection-diagnostics";

export const PERSONAL_PROFILE_KEY = "personalProfileV1";
const PRIVATE_TAB_PREFIX = "privateBrowserTab:";

export async function isPrivateBrowserTab(tabId: number): Promise<boolean> {
  const key = `${PRIVATE_TAB_PREFIX}${tabId}`;
  const stored = await chrome.storage.session.get([key, "privateBrowserTabs"]);
  return (
    stored[key] === true ||
    (Array.isArray(stored.privateBrowserTabs) &&
      stored.privateBrowserTabs.includes(tabId))
  );
}

export async function markPrivateBrowserTab(tabId: number): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0)
    throw new Error("Invalid private tab identity");
  await chrome.storage.session.set({ [`${PRIVATE_TAB_PREFIX}${tabId}`]: true });
}
export async function assertPageShareAllowed(
  tabId: number | undefined,
): Promise<void> {
  if (tabId !== undefined && (await isPrivateBrowserTab(tabId))) {
    throw new TaskBlockedError(
      "This tab has received personal profile data. Continue manually, or use a new tab for another AI task. Its contents will not be sent to the model.",
    );
  }
}
export const PERSONAL_FIELDS = [
  "fullName",
  "email",
  "phone",
  "postalCode",
  "address",
] as const;
export type PersonalProfile = Record<
  (typeof PERSONAL_FIELDS)[number],
  string
> & { remember: boolean };

export function normalizePersonalProfile(value: unknown): PersonalProfile {
  const stored =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    fullName:
      typeof stored.fullName === "string" ? stored.fullName.slice(0, 200) : "",
    email: typeof stored.email === "string" ? stored.email.slice(0, 254) : "",
    phone: typeof stored.phone === "string" ? stored.phone.slice(0, 80) : "",
    postalCode:
      typeof stored.postalCode === "string"
        ? stored.postalCode.slice(0, 40)
        : "",
    address:
      typeof stored.address === "string" ? stored.address.slice(0, 1000) : "",
    remember: stored.remember === true,
  };
}

export function personalValues(
  profile: PersonalProfile,
): Record<string, string> {
  return Object.fromEntries(
    PERSONAL_FIELDS.filter((key) => profile[key].trim()).map((key) => [
      key,
      profile[key],
    ]),
  );
}

export function redactPrivateText(
  text: string,
  profile: PersonalProfile,
): string {
  const values = Object.values(personalValues(profile)).flatMap((value) => [
    value,
    encodeURIComponent(value),
  ]);
  const patterns = [...new Set(values)]
    .sort((first, second) => second.length - first.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return patterns.length
    ? text.replace(new RegExp(patterns.join("|"), "g"), "[private]")
    : text;
}

export async function loadPersonalProfile(): Promise<PersonalProfile> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const session = await chrome.storage.session.get(PERSONAL_PROFILE_KEY);
  if (session[PERSONAL_PROFILE_KEY])
    return normalizePersonalProfile(session[PERSONAL_PROFILE_KEY]);
  const local = await chrome.storage.local.get(PERSONAL_PROFILE_KEY);
  return normalizePersonalProfile(local[PERSONAL_PROFILE_KEY]);
}

export async function savePersonalProfile(
  profile: PersonalProfile,
): Promise<void> {
  const value = normalizePersonalProfile(profile);
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.session.set({ [PERSONAL_PROFILE_KEY]: value });
  if (value.remember)
    await chrome.storage.local.set({ [PERSONAL_PROFILE_KEY]: value });
  else await chrome.storage.local.remove(PERSONAL_PROFILE_KEY);
}
