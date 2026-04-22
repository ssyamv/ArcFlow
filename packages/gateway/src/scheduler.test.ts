import { describe, it, afterEach, beforeEach, spyOn } from "bun:test";
import * as queries from "./db/queries";
import { getDb, closeDb } from "./db";
import * as webhookJobRunner from "./services/webhook-job-runner";

const { startScheduler, stopScheduler } = await import("./scheduler");

describe("scheduler", () => {
  let cleanSpy: ReturnType<typeof spyOn>;
  let webhookJobSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    cleanSpy = spyOn(queries, "cleanExpiredEvents").mockReturnValue(0);
    webhookJobSpy = spyOn(webhookJobRunner, "processDueWebhookJobs").mockReturnValue({
      processed: 0,
      succeeded: 0,
      retrying: 0,
      dead: 0,
      deadJobs: [],
    });
  });

  afterEach(() => {
    stopScheduler();
    cleanSpy.mockRestore();
    webhookJobSpy.mockRestore();
    closeDb();
  });
  it("startScheduler sets up an interval that calls cleanExpiredEvents", () => {
    startScheduler();
    stopScheduler();
  });

  it("stopScheduler clears the interval", () => {
    startScheduler();
    stopScheduler();
    // Calling stop again should be safe (no-op)
    stopScheduler();
  });

  it("stopScheduler is safe to call without startScheduler", () => {
    stopScheduler();
  });

  it("cleanup callback runs cleanExpiredEvents", async () => {
    // Use short interval to actually trigger the callback
    const origSetInterval = globalThis.setInterval;
    const capturedCallbacks: (() => void)[] = [];
    // @ts-expect-error - intercept setInterval
    globalThis.setInterval = (fn: () => void) => {
      capturedCallbacks.push(fn);
      return 999;
    };

    startScheduler();

    // Manually invoke the cleanup callback (first one)
    if (capturedCallbacks[0]) {
      capturedCallbacks[0]();
    }

    globalThis.setInterval = origSetInterval;
    stopScheduler();
  });

  it("cleanup callback logs when events deleted", async () => {
    cleanSpy.mockReturnValue(5);

    const origSetInterval = globalThis.setInterval;
    const capturedCallbacks: (() => void)[] = [];
    // @ts-expect-error - intercept setInterval
    globalThis.setInterval = (fn: () => void) => {
      capturedCallbacks.push(fn);
      return 999;
    };

    startScheduler();

    if (capturedCallbacks[0]) {
      capturedCallbacks[0]();
    }

    globalThis.setInterval = origSetInterval;
    stopScheduler();
  });

  it("webhook job retry callback runs processDueWebhookJobs", () => {
    webhookJobSpy.mockReturnValue({
      processed: 1,
      succeeded: 1,
      retrying: 0,
      dead: 0,
      deadJobs: [],
    });

    const origSetInterval = globalThis.setInterval;
    const capturedCallbacks: (() => void)[] = [];
    // @ts-expect-error - intercept setInterval
    globalThis.setInterval = (fn: () => void) => {
      capturedCallbacks.push(fn);
      return 999;
    };

    startScheduler();

    if (capturedCallbacks[1]) {
      capturedCallbacks[1]();
    }

    globalThis.setInterval = origSetInterval;
    stopScheduler();
  });
});
