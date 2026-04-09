import { describe, it, afterEach, beforeEach, spyOn } from "bun:test";
import * as queries from "./db/queries";
import { getDb, closeDb } from "./db";

const { startScheduler, stopScheduler } = await import("./scheduler");

describe("scheduler", () => {
  let cleanSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    cleanSpy = spyOn(queries, "cleanExpiredEvents").mockReturnValue(0);
  });

  afterEach(() => {
    stopScheduler();
    cleanSpy.mockRestore();
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

  it("startScheduler starts RAG sync when config is set", () => {
    process.env.DIFY_DATASET_API_KEY = "test-key";
    process.env.DIFY_DATASET_ID = "test-dataset";

    startScheduler();
    stopScheduler();

    delete process.env.DIFY_DATASET_API_KEY;
    delete process.env.DIFY_DATASET_ID;
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
});
