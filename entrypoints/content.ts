// Content Script - ページ内容抽出用
// 通常のページ操作はサイドパネルから chrome.scripting.executeScript で行う。
// この常駐 content script は将来の拡張用 placeholder として local のみで有効化する。

const LOCAL_PLACEHOLDER_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://localhost/*",
  "https://127.0.0.1/*",
];

export default defineContentScript({
  matches: LOCAL_PLACEHOLDER_MATCHES,
  runAt: "document_idle",

  main() {
    // メッセージリスナー（将来の拡張用）
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: {
          content: string;
          interactiveElements?: string;
        }) => void,
      ) => {
        if (!message || typeof message !== "object") {
          return;
        }

        const typedMessage = message as { type: string };

        if (typedMessage.type === "extractContent") {
          const content = extractVisibleText();
          sendResponse({ content });
        }
        if (typedMessage.type === "extractContentWithElements") {
          const content = extractVisibleText();
          const interactiveElements = extractInteractiveElements();
          sendResponse({ content, interactiveElements });
        }
        return true;
      },
    );
  },
});

function extractVisibleText(): string {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }

        const tagName = parent.tagName;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // パスワードフィールドは除外
        if (parent instanceof HTMLInputElement && parent.type === "password") {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const texts: string[] = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (text && text.length > 0) {
      texts.push(text);
    }
  }

  // 最大50,000文字に制限
  return texts.join(" ").slice(0, 50000);
}

function extractInteractiveElements(): string {
  const elements: string[] = [];
  let refCounter = 0;

  // Helper: get semantic label for an element
  function getLabel(el: Element): string {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.closest("label")?.textContent?.trim()?.slice(0, 40) ||
      el.textContent?.trim()?.slice(0, 40) ||
      ""
    );
  }

  // Helper: get WAI-ARIA role
  function getRole(el: Element): string {
    return el.getAttribute("role") || el.tagName.toLowerCase();
  }

  // Helper: assign ref and build entry
  function addElement(
    el: Element,
    role: string,
    label: string,
    extra?: string,
  ) {
    const ref = `e${refCounter++}`;
    // Attach ref to DOM for click targeting
    el.setAttribute("data-copilot-ref", ref);
    const labelPart = label ? ` "${label}"` : "";
    const extraPart = extra ? ` ${extra}` : "";
    elements.push(`[${ref}] ${role}${labelPart}${extraPart}`);
  }

  // Buttons (including role="button")
  document.querySelectorAll('button, [role="button"]').forEach((el) => {
    if (!isVisible(el)) return;
    addElement(el, getRole(el), getLabel(el));
  });

  // Links
  document.querySelectorAll("a[href]").forEach((el) => {
    if (!isVisible(el) || elements.length > 80) return;
    const href = el.getAttribute("href")?.slice(0, 60) || "";
    addElement(el, "link", getLabel(el), `→ ${href}`);
  });

  // Inputs (text, email, search, password, number, tel, url)
  document
    .querySelectorAll(
      "input:not([type='hidden']):not([type='radio']):not([type='checkbox']), textarea",
    )
    .forEach((el) => {
      if (!isVisible(el)) return;
      const inputEl = el as HTMLInputElement;
      const type = inputEl.type || "text";
      const placeholder = inputEl.placeholder || "";
      const name = inputEl.name || "";
      const label = getLabel(el) || placeholder || name;
      addElement(el, `input[${type}]`, label);
    });

  // Radio buttons
  document
    .querySelectorAll("input[type='radio'], [role='radio']")
    .forEach((el) => {
      if (!isVisible(el)) return;
      const checked = (el as HTMLInputElement).checked ? " [checked]" : "";
      addElement(el, "radio", getLabel(el), checked);
    });

  // Checkboxes
  document
    .querySelectorAll("input[type='checkbox'], [role='checkbox']")
    .forEach((el) => {
      if (!isVisible(el)) return;
      const checked = (el as HTMLInputElement).checked ? " [checked]" : "";
      addElement(el, "checkbox", getLabel(el), checked);
    });

  // Select dropdowns
  document
    .querySelectorAll("select, [role='listbox'], [role='combobox']")
    .forEach((el) => {
      if (!isVisible(el)) return;
      const selectEl = el as HTMLSelectElement;
      const selected = selectEl.options?.[selectEl.selectedIndex]?.text || "";
      addElement(el, "select", getLabel(el), selected ? `[${selected}]` : "");
    });

  // Clickable divs/spans (cursor:pointer)
  document
    .querySelectorAll(
      "[onclick], [role='tab'], [role='menuitem'], [role='option']",
    )
    .forEach((el) => {
      if (!isVisible(el) || elements.length > 100) return;
      addElement(el, getRole(el), getLabel(el));
    });

  return elements.slice(0, 100).join("\n");
}

// Check if element is visible
function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
