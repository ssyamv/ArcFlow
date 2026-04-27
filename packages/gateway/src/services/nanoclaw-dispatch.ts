import { getDb } from "../db";
import { insertDispatch } from "../db/queries";

interface DispatchToNanoclawParams {
  skill: string;
  workspaceId: string;
  planeIssueId?: string;
  sourceExecutionId?: number;
  sourceStage?: string;
  correlationId?: string;
  input: unknown;
  swallowDispatchError?: boolean;
}

export interface DispatchToNanoclawResult {
  dispatchId: string;
  dispatched: boolean;
  nanoclawStatus?: number;
  error?: string;
}

export async function dispatchToNanoclaw(
  params: DispatchToNanoclawParams,
): Promise<DispatchToNanoclawResult> {
  const db = getDb();
  const dispatchId = insertDispatch(db, {
    workspaceId: params.workspaceId,
    skill: params.skill,
    input: params.input,
    planeIssueId: params.planeIssueId,
    sourceExecutionId: params.sourceExecutionId,
    sourceStage: params.sourceStage,
    correlationId: params.correlationId,
    timeoutAt: Date.now() + 10 * 60 * 1000,
  });

  const nanoclawUrl = process.env.NANOCLAW_URL;
  const secret = process.env.NANOCLAW_DISPATCH_SECRET ?? "";
  if (!nanoclawUrl || !secret) {
    return { dispatchId, dispatched: false };
  }

  try {
    const resp = await fetch(`${nanoclawUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": secret },
      body: JSON.stringify({
        client_id: `system-${dispatchId}`,
        message: `[SYSTEM DISPATCH] run skill=${params.skill} workspace_id=${params.workspaceId} plane_issue_id=${params.planeIssueId ?? ""}\n\n${JSON.stringify(params.input)}`,
      }),
    });

    return {
      dispatchId,
      dispatched: true,
      nanoclawStatus: resp.status,
    };
  } catch (error) {
    if (!params.swallowDispatchError) throw error;
    return {
      dispatchId,
      dispatched: false,
      error: error instanceof Error ? error.message : "dispatch failed",
    };
  }
}
