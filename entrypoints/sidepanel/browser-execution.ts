import {
  effectiveBrowserActions,
  type ChatContext,
} from "../../standalone-bridge/src/chat-context";
import type { BrowserAction } from "./types";

export interface BrowserSession {
  context: ChatContext;
  frames: { frameId: number; documentId?: string; origin?: string }[];
  personal?: Record<string, string>;
  signal?: AbortSignal;
}

export function parseFrameReference(selector: string): {
  frameId: number;
  selector: string;
} {
  const match = selector.trim().match(/^(?:ref:)?f(\d+):(e\d+)$/i);
  return match
    ? { frameId: Number(match[1]), selector: `ref:${match[2].toLowerCase()}` }
    : { frameId: 0, selector };
}

export function browserActionAllowed(
  action: BrowserAction,
  context: ChatContext,
): boolean {
  if (!effectiveBrowserActions(context).includes(action.type)) return false;
  if (action.type === "type" && (action.submit || /[\r\n]/.test(action.text)))
    return false;
  return true;
}

export function resolveProfileValue(
  value: string,
  personal?: Record<string, string>,
): string {
  if (!value.includes("{{profile.")) return value;
  const match = value.match(
    /^\{\{profile\.(fullName|email|phone|postalCode|address)\}\}$/,
  );
  if (!match || !personal?.[match[1]])
    throw new Error("Personal field is not authorized for this task");
  return personal[match[1]];
}

