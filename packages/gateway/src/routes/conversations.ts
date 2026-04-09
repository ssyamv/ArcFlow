import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  searchConversations,
  listMessages,
} from "../db/queries";

export const conversationRoutes = new Hono();

conversationRoutes.use("/*", authMiddleware);

conversationRoutes.get("/search", (c) => {
  const userId = c.get("userId") as number;
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ data: [] });
  const data = searchConversations(userId, q);
  return c.json({ data });
});

conversationRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  const data = listConversations(userId);
  return c.json({ data });
});

conversationRoutes.post("/", async (c) => {
  const userId = c.get("userId") as number;
  const body = await c.req.json<{ title?: string }>().catch(() => ({}));
  const conv = createConversation(userId, body.title);
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
