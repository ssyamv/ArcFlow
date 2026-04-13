import { getConfig } from "../config";
import {
  createRequirementDraft,
  getRequirementDraft,
  getUserById,
  listRequirementDrafts,
  updateRequirementDraft,
  getWorkspaceMemberRole,
} from "../db/queries";
import { streamRequirementChatflow } from "./dify";
import { sendRequirementReviewCard } from "./feishu";
import type { RequirementDraft, RequirementDraftStatus } from "../types";

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
  return createRequirementDraft({
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
  const draft = getRequirementDraft(params.draftId);
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
        const updatePatch: Parameters<typeof updateRequirementDraft>[1] = {};

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
          updateRequirementDraft(params.draftId, updatePatch);
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
  const draft = getRequirementDraft(params.draftId);
  if (!draft) {
    return { ok: false, error: "草稿不存在" };
  }

  if (draft.status !== "drafting" && draft.status !== "review") {
    return { ok: false, error: "当前状态不允许编辑" };
  }

  const memberRole = getWorkspaceMemberRole(draft.workspace_id, params.userId);
  const isCreator = draft.creator_id === params.userId;

  if (!isCreator && !memberRole) {
    return { ok: false, error: "无权限编辑此草稿" };
  }

  updateRequirementDraft(params.draftId, params.patch);
  return { ok: true };
}

export function getDraft(
  draftId: number,
  userId: number,
): { draft: RequirementDraft | null; error?: string } {
  const draft = getRequirementDraft(draftId);
  if (!draft) return { draft: null, error: "草稿不存在" };

  const memberRole = getWorkspaceMemberRole(draft.workspace_id, userId);
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
  return listRequirementDrafts({
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
  const draft = getRequirementDraft(params.draftId);
  if (!draft) {
    return { ok: false, error: "草稿不存在" };
  }

  if (draft.status !== "drafting") {
    return {
      ok: false,
      error: `当前状态 "${draft.status}" 不允许提交 Review，仅 drafting 状态可提交`,
    };
  }

  const memberRole = getWorkspaceMemberRole(draft.workspace_id, params.userId);
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
  updateRequirementDraft(params.draftId, { status: "review" });
  const updated = getRequirementDraft(params.draftId)!;

  // 发飞书卡片（失败不阻塞）
  let feishu_sent = false;
  const config = getConfig();
  const chatId = draft.feishu_chat_id || config.feishuDefaultChatId;

  if (chatId) {
    try {
      const creator = getUserById(draft.creator_id);
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
        updateRequirementDraft(params.draftId, { feishu_card_id: result.card_id });
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
