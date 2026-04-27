# P1-2.2 Webhook Job 观测页设计

## 背景

P1-1 已经完成 `webhook_job` 表、retry worker、dead job 告警和 `GET /api/webhook/jobs` 只读接口。Web 工作流列表也有一个小型排障面板，但它只覆盖 `code_merge pending / dead` 的摘要视图，不适合作为长期运维入口。

P1-2.2 的目标是补独立 webhook job 观测页，让运维和研发可以按 source/action/status 筛选，并查看单个 job 的 payload、result、重试时间和 dead 原因。

## 目标

- 新增单 job 详情 API：`GET /api/webhook/jobs/:id`。
- 新增 Web 页面 `/webhook-jobs`。
- 支持按 `source`、`status`、`action` 筛选。
- 支持点击 job 查看详情。
- 详情展示 payload、result、attempt、next retry、last error / dead reason。
- 工作流列表的小面板保留，并提供进入独立页面的入口。

## 非目标

- 不新增 retry / replay 操作按钮。
- 不新增 job mutation API。
- 不把 webhook job 与 workflow execution 做自动全链路关联。
- 不新增图表或长期指标统计。

## API 设计

### `GET /api/webhook/jobs`

保留现有列表接口：

- `source`
- `action`
- `status`
- `limit`

列表响应继续解析 `payload_json` 和 `result_json` 为：

- `payload`
- `result`

### `GET /api/webhook/jobs/:id`

新增详情接口。响应字段与列表 item 对齐，并包含：

- `payload`
- `result`
- `next_run_at`
- `last_error`

错误语义：

- `400`：id 非法
- `404`：job 不存在

## UI 设计

新增 `/webhook-jobs` 页面：

- 顶部筛选：source、status、action
- 左侧列表：job id、source、action、status、attempt、next retry、updated、last error
- 右侧详情：状态、尝试次数、下次重试、更新时间、dead 原因、payload、result

`last_error` 在 `status = dead` 时展示为“Dead 原因”，其他状态展示为“最近错误”。

## 验收标准

- API 详情接口能返回 payload/result/dead reason。
- Web 页面能筛选并展示列表。
- 点击 job 后能展示详情。
- WorkflowList 的 webhook job 小面板提供“查看全部”入口。
