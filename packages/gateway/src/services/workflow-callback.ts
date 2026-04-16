import { updateWorkflowSubtaskStatusByStage } from "../db/queries";

export interface DispatchRecord {
  id: string;
  workspaceId: string;
  skill: string;
  planeIssueId?: string;
  status: "pending" | "success" | "failed";
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

export function createCallbackHandler(deps: CallbackDeps) {
  return {
    async handle(p: CallbackPayload): Promise<boolean> {
      const rec = await deps.loadDispatch(p.dispatch_id);
      if (!rec) return false;
      if (rec.status !== "pending") return false;

      const claimed = await deps.markDone(p.dispatch_id, p.status);
      if (!claimed) return false;
      if (p.status === "failed") return true;

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
      }) => {
        if (deps.markSubtaskProgress) {
          await deps.markSubtaskProgress(input);
          return;
        }
        updateWorkflowSubtaskStatusByStage(input);
      };

      if (p.skill === "arcflow-prd-to-tech") {
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
      return true;
    },
  };
}
