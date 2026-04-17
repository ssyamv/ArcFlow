# Phase 3.5 Codegen CI Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tech_to_openapi -> code_gen -> CI -> bug_analysis` 收口到统一的 ArcFlow 工作流主链路，同时保持对外仍显示单一 `code_gen` 节点。

**Architecture:** 保留 `workflow_execution` 作为主执行记录，新增 `workflow_subtask` 和 `workflow_link` 表承载 `code_gen` 的内部阶段状态与派生关系。Gateway 统一负责 dispatch、callback、CI webhook 映射和聚合查询，Web 仅消费聚合后的主状态、摘要、子任务和链路。

**Tech Stack:** Bun + Hono + bun:sqlite + Vue 3 + Pinia + Vitest + Bun test

---

## File Structure

### Gateway

- Modify: `packages/gateway/src/db/schema.sql`
  - 新增 `workflow_subtask`、`workflow_link` 表和索引。
- Modify: `packages/gateway/src/types/index.ts`
  - 定义子任务、链路、CI 事件、扩展的详情/列表响应类型。
- Modify: `packages/gateway/src/db/queries.ts`
  - 新增子任务和链路 CRUD、CI 事件关联查询、详情聚合查询。
- Modify: `packages/gateway/src/db/queries.test.ts`
  - 为新表和查询增加 DB 层测试。
- Modify: `packages/gateway/src/services/workflow.ts`
  - 把 `code_gen` 从 Gateway 直跑改为创建子任务 + dispatch/callback 主线。
- Modify: `packages/gateway/src/services/workflow.test.ts`
  - 覆盖新 `code_gen` 编排、失败边界和幂等行为。
- Modify: `packages/gateway/src/services/workflow-callback.ts`
  - 支持 `code_gen` callback 回写子任务和链接派生。
- Modify: `packages/gateway/src/services/workflow-callback.test.ts`
  - 覆盖 `code_gen` callback 与重复回放。
- Modify: `packages/gateway/src/routes/webhook.ts`
  - 将 `/webhook/cicd` 和 `/webhook/ibuild` 映射到统一 CI 事件 service。
- Modify: `packages/gateway/src/routes/webhook.test.ts`
  - 覆盖两个入口统一回写、CI 失败派生 `bug_analysis`。
- Modify: `packages/gateway/src/routes/api.ts`
  - 返回聚合后的 `code_gen` 摘要、详情 `subtasks` 与 `links`。
- Modify: `packages/gateway/src/routes/api.test.ts`
  - 覆盖新详情结构和列表摘要。

### Web

- Modify: `packages/web/src/api/workflow.ts`
  - 接收新的列表摘要、详情 `subtasks` 和 `links` 类型。
- Modify: `packages/web/src/stores/workflow.ts`
  - 兼容列表摘要字段。
- Modify: `packages/web/src/pages/WorkflowList.vue`
  - 增加 `code_gen` 摘要展示。
- Create: `packages/web/src/pages/WorkflowList.test.ts`
  - 覆盖摘要渲染。
- Modify: `packages/web/src/pages/WorkflowDetail.vue`
  - 增加子任务时间线/表格和派生链路展示。
- Create: `packages/web/src/pages/WorkflowDetail.test.ts`
  - 覆盖新详情渲染和状态颜色。

## Task 1: 数据模型与查询基础

**Files:**

- Modify: `packages/gateway/src/db/schema.sql`
- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/db/queries.ts`
- Test: `packages/gateway/src/db/queries.test.ts`

- [ ] **Step 1: 写出 DB 层失败测试，锁定新表与查询接口**

```ts
import {
  createWorkflowExecution,
  createWorkflowSubtask,
  listWorkflowSubtasks,
  createWorkflowLink,
  listWorkflowLinks,
  updateWorkflowSubtaskStatus,
} from "./queries";

it("creates and lists workflow subtasks by execution", () => {
  const executionId = createWorkflowExecution({
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISSUE-120",
  });

  createWorkflowSubtask({
    execution_id: executionId,
    stage: "dispatch",
    target: "backend",
    provider: "nanoclaw",
    status: "pending",
    repo_name: "backend",
  });

  const subtasks = listWorkflowSubtasks(executionId);
  expect(subtasks).toHaveLength(1);
  expect(subtasks[0]?.target).toBe("backend");
  expect(subtasks[0]?.stage).toBe("dispatch");
});

