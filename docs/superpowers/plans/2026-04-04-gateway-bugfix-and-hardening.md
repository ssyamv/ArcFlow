# Gateway Bug 修复与加固 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Gateway 胶水服务中已发现的 P0/P1 级 bug，补全 services 层单元测试，使 Gateway 达到可上线质量。

**Architecture:** 逐个修复已知 bug（API 触发不执行工作流、createBranchAndPush 空文件、verify HMAC、Wiki.js mutation、Dify 多工作流 API Key），然后为每个 service 补充 mock 测试。所有改动本地可测试，不依赖外部服务。

**Tech Stack:** Bun + Hono + bun:sqlite + bun:test (mock)

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `packages/gateway/src/routes/api.ts` | 手动触发 API | 修改：接入 triggerWorkflow |
| `packages/gateway/src/routes/api.test.ts` | API 路由测试 | 修改：补充触发测试 |
| `packages/gateway/src/services/git.ts` | Git 操作 | 修改：createBranchAndPush 支持 git add all |
| `packages/gateway/src/services/git.test.ts` | Git 服务测试 | 新建 |
| `packages/gateway/src/middleware/verify.ts` | Webhook 签名验证 | 修改：改用 HMAC-SHA256 |
| `packages/gateway/src/middleware/verify.test.ts` | 验证中间件测试 | 修改：补充 HMAC 测试 |
| `packages/gateway/src/services/wikijs.ts` | Wiki.js 同步 | 修改：修正 mutation |
| `packages/gateway/src/services/wikijs.test.ts` | Wiki.js 服务测试 | 新建 |
| `packages/gateway/src/services/dify.ts` | Dify 工作流调用 | 修改：支持多 API Key |
| `packages/gateway/src/services/dify.test.ts` | Dify 服务测试 | 新建 |
| `packages/gateway/src/config.ts` | 配置 | 修改：新增 Dify 多 Key 字段 |
| `packages/gateway/src/config.test.ts` | 配置测试 | 修改：测试新字段 |
| `packages/gateway/src/services/workflow.ts` | 工作流编排 | 修改：修复 createBranchAndPush 调用 |
| `packages/gateway/src/services/workflow.test.ts` | 工作流编排测试 | 新建 |
| `packages/gateway/src/services/feishu.test.ts` | 飞书服务测试 | 新建 |
| `packages/gateway/src/services/claude-code.test.ts` | Claude Code 测试 | 新建 |
| `packages/gateway/src/services/plane.test.ts` | Plane 服务测试 | 新建 |

---

### Task 1: 修复 API 手动触发不执行工作流

**Files:**

- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/routes/api.test.ts`

当前 `POST /api/workflow/trigger` 只创建数据库记录，不调用 `triggerWorkflow()`，导致手动触发完全无效。

- [ ] **Step 1: 在 api.test.ts 中添加失败测试 — 验证触发后工作流实际执行**

在 `api.test.ts` 中添加测试，mock `triggerWorkflow` 并验证它被调用：

```typescript
// 在现有 import 后新增
import { mock } from "bun:test";

// mock workflow 模块
const mockTriggerWorkflow = mock(() => Promise.resolve(1));
mock.module("../services/workflow", () => ({
  triggerWorkflow: mockTriggerWorkflow,
}));

// 在 describe 块内添加测试
it("should call triggerWorkflow on POST /api/workflow/trigger", async () => {
  mockTriggerWorkflow.mockClear();
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
  expect(mockTriggerWorkflow).toHaveBeenCalledTimes(1);
  const callArgs = mockTriggerWorkflow.mock.calls[0][0];
  expect(callArgs.workflow_type).toBe("prd_to_tech");
  expect(callArgs.trigger_source).toBe("manual");
  expect(callArgs.plane_issue_id).toBe("ISSUE-1");
  expect(callArgs.input_path).toBe("/prd/test.md");
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/routes/api.test.ts`
Expected: FAIL — triggerWorkflow 未被调用

- [ ] **Step 3: 修改 api.ts 接入 triggerWorkflow**

修改 `packages/gateway/src/routes/api.ts`：

```typescript
import { Hono } from "hono";
import { listWorkflowExecutions } from "../db/queries";
import { triggerWorkflow } from "../services/workflow";
import type { TriggerWorkflowRequest, WorkflowType, WorkflowStatus } from "../types";

export const apiRoutes = new Hono();

apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();

  const executionId = await triggerWorkflow({
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    input_path: body.params?.input_path,
    target_repos: body.params?.target_repos,
  });

  return c.json({
    execution_id: executionId,
    status: "running",
    message: "工作流已触发",
  });
});

apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as WorkflowType | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const result = listWorkflowExecutions({ workflow_type: workflowType, status, limit });
  return c.json(result);
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/routes/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/api.ts packages/gateway/src/routes/api.test.ts
git commit -m "fix(gateway): POST /api/workflow/trigger 接入 triggerWorkflow 实际执行工作流"
```

---

### Task 2: 修复 createBranchAndPush 空文件提交问题

**Files:**

- Modify: `packages/gateway/src/services/git.ts`
- Modify: `packages/gateway/src/services/workflow.ts`
- Create: `packages/gateway/src/services/git.test.ts`

当前 `workflow.ts` 在 `flowBugAnalysis`（行 173）和 `flowCodeGen`（行 231）中调用 `createBranchAndPush()` 时传入空数组 `[]`，导致 Claude Code 修改的文件不会被提交。

修复方案：改变 `createBranchAndPush` 的签名，去掉 `files` 参数，改为 `git add -A` 提交工作目录所有变更（Claude Code 直接写文件到工作目录）。

- [ ] **Step 1: 编写 git.test.ts 基础测试**

创建 `packages/gateway/src/services/git.test.ts`：

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock simple-git before importing
const mockGit = {
  fetch: mock(() => Promise.resolve()),
  pull: mock(() => Promise.resolve()),
  clone: mock(() => Promise.resolve()),
  add: mock(() => Promise.resolve()),
  commit: mock(() => Promise.resolve()),
  push: mock(() => Promise.resolve()),
  checkoutLocalBranch: mock(() => Promise.resolve()),
};

mock.module("simple-git", () => ({
  default: () => mockGit,
}));

// Mock fs
const mockExistsSync = mock(() => false);
const mockMkdirSync = mock(() => undefined);
const mockReadFileSync = mock(() => "file content");
const mockWriteFileSync = mock(() => undefined);

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

// Mock config
mock.module("../config", () => ({
  getConfig: () => ({
    gitWorkDir: "/tmp/test-git",
    docsGitRepo: "https://example.com/docs.git",
    backendGitRepo: "https://example.com/backend.git",
    vue3GitRepo: "https://example.com/vue3.git",
    flutterGitRepo: "https://example.com/flutter.git",
    androidGitRepo: "https://example.com/android.git",
  }),
}));

import { createBranchAndPush } from "./git";

describe("createBranchAndPush", () => {
  beforeEach(() => {
    mockGit.checkoutLocalBranch.mockClear();
    mockGit.add.mockClear();
    mockGit.commit.mockClear();
    mockGit.push.mockClear();
    mockExistsSync.mockReturnValue(true);
  });

  it("should git add -A and commit all changes when no files specified", async () => {
    await createBranchAndPush("backend", "fix/bug-1", "fix: bug 1");
    expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith("fix/bug-1");
    expect(mockGit.add).toHaveBeenCalledWith("-A");
    expect(mockGit.commit).toHaveBeenCalledWith("fix: bug 1");
    expect(mockGit.push).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/git.test.ts`
Expected: FAIL — 当前 createBranchAndPush 需要 4 个参数

- [ ] **Step 3: 修改 git.ts — createBranchAndPush 改为 git add -A**

修改 `packages/gateway/src/services/git.ts` 中的 `createBranchAndPush`：

```typescript
export async function createBranchAndPush(
  repoName: string,
  branchName: string,
  commitMessage: string,
): Promise<void> {
  const repoDir = getRepoDir(repoName);
  const git = simpleGit(repoDir);

  await git.checkoutLocalBranch(branchName);
  await git.add("-A");
  await git.commit(commitMessage);
  await git.push("origin", branchName, { "--set-upstream": null });
}
```

- [ ] **Step 4: 修改 workflow.ts — 删除调用处的空数组参数**

修改 `packages/gateway/src/services/workflow.ts`：

行 173 将：

```typescript
await createBranchAndPush(targetRepo, branchName, `fix: auto-fix bug ${bugIssue.id}`, []);
```

