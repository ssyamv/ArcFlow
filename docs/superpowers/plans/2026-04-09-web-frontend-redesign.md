> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Web 前端重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ArcFlow Web 前端增加飞书 OAuth 登录、多项目工作空间、对话历史管理、个人信息页，并以 Linear 设计风格全站改造。

**Architecture:** Gateway（Bun + Hono + SQLite）新增 auth、workspace 和 conversation API。Web 前端（Vue 3 + Pinia）引入 shadcn-vue 组件库，用 Linear 设计 token 覆盖主题。采用渐进改造方式：基础设施（设计系统 + 鉴权 + 工作空间）→ 页面改造 → 端到端验证。

**Tech Stack:** Bun + Hono + bun:sqlite (Gateway), Vue 3 + Tailwind CSS 4 + shadcn-vue + Pinia (Web), jose (JWT), Inter Variable 字体

**Spec:** `docs/superpowers/specs/2026-04-09-web-frontend-redesign-design.md`

---

## File Structure

### Gateway 新增/修改

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/gateway/src/config.ts` | 修改 | 增加 JWT_SECRET、JWT_EXPIRES_IN、OAUTH_REDIRECT_URI |
| `packages/gateway/src/types/index.ts` | 修改 | 增加 User、Conversation、Message 类型 |
| `packages/gateway/src/db/schema.sql` | 修改 | 增加 users、conversations、messages 表 |
| `packages/gateway/src/db/queries.ts` | 修改 | 增加 user、conversation、message 查询函数 |
| `packages/gateway/src/services/auth.ts` | 新增 | 飞书 OAuth + JWT 签发/验证 |
| `packages/gateway/src/middleware/auth.ts` | 新增 | JWT 鉴权中间件 |
| `packages/gateway/src/routes/auth.ts` | 新增 | /auth/feishu、/auth/callback、/api/auth/me |
| `packages/gateway/src/routes/conversations.ts` | 新增 | 对话 CRUD + 消息历史 API |
| `packages/gateway/src/routes/workspaces.ts` | 新增 | 工作空间 CRUD + Plane 同步 + 设置 |
| `packages/gateway/src/services/workspace-sync.ts` | 新增 | Plane 项目 → 工作空间自动同步 |
| `packages/gateway/src/middleware/workspace.ts` | 新增 | 工作空间上下文中间件（X-Workspace-Id） |
| `packages/gateway/src/routes/api.ts` | 修改 | /api/prd/chat 和 /api/rag/query 增加 conversation_id + workspace 持久化 |
| `packages/gateway/src/index.ts` | 修改 | 注册新路由，API 路由加 auth + workspace 中间件 |

### Web 前端新增/修改

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/web/src/assets/main.css` | 重写 | Linear 设计 token（CSS 变量 + 字体） |
| `packages/web/src/router/index.ts` | 修改 | 增加 login/callback/profile 路由 + 路由守卫 |
| `packages/web/src/api/auth.ts` | 新增 | 鉴权 API（me、logout） |
| `packages/web/src/api/conversations.ts` | 新增 | 对话 CRUD API |
| `packages/web/src/api/workflow.ts` | 修改 | request() 加 Authorization header |
| `packages/web/src/api/chat.ts` | 修改 | 适配 conversation_id |
| `packages/web/src/stores/auth.ts` | 新增 | useAuthStore |
| `packages/web/src/stores/conversation.ts` | 新增 | useConversationStore |
| `packages/web/src/stores/chat.ts` | 重构 | 基于 conversation_id 而非 clientId |
| `packages/web/src/components/AppLayout.vue` | 重写 | Linear 风格侧边栏 + 顶部栏 |
| `packages/web/src/pages/Login.vue` | 新增 | 登录页 |
| `packages/web/src/pages/AuthCallback.vue` | 新增 | OAuth 回调处理 |
| `packages/web/src/pages/Profile.vue` | 新增 | 个人信息页 |
| `packages/web/src/pages/AiChat.vue` | 重写 | 对话历史侧栏 + 消息流 |
| `packages/web/src/pages/Dashboard.vue` | 重写 | Linear 风格 |
| `packages/web/src/pages/WorkflowList.vue` | 重写 | Linear 风格 |
| `packages/web/src/pages/WorkflowDetail.vue` | 重写 | Linear 风格 |
| `packages/web/src/pages/WorkflowTrigger.vue` | 重写 | Linear 风格 |
| `packages/web/src/pages/NotFound.vue` | 重写 | Linear 风格 |
| `packages/web/src/api/workspaces.ts` | 新增 | 工作空间 API |
| `packages/web/src/stores/workspace.ts` | 新增 | useWorkspaceStore（当前工作空间 + 切换） |
| `packages/web/src/pages/WorkspaceSettings.vue` | 新增 | 工作空间设置页（admin） |

---

## Task 1: Gateway — 用户表 + Auth 服务 + JWT

**Files:**

- Modify: `packages/gateway/src/config.ts`
- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/db/schema.sql`
- Modify: `packages/gateway/src/db/queries.ts`
- Create: `packages/gateway/src/services/auth.ts`
- Create: `packages/gateway/src/services/auth.test.ts`
- Modify: `packages/gateway/package.json`

- [ ] **Step 1: 安装 jose 依赖**

```bash
cd packages/gateway && bun add jose
```

- [ ] **Step 2: 添加 JWT 相关配置**

在 `packages/gateway/src/config.ts` 的 `Config` interface 末尾（`ibuildAppRepoMap` 之后）增加：

```typescript
  // Auth
  jwtSecret: string;
  jwtExpiresIn: string;
  oauthRedirectUri: string;
```

在 `getConfig()` 返回对象末尾增加：

```typescript
    jwtSecret: process.env.JWT_SECRET ?? "arcflow-dev-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI ?? "http://localhost:5173/auth/callback",
```

- [ ] **Step 3: 添加 User 类型**

在 `packages/gateway/src/types/index.ts` 末尾增加：

```typescript
// 用户
export interface User {
  id: number;
  feishu_user_id: string;
  feishu_union_id: string | null;
  name: string;
  avatar_url: string | null;
  email: string | null;
  role: "admin" | "member";
  created_at: string;
  last_login_at: string | null;
}

// 对话
export interface Conversation {
  id: number;
  user_id: number;
  title: string;
  pinned: number;
  dify_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

// 消息
export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
```

- [ ] **Step 4: 添加数据库表**

在 `packages/gateway/src/db/schema.sql` 末尾增加：

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feishu_user_id TEXT NOT NULL UNIQUE,
  feishu_union_id TEXT,
  name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '新对话',
  pinned INTEGER NOT NULL DEFAULT 0,
  dify_conversation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
```

- [ ] **Step 5: 添加用户查询函数**

在 `packages/gateway/src/db/queries.ts` 中增加：

```typescript
import type { User, Conversation, Message } from "../types";

// ---- Users ----

export function findUserByFeishuId(feishuUserId: string): User | null {
  const db = getDb();
  return db.query("SELECT * FROM users WHERE feishu_user_id = ?").get(feishuUserId) as User | null;
}

export function upsertUser(params: {
  feishu_user_id: string;
  feishu_union_id?: string;
  name: string;
  avatar_url?: string;
  email?: string;
}): User {
  const db = getDb();
  const existing = findUserByFeishuId(params.feishu_user_id);
  if (existing) {
    db.run(
      `UPDATE users SET name = ?, avatar_url = ?, email = ?, feishu_union_id = ?, last_login_at = datetime('now') WHERE id = ?`,
      [params.name, params.avatar_url ?? null, params.email ?? null, params.feishu_union_id ?? null, existing.id],
    );
    return { ...existing, name: params.name, avatar_url: params.avatar_url ?? null, email: params.email ?? null, last_login_at: new Date().toISOString() };
  }
  const result = db.run(
    `INSERT INTO users (feishu_user_id, feishu_union_id, name, avatar_url, email, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [params.feishu_user_id, params.feishu_union_id ?? null, params.name, params.avatar_url ?? null, params.email ?? null],
  );
  return findUserByFeishuId(params.feishu_user_id)!;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}
```

- [ ] **Step 6: 写 auth 服务的测试**

创建 `packages/gateway/src/services/auth.test.ts`：

```typescript
import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
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
```

- [ ] **Step 7: 运行测试确认失败**

```bash
cd packages/gateway && bun test src/services/auth.test.ts
```

Expected: FAIL — `./auth` module not found

- [ ] **Step 8: 实现 auth 服务**

创建 `packages/gateway/src/services/auth.ts`：

```typescript
import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "../config";

export function generateOAuthUrl(): string {
  const config = getConfig();
  const params = new URLSearchParams({
    app_id: config.feishuAppId,
    redirect_uri: config.oauthRedirectUri,
    state: crypto.randomUUID(),
  });
  return `${config.feishuBaseUrl}/open-apis/authen/v1/authorize?${params}`;
}

