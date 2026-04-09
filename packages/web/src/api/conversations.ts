const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const wsId = localStorage.getItem("arcflow_workspace_id");
  if (wsId) headers["X-Workspace-Id"] = wsId;
  return headers;
}

export interface Conversation {
  id: number;
  user_id: number;
  workspace_id: number | null;
  title: string;
  pinned: number;
  dify_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function fetchConversations(): Promise<{ data: Conversation[] }> {
  const res = await fetch(`${API_BASE}/api/conversations`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load conversations");
  return res.json();
}

export async function createConversation(title?: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function updateConversation(
  id: number,
  patch: { title?: string; pinned?: number },
): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
}

export async function deleteConversation(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function fetchMessages(conversationId: number): Promise<{ data: Message[] }> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
}

export async function searchConversations(query: string): Promise<{ data: Conversation[] }> {
  const res = await fetch(`${API_BASE}/api/conversations/search?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}
