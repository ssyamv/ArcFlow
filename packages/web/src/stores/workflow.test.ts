import { describe, expect, it } from "vitest";
import type { WorkflowExecution } from "./workflow";

describe("WorkflowExecution", () => {
  it("accepts optional subtasks and links fields", () => {
    const execution: WorkflowExecution = {
      id: 7,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-120",
      status: "failed",
      error_message: null,
      started_at: "2026-04-16 12:00:00",
      completed_at: "2026-04-16 12:10:00",
      created_at: "2026-04-16 12:00:00",
      subtasks: [
        { id: 1, target: "backend", stage: "ci_failed", provider: "ibuild", status: "failed" },
      ],
      links: [
        {
          id: 1,
          source_execution_id: 7,
          target_execution_id: 8,
          link_type: "spawned_on_ci_failure",
        },
      ],
    };

    expect(execution.subtasks?.[0]?.target).toBe("backend");
    expect(execution.links?.[0]?.link_type).toBe("spawned_on_ci_failure");
  });
});