export async function exchangeCodeForUser(code: string): Promise<{
  open_id: string;
  union_id?: string;
  name: string;
  avatar_url?: string;
  email?: string;
}> {
  const config = getConfig();

  // Step 1: Get app_access_token
  const tokenRes = await fetch(`${config.feishuBaseUrl}/open-apis/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const tokenData = (await tokenRes.json()) as { app_access_token: string };

  // Step 2: Exchange code for user_access_token
  const authRes = await fetch(`${config.feishuBaseUrl}/open-apis/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenData.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const authData = (await authRes.json()) as {
    data: { access_token: string; open_id: string; union_id?: string; name: string; avatar_url?: string; email?: string };
  };

  return {
    open_id: authData.data.open_id,
    union_id: authData.data.union_id,
    name: authData.data.name,
    avatar_url: authData.data.avatar_url,
    email: authData.data.email,
  };
}

export async function signJwt(payload: { sub: number; role: string }): Promise<string> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({ sub: payload.sub, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<{ sub: number; role: string }> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return { sub: payload.sub as number, role: payload.role as string };
}
```

- [ ] **Step 9: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/services/auth.test.ts
```

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/gateway/src/config.ts packages/gateway/src/types/index.ts packages/gateway/src/db/schema.sql packages/gateway/src/db/queries.ts packages/gateway/src/services/auth.ts packages/gateway/src/services/auth.test.ts packages/gateway/package.json packages/gateway/bun.lock
git commit -m "feat(gateway): 用户表 + auth 服务 + JWT 签发验证"
```

---

## Task 2: Gateway — Auth 中间件 + Auth 路由

**Files:**

- Create: `packages/gateway/src/middleware/auth.ts`
- Create: `packages/gateway/src/middleware/auth.test.ts`
- Create: `packages/gateway/src/routes/auth.ts`
- Create: `packages/gateway/src/routes/auth.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: 写 auth 中间件测试**

创建 `packages/gateway/src/middleware/auth.test.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd packages/gateway && bun test src/middleware/auth.test.ts
```

Expected: FAIL — `./auth` module not found

- [ ] **Step 3: 实现 auth 中间件**

创建 `packages/gateway/src/middleware/auth.ts`：

```typescript
import type { MiddlewareHandler } from "hono";
import { verifyJwt } from "../services/auth";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = header.slice(7);
  try {
    const payload = await verifyJwt(token);
    c.set("userId", payload.sub);
    c.set("userRole", payload.role);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/middleware/auth.test.ts
```

Expected: PASS

- [ ] **Step 5: 写 auth 路由测试**

创建 `packages/gateway/src/routes/auth.test.ts`：

```typescript
import { describe, expect, it, afterEach, mock, beforeEach } from "bun:test";
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
```

- [ ] **Step 6: 运行测试确认失败**

```bash
cd packages/gateway && bun test src/routes/auth.test.ts
```

Expected: FAIL

- [ ] **Step 7: 实现 auth 路由**

创建 `packages/gateway/src/routes/auth.ts`：

```typescript
import { Hono } from "hono";
import { generateOAuthUrl, exchangeCodeForUser, signJwt } from "../services/auth";
import { upsertUser, getUserById } from "../db/queries";
import { authMiddleware } from "../middleware/auth";
import { getConfig } from "../config";

export const authRoutes = new Hono();

// 跳转飞书 OAuth 授权
authRoutes.get("/feishu", (c) => {
  const url = generateOAuthUrl();
  return c.redirect(url, 302);
});

// OAuth 回调：code → user info → JWT → 重定向前端
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

    // 重定向到前端，token 放在 hash 中（避免被中间代理记录）
    const config = getConfig();
    const frontendUrl = config.oauthRedirectUri.replace("/auth/callback", "");
    return c.redirect(`${frontendUrl}/auth/callback#token=${token}`, 302);
  } catch (err) {
    return c.json({ error: `OAuth failed: ${err instanceof Error ? err.message : "unknown"}` }, 500);
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
```

- [ ] **Step 8: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/routes/auth.test.ts
```

Expected: PASS

- [ ] **Step 9: 注册路由到主应用**

修改 `packages/gateway/src/index.ts`，增加 auth 路由注册。

在现有 import 区域增加：

```typescript
import { authRoutes } from "./routes/auth";
import { authMiddleware } from "./middleware/auth";
```

在 `app.route("/", healthRoutes);` 之后增加：

```typescript
// Auth routes (public)
app.route("/auth", authRoutes);
app.route("/", authRoutes); // for /api/auth/me
```

为现有 API 路由增加鉴权（可选，渐进加入）。暂不强制，后续 Task 中逐步加。

- [ ] **Step 10: 运行全量测试确认无回归**

```bash
cd packages/gateway && bun test src/
```

Expected: 全部 PASS

- [ ] **Step 11: Commit**

```bash
git add packages/gateway/src/middleware/auth.ts packages/gateway/src/middleware/auth.test.ts packages/gateway/src/routes/auth.ts packages/gateway/src/routes/auth.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): auth 中间件 + OAuth/JWT 路由"
```

---

## Task 3: Gateway — 对话 CRUD API

**Files:**

- Modify: `packages/gateway/src/db/queries.ts`
- Create: `packages/gateway/src/routes/conversations.ts`
- Create: `packages/gateway/src/routes/conversations.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: 添加 conversation 和 message 查询函数**

在 `packages/gateway/src/db/queries.ts` 中增加：

```typescript
// ---- Conversations ----

export function listConversations(userId: number): Conversation[] {
  const db = getDb();
  return db.query("SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC").all(userId) as Conversation[];
}

export function getConversation(id: number, userId: number): Conversation | null {
  const db = getDb();
  return db.query("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as Conversation | null;
}

export function createConversation(userId: number, title?: string): Conversation {
  const db = getDb();
  const result = db.run(
    "INSERT INTO conversations (user_id, title) VALUES (?, ?)",
    [userId, title ?? "新对话"],
  );
  return db.query("SELECT * FROM conversations WHERE id = ?").get(result.lastInsertRowid) as Conversation;
}

export function updateConversation(id: number, userId: number, patch: { title?: string; pinned?: number }): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) { sets.push("title = ?"); values.push(patch.title); }
  if (patch.pinned !== undefined) { sets.push("pinned = ?"); values.push(patch.pinned); }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  values.push(id, userId);
  const result = db.run(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, values);
  return result.changes > 0;
}

export function deleteConversation(id: number, userId: number): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM conversations WHERE id = ? AND user_id = ?", [id, userId]);
  return result.changes > 0;
}

export function searchConversations(userId: number, query: string): Conversation[] {
  const db = getDb();
  const like = `%${query}%`;
  return db.query(
    `SELECT DISTINCT c.* FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.user_id = ? AND (c.title LIKE ? OR m.content LIKE ?)
     ORDER BY c.updated_at DESC`,
  ).all(userId, like, like) as Conversation[];
}

// ---- Messages ----

export function listMessages(conversationId: number, limit = 100): Message[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?",
  ).all(conversationId, limit) as Message[];
}

export function createMessage(conversationId: number, role: "user" | "assistant", content: string): Message {
  const db = getDb();
  const result = db.run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
    [conversationId, role, content],
  );
  db.run("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [conversationId]);
  return db.query("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as Message;
}
```

- [ ] **Step 2: 写 conversations 路由测试**

创建 `packages/gateway/src/routes/conversations.test.ts`：

```typescript
import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { conversationRoutes } from "./conversations";
import { signJwt } from "../services/auth";
import { upsertUser, createConversation, createMessage } from "../db/queries";

describe("conversation routes", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "member" });
  });

  afterEach(() => {
    closeDb();
  });

  const headers = () => ({ Authorization: `Bearer ${token}` });

  it("GET / returns empty list initially", async () => {
    const res = await conversationRoutes.request("/", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("POST / creates a conversation", async () => {
    const res = await conversationRoutes.request("/", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test Chat" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Test Chat");
  });

  it("PATCH /:id updates title", async () => {
    const conv = createConversation(userId, "Old");
    const res = await conversationRoutes.request(`/${conv.id}`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /:id removes conversation", async () => {
    const conv = createConversation(userId, "To Delete");
    const res = await conversationRoutes.request(`/${conv.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(res.status).toBe(200);
  });

  it("GET /:id/messages returns messages", async () => {
    const conv = createConversation(userId, "Chat");
    createMessage(conv.id, "user", "Hello");
    createMessage(conv.id, "assistant", "Hi there");
    const res = await conversationRoutes.request(`/${conv.id}/messages`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  it("GET /search?q= searches conversations", async () => {
    const conv = createConversation(userId, "Project Alpha");
    createMessage(conv.id, "user", "Tell me about the API design");
    const res = await conversationRoutes.request("/search?q=Alpha", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd packages/gateway && bun test src/routes/conversations.test.ts
```

Expected: FAIL

- [ ] **Step 4: 实现 conversations 路由**

创建 `packages/gateway/src/routes/conversations.ts`：

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  searchConversations,
  listMessages,
} from "../db/queries";

export const conversationRoutes = new Hono();

conversationRoutes.use("/*", authMiddleware);

conversationRoutes.get("/search", (c) => {
  const userId = c.get("userId") as number;
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ data: [] });
  const data = searchConversations(userId, q);
  return c.json({ data });
});

conversationRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  const data = listConversations(userId);
  return c.json({ data });
});

conversationRoutes.post("/", async (c) => {
  const userId = c.get("userId") as number;
  const body = await c.req.json<{ title?: string }>().catch(() => ({}));
  const conv = createConversation(userId, body.title);
  return c.json(conv, 201);
});

conversationRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ title?: string; pinned?: number }>();
  const ok = updateConversation(id, userId, body);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

conversationRoutes.delete("/:id", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const ok = deleteConversation(id, userId);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

conversationRoutes.get("/:id/messages", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const conv = getConversation(id, userId);
  if (!conv) return c.json({ error: "Not found" }, 404);
  const data = listMessages(id);
  return c.json({ data });
});
```

- [ ] **Step 5: 注册路由**

修改 `packages/gateway/src/index.ts`，增加：

```typescript
import { conversationRoutes } from "./routes/conversations";
```

在 auth 路由注册之后增加：

```typescript
app.route("/api/conversations", conversationRoutes);
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/routes/conversations.test.ts
```

Expected: PASS

- [ ] **Step 7: 运行全量测试**

```bash
cd packages/gateway && bun test src/
```

Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/db/queries.ts packages/gateway/src/routes/conversations.ts packages/gateway/src/routes/conversations.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): 对话 CRUD + 消息历史 API"
```

---

## Task 4: Gateway — 改造 prd/chat 和 rag/query 持久化消息

**Files:**

- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: 改造 /api/prd/chat**

修改 `packages/gateway/src/routes/api.ts` 中的 `/prd/chat` 路由。

在文件顶部增加 import：

```typescript
import { createMessage, getConversation, updateConversation } from "../db/queries";
```

将 `/prd/chat` 路由的请求体类型改为包含 `conversation_id`：

```typescript
apiRoutes.post("/prd/chat", async (c) => {
  const { message, conversation_id, dify_conversation_id } = await c.req.json<{
    message: string;
    conversation_id?: number;
    dify_conversation_id?: string;
  }>();

  if (!message?.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  // 持久化用户消息
  if (conversation_id) {
    createMessage(conversation_id, "user", message);
  }

  return streamSSE(c, async (stream) => {
    let fullAnswer = "";
    let convId = dify_conversation_id ?? "";
    let markerDetected = false;

    try {
      for await (const chunk of streamDifyChatflow(message, dify_conversation_id)) {
        if (chunk.event === "message" && chunk.answer) {
          convId = convId || chunk.conversation_id || "";
          fullAnswer += chunk.answer;

          if (markerDetected) continue;

          if (containsPrdMarker(fullAnswer)) {
            const before = textBeforeMarker(chunk.answer);
            if (before) {
              await stream.writeSSE({
                event: "message",
                data: JSON.stringify({
                  type: "text",
                  content: before,
                  conversation_id: convId,
                }),
              });
            }
            markerDetected = true;
            continue;
          }

          await stream.writeSSE({
            event: "message",
            data: JSON.stringify({
              type: "text",
              content: chunk.answer,
              conversation_id: convId,
            }),
          });
        }

        if (chunk.event === "message_end") {
          // 持久化 AI 回复
          if (conversation_id && fullAnswer) {
            const cleanAnswer = markerDetected ? textBeforeMarker(fullAnswer) || fullAnswer : fullAnswer;
            createMessage(conversation_id, "assistant", cleanAnswer);

            // 更新 dify_conversation_id
            if (convId) {
              const db = (await import("../db")).getDb();
              db.run("UPDATE conversations SET dify_conversation_id = ? WHERE id = ?", [convId, conversation_id]);
            }
          }

          const prdResult = extractPrdResult(fullAnswer);
          if (prdResult) {
            try {
              const { path, wikiUrl } = await savePrdToGit(prdResult);
              await stream.writeSSE({
                event: "prd_complete",
                data: JSON.stringify({
                  prd_path: path,
                  wiki_url: wikiUrl,
                  title: prdResult.title,
                }),
              });
            } catch (err) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  message: `PRD 写入失败: ${err instanceof Error ? err.message : "未知错误"}`,
                }),
              });
            }
          }
        }
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: `对话失败: ${err instanceof Error ? err.message : "未知错误"}`,
        }),
      });
    }
  });
});
```

- [ ] **Step 2: 运行已有 api 测试确认无回归**

```bash
cd packages/gateway && bun test src/routes/api.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/routes/api.ts
git commit -m "feat(gateway): prd/chat 消息持久化到 conversations"
```

---

## Task 5: Web — 安装 shadcn-vue + Linear 设计 Token

**Files:**

- Modify: `packages/web/package.json`
- Rewrite: `packages/web/src/assets/main.css`
- Modify: `packages/web/vite.config.ts`

- [ ] **Step 1: 安装 shadcn-vue 及依赖**

```bash
cd packages/web && bun add radix-vue && bunx shadcn-vue@latest init
```

初始化时选择：TypeScript，Default style，CSS variables，`@/` alias。

如果 shadcn-vue init 不成功，手动安装核心依赖：

```bash
cd packages/web && bun add radix-vue
```

- [ ] **Step 2: 重写 main.css 为 Linear 设计 Token**

替换 `packages/web/src/assets/main.css` 的全部内容为：

```css
@import "tailwindcss";

/* ── Inter Variable 字体 ── */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap");
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap");

/* ── Linear 设计 Token (CSS 变量) ── */
@theme {
  /* 背景 */
  --color-bg-primary: #08090a;
  --color-bg-panel: #0f1011;
  --color-bg-surface: #191a1b;
  --color-bg-surface-secondary: #28282c;

  /* 文字 */
  --color-text-primary: #f7f8f8;
  --color-text-secondary: #d0d6e0;
  --color-text-tertiary: #8a8f98;
  --color-text-quaternary: #62666d;

  /* 品牌 */
  --color-accent: #5e6ad2;
  --color-accent-hover: #828fff;
  --color-accent-violet: #7170ff;

  /* 状态 */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-error-light: #f87171;

  /* 边框 */
  --color-border-default: rgba(255, 255, 255, 0.08);
  --color-border-subtle: rgba(255, 255, 255, 0.05);
  --color-border-solid: #23252a;

  /* 表面透明度 */
  --color-surface-02: rgba(255, 255, 255, 0.02);
  --color-surface-03: rgba(255, 255, 255, 0.03);
  --color-surface-04: rgba(255, 255, 255, 0.04);
  --color-surface-05: rgba(255, 255, 255, 0.05);
  --color-surface-08: rgba(255, 255, 255, 0.08);

  /* 遮罩 */
  --color-overlay: rgba(0, 0, 0, 0.85);

  /* 字体 */
  --font-sans: "Inter", "SF Pro Display", -apple-system, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
}

/* ── 全局样式 ── */
* {
  font-feature-settings: "cv01", "ss03";
}

html {
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── 滚动条（暗色风格） ── */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ── Markdown 渲染（暗色版） ── */
.prose {
  line-height: 1.65;
  color: var(--color-text-secondary);
}

.prose p {
  margin-bottom: 0.5em;
}

.prose p:last-child {
  margin-bottom: 0;
}

.prose strong {
  font-weight: 590;
  color: var(--color-text-primary);
}

.prose ul,
.prose ol {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}

.prose ul {
  list-style-type: disc;
}

.prose ol {
  list-style-type: decimal;
}

.prose li {
  margin-bottom: 0.25em;
}

.prose code {
  background-color: var(--color-surface-08);
  padding: 0.15em 0.35em;
  border-radius: 4px;
  font-size: 0.875em;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}

.prose pre {
  background-color: var(--color-bg-panel);
  color: var(--color-text-secondary);
  padding: 0.75em 1em;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  overflow-x: auto;
  margin-bottom: 0.5em;
}

.prose pre code {
  background: none;
  padding: 0;
  font-size: 0.85em;
}

.prose h1,
.prose h2,
.prose h3 {
  font-weight: 590;
  color: var(--color-text-primary);
  margin-top: 0.75em;
  margin-bottom: 0.25em;
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0.5em;
}

.prose th,
.prose td {
  border: 1px solid var(--color-border-default);
  padding: 0.35em 0.75em;
  text-align: left;
}

.prose th {
  background-color: var(--color-surface-05);
  font-weight: 510;
  color: var(--color-text-primary);
}

/* ── 过渡动画 ── */
.transition-linear {
  transition: all 120ms ease;
}
```

- [ ] **Step 3: 更新 vite proxy 增加 auth 路径**

修改 `packages/web/vite.config.ts` 的 proxy 配置，增加 auth 路由代理：

```typescript
proxy: {
  "/api": { target: "http://localhost:3100", changeOrigin: true },
  "/auth": { target: "http://localhost:3100", changeOrigin: true },
  "/health": { target: "http://localhost:3100", changeOrigin: true },
  "/version": { target: "http://localhost:3100", changeOrigin: true },
},
```

- [ ] **Step 4: 本地验证样式生效**

```bash
cd packages/web && bun run dev
```

打开 <http://localhost:5173> 确认背景变为暗色 `#08090a`。

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/bun.lock packages/web/src/assets/main.css packages/web/vite.config.ts
git commit -m "feat(web): 引入 Linear 设计 Token + shadcn-vue 基础"
```

---

## Task 6: Web — Auth Store + API + 路由守卫

**Files:**

- Create: `packages/web/src/api/auth.ts`
- Create: `packages/web/src/stores/auth.ts`
- Modify: `packages/web/src/api/workflow.ts`
- Modify: `packages/web/src/router/index.ts`

- [ ] **Step 1: 创建 auth API 层**

创建 `packages/web/src/api/auth.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface User {
  id: number;
  feishu_user_id: string;
  name: string;
  avatar_url: string | null;
  email: string | null;
  role: "admin" | "member";
  created_at: string;
  last_login_at: string | null;
}

export async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Unauthorized");
  return res.json();
}
```

- [ ] **Step 2: 创建 auth store**

创建 `packages/web/src/stores/auth.ts`：

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { fetchMe, type User } from "../api/auth";

const TOKEN_KEY = "arcflow_token";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const loading = ref(false);

  const isAuthenticated = computed(() => !!token.value);

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem(TOKEN_KEY, t);
  }

  function clearToken() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async function loadUser(): Promise<boolean> {
    if (!token.value) return false;
    loading.value = true;
    try {
      user.value = await fetchMe(token.value);
      return true;
    } catch {
      clearToken();
      return false;
    } finally {
      loading.value = false;
    }
  }

  function loginWithFeishu() {
    window.location.href = `${import.meta.env.VITE_API_BASE ?? ""}/auth/feishu`;
  }

  function handleCallback(): string | null {
    const hash = window.location.hash;
    const match = hash.match(/token=([^&]+)/);
    if (match) {
      setToken(match[1]);
      return match[1];
    }
    return null;
  }

  function logout() {
    clearToken();
  }

  return { user, token, loading, isAuthenticated, setToken, clearToken, loadUser, loginWithFeishu, handleCallback, logout };
});
```

