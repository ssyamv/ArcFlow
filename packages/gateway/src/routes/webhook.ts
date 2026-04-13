import { Hono } from "hono";
import { getConfig } from "../config";
import { createWebhookVerifier } from "../middleware/verify";
import { createDedup } from "../middleware/dedup";
import { triggerWorkflow } from "../services/workflow";
import {
  isEventProcessed,
  recordWebhookEvent,
  recordWebhookLog,
  getRequirementDraft,
  updateRequirementDraft,
  findRequirementDraftByPlaneIssue,
  getWorkspaceByPlaneProject,
  getWorkspaceBySlug,
} from "../db/queries";
import { extractIssueIdFromBranch } from "../services/ibuild";
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";
import { shouldTriggerWorkflow, extractPrdPath } from "../services/plane-webhook";
import type { PlaneWebhookPayload } from "../services/plane-webhook";
import { syncRecentChanges } from "../services/rag-sync";
import { updateCard } from "../services/feishu";
import { approveDraft } from "../services/requirement";

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
        // 1. 优先从 issue 描述里抽 prd/ 路径（手动 issue 走这条）
        let prdPath = extractPrdPath(body.data);
        // 2. 回落：通过新流程创建的 issue 没有路径在描述里，靠 plane_issue_id 反查 draft
        if (!prdPath) {
          const draft = findRequirementDraftByPlaneIssue(body.data.id);
          if (draft?.prd_git_path) prdPath = draft.prd_git_path;
        }
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
        const actionType = value.action; // "approve" or "reject" (tech review)
        const callbackType = value.type; // "requirement_approve" or "requirement_reject"
        const issueId = value.issue_id;

        // ── 需求 PRD Review 回调 ──────────────────────────────────────────
        if (callbackType === "requirement_approve" || callbackType === "requirement_reject") {
          const draftId = Number(value.draft_id);
          if (draftId) {
            const draft = getRequirementDraft(draftId);
            if (draft && draft.status === "review") {
              if (callbackType === "requirement_approve") {
                // P4: Stage D — 执行五步原子操作
                approveDraft({ draftId, source: "feishu" })
                  .then((result) => {
                    if (!result.ok) {
                      console.error(
                        `[feishu webhook] approveDraft failed (draftId=${draftId}, step=${result.step}): ${result.error}`,
                      );
                      // 审批失败时更新卡片显示错误
                      if (draft.feishu_card_id) {
                        const errorCard = {
                          config: { wide_screen_mode: true },
                          header: {
                            title: { tag: "plain_text", content: "⚠️ 需求 PRD 审批落地失败" },
                            template: "yellow",
                          },
                          elements: [
                            {
                              tag: "div",
                              text: {
                                tag: "lark_md",
                                content: `**标题：** ${draft.issue_title || "（无标题）"}\n\n审批操作失败（步骤: ${result.step ?? "unknown"}）：${result.error}\n\n请联系管理员检查配置后重试。`,
                              },
                            },
                          ],
                        };
                        updateCard(draft.feishu_card_id, errorCard).catch((err) => {
                          console.warn(
                            `[feishu webhook] 更新卡片失败: ${err instanceof Error ? err.message : err}`,
                          );
                        });
                      }
                    } else {
                      console.log(
                        `[feishu webhook] requirement draft ${draftId} approved via Stage D`,
                      );
                      if (result.warning) {
                        console.warn(`[feishu webhook] approveDraft warning: ${result.warning}`);
                      }
                    }
                  })
                  .catch((err) => {
                    console.error(
                      `[feishu webhook] approveDraft threw (draftId=${draftId}): ${err instanceof Error ? err.message : err}`,
                    );
                  });
              } else {
                // requirement_reject
                updateRequirementDraft(draftId, { status: "rejected" });
                console.log(`[feishu webhook] requirement draft ${draftId} rejected`);

                if (draft.feishu_card_id) {
                  const rejectedCard = {
                    config: { wide_screen_mode: true },
                    header: {
                      title: { tag: "plain_text", content: "❌ 需求 PRD 已驳回" },
                      template: "red",
                    },
                    elements: [
                      {
                        tag: "div",
                        text: {
                          tag: "lark_md",
                          content: `**标题：** ${draft.issue_title || "（无标题）"}\n\n已驳回，请 PM 修改后重新提交。`,
                        },
                      },
                    ],
                  };
                  updateCard(draft.feishu_card_id, rejectedCard).catch((err) => {
                    console.warn(
                      `[feishu webhook] 更新卡片失败: ${err instanceof Error ? err.message : err}`,
                    );
                  });
                }
              }
            }
          }
        }

        // ── 技术文档 Review 回调（原有逻辑） ────────────────────────────
        if (actionType === "approve" && issueId && value.workspace_id) {
          // Trigger code generation
          triggerWorkflow({
            workspace_id: Number(value.workspace_id),
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
