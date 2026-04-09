import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { authMiddleware } from "./auth";
import { workspaceMiddleware } from "./workspace";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

describe("workspace middleware", () => {
  let token: string;
  let userId: number;
  let app: Hono;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_ws_test", name: "WS User" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "member" });

    app = new Hono();
    app.use("/*", authMiddleware);
    app.use("/*", workspaceMiddleware);
    app.get("/test", (c) => {
      return c.json({
        workspaceId: c.get("workspaceId"),
        workspaceRole: c.get("workspaceRole") ?? null,
      });
    });
  });

  afterEach(() => {
    closeDb();
  });

  const headers = (extra?: Record<string, string>) => ({
    Authorization: `Bearer ${token}`,
    ...extra,
  });

  it("passes without workspace header (optional)", async () => {
    const res = await app.request("/test", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBeNull();
  });

  it("extracts workspace from X-Workspace-Id header", async () => {
    const ws = createWorkspace({ name: "Test WS", slug: "test-ws" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await app.request("/test", {
      headers: headers({ "X-Workspace-Id": String(ws.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(ws.id);
    expect(body.workspaceRole).toBe("admin");
  });

  it("extracts workspace from query param", async () => {
    const ws = createWorkspace({ name: "Query WS", slug: "query-ws" });
    addWorkspaceMember(ws.id, userId, "member");

    const res = await app.request(`/test?workspace_id=${ws.id}`, {
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(ws.id);
    expect(body.workspaceRole).toBe("member");
  });

  it("returns 403 if not a member", async () => {
    const ws = createWorkspace({ name: "Private WS", slug: "private-ws" });
    // No membership added

    const res = await app.request("/test", {
      headers: headers({ "X-Workspace-Id": String(ws.id) }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid workspace ID", async () => {
    const res = await app.request("/test", {
      headers: headers({ "X-Workspace-Id": "not-a-number" }),
    });
    expect(res.status).toBe(400);
  });
});
