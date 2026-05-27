import type { BrowserAction, FormField } from "./types";
import { BRIDGE_CLIENT_HEADERS } from "./constants";
import { normalizeServerPort } from "./server-port";
import { normalizeDownloadRelativePath } from "./save-path";
import { getEvaluateBlockedMessage } from "./evaluate-policy";

// Playwright MCP availability flag (kept for future integration)
let playwrightAvailable = false;
let preferPlaywright = false;
let allowEvaluateAction = false;
const EVALUATE_DISABLED_MESSAGE = "Evaluate action is disabled by default";
const EVALUATE_DISABLED_MESSAGE_LOWER = EVALUATE_DISABLED_MESSAGE.toLowerCase();

type BrowserTab = {
  id?: number;
  url?: string;
  windowId?: number;
};

function resolveScriptResultMessage(result: unknown, fallback: string): string {
  if (!result || typeof result !== "object") {
    return fallback;
  }

  const candidate = result as {
    success?: unknown;
    message?: unknown;
    error?: unknown;
  };

  if (candidate.success === true && typeof candidate.message === "string") {
    return candidate.message;
  }

  if (typeof candidate.error === "string" && candidate.error.length > 0) {
    return candidate.error;
  }

  return fallback;
}

async function getBridgeBaseUrl(): Promise<string> {
  return await new Promise((resolve) => {
    chrome.storage.local.get(
      ["serverPort"],
      (result: { serverPort?: number }) => {
        resolve(`http://localhost:${normalizeServerPort(result.serverPort)}`);
      },
    );
  });
}

async function getCurrentTab(): Promise<BrowserTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("No active tab found");
  }

  return tab;
}

export function setPlaywrightAvailable(available: boolean) {
  playwrightAvailable = available;
}

export function setPreferPlaywright(prefer: boolean) {
  preferPlaywright = prefer;
}

export function isPlaywrightPreferred(): boolean {
  return preferPlaywright && playwrightAvailable;
}

export function setEvaluateActionEnabled(enabled: boolean) {
  allowEvaluateAction = enabled;
}

function isInternalPlaywrightEvaluateCall(
  params: Record<string, unknown>,
): boolean {
  const fn = typeof params.function === "string" ? params.function : "";
  if (!fn) {
    return false;
  }

  const normalizedFn = fn.replace(/\s+/g, " ").trim();

  return (
    /^\(\)\s*=>\s*\{\s*history\.forward\(\);\s*\}$/.test(normalizedFn) ||
    /^\(\)\s*=>\s*\{\s*location\.reload\(\);\s*\}$/.test(normalizedFn)
  );
}

function isPlaywrightEvaluateActionAllowed(
  actionName: string,
  params: Record<string, unknown>,
  allowInternalEvaluate: boolean,
): boolean {
  if (actionName !== "browser_evaluate") {
    return true;
  }

  if (allowEvaluateAction) {
    return true;
  }

  return allowInternalEvaluate && isInternalPlaywrightEvaluateCall(params);
}

async function ensureClientLoggers(): Promise<void> {
  try {
    const tab = await getCurrentTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: () => {
        const win = window as Window & {
          __copilotConsolePatched?: boolean;
          __copilotConsoleLogs?: Array<{
            level: string;
            message: string;
            ts: number;
          }>;
          __copilotConsoleOriginals?: {
            log: typeof console.log;
            info: typeof console.info;
            warn: typeof console.warn;
            error: typeof console.error;
          };
          __copilotNetworkPatched?: boolean;
          __copilotNetworkLogs?: Array<{
            method: string;
            url: string;
            status: number | string;
            duration: number;
            ts: number;
          }>;
        };
        const maxLogs = 200;

        if (!win.__copilotConsolePatched) {
          win.__copilotConsolePatched = true;
          win.__copilotConsoleLogs = win.__copilotConsoleLogs || [];
          win.__copilotConsoleOriginals = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
          };

          const pushConsole = (level: string, args: unknown[]) => {
            try {
              const message = args
                .map((value) =>
                  typeof value === "string"
                    ? value
                    : JSON.stringify(value, null, 0),
                )
                .join(" ");
              win.__copilotConsoleLogs!.push({
                level,
                message,
                ts: Date.now(),
              });
              if (win.__copilotConsoleLogs!.length > maxLogs) {
                win.__copilotConsoleLogs!.splice(
                  0,
                  win.__copilotConsoleLogs!.length - maxLogs,
                );
              }
            } catch {
              // Ignore serialization failures.
            }
          };

          console.log = (...args: unknown[]) => {
            pushConsole("log", args);
            win.__copilotConsoleOriginals!.log(...args);
          };
          console.info = (...args: unknown[]) => {
            pushConsole("info", args);
            win.__copilotConsoleOriginals!.info(...args);
          };
          console.warn = (...args: unknown[]) => {
            pushConsole("warn", args);
            win.__copilotConsoleOriginals!.warn(...args);
          };
          console.error = (...args: unknown[]) => {
            pushConsole("error", args);
            win.__copilotConsoleOriginals!.error(...args);
          };
        }

        if (!win.__copilotNetworkPatched) {
          win.__copilotNetworkPatched = true;
          win.__copilotNetworkLogs = win.__copilotNetworkLogs || [];

          const pushNetwork = (
            method: string,
            url: string,
            status: number | string,
            duration: number,
          ) => {
            win.__copilotNetworkLogs!.push({
              method,
              url,
              status,
              duration,
              ts: Date.now(),
            });
            if (win.__copilotNetworkLogs!.length > maxLogs) {
              win.__copilotNetworkLogs!.splice(
                0,
                win.__copilotNetworkLogs!.length - maxLogs,
              );
            }
          };

          const originalFetch = window.fetch.bind(window);
          window.fetch = async (...args: Parameters<typeof fetch>) => {
            const startedAt = Date.now();
            try {
              const response = await originalFetch(...args);
              const input = args[0];
              const method = (
                args[1]?.method ||
                (input instanceof Request && input.method) ||
                "GET"
              ).toString();
              const url =
                typeof input === "string"
                  ? input
                  : input instanceof Request
                    ? input.url
                    : "unknown";
              pushNetwork(method, url, response.status, Date.now() - startedAt);
              return response;
            } catch (error) {
              const input = args[0];
              const method = (
                args[1]?.method ||
                (input instanceof Request && input.method) ||
                "GET"
              ).toString();
              const url =
                typeof input === "string"
                  ? input
                  : input instanceof Request
                    ? input.url
                    : "unknown";
              pushNetwork(method, url, "ERR", Date.now() - startedAt);
              throw error;
            }
          };

          const originalOpen = XMLHttpRequest.prototype.open;
          const originalSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (
            this: XMLHttpRequest & {
              __copilotMethod?: string;
              __copilotUrl?: string;
            },
            method: string,
            url: string | URL,
            async?: boolean,
            username?: string | null,
            password?: string | null,
          ) {
            this.__copilotMethod = method ?? "GET";
            this.__copilotUrl =
              typeof url === "string" ? url : String(url ?? "unknown");
            return originalOpen.call(
              this,
              method,
              url,
              async ?? true,
              username,
              password,
            );
          };
          XMLHttpRequest.prototype.send = function (
            this: XMLHttpRequest & {
              __copilotMethod?: string;
              __copilotUrl?: string;
            },
            body?: Document | BodyInit | null,
          ) {
            const startedAt = Date.now();
            this.addEventListener("loadend", () => {
              pushNetwork(
                this.__copilotMethod || "GET",
                this.__copilotUrl || "unknown",
                this.status,
                Date.now() - startedAt,
              );
            });
            return originalSend.apply(this, [body] as Parameters<
              typeof originalSend
            >);
          };
        }
      },
    });
  } catch {
    // Ignore logger injection errors.
  }
}

