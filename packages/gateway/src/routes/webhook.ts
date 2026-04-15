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
  getWorkspaceBySlug,
  insertDispatch,
} from "../db/queries";
import { getDb } from "../db";
import { extractIssueIdFromBranch } from "../services/ibuild";
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";
import { shouldTriggerWorkflow, extractPrdPath } from "../services/plane-webhook";
import type { PlaneWebhookPayload } from "../services/plane-webhook";
import { syncRecentChanges } from "../services/rag-sync";

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
      const body = await c.req.json();

      // 检测 docs 仓库 push 事件，立即触发 RAG 增量同步
      const repoName = body.repository?.full_name ?? body.repository?.name ?? "";
      const isDocsPush = repoName.includes("docs");

      if (isDocsPush && config.difyDatasetApiKey && config.difyDatasetId) {
        syncRecentChanges(10).catch((err) => {
          console.error("Git hook RAG sync error:", err instanceof Error ? err.message : err);
        });
      }

      return c.json({ received: true, source: "git", rag_sync_triggered: isDocsPush });
    },
  );

  // CI/CD: Test Failed → Bug analysis
  webhookRoutes.post(
    "/cicd",
    createWebhookVerifier("X-CI-Secret", config.cicdWebhookSecret),
    createDedup("X-CI-Event-Id", "cicd"),
    async (c) => {
      const body = await c.req.json();

      const status = body.status ?? body.state;
      const logs = body.logs ?? body.output ?? "";
      const issueId = body.issue_id ?? body.plane_issue_id;
      const projectId = body.project_id;
      const repo = body.repository ?? body.repo;

      if (status === "failed" || status === "failure") {
        const ws = projectId ? getWorkspaceByPlaneProject(projectId) : null;
        if (!ws) {
          return c.json({ received: true, source: "cicd", error: "workspace not linked" }, 200);
        }
        triggerWorkflow({
          workspace_id: ws.id,
          workflow_type: "bug_analysis",
          trigger_source: "cicd_webhook",
          plane_issue_id: issueId,
          input_path: logs,
          target_repos: repo ? [repo] : undefined,
        });
      }

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

    // 3. 去重（手动，因为 buildId 在 body 而非 header）
    if (buildId && isEventProcessed(buildId)) {
      return c.json({ message: "Event already processed" }, 200);
    }
    if (buildId) {
      recordWebhookEvent(buildId, "ibuild");
    }

    // 4. 状态过滤
    if (status !== "FAIL" && status !== "ABORT") {
      return c.json({ received: true, triggered: false, source: "ibuild" });
    }

    // 5. 根据 appKey 查 workspace
    const workspaceSlug =
      config.ibuildAppWorkspaceMap[appKey] ?? config.ibuildAppWorkspaceMap.default;
    const ws = workspaceSlug ? getWorkspaceBySlug(workspaceSlug) : null;
    if (!ws) {
      console.error(`iBuild appKey "${appKey}" not mapped to any workspace`);
      return c.json({ received: true, triggered: false, error: "workspace not mapped" }, 200);
    }

    // 6. 提取 Plane Issue ID + 映射仓库
    const planeIssueId = extractIssueIdFromBranch(gitBranch) ?? undefined;
    const targetRepo = config.ibuildAppRepoMap[appKey] ?? "backend";

    // 7. 异步拉取日志并触发工作流（fire-and-forget）
    fetchBuildLogWithContext(projectId, appId, buildId)
      .then((logContent) => {
        triggerWorkflow({
          workspace_id: ws.id,
          workflow_type: "bug_analysis",
          trigger_source: "ibuild_webhook",
          plane_issue_id: planeIssueId,
          input_path: logContent,
          target_repos: [targetRepo],
        });
      })
      .catch((error) => {
        console.error(`iBuild log fetch failed for build ${buildId}:`, error);
        triggerWorkflow({
          workspace_id: ws.id,
          workflow_type: "bug_analysis",
          trigger_source: "ibuild_webhook",
          plane_issue_id: planeIssueId,
          input_path: `iBuild 构建失败 (buildId: ${buildId}, branch: ${gitBranch})，日志拉取失败`,
          target_repos: [targetRepo],
        });
      });

    return c.json({ received: true, triggered: true, source: "ibuild" });
  });

  return webhookRoutes;
}
