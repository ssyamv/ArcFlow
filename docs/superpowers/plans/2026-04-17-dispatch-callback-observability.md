# Dispatch / Callback 可观测性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 ArcFlow 所有 NanoClaw dispatch / callback 链路的状态机、诊断字段与工作流详情页展示，让用户能直接看出流程卡点、回调状态、错误摘要和产物信息。

**Architecture:** 保持 `workflow_execution` 作为高层聚合状态，细粒度异步状态全部下沉到 `dispatch` 与 `workflow_subtask`。后端先扩展 SQLite schema、查询与 callback 处理逻辑，再扩展 `/api/workflow/executions/:id` 聚合响应，最后在 Web 详情页按“当前卡点 / dispatch 诊断 / target 轨迹 / 关联链路”重组展示。

**Tech Stack:** Bun + Hono + bun:sqlite, TypeScript, Vue 3, Vitest, Bun test

---

## Task 1: 扩展 Dispatch Schema、类型与底层查询

**Files:**

- Modify: `packages/gateway/src/db/schema.sql`
- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/db/queries.ts`
- Test: `packages/gateway/src/db/queries.test.ts`

- [ ] **Step 1: 写 dispatch 字段与状态语义的失败测试**

```ts
it("insertDispatch persists execution linkage and diagnostic fields", () => {
  const db = getDb();
  const id = insertDispatch(db, {
    workspaceId: "w",
    skill: "arcflow-tech-to-openapi",
    input: { execution_id: 12 },
    planeIssueId: "ISS-121",
    sourceExecutionId: 12,
    sourceStage: "dispatch",
    timeoutAt: 9999,
  });

  const row = db
    .prepare(
      `SELECT status, source_execution_id, source_stage, started_at, last_callback_at,
              error_message, result_summary, callback_replay_count
         FROM dispatch WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>;

  expect(row.status).toBe("pending");
  expect(row.source_execution_id).toBe(12);
  expect(row.source_stage).toBe("dispatch");
  expect(row.started_at).toBeNull();
  expect(row.last_callback_at).toBeNull();
  expect(row.error_message).toBeNull();
  expect(row.result_summary).toBeNull();
  expect(row.callback_replay_count).toBe(0);
});

it("claimDispatchForCallback marks timed out processing dispatch as timeout before reclaim", () => {
  const db = getDb();
  const id = insertDispatch(db, {
    workspaceId: "w",
    skill: "arcflow-code-gen",
    input: {},
    timeoutAt: Date.now() + 1_000,
  });

  expect(claimDispatchForCallback(db, id, Date.now(), 5_000)).toBe(true);
  expect(claimDispatchForCallback(db, id, Date.now() + 10_000, 5_000)).toBe(true);

  const row = db
    .prepare("SELECT status, started_at, completed_at FROM dispatch WHERE id = ?")
    .get(id) as { status: string; started_at: number | null; completed_at: number | null };

  expect(row.status).toBe("running");
  expect(row.started_at).not.toBeNull();
  expect(row.completed_at).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认当前实现失败**

Run: `cd packages/gateway && bun test src/db/queries.test.ts`

Expected: FAIL，提示 `dispatch` 缺少新字段、`InsertDispatchInput` 不支持 `sourceExecutionId/sourceStage`，以及 `claimDispatchForCallback` 仍在使用旧的 `processing` 状态。

- [ ] **Step 3: 最小实现 schema、类型和查询扩展**

```ts
export type WorkflowDispatchStatus = "pending" | "running" | "success" | "failed" | "timeout";

export interface WorkflowDispatch {
  id: string;
  workspace_id: string;
  skill: string;
  status: WorkflowDispatchStatus;
  plane_issue_id: string | null;
  source_execution_id: number | null;
  source_stage: string | null;
  created_at: number;
  started_at: number | null;
  last_callback_at: number | null;
  completed_at: number | null;
  timeout_at: number | null;
  error_message: string | null;
  result_summary: string | null;
  callback_replay_count: number;
}

export interface InsertDispatchInput {
  workspaceId: string;
  skill: string;
  input: unknown;
  planeIssueId?: string;
  sourceExecutionId?: number;
  sourceStage?: string;
  timeoutAt?: number;
}

export function insertDispatch(db: Database, x: InsertDispatchInput): string {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO dispatch(
       id, workspace_id, skill, input_json, status, created_at, plane_issue_id,
       source_execution_id, source_stage, timeout_at, callback_replay_count
     ) VALUES(?,?,?,?,?,?,?,?,?,?,0)`,
    [
      id,
      x.workspaceId,
      x.skill,
      JSON.stringify(x.input),
      "pending",
      Date.now(),
      x.planeIssueId ?? null,
      x.sourceExecutionId ?? null,
      x.sourceStage ?? null,
      x.timeoutAt ?? null,
    ],
  );
  return id;
}

export function claimDispatchForCallback(
  db: Database,
  id: string,
  now = Date.now(),
  processingLeaseMs = 60_000,
): boolean {
  db.run(
    `UPDATE dispatch
        SET status = 'timeout', completed_at = ?, error_message = COALESCE(error_message, 'callback timeout')
      WHERE id = ?
        AND status = 'running'
        AND timeout_at IS NOT NULL
        AND timeout_at < ?`,
    [now, id, now],
  );

  const res = db.run(
    `UPDATE dispatch
        SET status = 'running', started_at = COALESCE(started_at, ?), timeout_at = ?, completed_at = NULL
      WHERE id = ? AND status IN ('pending', 'timeout')`,
    [now, now + processingLeaseMs, id],
  );
  return res.changes === 1;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/db/queries.test.ts`

Expected: PASS，`dispatch` 相关用例通过且没有旧状态 `processing` 残留。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/db/schema.sql packages/gateway/src/types/index.ts packages/gateway/src/db/queries.ts packages/gateway/src/db/queries.test.ts
git commit -m "feat: extend dispatch observability schema"
```

## Task 2: 让 Workflow 触发与 Dispatch 写入对齐新账本

**Files:**

- Modify: `packages/gateway/src/services/nanoclaw-dispatch.ts`
- Modify: `packages/gateway/src/services/workflow.ts`
- Test: `packages/gateway/src/services/workflow.test.ts`

- [ ] **Step 1: 写 workflow -> dispatch 关联字段的失败测试**

```ts
it("passes execution linkage metadata into insertDispatch", async () => {
  await triggerWorkflow({
    workspace_id: 1,
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISS-121",
    input_path: "api/feature.yaml",
    target_repos: ["backend"],
  });

  expect(dispatchToNanoclaw).toHaveBeenCalledWith(
    expect.objectContaining({
      skill: "arcflow-code-gen",
      planeIssueId: "ISS-121",
      input: expect.objectContaining({
        execution_id: expect.any(Number),
        target: "backend",
      }),
      sourceExecutionId: expect.any(Number),
      sourceStage: "dispatch",
    }),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/workflow.test.ts`

Expected: FAIL，`dispatchToNanoclaw` 还不接受 `sourceExecutionId/sourceStage` 参数。

- [ ] **Step 3: 最小实现 dispatch 触发侧扩展**

```ts
interface DispatchToNanoclawParams {
  skill: string;
  workspaceId: string;
  planeIssueId?: string;
  input: unknown;
  sourceExecutionId?: number;
  sourceStage?: string;
  swallowDispatchError?: boolean;
}

const dispatchId = insertDispatch(db, {
  workspaceId: params.workspaceId,
  skill: params.skill,
  input: params.input,
  planeIssueId: params.planeIssueId,
  sourceExecutionId: params.sourceExecutionId,
  sourceStage: params.sourceStage,
  timeoutAt: Date.now() + 10 * 60 * 1000,
});

const dispatchResult = await dispatchToNanoclaw({
  workspaceId: String(ws.id),
  skill: "arcflow-code-gen",
  planeIssueId: params.plane_issue_id,
  sourceExecutionId: executionId,
  sourceStage: "dispatch",
  input: {
    execution_id: executionId,
    target,
    workspace_id: ws.id,
    plane_issue_id: params.plane_issue_id,
    input_path: params.input_path,
    figma_url: params.figma_url,
    task_context: taskContext,
  },
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/workflow.test.ts`

Expected: PASS，workflow 派发测试通过，dispatch metadata 已对齐 execution。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/services/nanoclaw-dispatch.ts packages/gateway/src/services/workflow.ts packages/gateway/src/services/workflow.test.ts
git commit -m "feat: link dispatch records to workflow executions"
```

## Task 3: 重写 Callback 状态机，补齐幂等、超时、重放与落地失败

**Files:**

- Modify: `packages/gateway/src/services/workflow-callback.ts`
- Modify: `packages/gateway/src/db/queries.ts`
- Test: `packages/gateway/src/services/workflow-callback.test.ts`

- [ ] **Step 1: 写 callback 终态与诊断行为的失败测试**

```ts
it("records duplicate callback without re-running side effects", async () => {
  const markDispatchCallback = mock(async () => ({ accepted: false, reason: "duplicate" as const }));
  const writeOpenApi = mock(async () => {});

  const handler = createCallbackHandler({
    writeTechDesign: async () => {},
    writeOpenApi,
    commentPlaneIssue: async () => {},
    loadDispatch: async () => makeCodegenDispatchRecord({ status: "success" }),
    claimDispatch: async () => false,
    markDispatchCallback,
    markDone: async () => false,
  });

  const handled = await handler.handle({
    dispatch_id: "d-codegen-1",
    status: "success",
    result: { content: "{\"execution_id\":7,\"target\":\"backend\"}" },
  });

  expect(handled).toBe(false);
  expect(writeOpenApi).not.toHaveBeenCalled();
});

it("marks timed out callback as late callback ignored", async () => {
  const markDispatchCallback = mock(async () => ({ accepted: false, reason: "late_callback" as const }));
  const markSubtaskProgress = mock(async () => {});

  const handler = createCallbackHandler({
    writeTechDesign: async () => {},
    writeOpenApi: async () => {},
    commentPlaneIssue: async () => {},
    loadDispatch: async () => makeCodegenDispatchRecord({ status: "timeout" }),
    claimDispatch: async () => false,
    markDispatchCallback,
    markSubtaskProgress,
    markDone: async () => false,
  });

  const handled = await handler.handle({
    dispatch_id: "d-codegen-1",
    status: "success",
    result: { content: "{\"execution_id\":7,\"target\":\"backend\"}" },
  });

  expect(handled).toBe(false);
  expect(markSubtaskProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      execution_id: 7,
      target: "backend",
      stage: "callback_timeout",
      status: "failed",
      error_message: expect.stringContaining("late callback"),
    }),
  );
});

it("marks dispatch failed when callback succeeded but side effect throws", async () => {
  const updateExecutionStatus = mock(async () => {});
  const finalizeDispatch = mock(async () => true);

  const handler = createCallbackHandler({
    writeTechDesign: async () => {
      throw new Error("persist failed");
    },
    writeOpenApi: async () => {},
    commentPlaneIssue: async () => {},
    loadDispatch: async () => ({
      id: "d-tech",
      workspaceId: "1",
      skill: "arcflow-prd-to-tech",
      status: "pending",
      planeIssueId: "ISS-121",
    }),
    claimDispatch: async () => true,
    finalizeDispatch,
    updateExecutionStatus,
    markDone: async () => false,
  });

  await expect(
    handler.handle({
      dispatch_id: "d-tech",
      status: "success",
      result: { content: "# title" },
    }),
  ).rejects.toThrow("persist failed");

  expect(finalizeDispatch).toHaveBeenCalledWith(
    "d-tech",
    expect.objectContaining({
      status: "failed",
      errorMessage: "persist failed",
      diagnosticFlags: expect.arrayContaining(["side_effect_failed"]),
    }),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/workflow-callback.test.ts`

Expected: FAIL，当前 handler 只有 `markDone` 粗粒度接口，无法表达 duplicate / timeout / side-effect-failed。

- [ ] **Step 3: 最小实现 callback 账本先行逻辑**

```ts
export interface DispatchCallbackDecision {
  accepted: boolean;
  reason?: "duplicate" | "late_callback";
}

export interface CallbackDeps {
  loadDispatch: (id: string) => Promise<DispatchRecord | null>;
  claimDispatch?: (id: string) => Promise<boolean>;
  finalizeDispatch?: (id: string, update: {
    status: "success" | "failed" | "timeout";
    lastCallbackAt?: number;
    completedAt?: number;
    errorMessage?: string;
    resultSummary?: string;
    diagnosticFlags?: string[];
    replayIncrement?: boolean;
  }) => Promise<boolean>;
}

if (!claimed) {
  if (rec.status === "timeout") {
    await markSubtaskProgress({
      execution_id: dispatchInput.execution_id,
      target: dispatchInput.target,
      stage: "callback_timeout",
      status: "failed",
      error_message: "late callback ignored",
    });
  }
  await deps.finalizeDispatch?.(p.dispatch_id, {
    status: rec.status === "timeout" ? "timeout" : "failed",
    lastCallbackAt: Date.now(),
    diagnosticFlags: [rec.status === "timeout" ? "late_callback_ignored" : "duplicate_callback_ignored"],
    replayIncrement: true,
  });
  return false;
}

await deps.finalizeDispatch?.(p.dispatch_id, {
  status: p.status === "success" ? "success" : "failed",
  lastCallbackAt: Date.now(),
  resultSummary: summarizeCallbackPayload(p),
});

try {
  // existing skill-specific side effects
} catch (error) {
  await deps.finalizeDispatch?.(p.dispatch_id, {
    status: "failed",
    lastCallbackAt: Date.now(),
    completedAt: Date.now(),
    errorMessage: error instanceof Error ? error.message : String(error),
    diagnosticFlags: ["side_effect_failed"],
  });
  throw error;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/workflow-callback.test.ts`

Expected: PASS，重复 callback、晚到 callback 和副作用失败行为都有明确测试覆盖。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/services/workflow-callback.ts packages/gateway/src/db/queries.ts packages/gateway/src/services/workflow-callback.test.ts
git commit -m "feat: harden callback dispatch state machine"
```

## Task 4: 扩展 Workflow Detail API 聚合 dispatch 诊断与卡点摘要

**Files:**

- Modify: `packages/gateway/src/db/queries.ts`
- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/routes/api.ts`
- Test: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: 写 detail API 聚合响应的失败测试**

```ts
it("returns dispatch diagnostics and current stage summary in execution detail", async () => {
  const res = await app.request("/api/workflow/executions/7");
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.current_stage_summary).toEqual({
    label: "backend 等待 callback",
    stage: "dispatch_running",
    target: "backend",
    status: "running",
  });
  expect(body.dispatches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: expect.any(String),
        status: "running",
        source_execution_id: 7,
        source_stage: "dispatch",
        diagnostic_flags: [],
      }),
    ]),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/routes/api.test.ts`

Expected: FAIL，`getWorkflowExecutionDetail` 仍只返回 `summary/subtasks/links`。

- [ ] **Step 3: 最小实现 detail 聚合扩展**

```ts
export interface WorkflowCurrentStageSummary {
  label: string;
  stage: string | null;
  target: string | null;
  status: string;
}

export interface WorkflowExecutionDetail extends WorkflowExecution {
  summary: WorkflowExecutionSummary | null;
  current_stage_summary: WorkflowCurrentStageSummary | null;
  dispatches: WorkflowDispatch[];
  subtasks: WorkflowSubtask[];
  links: WorkflowLink[];
}

function buildCurrentStageSummary(
  subtasks: WorkflowSubtask[],
  dispatches: WorkflowDispatch[],
): WorkflowCurrentStageSummary | null {
  const latestBlockingSubtask = [...subtasks]
    .reverse()
    .find((item) => item.status === "pending" || item.status === "running" || item.status === "failed");
  if (latestBlockingSubtask) {
    return {
      label: `${latestBlockingSubtask.target} ${latestBlockingSubtask.stage}`,
      stage: latestBlockingSubtask.stage,
      target: latestBlockingSubtask.target,
      status: latestBlockingSubtask.status,
    };
  }

  const latestDispatch = dispatches.at(-1);
  if (!latestDispatch) return null;
  return {
    label: `${latestDispatch.skill} ${latestDispatch.status}`,
    stage: latestDispatch.source_stage,
    target: null,
    status: latestDispatch.status,
  };
}

export function getWorkflowExecutionDetail(id: number): WorkflowExecutionDetail | null {
  const execution = getWorkflowExecution(id);
  if (!execution) return null;

  const subtasks = listWorkflowSubtasks(id);
  const dispatches = listDispatchesForExecution(id);
  const links = listWorkflowLinksForExecution(id);

  return {
    ...execution,
    summary: execution.workflow_type === "code_gen" ? buildExecutionSummary(subtasks) : null,
    current_stage_summary: buildCurrentStageSummary(subtasks, dispatches),
    dispatches,
    subtasks,
    links,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/api.test.ts`

Expected: PASS，detail API 返回 `dispatches` 和 `current_stage_summary`。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/db/queries.ts packages/gateway/src/types/index.ts packages/gateway/src/routes/api.ts packages/gateway/src/routes/api.test.ts
git commit -m "feat: expose workflow dispatch diagnostics"
```

## Task 5: 重构 Workflow Detail 页展示为排障视图

**Files:**

- Modify: `packages/web/src/api/workflow.ts`
- Modify: `packages/web/src/pages/WorkflowDetail.vue`
- Test: `packages/web/src/pages/WorkflowDetail.test.ts`

- [ ] **Step 1: 写详情页新展示区块的失败测试**

```ts
it("renders current stage summary and dispatch diagnostics", async () => {
  vi.spyOn(api, "fetchExecution").mockResolvedValue({
    id: 7,
    workflow_type: "code_gen",
    trigger_source: "manual",
    plane_issue_id: "ISS-121",
    input_path: "api/feature.yaml",
    status: "running",
    error_message: null,
    started_at: "2026-04-17 10:00:00",
    completed_at: null,
    created_at: "2026-04-17 10:00:00",
    current_stage_summary: {
      label: "backend 等待 callback",
      stage: "dispatch_running",
      target: "backend",
      status: "running",
    },
    dispatches: [
      {
        id: "d-1",
        skill: "arcflow-code-gen",
        status: "running",
        source_stage: "dispatch",
        started_at: 1713328800000,
        last_callback_at: null,
        completed_at: null,
        diagnostic_flags: [],
        result_summary: null,
        error_message: null,
      },
    ],
    subtasks: [
      {
        id: 1,
        target: "backend",
        stage: "dispatch_running",
        status: "running",
        provider: "nanoclaw",
        repo_name: "backend",
        branch_name: "feature/ISS-121-backend",
        log_url: "https://logs.example/backend",
        output_ref: "repos/backend/feature/ISS-121-backend",
        error_message: null,
      },
    ],
    links: [],
  });

  const wrapper = await mountPage();
  expect(wrapper.text()).toContain("当前卡点");
  expect(wrapper.text()).toContain("backend 等待 callback");
  expect(wrapper.text()).toContain("Dispatch / Callback");
  expect(wrapper.text()).toContain("d-1");
  expect(wrapper.text()).toContain("feature/ISS-121-backend");
  expect(wrapper.text()).toContain("repos/backend/feature/ISS-121-backend");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/web && npm test -- WorkflowDetail.test.ts`

Expected: FAIL，当前 API 类型没有 `dispatches/current_stage_summary`，页面也没有对应区块。

- [ ] **Step 3: 最小实现前端类型和页面重构**

```ts
export interface WorkflowDispatch {
  id: string;
  skill: string;
  status: string;
  source_stage: string | null;
  started_at: number | null;
  last_callback_at: number | null;
  completed_at: number | null;
  result_summary?: string | null;
  error_message?: string | null;
  diagnostic_flags?: string[];
}

export interface CurrentStageSummary {
  label: string;
  stage: string | null;
  target: string | null;
  status: string;
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
  output_ref?: string | null;
  error_message?: string | null;
}

export interface ExecutionDetail {
  // existing fields
  current_stage_summary?: CurrentStageSummary | null;
  dispatches?: WorkflowDispatch[];
}
```

```vue
<div v-if="execution.current_stage_summary" class="rounded-lg p-5">
  <div class="text-xs uppercase mb-3">当前卡点</div>
  <div class="text-sm">{{ execution.current_stage_summary.label }}</div>
</div>

<div v-if="execution.dispatches?.length" class="rounded-lg p-5">
  <div class="text-xs uppercase mb-4">Dispatch / Callback</div>
  <div v-for="dispatch in execution.dispatches" :key="dispatch.id" class="rounded-md p-3">
    <div class="text-sm">{{ dispatch.skill }} · {{ dispatch.id }}</div>
    <div class="text-xs">{{ dispatch.status }} · {{ dispatch.source_stage ?? "-" }}</div>
    <div v-if="dispatch.result_summary" class="text-xs">{{ dispatch.result_summary }}</div>
    <div v-if="dispatch.error_message" class="text-xs">{{ dispatch.error_message }}</div>
  </div>
</div>

<div v-if="execution.subtasks?.length" class="rounded-lg p-5">
  <div class="text-xs uppercase mb-4">Target 轨迹与产物</div>
  <div v-for="subtask in execution.subtasks" :key="subtask.id" class="rounded-md p-3">
    <div class="text-sm">{{ subtask.target }} · {{ subtask.stage }}</div>
    <div class="text-xs">{{ subtask.repo_name ?? "-" }} · {{ subtask.branch_name ?? "-" }}</div>
    <div v-if="subtask.output_ref" class="text-xs">{{ subtask.output_ref }}</div>
    <a v-if="subtask.log_url" :href="subtask.log_url" target="_blank" rel="noreferrer">查看日志</a>
  </div>
</div>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/web && npm test -- WorkflowDetail.test.ts`

Expected: PASS，详情页测试覆盖当前卡点与 dispatch 诊断区块。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/api/workflow.ts packages/web/src/pages/WorkflowDetail.vue packages/web/src/pages/WorkflowDetail.test.ts
git commit -m "feat: redesign workflow detail diagnostics view"
```

## Task 6: 全量回归验证与文档收口

**Files:**

- Modify: `docs/superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md`

- [ ] **Step 1: 运行后端定向测试**

Run: `cd packages/gateway && bun test src/db/queries.test.ts src/services/workflow.test.ts src/services/workflow-callback.test.ts src/routes/api.test.ts`

Expected: PASS，覆盖 schema、workflow dispatch、callback 状态机与 API 聚合。

- [ ] **Step 2: 运行前端定向测试**

Run: `cd packages/web && npm test -- WorkflowDetail.test.ts`

Expected: PASS，详情页新展示测试通过。

- [ ] **Step 3: 运行最小 lint / smoke 验证**

Run: `cd packages/gateway && bun run lint && cd ../web && npm run lint`

Expected: PASS，无新增 lint 错误。

- [ ] **Step 4: 写验证报告**

```md
# Dispatch / Callback 可观测性验证报告

- Gateway tests:
  - `bun test src/db/queries.test.ts src/services/workflow.test.ts src/services/workflow-callback.test.ts src/routes/api.test.ts`
- Web tests:
  - `npm test -- WorkflowDetail.test.ts`
- Lint:
  - `bun run lint`
  - `npm run lint`

## Result

- dispatch schema and callback state machine verified
- workflow detail API exposes dispatch diagnostics
- workflow detail page renders current stage and target artifacts
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md
git commit -m "docs: add dispatch callback observability verification report"
```
