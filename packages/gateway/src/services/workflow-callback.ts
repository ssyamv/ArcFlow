import { posix as pathPosix } from "node:path";
import { updateWorkflowSubtaskStatusByStage } from "../db/queries";
import type { WorkflowDispatchStatus, WorkflowStatus } from "../types";

export interface DispatchRecord {
  id: string;
  workspaceId: string;
  skill: string;
  planeIssueId?: string;
  status: WorkflowDispatchStatus;
  input?: unknown;
  startedAt?: number | null;
  lastCallbackAt?: number | null;
  timeoutAt?: number | null;
  errorMessage?: string | null;
  resultSummary?: string | null;
  callbackReplayCount?: number;
  sourceExecutionId?: number | null;
  sourceStage?: string | null;
  correlationId?: string | null;
}

export interface CallbackDeps {
  writeTechDesign: (x: {
    workspaceId: string;
    planeIssueId?: string;
    relativePath: string;
    content: string;
  }) => Promise<void>;
  writeOpenApi: (x: {
    workspaceId: string;
    planeIssueId?: string;
    relativePath: string;
    content: string;
  }) => Promise<void>;
  commentPlaneIssue: (x: {
    workspaceId: string;
    planeIssueId: string;
    content: string;
  }) => Promise<void>;
  loadDispatch: (id: string) => Promise<DispatchRecord | null>;
  claimDispatch?: (id: string) => Promise<boolean>;
  releaseClaim?: (id: string) => Promise<boolean>;
  markDone: (id: string, update: DispatchFinalizeUpdate) => Promise<boolean>;
  updateExecutionStatus?: (
    executionId: number,
    status: WorkflowStatus,
    errorMessage?: string,
  ) => Promise<void> | void;
  triggerWorkflow?: (params: {
    workspace_id: number;
    workflow_type: "code_gen";
    trigger_source: "manual";
    plane_issue_id?: string;
    source_execution_id?: number;
    source_stage?: string;
    correlation_id?: string;
    target_repos?: string[];
    input_path?: string;
  }) => Promise<number>;
  markSubtaskProgress?: (x: {
    execution_id: number;
    target: string;
    stage: string;
    status: "pending" | "running" | "success" | "failed";
    provider?: string;
    input_ref?: string;
    output_ref?: string;
    branch_name?: string;
    repo_name?: string;
    log_url?: string;
    error_message?: string;
    correlation_id?: string | null;
  }) => Promise<void> | void;
}

export interface CallbackPayload {
  dispatch_id: string;
  skill?: string;
  status: "success" | "failed";
  result?: {
    content?: string;
    planeIssueId?: string;
    tech_doc_path?: string;
    openapi_path?: string;
    summary?: unknown;
    root_cause?: unknown;
    suggested_fix?: unknown;
    confidence?: unknown;
    next_action?: unknown;
    [key: string]: unknown;
  };
  error?: string;
}

export interface DispatchFinalizeUpdate {
  status: Exclude<WorkflowDispatchStatus, "pending" | "running">;
  errorMessage?: string | null;
  resultSummary?: string | null;
  lastCallbackAt?: number | null;
  replayIncrement?: boolean;
}

function summarizeCallbackPayload(payload: CallbackPayload, ...flags: string[]) {
  const parts = [`callback:${payload.status}`];
  if (payload.error) parts.push(`error=${payload.error}`);
  if (payload.result?.planeIssueId) parts.push(`planeIssueId=${payload.result.planeIssueId}`);
  if (payload.result?.content) parts.push(`contentLength=${payload.result.content.length}`);
  for (const flag of flags) parts.push(flag);
  return parts.join("; ");
}

function isLateCallback(rec: DispatchRecord, now: number) {
  return rec.timeoutAt != null && now > rec.timeoutAt;
}

function parseExecutionContext(input: unknown) {
  if (!input || typeof input !== "object") return {};
  const payload = input as Record<string, unknown>;
  return {
    execution_id: Number.isFinite(Number(payload.execution_id))
      ? Number(payload.execution_id)
      : undefined,
    target_repos: Array.isArray(payload.target_repos)
      ? payload.target_repos.filter((value): value is string => typeof value === "string")
      : Array.isArray(payload.targets)
        ? payload.targets.filter((value): value is string => typeof value === "string")
        : undefined,
    input_path: typeof payload.input_path === "string" ? payload.input_path : undefined,
    correlation_id: typeof payload.correlation_id === "string" ? payload.correlation_id : undefined,
  };
}

