import { describe, it, expect } from "bun:test";
import { createScheduler } from "./scheduler";

describe("scheduler", () => {
  it("runs job at intervalMs then stops", async () => {
    let n = 0;
    const sched = createScheduler();
    sched.every(50, async () => {
      n++;
    });
    await Bun.sleep(175);
    sched.stop();
    expect(n).toBeGreaterThanOrEqual(2);
    const at = n;
    await Bun.sleep(100);
    expect(n).toBe(at);
  });

  it("swallows job errors without stopping", async () => {
    let n = 0;
    const sched = createScheduler();
    sched.every(30, async () => {
      n++;
      if (n === 1) throw new Error("boom");
    });
    await Bun.sleep(100);
    sched.stop();
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
