import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getWorkspaceMemberRole, getWorkspace } from "../db/queries";
import { listProjects, getIssueSummary, getActiveCycles } from "../services/plane";

export const planeProxyRoutes = new Hono();
planeProxyRoutes.use("/*", authMiddleware);

// Settings 在链接 Plane 项目前调用，slug 从 query 传入
planeProxyRoutes.get("/projects", async (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ error: "slug query param required" }, 400);
  try {
    const projects = await listProjects(slug);
    return c.json({ data: projects });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch projects" }, 502);
  }
});

planeProxyRoutes.get("/issues/summary", async (c) => {
  const userId = c.get("userId") as number;
  const wsId = Number(c.req.header("X-Workspace-Id"));
  if (!wsId) return c.json({ error: "X-Workspace-Id required" }, 400);

  const role = getWorkspaceMemberRole(wsId, userId);
  if (!role) return c.json({ error: "Not a workspace member" }, 403);

  const ws = getWorkspace(wsId);
  if (!ws?.plane_project_id) return c.json({ error: "No Plane project linked" }, 404);
  if (!ws.plane_workspace_slug) return c.json({ error: "No Plane workspace slug" }, 404);

  try {
    const summary = await getIssueSummary(ws.plane_workspace_slug, ws.plane_project_id);
    return c.json(summary);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed" }, 502);
  }
});

planeProxyRoutes.get("/cycles/active", async (c) => {
  const userId = c.get("userId") as number;
  const wsId = Number(c.req.header("X-Workspace-Id"));
  if (!wsId) return c.json({ error: "X-Workspace-Id required" }, 400);

  const role = getWorkspaceMemberRole(wsId, userId);
  if (!role) return c.json({ error: "Not a workspace member" }, 403);

  const ws = getWorkspace(wsId);
  if (!ws?.plane_project_id) return c.json({ error: "No Plane project linked" }, 404);
  if (!ws.plane_workspace_slug) return c.json({ error: "No Plane workspace slug" }, 404);

  try {
    const cycles = await getActiveCycles(ws.plane_workspace_slug, ws.plane_project_id);
    return c.json({ data: cycles });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed" }, 502);
  }
});
