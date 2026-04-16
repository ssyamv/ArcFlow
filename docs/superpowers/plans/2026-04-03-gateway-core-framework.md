> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Gateway 核心框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建胶水服务（Gateway Service）的核心框架，包括数据库层、配置管理、类型定义、路由框架、Webhook 中间件（验签 + 去重），使其具备接收和处理 Webhook 事件的基础能力。

**Architecture:** Bun + Hono 分层架构。入口 index.ts 组装路由和中间件，config.ts 管理环境变量，db/ 层封装 bun:sqlite，middleware/ 层提供验签和去重，routes/ 层定义路由，services/ 层实现业务逻辑（本计划仅搭框架，外部服务集成在后续计划中）。

**Tech Stack:** Bun runtime, Hono web framework, bun:sqlite, bun:test

**Spec:** `docs/superpowers/specs/2026-04-02-gateway-service-design.md`

---

## File Structure

```text
packages/gateway/
├── src/
│   ├── index.ts              # 入口（已有，需重构）
│   ├── config.ts              # 环境变量配置
│   ├── types/
│   │   └── index.ts           # TypeScript 类型定义
│   ├── db/
│   │   ├── index.ts           # SQLite 初始化
│   │   ├── schema.sql         # 建表 SQL
│   │   └── queries.ts         # 查询函数
│   ├── middleware/
│   │   ├── logger.ts          # 请求日志
│   │   ├── verify.ts          # Webhook 验签
│   │   └── dedup.ts           # Webhook 去重
│   ├── routes/
│   │   ├── health.ts          # 健康检查路由
│   │   ├── webhook.ts         # Webhook 路由（4 个来源）
│   │   └── api.ts             # 内部 API 路由
│   ├── services/
│   │   └── workflow.ts        # 工作流编排（框架）
│   └── scheduler.ts           # 定时任务（webhook_event 清理）
├── .env.example               # 环境变量模板
└── src/
    └── index.test.ts          # 已有测试（需重构）
```

---

### Task 1: 类型定义

**Files:**

- Create: `packages/gateway/src/types/index.ts`

- [ ] **Step 1: 编写类型定义**

```typescript
// Webhook 来源
export type WebhookSource = "plane" | "git" | "cicd" | "feishu";

// 工作流类型
export type WorkflowType =
  | "prd_to_tech"
  | "tech_to_openapi"
  | "bug_analysis"
  | "code_gen";

// 工作流触发来源
export type TriggerSource = "plane_webhook" | "cicd_webhook" | "manual";

// 工作流执行状态
export type WorkflowStatus = "pending" | "running" | "success" | "failed";

// Bug 修复状态
export type BugFixStatus = "pending" | "fixing" | "fixed" | "escalated";

// 工作流执行记录
export interface WorkflowExecution {
  id: number;
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id: string | null;
  input_path: string | null;
  output_path: string | null;
  status: WorkflowStatus;
  error_message: string | null;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// Bug 修复重试记录
export interface BugFixRetry {
  id: number;
  plane_issue_id: string;
  retry_count: number;
  last_attempt_at: string | null;
  status: BugFixStatus;
  created_at: string;
}

// Webhook 事件记录
export interface WebhookEvent {
  event_id: string;
  source: WebhookSource;
  received_at: string;
}

// API 请求/响应类型
export interface TriggerWorkflowRequest {
  workflow_type: WorkflowType;
  plane_issue_id: string;
  params?: {
    input_path?: string;
    target_repos?: string[];
  };
}

export interface TriggerWorkflowResponse {
  execution_id: number;
  status: WorkflowStatus;
  message: string;
}

export interface ExecutionListResponse {
  data: WorkflowExecution[];
  total: number;
}
```

- [ ] **Step 2: 运行 lint 检查**

Run: `cd packages/gateway && bun run lint`
Expected: PASS，无 warning

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/types/index.ts
git commit -m "feat(gateway): add TypeScript type definitions"
```

---

### Task 2: 环境变量配置

**Files:**

- Create: `packages/gateway/src/config.ts`
- Create: `packages/gateway/.env.example`

- [ ] **Step 1: 编写测试**

在 `packages/gateway/src/config.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { getConfig } from "./config";

