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
}

export interface CallbackPayload {
  dispatch_id: string;
  skill: string;
  status: "success" | "failed";
  result?: { content: string; planeIssueId?: string };
  error?: string;
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

      if (p.skill === "arcflow-prd-to-tech") {
        await deps.writeTechDesign({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
      } else if (p.skill === "arcflow-tech-to-openapi") {
        await deps.writeOpenApi({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
      } else if (p.skill === "arcflow-bug-analysis") {
        if (piid) await deps.commentPlaneIssue({ planeIssueId: piid, content });
      }
      return true;
    },
  };
}