export async function executeBrowserAction(
  action: BrowserAction,
): Promise<string> {
  try {
    await ensureClientLoggers();
    switch (action.type) {
      case "navigate":
        return await navigate(action.url);
      case "click":
        return await clickElement(
          action.selector,
          action.doubleClick,
          action.button,
          action.modifiers,
        );
      case "type":
        return await typeText(
          action.selector,
          action.text,
          action.submit,
          action.slowly,
        );
      case "scroll":
        return await scroll(action.direction, action.amount);
      case "back":
        return await goBack();
      case "forward":
        return await goForward();
      case "reload":
        return await reloadPage();
      case "newTab":
        return await openNewTab(action.url);
      case "closeTab":
        return await closeCurrentTab();
      case "screenshot":
        return await takeScreenshot();
      case "getHtml":
        return await getHtml(action.selector);
      case "waitForSelector":
        return await waitForSelector(action.selector, action.timeout);
      case "waitForText":
        return await waitForText(action.text, action.timeout);
      case "waitForTextGone":
        return await waitForTextGone(action.text, action.timeout);
      // Form actions
      case "radio":
        return await selectRadio(action.selector, action.value);
      case "check":
        return await checkElement(action.selector, true);
      case "uncheck":
        return await checkElement(action.selector, false);
      case "select":
        return await selectOption(action.selector, action.value);
      case "slider":
        return await setSlider(action.selector, action.value);
      case "fillForm":
        return await fillForm(action.fields);
      case "upload":
        return await uploadFile(action.selector);
      // Mouse actions
      case "drag":
        return await dragElement(action.startSelector, action.endSelector);
      case "hover":
        return await hoverElement(action.selector);
      case "focus":
        return await focusElement(action.selector);
      case "clickXY":
        return await clickAtCoordinates(action.x, action.y, action.button);
      // Dialog handling
      case "handleDialog":
        return await handleDialog(action.accept, action.promptText);
      // Keyboard
      case "pressKey":
        return await pressKey(action.key);
      // JavaScript evaluation
      case "evaluate":
        if (!allowEvaluateAction) {
          return EVALUATE_DISABLED_MESSAGE;
        }
        return await evaluateScript(action.script, action.selector);
      // Console & Network
      case "getConsole":
        return await getConsoleLogs(action.level);
      case "getNetwork":
        return await getNetworkRequests(action.includeStatic);
      case "playwright":
        if (
          !isPlaywrightEvaluateActionAllowed(
            action.action,
            action.params,
            false,
          )
        ) {
          return EVALUATE_DISABLED_MESSAGE;
        }
        return await executeViaPlaywright(action.action, action.params);
      default:
        return "Unknown action type";
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function navigate(url: string): Promise<string> {
  const tab = await getCurrentTab();
  // Ensure URL has protocol
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  await chrome.tabs.update(tab.id!, { url: fullUrl });
  return `Navigated to ${fullUrl}`;
}

async function clickElement(
  selector: string,
  doubleClick?: boolean,
  button?: "left" | "right" | "middle",
  modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[],
): Promise<string> {
  const tab = await getCurrentTab();
  console.log(
    `[Click] Attempting to click: "${selector}" double=${doubleClick} button=${button}`,
  );

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (
      sel: string,
      dblClick: boolean,
      btn: string,
      mods: string[],
    ) => {
      console.log(`[Click DOM] Selector received: "${sel}"`);

      // Helper: wait for element to be actionable (like Playwright)
      const waitForActionable = async (
        el: HTMLElement,
        timeout = 3000,
      ): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            style.opacity !== "0";
          const isEnabled = !(el as HTMLInputElement).disabled;
          if (isVisible && isEnabled) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };

      // Helper: try multiple click methods (like Playwright)
      const performClick = async (
        el: HTMLElement,
        isDouble: boolean,
        button: string,
        modifiers: string[],
      ): Promise<boolean> => {
        // Scroll into view
        el.scrollIntoView({ behavior: "instant", block: "center" });
        await new Promise((r) => setTimeout(r, 50));

        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Determine button number
        const buttonNum = button === "right" ? 2 : button === "middle" ? 1 : 0;

        // Build event options with modifiers
        const eventOpts: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY,
          button: buttonNum,
          ctrlKey: modifiers.includes("Control"),
          shiftKey: modifiers.includes("Shift"),
          altKey: modifiers.includes("Alt"),
          metaKey: modifiers.includes("Meta"),
        };

        // Focus first
        el.focus();

        // For right-click, use contextmenu event
        if (button === "right") {
          el.dispatchEvent(new MouseEvent("contextmenu", eventOpts));
          return true;
        }

        // Dispatch mouse events
        el.dispatchEvent(new MouseEvent("mousedown", eventOpts));
        el.dispatchEvent(new MouseEvent("mouseup", eventOpts));
        el.dispatchEvent(new MouseEvent("click", eventOpts));

        // Double click
        if (isDouble) {
          await new Promise((r) => setTimeout(r, 50));
          el.dispatchEvent(new MouseEvent("mousedown", eventOpts));
          el.dispatchEvent(new MouseEvent("mouseup", eventOpts));
          el.dispatchEvent(new MouseEvent("click", eventOpts));
          el.dispatchEvent(new MouseEvent("dblclick", eventOpts));
        }

        // For inputs, dispatch events
        if (el.tagName === "INPUT") {
          const input = el as HTMLInputElement;
          if (input.type === "radio" || input.type === "checkbox") {
            input.checked = !input.checked;
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }

        return true;
      };

      // Normalize selector - extract ref ID from various formats
      const normalizedSel = sel.trim();

      const refMatch = normalizedSel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      const refId = refMatch ? refMatch[1].toLowerCase() : null;
      if (refId) {
        console.log(`[Click DOM] Extracted ref: ${refId}`);

        // Wait for element with timeout
        let element: HTMLElement | null = null;
        const start = Date.now();
        while (Date.now() - start < 3000) {
          element = document.querySelector(
            `[data-copilot-ref="${refId}"]`,
          ) as HTMLElement;
          if (element) break;
          await new Promise((r) => setTimeout(r, 100));
        }

        if (element) {
          console.log(
            `[Click DOM] Found element:`,
            element.tagName,
            element.textContent?.slice(0, 30),
          );

          // Wait for actionable
          const isActionable = await waitForActionable(element);
          if (!isActionable) {
            console.warn(`[Click DOM] Element not actionable: ${refId}`);
          }

          await performClick(element, dblClick, btn, mods);
          return {
            success: true,
            message: `Clicked ${refId}${dblClick ? " (double)" : ""}`,
          };
        }

        // Debug: list available refs
        const allRefs = Array.from(
          document.querySelectorAll("[data-copilot-ref]"),
        )
          .slice(0, 20)
          .map((el) => {
            const ref = el.getAttribute("data-copilot-ref");
            const text = (el as HTMLElement).textContent?.slice(0, 20) || "";
            return `${ref}:"${text}"`;
          });
        console.log(`[Click DOM] Available refs:`, allRefs.join(", "));
        return { success: false, error: `Element not found: ${refId}` };
      }

      // Try direct CSS selector
      let element = document.querySelector(normalizedSel) as HTMLElement;

      // Support Playwright-style :has-text("...") and text="..." selectors
      if (!element) {
        const hasTextMatch = normalizedSel.match(
          /:has-text\(("([^"]+)"|'([^']+)')\)/,
        );
        const textMatch = normalizedSel.match(
          /text\s*=\s*("([^"]+)"|'([^']+)')/,
        );
        const textToFind =
          (hasTextMatch && (hasTextMatch[2] || hasTextMatch[3])) ||
          (textMatch && (textMatch[2] || textMatch[3])) ||
          "";

        if (textToFind) {
          const tag = hasTextMatch
            ? normalizedSel.split(":has-text")[0].trim()
            : "";
          const candidates = Array.from(
            document.querySelectorAll(tag || "*"),
          ) as HTMLElement[];
          for (const el of candidates) {
            const text =
              (el as HTMLElement).textContent?.trim() ||
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              "";
            if (text.includes(textToFind)) {
              element = el;
              break;
            }
          }
        }
      }

      // If not found, try as text content match
      if (!element) {
        const allClickables = Array.from(
          document.querySelectorAll(
            'button, a, [role="button"], [role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"], input[type="submit"], [onclick], [tabindex]',
          ),
        );
        for (const el of allClickables) {
          const text =
            (el as HTMLElement).textContent?.trim() ||
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            "";
          if (
            text === normalizedSel ||
            text.toLowerCase().includes(normalizedSel.toLowerCase())
          ) {
            element = el as HTMLElement;
            break;
          }
        }
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      await performClick(element, dblClick, btn, mods);
      return { success: true, message: `Clicked: ${sel}` };
    },
    args: [selector, doubleClick ?? false, button ?? "left", modifiers ?? []],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Click failed");
}

async function typeText(
  selector: string,
  text: string,
  submit?: boolean,
  slowly?: boolean,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (
      sel: string,
      txt: string,
      shouldSubmit: boolean,
      typeSlowly: boolean,
    ) => {
      // Try to extract ref ID
      const refMatch = sel
        .trim()
        .match(/^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/);
      let element: HTMLInputElement | HTMLTextAreaElement | null = null;

      if (refMatch) {
        const refId = refMatch[1].toLowerCase();
        // Wait for element
        const start = Date.now();
        while (Date.now() - start < 3000) {
          element = document.querySelector(
            `[data-copilot-ref="${refId}"]`,
          ) as HTMLInputElement;
          if (element) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      } else {
        element = document.querySelector(sel) as HTMLInputElement;
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      // Scroll into view and focus
      element.scrollIntoView({ behavior: "instant", block: "center" });
      await new Promise((r) => setTimeout(r, 50));
      element.focus();

      // Clear existing value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));

      // Type character by character
      const delay = typeSlowly ? 100 : 10;
      for (const char of txt) {
        element.value += char;
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: char, bubbles: true }),
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(
          new KeyboardEvent("keyup", { key: char, bubbles: true }),
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      element.dispatchEvent(new Event("change", { bubbles: true }));

      // Submit if requested (press Enter)
      if (shouldSubmit) {
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
          }),
        );
        // Also try form submit
        const form = element.closest("form");
        if (form) {
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
        }
      }

      return {
        success: true,
        message: `Typed "${txt}" into ${sel}${shouldSubmit ? " (submitted)" : ""}`,
      };
    },
    args: [selector, text, submit ?? false, slowly ?? false],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Type failed");
}

async function scroll(
  direction: "up" | "down",
  amount?: number,
): Promise<string> {
  const tab = await getCurrentTab();
  const scrollAmount = amount || 500;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (dir: string, amt: number) => {
      window.scrollBy(0, dir === "down" ? amt : -amt);
    },
    args: [direction, scrollAmount],
  });
  return `Scrolled ${direction} by ${scrollAmount}px`;
}

