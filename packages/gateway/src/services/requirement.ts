import { getConfig } from "../config";
import { streamRequirementChatflow } from "./dify";
import { sendRequirementReviewCard, updateCard } from "./feishu";
import * as gitSvc from "./git";
import * as planeSvc from "./plane";
import type { RequirementDraft, RequirementDraftStatus } from "../types";

// Use a lazy getter resolved at call time to avoid binding issues.
// Uses __dirname-based absolute path so Bun test's mock.module("../db/queries")
// (which registers a relative-path key) does NOT intercept this require —
// tests that need to override individual functions should use spyOn on the
// module object returned by `await import("../db/queries")`.
const _dbQueriesPath = `${__dirname}/../db/queries`;
function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(_dbQueriesPath) as typeof import("../db/queries");
}

// ─── Parser ────────────────────────────────────────────────────────────────────

const REQUIREMENT_DRAFT_MARKER_START = "<REQUIREMENT_DRAFT>";
const REQUIREMENT_DRAFT_MARKER_END = "</REQUIREMENT_DRAFT>";

export interface RequirementDraftPayload {
  reply: string;
  ready: boolean;
  draft?: {
    issue_title: string;
    issue_description: string;
    prd_content: string;
    prd_slug?: string;
  };
}

export function extractRequirementDraft(answer: string): RequirementDraftPayload | null {
  const startIdx = answer.indexOf(REQUIREMENT_DRAFT_MARKER_START);
  const endIdx = answer.indexOf(REQUIREMENT_DRAFT_MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const jsonStr = answer.slice(startIdx + REQUIREMENT_DRAFT_MARKER_START.length, endIdx).trim();
  try {
    const parsed = JSON.parse(jsonStr) as RequirementDraftPayload;
    return {
      reply: parsed.reply ?? "",
      ready: parsed.ready ?? false,
      draft: parsed.draft,
    };
  } catch {
    return null;
  }
}

export function containsRequirementMarker(text: string): boolean {
  return text.includes(REQUIREMENT_DRAFT_MARKER_START);
}

// ─── Service ───────────────────────────────────────────────────────────────────

export function createDraft(params: {
  workspaceId: number;
  creatorId: number;
  feishuChatId?: string;
}): RequirementDraft {
  return getDb().createRequirementDraft({
    workspace_id: params.workspaceId,
    creator_id: params.creatorId,
    feishu_chat_id: params.feishuChatId,
  });
}

export async function* chatDraft(params: {
  draftId: number;
  userId: number;
  message: string;
}): AsyncGenerator<{ event: string; data: string }> {
  const draft = getDb().getRequirementDraft(params.draftId);
  if (!draft) {
    yield { event: "error", data: JSON.stringify({ message: "草稿不存在" }) };
    return;
  }

  const config = getConfig();
  if (!config.difyRequirementChatApiKey) {
    yield { event: "error", data: JSON.stringify({ message: "requirement chat not configured" }) };
    return;
  }

  let fullAnswer = "";
  let convId = draft.dify_conversation_id ?? "";
  let markerDetected = false;

  try {
    for await (const chunk of streamRequirementChatflow({
      query: params.message,
      conversationId: draft.dify_conversation_id ?? undefined,
      userId: String(params.userId),
      workspaceId: draft.workspace_id,
      apiKey: config.difyRequirementChatApiKey,
      baseUrl: config.difyBaseUrl,
    })) {
      if (chunk.event === "message" && chunk.answer) {
        convId = convId || chunk.conversation_id || "";
        fullAnswer += chunk.answer;

        if (markerDetected) continue;

        if (containsRequirementMarker(fullAnswer)) {
          markerDetected = true;
          continue;
        }

        yield {
          event: "message",
          data: JSON.stringify({
            type: "text",
            content: chunk.answer,
            conversation_id: convId,
          }),
        };
      }

      if (chunk.event === "message_end") {
        const parsed = extractRequirementDraft(fullAnswer);
        const updatePatch: Parameters<typeof db.updateRequirementDraft>[1] = {};

        if (convId) {
          updatePatch.dify_conversation_id = convId;
        }

        if (parsed?.draft) {
          updatePatch.issue_title = parsed.draft.issue_title;
          updatePatch.issue_description = parsed.draft.issue_description;
          updatePatch.prd_content = parsed.draft.prd_content;
          if (parsed.draft.prd_slug) {
            updatePatch.prd_slug = parsed.draft.prd_slug;
          }
        }

        if (Object.keys(updatePatch).length > 0) {
          getDb().updateRequirementDraft(params.draftId, updatePatch);
        }

        yield {
          event: "message_end",
          data: JSON.stringify({
            conversation_id: convId,
            ready: parsed?.ready ?? false,
            draft: parsed?.draft ?? null,
          }),
        };
      }
    }
  } catch (err) {
    yield {
      event: "error",
      data: JSON.stringify({
        message: `对话失败: ${err instanceof Error ? err.message : "未知错误"}`,
      }),
    };
  }
}

export function patchDraft(params: {
  draftId: number;
  userId: number;
  patch: {
    issue_title?: string;
    issue_description?: string;
    prd_content?: string;
  };
}): { ok: boolean; error?: string } {
  const draft = getDb().getRequirementDraft(params.draftId);
  if (!draft) {
    return { ok: false, error: "草稿不存在" };
  }

  if (draft.status !== "drafting" && draft.status !== "review") {
    return { ok: false, error: "当前状态不允许编辑" };
  }

  const memberRole = getDb().getWorkspaceMemberRole(draft.workspace_id, params.userId);
  const isCreator = draft.creator_id === params.userId;

  if (!isCreator && !memberRole) {
    return { ok: false, error: "无权限编辑此草稿" };
  }

  getDb().updateRequirementDraft(params.draftId, params.patch);
  return { ok: true };
}

export function getDraft(
  draftId: number,
  userId: number,
): { draft: RequirementDraft | null; error?: string } {
  const draft = getDb().getRequirementDraft(draftId);
  if (!draft) return { draft: null, error: "草稿不存在" };

  const memberRole = getDb().getWorkspaceMemberRole(draft.workspace_id, userId);
  const isCreator = draft.creator_id === userId;

  if (!isCreator && !memberRole) {
    return { draft: null, error: "无权限访问此草稿" };
  }

  return { draft };
}

export function listDrafts(params: {
  workspaceId?: number;
  userId?: number;
  status?: RequirementDraftStatus;
  limit?: number;
}): RequirementDraft[] {
  return getDb().listRequirementDrafts({
    workspace_id: params.workspaceId,
    creator_id: params.userId,
    status: params.status,
    limit: params.limit,
  });
}

export async function finalizeDraft(params: {
  draftId: number;
  userId: number;
}): Promise<{ ok: boolean; error?: string; draft?: RequirementDraft; feishu_sent?: boolean }> {
  const draft = getDb().getRequirementDraft(params.draftId);
  if (!draft) {
    return { ok: false, error: "草稿不存在" };
  }

  if (draft.status !== "drafting") {
    return {
      ok: false,
      error: `当前状态 "${draft.status}" 不允许提交 Review，仅 drafting 状态可提交`,
    };
  }

  const memberRole = getDb().getWorkspaceMemberRole(draft.workspace_id, params.userId);
  const isCreator = draft.creator_id === params.userId;
  if (!isCreator && !memberRole) {
    return { ok: false, error: "无权限操作此草稿" };
  }

  // 校验草稿内容非空且 prd_content 长度 > 50
  const hasPrdContent = draft.prd_content && draft.prd_content.length > 50;
  const hasBasicInfo = draft.issue_title || draft.issue_description;
  if (!hasPrdContent && !hasBasicInfo) {
    return {
      ok: false,
      error: "草稿内容不足，请先完成 PRD 内容（至少需要标题、描述或不少于50字的PRD正文）",
    };
  }
  if (!hasPrdContent) {
    return { ok: false, error: "PRD 正文内容不足（至少需要50个字符），请先完善 PRD 内容" };
  }

  // 状态切换到 review
  getDb().updateRequirementDraft(params.draftId, { status: "review" });
  const updated = getDb().getRequirementDraft(params.draftId)!;

  // 发飞书卡片（失败不阻塞）
  let feishu_sent = false;
  const config = getConfig();
  const chatId = draft.feishu_chat_id || config.feishuDefaultChatId;

  if (chatId) {
    try {
      const creator = getDb().getUserById(draft.creator_id);
      const creatorName = creator?.name || `用户 ${draft.creator_id}`;
      const summary = (draft.prd_content || draft.issue_description || "")
        .slice(0, 100)
        .replace(/\n/g, " ");

      const result = await sendRequirementReviewCard({
        chatId,
        draftId: params.draftId,
        title: draft.issue_title || "（无标题）",
        summary,
        creatorName,
        webBaseUrl: config.webBaseUrl,
      });

      if (result.ok) {
        feishu_sent = true;
        getDb().updateRequirementDraft(params.draftId, { feishu_card_id: result.card_id });
      } else {
        console.warn(`[finalizeDraft] 飞书卡片发送失败: ${result.error}`);
      }
    } catch (err) {
      console.warn(`[finalizeDraft] 飞书卡片发送异常: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.warn("[finalizeDraft] 无飞书 chat_id，跳过卡片发送");
  }

  return { ok: true, draft: updated, feishu_sent };
}

// ─── Stage D: Approve Draft ────────────────────────────────────────────────────

function safeParseRepos(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function wsRepoName(workspaceId: number, repo: string): string {
  return `ws-${workspaceId}-${repo}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export async function approveDraft(params: {
  draftId: number;
  userId?: number;
  source: "web" | "feishu";
}): Promise<
  | { ok: true; draft: RequirementDraft; warning?: string }
  | { ok: false; error: string; step?: string }
> {
  const draft = getDb().getRequirementDraft(params.draftId);
  if (!draft) {
    return { ok: false, error: "草稿不存在", step: "load" };
  }

  // 状态机：只允许 review → approved
  if (draft.status !== "review") {
    return {
      ok: false,
      error: `当前状态 "${draft.status}" 不允许审批，仅 review 状态可审批`,
      step: "state_check",
    };
  }

  // 权限校验（飞书回调信任，跳过）
  if (params.source === "web" && params.userId) {
    const memberRole = getDb().getWorkspaceMemberRole(draft.workspace_id, params.userId);
    const isCreator = draft.creator_id === params.userId;
    if (!isCreator && !memberRole) {
      return { ok: false, error: "无权限审批此草稿", step: "auth" };
    }
  }

  // 加载工作空间
  const ws = getDb().getWorkspace(draft.workspace_id);
  if (!ws) {
    return { ok: false, error: `工作空间 ${draft.workspace_id} 不存在`, step: "prereq" };
  }

  if (!ws.plane_project_id || !ws.plane_workspace_slug) {
    return {
      ok: false,
      error:
        "工作空间未配置 Plane 项目（plane_project_id / plane_workspace_slug），请先在工作空间设置中完善",
      step: "prereq",
    };
  }

  const planeSlug = ws.plane_workspace_slug;
  const planeProjectId = ws.plane_project_id;

  // 注册工作空间仓库
  const repos = safeParseRepos(ws.git_repos ?? "{}");
  for (const [name, url] of Object.entries(repos)) {
    if (url) gitSvc.registerRepoUrl(wsRepoName(ws.id, name), url);
  }

  const config = getConfig();
  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 生成 prd slug
  const prdSlug =
    draft.prd_slug || (draft.issue_title ? slugify(draft.issue_title) : `prd-${draft.id}`);
  const prdGitPath = `prd/${monthDir}/${prdSlug}.md`;
  const prdContent =
    draft.prd_content || `# ${draft.issue_title || "PRD"}\n\n${draft.issue_description || ""}`;

  // Step 1: Commit PRD to docs git
  const docsRepo = wsRepoName(ws.id, "docs");
  try {
    await gitSvc.ensureRepo(docsRepo);
    await gitSvc.writeAndPush(
      docsRepo,
      prdGitPath,
      prdContent,
      `docs: AI 生成 PRD - ${draft.issue_title || prdSlug}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[approveDraft] Step1 git commit failed: ${msg}`);
    return { ok: false, error: `Git 写入失败: ${msg}`, step: "git_commit" };
  }

  // Step 2: Create Plane Issue
  let planeIssueId: string;
  try {
    const issue = await planeSvc.createIssue(planeSlug, planeProjectId, {
      name: draft.issue_title || prdSlug,
      description_html: draft.issue_description
        ? `<p>${draft.issue_description.replace(/\n/g, "</p><p>")}</p>`
        : undefined,
      priority: "medium",
    });
    planeIssueId = issue.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[approveDraft] Step2 createIssue failed: ${msg}`);
    return { ok: false, error: `创建 Plane Issue 失败: ${msg}`, step: "create_issue" };
  }

  // Step 3: Update draft in DB
  getDb().updateRequirementDraft(params.draftId, {
    plane_issue_id: planeIssueId,
    prd_git_path: prdGitPath,
    status: "approved",
  });

  const updatedDraft = getDb().getRequirementDraft(params.draftId)!;
  let warning: string | undefined;

  // Step 4: Update Plane issue state to Approved (optional)
  if (config.planeApprovedStateId) {
    try {
      await planeSvc.updateIssueState(
        planeSlug,
        planeProjectId,
        planeIssueId,
        config.planeApprovedStateId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[approveDraft] Step4 updateIssueState failed (non-fatal): ${msg}`);
      warning = `Plane 状态更新失败（不影响审批结果）: ${msg}`;
    }
  } else {
    console.warn("[approveDraft] Step4 skipped: PLANE_APPROVED_STATE_ID not configured");
  }

  // Step 5: Update Feishu card
  if (draft.feishu_card_id) {
    const planeIssueUrl = config.planeExternalUrl
      ? `${config.planeExternalUrl.replace(/\/$/, "")}/workspaces/${planeSlug}/projects/${planeProjectId}/issues/${planeIssueId}/`
      : null;

    const cardElements: unknown[] = [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**标题：** ${draft.issue_title || "（无标题）"}\n\n✅ 已通过，技术设计生成中…\n\n**PRD 路径：** \`${prdGitPath}\``,
        },
      },
    ];

    if (planeIssueUrl) {
      cardElements.push({
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "查看 Plane Issue" },
            type: "primary",
            url: planeIssueUrl,
          },
        ],
      });
    }

    const approvedCard = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "✅ 需求 PRD 已通过审批" },
        template: "green",
      },
      elements: cardElements,
    };

    updateCard(draft.feishu_card_id, approvedCard).catch((err) => {
      console.warn(
        `[approveDraft] Step5 updateCard failed (non-fatal): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  return { ok: true, draft: updatedDraft, warning };
}
