# P1-2.2 Webhook Job 观测页实施计划

## 目标

把 P1-1 已有 webhook job 账本从工作流列表的小面板扩展成独立可筛选、可看详情的运维入口。

## 范围

- Gateway 新增 `GET /api/webhook/jobs/:id`。
- Web 新增 `/webhook-jobs` 页面。
- WorkflowList 小面板增加“查看全部”入口。
- 补充 API 与 Web 页面测试。
- 更新 `docs/当前缺口清单_按优先级.md`。

## 实施步骤

- [x] 复核现有 webhook job 表、列表 API 和 WorkflowList 小面板。
- [x] 新增单 job 详情 API。
- [x] 新增 WebhookJobs 页面与路由。
- [x] 支持 source/status/action 筛选和 job 详情展示。
- [x] 补充 API 与页面测试。
- [x] 运行聚焦测试、lint、build 和仓库回归。

## 验收命令

```bash
bun test packages/gateway/src/routes/api.test.ts
bun run --cwd packages/web test -- WebhookJobs.test.ts WorkflowList.test.ts
bun run --cwd packages/gateway lint
bun run --cwd packages/web lint
bun run --cwd packages/web build
```
