import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      feishuAppSecret: "test-secret",
    }),
}));

import { SignJWT } from "jose";
import { authRoutes } from "./auth";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

describe("auth routes", () => {
  beforeEach(() => {
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("GET /feishu redirects to OAuth URL", async () => {
    const res = await authRoutes.request("/feishu", { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("xfchat.iflytek.com");
    expect(location).toContain("authorize");
  });

  it("GET /api/auth/me returns 401 without token", async () => {
    const res = await authRoutes.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns user with valid token", async () => {
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test User" });
    const token = await signJwt({ sub: user.id, role: "member" });
    const res = await authRoutes.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test User");
  });

  it("POST /auth/verify returns user context with valid bearer", async () => {
    const user = upsertUser({ feishu_user_id: "ou_v1", name: "Verify User" });
    const ws = createWorkspace({ name: "WV", slug: "wv-verify" });
    addWorkspaceMember(ws.id, user.id, "admin");
    const token = await signJwt({ sub: user.id, role: "member" });
    const res = await authRoutes.request("/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.userId).toBe(user.id);
    expect(body.data.workspaceId).toBe(ws.id);
    expect(body.data.displayName).toBe("Verify User");
  });

  it("POST /auth/verify returns 401 AUTH_INVALID when bearer missing", async () => {
    const res = await authRoutes.request("/auth/verify", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("AUTH_INVALID");
  });

  it("POST /auth/verify returns 401 AUTH_EXPIRED on expired token", async () => {
    const secret = new TextEncoder().encode(createTestConfig().jwtSecret);
    const token = await new SignJWT({ sub: 1, role: "member" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    const res = await authRoutes.request("/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("AUTH_EXPIRED");
  });
});
