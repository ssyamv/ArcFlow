import { Hono } from "hono";
import {
  getWorkflowExecutionDetail,
  listWorkflowExecutionsWithSummary,
  listWebhookLogs,
  listWebhookJobs,
  getWorkspace,
  getWorkspaceMemberRole,
  buildMemorySnapshot,
  recordUserAction,
} from "../db/queries";
import { dispatchToNanoclaw } from "../services/nanoclaw-dispatch";

const ALLOWED_SKILLS = [
  "arcflow-prd-draft",
  "arcflow-prd-to-tech",
  "arcflow-tech-to-openapi",
  "arcflow-bug-analysis",
  "arcflow-rag",
] as const;
import { triggerWorkflow } from "../services/workflow";
import { authMiddleware } from "../middleware/auth";
import type {
  TriggerWorkflowRequest,
  WorkflowType,
  WorkflowStatus,
  WebhookSource,
  WebhookJobStatus,
} from "../types";

export const apiRoutes = new Hono();

apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();

  if (!body.workspace_id) {
    return c.json({ error: "workspace_id is required" }, 400);
  }
  if (!getWorkspace(body.workspace_id)) {
    return c.json({ error: `workspace ${body.workspace_id} not found` }, 404);
  }

  const id = await triggerWorkflow({
    workspace_id: body.workspace_id,
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    source_execution_id: body.source_execution_id,
    source_stage: body.source_stage,
    input_path: body.params?.input_path,
    target_repos:
      body.params?.target_repos ??
      (body.params as { target_repos?: string[]; targets?: string[] } | undefined)?.targets,
    figma_url: body.params?.figma_url,
    chat_id: body.params?.chat_id,
  });

  return c.json({
    execution_id: id,
    status: "running",
    message: "工作流已触发",
  });
});

apiRoutes.get("/workflow/executions/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const detail = getWorkflowExecutionDetail(id);
  if (!detail) return c.json({ error: "Not found" }, 404);

  return c.json(detail);
});

apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as WorkflowType | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const result = listWorkflowExecutionsWithSummary({ workflow_type: workflowType, status, limit });
  return c.json(result);
});

// Webhook 日志查询（联调排错用）
apiRoutes.get("/webhook/logs", (c) => {
  const source = c.req.query("source") as WebhookSource | undefined;
  const limit = Number(c.req.query("limit")) || 50;
  const logs = listWebhookLogs(source, limit);
  return c.json({
    data: logs.map((log) => ({
      ...log,
      payload: JSON.parse(log.payload),
    })),
    total: logs.length,
  });
});

apiRoutes.get("/webhook/jobs", (c) => {
  const source = c.req.query("source") as WebhookSource | undefined;
  const status = c.req.query("status") as WebhookJobStatus | undefined;
  const action = c.req.query("action") || undefined;
  const limit = Number(c.req.query("limit")) || 20;
  const result = listWebhookJobs({ source, status, action, limit });
  return c.json({
    data: result.data.map((job) => ({
      ...job,
      payload: JSON.parse(job.payload_json),
      result: job.result_json ? JSON.parse(job.result_json) : null,
    })),
    total: result.total,
  });
});

// ---------------------------------------------------------------------------
// Batch 2-F: memory snapshot + nanoclaw dispatch
// ---------------------------------------------------------------------------

apiRoutes.use("/memory/*", authMiddleware);
apiRoutes.get("/memory/snapshot", (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const wsRaw = c.req.query("workspace_id");
  const workspaceId = Number(wsRaw);
  if (!wsRaw || !Number.isFinite(workspaceId) || workspaceId <= 0) {
    return c.json({ error: "workspace_id is required" }, 400);
  }
  // Authorization: caller must be a member of the workspace.
  const role = getWorkspaceMemberRole(workspaceId, userId);
  if (!role) return c.json({ error: "Not a workspace member" }, 403);

  const snapshot = buildMemorySnapshot(workspaceId);
  return c.json(snapshot);
});

/**
 * POST /api/nanoclaw/dispatch
 * Header: X-System-Secret (must match NANOCLAW_DISPATCH_SECRET)
 * Body: { skill: string, workspace_id: number, plane_issue_id?: string,
 *         user_id?: number, input?: unknown }
 *
 * Internal system-task entry. Called by Plane / webhook handlers when an
 * automated workflow (e.g. Issue approved → prd_to_tech) needs to run an
 * Agent skill without a live user. The Gateway forwards to NanoClaw's
 * WebChannel as a system-identity message; NanoClaw loads the requested
 * skill and executes.
 *
 * When NANOCLAW_URL is unset (dev / test), the request is persisted to
 * user_action_log and echoed back for inspection.
 */
apiRoutes.post("/nanoclaw/dispatch", async (c) => {
  const secret = c.req.header("X-System-Secret") ?? "";
  const expected = process.env.NANOCLAW_DISPATCH_SECRET ?? "";
  if (!expected) {
    return c.json({ error: "NANOCLAW_DISPATCH_SECRET not configured" }, 503);
  }
  if (secret !== expected) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body =
    (await c.req.json<{
      skill?: string;
      workspace_id?: number | string;
      plane_issue_id?: string;
      user_id?: number;
      input?: unknown;
    }>()) ?? {};
  if (!body.skill || !body.workspace_id) {
    return c.json({ error: "skill and workspace_id are required" }, 400);
  }
  if (!(ALLOWED_SKILLS as readonly string[]).includes(body.skill)) {
    return c.json({ error: `unknown skill: ${body.skill}` }, 400);
  }

  const workspaceId = String(body.workspace_id);
  const dispatchResult = await dispatchToNanoclaw({
    workspaceId,
    skill: body.skill,
    input: body.input ?? {},
    planeIssueId: body.plane_issue_id,
    swallowDispatchError: true,
  });
  const dispatchId = dispatchResult.dispatchId;
  recordUserAction({
    userId: body.user_id ?? 0,
    workspaceId: typeof body.workspace_id === "number" ? body.workspace_id : null,
    actionType: `nanoclaw.dispatch.${body.skill}`,
    payload: {
      dispatch_id: dispatchId,
      plane_issue_id: body.plane_issue_id,
      input: body.input,
    },
  });

  const nanoclawUrl = process.env.NANOCLAW_URL;
  if (!nanoclawUrl) {
    // Dev / test — do not attempt HTTP, just return the dispatch id.
    return c.json({
      ok: true,
      dispatched: false,
      dispatch_id: dispatchId,
      reason: "NANOCLAW_URL not set — recorded only",
    });
  }
  if (!dispatchResult.dispatched) {
    return c.json(
      {
        ok: false,
        dispatched: false,
        dispatch_id: dispatchId,
        error: dispatchResult.error ?? "dispatch failed",
      },
      502,
    );
  }
  return c.json({
    ok:
      dispatchResult.nanoclawStatus !== undefined
        ? dispatchResult.nanoclawStatus >= 200 && dispatchResult.nanoclawStatus < 300
        : false,
    dispatched: true,
    dispatch_id: dispatchId,
    nanoclaw_status: dispatchResult.nanoclawStatus,
  });
});