it("creates workflow links between executions", () => {
  const sourceExecutionId = createWorkflowExecution({
    workflow_type: "tech_to_openapi",
    trigger_source: "manual",
  });
  const targetExecutionId = createWorkflowExecution({
    workflow_type: "code_gen",
    trigger_source: "manual",
  });

  createWorkflowLink({
    source_execution_id: sourceExecutionId,
    target_execution_id: targetExecutionId,
    link_type: "derived_from",
    metadata: { source_stage: "success" },
  });

  const links = listWorkflowLinks(targetExecutionId);
  expect(links.some((link) => link.source_execution_id === sourceExecutionId)).toBe(true);
});
```

- [ ] **Step 2: 运行 DB 测试，确认新接口尚未实现**

Run:

```bash
bun test packages/gateway/src/db/queries.test.ts
```

Expected: FAIL，报错包含 `createWorkflowSubtask is not a function` 或 `no such table: workflow_subtask`。

- [ ] **Step 3: 最小实现 schema、types 和 queries**

```sql
CREATE TABLE IF NOT EXISTS workflow_subtask (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES workflow_execution(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  target TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_ref TEXT,
  output_ref TEXT,
  external_run_id TEXT,
  branch_name TEXT,
  repo_name TEXT,
  log_url TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_subtask_execution
  ON workflow_subtask(execution_id, target, stage);

CREATE TABLE IF NOT EXISTS workflow_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_execution_id INTEGER NOT NULL REFERENCES workflow_execution(id) ON DELETE CASCADE,
  target_execution_id INTEGER NOT NULL REFERENCES workflow_execution(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_link_target ON workflow_link(target_execution_id, created_at);
```

```ts
export interface WorkflowSubtask {
  id: number;
  execution_id: number;
  stage: string;
  target: string;
  provider: string;
  status: WorkflowStatus;
  input_ref: string | null;
  output_ref: string | null;
  external_run_id: string | null;
  branch_name: string | null;
  repo_name: string | null;
  log_url: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowLink {
  id: number;
  source_execution_id: number;
  target_execution_id: number;
  link_type: string;
  metadata: string;
  created_at: string;
}
```

```ts
export function createWorkflowSubtask(params: {
  execution_id: number;
  stage: string;
  target: string;
  provider: string;
  status?: WorkflowStatus;
  repo_name?: string;
}): number {
  const db = getDb();
  db.query(
    `INSERT INTO workflow_subtask (execution_id, stage, target, provider, status, repo_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    params.execution_id,
    params.stage,
    params.target,
    params.provider,
    params.status ?? "pending",
    params.repo_name ?? null,
  );
  return (db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

export function listWorkflowSubtasks(executionId: number): WorkflowSubtask[] {
  return getDb()
    .query(
      `SELECT * FROM workflow_subtask
       WHERE execution_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(executionId) as WorkflowSubtask[];
}

export function createWorkflowLink(params: {
  source_execution_id: number;
  target_execution_id: number;
  link_type: string;
  metadata?: Record<string, unknown>;
}): number {
  const db = getDb();
  db.query(
    `INSERT INTO workflow_link (source_execution_id, target_execution_id, link_type, metadata)
     VALUES (?, ?, ?, ?)`,
  ).run(
    params.source_execution_id,
    params.target_execution_id,
    params.link_type,
    JSON.stringify(params.metadata ?? {}),
  );
  return (db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}
```

- [ ] **Step 4: 运行 DB 测试确认通过**

Run:

```bash
bun test packages/gateway/src/db/queries.test.ts
```

Expected: PASS，包含 `workflow_execution`、`workflow_subtask`、`workflow_link` 相关用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/schema.sql packages/gateway/src/types/index.ts packages/gateway/src/db/queries.ts packages/gateway/src/db/queries.test.ts
git commit -m "feat(gateway): add workflow subtask and link persistence"
```

## Task 2: `code_gen` 改为 dispatch/callback 主线

**Files:**

- Modify: `packages/gateway/src/services/workflow.ts`
- Modify: `packages/gateway/src/services/workflow.test.ts`
- Modify: `packages/gateway/src/routes/api.ts`
- Test: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: 先写失败测试，定义新的 `code_gen` 编排行为**

```ts
it("creates backend subtask and dispatches code_gen through NanoClaw", async () => {
  await triggerWorkflow({
    workspace_id: 1,
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISS-120",
    target_repos: ["backend"],
  });
  await tick();

  expect(createWorkflowSubtask).toHaveBeenCalledWith(
    expect.objectContaining({
      execution_id: 42,
      target: "backend",
      stage: "dispatch",
      provider: "nanoclaw",
    }),
  );
  expect(insertDispatch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      skill: "arcflow-code-gen",
      planeIssueId: "ISS-120",
    }),
  );
  expect(runClaudeCode).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行 workflow 测试，确认旧实现不满足新行为**

Run:

```bash
bun test packages/gateway/src/services/workflow.test.ts
```

Expected: FAIL，至少包含 `createWorkflowSubtask` 未调用或 `runClaudeCode` 仍被调用。

- [ ] **Step 3: 最小重构 `workflow.ts`，把 `code_gen` 改为建子任务 + dispatch**

```ts
async function flowCodeGen(executionId: number, params: TriggerParams, ws: Workspace): Promise<void> {
  const targets = params.target_repos ?? ["backend"];
  const docsRepo = wsRepoName(ws.id, "docs");
  const db = getDb();

  let taskContext = "";
  if (params.input_path) {
    await ensureRepo(docsRepo);
    taskContext = await readFile(docsRepo, params.input_path);
  }

  for (const target of targets) {
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "dispatch",
      target,
      provider: "nanoclaw",
      status: "pending",
      repo_name: target,
    });

    insertDispatch(db, {
      workspaceId: String(ws.id),
      skill: "arcflow-code-gen",
      planeIssueId: params.plane_issue_id,
      input: {
        execution_id: executionId,
        target,
        workspace_id: ws.id,
        plane_issue_id: params.plane_issue_id,
        input_path: params.input_path,
        figma_url: params.figma_url,
        task_context: taskContext,
      },
      timeoutAt: Date.now() + 10 * 60 * 1000,
    });
  }
}
```

```ts
apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();
  // ...existing validation...
  const id = await triggerWorkflow({
    workspace_id: body.workspace_id,
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    input_path: body.params?.input_path,
    target_repos: body.params?.target_repos ?? body.params?.targets,
    figma_url: body.params?.figma_url,
    chat_id: body.params?.chat_id,
  });
  return c.json({ execution_id: id, status: "running", message: "工作流已触发" });
});
```

- [ ] **Step 4: 运行 workflow 与 API 测试**

Run:

```bash
bun test packages/gateway/src/services/workflow.test.ts
bun test packages/gateway/src/routes/api.test.ts
```

Expected: PASS，`code_gen` 相关用例不再依赖 `runClaudeCode`，手动触发仍返回 `execution_id`。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/workflow.ts packages/gateway/src/services/workflow.test.ts packages/gateway/src/routes/api.ts packages/gateway/src/routes/api.test.ts
git commit -m "refactor(gateway): route codegen through dispatch workflow"
```

## Task 3: callback、CI webhook 与 `bug_analysis` 派生

**Files:**

- Modify: `packages/gateway/src/services/workflow-callback.ts`
- Modify: `packages/gateway/src/services/workflow-callback.test.ts`
- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts`
- Modify: `packages/gateway/src/db/queries.ts`

- [ ] **Step 1: 先写失败测试，覆盖 `code_gen` callback 和统一 CI 回写**

```ts
it("writes code_gen callback result into generate subtask and branch metadata", async () => {
  const handled = await handler.handle({
    dispatch_id: "d-codegen-1",
    skill: "arcflow-code-gen",
    status: "success",
    result: {
      content: JSON.stringify({
        execution_id: 7,
        target: "backend",
        branch_name: "feature/ISS-120-backend",
        repo_name: "backend",
      }),
    },
  });

  expect(handled).toBe(true);
  expect(updateWorkflowSubtaskStatus).toHaveBeenCalledWith(
    expect.objectContaining({
      execution_id: 7,
      target: "backend",
      stage: "generate",
      status: "success",
      branch_name: "feature/ISS-120-backend",
    }),
  );
});

it("maps ibuild failure into ci_failed subtask and spawns bug_analysis execution", async () => {
  const res = await app.request("/webhook/ibuild?secret=ibuild-secret", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "status=FAIL&buildId=b-1&projectId=p1&appId=a1&gitBranch=feature/ISS-120-backend&appKey=backend",
  });

  expect(res.status).toBe(200);
  expect(createWorkflowExecution).toHaveBeenCalledWith(
    expect.objectContaining({ workflow_type: "bug_analysis" }),
  );
  expect(createWorkflowLink).toHaveBeenCalledWith(
    expect.objectContaining({ link_type: "spawned_on_ci_failure" }),
  );
});
```

- [ ] **Step 2: 运行 callback 和 webhook 测试，确认失败**

Run:

```bash
bun test packages/gateway/src/services/workflow-callback.test.ts
bun test packages/gateway/src/routes/webhook.test.ts
```

Expected: FAIL，报错集中在 `arcflow-code-gen` 未处理、CI 失败未更新子任务、未派生 `bug_analysis`。

- [ ] **Step 3: 最小实现统一回写与派生逻辑**

```ts
function parseCodegenResult(content: string) {
  return JSON.parse(content) as {
    execution_id: number;
    target: string;
    branch_name?: string;
    repo_name?: string;
    log_url?: string;
  };
}

if (p.skill === "arcflow-code-gen") {
  const result = parseCodegenResult(content);
  await deps.markSubtaskProgress({
    executionId: result.execution_id,
    target: result.target,
    stage: "generate",
    status: "success",
    branchName: result.branch_name,
    repoName: result.repo_name,
    logUrl: result.log_url,
  });
  await deps.markSubtaskProgress({
    executionId: result.execution_id,
    target: result.target,
    stage: "ci_pending",
    status: "pending",
  });
}
```

```ts
function mapCiEvent(body: Record<string, unknown>) {
  return {
    planeIssueId: String(body.issue_id ?? body.plane_issue_id ?? ""),
    target: String(body.target ?? body.repository ?? body.repo ?? "backend"),
    provider: "generic",
    externalRunId: String(body.run_id ?? body.build_id ?? body.buildId ?? ""),
    status: normalizeCiStatus(String(body.status ?? body.state ?? "")),
    logUrl: typeof body.log_url === "string" ? body.log_url : null,
    rawPayload: body,
  };
}

async function handleCiEvent(event: UnifiedCiEvent) {
  const execution = findLatestCodegenExecution(event.planeIssueId, event.target);
  if (!execution) return;

  updateWorkflowSubtaskStatusByStage({
    executionId: execution.id,
    target: event.target,
    stage: event.status === "failed" ? "ci_failed" : "ci_success",
    provider: event.provider,
    status: event.status === "failed" ? "failed" : "success",
    externalRunId: event.externalRunId,
    logUrl: event.logUrl,
  });

  if (event.status === "failed") {
    const bugExecutionId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: event.provider === "ibuild" ? "ibuild_webhook" : "cicd_webhook",
      plane_issue_id: event.planeIssueId,
      input_path: event.logUrl ?? null,
    });
    createWorkflowLink({
      source_execution_id: execution.id,
      target_execution_id: bugExecutionId,
      link_type: "spawned_on_ci_failure",
      metadata: { target: event.target, provider: event.provider },
    });
  }
}
```

- [ ] **Step 4: 运行 callback、webhook 和 DB 测试**

Run:

```bash
bun test packages/gateway/src/services/workflow-callback.test.ts
bun test packages/gateway/src/routes/webhook.test.ts
bun test packages/gateway/src/db/queries.test.ts
```

Expected: PASS，`code_gen` callback 可推进 `generate/ci_pending`，`/webhook/cicd` 与 `/webhook/ibuild` 都落到同一条 `code_gen` 主链路。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/workflow-callback.ts packages/gateway/src/services/workflow-callback.test.ts packages/gateway/src/routes/webhook.ts packages/gateway/src/routes/webhook.test.ts packages/gateway/src/db/queries.ts
git commit -m "feat(gateway): unify ci backflow for codegen executions"
```

