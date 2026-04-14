const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface ApprovalPayload {
  user_id: number;
  action: "approve" | "reject";
  resource_type: string;
  resource_id: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export type ApprovalVerifyResult =
  | { ok: true; payload: ApprovalPayload }
  | { ok: false; code: string; error: string; status: number };

/** Verify a token (does NOT consume it). Safe to call on page load. */
export async function verifyApproval(token: string): Promise<ApprovalVerifyResult> {
  const res = await fetch(`${API_BASE}/api/approval/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) {
    return { ok: true, payload: body.payload as ApprovalPayload };
  }
  return {
    ok: false,
    code: body.code ?? "unknown",
    error: body.error ?? `HTTP ${res.status}`,
    status: res.status,
  };
}

export type ApprovalExecuteResult =
  | {
      ok: true;
      action: "approve" | "reject";
      resource: { type: string; id: string };
    }
  | { ok: false; code: string; error: string; status: number };

/** Atomically verify + consume + apply the action. Requires user JWT. */
export async function executeApproval(
  token: string,
  userToken: string,
  note?: string,
): Promise<ApprovalExecuteResult> {
  const res = await fetch(`${API_BASE}/api/approval/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ token, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) {
    return {
      ok: true,
      action: body.action,
      resource: body.resource,
    };
  }
  return {
    ok: false,
    code: body.code ?? "unknown",
    error: body.error ?? `HTTP ${res.status}`,
    status: res.status,
  };
}