async function goBack(): Promise<string> {
  const tab = await getCurrentTab();
  await chrome.tabs.goBack(tab.id!);
  return "Navigated back";
}

async function goForward(): Promise<string> {
  const tab = await getCurrentTab();
  await chrome.tabs.goForward(tab.id!);
  return "Navigated forward";
}

async function reloadPage(): Promise<string> {
  const tab = await getCurrentTab();
  await chrome.tabs.reload(tab.id!);
  return "Page reloaded";
}

async function openNewTab(url?: string): Promise<string> {
  await chrome.tabs.create({ url: url || "about:newtab" });
  return `Opened new tab${url ? ` with ${url}` : ""}`;
}

async function closeCurrentTab(): Promise<string> {
  const tab = await getCurrentTab();
  await chrome.tabs.remove(tab.id!);
  return "Closed current tab";
}

async function takeScreenshot(): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  // Return base64 data URL (could be displayed or saved)
  return `Screenshot captured (${dataUrl.length} bytes)`;
}

// Export screenshot capture for Vision API
export async function captureScreenshot(): Promise<string> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: "png",
    });
    // Return full data URL (let the server handle parsing)
    return dataUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Screenshot capture failed:", message);
    if (message.includes("activeTab")) {
      const err = new Error(
        "SCREENSHOT_PERMISSION: activeTab permission not granted. Click the extension icon once or reinstall to grant permissions.",
      );
      (err as Error & { code?: string }).code = "ACTIVE_TAB";
      throw err;
    }
    throw error;
  }
}

async function getHtml(selector?: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel?: string) => {
      if (sel) {
        const element = document.querySelector(sel);
        return element
          ? element.outerHTML.slice(0, 5000)
          : `Element not found: ${sel}`;
      }
      return document.documentElement.outerHTML.slice(0, 10000);
    },
    args: [selector],
  });
  return results[0]?.result || "Failed to get HTML";
}

async function waitForSelector(
  selector: string,
  timeout: number = 5000,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (sel: string, ms: number) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (document.querySelector(sel)) {
          return { success: true, message: `Found ${sel}` };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { success: false, error: `Timeout waiting for ${sel}` };
    },
    args: [selector, timeout],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Wait failed");
}

// Wait for text to appear (like Playwright browser_wait_for)
async function waitForText(
  text: string,
  timeout: number = 5000,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (txt: string, ms: number) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (document.body.innerText.includes(txt)) {
          return { success: true, message: `Found text: "${txt}"` };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { success: false, error: `Timeout waiting for text: "${txt}"` };
    },
    args: [text, timeout],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Wait failed");
}

// Wait for text to disappear (like Playwright browser_wait_for textGone)
async function waitForTextGone(
  text: string,
  timeout: number = 5000,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (txt: string, ms: number) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (!document.body.innerText.includes(txt)) {
          return { success: true, message: `Text gone: "${txt}"` };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        success: false,
        error: `Timeout waiting for text to disappear: "${txt}"`,
      };
    },
    args: [text, timeout],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Wait failed");
}

