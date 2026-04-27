# P1-2.3 Correlation ID 链路追踪实施计划

## 目标

给 Plane webhook、dispatch、callback、workflow_subtask、webhook job 增加统一 correlation id，降低跨服务排障时的反查成本。

## 范围

- DB schema 与启动迁移补 `correlation_id`。
- Gateway workflow / webhook / dispatch / callback 路径传递 correlation id。
- API 返回 workflow、dispatch、subtask、webhook job 的 correlation id。
- Web Workflow Detail 与 Webhook Jobs 展示 correlation id。
- Webhook Jobs 支持按 correlation id 筛选。
- 更新缺口清单。

## 实施步骤

- [x] 复核 Plane webhook、workflow trigger、dispatch、callback、subtask、webhook job 创建路径。
- [x] 增加 `correlation_id` schema、索引和兼容迁移。
- [x] 让 `triggerWorkflow` 生成、继承或使用显式 correlation id。
- [x] 让 Plane / CI / iBuild / Git webhook 写入或传播 correlation id。
- [x] 让 dispatch 和 callback 写 subtask 时传递 correlation id。
- [x] Web Workflow Detail 和 Webhook Jobs 展示 correlation id。
- [x] Webhook Jobs 支持 correlation id 筛选。
- [x] 运行聚焦测试、lint、build 和仓库回归。

## 验收命令

```bash
bun test packages/gateway/src/db/queries.test.ts packages/gateway/src/db/index.test.ts packages/gateway/src/services/workflow.test.ts packages/gateway/src/routes/webhook.test.ts packages/gateway/src/routes/api.test.ts
bun run --cwd packages/web test -- WorkflowDetail.test.ts WebhookJobs.test.ts WorkflowList.test.ts
bun run --cwd packages/gateway lint
bun run --cwd packages/web lint
bun run --cwd packages/web build
```
