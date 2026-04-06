# iBuild CI/CD Bug 回流自动化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对接内网 iBuild 构建系统，构建失败时自动触发 Bug 分析 + Claude Code 修复 + 飞书通知。

**Architecture:** 新增 `/webhook/ibuild` 端点接收 URL-encoded webhook，新增 `ibuild.ts` 服务封装 token 管理和 API 调用，复用已有 `bug_analysis` 工作流。

**Tech Stack:** Bun + Hono + bun:test, iBuild REST API (accessToken 认证)

**Spec:** `docs/superpowers/specs/2026-04-06-ibuild-cicd-bug-backflow-design.md`

---

## Task 1: 类型定义 + 配置项

**Files:**

- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/config.ts`
- Modify: `setup/gateway/.env.example`

- [ ] **Step 1: 更新类型定义**

在 `packages/gateway/src/types/index.ts` 中：

```typescript
// 第 2 行，WebhookSource 加 "ibuild"
export type WebhookSource = "plane" | "git" | "cicd" | "feishu" | "ibuild";

// 第 8 行，TriggerSource 加 "ibuild_webhook"
export type TriggerSource = "plane_webhook" | "cicd_webhook" | "ibuild_webhook" | "manual";

// 文件末尾新增 iBuild 相关类型
export interface IBuildWebhookPayload {
  status: string;
  buildId: string;
  projectId: string;
  appId: string;
  gitBranch: string;
  commitId: string;
  projectKey: string;
  appKey: string;
  builder: string;
  startTime: string;
  appVersion?: string;
  longCommitId?: string;
  artifactoryRepo?: string;
  projectVersion?: string;
}

export interface IBuildModule {
  moduleId: string;
  modulekey: string;
  status: string;
}

export interface IBuildDetail {
  uuid: string;
  buildSid: string;
  branch: string;
  commitNum: string;
  executor: string;
  executorName: string;
  executeTime: string;
  duration: string;
  status: string;
  modules: IBuildModule[] | null;
  logUrl?: string;
}
```

- [ ] **Step 2: 更新配置项**

在 `packages/gateway/src/config.ts` 的 `Config` interface 和 `getConfig()` 中新增：

```typescript
// Config interface 中 Claude Code 部分后面加
// iBuild
ibuildBaseUrl: string;
ibuildClientKey: string;
ibuildUser: string;
ibuildWebhookSecret: string;
ibuildAppRepoMap: Record<string, string>;

// Plane 部分加
planeDefaultProjectId: string;
```

```typescript
// getConfig() 中 claudeCodeTimeout 后面加
ibuildBaseUrl: process.env.IBUILD_BASE_URL ?? "",
ibuildClientKey: process.env.IBUILD_CLIENT_KEY ?? "",
ibuildUser: process.env.IBUILD_USER ?? "",
ibuildWebhookSecret: process.env.IBUILD_WEBHOOK_SECRET ?? "",
ibuildAppRepoMap: JSON.parse(process.env.IBUILD_APP_REPO_MAP || '{"default":"backend"}'),

// planeWorkspaceSlug 后面加
planeDefaultProjectId: process.env.PLANE_DEFAULT_PROJECT_ID ?? "",
```

- [ ] **Step 3: 更新 .env.example**

在 `setup/gateway/.env.example` 中新增 iBuild 和 Plane 配置段。

- [ ] **Step 4: 运行现有测试确保无破坏**

Run: `cd packages/gateway && bun test`
Expected: 所有现有测试通过（类型扩展是向后兼容的）

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/types/index.ts packages/gateway/src/config.ts setup/gateway/.env.example
git commit -m "feat(gateway): add iBuild types and config for CI/CD bug backflow"
```

---

## Task 2: iBuild Service — Token 管理

**Files:**

- Create: `packages/gateway/src/services/ibuild.ts`
- Create: `packages/gateway/src/services/ibuild.test.ts`

- [ ] **Step 1: 写 token 管理的失败测试**

创建 `packages/gateway/src/services/ibuild.test.ts`：

