import type { MiddlewareHandler } from "hono";
import { getWorkspaceMemberRole } from "../db/queries";

export const workspaceMiddleware: MiddlewareHandler = async (c, next) => {
  const wsId = c.req.header("X-Workspace-Id") || c.req.query("workspace_id");

  if (!wsId) {
    c.set("workspaceId", null);
    await next();
    return;
  }

  const workspaceId = Number(wsId);
  if (isNaN(workspaceId)) return c.json({ error: "Invalid workspace ID" }, 400);

  const userId = c.get("userId") as number;
  const role = getWorkspaceMemberRole(workspaceId, userId);
  if (!role) return c.json({ error: "Not a member of this workspace" }, 403);

  c.set("workspaceId", workspaceId);
  c.set("workspaceRole", role);
  await next();
};
