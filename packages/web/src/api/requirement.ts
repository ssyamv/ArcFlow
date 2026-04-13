const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type RequirementDraftStatus = "drafting" | "review" | "approved" | "rejected" | "abandoned";

export interface RequirementDraft {
  id: number;
  workspace_id: number;
  creator_id: number;
  status: RequirementDraftStatus;
  issue_title: string;
  issue_description: string;
  prd_content: string;
  prd_slug: string | null;
  dify_conversation_id: string | null;
  plane_issue_id: string | null;
  prd_git_path: string | null;
  feishu_chat_id: string | null;
  feishu_card_id: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

export interface RequirementDraftListResponse {
  data: RequirementDraft[];
  total: number;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("arcflow_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const wsId = localStorage.getItem("arcflow_workspace_id");
  if (wsId) headers["X-Workspace-Id"] = wsId;
  return headers;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...getHeaders(), ...(options?.headers as Record<string, string>) },
  });
  if (res.status === 401) {
    localStorage.removeItem("arcflow_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return res.json() as Promise<T>;
}

export function createRequirementDraft(params: {
  workspace_id: number;
  feishu_chat_id?: string;
}): Promise<RequirementDraft> {
  return request<RequirementDraft>("/api/requirement/draft", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getRequirementDraft(id: number): Promise<RequirementDraft> {
  return request<RequirementDraft>(`/api/requirement/draft/${id}`);
}

export function listRequirementDrafts(params: {
  workspace_id?: number;
  status?: string;
  limit?: number;
}): Promise<RequirementDraftListResponse> {
  const q = new URLSearchParams();
  if (params.workspace_id) q.set("workspace_id", String(params.workspace_id));
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  return request<RequirementDraftListResponse>(`/api/requirement/drafts?${q}`);
}

export function patchRequirementDraft(
  id: number,
  patch: Partial<{
    issue_title: string;
    issue_description: string;
    prd_content: string;
    status: RequirementDraftStatus;
  }>,
): Promise<RequirementDraft> {
  return request<RequirementDraft>(`/api/requirement/draft/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type SSEChatEvent =
  | { type: "text"; content: string }
  | {
      type: "draft_update";
      issue_title?: string;
      issue_description?: string;
      prd_content?: string;
      prd_slug?: string;
    }
  | { type: "done" }
  | { type: "error"; message: string };

export function streamRequirementChat(
  id: number,
  message: string,
  onEvent: (event: SSEChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem("arcflow_token");
  const wsId = localStorage.getItem("arcflow_workspace_id");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (wsId) headers["X-Workspace-Id"] = wsId;

  return fetch(`${API_BASE}/api/requirement/draft/${id}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
    signal,
  }).then((res) => {
    if (!res.ok) throw new Error(`请求失败: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function pump(): Promise<void> {
      return reader.read().then(({ done, value }) => {
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as SSEChatEvent;
            onEvent(parsed);
          } catch {
            // skip malformed
          }
        }
        return pump();
      });
    }

    return pump();
  });
}