// Fill multiple form fields at once (like Playwright browser_fill_form)
async function fillForm(
  fields: { selector: string; value: string; type?: string }[],
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (
      fieldsData: { selector: string; value: string; type?: string }[],
    ) => {
      const filled: string[] = [];
      let matchedCount = 0;
      for (const field of fieldsData) {
        // Extract ref if present
        const refMatch = field.selector
          .trim()
          .match(/^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/);
        let element: HTMLElement | null = null;

        if (refMatch) {
          element = document.querySelector(
            `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
          );
        } else {
          element = document.querySelector(field.selector);
        }

        if (!element) {
          filled.push(`❌ ${field.selector}: missing`);
          continue;
        }

        matchedCount += 1;

        const inputType = field.type || "text";

        if (inputType === "checkbox" || inputType === "radio") {
          (element as HTMLInputElement).checked = field.value === "true";
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (inputType === "select") {
          (element as HTMLSelectElement).value = field.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          (element as HTMLInputElement).value = field.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }

        filled.push(`✓ ${field.selector}`);
      }

      if (matchedCount === 0) {
        return {
          success: false,
          error: "Form fields not found",
        };
      }

      return {
        success: true,
        message: `Filled ${matchedCount}/${fieldsData.length} fields: ${filled.join(", ")}`,
      };
    },
    args: [fields],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Fill form failed");
}

// Click at specific coordinates (like Playwright browser_mouse_click_xy)
async function clickAtCoordinates(
  x: number,
  y: number,
  button?: "left" | "right",
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (posX: number, posY: number, btn: string) => {
      const element = document.elementFromPoint(posX, posY) as HTMLElement;
      if (!element) {
        return { success: false, error: `No element at (${posX}, ${posY})` };
      }

      const buttonNum = btn === "right" ? 2 : 0;
      const eventOpts: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: posX,
        clientY: posY,
        button: buttonNum,
      };

      if (btn === "right") {
        element.dispatchEvent(new MouseEvent("contextmenu", eventOpts));
      } else {
        element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
        element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
        element.dispatchEvent(new MouseEvent("click", eventOpts));
      }

      return { success: true, message: `Clicked at (${posX}, ${posY})` };
    },
    args: [x, y, button ?? "left"],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Click failed");
}

// Handle browser dialogs (alert, confirm, prompt)
async function handleDialog(
  accept: boolean,
  promptText?: string,
): Promise<string> {
  // Note: Chrome extensions can't directly intercept dialogs
  // This sets up a handler for future dialogs via content script
  const tab = await getCurrentTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (shouldAccept: boolean, text?: string) => {
      // Override window methods for next dialog
      const originalAlert = window.alert;
      const originalConfirm = window.confirm;
      const originalPrompt = window.prompt;

      const restore = () => {
        window.alert = originalAlert;
        window.confirm = originalConfirm;
        window.prompt = originalPrompt;
      };

      const restoreTimer = window.setTimeout(() => {
        restore();
      }, 10000);

      const restoreOnce = () => {
        window.clearTimeout(restoreTimer);
        restore();
      };

      window.alert = () => {
        restoreOnce();
      };
      window.confirm = () => {
        restoreOnce();
        return shouldAccept;
      };
      window.prompt = () => {
        restoreOnce();
        return shouldAccept ? text || "" : null;
      };
    },
    args: [accept, promptText],
  });
  return `Dialog handler set: ${accept ? "accept" : "dismiss"}`;
}

// Press a key (like Playwright browser_press_key)
async function pressKey(key: string): Promise<string> {
  const tab = await getCurrentTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (keyName: string) => {
      const activeElement = document.activeElement || document.body;
      const eventOpts: KeyboardEventInit = {
        key: keyName,
        code: keyName,
        bubbles: true,
        cancelable: true,
      };

      // Handle special keys
      if (keyName === "Enter") eventOpts.code = "Enter";
      else if (keyName === "Escape") eventOpts.code = "Escape";
      else if (keyName === "Tab") eventOpts.code = "Tab";
      else if (keyName === "ArrowUp") eventOpts.code = "ArrowUp";
      else if (keyName === "ArrowDown") eventOpts.code = "ArrowDown";
      else if (keyName === "ArrowLeft") eventOpts.code = "ArrowLeft";
      else if (keyName === "ArrowRight") eventOpts.code = "ArrowRight";
      else if (keyName === "PageUp") eventOpts.code = "PageUp";
      else if (keyName === "PageDown") eventOpts.code = "PageDown";

      activeElement.dispatchEvent(new KeyboardEvent("keydown", eventOpts));
      activeElement.dispatchEvent(new KeyboardEvent("keyup", eventOpts));
    },
    args: [key],
  });
  return `Pressed key: ${key}`;
}

// Check/uncheck checkbox or radio (like Playwright check/uncheck)
async function checkElement(
  selector: string,
  checked: boolean,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: async (sel: string, shouldCheck: boolean) => {
      const refMatch = sel
        .trim()
        .match(/^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/);
      let element: HTMLInputElement | null = null;

      if (refMatch) {
        element = document.querySelector(
          `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
        ) as HTMLInputElement;
      } else {
        element = document.querySelector(sel) as HTMLInputElement;
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      element.checked = shouldCheck;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));

      return {
        success: true,
        message: `${shouldCheck ? "Checked" : "Unchecked"}: ${sel}`,
      };
    },
    args: [selector, checked],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Check failed");
}

// Evaluate JavaScript (like Playwright browser_evaluate)
async function evaluateScript(
  script: string,
  selector?: string,
): Promise<string> {
  void script;
  void selector;
  return getEvaluateBlockedMessage();
}

// Get console logs (like Playwright browser_console_messages)
// Note: This requires injecting a logger beforehand
async function getConsoleLogs(
  level?: "error" | "warn" | "info" | "log",
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (filterLevel?: string) => {
      // Check if we have captured console logs
      const logs =
        (
          window as unknown as {
            __copilotConsoleLogs?: {
              level: string;
              message: string;
              ts: number;
            }[];
            __copilotConsolePatched?: boolean;
          }
        ).__copilotConsoleLogs || [];

      const filtered = filterLevel
        ? logs.filter((l) => l.level === filterLevel)
        : logs;

      return {
        success: true,
        message:
          filtered.length > 0
            ? filtered.map((l) => `[${l.level}] ${l.message}`).join("\n")
            : "No console logs captured (logger initialized)",
      };
    },
    args: [level],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Get console failed");
}

// Get network requests (like Playwright browser_network_requests)
// Note: This requires injecting a logger beforehand
async function getNetworkRequests(includeStatic?: boolean): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (includeStaticResources: boolean) => {
      const logs =
        (
          window as unknown as {
            __copilotNetworkLogs?: {
              method: string;
              url: string;
              status: number | string;
              duration: number;
              ts: number;
            }[];
          }
        ).__copilotNetworkLogs || [];

      if (logs.length > 0) {
        const trimmed = logs.slice(-20);
        return {
          success: true,
          message: trimmed
            .map((r) => `${r.method} ${r.url} (${r.status}, ${r.duration}ms)`)
            .join("\n"),
        };
      }

      // Fallback: Use Performance API to get network entries
      const entries = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];

      const staticExtensions = [
        ".js",
        ".css",
        ".png",
        ".jpg",
        ".gif",
        ".woff",
        ".woff2",
        ".svg",
        ".ico",
      ];

      const filtered = includeStaticResources
        ? entries
        : entries.filter(
            (e) => !staticExtensions.some((ext) => e.name.includes(ext)),
          );

      const requests = filtered.slice(-20).map((e) => ({
        url: e.name,
        type: e.initiatorType,
        duration: Math.round(e.duration),
      }));

      return {
        success: true,
        message:
          requests.length > 0
            ? requests
                .map((r) => `${r.type}: ${r.url} (${r.duration}ms)`)
                .join("\n")
            : "No network requests found",
      };
    },
    args: [includeStatic ?? false],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Get network failed");
}

