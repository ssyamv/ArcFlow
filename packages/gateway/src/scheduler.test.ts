import { describe, it, afterEach, beforeEach, spyOn } from "bun:test";
import * as queries from "./db/queries";
import { getDb, closeDb } from "./db";

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

const { startScheduler, stopScheduler } = await import("./scheduler");

describe("scheduler", () => {
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
});