- [ ] **Step 3: 改造 workflow API 加 Authorization header**

修改 `packages/web/src/api/workflow.ts` 的 `request` 函数：

```typescript
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("arcflow_token");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("arcflow_token");
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: 改造路由增加守卫**

替换 `packages/web/src/router/index.ts` 全部内容：

```typescript
import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../pages/Login.vue"),
      meta: { public: true },
    },
    {
      path: "/auth/callback",
      name: "auth-callback",
      component: () => import("../pages/AuthCallback.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      redirect: "/dashboard",
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("../pages/Dashboard.vue"),
    },
    {
      path: "/workflows",
      name: "workflows",
      component: () => import("../pages/WorkflowList.vue"),
    },
    {
      path: "/workflows/:id",
      name: "workflow-detail",
      component: () => import("../pages/WorkflowDetail.vue"),
    },
    {
      path: "/chat",
      name: "chat",
      component: () => import("../pages/AiChat.vue"),
    },
    {
      path: "/prd/chat",
      redirect: "/chat",
    },
    {
      path: "/trigger",
      name: "trigger",
      component: () => import("../pages/WorkflowTrigger.vue"),
    },
    {
      path: "/profile",
      name: "profile",
      component: () => import("../pages/Profile.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      name: "NotFound",
      component: () => import("../pages/NotFound.vue"),
      meta: { public: true },
    },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem("arcflow_token");
  if (!to.meta.public && !token) {
    return { name: "login" };
  }
});

export default router;
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/auth.ts packages/web/src/stores/auth.ts packages/web/src/api/workflow.ts packages/web/src/router/index.ts
git commit -m "feat(web): auth store + 路由守卫 + API 鉴权"
```

---

## Task 7: Web — 登录页 + OAuth 回调页

**Files:**

- Create: `packages/web/src/pages/Login.vue`
- Create: `packages/web/src/pages/AuthCallback.vue`

- [ ] **Step 1: 创建登录页**

创建 `packages/web/src/pages/Login.vue`：

```vue
<template>
  <div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg-primary)">
    <div
      class="w-full max-w-sm p-8 rounded-xl"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
    >
      <div class="text-center mb-8">
        <h1
          class="text-2xl mb-2"
          style="
            font-weight: 510;
            color: var(--color-text-primary);
            letter-spacing: -0.288px;
          "
        >
          ArcFlow
        </h1>
        <p class="text-sm" style="color: var(--color-text-tertiary)">
          AI 研发运营一体化平台
        </p>
      </div>

      <button
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-white text-sm cursor-pointer transition-linear"
        style="
          background-color: var(--color-accent);
          font-weight: 510;
          border: none;
        "
        @click="handleLogin"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h7.5v7.5H4V4Z" fill="currentColor" opacity="0.9" />
          <path d="M12.5 4H20v7.5h-7.5V4Z" fill="currentColor" opacity="0.7" />
          <path d="M4 12.5h7.5V20H4v-7.5Z" fill="currentColor" opacity="0.7" />
          <path d="M12.5 12.5H20V20h-7.5v-7.5Z" fill="currentColor" opacity="0.5" />
        </svg>
        通过飞书登录
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

function handleLogin() {
  auth.loginWithFeishu();
}
</script>
```

- [ ] **Step 2: 创建 OAuth 回调页**

创建 `packages/web/src/pages/AuthCallback.vue`：

```vue
<template>
  <div
    class="min-h-screen flex items-center justify-center"
    style="background-color: var(--color-bg-primary)"
  >
    <div class="text-center">
      <p v-if="error" style="color: var(--color-error-light)">{{ error }}</p>
      <p v-else style="color: var(--color-text-tertiary)">登录中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const auth = useAuthStore();
const error = ref<string | null>(null);

onMounted(async () => {
  const token = auth.handleCallback();
  if (!token) {
    error.value = "登录失败：未收到授权令牌";
    return;
  }

  const ok = await auth.loadUser();
  if (ok) {
    router.replace("/dashboard");
  } else {
    error.value = "登录失败：无法获取用户信息";
  }
});
</script>
```

- [ ] **Step 3: 本地验证**

```bash
cd packages/web && bun run dev
```

访问 <http://localhost:5173> 应自动跳转到 /login，看到暗色登录页。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Login.vue packages/web/src/pages/AuthCallback.vue
git commit -m "feat(web): 登录页 + OAuth 回调页"
```

---

## Task 8: Web — Linear 风格布局改造

**Files:**

- Rewrite: `packages/web/src/components/AppLayout.vue`
- Modify: `packages/web/src/App.vue`

- [ ] **Step 1: 改造 App.vue 增加 auth 检查**

替换 `packages/web/src/App.vue`：

```vue
<template>
  <router-view v-if="isPublicRoute" />
  <AppLayout v-else-if="authReady" />
  <div
    v-else
    class="min-h-screen flex items-center justify-center"
    style="background-color: var(--color-bg-primary)"
  >
    <p style="color: var(--color-text-tertiary)">加载中...</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import AppLayout from "./components/AppLayout.vue";

const route = useRoute();
const auth = useAuthStore();
const authReady = ref(false);

const isPublicRoute = computed(() => route.meta.public === true);

onMounted(async () => {
  if (auth.token) {
    await auth.loadUser();
  }
  authReady.value = true;
});
</script>
```

- [ ] **Step 2: 重写 AppLayout.vue 为 Linear 风格**

替换 `packages/web/src/components/AppLayout.vue` 全部内容：

