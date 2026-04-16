import { updateWorkflowSubtaskStatusByStage } from "../db/queries";

export interface DispatchRecord {
  id: string;
  workspaceId: string;
  skill: string;
  planeIssueId?: string;
  status: "pending" | "processing" | "success" | "failed";
  input?: unknown;
}

export interface CallbackDeps {
  writeTechDesign: (x: {
    workspaceId: string;
    planeIssueId?: string;
    content: string;
  }) => Promise<void>;
  writeOpenApi: (x: {
    workspaceId: string;
    planeIssueId?: string;
    content: string;
  }) => Promise<void>;
  commentPlaneIssue: (x: { planeIssueId: string; content: string }) => Promise<void>;
  loadDispatch: (id: string) => Promise<DispatchRecord | null>;
  claimDispatch?: (id: string) => Promise<boolean>;
  releaseClaim?: (id: string) => Promise<boolean>;
  markDone: (id: string, status: "success" | "failed") => Promise<boolean>;
  markSubtaskProgress?: (x: {
    execution_id: number;
    target: string;
    stage: string;
    status: "pending" | "running" | "success" | "failed";
    provider?: string;
    branch_name?: string;
    repo_name?: string;
    log_url?: string;
    error_message?: string;
  }) => Promise<void> | void;
}

export interface CallbackPayload {
  dispatch_id: string;
  skill: string;
  status: "success" | "failed";
  result?: { content: string; planeIssueId?: string };
  error?: string;
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

export function createCallbackHandler(deps: CallbackDeps) {
  return {
    async handle(p: CallbackPayload): Promise<boolean> {
      const rec = await deps.loadDispatch(p.dispatch_id);
      if (!rec) return false;

      const claimed = (await deps.claimDispatch?.(p.dispatch_id)) ?? true;
      if (!claimed) return false;

      const content = p.result?.content ?? "";
      const piid = p.result?.planeIssueId ?? rec.planeIssueId;
      const markSubtaskProgress = async (input: {
        execution_id: number;
        target: string;
        stage: string;
        status: "pending" | "running" | "success" | "failed";
        provider?: string;
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

      try {
        if (p.status === "failed") {
          if (p.skill === "arcflow-code-gen") {
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
            });
          }
        } else if (p.skill === "arcflow-prd-to-tech") {
          await deps.writeTechDesign({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
        } else if (p.skill === "arcflow-tech-to-openapi") {
          await deps.writeOpenApi({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
        } else if (p.skill === "arcflow-bug-analysis") {
          if (piid) await deps.commentPlaneIssue({ planeIssueId: piid, content });
        } else if (p.skill === "arcflow-code-gen") {
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
          });
          await markSubtaskProgress({
            execution_id: result.execution_id,
            target: result.target,
            stage: "ci_pending",
            status: "pending",
            provider: "generic",
          });
        }
      } catch (error) {
        await deps.releaseClaim?.(p.dispatch_id);
        throw error;
      }

      const finalized = await deps.markDone(p.dispatch_id, p.status);
      return finalized;
    },
  };
}
