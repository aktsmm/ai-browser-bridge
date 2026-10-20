import { describe, expect, it, vi } from "vitest";
import { createCoalescingRunner } from "./auto-read";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createCoalescingRunner", () => {
  it("runs once for a single request", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const runner = createCoalescingRunner(task);
    runner.request();
    await runner.idle();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("reruns once after the running task when requested again, however many times", async () => {
    const gates = [deferred(), deferred()];
    const task = vi
      .fn()
      .mockImplementationOnce(() => gates[0].promise)
      .mockImplementationOnce(() => gates[1].promise);
    const runner = createCoalescingRunner(task);
    runner.request();
    runner.request();
    runner.request();
    expect(task).toHaveBeenCalledTimes(1);

    const idle = runner.idle();
    gates[0].resolve();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    gates[1].resolve();
    await idle;
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keeps running after a failed task and accepts later requests", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const runner = createCoalescingRunner(task);
    runner.request();
    await runner.idle();
    runner.request();
    await runner.idle();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("resolves idle immediately when nothing is running", async () => {
    const runner = createCoalescingRunner(vi.fn());
    await expect(runner.idle()).resolves.toBeUndefined();
  });
});
