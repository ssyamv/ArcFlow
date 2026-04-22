# Git Webhook Merge State Implementation Plan

> 日期：2026-04-22
> 状态：Completed

## Goal

让 `/webhook/git` 能处理 MR / PR merged 事件，并把结果写回当前 `code_gen`
执行的子任务状态。

## Scope

- Extend `packages/gateway/src/services/git-webhook.ts`
- Extend `packages/gateway/src/routes/webhook.ts`
- Adjust `packages/gateway/src/db/queries.ts`
- Add `webhook_job` schema and query helpers.
- Add webhook job runner and scheduler wiring.
- Update `docs/当前缺口清单_按优先级.md`

## Tasks

- [x] Add parser tests for GitHub pull request merged payloads.
- [x] Add parser tests for GitLab merge request merged payloads.
- [x] Classify merged PR / MR events as `code_merge`.
- [x] Add route test for matched merge event -> `mr_merged` subtask.
- [x] Add route test for unmatched merge event -> 200 + `unmatched`.
- [x] Treat `mr_merged` as a successful `code_gen` terminal stage.
- [x] Add `webhook_job` create / claim / finish / due-list helpers.
- [x] Record merge event post-processing into `webhook_job`.
- [x] Reschedule unmatched merge jobs as pending for future retry worker.
- [x] Add retry worker service for due `code_merge` jobs.
- [x] Wire retry worker into Gateway scheduler.
- [x] Document retry interval environment variables.
- [x] Add `GET /api/webhook/jobs` diagnostics endpoint.
- [x] Surface pending / dead `code_merge` jobs on the Workflow List page.
- [x] Send Feishu alert when webhook jobs become `dead`.
- [x] Update backlog progress.

## Verification

- `bun test packages/gateway/src/services/git-webhook.test.ts packages/gateway/src/routes/webhook.test.ts`
- `bun test packages/gateway/src/db/queries.test.ts packages/gateway/src/routes/webhook.test.ts`
- `bun test packages/gateway/src/services/webhook-job-runner.test.ts packages/gateway/src/scheduler.test.ts packages/gateway/src/config.test.ts`
- `bun test packages/gateway/src/db/queries.test.ts packages/gateway/src/routes/api.test.ts`
- `bun run --cwd packages/web test`

Full verification should also run:

- `bun run test`
- `bun run --cwd packages/gateway lint`
- `bunx markdownlint-cli2 docs/当前缺口清单_按优先级.md docs/superpowers/specs/2026-04-22-git-webhook-merge-state-design.md docs/superpowers/plans/2026-04-22-git-webhook-merge-state.md`
