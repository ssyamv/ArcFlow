import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  listUserWorkspaces,
  getWorkspace,
  updateWorkspaceSettings,
  getWorkspaceMemberRole,
  listWorkspaceMembers,
  createWorkspace,
  addWorkspaceMember,
} from "../db/queries";

export const workspaceRoutes = new Hono();
workspaceRoutes.use("/*", authMiddleware);

workspaceRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  return c.json({ data: listUserWorkspaces(userId) });
});

workspaceRoutes.post("/", async (c) => {
  const userId = c.get("userId") as number;
  const body = await c.req.json<{ name?: string; slug?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const slug = (body.slug?.trim() || name)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return c.json({ error: "invalid slug" }, 400);
  const workspace = createWorkspace({ name, slug });
  addWorkspaceMember(workspace.id, userId, "admin");
  return c.json(workspace, 201);
});

workspaceRoutes.get("/:id", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const role = getWorkspaceMemberRole(id, userId);
  if (!role) return c.json({ error: "Not found" }, 404);
  const workspace = getWorkspace(id);
  const members = listWorkspaceMembers(id);
  return c.json({ ...workspace, members, user_role: role });
});

workspaceRoutes.patch("/:id/settings", async (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const role = getWorkspaceMemberRole(id, userId);
  if (role !== "admin") return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json();
  updateWorkspaceSettings(id, body);
  return c.json({ ok: true });
});