// Upload file (trigger file input click - actual file selection requires user interaction)
async function uploadFile(selector: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string) => {
      const refMatch = sel
        .trim()
        .match(/^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/);
      let element: HTMLInputElement | null = null;

      if (refMatch) {
        element = document.querySelector(
          `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
        ) as HTMLInputElement;
      } else {
        element = document.querySelector(sel) as HTMLInputElement;
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      // Click to open file dialog
      element.click();

      return { success: true, message: `Opened file dialog for: ${sel}` };
    },
    args: [selector],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Upload failed");
}

// Parse action commands from LLM response
function findBracketCommandEnd(source: string, contentStart: number): number {
  let depth = 1;
  let index = contentStart;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  while (index < source.length && depth > 0) {
    const current = source[index];

    if (escaped) {
      escaped = false;
      index++;
      continue;
    }

    if (quote) {
      if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      index++;
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      index++;
      continue;
    }

    if (current === "[") {
      depth++;
    } else if (current === "]") {
      depth--;
    }

    index++;
  }

  return depth === 0 ? index : -1;
}

function splitValueAndOptionalTimeout(input: string): {
  value: string;
  timeout?: number;
} {
  const trimmed = input.trim();
  const lastComma = trimmed.lastIndexOf(",");

  if (lastComma === -1) {
    return { value: trimmed };
  }

  const candidateValue = trimmed.slice(0, lastComma).trim();
  const timeoutText = trimmed.slice(lastComma + 1).trim();
  const timeout = Number(timeoutText);

  if (
    candidateValue.length > 0 &&
    timeoutText.length > 0 &&
    Number.isFinite(timeout)
  ) {
    return { value: candidateValue, timeout };
  }

  return { value: trimmed };
}

function findCommaOutsideQuotes(source: string, startIndex: number): number {
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let index = startIndex; index < source.length; index++) {
    const current = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (current === "\\") {
        escaped = true;
        continue;
      }

      if (current === quote) {
        quote = null;
      }

      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }

    if (current === ",") {
      return index;
    }
  }

  return -1;
}

export function parseActionsFromResponse(response: string): BrowserAction[] {
  const actions: BrowserAction[] = [];

  // Simpler approach: find [ACTION: and then find the matching ]
  // Handle nested brackets by counting
  let i = 0;
  while (i < response.length) {
    const actionStart = response.indexOf("[ACTION:", i);
    if (actionStart === -1) break;

    const j = findBracketCommandEnd(response, actionStart + 8);

    if (j !== -1) {
      const actionContent = response.substring(actionStart + 8, j - 1).trim();
      // Split by first comma only
      const firstComma = actionContent.indexOf(",");
      const actionType =
        firstComma > 0
          ? actionContent.substring(0, firstComma).trim()
          : actionContent.trim();
      const params =
        firstComma > 0
          ? actionContent.substring(firstComma + 1).trim()
          : undefined;

      const parsedAction = parseAction(actionType.toLowerCase(), params);
      if (parsedAction) {
        actions.push(parsedAction);
      }
    } else {
      break;
    }

    i = j;
  }

  return actions;
}

function parseAction(type: string, params?: string): BrowserAction | null {
  const trimmedParams = params?.trim();

  switch (type) {
    case "navigate":
    case "goto":
    case "open":
      return trimmedParams ? { type: "navigate", url: trimmedParams } : null;
    case "click": {
      if (!trimmedParams) return null;
      if (trimmedParams.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmedParams) as {
            selector?: string;
            doubleClick?: boolean;
            button?: "left" | "right" | "middle";
            modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
          };
          return parsed.selector
            ? {
                type: "click",
                selector: parsed.selector,
                doubleClick: parsed.doubleClick,
                button: parsed.button,
                modifiers: parsed.modifiers,
              }
            : null;
        } catch {
          return { type: "click", selector: trimmedParams };
        }
      }
      return { type: "click", selector: trimmedParams };
    }
    case "doubleclick":
      return trimmedParams
        ? { type: "click", selector: trimmedParams, doubleClick: true }
        : null;
    case "type":
    case "input": {
      if (!trimmedParams) return null;
      if (trimmedParams.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmedParams) as {
            selector?: string;
            text?: string;
            submit?: boolean;
            slowly?: boolean;
          };
          return parsed.selector && parsed.text
            ? {
                type: "type",
                selector: parsed.selector,
                text: parsed.text,
                submit: parsed.submit,
                slowly: parsed.slowly,
              }
            : null;
        } catch {
          // fall through to string parsing
        }
      }
      const parts = trimmedParams.split(",").map((s) => s.trim());
      const selector = parts.shift();
      if (!selector) return null;

      let submit = false;
      let slowly = false;
      while (parts.length > 1) {
        const last = parts[parts.length - 1].toLowerCase();
        if (last === "submit") {
          submit = true;
          parts.pop();
          continue;
        }
        if (last === "slowly" || last === "slow") {
          slowly = true;
          parts.pop();
          continue;
        }
        break;
      }

      const text = parts.join(",").trim();
      return text ? { type: "type", selector, text, submit, slowly } : null;
    }
    case "scroll":
      return {
        type: "scroll",
        direction: trimmedParams === "up" ? "up" : "down",
      };
    case "back":
      return { type: "back" };
    case "forward":
      return { type: "forward" };
    case "reload":
    case "refresh":
      return { type: "reload" };
    case "newtab":
      return { type: "newTab", url: trimmedParams };
    case "closetab":
      return { type: "closeTab" };
    case "screenshot":
      return { type: "screenshot" };
    case "gethtml":
      return { type: "getHtml", selector: trimmedParams };
    case "waitforselector": {
      if (!trimmedParams) return null;
      const { value: selector, timeout } =
        splitValueAndOptionalTimeout(trimmedParams);
      return selector
        ? {
            type: "waitForSelector",
            selector,
            timeout: Number.isFinite(timeout) ? timeout : undefined,
          }
        : null;
    }
    case "waitfortext": {
      if (!trimmedParams) return null;
      const { value: text, timeout } =
        splitValueAndOptionalTimeout(trimmedParams);
      return text
        ? {
            type: "waitForText",
            text,
            timeout: Number.isFinite(timeout) ? timeout : undefined,
          }
        : null;
    }
    case "waitfortextgone": {
      if (!trimmedParams) return null;
      const { value: text, timeout } =
        splitValueAndOptionalTimeout(trimmedParams);
      return text
        ? {
            type: "waitForTextGone",
            text,
            timeout: Number.isFinite(timeout) ? timeout : undefined,
          }
        : null;
    }
    // New enhanced actions
    case "radio": {
      const [selector, value] =
        trimmedParams?.split(",").map((s) => s.trim()) || [];
      return selector ? { type: "radio", selector, value } : null;
    }
    case "check":
      return trimmedParams ? { type: "check", selector: trimmedParams } : null;
    case "uncheck":
      return trimmedParams
        ? { type: "uncheck", selector: trimmedParams }
        : null;
    case "select": {
      const [selector, value] =
        trimmedParams?.split(",").map((s) => s.trim()) || [];
      return selector && value ? { type: "select", selector, value } : null;
    }
    case "slider": {
      const [selector, valueStr] =
        trimmedParams?.split(",").map((s) => s.trim()) || [];
      const value = parseFloat(valueStr);
      return selector && !isNaN(value)
        ? { type: "slider", selector, value }
        : null;
    }
    case "fillform": {
      if (!trimmedParams) return null;
      if (trimmedParams.startsWith("{") || trimmedParams.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmedParams);
          const fields = Array.isArray(parsed) ? parsed : parsed?.fields || [];
          return fields.length > 0 ? { type: "fillForm", fields } : null;
        } catch {
          // fall through
        }
      }
      const fields = trimmedParams
        .split(";")
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const [selector, value] = pair.split("=").map((p) => p.trim());
          return { selector, value: value ?? "" };
        })
        .filter((f) => f.selector);
      return fields.length > 0 ? { type: "fillForm", fields } : null;
    }
    case "upload": {
      if (!trimmedParams) return null;
      const [selector] = trimmedParams.split(",").map((s) => s.trim());
      return selector ? { type: "upload", selector, files: [] } : null;
    }
    case "drag": {
      const [start, end] = trimmedParams?.split(",").map((s) => s.trim()) || [];
      return start && end
        ? { type: "drag", startSelector: start, endSelector: end }
        : null;
    }
    case "hover":
      return trimmedParams ? { type: "hover", selector: trimmedParams } : null;
    case "focus":
      return trimmedParams ? { type: "focus", selector: trimmedParams } : null;
    case "clickxy": {
      if (!trimmedParams) return null;
      const [xStr, yStr, button] =
        trimmedParams.split(",").map((s) => s.trim()) || [];
      const x = Number(xStr);
      const y = Number(yStr);
      return Number.isFinite(x) && Number.isFinite(y)
        ? {
            type: "clickXY",
            x,
            y,
            button: button as "left" | "right" | undefined,
          }
        : null;
    }
    case "handledialog": {
      if (!trimmedParams) return null;
      const [decision, ...textParts] =
        trimmedParams.split(",").map((s) => s.trim()) || [];
      const accept =
        decision.toLowerCase() === "accept" ||
        decision.toLowerCase() === "true";
      const promptText = textParts.join(",").trim();
      return {
        type: "handleDialog",
        accept,
        promptText: promptText || undefined,
      };
    }
    case "presskey":
    case "press":
    case "key":
      return trimmedParams ? { type: "pressKey", key: trimmedParams } : null;
    case "evaluate": {
      if (!trimmedParams) return null;
      if (trimmedParams.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmedParams) as {
            script?: string;
            selector?: string;
          };
          return parsed.script
            ? {
                type: "evaluate",
                script: parsed.script,
                selector: parsed.selector,
              }
            : null;
        } catch {
          // fall through
        }
      }
      const firstComma = trimmedParams.indexOf(",");
      if (firstComma > 0) {
        const possibleSelector = trimmedParams.substring(0, firstComma).trim();
        const script = trimmedParams.substring(firstComma + 1).trim();

        const selectorByPrefix =
          /^ref:\s*e\d+$/i.test(possibleSelector) ||
          /^e\d+$/i.test(possibleSelector) ||
          possibleSelector.startsWith("#") ||
          possibleSelector.startsWith(".") ||
          possibleSelector.startsWith("[");

        const selectorByTagLike =
          /^[a-z][a-z0-9:_-]*(?:\s*[>+~]\s*.*)?$/i.test(possibleSelector) &&
          /=>|\belement\b|\breturn\b|[;{}()]/.test(script);

        const looksLikeSelector = selectorByPrefix || selectorByTagLike;
        if (looksLikeSelector && script) {
          return { type: "evaluate", selector: possibleSelector, script };
        }
      }
      return { type: "evaluate", script: trimmedParams };
    }
    case "getconsole":
    case "console":
      return {
        type: "getConsole",
        level: trimmedParams as "error" | "warn" | "info" | "log",
      };
    case "getnetwork":
    case "network": {
      const includeStatic =
        trimmedParams === "true" || trimmedParams === "static";
      return { type: "getNetwork", includeStatic };
    }
    case "playwright": {
      // Format: playwright, action_name, {json_params}
      const firstComma = trimmedParams?.indexOf(",") || -1;
      if (firstComma > 0) {
        const action = trimmedParams!.substring(0, firstComma).trim();
        const paramsStr = trimmedParams!.substring(firstComma + 1).trim();
        try {
          const params = JSON.parse(paramsStr);
          return { type: "playwright", action, params };
        } catch {
          return { type: "playwright", action, params: { raw: paramsStr } };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// File operation types
export interface FileAction {
  type: "create" | "append";
  path: string;
  content: string;
}

export interface FileActionResult {
  success: boolean;
  filename: string;
  downloadId?: number;
  error?: string;
}

export async function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8",
): Promise<FileActionResult> {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "download-file",
        filename,
        content,
        mimeType,
      },
      (response?: {
        success?: boolean;
        downloadId?: number;
        error?: string;
      }) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            filename,
            error: chrome.runtime.lastError.message,
          });
        } else if (response?.success) {
          resolve({
            success: true,
            filename,
            downloadId: response.downloadId,
          });
        } else {
          resolve({
            success: false,
            filename,
            error: response?.error || "ダウンロードに失敗しました",
          });
        }
      },
    );
  });
}

// Parse file commands from LLM response
export function parseFileActionsFromResponse(response: string): FileAction[] {
  const actions: FileAction[] = [];

  let i = 0;
  while (i < response.length) {
    const fileStart = response.indexOf("[FILE:", i);
    if (fileStart === -1) break;

    const j = findBracketCommandEnd(response, fileStart + 6);

    if (j !== -1) {
      const fileContent = response.substring(fileStart + 6, j - 1).trim();
      const firstComma = findCommaOutsideQuotes(fileContent, 0);
      const secondComma =
        firstComma >= 0
          ? findCommaOutsideQuotes(fileContent, firstComma + 1)
          : -1;

      if (firstComma > 0 && secondComma > firstComma) {
        const actionType = fileContent.substring(0, firstComma).trim();
        const path = fileContent.substring(firstComma + 1, secondComma).trim();
        const content = fileContent.substring(secondComma + 1).trim();

        const normalizedAction = actionType.toLowerCase();
        if (
          (normalizedAction === "create" || normalizedAction === "append") &&
          path
        ) {
          actions.push({
            type: normalizedAction as "create" | "append",
            path,
            content,
          });
        }
      }
    } else {
      break;
    }

    i = j;
  }

  return actions;
}

// Execute file action — download to browser's default download folder
export async function executeFileAction(
  action: FileAction,
): Promise<FileActionResult> {
  try {
    const filename = normalizeDownloadRelativePath(action.path);
    return await downloadTextFile(
      filename,
      action.content,
      "text/plain;charset=utf-8",
    );
  } catch (error) {
    return {
      success: false,
      filename: action.path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// NEW ENHANCED DOM ACTIONS
// ============================================

// Select radio button
async function selectRadio(selector: string, value?: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string, val?: string) => {
      // Handle ref pattern
      const refMatch = sel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      let element: HTMLElement | null = null;

      if (refMatch) {
        const refId = refMatch[1].toLowerCase();
        element = document.querySelector(`[data-copilot-ref="${refId}"]`);
      } else {
        // Try as group selector - find radio with matching value or label
        const group = document.querySelector(sel);
        if (group) {
          if (val) {
            // Find radio by value or aria-label
            element =
              group.querySelector(`input[type="radio"][value="${val}"]`) ||
              group.querySelector(`[role="radio"][aria-label*="${val}"]`) ||
              group.querySelector(`[aria-label="${val}"]`);
          } else {
            // Click first radio in group
            element = group.querySelector(
              'input[type="radio"], [role="radio"]',
            );
          }
        } else {
          element = document.querySelector(sel);
        }
      }

      if (!element) {
        // Try finding by label text
        const allRadios = Array.from(
          document.querySelectorAll('input[type="radio"], [role="radio"]'),
        );
        for (const radio of allRadios) {
          const label =
            (radio as HTMLElement).getAttribute("aria-label") ||
            (radio as HTMLElement).textContent?.trim() ||
            "";
          if (val && (label.includes(val) || label === val)) {
            element = radio as HTMLElement;
            break;
          }
        }
      }

      if (!element)
        return {
          success: false,
          error: `Radio not found: ${sel}${val ? `, value: ${val}` : ""}`,
        };

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.click();

      // Dispatch events for frameworks
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));

      return { success: true, message: `Selected radio: ${val || sel}` };
    },
    args: [selector, value],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Radio selection failed");
}

// Select option from dropdown
async function selectOption(selector: string, value: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string, val: string) => {
      const refMatch = sel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      let element: HTMLSelectElement | HTMLElement | null = null;

      if (refMatch) {
        const refId = refMatch[1].toLowerCase();
        element = document.querySelector(`[data-copilot-ref="${refId}"]`);
      } else {
        element = document.querySelector(sel);
      }

      if (!element)
        return { success: false, error: `Select element not found: ${sel}` };

      element.scrollIntoView({ behavior: "smooth", block: "center" });

      // Handle native select
      if (element.tagName === "SELECT") {
        const select = element as HTMLSelectElement;
        const option = Array.from(select.options).find(
          (opt) => opt.value === val || opt.textContent?.trim() === val,
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return { success: true, message: `Selected: ${val}` };
        }
        return { success: false, error: `Option not found: ${val}` };
      }

      // Handle custom dropdown (click to open, then click option)
      element.click();

      // Wait a bit for dropdown to open
      return new Promise((resolve) => {
        setTimeout(() => {
          const options = document.querySelectorAll(
            '[role="option"], [role="menuitem"], li, .option',
          );
          for (const opt of Array.from(options)) {
            if (
              opt.textContent?.trim() === val ||
              opt.getAttribute("data-value") === val
            ) {
              (opt as HTMLElement).click();
              resolve({ success: true, message: `Selected: ${val}` });
              return;
            }
          }
          resolve({ success: false, error: `Option not found: ${val}` });
        }, 200);
      });
    },
    args: [selector, value],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Select failed");
}

// Set slider value
async function setSlider(selector: string, value: number): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string, val: number) => {
      const refMatch = sel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      let element: HTMLInputElement | HTMLElement | null = null;

      if (refMatch) {
        const refId = refMatch[1].toLowerCase();
        element = document.querySelector(`[data-copilot-ref="${refId}"]`);
      } else {
        element = document.querySelector(sel);
      }

      if (!element)
        return { success: false, error: `Slider not found: ${sel}` };

      element.scrollIntoView({ behavior: "smooth", block: "center" });

      // Handle range input
      if (
        element.tagName === "INPUT" &&
        (element as HTMLInputElement).type === "range"
      ) {
        const input = element as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, message: `Set slider to ${val}` };
      }

      // Handle custom slider (aria-valuenow)
      if (element.getAttribute("role") === "slider") {
        const min = parseFloat(element.getAttribute("aria-valuemin") || "0");
        const max = parseFloat(element.getAttribute("aria-valuemax") || "100");
        const clampedVal = Math.max(min, Math.min(max, val));

        // Try setting via aria attribute and dispatching events
        element.setAttribute("aria-valuenow", String(clampedVal));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));

        // Some frameworks need mouse events - simulate drag
        const rect = element.getBoundingClientRect();
        const percent = (clampedVal - min) / (max - min);
        const x = rect.left + rect.width * percent;
        const y = rect.top + rect.height / 2;

        element.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true }),
        );

        return { success: true, message: `Set slider to ${clampedVal}` };
      }

      return { success: false, error: `Element is not a slider: ${sel}` };
    },
    args: [selector, value],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Slider failed");
}

// Drag element from start to end
async function dragElement(
  startSelector: string,
  endSelector: string,
): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (startSel: string, endSel: string) => {
      const getElement = (sel: string): HTMLElement | null => {
        const refMatch = sel.match(
          /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
        );
        if (refMatch) {
          return document.querySelector(
            `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
          );
        }
        return document.querySelector(sel);
      };

      const startEl = getElement(startSel);
      const endEl = getElement(endSel);

      if (!startEl)
        return {
          success: false,
          error: `Start element not found: ${startSel}`,
        };
      if (!endEl)
        return { success: false, error: `End element not found: ${endSel}` };

      const startRect = startEl.getBoundingClientRect();
      const endRect = endEl.getBoundingClientRect();

      const startX = startRect.left + startRect.width / 2;
      const startY = startRect.top + startRect.height / 2;
      const endX = endRect.left + endRect.width / 2;
      const endY = endRect.top + endRect.height / 2;

      // Dispatch drag events
      const dataTransfer = new DataTransfer();

      startEl.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          clientX: startX,
          clientY: startY,
          dataTransfer,
        }),
      );

      startEl.dispatchEvent(
        new DragEvent("drag", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          dataTransfer,
        }),
      );

      endEl.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          dataTransfer,
        }),
      );

      endEl.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          dataTransfer,
        }),
      );

      endEl.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          dataTransfer,
        }),
      );

      startEl.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          dataTransfer,
        }),
      );

      return {
        success: true,
        message: `Dragged from ${startSel} to ${endSel}`,
      };
    },
    args: [startSelector, endSelector],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Drag failed");
}

