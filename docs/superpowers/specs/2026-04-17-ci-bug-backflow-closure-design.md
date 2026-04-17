# CI Bug Backflow Closure Design

## Background

ArcFlow already accepts CI failure callbacks and can create a `bug_analysis` workflow execution linked from the parent `code_gen` execution. That solves the first half of the chain, but the failure loop is still incomplete:

- `bug_analysis` executions are created without dispatching `arcflow-bug-analysis`, so the analysis skill never actually runs.
- Callback handling for `arcflow-bug-analysis` only comments on Plane and does not persist a structured report inside ArcFlow.
- Workflow Detail shows execution links and dispatch diagnostics, but it cannot answer the product question "can this failure enter auto-fix, or does it require human handoff?"

Issue #123 requires ArcFlow to close this gap without expanding into a full auto-fix executor in the same change.

## Goal

Make a CI failure produce a fully traceable ArcFlow record that:

1. dispatches `arcflow-bug-analysis`,
2. persists a structured bug report summary inside ArcFlow,
3. explicitly marks whether the next step is `auto_fix_candidate` or `manual_handoff`,
4. surfaces that result in Workflow Detail.

## Non-Goals

- Do not implement a real `arcflow-auto-fix` skill dispatch in this issue.
- Do not create or update separate bug issues in Plane.
- Do not introduce new approval flows or Feishu card actions.
- Do not redesign the Workflow Detail page beyond the bug-analysis summary block needed for this flow.

## Existing Context

### Current CI Failure Path

`packages/gateway/src/routes/webhook.ts` already:

- matches a CI event to the latest relevant `code_gen` execution,
- writes `ci_failed` / `ci_running` / `ci_success` subtask state,
- creates a linked `bug_analysis` execution on failure via `spawned_on_ci_failure`.

### Current Callback Behavior

`packages/gateway/src/services/workflow-callback.ts` already:

- routes skill callbacks by persisted dispatch skill,
- marks codegen subtasks and execution state,
- comments on Plane for `arcflow-bug-analysis`.

The missing behavior is persistence of the bug-analysis result into ArcFlow's own data model.

## Product Decision

This issue will implement the "analysis and explicit next-step contract" layer, not the full repair layer.

The output of bug analysis must end in one of two states:

- `auto_fix_candidate`: the report contains enough confidence and actionable guidance for a later auto-fix workflow to consume.
- `manual_handoff`: the report indicates low confidence, missing context, or high-risk remediation and should stop for human takeover.

These two states are the only supported post-analysis branches in this issue.

## Proposed Approach

### 1. Dispatch `arcflow-bug-analysis` when a bug workflow is spawned

When `/webhook/cicd` or `/webhook/ibuild` creates a `bug_analysis` execution, Gateway must immediately insert a dispatch tied to that execution, using skill `arcflow-bug-analysis`.

The dispatch input must include enough context for later tracing and UI display:

- `execution_id`
- `source_execution_id`
- `workspace_id`
- `plane_issue_id`
- `target`
- `provider`
- `external_run_id`
- `branch_name`
- `repo_name` when known
- `log_url`
- `raw_payload`

This keeps the execution trace self-contained and allows callback code to update the correct workflow rows without having to rediscover the context.

### 2. Persist a structured bug report summary in ArcFlow

ArcFlow needs a first-class structured representation of bug-analysis output. This design uses workflow subtasks plus execution detail aggregation instead of creating a separate new top-level table.

Reasoning:

- The current workflow detail page already consumes `workflow_subtask`, `dispatch`, and `workflow_link`.
- The new report belongs to a specific `bug_analysis` execution rather than being a global reusable entity.
- Keeping the persistence in existing workflow tables avoids additional CRUD APIs and migration complexity.

The bug-analysis callback content will be treated as JSON with the following expected shape:

```json
{
  "summary": "CI failed because TypeScript type narrowing regressed in webhook payload parsing.",
  "root_cause": "The generic CI path assumes string payloads but iBuild can omit gitBranch.",
  "suggested_fix": "Guard optional branch fields and preserve fallback execution lookup by external run id.",
  "confidence": "high",
  "next_action": "auto_fix_candidate"
}
```

`next_action` is required and must be one of:

- `auto_fix_candidate`
- `manual_handoff`

`confidence` is required and must be one of:

- `high`
- `medium`
- `low`

If callback JSON is malformed or missing these required fields, the callback is treated as a side-effect failure and the dispatch is finalized as failed.

### 3. Write bug-analysis progress into workflow subtasks

The callback handler must write workflow subtasks for the bug-analysis execution:

- `analysis_ready` with `status=success` when the report is parsed and stored successfully
- `analysis_failed` with `status=failed` when parsing or persistence fails after callback delivery

