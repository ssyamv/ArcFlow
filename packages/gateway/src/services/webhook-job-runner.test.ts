import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "../db";
import {
  createWebhookJob,
  createWorkflowExecution,
  createWorkflowSubtask,
  getWebhookJob,
  getWorkflowExecution,
  insertDispatch,
  listWorkflowSubtasks,
} from "../db/queries";
import { processDueWebhookJobs } from "./webhook-job-runner";

function githubMergePayload(branch = "feature/ISS-120-backend") {
  return {
    action: "closed",
    repository: { full_name: "acme/backend" },
    number: 42,
    pull_request: {
      merged: true,
      title: "Implement issue 120",
      html_url: "https://github.example/acme/backend/pull/42",
      merge_commit_sha: "mergeabc",
      head: { ref: branch },
      base: { ref: "main" },
    },
  };
}

describe("webhook job runner", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("retries unmatched merge jobs and records them once code_gen appears", () => {
    const jobId = createWebhookJob({
      source: "git",
      event_type: "pull_request",
      action: "code_merge",
      payload: githubMergePayload(),
      max_attempts: 3,
    });

    expect(processDueWebhookJobs({ retryDelayMs: 0 })).toEqual({
      processed: 1,
      succeeded: 0,
      retrying: 1,
      dead: 0,
      deadJobs: [],
    });
    expect(getWebhookJob(jobId)).toEqual(
      expect.objectContaining({
        status: "pending",
        attempt_count: 1,
        last_error: "code_gen_execution_not_found",
      }),
    );

    const executionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-120",
    });
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      branch_name: "feature/ISS-120-backend",
      repo_name: "backend",
    });
    insertDispatch(getDb(), {
      workspaceId: "ws-test",
      skill: "arcflow-code-gen",
      input: { execution_id: executionId, target: "backend" },
      planeIssueId: "ISS-120",
      sourceExecutionId: executionId,
      sourceStage: "dispatch",
    });

    expect(processDueWebhookJobs({ retryDelayMs: 0 })).toEqual({
      processed: 1,
      succeeded: 1,
      retrying: 0,
      dead: 0,
      deadJobs: [],
    });
    expect(getWebhookJob(jobId)).toEqual(
      expect.objectContaining({
        status: "success",
        attempt_count: 2,
        last_error: null,
        result_json: JSON.stringify({
          execution_id: executionId,
          target: "backend",
          plane_issue_id: "ISS-120",
        }),
      }),
    );
    expect(listWorkflowSubtasks(executionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "mr_merged",
          target: "backend",
          status: "success",
        }),
      ]),
    );
    expect(getWorkflowExecution(executionId)?.status).toBe("success");
  });

  it("marks repeatedly unmatched merge jobs dead", () => {
    const jobId = createWebhookJob({
      source: "git",
      event_type: "pull_request",
      action: "code_merge",
      payload: githubMergePayload("feature/ISS-404-backend"),
      max_attempts: 2,
    });

    expect(processDueWebhookJobs({ retryDelayMs: 0 })).toEqual({
      processed: 1,
      succeeded: 0,
      retrying: 1,
      dead: 0,
      deadJobs: [],
    });
    expect(processDueWebhookJobs({ retryDelayMs: 0 })).toEqual({
      processed: 1,
      succeeded: 0,
      retrying: 0,
      dead: 1,
      deadJobs: [{ id: jobId, action: "code_merge", lastError: "code_gen_execution_not_found" }],
    });
    expect(getWebhookJob(jobId)).toEqual(
      expect.objectContaining({
        status: "dead",
        attempt_count: 2,
        last_error: "code_gen_execution_not_found",
      }),
    );
  });
});
