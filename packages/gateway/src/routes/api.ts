import { Hono } from "hono";
import {
  getWorkflowExecution,
  listWorkflowExecutions,
  listWebhookLogs,
  getWorkspace,
  getWorkspaceMemberRole,
  buildMemorySnapshot,
  recordUserAction,
  insertDispatch,
} from "../db/queries";
import { getDb } from "../db";

const ALLOWED_SKILLS = [
  "arcflow-prd-draft",
  "arcflow-prd-to-tech",
  "arcflow-tech-to-openapi",
  "arcflow-bug-analysis",
  "arcflow-rag",
] as const;
import { triggerWorkflow } from "../services/workflow";
import { authMiddleware } from "../middleware/auth";
import type { TriggerWorkflowRequest, WorkflowType, WorkflowStatus, WebhookSource } from "../types";

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

  const execution = getWorkflowExecution(id);
  if (!execution) return c.json({ error: "Not found" }, 404);

  return c.json(execution);
});

apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as WorkflowType | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const result = listWorkflowExecutions({ workflow_type: workflowType, status, limit });
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
  const db = getDb();
  const dispatchId = insertDispatch(db, {
    workspaceId,
    skill: body.skill,
    input: body.input ?? {},
    planeIssueId: body.plane_issue_id,
    timeoutAt: Date.now() + 10 * 60 * 1000,
  });
  if (typeof body.user_id === "number" && body.user_id > 0) {
    recordUserAction({
      userId: body.user_id,
      workspaceId: typeof body.workspace_id === "number" ? body.workspace_id : null,
      actionType: `nanoclaw.dispatch.${body.skill}`,
      payload: {
        dispatch_id: dispatchId,
        plane_issue_id: body.plane_issue_id,
        input: body.input,
      },
    });
  }

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

  try {
    const resp = await fetch(`${nanoclawUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-System-Secret": expected,
      },
      body: JSON.stringify({
        client_id: `system-${dispatchId}`,
        message: `[SYSTEM DISPATCH] run skill=${body.skill} workspace_id=${body.workspace_id} plane_issue_id=${body.plane_issue_id ?? ""}\n\n${JSON.stringify(body.input ?? {})}`,
      }),
    });
    const ok = resp.ok;
    return c.json({
      ok,
      dispatched: true,
      dispatch_id: dispatchId,
      nanoclaw_status: resp.status,
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        dispatched: false,
        dispatch_id: dispatchId,
        error: err instanceof Error ? err.message : "dispatch failed",
      },
      502,
    );
  }
});
