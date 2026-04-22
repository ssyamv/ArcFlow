# Git Webhook Merge State Design

> 日期：2026-04-22
> 范围：ArcFlow Gateway `/webhook/git` 的 MR / PR merged 状态推进

## 1. 背景

`/webhook/git` 已完成 docs push -> RAG sync，但 `P1-1` 仍缺 MR / PR
merged 事件处理。当前 `code_gen` 主链路已经通过 `workflow_subtask` 记录
生成、CI 和 bug_analysis 关联状态，因此 Git merge 事件也应落到同一个执行记录下，
而不是只写 webhook log。

## 2. 目标

- 识别 GitHub pull request merged 事件。
- 识别 GitLab merge request merged 事件。
- 根据 source branch 提取 Plane Issue ID，并按 repository 末段映射 target。
- 将匹配到的 `code_gen` 执行推进为 `mr_merged` 子任务。
- merge 事件没有匹配到 `code_gen` 时返回 200 + `unmatched`，避免 Git 平台重试风暴。
- `mr_merged` 作为 `code_gen` 的成功终态，不能把已成功的主执行拉回 running。
- merge 事件处理进入 `webhook_job` 记录，形成后续 worker / alerting 的稳定底座。

## 3. 非目标

- 不实现后台 worker。
- 不实现告警通知。
- 不自动创建缺失的 `code_gen` 执行。
- 不修改 Web 展示结构，现有 Workflow Detail 子任务列表直接显示 `mr_merged`。

## 4. 标准事件

`GitWebhookEvent` 在 push 字段之外增加可选 `merge` 字段：

```ts
merge?: {
  merged: boolean;
  id: string | null;
  title: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  mergeCommitSha: string | null;
  url: string | null;
}
```

支持来源：

- GitHub：`X-GitHub-Event=pull_request` + `action=closed` +
  `pull_request.merged=true`
- GitLab：`object_kind=merge_request` + `object_attributes.state=merged`

## 5. 状态写入

匹配规则：

1. `target = repository.split("/").at(-1)`
2. `planeIssueId = extractIssueIdFromBranch(sourceBranch)`
3. `findLatestCodegenExecution(planeIssueId, target, { branchName: sourceBranch })`

匹配成功后写入：

- `stage = mr_merged`
- `provider = git`
- `status = success`
- `external_run_id = PR/MR 编号`
- `branch_name = sourceBranch`
- `repo_name = target`
- `log_url = PR/MR URL`
- `output_ref = merge commit / title / target branch / url JSON`

`syncCodegenExecutionStatus` 将 `mr_merged` 视为和 `ci_success` 等价的成功终态。

## 6. Job 与重试底座

新增 `webhook_job` 表记录 webhook 后处理任务：

- `source`
- `event_type`
- `action`
- `status`
- `attempt_count`
- `max_attempts`
- `next_run_at`
- `last_error`
- `payload_json`
- `result_json`

merge 事件进入 `/webhook/git` 后先创建 `action=code_merge` 的 job：

- 匹配成功：job 标记为 `success`
- 未匹配到 `code_gen`：job 标记回 `pending`，写入 `last_error`，等待后续 worker 重试
- 超过 `max_attempts`：job 标记为 `dead`

后台调度器会按 `WEBHOOK_JOB_INTERVAL_MS` 扫描 due jobs，并用
`WEBHOOK_JOB_RETRY_DELAY_MS` 控制失败后再次尝试的延迟。

同时新增 `GET /api/webhook/jobs` 作为只读排障入口，支持按 `source`、`action`、
`status` 和 `limit` 查询 job 状态，并返回解析后的 `payload` / `result`。
Web 工作流列表展示 `code_merge` pending / dead job 摘要，用于日常排障。
当 job 进入 `dead` 状态且配置了默认飞书群时，scheduler 会发送告警卡片。

## 7. 响应语义

匹配成功：

```json
{
  "received": true,
  "source": "git",
  "action": "code_merge",
  "job_id": 1,
  "status": "recorded"
}
```

未匹配：

```json
{
  "received": true,
  "source": "git",
  "action": "code_merge",
  "job_id": 1,
  "status": "unmatched",
  "reason": "code_gen_execution_not_found"
}
```

## 8. 后续

本切片已关闭 `P1-1` 的 Git webhook 真实业务处理。后续更完整的监控面板、
告警聚合、SLO 和跨服务追踪归入 `P1-2` 可观测性继续推进。
