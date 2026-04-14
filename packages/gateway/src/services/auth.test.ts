import { describe, expect, it, afterEach, mock } from "bun:test";
import { SignJWT } from "jose";
import { closeDb } from "../db";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      feishuAppSecret: "test-secret",
    }),
}));

import { generateOAuthUrl, signJwt, verifyJwt, resolveUserContext } from "./auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

describe("auth service", () => {
  afterEach(() => {
    closeDb();
  });

  it("generates correct OAuth URL", () => {
    const url = generateOAuthUrl();
    expect(url).toContain("xfchat.iflytek.com");
    expect(url).toContain("open-apis/authen/v1/authorize");
    expect(url).toContain("app_id=test-app-id");
    expect(url).toContain("redirect_uri=");
  });

  it("signs and verifies JWT", async () => {
    const token = await signJwt({ sub: 1, role: "member" });
    expect(typeof token).toBe("string");

    const payload = await verifyJwt(token);
    expect(payload.sub).toBe(1);
    expect(payload.role).toBe("member");
  });

  it("rejects invalid JWT", async () => {
    await expect(verifyJwt("invalid-token")).rejects.toThrow();
  });
});

describe("resolveUserContext", () => {
  afterEach(() => {
    closeDb();
  });

  it("valid token returns user + first workspace context", async () => {
    const user = upsertUser({
      feishu_user_id: "ou_rc_1",
      feishu_union_id: "on_rc_1",
      name: "Ctx User",
      avatar_url: "",
      email: "c@x.cn",
    });
    const ws = createWorkspace({ name: "W1", slug: "w1-rc" });
    addWorkspaceMember(ws.id, user.id, "admin");
    const token = await signJwt({ sub: user.id, role: user.role });

    const ctx = await resolveUserContext(token);
    expect(ctx.userId).toBe(user.id);
    expect(ctx.displayName).toBe("Ctx User");
    expect(ctx.workspaceId).toBe(ws.id);
    expect(ctx.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("expired token throws AUTH_EXPIRED", async () => {
    const secret = new TextEncoder().encode(createTestConfig().jwtSecret);
    const token = await new SignJWT({ sub: 1, role: "member" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    await expect(resolveUserContext(token)).rejects.toThrow("AUTH_EXPIRED");
  });

  it("invalid token throws AUTH_INVALID", async () => {
    await expect(resolveUserContext("garbage.not.jwt")).rejects.toThrow("AUTH_INVALID");
  });

  it("unknown user throws AUTH_INVALID", async () => {
    const token = await signJwt({ sub: 999999, role: "member" });
    await expect(resolveUserContext(token)).rejects.toThrow("AUTH_INVALID");
  });
});