```typescript
import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  getConfig: () => ({
    ibuildBaseUrl: "http://ibuild.test",
    ibuildClientKey: "test-client-key",
    ibuildUser: "testuser",
  }),
}));

// 保存原始 fetch
const originalFetch = globalThis.fetch;

describe("IBuildService", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  describe("getAccessToken", () => {
    it("requests token from CS API and caches it", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ token: "test-token-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      globalThis.fetch = fetchMock;

      const { getAccessToken, _resetTokenCache } = await import("./ibuild");
      _resetTokenCache();

      const token1 = await getAccessToken();
      expect(token1).toBe("test-token-123");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const token2 = await getAccessToken();
      expect(token2).toBe("test-token-123");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws on API failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 })),
      );

      const { getAccessToken, _resetTokenCache } = await import("./ibuild");
      _resetTokenCache();

      await expect(getAccessToken()).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: FAIL — module `./ibuild` not found

- [ ] **Step 3: 实现 token 管理**

创建 `packages/gateway/src/services/ibuild.ts`：

```typescript
import { getConfig } from "../config";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

const TOKEN_EXPIRE_MINUTES = 1440;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

export function _resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken;
  }

  const config = getConfig();
  const res = await fetch(`${config.ibuildBaseUrl}/restapi/cs/v1/auth/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: config.ibuildClientKey,
      user: config.ibuildUser,
      expire: String(TOKEN_EXPIRE_MINUTES),
    }),
  });

  if (!res.ok) {
    throw new Error(`iBuild token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { token: string };
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + TOKEN_EXPIRE_MINUTES * 60 * 1000;

  return cachedToken;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/ibuild.ts packages/gateway/src/services/ibuild.test.ts
git commit -m "feat(gateway): iBuild service — token management with caching"
```

---

## Task 3: iBuild Service — 构建详情 + 日志拉取

**Files:**

- Modify: `packages/gateway/src/services/ibuild.ts`
- Modify: `packages/gateway/src/services/ibuild.test.ts`

- [ ] **Step 1: 写 getBuildDetail 失败测试**

在 `ibuild.test.ts` 中新增：

```typescript
describe("getBuildDetail", () => {
  it("fetches build detail and returns parsed result", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        // token request
        return Promise.resolve(
          new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }
      // build detail request
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resCode: "0",
            msg: "OK",
            obj: {
              uuid: "abc",
              buildSid: "1001",
              branch: "feat/PROJ-123-login",
              commitNum: "a19b344",
              executor: "user1",
              executorName: "User",
              executeTime: "2026-04-06 10:00:00",
              duration: "60000",
              status: "FAIL",
              modules: [
                { moduleId: "1", modulekey: "Maven", status: "FAIL" },
                { moduleId: "2", modulekey: "GitCheckout", status: "SUCCEED" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const { getBuildDetail, _resetTokenCache } = await import("./ibuild");
    _resetTokenCache();

    const detail = await getBuildDetail("proj-1", "app-1", "1001");
    expect(detail.status).toBe("FAIL");
    expect(detail.modules).toHaveLength(2);
  });

  it("returns null modules when build never executed", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ resCode: "0", msg: "OK", obj: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const { getBuildDetail, _resetTokenCache } = await import("./ibuild");
    _resetTokenCache();

    await expect(getBuildDetail("proj-1", "app-1", "9999")).rejects.toThrow("not found");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: FAIL — `getBuildDetail` is not exported

- [ ] **Step 3: 实现 getBuildDetail**

在 `ibuild.ts` 中新增：

```typescript
import type { IBuildDetail } from "../types";

export async function getBuildDetail(
  projectId: string,
  appId: string,
  buildSid: string,
): Promise<IBuildDetail> {
  const config = getConfig();
  const token = await getAccessToken();

  const url = `${config.ibuildBaseUrl}/restapi/ibuild/v1/projects/${projectId}/applications/${appId}/buildstatusdetail?buildSid=${buildSid}`;

  const res = await fetch(url, {
    headers: { accessToken: token },
  });

  if (!res.ok) {
    throw new Error(`iBuild getBuildDetail failed: ${res.status}`);
  }

  const data = (await res.json()) as { resCode: string; obj: IBuildDetail | null };

  if (!data.obj) {
    throw new Error(`Build ${buildSid} not found`);
  }

  return data.obj;
}
```

- [ ] **Step 4: 写 getBuildLog 失败测试**

在 `ibuild.test.ts` 中新增：

```typescript
describe("getBuildLog", () => {
  it("fetches log content via logUrl", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }
      return Promise.resolve(new Response("BUILD FAILED\nError at line 42", { status: 200 }));
    });

    const { getBuildLog, _resetTokenCache } = await import("./ibuild");
    _resetTokenCache();

    const log = await getBuildLog("/ClientAppLog?uuid=abc");
    expect(log).toContain("BUILD FAILED");
  });

  it("truncates logs exceeding 100KB", async () => {
    const bigLog = "x".repeat(150 * 1024); // 150KB
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }
      return Promise.resolve(new Response(bigLog, { status: 200 }));
    });

    const { getBuildLog, _resetTokenCache } = await import("./ibuild");
    _resetTokenCache();

    const log = await getBuildLog("/ClientAppLog?uuid=big");
    expect(log.length).toBeLessThanOrEqual(100 * 1024 + 100); // 100KB + truncation notice
    expect(log).toContain("[日志已截断，仅保留最后 100KB]");
  });
});
```

- [ ] **Step 5: 实现 getBuildLog**

在 `ibuild.ts` 中新增：

```typescript
const MAX_LOG_SIZE = 100 * 1024; // 100KB

export async function getBuildLog(logUrl: string): Promise<string> {
  const config = getConfig();
  const token = await getAccessToken();

  const fullUrl = `${config.ibuildBaseUrl}${logUrl}`;
  const res = await fetch(fullUrl, {
    headers: { accessToken: token },
  });

  if (!res.ok) {
    throw new Error(`iBuild getBuildLog failed: ${res.status}`);
  }

  let text = await res.text();

  if (text.length > MAX_LOG_SIZE) {
    text = `[日志已截断，仅保留最后 100KB]\n${text.slice(-MAX_LOG_SIZE)}`;
  }

  return text;
}
```

- [ ] **Step 6: 写 getFailedModules 辅助函数测试**

```typescript
describe("getFailedModules", () => {
  it("extracts failed module names", async () => {
    const { getFailedModules } = await import("./ibuild");
    const modules = [
      { moduleId: "1", modulekey: "Maven", status: "FAIL" },
      { moduleId: "2", modulekey: "GitCheckout", status: "SUCCEED" },
      { moduleId: "3", modulekey: "SonarQube", status: "FAIL" },
    ];
    expect(getFailedModules(modules)).toEqual(["Maven", "SonarQube"]);
  });

  it("returns empty array when no failures", async () => {
    const { getFailedModules } = await import("./ibuild");
    expect(getFailedModules([])).toEqual([]);
    expect(getFailedModules(null)).toEqual([]);
  });
});
```

- [ ] **Step 7: 实现 getFailedModules**

在 `ibuild.ts` 中新增：

```typescript
export function getFailedModules(modules: IBuildModule[] | null): string[] {
  if (!modules) return [];
  return modules.filter((m) => m.status === "FAIL").map((m) => m.modulekey);
}
```

- [ ] **Step 8: 运行全部 ibuild 测试确认通过**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/services/ibuild.ts packages/gateway/src/services/ibuild.test.ts
git commit -m "feat(gateway): iBuild service — build detail, log fetching, module extraction"
```

---

## Task 4: Branch → Plane Issue ID 提取

**Files:**

- Modify: `packages/gateway/src/services/ibuild.ts`
- Modify: `packages/gateway/src/services/ibuild.test.ts`

- [ ] **Step 1: 写正则提取的失败测试**

在 `ibuild.test.ts` 中新增：

```typescript
describe("extractIssueIdFromBranch", () => {
  it("extracts issue ID from standard branch names", async () => {
    const { extractIssueIdFromBranch } = await import("./ibuild");
    expect(extractIssueIdFromBranch("feat/PROJ-123-add-login")).toBe("PROJ-123");
    expect(extractIssueIdFromBranch("fix/PROJ-456-fix-crash")).toBe("PROJ-456");
    expect(extractIssueIdFromBranch("hotfix/PROJ-789-urgent-patch")).toBe("PROJ-789");
    expect(extractIssueIdFromBranch("feature/BUG-42")).toBe("BUG-42");
  });

  it("returns null for non-matching branches", async () => {
    const { extractIssueIdFromBranch } = await import("./ibuild");
    expect(extractIssueIdFromBranch("master")).toBeNull();
    expect(extractIssueIdFromBranch("develop")).toBeNull();
    expect(extractIssueIdFromBranch("release/v1.0")).toBeNull();
    expect(extractIssueIdFromBranch("")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: FAIL — `extractIssueIdFromBranch` not found

- [ ] **Step 3: 实现 extractIssueIdFromBranch**

在 `ibuild.ts` 中新增：

```typescript
const BRANCH_ISSUE_REGEX = /^(?:feat|fix|hotfix|feature)\/([A-Z]+-\d+)/;

export function extractIssueIdFromBranch(branch: string): string | null {
  const match = branch.match(BRANCH_ISSUE_REGEX);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/ibuild.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/ibuild.ts packages/gateway/src/services/ibuild.test.ts
git commit -m "feat(gateway): branch name to Plane issue ID extraction"
```

---

## Task 5: Webhook 端点 — /webhook/ibuild

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts`

- [ ] **Step 1: 写 webhook 端点的失败测试**

在 `webhook.test.ts` 中，现有 `describe("webhook routes", ...)` 块内新增测试：

```typescript
// iBuild webhook 的 URL-encoded payload 辅助函数
function ibuildPayload(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    status: "FAIL",
    buildId: "1661",
    projectId: "proj-ibuild-1",
    appId: "app-ibuild-1",
    gitBranch: "feat/PROJ-123-add-login",
    commitId: "b2140960",
    projectKey: "TESTPROJ",
    appKey: "DZHCS",
    builder: "testuser",
    startTime: "2026-04-06 10:00:00",
  };
  const params = { ...defaults, ...overrides };
  return new URLSearchParams(params).toString();
}

it("POST /webhook/ibuild returns received with triggered=true on FAIL", async () => {
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload(),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.received).toBe(true);
  expect(body.triggered).toBe(true);
});

it("POST /webhook/ibuild does not trigger on SUCCEED status", async () => {
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ status: "SUCCEED" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.triggered).toBe(false);
  expect(triggerSpy).not.toHaveBeenCalled();
});

it("POST /webhook/ibuild does not trigger on PROCESSING status", async () => {
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ status: "PROCESSING" }),
  });
  const body = await res.json();
  expect(body.triggered).toBe(false);
});

it("POST /webhook/ibuild does not trigger on CANCEL status", async () => {
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ status: "CANCEL" }),
  });
  const body = await res.json();
  expect(body.triggered).toBe(false);
});

