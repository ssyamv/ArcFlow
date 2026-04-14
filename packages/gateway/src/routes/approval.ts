import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  consumeApprovalToken,
  verifyApprovalToken,
  type ApprovalAction,
} from "../services/approval-token";
import { getDb } from "../db";
import { getWorkspaceMemberRole, recordUserAction, updateRequirementDraft } from "../db/queries";

export const approvalRoutes = new Hono();

/**
 * POST /api/approval/verify
 * Body: { token: string }
 *
 * Verify an approval token without consuming it. The Web confirmation page
 * calls this on load so it can show the user what they're about to approve.
 * Does NOT require user auth — the token itself is the bearer of identity.
 */
approvalRoutes.post("/verify", async (c) => {
  const { token } = (await c.req.json<{ token?: string }>()) ?? {};
  if (!token) return c.json({ ok: false, error: "token is required" }, 400);

  const result = await verifyApprovalToken(token);
  if (!result.ok) {
    const status = result.code === "expired" || result.code === "already_consumed" ? 410 : 400;
    return c.json({ ok: false, code: result.code, error: result.message }, status);
  }
  return c.json({ ok: true, payload: result.payload });
});

/**
 * POST /api/approval/execute
 * Headers: Authorization: Bearer <user JWT>
 * Body: { token: string, note?: string }
 *
 * Atomically verify + consume an approval token and apply its action. Requires
 * the caller's user JWT to match the token's user_id (so the same user who
 * received the Feishu card must be the one clicking through).
 */
approvalRoutes.post("/execute", authMiddleware, async (c) => {
  const callerUserId = Number(c.get("userId"));
  const { token, note } =
    (await c.req.json<{
      token?: string;
      note?: string;
    }>()) ?? {};
  if (!token) return c.json({ ok: false, error: "token is required" }, 400);

  const result = await verifyApprovalToken(token);
  if (!result.ok) {
    const status = result.code === "expired" || result.code === "already_consumed" ? 410 : 400;
    return c.json({ ok: false, code: result.code, error: result.message }, status);
  }
  const payload = result.payload;

  if (payload.user_id !== callerUserId) {
    return c.json(
      {
        ok: false,
        code: "user_mismatch",
        error: "token user does not match caller",
      },
      403,
    );
  }

  // Consume first so racing double-click / double-submit can't both execute.
  if (!consumeApprovalToken(payload)) {
    return c.json(
      {
        ok: false,
        code: "already_consumed",
        error: "token already consumed",
      },
      410,
    );
  }

  const outcome = await applyApproval(payload.resource_type, payload.resource_id, {
    action: payload.action,
    userId: callerUserId,
    note,
  });

  if (!outcome.ok) {
    return c.json(
      {
        ok: false,
        code: "apply_failed",
        error: outcome.error,
      },
      outcome.status,
    );
  }

  recordUserAction({
    userId: callerUserId,
    workspaceId: outcome.workspaceId,
    actionType: `approval.${payload.action}.${payload.resource_type}`,
    payload: {
      resource_id: payload.resource_id,
      note,
      via: "feishu_link",
    },
  });

  return c.json({
    ok: true,
    action: payload.action,
    resource: {
      type: payload.resource_type,
      id: payload.resource_id,
    },
  });
});

/**
 * Dispatch table for approval resources. Add new resource types here when
 * more card flows need cross-channel approval.
 */
async function applyApproval(
  resourceType: string,
  resourceId: string,
  ctx: { action: ApprovalAction; userId: number; note?: string },
): Promise<
  | { ok: true; workspaceId: number | null }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string }
> {
  if (resourceType === "requirement_draft") {
    const draftId = Number(resourceId);
    if (!Number.isFinite(draftId)) {
      return { ok: false, status: 400, error: "invalid draft id" };
    }
    const draft = getDb()
      .query(
        `SELECT id, workspace_id, creator_id, status
         FROM requirement_drafts WHERE id = ?`,
      )
      .get(draftId) as {
      id: number;
      workspace_id: number;
      creator_id: number;
      status: string;
    } | null;
    if (!draft) {
      return { ok: false, status: 404, error: "draft not found" };
    }
    if (draft.status !== "review" && draft.status !== "drafting") {
      return {
        ok: false,
        status: 400,
        error: `draft status ${draft.status} not approvable`,
      };
    }
    const role = getWorkspaceMemberRole(draft.workspace_id, ctx.userId);
    if (!role && draft.creator_id !== ctx.userId) {
      return { ok: false, status: 403, error: "not a workspace member" };
    }
    const newStatus = ctx.action === "approve" ? "approved" : "rejected";
    const ok = updateRequirementDraft(draftId, { status: newStatus });
    if (!ok) {
      return { ok: false, status: 500, error: "update failed" };
    }
    return { ok: true, workspaceId: draft.workspace_id };
  }
  return {
    ok: false,
    status: 400,
    error: `unsupported resource_type: ${resourceType}`,
  };
}
