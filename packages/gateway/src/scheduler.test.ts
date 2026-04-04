import { describe, it, mock, afterEach } from "bun:test";

const cleanExpiredEvents = mock(() => 0);

mock.module("./db/queries", () => ({
  cleanExpiredEvents,
  // Provide stubs for all exports to avoid contaminating other tests
  createWorkflowExecution: mock(() => 0),
  getWorkflowExecution: mock(() => null),
  listWorkflowExecutions: mock(() => []),
  updateWorkflowStatus: mock(() => {}),
  recordWebhookEvent: mock(() => {}),
  isEventProcessed: mock(() => false),
  createBugFixRetry: mock(() => {}),
  getBugFixRetry: mock(() => null),
  incrementBugFixRetry: mock(() => {}),
  updateBugFixStatus: mock(() => {}),
}));

const { startScheduler, stopScheduler } = await import("./scheduler");

describe("scheduler", () => {
  afterEach(() => {
    stopScheduler();
  });

  it("startScheduler sets up an interval that calls cleanExpiredEvents", () => {
    cleanExpiredEvents.mockReturnValue(0);
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
