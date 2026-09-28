import { markPrivateBrowserTab } from "./personal-profile";

export const PAYMENT_CARD_KEY = "paymentCardV1";

export interface PaymentCard {
  number: string;
  expiry: string;
}

export interface SealedPaymentCard {
  salt: string;
  iv: string;
  ciphertext: string;
  lastFour: string;
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++)
    bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function validateCard(card: PaymentCard): PaymentCard {
  const number = card.number.replace(/[ -]/g, "");
  const expiry = card.expiry.trim();
  if (
    !/^\d{12,19}$/.test(number) ||
    !/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.test(expiry)
  )
    throw new Error("Invalid card number or expiration date");
  return { number, expiry };
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (passphrase.length < 12)
    throw new Error("Passphrase must be at least 12 characters");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealPaymentCard(
  card: PaymentCard,
  passphrase: string,
): Promise<SealedPaymentCard> {
  const valid = validateCard(card);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(valid)),
    ),
  );
  return {
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(ciphertext),
    lastFour: valid.number.slice(-4),
  };
}

export async function openPaymentCard(
  sealed: SealedPaymentCard,
  passphrase: string,
): Promise<PaymentCard> {
  const key = await deriveKey(passphrase, decode(sealed.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(sealed.iv) },
    key,
    decode(sealed.ciphertext),
  );
  return validateCard(
    JSON.parse(new TextDecoder().decode(plaintext)) as PaymentCard,
  );
}

export async function loadPaymentCard(): Promise<SealedPaymentCard | null> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const result = (await chrome.storage.local.get(PAYMENT_CARD_KEY))[
    PAYMENT_CARD_KEY
  ];
  return result &&
    typeof result.salt === "string" &&
    typeof result.iv === "string" &&
    typeof result.ciphertext === "string" &&
    /^\d{4}$/.test(result.lastFour)
    ? (result as SealedPaymentCard)
    : null;
}

export async function savePaymentCard(
  sealed: SealedPaymentCard,
): Promise<void> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.set({ [PAYMENT_CARD_KEY]: sealed });
}

export async function clearPaymentCard(): Promise<void> {
  await chrome.storage.local.remove(PAYMENT_CARD_KEY);
}

export async function fillPaymentCardOnCurrentTab(
  sealed: SealedPaymentCard,
  passphrase: string,
  confirmSite: (origin: string) => boolean,
): Promise<"filled" | "missing" | "cancelled"> {
  const tab = (
    await chrome.tabs.query({ active: true, currentWindow: true })
  )[0];
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url))
    throw new Error("Unavailable tab");
  const origin = new URL(tab.url).origin;
  if (!confirmSite(origin)) return "cancelled";
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
    throw new Error("Site permission missing");
  const card = await openPaymentCard(sealed, passphrase);
  const fields = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () =>
      Array.from(document.querySelectorAll("input")).some((input) =>
        /^(cc-number|cc-exp|cc-exp-month|cc-exp-year)$/.test(
          input.autocomplete.trim(),
        ),
      ),
  });
  if (!fields[0]?.result) return "missing";
  if ((await chrome.tabs.get(tab.id)).url !== tab.url)
    throw new Error("Tab changed");
  await markPrivateBrowserTab(tab.id);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (cardNumber: string, cardExpiry: string) => {
      const [month, year] = cardExpiry.split("/");
      const values: Record<string, string> = {
        "cc-number": cardNumber,
        "cc-exp": cardExpiry,
        "cc-exp-month": month,
        "cc-exp-year": year.length === 2 ? `20${year}` : year,
      };
      let count = 0;
      for (const input of Array.from(document.querySelectorAll("input"))) {
        const value = values[input.autocomplete.trim()];
        if (
          !value ||
          input.disabled ||
          input.readOnly ||
          !input.getClientRects().length
        )
          continue;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        count++;
      }
      return count;
    },
    args: [card.number, card.expiry],
  });
  return results[0]?.result ? "filled" : "missing";
}
