# Git Webhook RAG Sync Design

> 日期：2026-04-21
> 范围：ArcFlow Gateway `/webhook/git` 第一版真实业务处理

## 1. 背景

`/webhook/git` 当前只返回 `{ received: true, source: "git" }`，没有承接真实业务动作。当前缺口清单已将它列为 `P1-1`，完成标准是明确 Git webhook 要处理的事件，并至少接入一条可验证的真实业务链路。

本轮先关闭最直接的业务链路：docs repo push 后触发 Gateway RAG 增量同步。MR / PR merged 通知、代码仓状态推进、自动修复入口不纳入本轮。

## 2. 目标

- `/webhook/git` 能识别 docs 仓库 push 事件。
- docs push 触发现有 RAG 索引同步能力。
- 非 docs push、非 push 事件、无法识别 payload 都返回 200 并说明 ignored 原因。
- webhook payload 仍写入 `webhook_log`，便于排障。
- RAG sync 失败不让 Git 平台重试风暴扩大；HTTP 仍返回 200，响应体标记 failed 并记录错误。

## 3. 非目标

- 不处理 MR / PR merged 事件。
- 不新增独立异步队列表。
- 不实现自动重试调度或告警面板。
- 不改变现有周期性 RAG scheduler。
- 不改变 RAG chunking、embedding、search 逻辑。

## 4. 事件识别

新增一个小型解析单元，输入 Git webhook payload 和 headers，输出标准化事件：

```ts
interface GitWebhookEvent {
  eventType: string;
  repository: string | null;
  ref: string | null;
  branch: string | null;
  after: string | null;
  changedPaths: string[];
}
```

事件类型优先从常见 header 读取：

- `X-Gitea-Event`
- `X-GitHub-Event`
- `X-Gitlab-Event`

如果 header 缺失，则从 payload 中兼容读取：

- `event`
- `object_kind`

push 判断规则：

- event type 等于 `push`
- 或 GitLab 风格 event type 等于 `Push Hook`
- 或 payload 存在 `ref` 且存在 `commits` 数组

repository 兼容读取：

- `repository.name`
- `repository.full_name`
- `project.name`
- `project.path_with_namespace`

branch 从 `refs/heads/<branch>` 解析，不能解析时为 `null`。

changedPaths 从 commit 的 `added`、`modified`、`removed` 合并去重。没有 commit 列表时为空数组。

## 5. docs push 判定

第一版采用保守判定，满足任一条件即认为是 docs push：

- repository 名称为 `docs`
- repository 名称以 `-docs` 结尾
- repository 名称包含 `/docs`
- payload 中的 changed path 命中 docs 内容路径：
  - `prd/**`
  - `tech-design/**`
  - `api/**`
  - `arch/**`
  - `ops/**`
  - `market/**`
  - `**/*.md`
  - `**/*.yaml`
  - `**/*.yml`

如果 payload 是 push 但无法确认 docs 相关，返回 ignored：

```json
{
  "received": true,
  "source": "git",
  "action": "ignored",
  "reason": "not_docs_push"
}
```

## 6. RAG Sync 调用

`createWebhookRoutes` 增加依赖注入参数，测试可传入 fake handler：

```ts
interface GitWebhookDeps {
  syncDocs?: (event: GitWebhookEvent) => Promise<void>;
}

createWebhookRoutes({ git: { syncDocs } })
```

生产入口在 `index.ts` 中，当 `ragDb` 和 `RAG_GIT_ROOT` 可用时，创建一个 `syncDocs`：

```ts
await ragIndex.syncAll({
  workspaceId: process.env.RAG_WORKSPACE_ID ?? "default",
  git: gitAdapter,
});
```

如果未配置 RAG sync 依赖，docs push 返回 failed，reason 为 `rag_sync_not_configured`。这样生产配置缺失能在 webhook 响应和日志里暴露，不会静默假成功。

## 7. 响应语义

所有可解析请求默认返回 200。

docs push 成功：

```json
{
  "received": true,
  "source": "git",
  "action": "rag_sync",
  "status": "triggered",
  "repository": "acme-docs",
  "ref": "refs/heads/main",
  "branch": "main"
}
```

ignored：

```json
{
  "received": true,
  "source": "git",
  "action": "ignored",
  "reason": "not_push_event"
}
```

RAG sync 失败：

```json
{
  "received": true,
  "source": "git",
  "action": "rag_sync",
  "status": "failed",
  "reason": "embedding service unavailable"
}
```

失败时还需要 `console.error("[webhook/git] rag sync failed", err)`，并把 payload 通过现有 `recordWebhookLog("git", body)` 落库。

## 8. 测试策略

新增或改造 `packages/gateway/src/routes/webhook.test.ts`：

- docs repo push 触发 `syncDocs` 一次，响应 `action=rag_sync`、`status=triggered`。
- 非 docs repo push 不触发，响应 `action=ignored`、`reason=not_docs_push`。
- 非 push 事件不触发，响应 `reason=not_push_event`。
- malformed / 空 payload 不触发，返回 ignored 而非 500。
- `syncDocs` 抛错时返回 200，响应 `status=failed`，并不吞掉 webhook log。

新增 `packages/gateway/src/services/git-webhook.ts` 和对应测试，覆盖解析细节：

- Gitea / GitHub / GitLab 事件 header。
- `refs/heads/main` branch 解析。
- commit changed paths 合并去重。
- docs repo 名称和 docs path 判定。

## 9. 运维与后续

本轮完成后，`P1-1` 可标记为“第一条真实业务链路已落地”，但 MR / PR merged 仍是后续扩展项。建议在缺口清单中注明：

- 已完成：docs push -> RAG sync。
- 未纳入：MR / PR merged 通知与状态推进。

如果后续需要更可靠的生产级处理，再引入 webhook job 表、重试、状态页和告警。本轮不提前建设这些能力。

## 10. 自审

- 未发现占位内容。
- 范围只覆盖 docs push 到 RAG sync。
- 失败语义明确为 HTTP 200 + failed body + error log。
- 生产依赖和测试依赖通过注入隔离。
