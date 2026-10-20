import { describe, expect, it, vi } from "vitest";
import {
  combinePageFrames,
  pageLoadWaitMs,
  readPageWithRecovery,
  waitForTabComplete,
} from "./page-context";

const frame = {
  frameId: 3,
  documentId: "doc",
  result: {
    text: "Article text",
    elements: '[e1] input "Name"',
    textLength: 12,
    elementCount: 1,
    url: "https://example.com/",
    title: "Example",
  },
};
describe("page context", () => {
  it("scopes refs to their frame and preserves document identity", () => {
    const result = combinePageFrames([frame]);
    expect(result.status).toBe("ok");
    expect(result.content).toContain("[f3:e1]");
    expect(result.frames).toEqual([
      { frameId: 3, documentId: "doc", origin: "https://example.com" },
    ]);
  });
  it.each(["about:srcdoc", "data:text/html,test", "invalid"])(
    "does not infer an authorized origin for %s",
    (url) => {
      expect(
        combinePageFrames([{ ...frame, result: { ...frame.result, url } }])
          .frames[0].origin,
      ).toBeUndefined();
    },
  );
  it("does not mistake wrapper text for page content", () => {
    expect(
      combinePageFrames([
        {
          ...frame,
          result: {
            ...frame.result,
            text: "no text found",
            textLength: 0,
            elementCount: 0,
          },
        },
      ]).status,
    ).toBe("empty");
  });
  it("retries an empty snapshot once after readiness", async () => {
    const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([frame]);
    const wait = vi.fn().mockResolvedValue(undefined);
    expect((await readPageWithRecovery(read, wait)).status).toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });
  it("does not label a late-loading page empty after a second empty snapshot", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([frame]);
    const wait = vi.fn().mockResolvedValue(undefined);
    expect((await readPageWithRecovery(read, wait)).status).toBe("ok");
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it("stops after two waits when the page remains empty", async () => {
    const read = vi.fn().mockResolvedValue([]);
    const wait = vi.fn().mockResolvedValue(undefined);
    expect((await readPageWithRecovery(read, wait)).status).toBe("empty");
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it("retries a transient read failure after readiness", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("Frame with ID 0 was removed."))
      .mockResolvedValue([frame]);
    const wait = vi.fn().mockResolvedValue(undefined);
    expect((await readPageWithRecovery(read, wait)).status).toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });
  it("reports failure after repeated transient errors", async () => {
    const read = vi.fn().mockRejectedValue(new Error("Frame was removed"));
    const wait = vi.fn().mockRejectedValue(new Error("tab gone"));
    expect((await readPageWithRecovery(read, wait)).status).toBe("failed");
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("waits until the tab finishes loading", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce("loading")
      .mockResolvedValueOnce("loading")
      .mockResolvedValue("complete");
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await waitForTabComplete(getStatus, { sleep })).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("gives up when the tab never completes or disappears", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(
      await waitForTabComplete(async () => "loading", {
        timeoutMs: 1000,
        intervalMs: 250,
        sleep,
      }),
    ).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(await waitForTabComplete(async () => undefined, { sleep })).toBe(
      false,
    );
  });
  it("keeps background reads short so a never-complete page cannot stall a send", () => {
    const background = pageLoadWaitMs(true);
    const foreground = pageLoadWaitMs(false);
    expect(background.initialMs).toBeLessThan(foreground.initialMs);
    expect(background.retryMs).toBeLessThanOrEqual(foreground.retryMs);
    expect(foreground.initialMs).toBe(10000);
  });
  it("does not retry denied permission", async () => {
    const read = vi
      .fn()
      .mockRejectedValue(new Error("Cannot access contents of this page"));
    const wait = vi.fn();
    expect((await readPageWithRecovery(read, wait)).status).toBe(
      "permission-required",
    );
    expect(read).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});
