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
  listWorkflowLinksBySourceExecution,
  syncCodegenExecutionStatus,
  updateWorkflowSubtaskStatusByStage,
  findLatestDispatchWorkspaceIdByExecution,
  createWebhookJob,
  claimWebhookJob,
  finishWebhookJob,
} from "../db/queries";
import { getDb } from "../db";
import { extractIssueIdFromBranch } from "../services/ibuild";
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";
import { shouldTriggerWorkflow, extractPrdPath } from "../services/plane-webhook";
import type { PlaneWebhookPayload } from "../services/plane-webhook";
import {
  classifyGitWebhook,
  parseGitWebhookEvent,
  type GitWebhookEvent,
} from "../services/git-webhook";
import { processGitMergeEvent } from "../services/git-merge";

type UnifiedCiStatus = "pending" | "running" | "success" | "failed";

interface UnifiedCiEvent {
  planeIssueId?: string;
  target: string;
  provider: "generic" | "ibuild";
  externalRunId: string;
  branchName: string | null;
  status: UnifiedCiStatus;
  logUrl: string | null;
  rawPayload: Record<string, unknown>;
}

interface WebhookRouteDeps {
  git?: {
    syncDocs?: (event: GitWebhookEvent) => Promise<void>;
  };
}

/** Insert a dispatch record and fire-and-forget to NanoClaw WebChannel. */
function dispatchToNanoclaw(params: {
  skill: string;
  workspaceId: string;
  planeIssueId?: string;
  input: unknown;
  sourceExecutionId?: number;
  sourceStage?: string;
}): string {
  const db = getDb();
  const dispatchId = insertDispatch(db, {
    workspaceId: params.workspaceId,
    skill: params.skill,
    input: params.input,
    planeIssueId: params.planeIssueId,
    sourceExecutionId: params.sourceExecutionId,
    sourceStage: params.sourceStage,
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
  if (["pending", "queued", "queueing", "waiting"].includes(normalized)) {
    return "pending";
  }
  if (["running", "processing", "in_progress", "in-progress"].includes(normalized)) {
    return "running";
  }
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
    planeIssueId:
      typeof body.issue_id === "string"
        ? body.issue_id
        : typeof body.plane_issue_id === "string"
          ? body.plane_issue_id
          : undefined,
    target: String(body.target ?? body.repository ?? body.repo ?? "backend"),
    provider: "generic",
    externalRunId: String(body.run_id ?? body.build_id ?? body.buildId ?? ""),
    branchName:
      typeof body.branch === "string"
        ? body.branch
        : typeof body.gitBranch === "string"
          ? body.gitBranch
          : typeof body.git_branch === "string"
            ? body.git_branch
            : null,
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

function findExistingCiFailureSpawn(params: {
  sourceExecutionId: number;
  target: string;
  provider: "generic" | "ibuild";
  externalRunId?: string;
  branchName?: string | null;
}): number | null {
  const links = listWorkflowLinksBySourceExecution(
    params.sourceExecutionId,
    "spawned_on_ci_failure",
  );

  for (const link of links) {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(link.metadata) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (metadata.target !== params.target || metadata.provider !== params.provider) {
      continue;
    }

    if (params.externalRunId) {
      if (metadata.external_run_id === params.externalRunId) {
        return link.target_execution_id;
      }
      continue;
    }

    if (params.branchName && metadata.branch_name === params.branchName) {
      return link.target_execution_id;
    }
  }

  return null;
}

function handleCiEvent(event: UnifiedCiEvent): boolean {
  const execution = findLatestCodegenExecution(event.planeIssueId, event.target, {
    branchName: event.branchName ?? undefined,
    externalRunId: event.externalRunId || undefined,
  });
  if (!execution) return false;

  const effectivePlaneIssueId = event.planeIssueId ?? execution.plane_issue_id ?? undefined;
  const stage =
    event.status === "failed"
      ? "ci_failed"
      : event.status === "success"
        ? "ci_success"
        : event.status === "running"
          ? "ci_running"
          : "ci_pending";

  updateWorkflowSubtaskStatusByStage({
    execution_id: execution.id,
    target: event.target,
    stage,
    provider: event.provider,
    status: event.status,
    external_run_id: event.externalRunId || undefined,
    branch_name: event.branchName ?? undefined,
    log_url: event.logUrl ?? undefined,
  });

  syncCodegenExecutionStatus(execution.id);

  if (event.status === "failed") {
    const existingBugExecutionId = findExistingCiFailureSpawn({
      sourceExecutionId: execution.id,
      target: event.target,
      provider: event.provider,
      externalRunId: event.externalRunId || undefined,
      branchName: event.branchName,
    });
    if (existingBugExecutionId) {
      return true;
    }

    const bugExecutionId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: event.provider === "ibuild" ? "ibuild_webhook" : "cicd_webhook",
      plane_issue_id: effectivePlaneIssueId,
      input_path: event.logUrl ?? undefined,
    });
    createWorkflowLink({
      source_execution_id: execution.id,
      target_execution_id: bugExecutionId,
      link_type: "spawned_on_ci_failure",
      metadata: {
        target: event.target,
        provider: event.provider,
        external_run_id: event.externalRunId || undefined,
        branch_name: event.branchName ?? undefined,
        payload: event.rawPayload,
      },
    });
    const workspaceId = findLatestDispatchWorkspaceIdByExecution(execution.id) ?? "system";
    dispatchToNanoclaw({
      skill: "arcflow-bug-analysis",
      workspaceId,
      planeIssueId: effectivePlaneIssueId,
      sourceExecutionId: bugExecutionId,
      sourceStage: "analysis_dispatch",
      input: {
        execution_id: bugExecutionId,
        source_execution_id: execution.id,
        workspace_id: workspaceId,
        target: event.target,
        provider: event.provider,
        external_run_id: event.externalRunId || undefined,
        branch_name: event.branchName ?? undefined,
        repo_name: event.target,
        log_url: event.logUrl ?? undefined,
        raw_payload: event.rawPayload,
      },
    });
  }

  return true;
}

export function createWebhookRoutes(deps: WebhookRouteDeps = {}): Hono {
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
      let body: Record<string, unknown> = {};
      try {
        const parsed = await c.req.json();
        body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        body = {};
      }

      recordWebhookLog("git", body);

      const event = parseGitWebhookEvent(body, c.req.raw.headers);
      const classification = classifyGitWebhook(event);

      if (classification.action === "code_merge") {
        const jobId = createWebhookJob({
          source: "git",
          event_type: event.eventType,
          action: "code_merge",
          payload: body,
          max_attempts: 3,
        });
        claimWebhookJob(jobId);
        const result = processGitMergeEvent(event);
        if (result.status === "recorded") {
          finishWebhookJob(jobId, {
            status: "success",
            result: {
              execution_id: result.executionId,
              target: result.target,
              plane_issue_id: result.planeIssueId,
            },
          });
        } else {
          finishWebhookJob(jobId, {
            status: "failed",
            error: result.reason,
            result: {
              target: result.target,
              plane_issue_id: result.planeIssueId,
            },
            retryDelayMs: 0,
          });
        }
        return c.json(
          {
            received: true,
            source: "git",
            action: "code_merge",
            job_id: jobId,
            status: result.status,
            reason: result.status === "unmatched" ? result.reason : undefined,
            repository: event.repository,
            branch: event.merge?.sourceBranch ?? event.branch,
            target: result.target,
            plane_issue_id: result.planeIssueId,
            execution_id: result.status === "recorded" ? result.executionId : undefined,
          },
          200,
        );
      }

      if (classification.action === "ignored") {
        return c.json(
          {
            received: true,
            source: "git",
            action: "ignored",
            reason: classification.reason,
            repository: event.repository,
            ref: event.ref,
            branch: event.branch,
          },
          200,
        );
      }

      const syncDocs = deps.git?.syncDocs;
      if (!syncDocs) {
        return c.json(
          {
            received: true,
            source: "git",
            action: "rag_sync",
            status: "failed",
            reason: "rag_sync_not_configured",
            repository: event.repository,
            ref: event.ref,
            branch: event.branch,
          },
          200,
        );
      }

      try {
        await syncDocs(event);
        return c.json(
          {
            received: true,
            source: "git",
            action: "rag_sync",
            status: "triggered",
            repository: event.repository,
            ref: event.ref,
            branch: event.branch,
          },
          200,
        );
      } catch (error) {
        console.error("[webhook/git] rag sync failed", error);
        return c.json(
          {
            received: true,
            source: "git",
            action: "rag_sync",
            status: "failed",
            reason:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : "rag_sync_failed",
            repository: event.repository,
            ref: event.ref,
            branch: event.branch,
          },
          200,
        );
      }
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
    const planeIssueId = extractIssueIdFromBranch(gitBranch) ?? undefined;
    const targetRepo = config.ibuildAppRepoMap[appKey] ?? appKey ?? "backend";
    const baseEvent: UnifiedCiEvent = {
      planeIssueId,
      target: targetRepo,
      provider: "ibuild",
      externalRunId: buildId,
      branchName: gitBranch || null,
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
