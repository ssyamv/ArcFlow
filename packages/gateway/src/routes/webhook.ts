import { Hono } from "hono";
import { getConfig } from "../config";
import { createWebhookVerifier } from "../middleware/verify";
import { createDedup } from "../middleware/dedup";
import { triggerWorkflow } from "../services/workflow";
import {
  isEventProcessed,
  recordWebhookEvent,
  recordWebhookLog,
  getWorkspaceByPlaneProject,
  insertDispatch,
  createWorkflowExecution,
  createWorkflowLink,
  findLatestCodegenExecution,
  updateWorkflowSubtaskStatusByStage,
} from "../db/queries";
import { getDb } from "../db";
import { extractIssueIdFromBranch } from "../services/ibuild";
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";
import { shouldTriggerWorkflow, extractPrdPath } from "../services/plane-webhook";
import type { PlaneWebhookPayload } from "../services/plane-webhook";

type UnifiedCiStatus = "success" | "failed";

interface UnifiedCiEvent {
  planeIssueId: string;
  target: string;
  provider: "generic" | "ibuild";
  externalRunId: string;
  status: UnifiedCiStatus;
  logUrl: string | null;
  rawPayload: Record<string, unknown>;
}

/** Insert a dispatch record and fire-and-forget to NanoClaw WebChannel. */
function dispatchToNanoclaw(params: {
  skill: string;
  workspaceId: string;
  planeIssueId?: string;
  input: unknown;
}): string {
  const db = getDb();
  const dispatchId = insertDispatch(db, {
    workspaceId: params.workspaceId,
    skill: params.skill,
    input: params.input,
    planeIssueId: params.planeIssueId,
    timeoutAt: Date.now() + 10 * 60 * 1000,
  });
  const nanoclawUrl = process.env.NANOCLAW_URL;
  const secret = process.env.NANOCLAW_DISPATCH_SECRET ?? "";
  if (nanoclawUrl && secret) {
    fetch(`${nanoclawUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": secret },
      body: JSON.stringify({
        client_id: `system-${dispatchId}`,
        message: `[SYSTEM DISPATCH] run skill=${params.skill} workspace_id=${params.workspaceId} plane_issue_id=${params.planeIssueId ?? ""}\n\n${JSON.stringify(params.input)}`,
      }),
    }).catch((err) => console.error("[webhook] nanoclaw dispatch error:", err));
  }
  return dispatchId;
}

function normalizeCiStatus(raw: string): UnifiedCiStatus | null {
  const normalized = raw.trim().toLowerCase();
  if (["success", "succeed", "succeeded", "passed", "pass", "ok"].includes(normalized)) {
    return "success";
  }
  if (["failed", "failure", "fail", "error", "abort", "aborted"].includes(normalized)) {
    return "failed";
  }
  return null;
}

function mapCiEvent(body: Record<string, unknown>): UnifiedCiEvent | null {
  const status = normalizeCiStatus(String(body.status ?? body.state ?? ""));
  if (!status) return null;

  return {
    planeIssueId: String(body.issue_id ?? body.plane_issue_id ?? ""),
    target: String(body.target ?? body.repository ?? body.repo ?? "backend"),
    provider: "generic",
    externalRunId: String(body.run_id ?? body.build_id ?? body.buildId ?? ""),
    status,
    logUrl:
      typeof body.log_url === "string"
        ? body.log_url
        : typeof body.logs === "string"
          ? body.logs
          : typeof body.output === "string"
            ? body.output
            : null,
    rawPayload: body,
  };
}

function handleCiEvent(event: UnifiedCiEvent): boolean {
  if (!event.planeIssueId) return false;

  const execution = findLatestCodegenExecution(event.planeIssueId, event.target);
  if (!execution) return false;

  updateWorkflowSubtaskStatusByStage({
    execution_id: execution.id,
    target: event.target,
    stage: event.status === "failed" ? "ci_failed" : "ci_success",
    provider: event.provider,
    status: event.status === "failed" ? "failed" : "success",
    external_run_id: event.externalRunId || undefined,
    log_url: event.logUrl ?? undefined,
  });

  if (event.status === "failed") {
    const bugExecutionId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: event.provider === "ibuild" ? "ibuild_webhook" : "cicd_webhook",
      plane_issue_id: event.planeIssueId,
      input_path: event.logUrl ?? undefined,
    });
    createWorkflowLink({
      source_execution_id: execution.id,
      target_execution_id: bugExecutionId,
      link_type: "spawned_on_ci_failure",
      metadata: { target: event.target, provider: event.provider, payload: event.rawPayload },
    });
  }

  return true;
}

export function createWebhookRoutes(): Hono {
  const config = getConfig();
  const webhookRoutes = new Hono();

  // Plane: Issue Approved → trigger doc generation
  webhookRoutes.post(
    "/plane",
    createWebhookVerifier("X-Plane-Signature", config.planeWebhookSecret),
    createDedup("X-Plane-Delivery", "plane"),
    async (c) => {
      const body = (await c.req.json()) as PlaneWebhookPayload;

      // 记录原始 payload 用于联调排错
      recordWebhookLog("plane", body);

      if (shouldTriggerWorkflow(body, config.planeApprovedStateId)) {
        const prdPath = extractPrdPath(body.data);
        const projectId = (body.data.project_id ?? body.data.project) as string | undefined;
        const ws = projectId ? getWorkspaceByPlaneProject(projectId) : null;
        if (!ws) {
          return c.json(
            { received: true, source: "plane", error: "workspace not linked for plane project" },
            200,
          );
        }

        triggerWorkflow({
          workspace_id: ws.id,
          workflow_type: "prd_to_tech",
          trigger_source: "plane_webhook",
          plane_issue_id: body.data.id,
          input_path: prdPath,
          chat_id: ws.feishu_chat_id || undefined,
        });

        // NanoClaw skill dispatch (new path, co-exists until Task 21 removes triggerWorkflow)
        dispatchToNanoclaw({
          skill: "arcflow-prd-to-tech",
          workspaceId: String(ws.id),
          planeIssueId: body.data.id,
          input: { prd_path: prdPath, workspace_id: String(ws.id), plane_issue_id: body.data.id },
        });
      }

      return c.json({ received: true, source: "plane" });
    },
  );

  // Git: MR merged / docs push → trigger RAG sync
  webhookRoutes.post(
    "/git",
    createWebhookVerifier("X-Gitea-Secret", config.gitWebhookSecret),
    createDedup("X-Gitea-Delivery", "git"),
    async (c) => {
      return c.json({ received: true, source: "git" });
    },
  );

  // CI/CD: Test Failed → Bug analysis
  webhookRoutes.post(
    "/cicd",
    createWebhookVerifier("X-CI-Secret", config.cicdWebhookSecret),
    createDedup("X-CI-Event-Id", "cicd"),
    async (c) => {
      const body = (await c.req.json()) as Record<string, unknown>;
      const event = mapCiEvent(body);
      if (event) handleCiEvent(event);

      return c.json({ received: true, source: "cicd" });
    },
  );

  // Feishu callback endpoint.
  // Batch 4-I (spec §8): internal network is outbound-only, so card button
  // reverse callbacks are no longer supported. Cards now ship Web redirect
  // links carrying short-lived approval tokens — the user's browser hits
  // /api/approval/execute directly. We keep this endpoint only to answer
  // Feishu's URL verification challenge during app setup.
  webhookRoutes.post("/feishu", async (c) => {
    const body = await c.req.json();
    if (body.type === "url_verification") {
      return c.json({ challenge: body.challenge });
    }
    // Ignore all other callbacks (including stale card clicks from old cards).
    return c.json({ received: true, source: "feishu", handled: false });
  });

  // iBuild: 构建失败 → Bug 分析
  webhookRoutes.post("/ibuild", async (c) => {
    // 1. Secret 校验（query param）
    const secret = c.req.query("secret");
    if (secret !== config.ibuildWebhookSecret) {
      return c.json({ error: "Invalid secret" }, 401);
    }

    // 2. 解析 URL-encoded body
    const formData = await c.req.parseBody();
    const status = String(formData.status ?? "");
    const buildId = String(formData.buildId ?? "");
    const projectId = String(formData.projectId ?? "");
    const appId = String(formData.appId ?? "");
    const gitBranch = String(formData.gitBranch ?? "");
    const appKey = String(formData.appKey ?? "");
    const normalizedStatus = normalizeCiStatus(status);

    // 3. 去重（手动，因为 buildId 在 body 而非 header）
    if (buildId && isEventProcessed(buildId)) {
      return c.json({ message: "Event already processed" }, 200);
    }
    if (buildId) {
      recordWebhookEvent(buildId, "ibuild");
    }

    // 4. 状态过滤
    if (!normalizedStatus) {
      return c.json({ received: true, triggered: false, source: "ibuild" });
    }

    // 5. 提取 Plane Issue ID + 映射仓库
    const planeIssueId = extractIssueIdFromBranch(gitBranch) ?? "";
    const targetRepo = config.ibuildAppRepoMap[appKey] ?? appKey ?? "backend";
    const baseEvent: UnifiedCiEvent = {
      planeIssueId,
      target: targetRepo,
      provider: "ibuild",
      externalRunId: buildId,
      status: normalizedStatus,
      logUrl: null,
      rawPayload: Object.fromEntries(
        Object.entries(formData).map(([key, value]) => [key, String(value)]),
      ),
    };

    if (normalizedStatus === "failed") {
      fetchBuildLogWithContext(projectId, appId, buildId)
        .then((logContent) => {
          handleCiEvent({ ...baseEvent, logUrl: logContent });
        })
        .catch((error) => {
          console.error(`iBuild log fetch failed for build ${buildId}:`, error);
          handleCiEvent({
            ...baseEvent,
            logUrl: `iBuild 构建失败 (buildId: ${buildId}, branch: ${gitBranch})，日志拉取失败`,
          });
        });

      return c.json({ received: true, triggered: true, source: "ibuild" });
    }

    handleCiEvent(baseEvent);
    return c.json({ received: true, triggered: false, source: "ibuild" });
  });

  return webhookRoutes;
}
