# CI Bug Backflow Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #123 by making CI failures dispatch `arcflow-bug-analysis`, persist structured analysis results in ArcFlow, and display the analysis branch (`可进入自动修复` vs `需人工接管`) in Workflow Detail.

**Architecture:** Reuse the existing workflow tables. CI webhook handlers will create a linked `bug_analysis` execution and immediately create a dispatch tied to that execution. The callback handler will parse the bug-analysis JSON payload into an `analysis_ready` or `analysis_failed` workflow subtask, and execution detail aggregation will expose a typed `bug_report_summary` field that the web detail page renders.

**Tech Stack:** Bun, Hono, SQLite, Vue 3, Vitest/Bun test, existing workflow/dispatch schema.

---

## Task 1: Plan the backend contract in types and detail aggregation

**Files:**

- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/db/queries.ts`
- Test: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: Write the failing API detail test**

```ts
it("GET /api/workflow/executions/:id returns bug_report_summary for bug_analysis", async () => {
  const { createWorkflowExecution, createWorkflowSubtask } = await import("../db/queries");
  const id = createWorkflowExecution({
    workflow_type: "bug_analysis",
    trigger_source: "cicd_webhook",
    plane_issue_id: "ISS-BUG-1",
  });
  createWorkflowSubtask({
    execution_id: id,
    stage: "analysis_ready",
    target: "backend",
    provider: "nanoclaw",
    status: "success",
    output_ref: JSON.stringify({
      summary: "Type mismatch in webhook parser",
      root_cause: "branch_name is assumed to exist",
      suggested_fix: "Guard branch fallback lookup",
      confidence: "high",
      next_action: "auto_fix_candidate",
    }),
  });

  const res = await app.request(`/api/workflow/executions/${id}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.bug_report_summary).toEqual({
    summary: "Type mismatch in webhook parser",
    root_cause: "branch_name is assumed to exist",
    suggested_fix: "Guard branch fallback lookup",
    confidence: "high",
    next_action: "auto_fix_candidate",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test src/routes/api.test.ts -t "returns bug_report_summary for bug_analysis"`
Expected: FAIL because `bug_report_summary` is missing from execution detail.

- [ ] **Step 3: Write minimal implementation**

```ts
export type BugAnalysisNextAction = "auto_fix_candidate" | "manual_handoff";
export type BugAnalysisConfidence = "high" | "medium" | "low";

export interface WorkflowBugReportSummary {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: BugAnalysisConfidence;
  next_action: BugAnalysisNextAction;
}
```

```ts
function parseBugReportSummary(subtasks: WorkflowSubtask[]): WorkflowBugReportSummary | null {
  const latest = [...subtasks]
    .reverse()
    .find((item) => item.stage === "analysis_ready" && item.status === "success" && item.output_ref);
  if (!latest?.output_ref) return null;
  try {
    const parsed = JSON.parse(latest.output_ref) as WorkflowBugReportSummary;
    if (
      typeof parsed.summary !== "string" ||
      typeof parsed.root_cause !== "string" ||
      typeof parsed.suggested_fix !== "string"
    ) {
      return null;
    }
    if (!["high", "medium", "low"].includes(parsed.confidence)) return null;
    if (!["auto_fix_candidate", "manual_handoff"].includes(parsed.next_action)) return null;
    return parsed;
  } catch {
    return null;
  }
}
```

```ts
return {
  ...execution,
  summary,
  bug_report_summary: execution.workflow_type === "bug_analysis" ? parseBugReportSummary(subtasks) : null,
  current_stage_summary: buildCurrentStageSummary(subtasks, dispatches),
  dispatches,
  subtasks,
  links,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/gateway && bun test src/routes/api.test.ts -t "returns bug_report_summary for bug_analysis"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/types/index.ts packages/gateway/src/db/queries.ts packages/gateway/src/routes/api.test.ts
git commit -m "feat: expose bug analysis summary in execution detail"
```

## Task 2: Dispatch bug analysis from CI failure webhooks

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Test: `packages/gateway/src/routes/webhook.test.ts`

- [ ] **Step 1: Write the failing webhook test**

```ts
it("POST /webhook/cicd dispatches arcflow-bug-analysis for spawned bug workflow", async () => {
  const executionId = seedCodegenExecution({ planeIssueId: "ISS-300", target: "backend" });

  const res = await app.request("/webhook/cicd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "failed",
      issue_id: "ISS-300",
      repository: "backend",
      branch: "feature/ISS-300-backend",
      run_id: "run-300",
      log_url: "https://ci.example/logs/run-300",
    }),
  });

  expect(res.status).toBe(200);
  const db = getDb();
  const dispatch = db
    .prepare("SELECT skill, source_execution_id, plane_issue_id, input_json FROM dispatch ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as { skill: string; source_execution_id: number; plane_issue_id: string; input_json: string };

  expect(dispatch.skill).toBe("arcflow-bug-analysis");
  expect(dispatch.plane_issue_id).toBe("ISS-300");
  expect(dispatch.source_execution_id).not.toBe(executionId);
  expect(JSON.parse(dispatch.input_json)).toEqual(
    expect.objectContaining({
      target: "backend",
      source_execution_id: executionId,
      branch_name: "feature/ISS-300-backend",
      external_run_id: "run-300",
      log_url: "https://ci.example/logs/run-300",
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts -t "dispatches arcflow-bug-analysis for spawned bug workflow"`
Expected: FAIL because no bug-analysis dispatch is created.

- [ ] **Step 3: Write minimal implementation**

```ts
const bugExecutionId = createWorkflowExecution({
  workflow_type: "bug_analysis",
  trigger_source: event.provider === "ibuild" ? "ibuild_webhook" : "cicd_webhook",
  plane_issue_id: effectivePlaneIssueId,
  input_path: event.logUrl ?? undefined,
});

createWorkflowSubtask({
  execution_id: bugExecutionId,
  stage: "analysis_dispatch",
  target: event.target,
  provider: "nanoclaw",
  status: "pending",
  external_run_id: event.externalRunId || undefined,
  branch_name: event.branchName ?? undefined,
  repo_name: event.target,
  log_url: event.logUrl ?? undefined,
});

dispatchToNanoclaw({
  skill: "arcflow-bug-analysis",
  workspaceId: String(execution.workspace_id ?? ""),
  planeIssueId: effectivePlaneIssueId,
  input: {
    execution_id: bugExecutionId,
    source_execution_id: execution.id,
    workspace_id: execution.workspace_id,
    target: event.target,
    provider: event.provider,
    external_run_id: event.externalRunId || undefined,
    branch_name: event.branchName ?? undefined,
    repo_name: event.target,
    log_url: event.logUrl ?? undefined,
    raw_payload: event.rawPayload,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts -t "dispatches arcflow-bug-analysis for spawned bug workflow"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/webhook.ts packages/gateway/src/routes/webhook.test.ts
git commit -m "feat: dispatch bug analysis on ci failure"
```

## Task 3: Persist successful bug-analysis callbacks into subtasks

**Files:**

- Modify: `packages/gateway/src/services/workflow-callback.ts`
- Test: `packages/gateway/src/services/workflow-callback.test.ts`

- [ ] **Step 1: Write the failing callback tests**

```ts
it("writes analysis_ready for successful arcflow-bug-analysis callbacks", async () => {
  const markSubtaskProgress = mock(async () => {});
  const handler = createCallbackHandler({
    writeTechDesign: async () => {},
    writeOpenApi: async () => {},
    commentPlaneIssue: async () => {},
    markSubtaskProgress,
    updateExecutionStatus: async () => {},
    loadDispatch: async () => ({
      id: "d-bug",
      workspaceId: "3",
      skill: "arcflow-bug-analysis",
      planeIssueId: "ISS-401",
      status: "pending",
      input: { execution_id: 41, target: "backend" },
      sourceExecutionId: 41,
    }),
    markDone: async () => true,
  });

  await handler.handle({
    dispatch_id: "d-bug",
    skill: "arcflow-bug-analysis",
    status: "success",
    result: {
      content: JSON.stringify({
        summary: "Type mismatch in payload parser",
        root_cause: "branch_name optionality was ignored",
        suggested_fix: "Guard fallback lookup",
        confidence: "medium",
        next_action: "manual_handoff",
      }),
    },
  });

  expect(markSubtaskProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      execution_id: 41,
      target: "backend",
      stage: "analysis_ready",
      status: "success",
      output_ref: expect.stringContaining("\"next_action\":\"manual_handoff\""),
    }),
  );
});
```

```ts
it("marks analysis_failed when bug-analysis payload is malformed", async () => {
  const markSubtaskProgress = mock(async () => {});
  const updateExecutionStatus = mock(async () => {});
  const markDone = mock(async () => true);
  const handler = createCallbackHandler({
    writeTechDesign: async () => {},
    writeOpenApi: async () => {},
    commentPlaneIssue: async () => {},
    markSubtaskProgress,
    updateExecutionStatus,
    loadDispatch: async () => ({
      id: "d-bug",
      workspaceId: "3",
      skill: "arcflow-bug-analysis",
      planeIssueId: "ISS-402",
      status: "pending",
      input: { execution_id: 42, target: "backend" },
      sourceExecutionId: 42,
    }),
    markDone,
  });

  await expect(
    handler.handle({
      dispatch_id: "d-bug",
      skill: "arcflow-bug-analysis",
      status: "success",
      result: { content: "{\"summary\":\"missing fields\"}" },
    }),
  ).rejects.toThrow();

  expect(markSubtaskProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      execution_id: 42,
      target: "backend",
      stage: "analysis_failed",
      status: "failed",
    }),
  );
  expect(updateExecutionStatus).toHaveBeenCalledWith(42, "failed", expect.any(String));
  expect(markDone).toHaveBeenCalledWith(
    "d-bug",
    expect.objectContaining({ status: "failed" }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway && bun test src/services/workflow-callback.test.ts -t "analysis_ready|analysis_failed"`
Expected: FAIL because bug-analysis callbacks are not parsed into workflow subtasks.

- [ ] **Step 3: Write minimal implementation**

```ts
function parseBugAnalysisResult(content: string) {
  const parsed = JSON.parse(content) as {
    summary?: unknown;
    root_cause?: unknown;
    suggested_fix?: unknown;
    confidence?: unknown;
    next_action?: unknown;
  };
  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.root_cause !== "string" ||
    typeof parsed.suggested_fix !== "string"
  ) {
    throw new Error("bug analysis result is incomplete");
  }
  if (!["high", "medium", "low"].includes(String(parsed.confidence))) {
    throw new Error("bug analysis confidence is invalid");
  }
  if (!["auto_fix_candidate", "manual_handoff"].includes(String(parsed.next_action))) {
    throw new Error("bug analysis next_action is invalid");
  }
  return {
    summary: parsed.summary.trim(),
    root_cause: parsed.root_cause.trim(),
    suggested_fix: parsed.suggested_fix.trim(),
    confidence: parsed.confidence,
    next_action: parsed.next_action,
  };
}
```

```ts
} else if (skill === "arcflow-bug-analysis") {
  const dispatchInput = parseCodegenDispatchInputLikeBugAnalysis(rec.input);
  const report = parseBugAnalysisResult(content);
  await markSubtaskProgress({
    execution_id: dispatchInput.execution_id,
    target: dispatchInput.target,
    stage: "analysis_ready",
    status: "success",
    provider: "nanoclaw",
    output_ref: JSON.stringify(report),
  });
  if (piid) await deps.commentPlaneIssue({ planeIssueId: piid, content });
  await deps.updateExecutionStatus?.(dispatchInput.execution_id, "success");
}
```

```ts
if (skill === "arcflow-bug-analysis") {
  const dispatchInput = parseBugAnalysisDispatchInput(rec.input);
  await markSubtaskProgress({
    execution_id: dispatchInput.execution_id,
    target: dispatchInput.target,
    stage: "analysis_failed",
    status: "failed",
    provider: "nanoclaw",
    error_message: message,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/gateway && bun test src/services/workflow-callback.test.ts -t "analysis_ready|analysis_failed"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/workflow-callback.ts packages/gateway/src/services/workflow-callback.test.ts
git commit -m "feat: persist bug analysis callback summaries"
```

## Task 4: Render bug report summary in Workflow Detail

**Files:**

- Modify: `packages/web/src/api/workflow.ts`
- Modify: `packages/web/src/pages/WorkflowDetail.vue`
- Test: `packages/web/src/pages/WorkflowDetail.test.ts`

- [ ] **Step 1: Write the failing page test**

```ts
it("renders bug report summary and next-action label for bug_analysis", async () => {
  vi.spyOn(api, "fetchExecution").mockResolvedValue({
    id: 21,
    workflow_type: "bug_analysis",
    trigger_source: "cicd_webhook",
    plane_issue_id: "ISS-500",
    input_path: "https://ci.example/logs/run-500",
    status: "success",
    error_message: null,
    started_at: "2026-04-17 12:00:00",
    completed_at: "2026-04-17 12:03:00",
    created_at: "2026-04-17 11:59:00",
    bug_report_summary: {
      summary: "Webhook parsing regressed on optional branch fields",
      root_cause: "The generic path assumed branch always exists",
      suggested_fix: "Guard branch fallback lookup and preserve run-id matching",
      confidence: "high",
      next_action: "auto_fix_candidate",
    },
    subtasks: [],
    links: [],
    dispatches: [],
  });

  // mount...
  expect(wrapper.text()).toContain("Bug 报告摘要");
  expect(wrapper.text()).toContain("Webhook parsing regressed on optional branch fields");
  expect(wrapper.text()).toContain("可进入自动修复");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && bun test src/pages/WorkflowDetail.test.ts -t "renders bug report summary and next-action label for bug_analysis"`
Expected: FAIL because the API type and page do not render `bug_report_summary`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface WorkflowBugReportSummary {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: "high" | "medium" | "low";
  next_action: "auto_fix_candidate" | "manual_handoff";
}
```

```ts
function bugNextActionLabel(value: WorkflowBugReportSummary["next_action"]) {
  return value === "auto_fix_candidate" ? "可进入自动修复" : "需人工接管";
}
```

```vue
<div
  v-if="execution.workflow_type === 'bug_analysis' && execution.bug_report_summary"
  class="rounded-lg p-5"
>
  <div class="text-xs uppercase mb-4">Bug 报告摘要</div>
  <div class="field-label">摘要</div>
  <div class="field-value">{{ execution.bug_report_summary.summary }}</div>
  <div class="field-label">根因</div>
  <div class="field-value">{{ execution.bug_report_summary.root_cause }}</div>
  <div class="field-label">建议修复</div>
  <div class="field-value">{{ execution.bug_report_summary.suggested_fix }}</div>
  <div class="field-label">置信度</div>
  <div class="field-value">{{ execution.bug_report_summary.confidence }}</div>
  <div class="field-label">下一步</div>
  <div class="field-value">{{ bugNextActionLabel(execution.bug_report_summary.next_action) }}</div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && bun test src/pages/WorkflowDetail.test.ts -t "renders bug report summary and next-action label for bug_analysis"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/workflow.ts packages/web/src/pages/WorkflowDetail.vue packages/web/src/pages/WorkflowDetail.test.ts
git commit -m "feat: render bug analysis summary in workflow detail"
```

## Task 5: Full verification sweep

**Files:**

- Modify: `docs/superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md`

- [ ] **Step 1: Run backend verification**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts src/routes/api.test.ts src/services/workflow-callback.test.ts`
Expected: PASS with the new bug-analysis dispatch, callback persistence, and API detail coverage.

- [ ] **Step 2: Run web verification**

Run: `cd packages/web && bun test src/pages/WorkflowDetail.test.ts`
Expected: PASS with the new summary card coverage.

- [ ] **Step 3: Write verification report**

```md
# CI Bug Backflow Closure Verification

- Verified bug-analysis dispatch creation from CI failure webhooks.
- Verified structured callback persistence to `analysis_ready` / `analysis_failed`.
- Verified execution detail exposes `bug_report_summary`.
- Verified Workflow Detail renders `可进入自动修复` and `需人工接管`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md
git commit -m "docs: add ci bug backflow closure verification report"
```
