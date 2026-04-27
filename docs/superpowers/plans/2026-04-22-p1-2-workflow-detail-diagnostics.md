# P1-2.1 Workflow Detail 异常诊断增强实施计划

## 目标

把现有 dispatch、callback、workflow_subtask 的底层观测数据聚合成 Workflow Detail 可直接阅读的异常诊断摘要。

## 范围

- Gateway 类型与详情查询增加 `workflow_diagnostics`。
- Web API 类型与 Workflow Detail 页面增加“异常诊断”展示。
- 补充 Gateway route 测试和 Web 页面测试。
- 更新 `docs/当前缺口清单_按优先级.md`。

## 实施步骤

- [x] 梳理现有 dispatch/callback 观测字段和 Workflow Detail 展示结构。
- [x] 定义 `WorkflowDiagnostic` 类型与聚合规则。
- [x] 在 `getWorkflowExecutionDetail` 中聚合 timeout、late callback、replay、side-effect failed、failed subtask。
- [x] 在 Web 详情页展示异常诊断。
- [x] 补充 API 与页面测试。
- [x] 运行 Gateway/Web 聚焦测试和 lint/build 验证。

## 验收命令

```bash
bun test packages/gateway/src/routes/api.test.ts
bun run --cwd packages/web test -- WorkflowDetail.test.ts
bun run --cwd packages/gateway lint
bun run --cwd packages/web lint
bun run --cwd packages/web build
```
