import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      planeWorkspaceSlug: "arcflow",
    }),
}));

import { workspaceRoutes } from "./workspaces";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

const originalFetch = globalThis.fetch;

describe("workspace routes", () => {
  let adminToken: string;
  let memberToken: string;
  let adminUserId: number;
  let memberUserId: number;

  beforeEach(async () => {
    getDb();
    const admin = upsertUser({ feishu_user_id: "ou_admin", name: "Admin" });
    const member = upsertUser({ feishu_user_id: "ou_member", name: "Member" });
    adminUserId = admin.id;
    memberUserId = member.id;
    adminToken = await signJwt({ sub: admin.id, role: "admin" });
    memberToken = await signJwt({ sub: member.id, role: "member" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDb();
  });

  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("GET / returns only user's workspaces", async () => {
    const ws1 = createWorkspace({ name: "WS1", slug: "ws1" });
    const ws2 = createWorkspace({ name: "WS2", slug: "ws2" });
    addWorkspaceMember(ws1.id, adminUserId, "admin");
    addWorkspaceMember(ws2.id, memberUserId, "member");

    const res = await workspaceRoutes.request("/", { headers: headers(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].slug).toBe("ws1");
  });

  it("GET /:id returns workspace detail with members", async () => {
    const ws = createWorkspace({ name: "Detail WS", slug: "detail-ws" });
    addWorkspaceMember(ws.id, adminUserId, "admin");
    addWorkspaceMember(ws.id, memberUserId, "member");

    const res = await workspaceRoutes.request(`/${ws.id}`, { headers: headers(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Detail WS");
    expect(body.user_role).toBe("admin");
    expect(body.members.length).toBe(2);
  });

  it("GET /:id returns 404 for non-member", async () => {
    const ws = createWorkspace({ name: "Private WS", slug: "private-ws" });
    addWorkspaceMember(ws.id, adminUserId, "admin");

    const res = await workspaceRoutes.request(`/${ws.id}`, { headers: headers(memberToken) });
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/settings works for admin", async () => {
    const ws = createWorkspace({ name: "Settings WS", slug: "settings-ws" });
    addWorkspaceMember(ws.id, adminUserId, "admin");

    const res = await workspaceRoutes.request(`/${ws.id}/settings`, {
      method: "PATCH",
      headers: { ...headers(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ dify_dataset_id: "ds-123", wiki_path_prefix: "/project-a" }),
    });
    expect(res.status).toBe(200);

    // Verify the update
    const detail = await workspaceRoutes.request(`/${ws.id}`, { headers: headers(adminToken) });
    const body = await detail.json();
    expect(body.dify_dataset_id).toBe("ds-123");
    expect(body.wiki_path_prefix).toBe("/project-a");
  });

  it("PATCH /:id/settings rejected for member", async () => {
    const ws = createWorkspace({ name: "No Edit WS", slug: "noedit-ws" });
    addWorkspaceMember(ws.id, adminUserId, "admin");
    addWorkspaceMember(ws.id, memberUserId, "member");

    const res = await workspaceRoutes.request(`/${ws.id}/settings`, {
      method: "PATCH",
      headers: { ...headers(memberToken), "Content-Type": "application/json" },
      body: JSON.stringify({ dify_dataset_id: "ds-hack" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /sync-plane syncs Plane projects", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [{ id: "proj-100", name: "Gamma", identifier: "GAM" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const res = await workspaceRoutes.request("/sync-plane", {
      method: "POST",
      headers: headers(adminToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
  });

  it("POST /sync-plane returns 500 on error", async () => {
    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;

    const res = await workspaceRoutes.request("/sync-plane", {
      method: "POST",
      headers: headers(adminToken),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Plane API error");
  });
});
