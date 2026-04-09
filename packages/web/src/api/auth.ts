const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface User {
  id: number;
  feishu_user_id: string;
  name: string;
  avatar_url: string | null;
  email: string | null;
  role: "admin" | "member";
  created_at: string;
  last_login_at: string | null;
}

export async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Unauthorized");
  return res.json();
}