## Task 4: 聚合查询与 Gateway API 输出

**Files:**

- Modify: `packages/gateway/src/db/queries.ts`
- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/routes/api.test.ts`
- Modify: `packages/gateway/src/types/index.ts`

- [ ] **Step 1: 先写失败测试，定义列表摘要和详情扩展结构**

```ts
it("GET /api/workflow/executions returns code_gen summary", async () => {
  const res = await app.request("/api/workflow/executions");
  expect(res.status).toBe(200);
  const payload = await res.json();
  expect(payload.data[0]).toEqual(
    expect.objectContaining({
      workflow_type: "code_gen",
      summary: expect.objectContaining({
        total_targets: 2,
        completed_targets: 1,
        latest_stage: "ci_running",
      }),
    }),
  );
});

it("GET /api/workflow/executions/:id returns subtasks and links", async () => {
  const res = await app.request("/api/workflow/executions/7");
  expect(res.status).toBe(200);
  const payload = await res.json();
  expect(payload.subtasks).toHaveLength(2);
  expect(payload.links).toEqual(
    expect.arrayContaining([expect.objectContaining({ link_type: "derived_from" })]),
  );
});
```

- [ ] **Step 2: 运行 API 测试确认失败**

Run:

```bash
bun test packages/gateway/src/routes/api.test.ts
```

Expected: FAIL，返回结构缺少 `summary`、`subtasks` 或 `links`。

- [ ] **Step 3: 最小实现聚合查询和返回结构**

```ts
export function getWorkflowExecutionDetail(id: number) {
  const execution = getWorkflowExecution(id);
  if (!execution) return null;

  const subtasks = listWorkflowSubtasks(id);
  const links = listWorkflowLinks(id);
  const summary =
    execution.workflow_type === "code_gen"
      ? {
          total_targets: new Set(subtasks.map((item) => item.target)).size,
          completed_targets: new Set(
            subtasks.filter((item) => item.stage === "ci_success").map((item) => item.target),
          ).size,
          latest_stage: subtasks.at(-1)?.stage ?? null,
        }
      : null;

  return { ...execution, summary, subtasks, links };
}

