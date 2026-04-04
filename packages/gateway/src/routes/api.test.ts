import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { closeDb, getDb } from "../db";
import * as workflowService from "../services/workflow";

describe("api routes", () => {
  let app: Hono;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    app = new Hono();
    app.route("/api", apiRoutes);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  it("POST /api/workflow/trigger calls triggerWorkflow", async () => {
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(42);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
        params: { input_path: "/prd/test.md" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(42);
    expect(body.status).toBe("running");
    expect(body.message).toBe("工作流已触发");

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "prd_to_tech",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-1",
      input_path: "/prd/test.md",
      target_repos: undefined,
    });
  });

  it("POST /api/workflow/trigger passes target_repos param", async () => {
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(99);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-5",
        params: { target_repos: ["backend", "web"] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(99);

    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-5",
      input_path: undefined,
      target_repos: ["backend", "web"],
    });
  });

  it("GET /api/workflow/executions returns list", async () => {
    // Seed data by calling triggerWorkflow directly (bypassing mock)
    const { createWorkflowExecution } = await import("../db/queries");
    createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-2",
    });

    const res = await app.request("/api/workflow/executions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/workflow/executions filters by type", async () => {
    const { createWorkflowExecution } = await import("../db/queries");
    createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-3",
    });

    const res = await app.request("/api/workflow/executions?workflow_type=bug_analysis");
    const body = await res.json();
    expect(
      body.data.every((e: { workflow_type: string }) => e.workflow_type === "bug_analysis"),
    ).toBe(true);
  });
});