// Hover over element
async function hoverElement(selector: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string) => {
      const refMatch = sel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      let element: HTMLElement | null = null;

      if (refMatch) {
        element = document.querySelector(
          `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
        );
      } else {
        element = document.querySelector(sel);
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      element.scrollIntoView({ behavior: "smooth", block: "center" });

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      element.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, clientX: x, clientY: y }),
      );
      element.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }),
      );

      return { success: true, message: `Hovered over: ${sel}` };
    },
    args: [selector],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Hover failed");
}

// Focus on element
async function focusElement(selector: string): Promise<string> {
  const tab = await getCurrentTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (sel: string) => {
      const refMatch = sel.match(
        /^(?:\[\s*)?(?:ref:\s*)?([eE]\d+)(?:\s*\])?(?:\b.*)?$/,
      );
      let element: HTMLElement | null = null;

      if (refMatch) {
        element = document.querySelector(
          `[data-copilot-ref="${refMatch[1].toLowerCase()}"]`,
        );
      } else {
        element = document.querySelector(sel);
      }

      if (!element)
        return { success: false, error: `Element not found: ${sel}` };

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus();

      return { success: true, message: `Focused: ${sel}` };
    },
    args: [selector],
  });
  const result = results[0]?.result;
  return resolveScriptResultMessage(result, "Focus failed");
}

// ============================================
// PLAYWRIGHT MCP INTEGRATION
// ============================================

// Execute action via Playwright MCP (delegated to VS Code extension)
export async function executeViaPlaywright(
  action: string,
  params: Record<string, unknown>,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const bridgeBaseUrl = await getBridgeBaseUrl();
    const response = await fetch(`${bridgeBaseUrl}/playwright`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...BRIDGE_CLIENT_HEADERS,
      },
      body: JSON.stringify({ action, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorPayload = (await response.json()) as { error?: unknown };
        if (
          errorPayload &&
          typeof errorPayload.error === "string" &&
          errorPayload.error.trim().length > 0
        ) {
          detail = errorPayload.error;
        }
      } catch {
        // ignore json parse error and fallback to status text
      }

      return detail
        ? `Playwright error: ${response.status} - ${detail}`
        : `Playwright error: ${response.status}`;
    }

    const result = await response.json();
    if (result.success) {
      const embeddedFailure = findEmbeddedPlaywrightFailure(result.data);
      if (embeddedFailure) {
        return `Playwright error: ${embeddedFailure}`;
      }
      return result.message || `Playwright: ${action} completed`;
    } else {
      return `Playwright error: ${result.error}`;
    }
  } catch (error) {
    return `Playwright connection failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

function findEmbeddedPlaywrightFailure(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const queue: Record<string, unknown>[] = [data as Record<string, unknown>];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current.success === false) {
      const error =
        typeof current.error === "string" ? current.error.trim() : "";
      const message =
        typeof current.message === "string" ? current.message.trim() : "";
      if (error || message) {
        return error || message;
      }
    }

    for (const value of Object.values(current)) {
      if (!value || typeof value !== "object") {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            queue.push(item as Record<string, unknown>);
          }
        }
        continue;
      }

      queue.push(value as Record<string, unknown>);
    }
  }

  return null;
}