describe("config", () => {
  it("returns default values when env vars are not set", () => {
    const config = getConfig();
    expect(config.port).toBe(3100);
    expect(config.claudeCodeTimeout).toBe(600000);
  });

  it("reads PORT from env", () => {
    const original = process.env.PORT;
    process.env.PORT = "8080";
    const config = getConfig();
    expect(config.port).toBe(8080);
    process.env.PORT = original;
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/gateway && bun test src/config.test.ts`
Expected: FAIL — `getConfig` not found

- [ ] **Step 3: 实现 config.ts**

```typescript
export interface Config {
  port: number;

  // Dify
  difyBaseUrl: string;
  difyApiKey: string;

  // Plane
  planeBaseUrl: string;
  planeApiToken: string;
  planeWorkspaceSlug: string;

  // Git
  docsGitRepo: string;
  backendGitRepo: string;
  vue3GitRepo: string;
  flutterGitRepo: string;
  androidGitRepo: string;
  gitWorkDir: string;

  // Webhook secrets
  planeWebhookSecret: string;
  gitWebhookSecret: string;
  cicdWebhookSecret: string;

  // 飞书
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  feishuEncryptKey: string;

  // Wiki.js
  wikijsBaseUrl: string;
  wikijsApiKey: string;

  // Claude Code
  claudeCodeTimeout: number;
}

export function getConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3100,

    difyBaseUrl: process.env.DIFY_BASE_URL ?? "",
    difyApiKey: process.env.DIFY_API_KEY ?? "",

    planeBaseUrl: process.env.PLANE_BASE_URL ?? "",
    planeApiToken: process.env.PLANE_API_TOKEN ?? "",
    planeWorkspaceSlug: process.env.PLANE_WORKSPACE_SLUG ?? "",

    docsGitRepo: process.env.DOCS_GIT_REPO ?? "",
    backendGitRepo: process.env.BACKEND_GIT_REPO ?? "",
    vue3GitRepo: process.env.VUE3_GIT_REPO ?? "",
    flutterGitRepo: process.env.FLUTTER_GIT_REPO ?? "",
    androidGitRepo: process.env.ANDROID_GIT_REPO ?? "",
    gitWorkDir: process.env.GIT_WORK_DIR ?? "/tmp/gateway-git",

    planeWebhookSecret: process.env.PLANE_WEBHOOK_SECRET ?? "",
    gitWebhookSecret: process.env.GIT_WEBHOOK_SECRET ?? "",
    cicdWebhookSecret: process.env.CICD_WEBHOOK_SECRET ?? "",

    feishuAppId: process.env.FEISHU_APP_ID ?? "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
    feishuVerificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    feishuEncryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",

    wikijsBaseUrl: process.env.WIKIJS_BASE_URL ?? "",
    wikijsApiKey: process.env.WIKIJS_API_KEY ?? "",

    claudeCodeTimeout: Number(process.env.CLAUDE_CODE_TIMEOUT) || 600000,
  };
}
```

- [ ] **Step 4: 创建 .env.example**

```env
# 服务
PORT=3100

# Dify
DIFY_BASE_URL=http://localhost:3001
DIFY_API_KEY=

# Plane
PLANE_BASE_URL=http://localhost:80
PLANE_API_TOKEN=
PLANE_WORKSPACE_SLUG=

# Git
DOCS_GIT_REPO=git@localhost:docs.git
BACKEND_GIT_REPO=git@localhost:backend.git
VUE3_GIT_REPO=git@localhost:vue3.git
FLUTTER_GIT_REPO=git@localhost:flutter.git
ANDROID_GIT_REPO=git@localhost:android.git
GIT_WORK_DIR=/tmp/gateway-git

# Webhook 验签
PLANE_WEBHOOK_SECRET=
GIT_WEBHOOK_SECRET=
CICD_WEBHOOK_SECRET=

# 飞书
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=

# Wiki.js
WIKIJS_BASE_URL=http://localhost:3000
WIKIJS_API_KEY=

# Claude Code
CLAUDE_CODE_TIMEOUT=600000
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd packages/gateway && bun test src/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config.ts packages/gateway/src/config.test.ts packages/gateway/.env.example
git commit -m "feat(gateway): add config management and .env.example"
```

---

### Task 3: 数据库层

**Files:**

- Create: `packages/gateway/src/db/schema.sql`
- Create: `packages/gateway/src/db/index.ts`
- Create: `packages/gateway/src/db/queries.ts`
- Create: `packages/gateway/src/db/queries.test.ts`

- [ ] **Step 1: 编写 schema.sql**

```sql
CREATE TABLE IF NOT EXISTS workflow_execution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  plane_issue_id TEXT,
  input_path TEXT,
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bug_fix_retry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plane_issue_id TEXT NOT NULL UNIQUE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_event (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: 编写 db/index.ts（SQLite 初始化）**

```typescript
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database(
      process.env.NODE_ENV === "test" ? ":memory:" : "gateway.db",
    );
    db.exec("PRAGMA journal_mode = WAL;");
    const schema = readFileSync(
      join(import.meta.dir, "schema.sql"),
      "utf-8",
    );
    db.exec(schema);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 3: 编写查询函数测试**

在 `packages/gateway/src/db/queries.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "./index";
import {
  createWorkflowExecution,
  getWorkflowExecution,
  listWorkflowExecutions,
  updateWorkflowStatus,
  recordWebhookEvent,
  isEventProcessed,
  cleanExpiredEvents,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
} from "./queries";

describe("workflow_execution queries", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb(); // init in-memory db
  });

  afterEach(() => {
    closeDb();
  });

  it("creates and retrieves a workflow execution", () => {
    const id = createWorkflowExecution({
      workflow_type: "prd_to_tech",
      trigger_source: "plane_webhook",
      plane_issue_id: "ISSUE-1",
      input_path: "/prd/test.md",
    });
    expect(id).toBeGreaterThan(0);

    const exec = getWorkflowExecution(id);
    expect(exec).not.toBeNull();
    expect(exec!.workflow_type).toBe("prd_to_tech");
    expect(exec!.status).toBe("pending");
  });

  it("updates workflow status", () => {
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });
    updateWorkflowStatus(id, "running");
    expect(getWorkflowExecution(id)!.status).toBe("running");

    updateWorkflowStatus(id, "success");
    const exec = getWorkflowExecution(id)!;
    expect(exec.status).toBe("success");
    expect(exec.completed_at).not.toBeNull();
  });

  it("lists workflow executions with filters", () => {
    createWorkflowExecution({
      workflow_type: "prd_to_tech",
      trigger_source: "plane_webhook",
    });
    createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    const all = listWorkflowExecutions({});
    expect(all.data.length).toBe(2);
    expect(all.total).toBe(2);

    const filtered = listWorkflowExecutions({
      workflow_type: "code_gen",
    });
    expect(filtered.data.length).toBe(1);
    expect(filtered.data[0].workflow_type).toBe("code_gen");
  });
});

