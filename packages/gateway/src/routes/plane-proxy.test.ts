import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      planeWorkspaceSlug: "arcflow",
    }),
}));

import { planeProxyRoutes } from "./plane-proxy";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

const originalFetch = globalThis.fetch;

describe("plane proxy routes", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "admin" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDb();
  });

  const authHeaders = (t: string, wsId?: number) => {
    const h: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (wsId) h["X-Workspace-Id"] = String(wsId);
    return h;
  };

  it("GET /projects returns project list", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ id: "p1", name: "Demo", identifier: "DEM", description: "" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    ) as typeof fetch;

    const res = await planeProxyRoutes.request("/projects", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Demo");
  });

  it("GET /issues/summary returns 404 when no plane project linked", async () => {
    const ws = createWorkspace({ name: "NoPlane", slug: "no-plane" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await planeProxyRoutes.request("/issues/summary", {
      headers: authHeaders(token, ws.id),
    });
    expect(res.status).toBe(404);
  });

  it("GET /issues/summary returns 400 without X-Workspace-Id", async () => {
    const res = await planeProxyRoutes.request("/issues/summary", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it("GET /cycles/active returns 404 when no plane project linked", async () => {
    const ws = createWorkspace({ name: "NoCycle", slug: "no-cycle" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await planeProxyRoutes.request("/cycles/active", {
      headers: authHeaders(token, ws.id),
    });
    expect(res.status).toBe(404);
  });
});