export async function executeBoundBrowserAction(
  action: BrowserAction,
  session: BrowserSession,
): Promise<string> {
  if (session.signal?.aborted) return "Error: task cancelled";
  if (!browserActionAllowed(action, session.context))
    return "Error: action is not authorized; final submission requires user action";
  const target = session.context.target!;
  const tab = await chrome.tabs.get(target.tabId);
  if (session.signal?.aborted) return "Error: task cancelled";
  if (tab.url !== target.url)
    return "Error: target page changed; acquire fresh context before continuing";
  if (action.type === "navigate") {
    let url: URL;
    try {
      url = new URL(action.url);
    } catch {
      return "Error: invalid navigation URL";
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /(?:delete|logout|unsubscribe|checkout|purchase)/i.test(url.pathname)
    )
      return "Error: navigation requires user action";
    if (
      url.origin !== new URL(target.url).origin &&
      !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))
    )
      return "Error: destination site permission is required";
    if (session.personal && url.origin !== new URL(target.url).origin)
      return "Error: personal-profile authorization is restricted to the current site";
    if (session.signal?.aborted) return "Error: task cancelled";
    await chrome.tabs.update(target.tabId, { url: url.href });
    return "Navigation requested; the next snapshot must confirm the destination";
  }
  if (
    action.type === "back" ||
    action.type === "forward" ||
    action.type === "reload"
  )
    return "Error: history navigation and reload require user action to preserve unsaved forms";
  let prepared = action;
  let frameId = 0;
  if ("selector" in action && typeof action.selector === "string") {
    const reference = parseFrameReference(action.selector);
    frameId = reference.frameId;
    prepared = { ...action, selector: reference.selector };
  }
  if (prepared.type === "type")
    prepared = {
      ...prepared,
      text: resolveProfileValue(prepared.text, session.personal),
    };
  if (prepared.type === "fillForm") {
    const fields = prepared.fields.map((field) => ({
      ...field,
      reference: parseFrameReference(field.selector),
    }));
    frameId = fields[0]?.reference.frameId ?? 0;
    if (fields.some((field) => field.reference.frameId !== frameId))
      return "Error: fill one frame per action";
    prepared = {
      ...prepared,
      fields: fields.map((field) => ({
        ...field,
        selector: field.reference.selector,
        value: resolveProfileValue(field.value, session.personal),
      })),
    };
  }
  const frame = session.frames.find((frame) => frame.frameId === frameId);
  const documentId = frame?.documentId;
  if (!documentId)
    return "Error: target document is not verified; acquire a fresh snapshot";
  if (session.personal && frame?.origin !== new URL(target.url).origin)
    return "Error: personal-profile authorization does not include this frame origin";
  if (session.signal?.aborted) return "Error: task cancelled";
  const results = await chrome.scripting.executeScript({
    target: { tabId: target.tabId, documentIds: [documentId] },
    func: async (command: BrowserAction) => {
      const roots: (Document | ShadowRoot)[] = [document];
      for (
        let rootIndex = 0;
        rootIndex < roots.length && roots.length < 100;
        rootIndex++
      ) {
        roots[rootIndex].querySelectorAll("*").forEach((element) => {
          if (element.shadowRoot && roots.length < 100)
            roots.push(element.shadowRoot);
        });
      }
      const find = (selector: string): Element | null => {
        const ref = selector.trim().match(/^(?:ref:)?(e\d+)$/i);
        const query = ref
          ? `[data-copilot-ref="${ref[1].toLowerCase()}"]`
          : selector;
        const matches: Element[] = [];
        for (const root of roots) {
          matches.push(...Array.from(root.querySelectorAll(query)));
        }
        if (matches.length !== 1) return null;
        const found = matches[0];
        return found instanceof HTMLLabelElement
          ? (found.control ?? found)
          : found;
      };
      const forbidden = (element: Element) => {
        const input = element as HTMLInputElement;
        return (
          input.disabled ||
          input.readOnly ||
          /^(password|hidden|file|submit|button|image)$/i.test(
            input.type ?? "",
          ) ||
          /(?:password|one-time-code|cc-|credit.?card|security.?code|otp)/i.test(
            `${input.autocomplete ?? ""} ${input.name ?? ""} ${input.id ?? ""}`,
          )
        );
      };
      const setField = (
        element: Element,
        value: string,
        checked?: boolean,
      ): boolean => {
        if (forbidden(element) || !element.getClientRects().length)
          return false;
        if (
          element instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type)
        ) {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "checked",
          )?.set;
          setter?.call(element, checked ?? value === "true");
        } else if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find(
            (item) => item.value === value || item.text === value,
          );
          if (!option) return false;
          Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
          )?.set?.call(element, option.value);
        } else if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          const prototype =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
            element,
            value,
          );
        } else return false;
        element.dispatchEvent(
          new Event("input", { bubbles: true, composed: true }),
        );
        element.dispatchEvent(
          new Event("change", { bubbles: true, composed: true }),
        );
        return true;
      };
      const verifyField = (
        selector: string,
        value: string,
        checked?: boolean,
      ): boolean => {
        const element = find(selector);
        if (
          element instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type)
        )
          return element.checked === (checked ?? value === "true");
        if (element instanceof HTMLSelectElement)
          return (
            element.value === value ||
            element.selectedOptions[0]?.text === value
          );
        return (
          (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement) &&
          element.value === value
        );
      };
      if (command.type === "scroll") {
        window.scrollBy(
          0,
          (command.direction === "down" ? 1 : -1) *
            Math.min(command.amount ?? 600, 2000),
        );
        return "Scrolled; refresh page context";
      }
      if (
        command.type === "waitForText" ||
        command.type === "waitForTextGone" ||
        command.type === "waitForSelector"
      ) {
        const deadline = Date.now() + Math.min(command.timeout ?? 1500, 5000);
        do {
          const ready =
            command.type === "waitForSelector"
              ? Boolean(find(command.selector))
              : command.type === "waitForText"
                ? document.body.innerText.includes(command.text)
                : !document.body.innerText.includes(command.text);
          if (ready) return "Page condition verified";
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        return "Error: page condition was not reached";
      }
      if (command.type === "getHtml")
        return "Page context is provided by the next snapshot";
      if (command.type === "fillForm") {
        const checks: { selector: string; value: string }[] = [];
        for (const field of command.fields) {
          const element = find(field.selector);
          if (!element || forbidden(element))
            return "Error: a form field is unavailable or restricted; no fields were filled";
        }
        for (const field of command.fields) {
          if (!setField(find(field.selector)!, field.value))
            return "Error: partial form fill; inspect the page before retrying";
          checks.push(field);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return checks.every((field) => verifyField(field.selector, field.value))
          ? `Verified ${checks.length} fields; not submitted`
          : "Error: field read-back did not match; inspect before retrying";
      }
      if (!("selector" in command) || !command.selector)
        return "Error: unsupported operation";
      const element = find(command.selector);
      if (!element || !element.getClientRects().length)
        return "Error: element not found or not visible";
      if (command.type === "click") {
        if (
          element instanceof HTMLInputElement &&
          ["radio", "checkbox"].includes(element.type)
        ) {
          const checked = element.type === "radio" || !element.checked;
          if (!setField(element, String(checked), checked))
            return "Error: restricted field";
          return verifyField(command.selector, String(checked), checked)
            ? "Selection verified"
            : "Error: selection did not persist";
        }
        if (element instanceof HTMLAnchorElement && element.href) {
          const url = new URL(element.href, location.href);
          if (
            url.origin !== location.origin ||
            /(?:delete|logout|unsubscribe|checkout|purchase)/i.test(
              url.pathname,
            ) ||
            element.hasAttribute("download")
          )
            return "Error: this link requires user action";
          if (element.target && element.target !== "_self")
            return "Error: opening another tab requires user action";
          location.assign(url.href);
          return "Link activated; refresh context to verify navigation";
        }
        return "Error: button effect cannot be verified safely; click it manually, then continue";
      }
      if (command.type === "focus" || command.type === "hover") {
        if (forbidden(element)) return "Error: restricted field";
        if (command.type === "focus") (element as HTMLElement).focus();
        else
          element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return "Interaction dispatched; refresh context";
      }
      const value =
        command.type === "type"
          ? command.text
          : command.type === "select"
            ? command.value
            : command.type === "slider"
              ? String(command.value)
              : command.type === "uncheck"
                ? "false"
                : "true";
      if (!setField(element, value))
        return "Error: field is restricted or incompatible";
      await new Promise((resolve) => setTimeout(resolve, 50));
      return verifyField(command.selector, value)
        ? "Field value verified; not submitted"
        : "Error: field value did not persist; inspect before retrying";
    },
    args: [prepared],
  });
  const result = results[0]?.result;
  return typeof result === "string"
    ? result
    : "Error: no verified action result";
}
