import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  searchConversations,
  listMessages,
  createMessage,
} from "../db/queries";

export const conversationRoutes = new Hono();

conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", workspaceMiddleware);

conversationRoutes.get("/search", (c) => {
  const userId = c.get("userId") as number;
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ data: [] });
  const data = searchConversations(userId, q);
  return c.json({ data });
});

conversationRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  const data = listConversations(userId, c.get("workspaceId") as number | null);
  return c.json({ data });
});

conversationRoutes.post("/", async (c) => {
  const userId = c.get("userId") as number;
  const body = await c.req.json<{ title?: string }>().catch(() => ({}));
  const conv = createConversation(userId, body.title, c.get("workspaceId") as number | null);
  return c.json(conv, 201);
});

conversationRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ title?: string; pinned?: number }>();
  const ok = updateConversation(id, userId, body);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

conversationRoutes.delete("/:id", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const ok = deleteConversation(id, userId);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

conversationRoutes.get("/:id/messages", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const conv = getConversation(id, userId);
  if (!conv) return c.json({ error: "Not found" }, 404);
  const data = listMessages(id);
  return c.json({ data });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const conv = getConversation(id, userId);
  if (!conv) return c.json({ error: "Not found" }, 404);
  const body = await c.req
    .json<{ role?: "user" | "assistant"; content?: string }>()
    .catch(() => ({}) as { role?: "user" | "assistant"; content?: string });
  const role = body.role;
  const content = typeof body.content === "string" ? body.content : "";
  if ((role !== "user" && role !== "assistant") || !content.trim()) {
    return c.json({ error: "Invalid role or content" }, 400);
  }
  const msg = createMessage(id, role, content);
  return c.json(msg, 201);
});
