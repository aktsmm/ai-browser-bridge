import {
  DISPLAY_EDIT_ORIGINS_KEY,
  displayEditOrigin,
  normalizeDisplayEditOrigins,
} from "./display-edit-permission";
import {
  runDisplayTextCommand,
  type DisplayTextResult,
} from "./display-text-runtime";

interface Task {
  id: string;
  tabId: number;
  url: string;
  origin: string;
  once: boolean;
  expires: number;
  documents: Set<string>;
}

export interface DisplayOwnerMessage {
  type: "display-edit";
  operation:
    | "permission"
    | "start"
    | "end"
    | "find"
    | "edit"
    | "undo"
    | "recover";
  origin?: string;
  enabled?: boolean;
  once?: boolean;
  taskId?: string;
  tabId?: number;
  url?: string;
  frames?: { frameId: number; documentId?: string; origin?: string }[];
  text?: string;
  edits?: { selector: string; text: string }[];
  documentId?: string;
  editId?: string;
}

export function createDisplayEditOwner() {
  const tasks = new Map<string, Task>();
  const denied = new Set<string>();
  const revisions = new Map<string, number>();
  const recentEdits = new Map<
    number,
    { url: string; documentId: string; editId: string }[]
  >();
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const permission = async (task: Task) => {
    if (
      denied.has(task.origin) ||
      tasks.get(task.id) !== task ||
      task.expires < Date.now()
    )
      return false;
    if (
      displayEditOrigin((await chrome.tabs.get(task.tabId)).url) !== task.origin
    )
      return false;
    const stored = await chrome.storage.local.get(DISPLAY_EDIT_ORIGINS_KEY);
    const permitted =
      !denied.has(task.origin) &&
      tasks.get(task.id) === task &&
      (task.once ||
        normalizeDisplayEditOrigins(stored[DISPLAY_EDIT_ORIGINS_KEY]).includes(
          task.origin,
        ));
    if (permitted) task.expires = Date.now() + 300000;
    return permitted;
  };
  return {
    async handle(
      message: DisplayOwnerMessage,
    ): Promise<Record<string, unknown>> {
      const startOrigin = displayEditOrigin(message.url);
      const startRevision = revisions.get(startOrigin) ?? 0;
      const endingTask =
        message.operation === "end"
          ? tasks.get(message.taskId ?? "")
          : undefined;
      if (
        message.operation === "permission" &&
        !message.enabled &&
        message.origin
      ) {
        denied.add(message.origin);
        revisions.set(message.origin, (revisions.get(message.origin) ?? 0) + 1);
        for (const [id, task] of tasks)
          if (task.origin === message.origin) tasks.delete(id);
      }
      if (message.operation === "end" && message.taskId)
        tasks.delete(message.taskId);
      return serialize(async () => {
        if (message.operation === "permission") {
          const origin = message.origin;
          if (
            !origin ||
            displayEditOrigin(origin) !== origin ||
            typeof message.enabled !== "boolean"
          )
            return { ok: false };
          const stored = await chrome.storage.local.get(
            DISPLAY_EDIT_ORIGINS_KEY,
          );
          const next = normalizeDisplayEditOrigins([
            ...normalizeDisplayEditOrigins(
              stored[DISPLAY_EDIT_ORIGINS_KEY],
            ).filter((entry) => entry !== origin),
            ...(message.enabled ? [origin] : []),
          ]);
          if (message.enabled && !next.includes(origin)) return { ok: false };
          await chrome.storage.local.set({ [DISPLAY_EDIT_ORIGINS_KEY]: next });
          if (message.enabled) denied.delete(origin);
          return { ok: true, origins: next };
        }
        if (message.operation === "start") {
          for (const [id, task] of tasks)
            if (task.expires < Date.now()) tasks.delete(id);
          const origin = displayEditOrigin(message.url);
          if ((revisions.get(origin) ?? 0) !== startRevision)
            return { ok: false };
          if (
            !origin ||
            !Number.isInteger(message.tabId) ||
            !message.url ||
            tasks.size >= 30 ||
            (await chrome.tabs.get(message.tabId!)).url !== message.url
          )
            return { ok: false };
          const stored = await chrome.storage.local.get(
            DISPLAY_EDIT_ORIGINS_KEY,
          );
          if (
            !message.once &&
            !normalizeDisplayEditOrigins(
              stored[DISPLAY_EDIT_ORIGINS_KEY],
            ).includes(origin)
          )
            return { ok: false };
          if ((revisions.get(origin) ?? 0) !== startRevision)
            return { ok: false };
          denied.delete(origin);
          const id = crypto.randomUUID();
          tasks.set(id, {
            id,
            tabId: message.tabId!,
            url: message.url,
            origin,
            once: message.once === true,
            expires: Date.now() + 300000,
            documents: new Set(),
          });
          return { ok: true, taskId: id };
        }
        if (message.operation === "end") {
          if (endingTask) {
            for (const documentId of endingTask.documents) {
              await chrome.scripting
                .executeScript({
                  target: {
                    tabId: endingTask.tabId,
                    documentIds: [documentId],
                  },
                  world: "ISOLATED",
                  func: runDisplayTextCommand,
                  args: [
                    {
                      type: "clear",
                      origin: endingTask.origin,
                      taskId: endingTask.id,
                    },
                  ],
                })
                .catch(() => undefined);
            }
          }
          return { ok: true };
        }
        if (message.operation === "recover") {
          if (!Number.isInteger(message.tabId)) return { ok: false };
          const origin = displayEditOrigin(
            (await chrome.tabs.get(message.tabId!)).url,
          );
          return {
            ok: true,
            edits: (recentEdits.get(message.tabId!) ?? []).filter(
              (edit) => displayEditOrigin(edit.url) === origin,
            ),
          };
        }
        if (message.operation === "undo") {
          const origin = displayEditOrigin(message.url);
          if (
            !origin ||
            !Number.isInteger(message.tabId) ||
            !message.documentId ||
            !message.editId ||
            displayEditOrigin((await chrome.tabs.get(message.tabId!)).url) !==
              origin
          )
            return { ok: false };
          recentEdits.set(
            message.tabId!,
            (recentEdits.get(message.tabId!) ?? []).filter(
              (edit) => edit.editId !== message.editId,
            ),
          );
          const result = await chrome.scripting.executeScript({
            target: {
              tabId: message.tabId!,
              documentIds: [message.documentId],
            },
            world: "ISOLATED",
            func: runDisplayTextCommand,
            args: [
              { type: "undo", origin, taskId: "", editId: message.editId },
            ],
          });
          return { ok: result[0]?.result?.status === "undone" };
        }
        const task = tasks.get(message.taskId ?? "");
        if (!task || !(await permission(task)))
          return {
            ok: false,
            result:
              "Error: display editing permission expired or was revoked; nothing changed",
          };
        const frames = message.frames;
        if (
          !Array.isArray(frames) ||
          !frames.length ||
          frames.length > 50 ||
          frames.some(
            (frame) => !Number.isInteger(frame.frameId) || !frame.documentId,
          )
        )
          return {
            ok: false,
            result: "Error: acquire a fresh verified page snapshot",
          };
        if (message.operation === "find") {
          if (
            typeof message.text !== "string" ||
            !message.text.trim() ||
            message.text.length > 160 ||
            /[\r\n]/.test(message.text)
          )
            return { ok: false };
          const matches: {
            frameId: number;
            documentId: string;
            token: string;
          }[] = [];
          for (const frame of frames.filter(
            (entry) => entry.origin === task.origin,
          )) {
            if (!(await permission(task)))
              return {
                ok: false,
                result: "Error: display editing permission was revoked",
              };
            const results = await chrome.scripting.executeScript({
              target: { tabId: task.tabId, documentIds: [frame.documentId!] },
              world: "ISOLATED",
              func: runDisplayTextCommand,
              args: [
                {
                  type: "find",
                  origin: task.origin,
                  taskId: task.id,
                  text: message.text,
                },
              ],
            });
            const result = results[0]?.result as DisplayTextResult | undefined;
            task.documents.add(frame.documentId!);
            if (!result || result.status === "incomplete")
              return {
                ok: false,
                result:
                  "Error: display text search was incomplete; nothing changed",
              };
            if (result.status === "ambiguous")
              return {
                ok: false,
                result:
                  "Error: more than one matching display text exists; specify a unique text or change it manually",
              };
            if (result.status === "found" && result.token)
              matches.push({
                frameId: frame.frameId,
                documentId: frame.documentId!,
                token: result.token,
              });
          }
          if (matches.length !== 1)
            return {
              ok: false,
              result: matches.length
                ? "Error: matching text exists in more than one frame; nothing changed"
                : "Error: eligible display text not found; nothing changed",
            };
          const match = matches[0];
          return {
            ok: true,
            result: `Display text found: ref:f${match.frameId}:d${match.token}. Use this exact ref in replaceText; nothing changed yet.`,
          };
        }
        if (
          message.operation !== "edit" ||
          !Array.isArray(message.edits) ||
          !message.edits.length ||
          message.edits.length > 10
        )
          return { ok: false };
        const parsed = message.edits.map((edit) => ({
          match: edit.selector?.match(/^ref:f(\d+):d([a-f0-9]{32})$/),
          text: edit.text,
        }));
        if (
          parsed.some(
            (edit) =>
              !edit.match ||
              typeof edit.text !== "string" ||
              !edit.text ||
              edit.text.length > 500 ||
              /[\r\n]/.test(edit.text),
          )
        )
          return { ok: false };
        const frameId = Number(parsed[0].match![1]);
        if (parsed.some((edit) => Number(edit.match![1]) !== frameId))
          return { ok: false };
        const frame = frames.find(
          (entry) => entry.frameId === frameId && entry.origin === task.origin,
        );
        if (!frame || !(await permission(task))) return { ok: false };
        const results = await chrome.scripting.executeScript({
          target: { tabId: task.tabId, documentIds: [frame.documentId!] },
          world: "ISOLATED",
          func: runDisplayTextCommand,
          args: [
            {
              type: "edit",
              origin: task.origin,
              taskId: task.id,
              edits: parsed.map((edit) => ({
                token: edit.match![2],
                text: edit.text,
              })),
            },
          ],
        });
        const result = results[0]?.result as DisplayTextResult | undefined;
        if (result?.editId) {
          const history = recentEdits.get(task.tabId) ?? [];
          history.push({
            url: task.url,
            documentId: frame.documentId!,
            editId: result.editId,
          });
          recentEdits.set(task.tabId, history.slice(-20));
        }
        return result?.status === "changed"
          ? {
              ok: true,
              result: "Display text changed; not submitted",
              documentId: frame.documentId,
              editId: result.editId,
            }
          : {
              ok: false,
              result:
                "Error: display target changed or is restricted; verify the page before retrying",
              documentId: frame.documentId,
              editId: result?.editId,
            };
      });
    },
    revokeOrigins(origins: string[]) {
      for (const [id, task] of tasks)
        if (!origins.includes(task.origin) && !task.once) {
          denied.add(task.origin);
          tasks.delete(id);
        }
    },
  };
}