改为：

```typescript
await createBranchAndPush(targetRepo, branchName, `fix: auto-fix bug ${bugIssue.id}`);
```

行 227-231 将：

```typescript
await createBranchAndPush(
  repoName,
  branchName,
  `feat: AI 代码生成 - ${params.plane_issue_id}`,
  [],
);
```

改为：

```typescript
await createBranchAndPush(
  repoName,
  branchName,
  `feat: AI 代码生成 - ${params.plane_issue_id}`,
);
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/git.test.ts`
Expected: PASS

- [ ] **Step 6: 运行全部 gateway 测试确保无回归**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/services/git.ts packages/gateway/src/services/git.test.ts packages/gateway/src/services/workflow.ts
git commit -m "fix(gateway): createBranchAndPush 改用 git add -A 提交所有变更，修复空文件提交 bug"
```

---

### Task 3: 修复 Webhook 签名验证 — 改用 HMAC-SHA256

**Files:**

- Modify: `packages/gateway/src/middleware/verify.ts`
- Modify: `packages/gateway/src/middleware/verify.test.ts`

当前 verify.ts 用明文对比 secret，而 Plane/Gitea 等平台发送的是 HMAC-SHA256 签名。需要改为标准 HMAC 验证。

- [ ] **Step 1: 在 verify.test.ts 中添加 HMAC 测试**

重写 `packages/gateway/src/middleware/verify.test.ts`：

```typescript
import { describe, expect, it } from "bun:test";
import { createHmac } from "crypto";
import { Hono } from "hono";
import { createWebhookVerifier } from "./verify";

function createTestApp(headerName: string, secret: string) {
  const app = new Hono();
  app.use("/*", createWebhookVerifier(headerName, secret));
  app.post("/test", async (c) => {
    const body = await c.req.json();
    return c.json({ ok: true, body });
  });
  return app;
}