```vue
<template>
  <div class="flex min-h-screen" style="background-color: var(--color-bg-primary)">
    <!-- Sidebar -->
    <nav
      class="w-56 shrink-0 flex flex-col"
      style="
        background-color: var(--color-bg-panel);
        border-right: 1px solid var(--color-border-subtle);
      "
    >
      <!-- Logo -->
      <div class="px-4 py-4" style="border-bottom: 1px solid var(--color-border-subtle)">
        <h2
          class="m-0 text-base"
          style="font-weight: 510; color: var(--color-text-primary)"
        >
          ArcFlow
        </h2>
      </div>

      <!-- Navigation -->
      <ul class="list-none p-0 m-0 mt-1 flex-1 px-2">
        <li v-for="item in navItems" :key="item.path">
          <router-link
            :to="item.path"
            class="flex items-center gap-2.5 px-3 py-1.5 rounded-md no-underline text-sm transition-linear my-0.5"
            :class="isActive(item.path) ? 'nav-active' : 'nav-default'"
          >
            <component :is="item.icon" :size="16" style="opacity: 0.6" />
            {{ item.label }}
          </router-link>
        </li>
      </ul>

      <!-- User -->
      <div
        class="px-3 py-3 flex items-center gap-2.5 cursor-pointer transition-linear"
        style="border-top: 1px solid var(--color-border-subtle)"
        @click="$router.push('/profile')"
      >
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0"
          style="
            background-color: var(--color-surface-05);
            color: var(--color-text-secondary);
            font-weight: 510;
          "
        >
          <img
            v-if="auth.user?.avatar_url"
            :src="auth.user.avatar_url"
            class="w-full h-full rounded-full object-cover"
          />
          <span v-else>{{ (auth.user?.name ?? "U")[0] }}</span>
        </div>
        <div class="min-w-0">
          <div
            class="text-xs truncate"
            style="font-weight: 510; color: var(--color-text-secondary)"
          >
            {{ auth.user?.name ?? "用户" }}
          </div>
          <div class="text-xs" style="color: var(--color-text-quaternary)">
            {{ auth.user?.role ?? "member" }}
          </div>
        </div>
      </div>
    </nav>

    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Header -->
      <header
        class="h-12 flex items-center justify-between px-6 shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="text-xs" style="color: var(--color-text-tertiary); font-weight: 510">
          <span style="color: var(--color-text-quaternary)">ArcFlow /</span>
          {{ currentPageTitle }}
        </div>
      </header>

      <!-- Content -->
      <main class="flex-1 overflow-y-auto p-8">
        <div class="max-w-5xl mx-auto">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { LayoutDashboard, MessageSquare, List, Zap, User } from "lucide-vue-next";

const route = useRoute();
const auth = useAuthStore();

const navItems = [
  { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { path: "/chat", label: "AI 对话", icon: MessageSquare },
  { path: "/workflows", label: "工作流", icon: List },
  { path: "/trigger", label: "触发工作流", icon: Zap },
];

const currentPageTitle = computed(() => {
  const item = navItems.find((i) => route.path.startsWith(i.path));
  if (route.path === "/profile") return "个人信息";
  return item?.label ?? "";
});

function isActive(path: string) {
  return route.path.startsWith(path);
}
</script>

<style scoped>
.nav-default {
  color: var(--color-text-secondary);
}
.nav-default:hover {
  background-color: var(--color-surface-03);
  color: var(--color-text-primary);
}
.nav-active {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
  border-left: 2px solid var(--color-accent);
}
</style>
```

- [ ] **Step 3: 本地验证**

```bash
cd packages/web && bun run dev
```

