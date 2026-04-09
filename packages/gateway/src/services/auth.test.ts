import { describe, expect, it, afterEach, mock } from "bun:test";
import { closeDb } from "../db";

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

import { generateOAuthUrl, signJwt, verifyJwt } from "./auth";

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