export function listWorkflowExecutionsWithSummary(filters: {
  workflow_type?: WorkflowType;
  status?: WorkflowStatus;
  limit?: number;
}) {
  const base = listWorkflowExecutions(filters);
  return {
    ...base,
    data: base.data.map((execution) => ({
      ...execution,
      summary:
        execution.workflow_type === "code_gen"
          ? buildExecutionSummary(listWorkflowSubtasks(execution.id))
          : null,
    })),
  };
}
```

```ts
apiRoutes.get("/workflow/executions/:id", (c) => {
  const id = Number(c.req.param("id"));
  const detail = getWorkflowExecutionDetail(id);
  if (!detail) return c.json({ error: "Not found" }, 404);
  return c.json(detail);
});

apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as WorkflowType | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;
  return c.json(listWorkflowExecutionsWithSummary({ workflow_type: workflowType, status, limit }));
});
```

- [ ] **Step 4: 运行 API 测试**

Run:

```bash
bun test packages/gateway/src/routes/api.test.ts
```

Expected: PASS，列表可返回 `code_gen.summary`，详情可返回 `subtasks` 和 `links`。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/queries.ts packages/gateway/src/routes/api.ts packages/gateway/src/routes/api.test.ts packages/gateway/src/types/index.ts
git commit -m "feat(gateway): expose codegen summaries and workflow details"
```