function normalizeCallbackPath(rawPath: string, invalidMessage: string) {
  const trimmed = rawPath.trim();
  const posixPath = trimmed.replace(/\\/g, "/");

  if (!trimmed) throw new Error(invalidMessage);
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || pathPosix.isAbsolute(posixPath)) {
    throw new Error(invalidMessage);
  }

  const normalized = pathPosix.normalize(posixPath);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(invalidMessage);
  }

  return normalized;
}

function parseCodegenResult(content: string) {
  return JSON.parse(content) as {
    execution_id: number;
    target: string;
    branch_name?: string;
    repo_name?: string;
    log_url?: string;
  };
}

function parseCodegenDispatchInput(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("code_gen dispatch input is missing");
  }

  const payload = input as Record<string, unknown>;
  const executionId = Number(payload.execution_id);
  const target = typeof payload.target === "string" ? payload.target : "";

  if (!Number.isFinite(executionId) || !target) {
    throw new Error("code_gen dispatch input is incomplete");
  }

  return {
    execution_id: executionId,
    target,
    branch_name: typeof payload.branch_name === "string" ? payload.branch_name : undefined,
    repo_name: typeof payload.repo_name === "string" ? payload.repo_name : undefined,
    log_url: typeof payload.log_url === "string" ? payload.log_url : undefined,
  };
}

function parseBugAnalysisDispatchInput(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("bug_analysis dispatch input is missing");
  }

  const payload = input as Record<string, unknown>;
  const executionId = Number(payload.execution_id);
  const target = typeof payload.target === "string" ? payload.target : "";

  if (!Number.isFinite(executionId) || !target) {
    throw new Error("bug_analysis dispatch input is incomplete");
  }

  return {
    execution_id: executionId,
    target,
    branch_name: typeof payload.branch_name === "string" ? payload.branch_name : undefined,
    repo_name: typeof payload.repo_name === "string" ? payload.repo_name : undefined,
    log_url: typeof payload.log_url === "string" ? payload.log_url : undefined,
  };
}

function parseTechDesignResult(result: CallbackPayload["result"]) {
  if (!result || typeof result !== "object") {
    throw new Error("tech design callback payload is incomplete");
  }

  const content = typeof result.content === "string" ? result.content : "";
  const techDocPath =
    typeof result.tech_doc_path === "string"
      ? normalizeCallbackPath(result.tech_doc_path, "tech design callback path is invalid")
      : "";

  if (!content || !techDocPath) {
    throw new Error("tech design callback payload is incomplete");
  }

  return {
    relativePath: techDocPath,
    content,
  };
}

function parseOpenApiResult(result: CallbackPayload["result"]) {
  if (!result || typeof result !== "object") {
    throw new Error("openapi callback payload is incomplete");
  }

  const content = typeof result.content === "string" ? result.content : "";
  const openapiPath =
    typeof result.openapi_path === "string"
      ? normalizeCallbackPath(result.openapi_path, "openapi callback path is invalid")
      : "";

  if (!content || !openapiPath) {
    throw new Error("openapi callback payload is incomplete");
  }

  return {
    relativePath: openapiPath,
    content,
  };
}