it("POST /webhook/ibuild triggers on ABORT status", async () => {
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ status: "ABORT" }),
  });
  const body = await res.json();
  expect(body.triggered).toBe(true);
});

it("POST /webhook/ibuild rejects invalid secret", async () => {
  const res = await app.request("/webhook/ibuild?secret=wrong", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload(),
  });
  expect(res.status).toBe(401);
});

it("POST /webhook/ibuild deduplicates by buildId", async () => {
  // First request
  await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ buildId: "dup-123", status: "FAIL" }),
  });

  // Second request with same buildId
  const res = await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ buildId: "dup-123", status: "FAIL" }),
  });
  const body = await res.json();
  expect(body.message).toBe("Event already processed");
});

it("POST /webhook/ibuild extracts issue ID from branch and maps repo", async () => {
  await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({
      gitBranch: "feat/PROJ-123-add-login",
      appKey: "DZHCS",
    }),
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      workflow_type: "bug_analysis",
      trigger_source: "ibuild_webhook",
      plane_issue_id: "PROJ-123",
    }),
  );
});

it("POST /webhook/ibuild handles unrecognized branch gracefully", async () => {
  await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ gitBranch: "master" }),
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      plane_issue_id: undefined,
    }),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts`
Expected: FAIL — 404 on `/webhook/ibuild`

- [ ] **Step 3: 实现 /webhook/ibuild 端点**

在 `packages/gateway/src/routes/webhook.ts` 中，`return webhookRoutes;` 之前新增：

```typescript
import { isEventProcessed, recordWebhookEvent } from "../db/queries";
import { extractIssueIdFromBranch } from "../services/ibuild";