## Task 5: Web 展示与前端测试

**Files:**

- Modify: `packages/web/src/api/workflow.ts`
- Modify: `packages/web/src/stores/workflow.ts`
- Modify: `packages/web/src/pages/WorkflowList.vue`
- Create: `packages/web/src/pages/WorkflowList.test.ts`
- Modify: `packages/web/src/pages/WorkflowDetail.vue`
- Create: `packages/web/src/pages/WorkflowDetail.test.ts`

- [ ] **Step 1: 先写失败测试，锁定列表摘要和详情时间线渲染**

```ts
it("renders code_gen summary in workflow list", async () => {
  vi.spyOn(api, "fetchExecutions").mockResolvedValue({
    total: 1,
    data: [
      {
        id: 7,
        workflow_type: "code_gen",
        trigger_source: "manual",
        plane_issue_id: "ISS-120",
        status: "running",
        error_message: null,
        started_at: "2026-04-16 12:00:00",
        completed_at: null,
        created_at: "2026-04-16 12:00:00",
        summary: { total_targets: 2, completed_targets: 1, latest_stage: "ci_running" },
      },
    ],
  });

  const wrapper = mount(WorkflowList, { global: { plugins: [router, pinia] } });
  await flushPromises();
  expect(wrapper.text()).toContain("1/2");
  expect(wrapper.text()).toContain("ci_running");
});

it("renders subtasks and workflow links in detail view", async () => {
  vi.spyOn(api, "fetchExecution").mockResolvedValue({
    id: 7,
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISS-120",
    input_path: "api/feature.yaml",
    status: "failed",
    error_message: null,
    started_at: "2026-04-16 12:00:00",
    completed_at: "2026-04-16 12:10:00",
    created_at: "2026-04-16 12:00:00",
    subtasks: [
      { id: 1, target: "backend", stage: "ci_failed", status: "failed", provider: "ibuild" },
    ],
    links: [
      { id: 1, source_execution_id: 7, target_execution_id: 8, link_type: "spawned_on_ci_failure" },
    ],
  });

  const wrapper = mount(WorkflowDetail, { global: { plugins: [router] } });
  await flushPromises();
  expect(wrapper.text()).toContain("backend");
  expect(wrapper.text()).toContain("ci_failed");
  expect(wrapper.text()).toContain("spawned_on_ci_failure");
});
```