function parseBugAnalysisResult(result: CallbackPayload["result"]) {
  if (!result || typeof result !== "object") {
    throw new Error("bug analysis result is incomplete");
  }

  const summary = typeof result.summary === "string" ? result.summary.trim() : "";
  const rootCause = typeof result.root_cause === "string" ? result.root_cause.trim() : "";
  const suggestedFix = typeof result.suggested_fix === "string" ? result.suggested_fix.trim() : "";
  const confidence = typeof result.confidence === "string" ? result.confidence : "";
  const nextAction = typeof result.next_action === "string" ? result.next_action : "";

  if (!summary || !rootCause || !suggestedFix) {
    throw new Error("bug analysis result is incomplete");
  }
  if (!["high", "medium", "low"].includes(confidence)) {
    throw new Error("bug analysis confidence is invalid");
  }
  if (!["auto_fix_candidate", "manual_handoff"].includes(nextAction)) {
    throw new Error("bug analysis next_action is invalid");
  }

  return {
    summary,
    root_cause: rootCause,
    suggested_fix: suggestedFix,
    confidence: confidence as "high" | "medium" | "low",
    next_action: nextAction as "auto_fix_candidate" | "manual_handoff",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBugAnalysisComment(report: {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: "high" | "medium" | "low";
  next_action: "auto_fix_candidate" | "manual_handoff";
}) {
  return [
    "<div>",
    "<h2>Bug Analysis Summary</h2>",
    "<ul>",
    `<li><strong>Summary:</strong> ${escapeHtml(report.summary)}</li>`,
    `<li><strong>Root cause:</strong> ${escapeHtml(report.root_cause)}</li>`,
    `<li><strong>Suggested fix:</strong> ${escapeHtml(report.suggested_fix)}</li>`,
    `<li><strong>Confidence:</strong> ${escapeHtml(report.confidence)}</li>`,
    `<li><strong>Next action:</strong> ${escapeHtml(report.next_action)}</li>`,
    "</ul>",
    "</div>",
  ].join("");
}

export function createCallbackHandler(deps: CallbackDeps) {
  return {
    async handle(p: CallbackPayload): Promise<boolean> {
      const lastCallbackAt = Date.now();
      const rec = await deps.loadDispatch(p.dispatch_id);
      if (!rec) return false;
      if (p.skill && p.skill !== rec.skill) return false;
      const skill = rec.skill;

      if (rec.status === "success" || rec.status === "failed") {
        await deps.markDone(p.dispatch_id, {
          status: rec.status,
          lastCallbackAt,
          replayIncrement: true,
          resultSummary: summarizeCallbackPayload(p, "duplicate_callback_ignored"),
        });
        return false;
      }

      if (isLateCallback(rec, lastCallbackAt)) {
        await deps.markDone(p.dispatch_id, {
          status: "timeout",
          lastCallbackAt,
          replayIncrement: true,
          errorMessage: "late callback ignored",
          resultSummary: summarizeCallbackPayload(p, "late_callback_ignored"),
        });
        return false;
      }

      const claimed = (await deps.claimDispatch?.(p.dispatch_id)) ?? true;
      if (!claimed) return false;

      const result = p.result;
      const content = typeof result?.content === "string" ? result.content : "";
      const piid = p.result?.planeIssueId ?? rec.planeIssueId;
      const markSubtaskProgress = async (input: {
        execution_id: number;
        target: string;
        stage: string;
        status: "pending" | "running" | "success" | "failed";
        provider?: string;
        input_ref?: string;
        output_ref?: string;
        branch_name?: string;
        repo_name?: string;
        log_url?: string;
        error_message?: string;
      }) => {
        if (deps.markSubtaskProgress) {
          await deps.markSubtaskProgress(input);
          return;
        }
        updateWorkflowSubtaskStatusByStage(input);
      };

      const propagateSideEffectFailure = async (message: string) => {
        if (skill === "arcflow-code-gen") {
          try {
            const dispatchInput = parseCodegenDispatchInput(rec.input);
            try {
              await markSubtaskProgress({
                execution_id: dispatchInput.execution_id,
                target: dispatchInput.target,
                stage: "generate_failed",
                status: "failed",
                provider: "nanoclaw",
                branch_name: dispatchInput.branch_name,
                repo_name: dispatchInput.repo_name,
                log_url: dispatchInput.log_url,
                error_message: message,
                correlation_id: rec.correlationId,
              });
            } catch {
              try {
                updateWorkflowSubtaskStatusByStage({
                  execution_id: dispatchInput.execution_id,
                  target: dispatchInput.target,
                  stage: "generate_failed",
                  status: "failed",
                  provider: "nanoclaw",
                  branch_name: dispatchInput.branch_name,
                  repo_name: dispatchInput.repo_name,
                  log_url: dispatchInput.log_url,
                  error_message: message,
                  correlation_id: rec.correlationId,
                });
              } catch {
                // Best-effort fallback only; execution failure propagation must still continue.
              }
            }
            await deps.updateExecutionStatus?.(dispatchInput.execution_id, "failed", message);
            return;
          } catch {
            // Fall through to sourceExecutionId propagation when dispatch input is unusable.
          }
        }

        if (rec.sourceExecutionId) {
          await deps.updateExecutionStatus?.(rec.sourceExecutionId, "failed", message);
        }
      };

      try {
        if (p.status === "failed") {
          if (skill === "arcflow-code-gen") {
            const dispatchInput = parseCodegenDispatchInput(rec.input);
            await markSubtaskProgress({
              execution_id: dispatchInput.execution_id,
              target: dispatchInput.target,
              stage: "generate_failed",
              status: "failed",
              provider: "nanoclaw",
              branch_name: dispatchInput.branch_name,
              repo_name: dispatchInput.repo_name,
              log_url: dispatchInput.log_url,
              error_message: p.error,
              correlation_id: rec.correlationId,
            });
            await deps.updateExecutionStatus?.(dispatchInput.execution_id, "failed", p.error);
          } else if (skill === "arcflow-bug-analysis") {
            const dispatchInput = parseBugAnalysisDispatchInput(rec.input);
            await markSubtaskProgress({
              execution_id: dispatchInput.execution_id,
              target: dispatchInput.target,
              stage: "analysis_failed",
              status: "failed",
              provider: "nanoclaw",
              branch_name: dispatchInput.branch_name,
              repo_name: dispatchInput.repo_name,
              log_url: dispatchInput.log_url,
              error_message: p.error,
              correlation_id: rec.correlationId,
            });
            await deps.updateExecutionStatus?.(dispatchInput.execution_id, "failed", p.error);
          }
        } else if (skill === "arcflow-prd-to-tech") {
          const techDesign = parseTechDesignResult(result);
          await deps.writeTechDesign({
            workspaceId: rec.workspaceId,
            planeIssueId: piid,
            relativePath: techDesign.relativePath,
            content: techDesign.content,
          });
        } else if (skill === "arcflow-tech-to-openapi") {
          const openApi = parseOpenApiResult(result);
          await deps.writeOpenApi({
            workspaceId: rec.workspaceId,
            planeIssueId: piid,
            relativePath: openApi.relativePath,
            content: openApi.content,
          });
          const context = parseExecutionContext(rec.input);
          if (deps.triggerWorkflow && context.execution_id) {
            await deps.triggerWorkflow({
              workspace_id: Number(rec.workspaceId),
              workflow_type: "code_gen",
              trigger_source: "manual",
              plane_issue_id: piid,
              source_execution_id: context.execution_id,
              source_stage: "success",
              correlation_id: rec.correlationId ?? context.correlation_id,
              target_repos: context.target_repos,
              input_path: context.input_path,
            });
          }
        } else if (skill === "arcflow-bug-analysis") {
          const dispatchInput = parseBugAnalysisDispatchInput(rec.input);
          const report = parseBugAnalysisResult(result);
          await markSubtaskProgress({
            execution_id: dispatchInput.execution_id,
            target: dispatchInput.target,
            stage: "analysis_ready",
            status: "success",
            provider: "nanoclaw",
            branch_name: dispatchInput.branch_name,
            repo_name: dispatchInput.repo_name,
            log_url: dispatchInput.log_url,
            output_ref: JSON.stringify(report),
            correlation_id: rec.correlationId,
          });
          if (piid) {
            await deps.commentPlaneIssue({
              workspaceId: rec.workspaceId,
              planeIssueId: piid,
              content: formatBugAnalysisComment(report),
            });
          }
          await deps.updateExecutionStatus?.(dispatchInput.execution_id, "success");
        } else if (skill === "arcflow-code-gen") {
          const result = parseCodegenResult(content);
          await markSubtaskProgress({
            execution_id: result.execution_id,
            target: result.target,
            stage: "generate",
            status: "success",
            provider: "nanoclaw",
            branch_name: result.branch_name,
            repo_name: result.repo_name,
            log_url: result.log_url,
            correlation_id: rec.correlationId,
          });
          await markSubtaskProgress({
            execution_id: result.execution_id,
            target: result.target,
            stage: "ci_pending",
            status: "pending",
            provider: "generic",
            correlation_id: rec.correlationId,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (skill === "arcflow-bug-analysis") {
          try {
            const dispatchInput = parseBugAnalysisDispatchInput(rec.input);
            await markSubtaskProgress({
              execution_id: dispatchInput.execution_id,
              target: dispatchInput.target,
              stage: "analysis_failed",
              status: "failed",
              provider: "nanoclaw",
              branch_name: dispatchInput.branch_name,
              repo_name: dispatchInput.repo_name,
              log_url: dispatchInput.log_url,
              error_message: message,
              correlation_id: rec.correlationId,
            });
          } catch {
            // Best-effort fallback only; keep propagating the original error path.
          }
        }
        await propagateSideEffectFailure(message);
        await deps.markDone(p.dispatch_id, {
          status: "failed",
          lastCallbackAt,
          errorMessage: `side effect failed: ${message}`,
          resultSummary: summarizeCallbackPayload(p, "side_effect_failed"),
        });
        throw error;
      }

      const finalized = await deps.markDone(p.dispatch_id, {
        status: p.status,
        lastCallbackAt,
        errorMessage: p.status === "failed" ? (p.error ?? null) : null,
        resultSummary: summarizeCallbackPayload(p),
      });
      return finalized;
    },
  };
}