describe("webhook verify middleware", () => {
  it("returns 401 when signature header is missing", async () => {
    const app = createTestApp("X-Signature", "my-secret");
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when HMAC signature is wrong", async () => {
    const app = createTestApp("X-Signature", "my-secret");
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": "deadbeef",
      },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("passes when HMAC-SHA256 signature is correct (raw hex)", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body.event).toBe("test");
  });

  it("passes when signature has sha256= prefix", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test" });
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("skips verification when secret is not configured", async () => {
    const app = createTestApp("X-Signature", "");
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("allows subsequent middleware to read the body after verification", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test", data: "important" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body.data).toBe("important");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/middleware/verify.test.ts`
Expected: FAIL — 当前是明文对比

- [ ] **Step 3: 修改 verify.ts 改用 HMAC-SHA256**

```typescript
import type { MiddlewareHandler } from "hono";
import { createHmac, timingSafeEqual } from "crypto";

export function createWebhookVerifier(
  headerName: string,
  expectedSecret: string,
): MiddlewareHandler {
  return async (c, next) => {
    if (!expectedSecret) {
      await next();
      return;
    }

    const provided = c.req.header(headerName);
    if (!provided) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Clone the request so body remains readable for subsequent handlers
    const clonedReq = c.req.raw.clone();
    const body = await clonedReq.text();
    const expectedSig = createHmac("sha256", expectedSecret).update(body).digest("hex");

    // Support both raw hex and "sha256=hex" prefix formats
    const normalizedProvided = provided.startsWith("sha256=")
      ? provided.slice(7)
      : provided;

    try {
      const a = Buffer.from(normalizedProvided, "hex");
      const b = Buffer.from(expectedSig, "hex");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/middleware/verify.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/middleware/verify.ts packages/gateway/src/middleware/verify.test.ts
git commit -m "fix(gateway): webhook 签名验证改用 HMAC-SHA256 + timingSafeEqual"
```

---

### Task 4: 修复 Wiki.js 同步 mutation

**Files:**

- Modify: `packages/gateway/src/services/wikijs.ts`
- Create: `packages/gateway/src/services/wikijs.test.ts`

当前 `triggerSync()` 调用 `site { importAll }` mutation，该 API 在 Wiki.js 2.x 中不存在。正确的接口是 `storage { executeAction }`。

- [ ] **Step 1: 编写 wikijs.test.ts**

创建 `packages/gateway/src/services/wikijs.test.ts`：

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  getConfig: () => ({
    wikijsBaseUrl: "http://localhost:3000",
    wikijsApiKey: "test-api-key",
  }),
}));

// Mock global fetch
const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetchFn = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ data: { storage: { executeAction: true } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
  );
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

import { triggerSync } from "./wikijs";

describe("triggerSync", () => {
  it("should call storage.executeAction mutation with syncAll handler", async () => {
    await triggerSync();
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const callArgs = mockFetchFn.mock.calls[0];
    expect(callArgs[0]).toBe("http://localhost:3000/graphql");
    const body = JSON.parse(callArgs[1].body);
    expect(body.query).toContain("storage");
    expect(body.query).not.toContain("site");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/wikijs.test.ts`
Expected: FAIL — 当前 mutation 使用 site { importAll }

- [ ] **Step 3: 修改 wikijs.ts — 修正 mutation**

修改 `packages/gateway/src/services/wikijs.ts` 中的 `triggerSync`：

```typescript
export async function triggerSync(): Promise<void> {
  try {
    await graphql(`
      mutation {
        storage {
          executeAction(handler: "sync")
        }
      }
    `);
  } catch (error) {
    // Non-blocking: Wiki.js Git sync will catch up eventually
    console.error("Wiki.js sync trigger failed:", error);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/wikijs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/wikijs.ts packages/gateway/src/services/wikijs.test.ts
git commit -m "fix(gateway): Wiki.js 同步改用 storage.executeAction mutation"
```

---

### Task 5: Dify 支持多工作流 API Key

**Files:**

- Modify: `packages/gateway/src/config.ts`
- Modify: `packages/gateway/src/config.test.ts`
- Modify: `packages/gateway/src/services/dify.ts`
- Create: `packages/gateway/src/services/dify.test.ts`

设计文档规划了四条独立的 Dify 工作流，每条有独立的 API Key。当前只有一个 `difyApiKey`，三个函数共用。

- [ ] **Step 1: 编写 config.test.ts 新增字段测试**

在 `packages/gateway/src/config.test.ts` 中添加：

```typescript
it("should have separate Dify API keys for each workflow", () => {
  process.env.DIFY_TECH_DOC_API_KEY = "key-tech";
  process.env.DIFY_OPENAPI_API_KEY = "key-openapi";
  process.env.DIFY_BUG_ANALYSIS_API_KEY = "key-bug";
  const config = getConfig();
  expect(config.difyTechDocApiKey).toBe("key-tech");
  expect(config.difyOpenApiApiKey).toBe("key-openapi");
  expect(config.difyBugAnalysisApiKey).toBe("key-bug");
  delete process.env.DIFY_TECH_DOC_API_KEY;
  delete process.env.DIFY_OPENAPI_API_KEY;
  delete process.env.DIFY_BUG_ANALYSIS_API_KEY;
});

it("should fall back to DIFY_API_KEY when specific keys not set", () => {
  process.env.DIFY_API_KEY = "key-fallback";
  const config = getConfig();
  expect(config.difyTechDocApiKey).toBe("key-fallback");
  expect(config.difyOpenApiApiKey).toBe("key-fallback");
  expect(config.difyBugAnalysisApiKey).toBe("key-fallback");
  delete process.env.DIFY_API_KEY;
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/config.test.ts`
Expected: FAIL

- [ ] **Step 3: 修改 config.ts 添加多 Key 配置**

在 `Config` 接口和 `getConfig()` 中：

```typescript
// 在 Config 接口 difyApiKey 下方添加
difyTechDocApiKey: string;
difyOpenApiApiKey: string;
difyBugAnalysisApiKey: string;

// 在 getConfig() 返回值中添加
difyTechDocApiKey: process.env.DIFY_TECH_DOC_API_KEY ?? process.env.DIFY_API_KEY ?? "",
difyOpenApiApiKey: process.env.DIFY_OPENAPI_API_KEY ?? process.env.DIFY_API_KEY ?? "",
difyBugAnalysisApiKey: process.env.DIFY_BUG_ANALYSIS_API_KEY ?? process.env.DIFY_API_KEY ?? "",
```

- [ ] **Step 4: 运行 config 测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/config.test.ts`
Expected: PASS

- [ ] **Step 5: 编写 dify.test.ts**

创建 `packages/gateway/src/services/dify.test.ts`：

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    difyBaseUrl: "http://localhost:5001",
    difyApiKey: "default-key",
    difyTechDocApiKey: "tech-key",
    difyOpenApiApiKey: "openapi-key",
    difyBugAnalysisApiKey: "bug-key",
  }),
}));

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function mockDifyResponse(output: string) {
  return new Response(JSON.stringify({
    data: { id: "1", workflow_id: "w1", status: "succeeded", outputs: { result: output } },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  mockFetchFn = mock(() => Promise.resolve(mockDifyResponse("generated content")));
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

import { generateTechDoc, generateOpenApi, analyzeBug } from "./dify";

describe("dify service", () => {
  it("generateTechDoc should use tech doc API key", async () => {
    await generateTechDoc("prd content");
    const headers = mockFetchFn.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer tech-key");
  });

  it("generateOpenApi should use openapi API key", async () => {
    await generateOpenApi("tech doc content");
    const headers = mockFetchFn.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer openapi-key");
  });

  it("analyzeBug should use bug analysis API key", async () => {
    await analyzeBug("ci log", "context");
    const headers = mockFetchFn.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer bug-key");
  });
});
```

- [ ] **Step 6: 运行 dify 测试验证失败**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/dify.test.ts`
Expected: FAIL — 当前三个函数都用同一个 key

- [ ] **Step 7: 修改 dify.ts — 每个函数传入对应 API Key**

```typescript
import { getConfig } from "../config";

interface DifyWorkflowResponse {
  data: {
    id: string;
    workflow_id: string;
    status: string;
    outputs: Record<string, string>;
    error?: string;
  };
}

async function callDifyWorkflow(
  inputs: Record<string, string>,
  apiKey: string,
  retries = 2,
): Promise<string> {
  const config = getConfig();
  const url = `${config.difyBaseUrl}/v1/workflows/run`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          inputs,
          response_mode: "blocking",
          user: "gateway-service",
        }),
      });

      if (!res.ok) {
        throw new Error(`Dify API error: ${res.status} ${await res.text()}`);
      }

      const json = (await res.json()) as DifyWorkflowResponse;

      if (json.data.status !== "succeeded") {
        throw new Error(`Dify workflow failed: ${json.data.error ?? "unknown error"}`);
      }

      const outputs = json.data.outputs;
      const outputKey = Object.keys(outputs)[0];
      return outputs[outputKey] ?? "";
    } catch (error) {
      if (attempt < retries) {
        const delay = attempt === 0 ? 5000 : 15000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Dify workflow call failed after all retries");
}

export async function generateTechDoc(prdContent: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow({ prd_content: prdContent }, config.difyTechDocApiKey);
}

export async function generateOpenApi(techDocContent: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow({ tech_doc_content: techDocContent }, config.difyOpenApiApiKey);
}

export async function analyzeBug(ciLog: string, context: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow({ ci_log: ciLog, context }, config.difyBugAnalysisApiKey);
}
```

- [ ] **Step 8: 运行 dify 测试验证通过**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/dify.test.ts`
Expected: PASS

- [ ] **Step 9: 更新 .env.example 添加新环境变量**

在 `packages/gateway/.env.example` 中 `DIFY_API_KEY` 下方添加：

```bash
# 各工作流独立 API Key（不设置则回退到 DIFY_API_KEY）
# DIFY_TECH_DOC_API_KEY=
# DIFY_OPENAPI_API_KEY=
# DIFY_BUG_ANALYSIS_API_KEY=
```

- [ ] **Step 10: Commit**

```bash
git add packages/gateway/src/config.ts packages/gateway/src/config.test.ts \
  packages/gateway/src/services/dify.ts packages/gateway/src/services/dify.test.ts \
  packages/gateway/.env.example
git commit -m "feat(gateway): Dify 支持多工作流独立 API Key，回退兼容单 Key"
```

---

### Task 6: 补充 feishu.test.ts — 飞书服务测试

**Files:**

- Create: `packages/gateway/src/services/feishu.test.ts`

- [ ] **Step 1: 编写飞书服务测试**

创建 `packages/gateway/src/services/feishu.test.ts`：

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    feishuAppId: "test-app-id",
    feishuAppSecret: "test-app-secret",
  }),
}));

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;
let fetchCallCount: number;

beforeEach(() => {
  fetchCallCount = 0;
  mockFetchFn = mock(async (url: string) => {
    fetchCallCount++;
    if (typeof url === "string" && url.includes("tenant_access_token")) {
      return new Response(JSON.stringify({
        code: 0,
        tenant_access_token: "test-token-123",
        expire: 7200,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Message send response
    return new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

import { sendNotification, sendBugNotification, sendTechReviewCard } from "./feishu";

describe("feishu service", () => {
  it("sendNotification should get token and send message", async () => {
    await sendNotification("chat-1", "Title", "Content");
    // First call: get token, second call: send message
    expect(fetchCallCount).toBe(2);
    const messageCall = mockFetchFn.mock.calls[1];
    expect(messageCall[1].headers.Authorization).toBe("Bearer test-token-123");
  });

  it("sendBugNotification should use red template for P0", async () => {
    await sendBugNotification("chat-1", "BUG-1", "report", "P0");
    const messageCall = mockFetchFn.mock.calls[1];
    const body = JSON.parse(messageCall[1].body);
    const card = JSON.parse(body.content);
    expect(card.header.template).toBe("red");
  });

  it("sendBugNotification should use orange template for P2", async () => {
    await sendBugNotification("chat-1", "BUG-1", "report", "P2");
    const messageCall = mockFetchFn.mock.calls[1];
    const body = JSON.parse(messageCall[1].body);
    const card = JSON.parse(body.content);
    expect(card.header.template).toBe("orange");
  });

  it("sendTechReviewCard should include approve and reject buttons", async () => {
    await sendTechReviewCard({
      chatId: "chat-1",
      featureName: "test-feature",
      prdLink: "/prd/test.md",
      techDocLink: "/tech-design/test.md",
      openApiLink: "/api/test.yaml",
      issueId: "ISSUE-1",
      docPath: "/tech-design/test.md",
    });
    const messageCall = mockFetchFn.mock.calls[1];
    const body = JSON.parse(messageCall[1].body);
    const card = JSON.parse(body.content);
    const actions = card.elements.find((e: { tag: string }) => e.tag === "action");
    expect(actions.actions).toHaveLength(2);
    expect(actions.actions[0].text.content).toContain("通过");
    expect(actions.actions[1].text.content).toContain("打回");
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/feishu.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/services/feishu.test.ts
git commit -m "test(gateway): 添加飞书服务单元测试"
```

---

### Task 7: 补充 plane.test.ts — Plane 服务测试

**Files:**

- Create: `packages/gateway/src/services/plane.test.ts`

需要先读取 plane.ts 确认接口。

- [ ] **Step 1: 编写 Plane 服务测试**

创建 `packages/gateway/src/services/plane.test.ts`，mock fetch 验证：

- `createBugIssue` 发送正确的请求并返回解析后的 Issue
- 重试逻辑在第一次失败后重试

- [ ] **Step 2: 运行测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/plane.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/services/plane.test.ts
git commit -m "test(gateway): 添加 Plane 服务单元测试"
```

---

### Task 8: 补充 claude-code.test.ts — Claude Code 服务测试

**Files:**

- Create: `packages/gateway/src/services/claude-code.test.ts`

- [ ] **Step 1: 编写 Claude Code 服务测试**

创建 `packages/gateway/src/services/claude-code.test.ts`，mock `Bun.spawn` 验证：

- 成功时返回 `{ success: true, output }`
- 非零退出码返回 `{ success: false, error }`
- 传入 figmaUrl 时生成 .mcp.json 文件

- [ ] **Step 2: 运行测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/src/services/claude-code.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/services/claude-code.test.ts
git commit -m "test(gateway): 添加 Claude Code 服务单元测试"
```

---

### Task 9: 运行全量测试 + 覆盖率检查

**Files:** 无修改

- [ ] **Step 1: 运行全部 gateway 测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun test packages/gateway/ --coverage`
Expected: ALL PASS, 覆盖率 >= 80%

- [ ] **Step 2: 运行 lint 检查**

Run: `cd /Users/chenqi/code/ArcFlow && bun run lint`
Expected: 无错误

- [ ] **Step 3: 如有 lint 错误，修复后 commit**

```bash
git add -A
git commit -m "chore(gateway): fix lint errors"
```