// Check if Playwright MCP is available
export async function checkPlaywrightAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const bridgeBaseUrl = await getBridgeBaseUrl();
    const response = await fetch(`${bridgeBaseUrl}/playwright/status`, {
      method: "GET",
      headers: BRIDGE_CLIENT_HEADERS,
      signal: controller.signal,
    });
    const result = await response.json();
    playwrightAvailable = result.available === true;
    return playwrightAvailable;
  } catch {
    playwrightAvailable = false;
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Execute with fallback: try local DOM first, then Playwright (or vice versa if preferPlaywright)
export async function executeWithFallback(
  action: BrowserAction,
): Promise<string> {
  if (action.type === "evaluate" && !allowEvaluateAction) {
    return EVALUATE_DISABLED_MESSAGE;
  }

  const allowInternalEvaluate = action.type !== "playwright";

  const isExecutionFailure = (
    targetAction: BrowserAction,
    message: string,
  ): boolean => {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    if (normalized.startsWith("error:")) {
      return true;
    }

    if (
      normalized.startsWith("playwright error:") ||
      normalized.startsWith("playwright connection failed:")
    ) {
      return true;
    }

    const notFoundPrefixes = ["element not found:"];
    if (targetAction.type === "radio") {
      notFoundPrefixes.push("radio not found:");
    }
    if (targetAction.type === "select") {
      notFoundPrefixes.push("select element not found:", "option not found:");
    }
    if (targetAction.type === "slider") {
      notFoundPrefixes.push("slider not found:", "element is not a slider:");
    }
    if (targetAction.type === "drag") {
      notFoundPrefixes.push(
        "start element not found:",
        "end element not found:",
      );
    }
    if (targetAction.type === "clickXY") {
      notFoundPrefixes.push("no element at (");
    }

    if (notFoundPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      return true;
    }

    if (normalized.startsWith("timeout waiting")) {
      return true;
    }

    if (normalized.endsWith(" failed") || normalized.startsWith("failed to ")) {
      return true;
    }

    if (targetAction.type === "playwright") {
      return normalized === EVALUATE_DISABLED_MESSAGE_LOWER;
    }

    if (targetAction.type === "evaluate") {
      return (
        normalized === EVALUATE_DISABLED_MESSAGE_LOWER ||
        normalized.startsWith("evaluate blocked:") ||
        normalized.startsWith("eval error:") ||
        normalized === "evaluate failed"
      );
    }

    if (targetAction.type === "getHtml") {
      return (
        normalized === "failed to get html" ||
        normalized.startsWith("element not found:")
      );
    }

    if (targetAction.type === "fillForm") {
      return (
        normalized === "fill form failed" ||
        normalized === "form fields not found"
      );
    }

    if (
      targetAction.type === "waitForSelector" ||
      targetAction.type === "waitForText" ||
      targetAction.type === "waitForTextGone"
    ) {
      return (
        normalized === "wait failed" || normalized.startsWith("timeout waiting")
      );
    }

    return (
      normalized === EVALUATE_DISABLED_MESSAGE_LOWER ||
      normalized.includes("connection failed")
    );
  };

  // If prefer Playwright and it's available, try Playwright first
  if (preferPlaywright && playwrightAvailable) {
    console.log("[Playwright] Preferred mode - using Playwright MCP...");
    const playwrightAction = convertToPlaywrightAction(action);
    if (playwrightAction) {
      if (
        !isPlaywrightEvaluateActionAllowed(
          playwrightAction.action,
          playwrightAction.params,
          allowInternalEvaluate,
        )
      ) {
        if (action.type === "playwright") {
          return EVALUATE_DISABLED_MESSAGE;
        }
        console.log(
          "[Playwright] Skipping browser_evaluate because evaluate action is disabled.",
        );
      } else {
        const result = await executeViaPlaywright(
          playwrightAction.action,
          playwrightAction.params,
        );
        // If Playwright succeeded, return
        if (!isExecutionFailure(action, result)) {
          return result;
        }
        console.log("[Playwright] Failed, falling back to local DOM...");
      }
    }
  }

  // Try local DOM execution
  const localResult = await executeBrowserAction(action);

  // Check if local execution failed (includes "not found", "Error:", "failed")
  const isError = isExecutionFailure(action, localResult);

  // If successful or Playwright not available, return local result
  if (!isError || !playwrightAvailable) {
    return localResult;
  }

  // Fallback to Playwright for complex actions
  console.log("[Fallback] Local DOM failed, trying Playwright...");

  // Convert action to Playwright format
  const playwrightAction = convertToPlaywrightAction(action);
  if (playwrightAction) {
    if (
      !isPlaywrightEvaluateActionAllowed(
        playwrightAction.action,
        playwrightAction.params,
        allowInternalEvaluate,
      )
    ) {
      if (action.type === "playwright") {
        return EVALUATE_DISABLED_MESSAGE;
      }
      return localResult;
    }

    return await executeViaPlaywright(
      playwrightAction.action,
      playwrightAction.params,
    );
  }

  return localResult;
}

export function convertToPlaywrightAction(
  action: BrowserAction,
): { action: string; params: Record<string, unknown> } | null {
  switch (action.type) {
    case "click":
      return { action: "browser_click", params: { ref: action.selector } };
    case "type":
      return {
        action: "browser_type",
        params: { ref: action.selector, text: action.text },
      };
    case "radio":
      return {
        action: "browser_click",
        params: { ref: action.selector, element: `Radio: ${action.value}` },
      };
    case "select":
      return {
        action: "browser_select_option",
        params: { ref: action.selector, values: [action.value] },
      };
    case "drag":
      return {
        action: "browser_drag",
        params: { startRef: action.startSelector, endRef: action.endSelector },
      };
    case "hover":
      return { action: "browser_hover", params: { ref: action.selector } };
    case "navigate":
      return { action: "browser_navigate", params: { url: action.url } };
    case "scroll":
      // Playwright doesn't have direct scroll, use keyboard
      return {
        action: "browser_press_key",
        params: { key: action.direction === "down" ? "PageDown" : "PageUp" },
      };
    case "back":
      return { action: "browser_navigate_back", params: {} };
    case "forward":
      // Playwright: go forward (via evaluate)
      return {
        action: "browser_evaluate",
        params: { function: "() => { history.forward(); }" },
      };
    case "reload":
      return {
        action: "browser_evaluate",
        params: { function: "() => { location.reload(); }" },
      };
    case "newTab":
      return {
        action: "browser_tabs",
        params:
          typeof action.url === "string" && action.url.trim().length > 0
            ? { action: "new", url: action.url.trim() }
            : { action: "new" },
      };
    case "closeTab":
      return {
        action: "browser_tabs",
        params: { action: "close" },
      };
    case "screenshot":
      return {
        action: "browser_take_screenshot",
        params: { type: "png" },
      };
    case "getHtml":
      return {
        action: "browser_snapshot",
        params: {},
      };
    case "waitForSelector": {
      const timeoutMs = Math.min(
        60000,
        Math.max(100, Math.round(action.timeout ?? 5000)),
      );
      const selectorJson = JSON.stringify(action.selector);
      return {
        action: "browser_evaluate",
        params: {
          function: `async () => {
  const selector = ${selectorJson};
  const timeoutMs = ${timeoutMs};
  const start = Date.now();

  const resolveElement = () => {
    const refMatch = selector.match(
      new RegExp("^(?:\\[\\s*)?(?:ref:\\s*)?([eE]\\d+)(?:\\s*\\])?(?:\\b.*)?$"),
    );
    if (refMatch) {
      return document.querySelector(
        \`[data-copilot-ref="\${refMatch[1].toLowerCase()}"]\`,
      );
    }

    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  };

  while (Date.now() - start <= timeoutMs) {
    if (resolveElement()) {
      return { success: true, selector };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    success: false,
    error: \`Element not found within \${timeoutMs}ms: \${selector}\`,
  };
}`,
        },
      };
    }
    case "slider":
      // Use fill_form for slider
      return {
        action: "browser_fill_form",
        params: {
          fields: [
            {
              ref: action.selector,
              type: "slider",
              value: String(action.value),
              name: "slider",
            },
          ],
        },
      };
    case "focus":
      // Click to focus
      return { action: "browser_click", params: { ref: action.selector } };
    case "playwright":
      // Already a Playwright action, pass through
      return { action: action.action, params: action.params };
    default:
      return null;
  }
}