确认侧边栏为暗色 Linear 风格。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.vue packages/web/src/components/AppLayout.vue
git commit -m "feat(web): Linear 风格布局 — 侧边栏 + 顶部栏"
```

---

## Task 9: Web — Dashboard 页面 Linear 改造

**Files:**

- Rewrite: `packages/web/src/pages/Dashboard.vue`

- [ ] **Step 1: 重写 Dashboard.vue**

替换 `packages/web/src/pages/Dashboard.vue` 全部内容：

```vue
<template>
  <div>
    <!-- Page Title -->
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      系统概览
    </h1>

    <!-- KPI Cards -->
    <div class="grid grid-cols-4 gap-4 mb-8">
      <div
        v-for="kpi in kpis"
        :key="kpi.label"
        class="p-4 rounded-lg"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div class="text-xs mb-1" style="font-weight: 510; color: var(--color-text-tertiary)">
          {{ kpi.label }}
        </div>
        <div
          class="text-2xl"
          style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
        >
          {{ kpi.value }}
        </div>
      </div>
    </div>

    <!-- Gateway Status -->
    <div class="flex items-center gap-2 mb-6">
      <div
        class="w-2 h-2 rounded-full"
        :style="{ backgroundColor: gatewayOk ? 'var(--color-success)' : 'var(--color-error)' }"
      />
      <span class="text-xs" style="font-weight: 510; color: var(--color-text-tertiary)">
        Gateway {{ gatewayOk ? "在线" : "离线" }}
        <span v-if="gatewayVersion" style="color: var(--color-text-quaternary)">
          v{{ gatewayVersion }}
        </span>
      </span>
    </div>

    <!-- Recent Executions Table -->
    <div>
      <h2
        class="text-xs uppercase mb-3"
        style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
      >
        最近执行
      </h2>
      <div
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--color-border-default)"
      >
        <table class="w-full">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border-subtle)">
              <th class="table-header">ID</th>
              <th class="table-header">类型</th>
              <th class="table-header">触发</th>
              <th class="table-header">状态</th>
              <th class="table-header">时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="exec in store.executions.slice(0, 5)"
              :key="exec.id"
              class="table-row cursor-pointer"
              @click="$router.push(`/workflows/${exec.id}`)"
            >
              <td class="table-cell" style="color: var(--color-text-tertiary)">#{{ exec.id }}</td>
              <td class="table-cell">
                <span class="status-pill" style="border-color: var(--color-border-solid)">
                  {{ workflowLabel(exec.workflow_type) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-tertiary)">
                {{ exec.trigger_source }}
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center gap-1 text-xs"
                  style="font-weight: 510"
                  :style="{ color: statusColor(exec.status) }"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{ backgroundColor: statusColor(exec.status) }"
                  />
                  {{ statusLabel(exec.status) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ exec.created_at }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useWorkflowStore } from "../stores/workflow";
import { checkHealth, fetchVersion } from "../api/workflow";

const store = useWorkflowStore();
const gatewayOk = ref(false);
const gatewayVersion = ref("");

const kpis = computed(() => {
  const execs = store.executions;
  return [
    { label: "总执行", value: store.total },
    { label: "运行中", value: execs.filter((e) => e.status === "running").length },
    { label: "成功", value: execs.filter((e) => e.status === "success").length },
    { label: "失败", value: execs.filter((e) => e.status === "failed").length },
  ];
});

function workflowLabel(type: string) {
  const map: Record<string, string> = {
    prd_to_tech: "PRD → 技术文档",
    tech_to_openapi: "技术文档 → OpenAPI",
    bug_analysis: "Bug 分析",
    code_gen: "代码生成",
  };
  return map[type] ?? type;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-text-quaternary)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

function statusLabel(status: string) {
  const map: Record<string, string> = { pending: "待执行", running: "运行中", success: "成功", failed: "失败" };
  return map[status] ?? status;
}

let timer: ReturnType<typeof setInterval>;

onMounted(async () => {
  await store.loadExecutions({ limit: 20 });
  checkHealth().then(() => { gatewayOk.value = true; }).catch(() => { gatewayOk.value = false; });
  fetchVersion().then((v) => { gatewayVersion.value = v.version; }).catch(() => {});
  timer = setInterval(() => store.loadExecutions({ limit: 20 }), 10000);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.table-header {
  padding: 8px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  text-transform: uppercase;
}

.table-row {
  border-bottom: 1px solid var(--color-border-subtle);
  transition: all 120ms ease;
}

.table-row:hover {
  background-color: var(--color-surface-04);
}

.table-row:last-child {
  border-bottom: none;
}

.table-cell {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-secondary);
}

.status-pill {
  font-size: 12px;
  font-weight: 510;
  padding: 1px 8px;
  border-radius: 9999px;
  border: 1px solid;
  color: var(--color-text-secondary);
}
</style>
```

- [ ] **Step 2: 本地验证**

```bash
cd packages/web && bun run dev
```

确认 Dashboard 为暗色 Linear 风格。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Dashboard.vue
git commit -m "feat(web): Dashboard 页面 Linear 风格改造"
```

---

## Task 10: Web — 工作流列表/详情/触发 + NotFound 页面 Linear 改造

**Files:**

- Rewrite: `packages/web/src/pages/WorkflowList.vue`
- Rewrite: `packages/web/src/pages/WorkflowDetail.vue`
- Rewrite: `packages/web/src/pages/WorkflowTrigger.vue`
- Rewrite: `packages/web/src/pages/NotFound.vue`

这四个页面遵循同样的 Linear 样式规则（暗色背景、表格样式、输入框样式等），参照 Task 9 中 Dashboard 的风格模式。每个页面功能逻辑不变，仅做 CSS 替换。

- [ ] **Step 1: 重写 WorkflowList.vue**

功能：筛选栏（pill 按钮组） + 执行列表表格。样式规则同 Dashboard 表格。筛选按钮使用 pill 样式：选中态 `var(--color-surface-08)` 背景 + `var(--color-text-primary)` 文字，未选中透明 + `var(--color-text-tertiary)`。

- [ ] **Step 2: 重写 WorkflowDetail.vue**

功能：信息卡片（类型 pill + 状态 pill + 字段列表）+ 错误信息区。卡片使用 `var(--color-surface-02)` 背景 + `var(--color-border-default)` 边框。错误区使用 `rgba(239,68,68,0.08)` 背景 + `rgba(239,68,68,0.2)` 边框。

- [ ] **Step 3: 重写 WorkflowTrigger.vue**

功能：表单（选择器 + 输入框 + 复选框 + 提交按钮）。输入框使用 `var(--color-surface-02)` 背景 + `var(--color-border-default)` 边框 + 6px 圆角。提交按钮使用 Primary 样式 `var(--color-accent)` 背景。

- [ ] **Step 4: 重写 NotFound.vue**

简洁暗色 404 页面：居中 "404" 文字（`var(--color-text-quaternary)`）+ "页面未找到" + 返回按钮。

- [ ] **Step 5: 本地验证所有改造页面**

逐一访问 /workflows、/workflows/1、/trigger 确认 Linear 风格。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/WorkflowList.vue packages/web/src/pages/WorkflowDetail.vue packages/web/src/pages/WorkflowTrigger.vue packages/web/src/pages/NotFound.vue
git commit -m "feat(web): 工作流页面 + 404 页面 Linear 风格改造"
```

---

## Task 11: Web — AI 对话页改造（历史侧栏 + 消息流）

**Files:**

- Create: `packages/web/src/api/conversations.ts`
- Create: `packages/web/src/stores/conversation.ts`
- Rewrite: `packages/web/src/stores/chat.ts`
- Rewrite: `packages/web/src/pages/AiChat.vue`

- [ ] **Step 1: 创建 conversations API**

创建 `packages/web/src/api/conversations.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export interface Conversation {
  id: number;
  user_id: number;
  title: string;
  pinned: number;
  dify_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function fetchConversations(): Promise<{ data: Conversation[] }> {
  const res = await fetch(`${API_BASE}/api/conversations`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load conversations");
  return res.json();
}

export async function createConversation(title?: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function updateConversation(id: number, patch: { title?: string; pinned?: number }): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
}

export async function deleteConversation(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function fetchMessages(conversationId: number): Promise<{ data: Message[] }> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
}

export async function searchConversations(query: string): Promise<{ data: Conversation[] }> {
  const res = await fetch(`${API_BASE}/api/conversations/search?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}
```

- [ ] **Step 2: 创建 conversation store**

创建 `packages/web/src/stores/conversation.ts`：

```typescript
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  fetchConversations,
  createConversation as apiCreate,
  updateConversation as apiUpdate,
  deleteConversation as apiDelete,
  searchConversations as apiSearch,
  type Conversation,
} from "../api/conversations";

export const useConversationStore = defineStore("conversation", () => {
  const conversations = ref<Conversation[]>([]);
  const currentId = ref<number | null>(null);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const res = await fetchConversations();
      conversations.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function create(title?: string): Promise<Conversation> {
    const conv = await apiCreate(title);
    conversations.value.unshift(conv);
    currentId.value = conv.id;
    return conv;
  }

  async function update(id: number, patch: { title?: string; pinned?: number }) {
    await apiUpdate(id, patch);
    const idx = conversations.value.findIndex((c) => c.id === id);
    if (idx !== -1) {
      Object.assign(conversations.value[idx], patch);
    }
  }

  async function remove(id: number) {
    await apiDelete(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (currentId.value === id) {
      currentId.value = null;
    }
  }

  async function search(query: string): Promise<Conversation[]> {
    const res = await apiSearch(query);
    return res.data;
  }

  function select(id: number) {
    currentId.value = id;
  }

  return { conversations, currentId, loading, load, create, update, remove, search, select };
});
```

- [ ] **Step 3: 重构 chat store**

替换 `packages/web/src/stores/chat.ts` 全部内容：

```typescript
import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMessages, type Message } from "../api/conversations";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const typing = ref(false);
  const error = ref<string | null>(null);

  async function loadMessages(conversationId: number) {
    loading.value = true;
    try {
      const res = await fetchMessages(conversationId);
      messages.value = res.data;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function send(conversationId: number, message: string, difyConversationId?: string) {
    if (loading.value || !message.trim()) return;
    error.value = null;
    loading.value = true;
    typing.value = true;

    // 乐观添加用户消息
    messages.value.push({
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    });

    // 占位 AI 消息
    const aiMsg: Message = {
      id: Date.now() + 1,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    messages.value.push(aiMsg);

    const token = localStorage.getItem("arcflow_token");
    try {
      const res = await fetch(`${API_BASE}/api/prd/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          dify_conversation_id: difyConversationId,
        }),
      });

      if (!res.ok) throw new Error(`请求失败: ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.type === "text" && data.content) {
              aiMsg.content += data.content;
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : "发送失败";
      // 移除空的 AI 消息
      if (!aiMsg.content) {
        const idx = messages.value.indexOf(aiMsg);
        if (idx !== -1) messages.value.splice(idx, 1);
      }
    } finally {
      loading.value = false;
      typing.value = false;
    }
  }

  function clear() {
    messages.value = [];
    error.value = null;
  }

  return { messages, loading, typing, error, loadMessages, send, clear };
});
```

- [ ] **Step 4: 重写 AiChat.vue**

替换 `packages/web/src/pages/AiChat.vue` 全部内容。这是最复杂的页面，包含：

- 左侧对话列表侧栏（260px，搜索 + 分组列表 + 操作菜单）
- 右侧消息流 + 输入区

```vue
<template>
  <div class="flex -m-8" style="height: calc(100vh - 48px)">
    <!-- Conversation Sidebar -->
    <div
      class="w-64 shrink-0 flex flex-col"
      style="
        background-color: var(--color-bg-panel);
        border-right: 1px solid var(--color-border-subtle);
      "
    >
      <!-- Search + New -->
      <div class="p-3 flex gap-2" style="border-bottom: 1px solid var(--color-border-subtle)">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索对话..."
          class="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
          style="
            background-color: var(--color-surface-02);
            border: 1px solid var(--color-border-default);
            color: var(--color-text-secondary);
          "
          @input="handleSearch"
        />
        <button
          class="px-2.5 py-1.5 rounded-md text-xs text-white cursor-pointer"
          style="background-color: var(--color-accent); font-weight: 510; border: none"
          @click="handleNew"
        >
          +
        </button>
      </div>

      <!-- Conversation List -->
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <template v-if="groupedConversations.pinned.length">
          <div class="group-title">置顶</div>
          <ConvItem
            v-for="c in groupedConversations.pinned"
            :key="c.id"
            :conv="c"
            :active="c.id === convStore.currentId"
            @select="selectConv(c.id)"
            @rename="startRename(c)"
            @toggle-pin="togglePin(c)"
            @delete="handleDelete(c.id)"
          />
        </template>
        <template v-for="group in timeGroups" :key="group.label">
          <template v-if="group.items.length">
            <div class="group-title">{{ group.label }}</div>
            <ConvItem
              v-for="c in group.items"
              :key="c.id"
              :conv="c"
              :active="c.id === convStore.currentId"
              @select="selectConv(c.id)"
              @rename="startRename(c)"
              @toggle-pin="togglePin(c)"
              @delete="handleDelete(c.id)"
            />
          </template>
        </template>
      </div>
    </div>

    <!-- Chat Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <template v-if="convStore.currentId">
        <!-- Messages -->
        <div ref="msgContainer" class="flex-1 overflow-y-auto px-6 py-4">
          <div v-for="msg in chatStore.messages" :key="msg.id" class="mb-4">
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div
                class="max-w-lg px-3 py-2 rounded-lg text-sm"
                style="
                  background-color: rgba(94, 106, 210, 0.15);
                  color: var(--color-text-primary);
                "
              >
                {{ msg.content }}
              </div>
            </div>
            <div v-else class="prose text-sm max-w-2xl" v-html="renderMd(msg.content)" />
          </div>
          <div v-if="chatStore.typing" class="text-sm" style="color: var(--color-text-tertiary)">
            <span class="animate-pulse">···</span>
          </div>
        </div>

        <!-- Input -->
        <div class="px-6 pb-4 pt-2">
          <div
            class="flex items-end gap-2 p-3 rounded-lg"
            style="
              background-color: var(--color-surface-02);
              border: 1px solid var(--color-border-default);
            "
          >
            <textarea
              ref="inputEl"
              v-model="input"
              rows="1"
              placeholder="输入消息，Shift+Enter 换行"
              class="flex-1 bg-transparent outline-none resize-none text-sm"
              style="color: var(--color-text-secondary); max-height: 144px"
              @keydown.enter.exact.prevent="handleSend"
            />
            <button
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white cursor-pointer"
              style="background-color: var(--color-accent); border: none"
              :disabled="chatStore.loading"
              @click="handleSend"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      </template>

      <!-- Empty State -->
      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="text-4xl mb-4" style="color: var(--color-bg-surface-secondary); font-weight: 510">
            ArcFlow
          </div>
          <p class="text-sm" style="color: var(--color-text-tertiary)">
            选择一个对话或开始新对话
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, defineComponent, h } from "vue";
import { useConversationStore } from "../stores/conversation";
import { useChatStore } from "../stores/chat";
import { marked } from "marked";
import type { Conversation } from "../api/conversations";

const convStore = useConversationStore();
const chatStore = useChatStore();
const input = ref("");
const searchQuery = ref("");
const msgContainer = ref<HTMLElement | null>(null);

// ConvItem inline component
const ConvItem = defineComponent({
  props: {
    conv: { type: Object as () => Conversation, required: true },
    active: { type: Boolean, default: false },
  },
  emits: ["select", "rename", "togglePin", "delete"],
  setup(props, { emit }) {
    const showMenu = ref(false);
    return () =>
      h(
        "div",
        {
          class: `flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-xs transition-linear my-0.5 group`,
          style: {
            backgroundColor: props.active ? "var(--color-surface-05)" : "transparent",
            color: props.active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            fontWeight: 510,
          },
          onClick: () => emit("select"),
          onMouseenter: () => { showMenu.value = true; },
          onMouseleave: () => { showMenu.value = false; },
        },
        [
          h("span", { class: "flex-1 truncate" }, props.conv.title),
          showMenu.value
            ? h(
                "div",
                { class: "relative", onClick: (e: Event) => e.stopPropagation() },
                [
                  h(
                    "button",
                    {
                      class: "text-xs px-1 rounded",
                      style: { color: "var(--color-text-quaternary)", background: "none", border: "none", cursor: "pointer" },
                      onClick: () => emit("delete"),
                    },
                    "×",
                  ),
                ],
              )
            : null,
        ],
      );
  },
});

const groupedConversations = computed(() => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const pinned: Conversation[] = [];
  const todayItems: Conversation[] = [];
  const yesterdayItems: Conversation[] = [];
  const earlier: Conversation[] = [];

  for (const c of convStore.conversations) {
    if (c.pinned) { pinned.push(c); continue; }
    const d = new Date(c.updated_at);
    if (d >= today) todayItems.push(c);
    else if (d >= yesterday) yesterdayItems.push(c);
    else earlier.push(c);
  }

  return { pinned, today: todayItems, yesterday: yesterdayItems, earlier };
});

const timeGroups = computed(() => [
  { label: "今天", items: groupedConversations.value.today },
  { label: "昨天", items: groupedConversations.value.yesterday },
  { label: "更早", items: groupedConversations.value.earlier },
]);

function renderMd(content: string) {
  if (!content) return "";
  return marked.parse(content, { async: false }) as string;
}

async function handleNew() {
  const conv = await convStore.create();
  chatStore.clear();
}

async function selectConv(id: number) {
  convStore.select(id);
  await chatStore.loadMessages(id);
  scrollToBottom();
}

async function handleSend() {
  if (!input.value.trim() || !convStore.currentId) return;
  const msg = input.value;
  input.value = "";
  const conv = convStore.conversations.find((c) => c.id === convStore.currentId);
  await chatStore.send(convStore.currentId, msg, conv?.dify_conversation_id ?? undefined);
  scrollToBottom();
}

function handleSearch() {
  if (searchQuery.value.trim()) {
    convStore.search(searchQuery.value).then((results) => {
      // 简单替换列表为搜索结果
    });
  } else {
    convStore.load();
  }
}

function startRename(conv: Conversation) {
  const title = prompt("重命名对话", conv.title);
  if (title) convStore.update(conv.id, { title });
}

function togglePin(conv: Conversation) {
  convStore.update(conv.id, { pinned: conv.pinned ? 0 : 1 });
}

async function handleDelete(id: number) {
  await convStore.remove(id);
  chatStore.clear();
}

function scrollToBottom() {
  nextTick(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
    }
  });
}

watch(() => chatStore.messages.length, scrollToBottom);

onMounted(() => {
  convStore.load();
});
</script>

<style scoped>
.group-title {
  font-size: 11px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  padding: 8px 12px 4px;
}
</style>
```

- [ ] **Step 5: 本地验证**

```bash
cd packages/web && bun run dev
```

确认 AI 对话页面有左侧对话列表 + 右侧消息流。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/conversations.ts packages/web/src/stores/conversation.ts packages/web/src/stores/chat.ts packages/web/src/pages/AiChat.vue
git commit -m "feat(web): AI 对话页改造 — 历史侧栏 + 消息持久化"
```

---

## Task 12: Web — 个人信息页

**Files:**

- Create: `packages/web/src/pages/Profile.vue`

- [ ] **Step 1: 创建 Profile.vue**

```vue
<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      个人信息
    </h1>

    <div
      class="max-w-xl rounded-lg p-6"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
    >
      <!-- Avatar + Name -->
      <div class="flex items-center gap-4 mb-6 pb-6" style="border-bottom: 1px solid var(--color-border-subtle)">
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center text-xl shrink-0"
          style="background-color: var(--color-surface-05); color: var(--color-text-secondary); font-weight: 510"
        >
          <img
            v-if="auth.user?.avatar_url"
            :src="auth.user.avatar_url"
            class="w-full h-full rounded-full object-cover"
          />
          <span v-else>{{ (auth.user?.name ?? "U")[0] }}</span>
        </div>
        <div>
          <div class="text-lg" style="font-weight: 510; color: var(--color-text-primary)">
            {{ auth.user?.name }}
          </div>
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            style="
              border: 1px solid var(--color-border-solid);
              color: var(--color-text-secondary);
              font-weight: 510;
            "
          >
            {{ auth.user?.role }}
          </span>
        </div>
      </div>

      <!-- Info Fields -->
      <div class="mb-6">
        <div class="text-xs uppercase mb-3" style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em">
          基本信息
        </div>
        <div class="space-y-3">
          <InfoRow label="邮箱" :value="auth.user?.email ?? '未设置'" />
          <InfoRow label="飞书 ID" :value="auth.user?.feishu_user_id ?? '-'" />
          <InfoRow label="注册时间" :value="auth.user?.created_at ?? '-'" />
          <InfoRow label="最近登录" :value="auth.user?.last_login_at ?? '-'" />
        </div>
      </div>

      <!-- Preferences -->
      <div class="mb-6 pb-6" style="border-bottom: 1px solid var(--color-border-subtle)">
        <div class="text-xs uppercase mb-3" style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em">
          偏好设置
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs" style="font-weight: 510; color: var(--color-text-quaternary); width: 80px">主题</span>
          <span class="text-sm" style="color: var(--color-text-secondary)">暗色模式</span>
        </div>
      </div>

      <!-- Logout -->
      <button
        class="text-sm cursor-pointer px-3 py-1.5 rounded-md transition-linear"
        style="
          background: none;
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: var(--color-error-light);
          font-weight: 510;
        "
        @click="handleLogout"
      >
        退出登录
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const auth = useAuthStore();

const InfoRow = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
  },
  setup(props) {
    return () =>
      h("div", { class: "flex items-center gap-3" }, [
        h(
          "span",
          {
            class: "text-xs shrink-0",
            style: "font-weight: 510; color: var(--color-text-quaternary); width: 80px",
          },
          props.label,
        ),
        h(
          "span",
          { class: "text-sm", style: "color: var(--color-text-secondary)" },
          props.value,
        ),
      ]);
  },
});

