export interface DisplayTextCommand {
  type: "find" | "edit" | "undo" | "clear";
  origin: string;
  taskId: string;
  text?: string;
  edits?: { token: string; text: string }[];
  editId?: string;
}

export interface DisplayTextResult {
  status:
    | "found"
    | "not-found"
    | "ambiguous"
    | "incomplete"
    | "restricted"
    | "changed"
    | "stale"
    | "undone"
    | "cleared";
  token?: string;
  count?: number;
  editId?: string;
}

export function runDisplayTextCommand(
  command: DisplayTextCommand,
): DisplayTextResult {
  type RecordEntry = { element: Element; original: string };
  type UndoEntry = { element: Element; original: string; replacement: string };
  type State = {
    taskId: string;
    handles: Map<string, RecordEntry>;
    elements: WeakMap<Element, string>;
    undo: Map<string, UndoEntry[]>;
  };
  const owner = globalThis as typeof globalThis & {
    __aiBrowserBridgeDisplayV1?: State;
  };
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const origin = self.origin;
  if (
    !command.origin ||
    origin === "null" ||
    origin !== command.origin ||
    Array.from(location.ancestorOrigins).some(
      (ancestor) => ancestor !== command.origin,
    )
  )
    return { status: "restricted" };
  const state: State = (owner.__aiBrowserBridgeDisplayV1 ??= {
    taskId: command.taskId,
    handles: new Map(),
    elements: new WeakMap(),
    undo: new Map(),
  });
  let searchDeadline = Infinity;
  let searchIncomplete = false;
  const eligible = (element: Element): boolean => {
    if (
      !element.isConnected ||
      element.children.length ||
      ![
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "P",
        "SPAN",
        "DIV",
        "TD",
        "TH",
        "LI",
        "STRONG",
        "EM",
        "SMALL",
        "DT",
        "DD",
      ].includes(element.tagName)
    )
      return false;
    const text = element.textContent ?? "";
    if (!text.trim() || text.length > 500 || !element.getClientRects().length)
      return false;
    let ancestor: Element | null = element;
    let withinHeading = /^H[1-6]$/.test(element.tagName);
    while (ancestor) {
      if (performance.now() > searchDeadline) {
        searchIncomplete = true;
        return false;
      }
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.cursor === "pointer" ||
        ancestor.matches(
          "a, button, input, select, textarea, label, [contenteditable]:not([contenteditable='false']), [onclick], [tabindex]:not([tabindex^='-']), [inert], [disabled], [aria-disabled='true'], [role='button'], [role='link'], [role='textbox'], [role='checkbox'], [role='radio'], [role='combobox'], [role='menuitem'], [role='tab']",
        )
      )
        return false;
      if (/^H[1-6]$/.test(ancestor.tagName)) withinHeading = true;
      if (ancestor.tagName === "FORM" && !withinHeading) return false;
      const root = ancestor.getRootNode();
      ancestor =
        ancestor.parentElement ??
        (root instanceof ShadowRoot ? root.host : null);
    }
    return true;
  };
  if (command.type === "undo") {
    const changes = state.undo.get(command.editId ?? "");
    if (!changes) return { status: "stale" };
    if (
      changes.some(
        (change) =>
          !change.element.isConnected ||
          change.element.textContent !== change.replacement,
      )
    ) {
      state.undo.delete(command.editId!);
      return { status: "stale" };
    }
    changes.forEach((change) => {
      change.element.textContent = change.original;
    });
    state.undo.delete(command.editId!);
    return { status: "undone" };
  }
  if (command.type === "clear") {
    if (state.taskId === command.taskId) {
      state.handles.clear();
      state.elements = new WeakMap();
    }
    return { status: "cleared" };
  }
  if (command.type === "find") {
    if (
      !command.text ||
      command.text.length > 160 ||
      /[\r\n]/.test(command.text)
    )
      return { status: "restricted" };
    if (state.taskId !== command.taskId) {
      state.taskId = command.taskId;
      state.handles.clear();
      state.elements = new WeakMap();
    }
    const roots: (Document | ShadowRoot)[] = [document];
    const matches: Element[] = [];
    let visited = 0;
    let candidates = 0;
    const query = normalize(command.text);
    const deadline = performance.now() + 200;
    searchDeadline = deadline;
    for (let index = 0; index < roots.length; index++) {
      if (performance.now() > deadline) return { status: "incomplete" };
      const walker = document.createTreeWalker(
        roots[index],
        NodeFilter.SHOW_ELEMENT,
      );
      for (
        let element = walker.nextNode() as Element | null;
        element;
        element = walker.nextNode() as Element | null
      ) {
        if (++visited > 50000 || performance.now() > deadline)
          return { status: "incomplete" };
        if (element.shadowRoot) {
          if (roots.length >= 100) return { status: "incomplete" };
          roots.push(element.shadowRoot);
        }
        if (
          element.children.length ||
          ![
            "H1",
            "H2",
            "H3",
            "H4",
            "H5",
            "H6",
            "P",
            "SPAN",
            "DIV",
            "TD",
            "TH",
            "LI",
            "STRONG",
            "EM",
            "SMALL",
            "DT",
            "DD",
          ].includes(element.tagName)
        )
          continue;
        if (++candidates > 10000) return { status: "incomplete" };
        if (normalize(element.textContent ?? "") === query) {
          const allowed = eligible(element);
          if (searchIncomplete || performance.now() > deadline)
            return { status: "incomplete" };
          if (allowed) matches.push(element);
        }
      }
    }
    if (!matches.length) return { status: "not-found" };
    if (matches.length > 1)
      return { status: "ambiguous", count: Math.min(matches.length, 100) };
    const element = matches[0];
    let token = state.elements.get(element);
    if (token && state.handles.get(token)?.original !== element.textContent) {
      state.handles.delete(token);
      token = undefined;
    }
    if (!token) {
      if (state.handles.size >= 200) return { status: "incomplete" };
      token = crypto.randomUUID().replace(/-/g, "");
      state.elements.set(element, token);
      state.handles.set(token, { element, original: element.textContent! });
    }
    return { status: "found", token, count: 1 };
  }
  const edits = command.edits;
  if (state.taskId !== command.taskId || !edits?.length || edits.length > 10)
    return { status: "stale" };
  const targets = edits.map((edit) => ({
    record: state.handles.get(edit.token),
    text: edit.text,
  }));
  if (
    new Set(targets.map((target) => target.record?.element)).size !==
      targets.length ||
    targets.some(
      ({ record, text }) =>
        !record ||
        !eligible(record.element) ||
        record.element.textContent !== record.original ||
        !text ||
        text.length > 500 ||
        /[\r\n]/.test(text) ||
        text === record.original,
    )
  )
    return { status: "stale" };
  const editId = crypto.randomUUID();
  if (state.undo.size >= 20) state.undo.delete(state.undo.keys().next().value!);
  const changes = targets.map(({ record, text }) => ({
    element: record!.element,
    original: record!.original,
    replacement: text,
  }));
  state.undo.set(editId, changes);
  changes.forEach((change) => {
    change.element.textContent = change.replacement;
  });
  return changes.every(
    (change) => change.element.textContent === change.replacement,
  )
    ? { status: "changed", editId }
    : { status: "stale", editId };
}
