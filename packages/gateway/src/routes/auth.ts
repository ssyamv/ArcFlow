import { Hono } from "hono";
import {
  generateOAuthUrl,
  exchangeCodeForUser,
  signJwt,
  resolveUserContext,
} from "../services/auth";
import { upsertUser, getUserById } from "../db/queries";
import { authMiddleware } from "../middleware/auth";
import { getConfig } from "../config";

export const authRoutes = new Hono();

// 跳转飞书 OAuth 授权
authRoutes.get("/feishu", (c) => {
  const url = generateOAuthUrl();
  return c.redirect(url, 302);
});

// OAuth 回调
authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.json({ error: "Missing code parameter" }, 400);
  }

  try {
    const feishuUser = await exchangeCodeForUser(code);
    const user = upsertUser({
      feishu_user_id: feishuUser.open_id,
      feishu_union_id: feishuUser.union_id,
      name: feishuUser.name,
      avatar_url: feishuUser.avatar_url,
      email: feishuUser.email,
    });
    const token = await signJwt({ sub: user.id, role: user.role });

    const config = getConfig();
    const frontendUrl = config.oauthRedirectUri.replace("/auth/callback", "");
    return c.redirect(`${frontendUrl}/oauth/complete#token=${token}`, 302);
  } catch (err) {
    return c.json(
      { error: `OAuth failed: ${err instanceof Error ? err.message : "unknown"}` },
      500,
    );
  }
});

// NanoClaw 用：解析 arcflow_token 返回 user/workspace 上下文
authRoutes.post("/auth/verify", async (c) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ code: "AUTH_INVALID", message: "Missing bearer" }, 401);
  }
  const token = header.slice(7);
  try {
    const data = await resolveUserContext(token);
    return c.json({ code: 0, data });
  } catch (err) {
    const code =
      err instanceof Error && err.message === "AUTH_EXPIRED" ? "AUTH_EXPIRED" : "AUTH_INVALID";
    return c.json({ code, message: code }, 401);
  }
});

// 获取当前用户信息
authRoutes.get("/api/auth/me", authMiddleware, (c) => {
  const userId = c.get("userId") as number;
  const user = getUserById(userId);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json(user);
});