function handleLogout() {
  auth.logout();
  router.push("/login");
}
</script>
```

- [ ] **Step 2: 本地验证**

访问 /profile 确认展示正确。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Profile.vue
git commit -m "feat(web): 个人信息页"
```

---

## Task 13: Gateway — 工作空间表 + CRUD API + Plane 同步

**Files:**

- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/db/schema.sql`
- Modify: `packages/gateway/src/db/queries.ts`
- Create: `packages/gateway/src/services/workspace-sync.ts`
- Create: `packages/gateway/src/services/workspace-sync.test.ts`
- Create: `packages/gateway/src/routes/workspaces.ts`
- Create: `packages/gateway/src/routes/workspaces.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: 添加 Workspace 类型**

在 `packages/gateway/src/types/index.ts` 末尾增加：

```typescript
// 工作空间
export interface Workspace {
  id: number;
  name: string;
  slug: string;
  plane_project_id: string | null;
  dify_dataset_id: string | null;
  dify_rag_api_key: string | null;
  wiki_path_prefix: string | null;
  git_repos: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  user_id: number;
  role: "admin" | "member";
  created_at: string;
}
```

- [ ] **Step 2: 添加数据库表**

在 `packages/gateway/src/db/schema.sql` 末尾（users 表之后、conversations 表之前）增加：

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plane_project_id TEXT,
  dify_dataset_id TEXT,
  dify_rag_api_key TEXT,
  wiki_path_prefix TEXT,
  git_repos TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
```

同时修改 conversations 表，增加 `workspace_id` 列：

在 conversations 表定义中 `user_id` 行之后增加：

```sql
  workspace_id INTEGER REFERENCES workspaces(id),
```

- [ ] **Step 3: 添加 workspace 查询函数**

在 `packages/gateway/src/db/queries.ts` 中增加：

```typescript
import type { Workspace, WorkspaceMember } from "../types";

// ---- Workspaces ----

export function listUserWorkspaces(userId: number): Workspace[] {
  const db = getDb();
  return db.query(
    `SELECT w.* FROM workspaces w
     INNER JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = ?
     ORDER BY w.name ASC`,
  ).all(userId) as Workspace[];
}

export function getWorkspace(id: number): Workspace | null {
  const db = getDb();
  return db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as Workspace | null;
}

export function getWorkspaceBySlug(slug: string): Workspace | null {
  const db = getDb();
  return db.query("SELECT * FROM workspaces WHERE slug = ?").get(slug) as Workspace | null;
}

export function getWorkspaceByPlaneProject(planeProjectId: string): Workspace | null {
  const db = getDb();
  return db.query("SELECT * FROM workspaces WHERE plane_project_id = ?").get(planeProjectId) as Workspace | null;
}

export function createWorkspace(params: {
  name: string;
  slug: string;
  plane_project_id?: string;
}): Workspace {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO workspaces (name, slug, plane_project_id) VALUES (?, ?, ?)",
    [params.name, params.slug, params.plane_project_id ?? null],
  );
  return getWorkspaceBySlug(params.slug)!;
}

export function updateWorkspaceSettings(id: number, patch: {
  dify_dataset_id?: string;
  dify_rag_api_key?: string;
  wiki_path_prefix?: string;
  git_repos?: string;
}): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.dify_dataset_id !== undefined) { sets.push("dify_dataset_id = ?"); values.push(patch.dify_dataset_id); }
  if (patch.dify_rag_api_key !== undefined) { sets.push("dify_rag_api_key = ?"); values.push(patch.dify_rag_api_key); }
  if (patch.wiki_path_prefix !== undefined) { sets.push("wiki_path_prefix = ?"); values.push(patch.wiki_path_prefix); }
  if (patch.git_repos !== undefined) { sets.push("git_repos = ?"); values.push(patch.git_repos); }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  const result = db.run(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`, values);
  return result.changes > 0;
}

// ---- Workspace Members ----

export function addWorkspaceMember(workspaceId: number, userId: number, role: "admin" | "member" = "member"): void {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
    [workspaceId, userId, role],
  );
}

export function getWorkspaceMemberRole(workspaceId: number, userId: number): string | null {
  const db = getDb();
  const row = db.query(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).get(workspaceId, userId) as { role: string } | null;
  return row?.role ?? null;
}

export function listWorkspaceMembers(workspaceId: number): Array<{ user_id: number; name: string; role: string }> {
  const db = getDb();
  return db.query(
    `SELECT wm.user_id, u.name, wm.role FROM workspace_members wm
     INNER JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ?
     ORDER BY wm.role ASC, u.name ASC`,
  ).all(workspaceId) as Array<{ user_id: number; name: string; role: string }>;
}
```

- [ ] **Step 4: 写 workspace-sync 服务测试**

创建 `packages/gateway/src/services/workspace-sync.test.ts`：

```typescript
import { describe, expect, it, afterEach, mock, beforeEach } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    planeBaseUrl: "http://plane:8000",
    planeApiToken: "test-token",
    planeWorkspaceSlug: "arcflow",
  }),
}));

// Mock fetch for Plane API
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      results: [
        { id: "proj-1", name: "Project Alpha", identifier: "ALPHA" },
        { id: "proj-2", name: "Project Beta", identifier: "BETA" },
      ],
    }),
  }),
);
mock.module("global", () => ({ fetch: mockFetch }));

import { syncPlaneProjects } from "./workspace-sync";
import { getWorkspaceBySlug, upsertUser, addWorkspaceMember, listUserWorkspaces } from "../db/queries";

describe("workspace-sync", () => {
  beforeEach(() => {
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("creates workspaces from Plane projects", async () => {
    const result = await syncPlaneProjects(1);
    expect(result.created).toBe(2);

    const alpha = getWorkspaceBySlug("alpha");
    expect(alpha).not.toBeNull();
    expect(alpha!.name).toBe("Project Alpha");
    expect(alpha!.plane_project_id).toBe("proj-1");
  });

  it("makes sync requester an admin of created workspaces", async () => {
    const user = upsertUser({ feishu_user_id: "ou_admin", name: "Admin" });
    await syncPlaneProjects(user.id);
    const workspaces = listUserWorkspaces(user.id);
    expect(workspaces.length).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

```bash
cd packages/gateway && bun test src/services/workspace-sync.test.ts
```

Expected: FAIL

- [ ] **Step 6: 实现 workspace-sync 服务**

创建 `packages/gateway/src/services/workspace-sync.ts`：

```typescript
import { getConfig } from "../config";
import { createWorkspace, getWorkspaceByPlaneProject, addWorkspaceMember } from "../db/queries";

interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
}

export async function syncPlaneProjects(requestUserId: number): Promise<{ created: number; skipped: number }> {
  const config = getConfig();
  const res = await fetch(`${config.planeBaseUrl}/api/v1/workspaces/${config.planeWorkspaceSlug}/projects/`, {
    headers: { "X-API-Key": config.planeApiToken },
  });

  if (!res.ok) {
    throw new Error(`Plane API error: ${res.status}`);
  }

  const data = (await res.json()) as { results: PlaneProject[] };
  let created = 0;
  let skipped = 0;

  for (const project of data.results) {
    const existing = getWorkspaceByPlaneProject(project.id);
    if (existing) {
      skipped++;
      continue;
    }

    const slug = project.identifier.toLowerCase();
    const workspace = createWorkspace({
      name: project.name,
      slug,
      plane_project_id: project.id,
    });

    // 请求者自动成为 admin
    addWorkspaceMember(workspace.id, requestUserId, "admin");
    created++;
  }

  return { created, skipped };
}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/services/workspace-sync.test.ts
```

Expected: PASS

- [ ] **Step 8: 写 workspaces 路由测试**

创建 `packages/gateway/src/routes/workspaces.test.ts`：

```typescript
import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
    planeBaseUrl: "http://plane:8000",
    planeApiToken: "test-token",
    planeWorkspaceSlug: "arcflow",
  }),
}));

import { workspaceRoutes } from "./workspaces";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

describe("workspace routes", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "member" });
  });

  afterEach(() => {
    closeDb();
  });

  const headers = () => ({ Authorization: `Bearer ${token}` });

  it("GET / returns only user's workspaces", async () => {
    const ws = createWorkspace({ name: "Alpha", slug: "alpha", plane_project_id: "p1" });
    addWorkspaceMember(ws.id, userId, "admin");
    // Create another workspace NOT belonging to user
    createWorkspace({ name: "Beta", slug: "beta", plane_project_id: "p2" });

    const res = await workspaceRoutes.request("/", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alpha");
  });

  it("PATCH /:id/settings updates workspace config (admin)", async () => {
    const ws = createWorkspace({ name: "Alpha", slug: "alpha" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await workspaceRoutes.request(`/${ws.id}/settings`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ dify_dataset_id: "ds-123", wiki_path_prefix: "/alpha/" }),
    });
    expect(res.status).toBe(200);
  });

  it("PATCH /:id/settings rejects non-admin", async () => {
    const ws = createWorkspace({ name: "Alpha", slug: "alpha" });
    addWorkspaceMember(ws.id, userId, "member");

    const res = await workspaceRoutes.request(`/${ws.id}/settings`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ dify_dataset_id: "ds-123" }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 9: 实现 workspaces 路由**

创建 `packages/gateway/src/routes/workspaces.ts`：

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  listUserWorkspaces,
  getWorkspace,
  updateWorkspaceSettings,
  getWorkspaceMemberRole,
  listWorkspaceMembers,
} from "../db/queries";
import { syncPlaneProjects } from "../services/workspace-sync";

export const workspaceRoutes = new Hono();

workspaceRoutes.use("/*", authMiddleware);

workspaceRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  const data = listUserWorkspaces(userId);
  return c.json({ data });
});

