import { claimWebhookJob, finishWebhookJob, listDueWebhookJobs } from "../db/queries";
import { classifyGitWebhook, parseGitWebhookEvent } from "./git-webhook";
import { processGitMergeEvent } from "./git-merge";
import type { WebhookJob } from "../types";

export interface WebhookJobRunnerResult {
  processed: number;
  succeeded: number;
  retrying: number;
  dead: number;
  deadJobs: Array<{ id: number; action: string; lastError: string | null }>;
}

function parsePayload(job: WebhookJob): unknown {
  try {
    return JSON.parse(job.payload_json);
  } catch {
    return {};
  }
}

function finishMergeJob(job: WebhookJob, retryDelayMs: number): "success" | "retrying" | "dead" {
  if (!claimWebhookJob(job.id)) {
    return "retrying";
  }

  const payload = parsePayload(job);
  const event = parseGitWebhookEvent(payload, {
    "x-github-event": job.event_type,
    "x-gitea-event": job.event_type,
    "x-gitlab-event": job.event_type,
  });
  const classification = classifyGitWebhook(event);
  if (classification.action !== "code_merge") {
    finishWebhookJob(job.id, {
      status: "failed",
      error: "unsupported_webhook_job_payload",
      retryDelayMs,
    });
    const updated = listDueWebhookJobs({ source: job.source, action: job.action, limit: 1 }).find(
      (item) => item.id === job.id,
    );
    return updated ? "retrying" : "dead";
  }

  const result = processGitMergeEvent(event);
  if (result.status === "recorded") {
    finishWebhookJob(job.id, {
      status: "success",
      result: {
        execution_id: result.executionId,
        target: result.target,
        plane_issue_id: result.planeIssueId,
      },
    });
    return "success";
  }

  finishWebhookJob(job.id, {
    status: "failed",
    error: result.reason,
    result: {
      target: result.target,
      plane_issue_id: result.planeIssueId,
    },
    retryDelayMs,
  });
  const refreshed = listDueWebhookJobs({ source: job.source, action: job.action, limit: 1 }).find(
    (item) => item.id === job.id,
  );
  return refreshed ? "retrying" : "dead";
}

export function processDueWebhookJobs(
  options: {
    limit?: number;
    retryDelayMs?: number;
  } = {},
): WebhookJobRunnerResult {
  const jobs = listDueWebhookJobs({
    source: "git",
    action: "code_merge",
    limit: options.limit ?? 20,
  });
  const result: WebhookJobRunnerResult = {
    processed: 0,
    succeeded: 0,
    retrying: 0,
    dead: 0,
    deadJobs: [],
  };

  for (const job of jobs) {
    result.processed++;
    const status = finishMergeJob(job, options.retryDelayMs ?? 60_000);
    if (status === "success") result.succeeded++;
    if (status === "retrying") result.retrying++;
    if (status === "dead") {
      result.dead++;
      result.deadJobs.push({
        id: job.id,
        action: job.action,
        lastError: job.last_error,
      });
    }
  }

  return result;
}