describe("webhook_event queries", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("records and checks event dedup", () => {
    expect(isEventProcessed("evt-1")).toBe(false);
    recordWebhookEvent("evt-1", "plane");
    expect(isEventProcessed("evt-1")).toBe(true);
  });

  it("handles duplicate event recording gracefully", () => {
    recordWebhookEvent("evt-2", "git");
    // second insert should not throw
    recordWebhookEvent("evt-2", "git");
    expect(isEventProcessed("evt-2")).toBe(true);
  });

  it("cleans expired events", () => {
    recordWebhookEvent("evt-old", "plane");
    // manually backdate the event
    getDb().run(
      "UPDATE webhook_event SET received_at = datetime('now', '-25 hours') WHERE event_id = ?",
      ["evt-old"],
    );
    cleanExpiredEvents();
    expect(isEventProcessed("evt-old")).toBe(false);
  });
});

describe("bug_fix_retry queries", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("creates and retrieves bug fix retry", () => {
    createBugFixRetry("BUG-1");
    const retry = getBugFixRetry("BUG-1");
    expect(retry).not.toBeNull();
    expect(retry!.retry_count).toBe(0);
    expect(retry!.status).toBe("pending");
  });

  it("increments retry count", () => {
    createBugFixRetry("BUG-2");
    incrementBugFixRetry("BUG-2");
    const retry = getBugFixRetry("BUG-2");
    expect(retry!.retry_count).toBe(1);
    expect(retry!.status).toBe("fixing");
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `cd packages/gateway && bun test src/db/queries.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 5: 实现 queries.ts**

```typescript
import { getDb } from "./index";
import type {
  WorkflowExecution,
  WorkflowType,
  WorkflowStatus,
  TriggerSource,
  WebhookSource,
  BugFixRetry,
  BugFixStatus,
} from "../types";

// --- workflow_execution ---

interface CreateExecutionParams {
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
}

export function createWorkflowExecution(
  params: CreateExecutionParams,
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO workflow_execution (workflow_type, trigger_source, plane_issue_id, input_path, started_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  );
  stmt.run(
    params.workflow_type,
    params.trigger_source,
    params.plane_issue_id ?? null,
    params.input_path ?? null,
  );
  return db.query("SELECT last_insert_rowid() as id").get() as number;
}

export function getWorkflowExecution(
  id: number,
): WorkflowExecution | null {
  const db = getDb();
  return db
    .query("SELECT * FROM workflow_execution WHERE id = ?")
    .get(id) as WorkflowExecution | null;
}

interface ListFilters {
  workflow_type?: WorkflowType;
  status?: WorkflowStatus;
  limit?: number;
}

export function listWorkflowExecutions(
  filters: ListFilters,
): { data: WorkflowExecution[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.workflow_type) {
    conditions.push("workflow_type = ?");
    params.push(filters.workflow_type);
  }
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 20;

  const data = db
    .query(
      `SELECT * FROM workflow_execution ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as WorkflowExecution[];

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM workflow_execution ${where}`)
    .get(...params) as { count: number };

  return { data, total: countRow.count };
}

export function updateWorkflowStatus(
  id: number,
  status: WorkflowStatus,
  errorMessage?: string,
): void {
  const db = getDb();
  if (status === "success" || status === "failed") {
    db.run(
      `UPDATE workflow_execution
       SET status = ?, error_message = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [status, errorMessage ?? null, id],
    );
  } else {
    db.run(
      `UPDATE workflow_execution SET status = ?, started_at = datetime('now') WHERE id = ?`,
      [status, id],
    );
  }
}

// --- webhook_event ---

export function recordWebhookEvent(
  eventId: string,
  source: WebhookSource,
): void {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO webhook_event (event_id, source) VALUES (?, ?)",
    [eventId, source],
  );
}

export function isEventProcessed(eventId: string): boolean {
  const db = getDb();
  const row = db
    .query("SELECT 1 FROM webhook_event WHERE event_id = ?")
    .get(eventId);
  return row !== null;
}

export function cleanExpiredEvents(): number {
  const db = getDb();
  const result = db.run(
    "DELETE FROM webhook_event WHERE received_at < datetime('now', '-24 hours')",
  );
  return result.changes;
}

// --- bug_fix_retry ---

export function createBugFixRetry(planeIssueId: string): void {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO bug_fix_retry (plane_issue_id) VALUES (?)",
    [planeIssueId],
  );
}

export function getBugFixRetry(
  planeIssueId: string,
): BugFixRetry | null {
  const db = getDb();
  return db
    .query("SELECT * FROM bug_fix_retry WHERE plane_issue_id = ?")
    .get(planeIssueId) as BugFixRetry | null;
}

export function incrementBugFixRetry(planeIssueId: string): void {
  const db = getDb();
  db.run(
    `UPDATE bug_fix_retry
     SET retry_count = retry_count + 1, last_attempt_at = datetime('now'), status = 'fixing'
     WHERE plane_issue_id = ?`,
    [planeIssueId],
  );
}

export function updateBugFixStatus(
  planeIssueId: string,
  status: BugFixStatus,
): void {
  const db = getDb();
  db.run(
    "UPDATE bug_fix_retry SET status = ? WHERE plane_issue_id = ?",
    [status, planeIssueId],
  );
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cd packages/gateway && bun test src/db/queries.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/db/
git commit -m "feat(gateway): add SQLite database layer with schema and queries"
```

---

### Task 4: 请求日志中间件

**Files:**

- Create: `packages/gateway/src/middleware/logger.ts`

- [ ] **Step 1: 实现 logger 中间件**

```typescript
import type { MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  console.log(`${method} ${path} ${status} ${duration}ms`);
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/middleware/logger.ts
git commit -m "feat(gateway): add request logger middleware"
```

---

### Task 5: Webhook 验签中间件

**Files:**

- Create: `packages/gateway/src/middleware/verify.ts`
- Create: `packages/gateway/src/middleware/verify.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createWebhookVerifier } from "./verify";

describe("webhook verify middleware", () => {
  it("returns 401 when secret header is missing", async () => {
    const app = new Hono();
    app.use("/*", createWebhookVerifier("X-Webhook-Secret", "my-secret"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret header is wrong", async () => {
    const app = new Hono();
    app.use("/*", createWebhookVerifier("X-Webhook-Secret", "my-secret"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Webhook-Secret": "wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("passes when secret matches", async () => {
    const app = new Hono();
    app.use("/*", createWebhookVerifier("X-Webhook-Secret", "my-secret"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Webhook-Secret": "my-secret" },
    });
    expect(res.status).toBe(200);
  });

  it("skips verification when secret is not configured", async () => {
    const app = new Hono();
    app.use("/*", createWebhookVerifier("X-Webhook-Secret", ""));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/gateway && bun test src/middleware/verify.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现验签中间件**

```typescript
import type { MiddlewareHandler } from "hono";

export function createWebhookVerifier(
  headerName: string,
  expectedSecret: string,
): MiddlewareHandler {
  return async (c, next) => {
    // 未配置 secret 时跳过验签（开发环境）
    if (!expectedSecret) {
      await next();
      return;
    }

    const provided = c.req.header(headerName);
    if (!provided || provided !== expectedSecret) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/gateway && bun test src/middleware/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/middleware/verify.ts packages/gateway/src/middleware/verify.test.ts
git commit -m "feat(gateway): add webhook signature verification middleware"
```

---

### Task 6: Webhook 去重中间件

**Files:**

- Create: `packages/gateway/src/middleware/dedup.ts`
- Create: `packages/gateway/src/middleware/dedup.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDedup } from "./dedup";
import { closeDb, getDb } from "../db";

describe("webhook dedup middleware", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("allows first request through", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-100" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects duplicate request", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-200" },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-200" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Event already processed");
  });

  it("allows request without event ID header", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/gateway && bun test src/middleware/dedup.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现去重中间件**

```typescript
import type { MiddlewareHandler } from "hono";
import type { WebhookSource } from "../types";
import { isEventProcessed, recordWebhookEvent } from "../db/queries";

export function createDedup(
  headerName: string,
  source: WebhookSource,
): MiddlewareHandler {
  return async (c, next) => {
    const eventId = c.req.header(headerName);

    // 无 event ID 时放行（由业务层决定如何处理）
    if (!eventId) {
      await next();
      return;
    }

    if (isEventProcessed(eventId)) {
      return c.json({ message: "Event already processed" }, 200);
    }

    recordWebhookEvent(eventId, source);
    await next();
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/gateway && bun test src/middleware/dedup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/middleware/dedup.ts packages/gateway/src/middleware/dedup.test.ts
git commit -m "feat(gateway): add webhook event dedup middleware"
```

---

### Task 7: 路由层（health + webhook + api）

**Files:**

- Create: `packages/gateway/src/routes/health.ts`
- Create: `packages/gateway/src/routes/webhook.ts`
- Create: `packages/gateway/src/routes/api.ts`
- Create: `packages/gateway/src/routes/webhook.test.ts`
- Create: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: 实现 health 路由**

```typescript
import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => c.json({ status: "ok" }));
healthRoutes.get("/version", (c) => c.json({ version: "0.0.1" }));
```

- [ ] **Step 2: 实现 webhook 路由（框架，含中间件集成）**

```typescript
import { Hono } from "hono";
import { getConfig } from "../config";
import { createWebhookVerifier } from "../middleware/verify";
import { createDedup } from "../middleware/dedup";

export function createWebhookRoutes(): Hono {
  const config = getConfig();
  const webhookRoutes = new Hono();

  // Plane 事件：Issue Approved → 触发文档生成
  webhookRoutes.post(
    "/plane",
    createWebhookVerifier("X-Plane-Secret", config.planeWebhookSecret),
    createDedup("X-Plane-Event-Id", "plane"),
    async (c) => {
      const body = await c.req.json();
      // TODO: 解析 Plane 事件，提取 Issue ID 和状态
      // TODO: 调用 workflow service 触发文档生成
      return c.json({ received: true, source: "plane" });
    },
  );

  // Git 事件：MR Created / docs push
  webhookRoutes.post(
    "/git",
    createWebhookVerifier("X-Gitea-Secret", config.gitWebhookSecret),
    createDedup("X-Gitea-Delivery", "git"),
    async (c) => {
      const body = await c.req.json();
      // TODO: 解析 Git 事件类型
      // TODO: MR Created → 飞书通知；docs push → Dify 知识库同步
      return c.json({ received: true, source: "git" });
    },
  );

  // CI/CD 事件：Test Failed → Bug 分析
  webhookRoutes.post(
    "/cicd",
    createWebhookVerifier("X-CI-Secret", config.cicdWebhookSecret),
    createDedup("X-CI-Event-Id", "cicd"),
    async (c) => {
      const body = await c.req.json();
      // TODO: 提取失败日志、关联 Issue ID
      // TODO: 调用 Dify 工作流三进行 Bug 分析
      return c.json({ received: true, source: "cicd" });
    },
  );

  // 飞书回调：审批按钮点击（飞书使用 HMAC-SHA256 验签，独立处理）
  webhookRoutes.post("/feishu", async (c) => {
    const body = await c.req.json();
    // TODO: 飞书 HMAC-SHA256 验签（X-Lark-Signature）
    // TODO: 解析飞书回调（approve/reject）
    // TODO: 更新 Plane Issue 状态 + 触发代码生成
    return c.json({ received: true, source: "feishu" });
  });

  return webhookRoutes;
}
```

- [ ] **Step 3: 实现 api 路由**

```typescript
import { Hono } from "hono";
import {
  createWorkflowExecution,
  listWorkflowExecutions,
} from "../db/queries";
import type {
  TriggerWorkflowRequest,
  WorkflowType,
  WorkflowStatus,
} from "../types";

export const apiRoutes = new Hono();

// 触发工作流
apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();

  const id = createWorkflowExecution({
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    input_path: body.params?.input_path,
  });

  return c.json({
    execution_id: id,
    status: "pending",
    message: "工作流已触发",
  });
});

// 查询执行记录
apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as
    | WorkflowType
    | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const result = listWorkflowExecutions({
    workflow_type: workflowType,
    status,
    limit,
  });

  return c.json(result);
});
```

- [ ] **Step 4: 编写 webhook 路由测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createWebhookRoutes } from "./webhook";
import { closeDb, getDb } from "../db";

describe("webhook routes", () => {
  let app: Hono;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    app = new Hono();
    app.route("/webhook", createWebhookRoutes());
  });

  afterEach(() => {
    closeDb();
  });

  it("POST /webhook/plane returns received", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "issue_update" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("plane");
  });

  it("POST /webhook/git returns received", async () => {
    const res = await app.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("git");
  });

  it("POST /webhook/cicd returns received", async () => {
    const res = await app.request("/webhook/cicd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("cicd");
  });

  it("POST /webhook/feishu returns received", async () => {
    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("feishu");
  });
});
```

- [ ] **Step 5: 编写 api 路由测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { closeDb, getDb } from "../db";

describe("api routes", () => {
  let app: Hono;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    app = new Hono();
    app.route("/api", apiRoutes);
  });

  afterEach(() => {
    closeDb();
  });

  it("POST /api/workflow/trigger creates execution", async () => {
    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
        params: { input_path: "/prd/test.md" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBeGreaterThan(0);
    expect(body.status).toBe("pending");
  });

  it("GET /api/workflow/executions returns list", async () => {
    // create one first
    await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-2",
      }),
    });

    const res = await app.request("/api/workflow/executions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/workflow/executions filters by type", async () => {
    await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "bug_analysis",
        plane_issue_id: "ISSUE-3",
      }),
    });

    const res = await app.request(
      "/api/workflow/executions?workflow_type=bug_analysis",
    );
    const body = await res.json();
    expect(body.data.every((e: any) => e.workflow_type === "bug_analysis")).toBe(
      true,
    );
  });
});
```

- [ ] **Step 6: 运行所有路由测试，确认通过**

Run: `cd packages/gateway && bun test src/routes/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/routes/
git commit -m "feat(gateway): add health, webhook, and api routes"
```

---

### Task 8: 定时任务调度器

**Files:**

- Create: `packages/gateway/src/scheduler.ts`

- [ ] **Step 1: 实现调度器**

```typescript
import { cleanExpiredEvents } from "./db/queries";

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  // 每小时清理过期的 webhook 事件
  intervalId = setInterval(
    () => {
      const deleted = cleanExpiredEvents();
      if (deleted > 0) {
        console.log(`Scheduler: cleaned ${deleted} expired webhook events`);
      }
    },
    60 * 60 * 1000,
  );
  console.log("Scheduler started: webhook event cleanup every 1 hour");
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/scheduler.ts
git commit -m "feat(gateway): add scheduler for webhook event cleanup"
```

---

### Task 9: 重构入口文件并集成所有模块

**Files:**

- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/gateway/src/index.test.ts`

- [ ] **Step 1: 重构 index.ts**

```typescript
import { Hono } from "hono";
import { getConfig } from "./config";
import { getDb } from "./db";
import { requestLogger } from "./middleware/logger";
import { healthRoutes } from "./routes/health";
import { createWebhookRoutes } from "./routes/webhook";
import { apiRoutes } from "./routes/api";
import { startScheduler } from "./scheduler";

// 初始化数据库
getDb();

export const app = new Hono();

// 全局中间件
app.use("*", requestLogger);

// 挂载路由
app.route("/", healthRoutes);
app.route("/webhook", createWebhookRoutes());
app.route("/api", apiRoutes);

// 启动调度器（非测试环境）
if (process.env.NODE_ENV !== "test") {
  startScheduler();
}

const config = getConfig();
export default {
  port: config.port,
  fetch: app.fetch,
};
```

- [ ] **Step 2: 更新测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "./db";

// 必须在 import app 之前设置 test 环境
process.env.NODE_ENV = "test";

import { app } from "./index";

describe("gateway app", () => {
  beforeEach(() => {
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /version returns version", async () => {
    const res = await app.request("/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: "0.0.1" });
  });

  it("POST /webhook/plane is routed", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/workflow/trigger is routed", async () => {
    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "prd_to_tech",
        plane_issue_id: "TEST-1",
      }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: 运行全部测试**

Run: `cd packages/gateway && bun test`
Expected: ALL PASS

- [ ] **Step 4: 运行 lint**

Run: `cd packages/gateway && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/index.ts packages/gateway/src/index.test.ts
git commit -m "feat(gateway): refactor entry point and integrate all modules"
```

---

### Task 10: 工作流服务框架

**Files:**

- Create: `packages/gateway/src/services/workflow.ts`

- [ ] **Step 1: 实现工作流服务框架**

```typescript
import {
  createWorkflowExecution,
  updateWorkflowStatus,
} from "../db/queries";
import type { WorkflowType, TriggerSource } from "../types";

interface TriggerParams {
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
  target_repos?: string[];
}

export async function triggerWorkflow(
  params: TriggerParams,
): Promise<number> {
  const executionId = createWorkflowExecution({
    workflow_type: params.workflow_type,
    trigger_source: params.trigger_source,
    plane_issue_id: params.plane_issue_id,
    input_path: params.input_path,
  });

  updateWorkflowStatus(executionId, "running");

  // TODO: 根据 workflow_type 分发到对应的处理函数
  // - prd_to_tech: Git pull PRD → Dify 工作流一 → Git push 技术文档 → Dify 工作流二 → Git push OpenAPI
  // - tech_to_openapi: Dify 工作流二
  // - bug_analysis: Dify 工作流三 → 创建 Bug Issue
  // - code_gen: Claude Code headless 代码生成

  return executionId;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/services/workflow.ts
git commit -m "feat(gateway): add workflow service scaffold"
```

---

### Task 11: 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `cd packages/gateway && bun test --coverage`
Expected: ALL PASS，coverage > 80%

- [ ] **Step 2: 运行全量 lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 3: 从根目录运行 CI 模拟**

Run: `bun run test`
Expected: gateway + web 全部 PASS
