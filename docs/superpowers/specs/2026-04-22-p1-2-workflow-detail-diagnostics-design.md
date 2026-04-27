# P1-2.1 Workflow Detail 异常诊断增强设计

## 背景

Phase 4 的稳定性与可观测性收口已经有 dispatch、callback、workflow_subtask、webhook job 等底层数据，但 Workflow Detail 仍偏向“账本展示”。排障时仍需要研发人员从多张明细卡片里人工判断当前卡点。

P1-2.1 的目标是先补一个窄切片：在不引入新监控系统和新事件表的前提下，让 Workflow Detail 直接给出异常诊断摘要。

## 目标

- 在 workflow detail API 中新增 `workflow_diagnostics` 聚合字段。
- 统一展示 dispatch timeout、late callback、callback replay、callback side effect failed、failed subtask。
- 前端在 Workflow Detail 顶部新增“异常诊断”区域，优先展示可操作异常，再保留原始 dispatch/subtask 明细。
- 让用户不翻 DB 或日志也能判断流程主要卡点。

## 非目标

- 不新增独立日志检索系统。
- 不实现 webhook job 独立详情页。
- 不实现跨服务 correlation id 全链路追踪。
- 不新增告警规则或 Feishu 通知规则。

## API 设计

`GET /api/workflow/executions/:id` 在原有详情响应中增加：

```ts
interface WorkflowDiagnostic {
  kind:
    | "waiting_callback"
    | "dispatch_timeout"
    | "late_callback"
    | "callback_replay"
    | "side_effect_failed"
    | "dispatch_failed"
    | "subtask_failed"
    | "execution_failed";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  target: string | null;
  stage: string | null;
  dispatch_id: string | null;
  subtask_id: number | null;
  timestamp: number | string | null;
}
```

## 诊断规则

- `dispatch.status = timeout` 或 pending/running 且 `timeout_at < now`：生成 `dispatch_timeout`。
- `dispatch.diagnostic_flags` 包含 `late_callback_ignored`：生成 `late_callback`。
- `callback_replay_count > 0` 或包含 `duplicate_callback_ignored`：生成 `callback_replay`。
- `dispatch.status = failed` 且包含 side-effect 语义：生成 `side_effect_failed`。
- `workflow_subtask.status = failed`：生成 `subtask_failed`。
- `workflow_execution.status = failed` 且没有同消息诊断：补充 `execution_failed`。
- 没有异常但当前阶段是 dispatch 等待：生成 info 级 `waiting_callback`。

## UI 设计

Workflow Detail 展示顺序调整为：

1. 基本信息
2. 时间线
3. 当前阶段摘要
4. 异常诊断
5. 原始错误信息
6. Dispatch / Callback 诊断
7. 目标轨迹与产物
8. 关联工作流

异常诊断只做聚合判断，不替代下方原始账本。每条诊断展示：

- 标题和严重级别
- kind
- message
- target / stage
- dispatch id 或 subtask id
- timestamp

## 验收标准

- API 返回的 `workflow_diagnostics` 能覆盖 timeout、replay、side-effect failed、failed subtask。
- Web 能渲染异常诊断卡片。
- 原有 dispatch/subtask 明细保持不变。
- Gateway route 测试和 Web 页面测试通过。