The `output_ref` of `analysis_ready` will store a compact machine-readable JSON string containing:

- `summary`
- `root_cause`
- `suggested_fix`
- `confidence`
- `next_action`

This gives ArcFlow a durable result payload without introducing a new table.

### 4. Aggregate bug report summary into execution detail API

`getWorkflowExecutionDetail()` must detect `workflow_type === "bug_analysis"` and build a `bug_report_summary` field from the latest `analysis_ready` subtask payload.

The API response shape should include:

```ts
interface WorkflowBugReportSummary {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: "high" | "medium" | "low";
  next_action: "auto_fix_candidate" | "manual_handoff";
}
```

If no valid `analysis_ready` payload exists, `bug_report_summary` is `null`.

### 5. Show the result in Workflow Detail

`packages/web/src/pages/WorkflowDetail.vue` must render a dedicated "Bug 报告摘要" card when:

- `execution.workflow_type === "bug_analysis"`,
- and `execution.bug_report_summary` is present.

The card must show:

- summary
- root cause
- suggested fix
- confidence
- next action

The next-action field must be rendered as product language, not raw enum values:

- `auto_fix_candidate` => `可进入自动修复`
- `manual_handoff` => `需人工接管`

This UI block is the contract boundary for the issue. It tells operators whether the failure has reached a stable "machine-actionable" state or must stop for manual intervention.

## Data Model Changes

### Backend Types

Add new types in `packages/gateway/src/types/index.ts`:

- `BugAnalysisNextAction`
- `BugAnalysisConfidence`
- `WorkflowBugReportSummary`

Extend `WorkflowExecutionDetail` with:

- `bug_report_summary: WorkflowBugReportSummary | null`

### Web API Types

Mirror the same shape in `packages/web/src/api/workflow.ts`.

No new HTTP endpoint is needed. This is an additive field on the existing execution-detail response.

## Parsing Rules

### Accepted Callback Result

The callback payload for `arcflow-bug-analysis` must still arrive through the existing callback route. The `result.content` string must parse as JSON and satisfy:

- `summary` is a non-empty string
- `root_cause` is a non-empty string
- `suggested_fix` is a non-empty string
- `confidence` is `high | medium | low`
- `next_action` is `auto_fix_candidate | manual_handoff`

### Rejected Callback Result

The handler must reject:

- non-JSON strings,
- JSON missing required fields,
- unsupported enum values,
- empty strings after trimming.

Rejected payloads must:

- finalize the dispatch as failed with `side effect failed: ...`,
- create `analysis_failed`,
- mark the bug-analysis execution as failed.

## Error Handling

### Dispatch Creation Failure

If ArcFlow creates the `bug_analysis` execution but dispatch creation fails synchronously:

- the bug-analysis execution should be marked `failed`,
- the parent `code_gen` execution remains failed as it already represents the CI failure,
- the execution link remains, so the operator can still inspect where the loop stopped.

### Callback Persistence Failure

If the bug-analysis callback arrives but result parsing/storage fails:

- the dispatch becomes failed,
- the bug-analysis execution becomes failed,
- an `analysis_failed` subtask records the failure reason,
- no `bug_report_summary` is exposed in execution detail.

## Testing Strategy

### Gateway

Add coverage for:

- CI failure spawning a bug-analysis dispatch with complete linkage metadata
- successful `arcflow-bug-analysis` callback writing `analysis_ready`
- malformed callback payload writing `analysis_failed` and failing execution
- execution detail API returning `bug_report_summary`

### Web

Add coverage for:

- rendering the bug report summary card for a bug-analysis execution
- mapping `auto_fix_candidate` and `manual_handoff` into user-facing copy
- not rendering the card when the summary is absent

## Files Expected To Change

Backend:

- `packages/gateway/src/routes/webhook.ts`
- `packages/gateway/src/services/workflow-callback.ts`
- `packages/gateway/src/db/queries.ts`
- `packages/gateway/src/routes/api.test.ts`
- `packages/gateway/src/routes/webhook.test.ts`
- `packages/gateway/src/services/workflow-callback.test.ts`
- `packages/gateway/src/types/index.ts`

Web:

- `packages/web/src/api/workflow.ts`
- `packages/web/src/pages/WorkflowDetail.vue`
- `packages/web/src/pages/WorkflowDetail.test.ts`

## Acceptance Criteria

- A CI failure still creates a linked `bug_analysis` execution, and now also creates a linked `arcflow-bug-analysis` dispatch.
- A successful bug-analysis callback persists a structured bug report inside ArcFlow.
- Workflow Detail for the bug-analysis execution shows the report and clearly labels either `可进入自动修复` or `需人工接管`.
- Malformed bug-analysis callback payloads fail visibly and remain traceable from execution detail.
