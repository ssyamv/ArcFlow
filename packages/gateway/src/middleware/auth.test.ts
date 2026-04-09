import { describe, expect, it, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { closeDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { authMiddleware } from "./auth";
import { signJwt } from "../services/auth";

describe("auth middleware", () => {
  afterEach(() => {
    closeDb();
  });

  function createTestApp() {
    const app = new Hono();
    app.use("/*", authMiddleware);
    app.get("/test", (c) => c.json({ userId: c.get("userId"), role: c.get("userRole") }));
    return app;
  }

  it("returns 401 when no Authorization header", async () => {
    const app = createTestApp();
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid token", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid" },
    });
    expect(res.status).toBe(401);
  });

  it("passes with valid token and sets context", async () => {
    const app = createTestApp();
    const token = await signJwt({ sub: 42, role: "member" });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(42);
    expect(body.role).toBe("member");
  });
});
