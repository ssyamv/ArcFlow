# P1-2.3 Correlation ID 链路追踪设计

## 背景

P1-2.1 已经让 Workflow Detail 能直接展示异常诊断，P1-2.2 已经补了 webhook job 独立观测页。剩余问题是跨服务链路仍然需要人工按 issue、branch、dispatch id 反查，Plane webhook、dispatch、callback、workflow_subtask、webhook job 之间缺少统一串联键。

P1-2.3 的目标是在现有表结构上增量加入 `correlation_id`，让 API 和 Web 都能直接显示同一条业务链路。

## 目标

- 为 `workflow_execution`、`workflow_subtask`、`dispatch`、`webhook_job` 增加 `correlation_id`。
- Plane webhook 触发的旧 workflow execution 与 NanoClaw dispatch 使用同一个 correlation id。
- code_gen dispatch、callback 写回的 subtask 继承 workflow correlation id。
- CI/iBuild failure 生成的 bug_analysis workflow、dispatch、subtask 继承或生成可追踪 correlation id。
- Git merge webhook job 和 `mr_merged` subtask 使用同一个 correlation id。
- Web Workflow Detail 和 Webhook Jobs 页面展示 correlation id。

## 非目标

- 不新增专用 tracing/event 表。
- 不引入 OpenTelemetry 或外部 tracing 系统。
- 不改变现有 workflow 状态机和 callback 幂等语义。
- 不新增手动重放或修复按钮。

## 数据模型

新增字段：

- `workflow_execution.correlation_id`
- `workflow_subtask.correlation_id`
- `dispatch.correlation_id`
- `webhook_job.correlation_id`

新增索引：

- `idx_workflow_execution_correlation`
- `idx_workflow_subtask_correlation`
- `idx_dispatch_correlation`
- `idx_webhook_job_correlation`

兼容迁移：

- 旧 `workflow_execution` 回填为 `wf-{id}`。
- 旧 `workflow_subtask` 从所属 execution 继承。
- 旧 `dispatch` 从 `source_execution_id` 指向的 execution 继承。
- 无法推导的旧 `dispatch` / `webhook_job` 保持 null。

## 生成与传播规则

### Plane webhook

Plane approved webhook 生成：

```text
plane:{issue_id}
```

该 id 同时写入：

- `triggerWorkflow(... correlation_id)`
- `dispatch.correlation_id`
- dispatch input 中的 `correlation_id`

### Workflow trigger

`triggerWorkflow` 规则：

- 显式传入 `correlation_id` 时直接使用。
- 有 `source_execution_id` 且未显式传入时，继承 source execution 的 `correlation_id`。
- 否则生成 `wf-{uuid}`。

### Dispatch / callback / subtask

- `dispatchToNanoclaw` 写入 `dispatch.correlation_id`，并把 correlation id 放入 dispatch input。
- callback 写入或更新 `workflow_subtask` 时传递 dispatch record 的 `correlationId`。
- `tech_to_openapi` callback 触发下游 `code_gen` 时继续传递 correlation id。

### CI / iBuild / Git

- generic CI 默认生成 `cicd:{run_id|build_id|branch}`。
- iBuild 默认生成 `ibuild:{buildId}:{gitBranch}`。
- Git merge job 默认生成 `git:{event_type}:{merge_id|source_branch}:{repository}`。

## API / Web

API 响应新增或透出 `correlation_id`：

- workflow execution detail/list
- dispatches
- subtasks
- webhook jobs list/detail

Web 展示：

- Workflow Detail 基本信息展示 execution correlation id。
- Dispatch / Callback 诊断展示 dispatch correlation id。
- 目标轨迹展示 subtask correlation id。
- Webhook Jobs 列表与详情展示 webhook job correlation id，并支持按 correlation id 筛选。

## 验收标准

- Plane approved webhook 产生的 workflow trigger 与 dispatch 使用同一 correlation id。
- code_gen workflow 创建 subtask 和 dispatch 时传递 correlation id。
- callback 写 subtask 时传递 correlation id。
- Webhook job 支持按 correlation id 查询。
- Web 页面能展示 correlation id。