workspaceRoutes.get("/:id", (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const role = getWorkspaceMemberRole(id, userId);
  if (!role) return c.json({ error: "Not found" }, 404);
  const workspace = getWorkspace(id);
  const members = listWorkspaceMembers(id);
  return c.json({ ...workspace, members, user_role: role });
});

workspaceRoutes.patch("/:id/settings", async (c) => {
  const userId = c.get("userId") as number;
  const id = Number(c.req.param("id"));
  const role = getWorkspaceMemberRole(id, userId);
  if (role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    dify_dataset_id?: string;
    dify_rag_api_key?: string;
    wiki_path_prefix?: string;
    git_repos?: string;
  }>();

  updateWorkspaceSettings(id, body);
  return c.json({ ok: true });
});

workspaceRoutes.post("/sync-plane", async (c) => {
  const userId = c.get("userId") as number;
  try {
    const result = await syncPlaneProjects(userId);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Sync failed" }, 500);
  }
});
```

- [ ] **Step 10: 注册路由**

修改 `packages/gateway/src/index.ts`，增加：

```typescript
import { workspaceRoutes } from "./routes/workspaces";
```

在 conversations 路由注册之后增加：

```typescript
app.route("/api/workspaces", workspaceRoutes);
```

- [ ] **Step 11: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/routes/workspaces.test.ts && bun test src/services/workspace-sync.test.ts
```

Expected: PASS

- [ ] **Step 12: 运行全量测试**

```bash
cd packages/gateway && bun test src/
```

Expected: 全部 PASS

- [ ] **Step 13: Commit**

```bash
git add packages/gateway/src/types/index.ts packages/gateway/src/db/schema.sql packages/gateway/src/db/queries.ts packages/gateway/src/services/workspace-sync.ts packages/gateway/src/services/workspace-sync.test.ts packages/gateway/src/routes/workspaces.ts packages/gateway/src/routes/workspaces.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): 工作空间表 + CRUD API + Plane 同步"
```

---

## Task 14: Gateway — 工作空间上下文中间件 + API 改造

**Files:**

- Create: `packages/gateway/src/middleware/workspace.ts`
- Create: `packages/gateway/src/middleware/workspace.test.ts`
- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/routes/conversations.ts`

- [ ] **Step 1: 写 workspace 中间件测试**

创建 `packages/gateway/src/middleware/workspace.test.ts`：

```typescript
import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { workspaceMiddleware } from "./workspace";
import { authMiddleware } from "./auth";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

describe("workspace middleware", () => {
  beforeEach(() => { getDb(); });
  afterEach(() => { closeDb(); });

  function createTestApp() {
    const app = new Hono();
    app.use("/*", authMiddleware);
    app.use("/*", workspaceMiddleware);
    app.get("/test", (c) => c.json({ workspaceId: c.get("workspaceId") }));
    return app;
  }

  it("extracts workspace from X-Workspace-Id header", async () => {
    const user = upsertUser({ feishu_user_id: "ou_t", name: "T" });
    const ws = createWorkspace({ name: "A", slug: "a" });
    addWorkspaceMember(ws.id, user.id, "member");
    const token = await signJwt({ sub: user.id, role: "member" });

    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": String(ws.id) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(ws.id);
  });

  it("returns 403 if user is not a workspace member", async () => {
    const user = upsertUser({ feishu_user_id: "ou_t2", name: "T2" });
    const ws = createWorkspace({ name: "B", slug: "b" });
    // NOT adding user as member
    const token = await signJwt({ sub: user.id, role: "member" });

    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": String(ws.id) },
    });
    expect(res.status).toBe(403);
  });

  it("passes without workspace header (optional)", async () => {
    const user = upsertUser({ feishu_user_id: "ou_t3", name: "T3" });
    const token = await signJwt({ sub: user.id, role: "member" });

    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBeNull();
  });
});
```

- [ ] **Step 2: 实现 workspace 中间件**

创建 `packages/gateway/src/middleware/workspace.ts`：

```typescript
import type { MiddlewareHandler } from "hono";
import { getWorkspaceMemberRole } from "../db/queries";

export const workspaceMiddleware: MiddlewareHandler = async (c, next) => {
  const wsId = c.req.header("X-Workspace-Id") || c.req.query("workspace_id");

  if (!wsId) {
    c.set("workspaceId", null);
    await next();
    return;
  }

  const workspaceId = Number(wsId);
  if (isNaN(workspaceId)) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const userId = c.get("userId") as number;
  const role = getWorkspaceMemberRole(workspaceId, userId);
  if (!role) {
    return c.json({ error: "Not a member of this workspace" }, 403);
  }

  c.set("workspaceId", workspaceId);
  c.set("workspaceRole", role);
  await next();
};
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd packages/gateway && bun test src/middleware/workspace.test.ts
```

Expected: PASS

- [ ] **Step 4: 改造 conversations 路由增加 workspace 过滤**

修改 `packages/gateway/src/routes/conversations.ts`：

在 `authMiddleware` 之后增加 workspace 中间件：

```typescript
import { workspaceMiddleware } from "../middleware/workspace";

conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", workspaceMiddleware);
```

修改 `GET /` 路由，增加 workspace_id 过滤：

```typescript
conversationRoutes.get("/", (c) => {
  const userId = c.get("userId") as number;
  const workspaceId = c.get("workspaceId") as number | null;
  const data = listConversations(userId, workspaceId);
  return c.json({ data });
});
```

修改 `POST /` 路由，创建时关联 workspace_id：

```typescript
conversationRoutes.post("/", async (c) => {
  const userId = c.get("userId") as number;
  const workspaceId = c.get("workspaceId") as number | null;
  const body = await c.req.json<{ title?: string }>().catch(() => ({}));
  const conv = createConversation(userId, body.title, workspaceId);
  return c.json(conv, 201);
});
```

相应更新 `db/queries.ts` 中的 `listConversations` 和 `createConversation` 函数以支持 workspace_id 参数：

```typescript
export function listConversations(userId: number, workspaceId?: number | null): Conversation[] {
  const db = getDb();
  if (workspaceId) {
    return db.query(
      "SELECT * FROM conversations WHERE user_id = ? AND workspace_id = ? ORDER BY pinned DESC, updated_at DESC",
    ).all(userId, workspaceId) as Conversation[];
  }
  return db.query(
    "SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC",
  ).all(userId) as Conversation[];
}

export function createConversation(userId: number, title?: string, workspaceId?: number | null): Conversation {
  const db = getDb();
  const result = db.run(
    "INSERT INTO conversations (user_id, workspace_id, title) VALUES (?, ?, ?)",
    [userId, workspaceId ?? null, title ?? "新对话"],
  );
  return db.query("SELECT * FROM conversations WHERE id = ?").get(result.lastInsertRowid) as Conversation;
}
```

- [ ] **Step 5: 运行全量测试**

```bash
cd packages/gateway && bun test src/
```

Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/middleware/workspace.ts packages/gateway/src/middleware/workspace.test.ts packages/gateway/src/routes/conversations.ts packages/gateway/src/routes/api.ts packages/gateway/src/db/queries.ts
git commit -m "feat(gateway): workspace 上下文中间件 + API workspace 化"
```

---

## Task 15: Web — 工作空间 Store + 切换器 + 设置页

**Files:**

- Create: `packages/web/src/api/workspaces.ts`
- Create: `packages/web/src/stores/workspace.ts`
- Modify: `packages/web/src/components/AppLayout.vue`
- Create: `packages/web/src/pages/WorkspaceSettings.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/api/workflow.ts`

- [ ] **Step 1: 创建 workspaces API**

创建 `packages/web/src/api/workspaces.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  plane_project_id: string | null;
  dify_dataset_id: string | null;
  dify_rag_api_key: string | null;
  wiki_path_prefix: string | null;
  git_repos: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceDetail extends Workspace {
  members: Array<{ user_id: number; name: string; role: string }>;
  user_role: string;
}

export async function fetchWorkspaces(): Promise<{ data: Workspace[] }> {
  const res = await fetch(`${API_BASE}/api/workspaces`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load workspaces");
  return res.json();
}

export async function fetchWorkspaceDetail(id: number): Promise<WorkspaceDetail> {
  const res = await fetch(`${API_BASE}/api/workspaces/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load workspace");
  return res.json();
}

export async function updateWorkspaceSettings(id: number, patch: {
  dify_dataset_id?: string;
  dify_rag_api_key?: string;
  wiki_path_prefix?: string;
  git_repos?: string;
}): Promise<void> {
  await fetch(`${API_BASE}/api/workspaces/${id}/settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
}

export async function syncPlaneProjects(): Promise<{ created: number; skipped: number }> {
  const res = await fetch(`${API_BASE}/api/workspaces/sync-plane`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}
```

- [ ] **Step 2: 创建 workspace store**

创建 `packages/web/src/stores/workspace.ts`：

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchWorkspaces,
  fetchWorkspaceDetail,
  syncPlaneProjects,
  type Workspace,
  type WorkspaceDetail,
} from "../api/workspaces";

const WS_KEY = "arcflow_workspace_id";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<Workspace[]>([]);
  const currentId = ref<number | null>(Number(localStorage.getItem(WS_KEY)) || null);
  const currentDetail = ref<WorkspaceDetail | null>(null);
  const loading = ref(false);

  const current = computed(() =>
    workspaces.value.find((w) => w.id === currentId.value) ?? null,
  );

  const isAdmin = computed(() => currentDetail.value?.user_role === "admin");

  async function load() {
    loading.value = true;
    try {
      const res = await fetchWorkspaces();
      workspaces.value = res.data;
      // 自动选中第一个（如果当前没有选中或选中的不存在）
      if (workspaces.value.length > 0) {
        if (!currentId.value || !workspaces.value.find((w) => w.id === currentId.value)) {
          select(workspaces.value[0].id);
        }
      }
    } finally {
      loading.value = false;
    }
  }

  async function select(id: number) {
    currentId.value = id;
    localStorage.setItem(WS_KEY, String(id));
    try {
      currentDetail.value = await fetchWorkspaceDetail(id);
    } catch {
      currentDetail.value = null;
    }
  }

  async function sync() {
    const result = await syncPlaneProjects();
    await load();
    return result;
  }

  return { workspaces, currentId, current, currentDetail, isAdmin, loading, load, select, sync };
});
```

- [ ] **Step 3: 改造 AppLayout.vue 增加工作空间切换器**

修改 `packages/web/src/components/AppLayout.vue` 的侧边栏顶部区域。

将 Logo 区域替换为工作空间切换器：

```vue
<!-- Workspace Switcher (替换原有 Logo 区域) -->
<div class="px-3 py-3 relative" style="border-bottom: 1px solid var(--color-border-subtle)">
  <button
    class="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left cursor-pointer transition-linear"
    style="background: none; border: none; color: var(--color-text-primary)"
    @click="wsDropdownOpen = !wsDropdownOpen"
  >
    <span class="text-sm truncate" style="font-weight: 510">
      {{ wsStore.current?.name ?? 'ArcFlow' }}
    </span>
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2"
      style="opacity: 0.5"
      :style="{ transform: wsDropdownOpen ? 'rotate(180deg)' : '' }"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>

  <!-- Dropdown -->
  <div
    v-if="wsDropdownOpen"
    class="absolute left-2 right-2 top-full mt-1 rounded-xl py-1 z-50"
    style="
      background-color: var(--color-bg-surface);
      border: 1px solid var(--color-border-default);
      box-shadow: rgba(0,0,0,0.4) 0px 2px 4px;
    "
  >
    <div
      v-for="ws in wsStore.workspaces"
      :key="ws.id"
      class="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-linear text-xs"
      :style="{
        color: ws.id === wsStore.currentId ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        backgroundColor: ws.id === wsStore.currentId ? 'var(--color-surface-05)' : 'transparent',
      }"
      @click="switchWorkspace(ws.id)"
    >
      <span style="width: 14px">{{ ws.id === wsStore.currentId ? '✓' : '' }}</span>
      <div class="min-w-0">
        <div class="truncate" style="font-weight: 510">{{ ws.name }}</div>
        <div style="color: var(--color-text-quaternary); font-size: 10px">{{ ws.slug }}</div>
      </div>
    </div>
    <div style="border-top: 1px solid var(--color-border-subtle); margin-top: 4px; padding-top: 4px">
      <button
        class="w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-linear"
        style="background: none; border: none; color: var(--color-accent-violet)"
        @click="handleSyncPlane"
      >
        同步 Plane 项目
      </button>
    </div>
  </div>