// iBuild: 构建失败 → Bug 分析
webhookRoutes.post("/ibuild", async (c) => {
  // 1. Secret 校验（query param）
  const secret = c.req.query("secret");
  if (secret !== config.ibuildWebhookSecret) {
    return c.json({ error: "Invalid secret" }, 401);
  }

  // 2. 解析 URL-encoded body
  const formData = await c.req.parseBody();
  const status = String(formData.status ?? "");
  const buildId = String(formData.buildId ?? "");
  const projectId = String(formData.projectId ?? "");
  const appId = String(formData.appId ?? "");
  const gitBranch = String(formData.gitBranch ?? "");
  const appKey = String(formData.appKey ?? "");

  // 3. 去重（手动，因为 buildId 在 body 而非 header）
  if (buildId && isEventProcessed(buildId)) {
    return c.json({ message: "Event already processed" }, 200);
  }
  if (buildId) {
    recordWebhookEvent(buildId, "ibuild");
  }

  // 4. 状态过滤
  if (status !== "FAIL" && status !== "ABORT") {
    return c.json({ received: true, triggered: false, source: "ibuild" });
  }

  // 5. planeDefaultProjectId 校验
  if (!config.planeDefaultProjectId) {
    console.error("PLANE_DEFAULT_PROJECT_ID is not configured, skipping iBuild bug analysis");
    return c.json({ received: true, triggered: false, error: "missing config" }, 200);
  }

  // 6. 提取 Plane Issue ID + 映射仓库
  const planeIssueId = extractIssueIdFromBranch(gitBranch) ?? undefined;
  const targetRepo = config.ibuildAppRepoMap[appKey] ?? "backend";

  // 7. 同步触发 — 传入 iBuild 构建参数，日志拉取由 ibuild-log-fetcher 在异步工作流中完成
  triggerWorkflow({
    workflow_type: "bug_analysis",
    trigger_source: "ibuild_webhook",
    plane_issue_id: planeIssueId,
    input_path: JSON.stringify({ projectId, appId, buildId }),
    project_id: config.planeDefaultProjectId,
    target_repos: [targetRepo],
  });

  return c.json({ received: true, triggered: true, source: "ibuild" });
});
```

注意：`input_path` 存储 iBuild 构建参数 JSON，Task 6 的 log-fetcher 在工作流异步执行时拉取实际日志。triggerWorkflow 同步调用，避免异步 IIFE 的竞态问题。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 运行全部测试确认无回归**

Run: `cd packages/gateway && bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/routes/webhook.ts packages/gateway/src/routes/webhook.test.ts
git commit -m "feat(gateway): /webhook/ibuild endpoint with secret, dedup, status filter"
```

---

## Task 6: iBuild 日志拉取集成层

**Files:**

- Create: `packages/gateway/src/services/ibuild-log-fetcher.ts`
- Create: `packages/gateway/src/services/ibuild-log-fetcher.test.ts`

此模块封装"通过 iBuild 构建参数拉取日志并拼接失败模块上下文"的完整逻辑，供 webhook handler 调用。

- [ ] **Step 1: 写失败测试**

创建 `packages/gateway/src/services/ibuild-log-fetcher.test.ts`：

```typescript
import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock ibuild service
const getBuildDetail = mock(() =>
  Promise.resolve({
    uuid: "abc",
    buildSid: "1001",
    branch: "feat/PROJ-123",
    commitNum: "a19b",
    executor: "u1",
    executorName: "User",
    executeTime: "2026-04-06",
    duration: "60000",
    status: "FAIL",
    modules: [
      { moduleId: "1", modulekey: "Maven", status: "FAIL" },
      { moduleId: "2", modulekey: "GitCheckout", status: "SUCCEED" },
    ],
  }),
);
const getBuildLog = mock(() => Promise.resolve("Error: compilation failed at Foo.java:42"));
const getFailedModules = mock(() => ["Maven"]);