- [ ] **Step 2: 运行前端测试，确认页面尚未支持新字段**

Run:

```bash
bun --cwd packages/web test
```

Expected: FAIL，新建页面测试失败，提示找不到摘要文案或详情未渲染 `subtasks` / `links`。

- [ ] **Step 3: 最小实现前端类型与页面渲染**

```ts
export interface WorkflowSummary {
  total_targets: number;
  completed_targets: number;
  latest_stage: string | null;
}

export interface WorkflowSubtask {
  id: number;
  target: string;
  stage: string;
  provider: string;
  status: string;
  branch_name?: string | null;
  repo_name?: string | null;
  log_url?: string | null;
  error_message?: string | null;
}

export interface WorkflowLink {
  id: number;
  source_execution_id: number;
  target_execution_id: number;
  link_type: string;
}

export interface ExecutionDetail {
  id: number;
  workflow_type: string;
  trigger_source: string;
  plane_issue_id: string | null;
  input_path: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  summary?: WorkflowSummary | null;
  subtasks?: WorkflowSubtask[];
  links?: WorkflowLink[];
}
```

```vue
<td class="table-cell">
  <div class="flex flex-col gap-1">
    <span class="status-pill" style="border-color: var(--color-border-solid)">
      {{ typeLabel(exec.workflow_type) }}
    </span>
    <span
      v-if="exec.workflow_type === 'code_gen' && exec.summary"
      class="text-xs"
      style="color: var(--color-text-quaternary)"
    >
      {{ exec.summary.completed_targets }}/{{ exec.summary.total_targets }} ·
      {{ exec.summary.latest_stage ?? 'pending' }}
    </span>
  </div>
</td>
```