</div>
```

在 script setup 中增加：

```typescript
import { useWorkspaceStore } from "../stores/workspace";

const wsStore = useWorkspaceStore();
const wsDropdownOpen = ref(false);

function switchWorkspace(id: number) {
  wsStore.select(id);
  wsDropdownOpen.value = false;
  // 重新加载当前页面数据
  window.location.reload();
}

async function handleSyncPlane() {
  await wsStore.sync();
  wsDropdownOpen.value = false;
}
```

在导航项中增加工作空间设置（仅 admin）：

```typescript
const navItems = computed(() => {
  const items = [
    { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
    { path: "/chat", label: "AI 对话", icon: MessageSquare },
    { path: "/workflows", label: "工作流", icon: List },
    { path: "/trigger", label: "触发工作流", icon: Zap },
  ];
  if (wsStore.isAdmin) {
    items.push({ path: "/workspace/settings", label: "工作空间设置", icon: Settings });
  }
  return items;
});
```

在 onMounted（App.vue）中加载工作空间：

```typescript
onMounted(async () => {
  if (auth.token) {
    await auth.loadUser();
    await wsStore.load();
  }
  authReady.value = true;
});
```

- [ ] **Step 4: 改造 API request 函数增加 X-Workspace-Id header**

修改 `packages/web/src/api/workflow.ts` 的 `request` 函数：

```typescript
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("arcflow_token");
  const wsId = localStorage.getItem("arcflow_workspace_id");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (wsId) headers["X-Workspace-Id"] = wsId;

  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("arcflow_token");
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

同样更新 `packages/web/src/api/conversations.ts` 的 `authHeaders()` 函数：

```typescript
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  const wsId = localStorage.getItem("arcflow_workspace_id");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (wsId) headers["X-Workspace-Id"] = wsId;
  return headers;
}
```

- [ ] **Step 5: 创建工作空间设置页**

创建 `packages/web/src/pages/WorkspaceSettings.vue`：

```vue
<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      工作空间设置
    </h1>

    <div v-if="wsStore.currentDetail" class="max-w-2xl space-y-6">
      <!-- Basic Info (readonly) -->
      <SettingsSection title="基本信息">
        <FieldRow label="名称" :value="wsStore.currentDetail.name" />
        <FieldRow label="Slug" :value="wsStore.currentDetail.slug" />
        <FieldRow label="Plane 项目" :value="wsStore.currentDetail.plane_project_id ?? '未关联'" />
      </SettingsSection>

      <!-- Knowledge Base Config -->
      <SettingsSection title="知识库配置">
        <FieldInput v-model="form.dify_dataset_id" label="Dify Dataset ID" placeholder="dataset-xxxxx" />
        <FieldInput v-model="form.dify_rag_api_key" label="Dify RAG API Key" placeholder="app-xxxxx" />
        <FieldInput v-model="form.wiki_path_prefix" label="Wiki.js 路径前缀" placeholder="/project-name/" />
      </SettingsSection>

      <!-- Git Repos Config -->
      <SettingsSection title="代码仓库">
        <FieldInput v-model="gitRepos.backend" label="后端仓库 URL" placeholder="https://git.example.com/org/backend.git" />
        <FieldInput v-model="gitRepos.vue3" label="Vue3 仓库 URL" placeholder="https://git.example.com/org/web.git" />
        <FieldInput v-model="gitRepos.flutter" label="Flutter 仓库 URL" placeholder="" />
        <FieldInput v-model="gitRepos.android" label="Android 仓库 URL" placeholder="" />
      </SettingsSection>

      <!-- Members (readonly) -->
      <SettingsSection title="成员">
        <div v-for="m in wsStore.currentDetail.members" :key="m.user_id" class="flex items-center gap-3 py-1.5">
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center text-xs"
            style="background-color: var(--color-surface-05); color: var(--color-text-secondary); font-weight: 510"
          >
            {{ m.name[0] }}
          </div>
          <span class="text-sm" style="color: var(--color-text-secondary)">{{ m.name }}</span>
          <span
            class="text-xs px-1.5 py-0.5 rounded-full"
            style="border: 1px solid var(--color-border-solid); color: var(--color-text-tertiary); font-weight: 510"
          >
            {{ m.role }}
          </span>
        </div>
      </SettingsSection>

      <!-- Save Button -->
      <button
        class="px-4 py-2 rounded-md text-sm text-white cursor-pointer transition-linear"
        style="background-color: var(--color-accent); font-weight: 510; border: none"
        @click="handleSave"
      >
        保存配置
      </button>
      <span v-if="saved" class="text-xs ml-3" style="color: var(--color-success)">已保存</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, defineComponent, h } from "vue";
import { useWorkspaceStore } from "../stores/workspace";
import { updateWorkspaceSettings } from "../api/workspaces";

const wsStore = useWorkspaceStore();
const saved = ref(false);

const form = reactive({
  dify_dataset_id: "",
  dify_rag_api_key: "",
  wiki_path_prefix: "",
});

const gitRepos = reactive({
  backend: "",
  vue3: "",
  flutter: "",
  android: "",
});

const SettingsSection = defineComponent({
  props: { title: { type: String, required: true } },
  setup(props, { slots }) {
    return () =>
      h(
        "div",
        {
          class: "rounded-lg p-5",
          style: "background-color: var(--color-surface-02); border: 1px solid var(--color-border-default)",
        },
        [
          h(
            "div",
            {
              class: "text-xs uppercase mb-4",
              style: "font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em",
            },
            props.title,
          ),
          h("div", { class: "space-y-3" }, slots.default?.()),
        ],
      );
  },
});

const FieldRow = defineComponent({
  props: { label: String, value: String },
  setup(props) {
    return () =>
      h("div", { class: "flex items-center gap-3" }, [
        h("span", { class: "text-xs shrink-0", style: "font-weight: 510; color: var(--color-text-quaternary); width: 120px" }, props.label),
        h("span", { class: "text-sm", style: "color: var(--color-text-secondary)" }, props.value),
      ]);
  },
});

const FieldInput = defineComponent({
  props: { modelValue: String, label: String, placeholder: String },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("div", { class: "flex items-center gap-3" }, [
        h("label", { class: "text-xs shrink-0", style: "font-weight: 510; color: var(--color-text-quaternary); width: 120px" }, props.label),
        h("input", {
          value: props.modelValue,
          placeholder: props.placeholder,
          class: "flex-1 px-3 py-1.5 rounded-md text-sm outline-none",
          style: "background-color: var(--color-surface-02); border: 1px solid var(--color-border-default); color: var(--color-text-secondary)",
          onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
        }),
      ]);
  },
});

async function handleSave() {
  if (!wsStore.currentId) return;
  await updateWorkspaceSettings(wsStore.currentId, {
    ...form,
    git_repos: JSON.stringify(gitRepos),
  });
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 2000);
}

onMounted(() => {
  if (wsStore.currentDetail) {
    form.dify_dataset_id = wsStore.currentDetail.dify_dataset_id ?? "";
    form.dify_rag_api_key = wsStore.currentDetail.dify_rag_api_key ?? "";
    form.wiki_path_prefix = wsStore.currentDetail.wiki_path_prefix ?? "";
    try {
      const repos = JSON.parse(wsStore.currentDetail.git_repos || "{}");
      gitRepos.backend = repos.backend ?? "";
      gitRepos.vue3 = repos.vue3 ?? "";
      gitRepos.flutter = repos.flutter ?? "";
      gitRepos.android = repos.android ?? "";
    } catch {
      // ignore
    }
  }
});
</script>
```

- [ ] **Step 6: 更新路由**

修改 `packages/web/src/router/index.ts`，在 `/profile` 路由之前增加：

```typescript
{
  path: "/workspace/settings",
  name: "workspace-settings",
  component: () => import("../pages/WorkspaceSettings.vue"),
},
```

- [ ] **Step 7: 本地验证**

```bash
cd packages/web && bun run dev
```

验证：

1. 侧边栏顶部显示工作空间切换器
2. 可切换工作空间
3. "同步 Plane 项目" 按钮可用
4. 工作空间设置页可配置保存

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api/workspaces.ts packages/web/src/stores/workspace.ts packages/web/src/components/AppLayout.vue packages/web/src/pages/WorkspaceSettings.vue packages/web/src/router/index.ts packages/web/src/api/workflow.ts packages/web/src/api/conversations.ts packages/web/src/App.vue
git commit -m "feat(web): 工作空间切换器 + 设置页 + API workspace 化"
```

---

## Task 16: 端到端验证 + 全量测试

- [ ] **Step 1: 运行 Gateway 全量测试**

```bash
cd packages/gateway && bun test src/
```

Expected: 全部 PASS

- [ ] **Step 2: 运行 Web 构建验证**

```bash
cd packages/web && bun run build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: 本地联调验证**

同时启动 Gateway 和 Web：

```bash
cd packages/gateway && bun run dev &
cd packages/web && bun run dev
```

验证清单：

1. 访问 / 自动跳转 /login
2. 登录页显示 Linear 暗色风格
3. 登录后自动加载工作空间列表
4. 侧边栏顶部显示当前工作空间名，可切换
5. "同步 Plane 项目" 创建工作空间
6. 工作空间设置页可配置 Dify/Wiki/Git 关联（仅 admin）
7. Dashboard 显示 KPI 卡片和执行列表（当前工作空间范围）
8. 工作流页面展示正确
9. AI 对话可创建/选择对话（对话关联当前工作空间）
10. 切换工作空间后对话列表更新
11. 个人信息页展示用户信息
12. 退出登录回到 /login

- [ ] **Step 4: Commit 任何修复**

```bash
git add -A && git commit -m "fix: 端到端联调修复"
```

（如无修复则跳过）