mock.module("./ibuild", () => ({
  getBuildDetail,
  getBuildLog,
  getFailedModules,
}));

describe("fetchBuildLogWithContext", () => {
  beforeEach(() => {
    getBuildDetail.mockClear();
    getBuildLog.mockClear();
  });

  it("fetches detail, extracts failed modules, and prepends context to log", async () => {
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");
    const result = await fetchBuildLogWithContext("proj-1", "app-1", "1001");

    expect(getBuildDetail).toHaveBeenCalledWith("proj-1", "app-1", "1001");
    expect(result).toContain("失败构建模块：Maven");
    expect(result).toContain("Error: compilation failed");
  });

  it("returns log without module prefix when no modules fail", async () => {
    getFailedModules.mockReturnValueOnce([]);
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");
    const result = await fetchBuildLogWithContext("proj-1", "app-1", "1001");

    expect(result).not.toContain("失败构建模块");
    expect(result).toContain("Error: compilation failed");
  });

  it("returns error message when build detail has no logUrl-equivalent", async () => {
    getBuildLog.mockRejectedValueOnce(new Error("log fetch failed"));
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");

    await expect(fetchBuildLogWithContext("proj-1", "app-1", "1001")).rejects.toThrow(
      "log fetch failed",
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/ibuild-log-fetcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 fetchBuildLogWithContext**

创建 `packages/gateway/src/services/ibuild-log-fetcher.ts`：

```typescript
import { getBuildDetail, getBuildLog, getFailedModules } from "./ibuild";

export async function fetchBuildLogWithContext(
  projectId: string,
  appId: string,
  buildSid: string,
): Promise<string> {
  // 1. 获取构建详情（含 modules 和 logUrl）
  const detail = await getBuildDetail(projectId, appId, buildSid);

  // 2. 从详情中获取 logUrl（构建历史 API 返回的相对路径）
  if (!detail.logUrl) {
    throw new Error(`Build ${buildSid} has no logUrl`);
  }

  // 3. 拉取日志
  const rawLog = await getBuildLog(detail.logUrl);

  // 4. 拼接失败模块上下文
  const failedModules = getFailedModules(detail.modules);

  if (failedModules.length > 0) {
    return `失败构建模块：${failedModules.join(", ")}\n---\n${rawLog}`;
  }

  return rawLog;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/ibuild-log-fetcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/ibuild-log-fetcher.ts packages/gateway/src/services/ibuild-log-fetcher.test.ts
git commit -m "feat(gateway): iBuild log fetcher with failed module context"
```

---

## Task 7: 日志拉取集成到 webhook + 全量验证

**设计说明：** 日志拉取不在 webhook handler 中同步执行（会阻塞响应），而是通过 `triggerWorkflow` 的 fire-and-forget 异步机制完成。webhook handler 的 `input_path` 传入 iBuild 构建参数 JSON，在 `flowBugAnalysis` 工作流异步执行时由 `fetchBuildLogWithContext` 拉取实际日志。这样 webhook 立即返回 200，与现有 Plane/CI webhook 的模式一致。

由于 `flowBugAnalysis` 当前直接使用 `input_path` 作为日志内容传给 Dify，iBuild 场景需要在调用 Dify 前先拉取日志。有两种选择：

- **方案 A**：修改 `flowBugAnalysis` 增加 iBuild 日志拉取分支（通过检测 input_path 是否为 JSON）
- **方案 B**：在 webhook handler 中先同步拉取日志再 triggerWorkflow

选择 **方案 B**（保持 workflow.ts 不修改，符合规格 7.3），但改为在 webhook handler 内做 fire-and-forget：

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts`

- [ ] **Step 1: 更新 webhook handler — 异步拉取日志再触发工作流**

修改 `/webhook/ibuild` handler，将 `triggerWorkflow` 调用包装在异步块中：

```typescript
import { fetchBuildLogWithContext } from "../services/ibuild-log-fetcher";

// 替换 Task 5 中第 7 步的同步 triggerWorkflow 调用：
// 7. 异步拉取日志并触发工作流（fire-and-forget）
fetchBuildLogWithContext(projectId, appId, buildId)
  .then((logContent) => {
    triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "ibuild_webhook",
      plane_issue_id: planeIssueId,
      input_path: logContent,
      project_id: config.planeDefaultProjectId,
      target_repos: [targetRepo],
    });
  })
  .catch((error) => {
    console.error(`iBuild log fetch failed for build ${buildId}:`, error);
    // 降级：用构建元数据触发分析
    triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "ibuild_webhook",
      plane_issue_id: planeIssueId,
      input_path: `iBuild 构建失败 (buildId: ${buildId}, branch: ${gitBranch})，日志拉取失败`,
      project_id: config.planeDefaultProjectId,
      target_repos: [targetRepo],
    });
  });
```

- [ ] **Step 2: 更新 webhook 测试**

在 `webhook.test.ts` 中 mock `fetchBuildLogWithContext`，并更新 iBuild 测试断言为异步等待：

```typescript
import * as ibuildLogFetcher from "../services/ibuild-log-fetcher";

// 在 beforeEach 中
const fetchLogSpy = spyOn(ibuildLogFetcher, "fetchBuildLogWithContext")
  .mockResolvedValue("mocked build log");
```

对需要检查 `triggerSpy` 参数的测试（如 `extracts issue ID`、`handles unrecognized branch`），在断言前加 `await Bun.sleep(0)` 以 flush microtask queue：

```typescript
it("POST /webhook/ibuild extracts issue ID from branch and maps repo", async () => {
  await app.request("/webhook/ibuild?secret=", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ibuildPayload({ gitBranch: "feat/PROJ-123-add-login", appKey: "DZHCS" }),
  });

  await Bun.sleep(0); // flush microtask queue

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      workflow_type: "bug_analysis",
      trigger_source: "ibuild_webhook",
      plane_issue_id: "PROJ-123",
      input_path: "mocked build log",
    }),
  );
});
```

对不检查 `triggerSpy` 参数的测试（状态过滤、secret、dedup），无需修改。

- [ ] **Step 3: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts`
Expected: ALL PASS

