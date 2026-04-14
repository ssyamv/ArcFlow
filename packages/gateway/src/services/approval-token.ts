import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { getConfig } from "../config";
import { isApprovalTokenConsumed, markApprovalTokenConsumed } from "../db/queries";

/**
 * Approval token — a short-lived one-shot JWT embedded in Feishu cards so the
 * user can click a link and approve/reject a resource via the Web UI. Since
 * Feishu can't call Gateway directly (outbound-only network), we don't do
 * reverse callbacks — the user's browser opens a link carrying this token,
 * hits the Web confirmation page, which then calls /api/approval/execute.
 */

export type ApprovalAction = "approve" | "reject";

export interface ApprovalTokenPayload {
  user_id: number;
  action: ApprovalAction;
  resource_type: string;
  resource_id: string;
  jti: string;
  exp?: number;
  iat?: number;
}

const TOKEN_TTL_SECONDS = 15 * 60;

export async function signApprovalToken(params: {
  userId: number;
  action: ApprovalAction;
  resourceType: string;
  resourceId: string;
  ttlSeconds?: number;
}): Promise<string> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  const ttl = params.ttlSeconds ?? TOKEN_TTL_SECONDS;
  const jti = randomUUID();
  return new SignJWT({
    user_id: params.userId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret);
}

export type ApprovalVerifyResult =
  | { ok: true; payload: ApprovalTokenPayload }
  | {
      ok: false;
      code: "invalid" | "expired" | "already_consumed" | "malformed";
      message: string;
    };

/**
 * Verify a token without consuming it. Safe to call multiple times (e.g. the
 * confirmation page loads, the user clicks confirm → /execute is called
 * separately).
 */
export async function verifyApprovalToken(token: string): Promise<ApprovalVerifyResult> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  let payload: ApprovalTokenPayload;
  try {
    const res = await jwtVerify(token, secret);
    payload = res.payload as unknown as ApprovalTokenPayload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid";
    if (/exp/i.test(msg)) {
      return { ok: false, code: "expired", message: "token expired" };
    }
    return { ok: false, code: "invalid", message: "invalid token" };
  }

  if (
    typeof payload.user_id !== "number" ||
    !payload.action ||
    !payload.resource_type ||
    !payload.resource_id ||
    !payload.jti
  ) {
    return { ok: false, code: "malformed", message: "missing required claims" };
  }
  if (isApprovalTokenConsumed(payload.jti)) {
    return {
      ok: false,
      code: "already_consumed",
      message: "token already consumed",
    };
  }
  return { ok: true, payload };
}

/**
 * Atomically mark a token consumed. Returns false if it was already consumed
 * (race-safe — relies on UNIQUE constraint).
 */
export function consumeApprovalToken(payload: ApprovalTokenPayload): boolean {
  return markApprovalTokenConsumed({
    jti: payload.jti,
    userId: payload.user_id,
    action: payload.action,
    resourceId: payload.resource_id,
  });
}
