import { Hono } from "hono";
import { getConfig } from "../config";
import { createWebhookVerifier } from "../middleware/verify";
import { createDedup } from "../middleware/dedup";
import { triggerWorkflow } from "../services/workflow";
import { isEventProcessed, recordWebhookEvent, recordWebhookLog } from "../db/queries";
import { extractIssueIdFromBranch } from "../services/ibuild";
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";
import { shouldTriggerWorkflow, extractPrdPath } from "../services/plane-webhook";
import type { PlaneWebhookPayload } from "../services/plane-webhook";
import { syncRecentChanges } from "../services/rag-sync";

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
        const projectId = body.data.project_id ?? body.data.project;

        triggerWorkflow({
          workflow_type: "prd_to_tech",
          trigger_source: "plane_webhook",
          plane_issue_id: body.data.id,
          input_path: prdPath,
          project_id: projectId as string | undefined,
          chat_id: config.feishuDefaultChatId || undefined,
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
      const isDocsPush = repoName.includes("docs") || repoName === config.docsGitRepo;

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
        triggerWorkflow({
          workflow_type: "bug_analysis",
          trigger_source: "cicd_webhook",
          plane_issue_id: issueId,
          input_path: logs,
          project_id: projectId,
          target_repos: repo ? [repo] : undefined,
        });
      }

      return c.json({ received: true, source: "cicd" });
    },
  );

  // Feishu callback: approval button clicks
  webhookRoutes.post("/feishu", async (c) => {
    const body = await c.req.json();

    // Feishu URL verification challenge
    if (body.type === "url_verification") {
      return c.json({ challenge: body.challenge });
    }

    // Parse Feishu card action callback
    const action = body.action;
    if (action?.value) {
      try {
        const value = JSON.parse(action.value);
        const actionType = value.action; // "approve" or "reject"
        const issueId = value.issue_id;

        if (actionType === "approve" && issueId) {
          // Trigger code generation
          triggerWorkflow({
            workflow_type: "code_gen",
            trigger_source: "manual",
            plane_issue_id: issueId,
            input_path: value.doc_path,
            target_repos: ["backend"],
          });
        }
        // reject is handled by updateIssueState in the workflow
      } catch {
        // Invalid action value, ignore
      }
    }

    return c.json({ received: true, source: "feishu" });
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

    // 5. planeDefaultProjectId 校验
    if (!config.planeDefaultProjectId) {
      console.error("PLANE_DEFAULT_PROJECT_ID is not configured, skipping iBuild bug analysis");
      return c.json({ received: true, triggered: false, error: "missing config" }, 200);
    }

    // 6. 提取 Plane Issue ID + 映射仓库
    const planeIssueId = extractIssueIdFromBranch(gitBranch) ?? undefined;
    const targetRepo = config.ibuildAppRepoMap[appKey] ?? "backend";

    // 7. 异步拉取日志并触发工作流（fire-and-forget）
    fetchBuildLogWithContext(projectId, appId, buildId)
      .then((logContent) => {
        triggerWorkflow({
          workflow_type: "bug_analysis",
          trigger_source: "ibuild_webhook",
          plane_issue_id: planeIssueId,
          input_path: logContent,
          project_id: config.planeDefaultProjectId,
          target_repos: [targetRepo],
        });
      })
      .catch((error) => {
        console.error(`iBuild log fetch failed for build ${buildId}:`, error);
        triggerWorkflow({
          workflow_type: "bug_analysis",
          trigger_source: "ibuild_webhook",
          plane_issue_id: planeIssueId,
          input_path: `iBuild 构建失败 (buildId: ${buildId}, branch: ${gitBranch})，日志拉取失败`,
          project_id: config.planeDefaultProjectId,
          target_repos: [targetRepo],
        });
      });

    return c.json({ received: true, triggered: true, source: "ibuild" });
  });

  return webhookRoutes;
}