```vue
<div
  v-if="execution?.subtasks?.length"
  class="rounded-lg p-5"
  style="background-color: var(--color-surface-02); border: 1px solid var(--color-border-default)"
>
  <div class="text-xs uppercase mb-4" style="font-weight: 510; color: var(--color-text-quaternary)">
    子任务
  </div>
  <div class="space-y-3">
    <div
      v-for="subtask in execution.subtasks"
      :key="subtask.id"
      class="rounded-md p-3"
      style="border: 1px solid var(--color-border-subtle)"
    >
      <div class="text-sm" style="font-weight: 510; color: var(--color-text-primary)">
        {{ subtask.target }} · {{ subtask.stage }}
      </div>
      <div class="text-xs" style="color: var(--color-text-quaternary)">
        {{ subtask.provider }} · {{ statusLabelMap[subtask.status] ?? subtask.status }}
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: 运行前端测试与构建**

Run:

```bash
bun --cwd packages/web test
bun --cwd packages/web build
```

Expected: PASS，列表与详情测试通过，Vite build 成功。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/workflow.ts packages/web/src/stores/workflow.ts packages/web/src/pages/WorkflowList.vue packages/web/src/pages/WorkflowList.test.ts packages/web/src/pages/WorkflowDetail.vue packages/web/src/pages/WorkflowDetail.test.ts
git commit -m "feat(web): surface codegen stages and ci closure details"
```

## Task 6: 最终联调与回归验证

**Files:**

- Modify: `packages/gateway/src/routes/webhook.test.ts`
- Modify: `packages/gateway/src/services/workflow.test.ts`
- Modify: `packages/web/src/pages/WorkflowDetail.test.ts`
- Optional docs update: `docs/superpowers/reports/2026-04-16-phase-3-5-verification.md`

- [ ] **Step 1: 补最后一轮验收测试**

```ts
it("closes the chain from tech_to_openapi to code_gen to bug_analysis", async () => {
  const sourceExecutionId = createWorkflowExecution({
    workflow_type: "tech_to_openapi",
    trigger_source: "manual",
    plane_issue_id: "ISS-120",
  });

  const codegenExecutionId = createWorkflowExecution({
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISS-120",
  });

  createWorkflowLink({
    source_execution_id: sourceExecutionId,
    target_execution_id: codegenExecutionId,
    link_type: "derived_from",
  });

  createWorkflowSubtask({
    execution_id: codegenExecutionId,
    target: "backend",
    stage: "ci_failed",
    provider: "ibuild",
    status: "failed",
    repo_name: "backend",
  });

  const detail = getWorkflowExecutionDetail(codegenExecutionId);
  expect(detail?.links.some((link) => link.link_type === "derived_from")).toBe(true);
});
```

- [ ] **Step 2: 运行 Gateway 全量测试**

Run:

```bash
bun --cwd packages/gateway test
```

Expected: PASS，Gateway 现有测试与新增 Phase 3.5 测试全部通过。

- [ ] **Step 3: 运行 Web 全量测试和构建**

Run:

```bash
bun --cwd packages/web test
bun --cwd packages/web build
```

Expected: PASS。

- [ ] **Step 4: 记录本地验证结果**

```md
# Phase 3.5 Verification

- Gateway tests: `bun --cwd packages/gateway test`
- Web tests: `bun --cwd packages/web test`
- Web build: `bun --cwd packages/web build`
- Verified:
  - `code_gen` 列表摘要
  - 详情页 `subtasks` 与 `links`
  - `/webhook/cicd` 和 `/webhook/ibuild` 统一回写
  - `ci_failed` 派生 `bug_analysis`
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/webhook.test.ts packages/gateway/src/services/workflow.test.ts packages/web/src/pages/WorkflowDetail.test.ts docs/superpowers/reports/2026-04-16-phase-3-5-verification.md
git commit -m "test: verify phase 3.5 codegen ci closure"
```

## Self-Review

- Spec coverage checked:
  - 数据模型与内部状态机：Task 1
  - `code_gen` dispatch/callback 主线：Task 2
  - `/webhook/cicd` 与 `/webhook/ibuild` 统一回写：Task 3
  - `bug_analysis` 仅从 `ci_failed` 派生：Task 3
  - 列表摘要与详情页展示：Task 4、Task 5
  - 端到端验收：Task 6
- Placeholder scan:
  - 已检查，无 `TODO`、`TBD`、`implement later`、`write tests for the above` 之类占位描述。
- Type consistency:
  - 统一使用 `workflow_subtask`、`workflow_link`、`summary`、`subtasks`、`links`、`arcflow-code-gen` 这些名称，避免前后任务命名漂移。
