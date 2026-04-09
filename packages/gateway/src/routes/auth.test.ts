import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    feishuBaseUrl: "https://xfchat.iflytek.com",
    feishuAppId: "test-app-id",
    feishuAppSecret: "test-secret",
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
    oauthRedirectUri: "http://localhost:5173/auth/callback",
  }),
}));

import { authRoutes } from "./auth";
import { signJwt } from "../services/auth";
import { upsertUser } from "../db/queries";

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
});
