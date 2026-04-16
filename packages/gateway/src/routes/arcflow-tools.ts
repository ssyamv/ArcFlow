import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import * as queries from "../db/queries";
import { authMiddleware as defaultAuthMiddleware } from "../middleware/auth";
import { workspaceMiddleware as defaultWorkspaceMiddleware } from "../middleware/workspace";
import { registerRepoUrl as defaultRegisterRepoUrl } from "../services/git";
import { listIssuesByAssignee as defaultListIssuesByAssignee } from "../services/plane";
import {
  createRequirementDraftService,
  type CreateRequirementDraftInput,
} from "../services/requirement-draft";

export interface ArcflowToolRouteDeps {
  authMiddleware: MiddlewareHandler;
  workspaceMiddleware: MiddlewareHandler;
  getUserById: typeof queries.getUserById;
  getWorkspace: typeof queries.getWorkspace;
  listIssuesByAssignee: typeof defaultListIssuesByAssignee;
  createRequirementDraft: (input: CreateRequirementDraftInput) => Promise<unknown>;
  registerRepoUrl: typeof defaultRegisterRepoUrl;
}

function defaultDeps(): ArcflowToolRouteDeps {
  const draftService = createRequirementDraftService();
  return {
    authMiddleware: defaultAuthMiddleware,
    workspaceMiddleware: defaultWorkspaceMiddleware,
    getUserById: queries.getUserById,
    getWorkspace: queries.getWorkspace,
    listIssuesByAssignee: defaultListIssuesByAssignee,
    createRequirementDraft: draftService.createDraft,
    registerRepoUrl: defaultRegisterRepoUrl,
  };
}

function getWorkspaceDocsRepo(gitRepos: string): {
  repoName: string | null;
  repoUrl: string | null;
} {
  try {
    const repos = JSON.parse(gitRepos || "{}") as { docs?: string };
    return {
      repoName: repos.docs ? null : null,
      repoUrl: repos.docs ?? null,
    };
  } catch {
    return { repoName: null, repoUrl: null };
  }
}

export function createArcflowToolRoutes(overrides?: Partial<ArcflowToolRouteDeps>): Hono {
  const deps = { ...defaultDeps(), ...overrides };
  const app = new Hono();

  app.use("/*", deps.authMiddleware, deps.workspaceMiddleware);

  app.get("/issues", async (c) => {
    const userId = Number(c.get("userId"));
    const workspaceId = Number(c.get("workspaceId"));
    const user = deps.getUserById(userId);
    const workspace = deps.getWorkspace(workspaceId);

    if (!user?.email || !workspace?.plane_workspace_slug || !workspace.plane_project_id) {
      return c.json({ items: [] });
    }

    const items = await deps.listIssuesByAssignee(
      workspace.plane_workspace_slug,
      workspace.plane_project_id,
      user.email,
    );
    return c.json({ items });
  });

  app.post("/requirements/drafts", async (c) => {
    const workspaceId = Number(c.get("workspaceId"));
    const workspace = deps.getWorkspace(workspaceId);
    if (!workspace) return c.json({ error: "workspace not found" }, 404);

    const { repoUrl } = getWorkspaceDocsRepo(workspace.git_repos);
    const repoName = `ws-${workspace.id}-docs`;
    if (repoUrl) deps.registerRepoUrl(repoName, repoUrl);

    const body = await c.req.json<{ title: string; content: string; dryRun?: boolean }>();
    const result = await deps.createRequirementDraft({
      workspaceSlug: workspace.slug,
      repoName,
      title: body.title,
      content: body.content,
      dryRun: body.dryRun !== false,
    });
    return c.json(result, (result as { mode?: string }).mode === "created" ? 201 : 200);
  });

  return app;
}

export const arcflowToolRoutes = createArcflowToolRoutes();
