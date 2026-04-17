import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createArcflowToolRoutes } from "./arcflow-tools";

const fakeAuth: MiddlewareHandler = async (c, next) => {
  c.set("userId", 7);
  c.set("userRole", "member");
  await next();
};

const fakeWorkspace: MiddlewareHandler = async (c, next) => {
  c.set("workspaceId", 1);
  c.set("workspaceRole", "member");
  await next();
};

describe("arcflow tool routes", () => {
  it("GET /api/arcflow/issues returns issues assigned to current user email", async () => {
    const listIssuesByAssignee = mock(async () => [{ id: "ISS-1", name: "Need review" }]);
    const app = new Hono().route(
      "/api/arcflow",
      createArcflowToolRoutes({
        authMiddleware: fakeAuth,
        workspaceMiddleware: fakeWorkspace,
        getUserById: () =>
          ({
            id: 7,
            email: "me@example.com",
          }) as never,
        getWorkspace: () =>
          ({
            id: 1,
            slug: "acme",
            plane_workspace_slug: "acme",
            plane_project_id: "p1",
          }) as never,
        listIssuesByAssignee,
      }),
    );

    const res = await app.request("/api/arcflow/issues");
    expect(res.status).toBe(200);
    expect(listIssuesByAssignee).toHaveBeenCalledWith("acme", "p1", "me@example.com");
    const body = await res.json();
    expect(body.items[0].id).toBe("ISS-1");
  });

  it("GET /api/arcflow/issues returns empty list when workspace is not configured for Plane", async () => {
    const listIssuesByAssignee = mock(async () => [{ id: "ISS-1", name: "Need review" }]);
    const app = new Hono().route(
      "/api/arcflow",
      createArcflowToolRoutes({
        authMiddleware: fakeAuth,
        workspaceMiddleware: fakeWorkspace,
        getUserById: () =>
          ({
            id: 7,
            email: "me@example.com",
          }) as never,
        getWorkspace: () =>
          ({
            id: 1,
            slug: "acme",
          }) as never,
        listIssuesByAssignee,
      }),
    );

    const res = await app.request("/api/arcflow/issues");
    expect(res.status).toBe(200);
    expect(listIssuesByAssignee).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ items: [] });
  });

  it("POST /api/arcflow/requirements/drafts defaults to dryRun", async () => {
    const createRequirementDraft = mock(async () => ({
      mode: "dry_run",
      path: "requirements/2026-04/demo.md",
      preview: "# Demo",
    }));
    const registerRepoUrl = mock(() => undefined);
    const app = new Hono().route(
      "/api/arcflow",
      createArcflowToolRoutes({
        authMiddleware: fakeAuth,
        workspaceMiddleware: fakeWorkspace,
        registerRepoUrl,
        getWorkspace: () =>
          ({
            id: 1,
            slug: "acme",
            git_repos: JSON.stringify({ docs: "https://example.com/acme-docs.git" }),
          }) as never,
        createRequirementDraft,
      }),
    );

    const res = await app.request("/api/arcflow/requirements/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "统一登录改造",
        content: "需要支持 SSO 与权限分级",
      }),
    });

    expect(res.status).toBe(200);
    expect(createRequirementDraft).toHaveBeenCalledWith({
      workspaceSlug: "acme",
      repoName: "ws-1-docs",
      title: "统一登录改造",
      content: "需要支持 SSO 与权限分级",
      dryRun: true,
    });
    expect(registerRepoUrl).toHaveBeenCalledWith("ws-1-docs", "https://example.com/acme-docs.git");
  });

  it("POST /api/arcflow/requirements/drafts returns 201 when draft is created", async () => {
    const createRequirementDraft = mock(async () => ({
      mode: "created",
      path: "requirements/2026-04/demo.md",
      preview: "# Demo",
    }));
    const app = new Hono().route(
      "/api/arcflow",
      createArcflowToolRoutes({
        authMiddleware: fakeAuth,
        workspaceMiddleware: fakeWorkspace,
        getWorkspace: () =>
          ({
            id: 1,
            slug: "acme",
            git_repos: JSON.stringify({ docs: "https://example.com/acme-docs.git" }),
          }) as never,
        createRequirementDraft,
      }),
    );

    const res = await app.request("/api/arcflow/requirements/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "统一登录改造",
        content: "需要支持 SSO 与权限分级",
        dryRun: false,
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      mode: "created",
      path: "requirements/2026-04/demo.md",
      preview: "# Demo",
    });
  });
});