- [ ] **Step 4: 运行全量测试**

Run: `cd packages/gateway && bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/webhook.ts packages/gateway/src/routes/webhook.test.ts
git commit -m "feat(gateway): integrate iBuild log fetching into webhook handler"
```

---

## Task 8: 全量测试 + .env.example 收尾

**Files:**

- Modify: `setup/gateway/.env.example`

- [ ] **Step 1: 运行全量测试 + lint**

Run: `cd packages/gateway && bun test && bunx eslint src/ && bunx prettier --check src/`
Expected: ALL PASS, no lint errors

- [ ] **Step 2: 确认 .env.example 包含所有新配置**

确保 `setup/gateway/.env.example` 包含：

```bash
# iBuild
IBUILD_BASE_URL=http://console.devops.iflytek.com
IBUILD_CLIENT_KEY=
IBUILD_USER=
IBUILD_WEBHOOK_SECRET=
IBUILD_APP_REPO_MAP={"default":"backend"}

# Plane (default project for iBuild-triggered workflows)
PLANE_DEFAULT_PROJECT_ID=
```

- [ ] **Step 3: 运行测试覆盖率检查**

Run: `cd packages/gateway && bun test --coverage`
Expected: 覆盖率不低于现有 60% 阈值

- [ ] **Step 4: Final commit**

```bash
git add setup/gateway/.env.example
git commit -m "chore(gateway): update .env.example with iBuild config"
```

- [ ] **Step 5: Push + 创建 PR**

```bash
git push -u origin feat/ibuild-cicd-bug-backflow
```

PR 标题：`feat(gateway): iBuild CI/CD Bug 回流自动化`
PR 关联：Supports #35
