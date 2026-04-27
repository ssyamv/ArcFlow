import {
  findLatestCodegenExecution,
  syncCodegenExecutionStatus,
  updateWorkflowSubtaskStatusByStage,
} from "../db/queries";
import { extractIssueIdFromBranch } from "./ibuild";
import type { GitWebhookEvent } from "./git-webhook";

export type GitMergeProcessingResult =
  | {
      status: "recorded";
      executionId: number;
      target: string;
      planeIssueId?: string;
    }
  | {
      status: "unmatched";
      target: string | null;
      reason: "missing_merge_branch_or_target" | "code_gen_execution_not_found";
      planeIssueId?: string;
    };

function repositoryTarget(repository: string | null): string | null {
  if (!repository) return null;
  const parts = repository.split("/").filter(Boolean);
  return parts.at(-1) ?? repository;
}

export function processGitMergeEvent(
  event: GitWebhookEvent,
  options: { correlationId?: string } = {},
): GitMergeProcessingResult {
  const target = repositoryTarget(event.repository);
  const sourceBranch = event.merge?.sourceBranch ?? null;
  const planeIssueId = sourceBranch
    ? (extractIssueIdFromBranch(sourceBranch) ?? undefined)
    : undefined;

  if (!target || !sourceBranch) {
    return {
      status: "unmatched",
      target,
      reason: "missing_merge_branch_or_target",
      planeIssueId,
    };
  }

  const execution = findLatestCodegenExecution(planeIssueId, target, {
    branchName: sourceBranch,
  });
  if (!execution) {
    return {
      status: "unmatched",
      target,
      reason: "code_gen_execution_not_found",
      planeIssueId,
    };
  }

  updateWorkflowSubtaskStatusByStage({
    execution_id: execution.id,
    stage: "mr_merged",
    target,
    provider: "git",
    status: "success",
    external_run_id: event.merge?.id ?? undefined,
    branch_name: sourceBranch,
    repo_name: target,
    log_url: event.merge?.url ?? undefined,
    correlation_id: options.correlationId,
    output_ref: JSON.stringify({
      merge_commit_sha: event.merge?.mergeCommitSha ?? undefined,
      title: event.merge?.title ?? undefined,
      target_branch: event.merge?.targetBranch ?? undefined,
      url: event.merge?.url ?? undefined,
    }),
  });
  syncCodegenExecutionStatus(execution.id);

  return {
    status: "recorded",
    executionId: execution.id,
    target,
    planeIssueId,
  };
}
