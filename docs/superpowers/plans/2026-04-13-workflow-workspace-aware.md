# 工作流工作空间化 + 文档链接修复 实施计划

**Goal:** 彻底移除 Plane/Docs 相关的全局 env fallback，`triggerWorkflow` 要求 `workspace_id`，从 workspaces 表动态取 Plane slug / project_id / docs 仓库。飞书卡片文档链接指向 Web 前端查看页。

**Background:** E2E 跑通后发现飞书卡片里的 Plane 跳转用了错误的 workspace slug（全局 env 写死 `arcflow`，实际是 `homture`），且文档链接是裸相对路径点不开。根因是 workflow 链路未接入 workspace 概念。

**Branch:** `feat/workflow-workspace-aware`

---

## 改动清单（共 10 个原子提交）

### Commit 1: 删 workspace-sync 服务 + 路由

**Why:** 只被手动调用一次，写入的记录还漏掉 `plane_workspace_slug` 字段。Web UI 建 workspace 已经足够。

- `packages/gateway/src/services/workspace-sync.ts` — 删除
- `packages/gateway/src/services/workspace-sync.test.ts` — 删除
- `packages/gateway/src/routes/workspaces.ts` — 删除 `/sync-plane` 端点 + import
- `packages/gateway/src/routes/workspaces.test.ts` — 删除 sync 相关 case

### Commit 2: 删 3 个全局 env + 加 WEB_BASE_URL

- `packages/gateway/src/config.ts`：删 `planeWorkspaceSlug` / `planeDefaultProjectId` / `docsGitRepo` 字段；加 `webBaseUrl`（默认 `http://localhost:5173`）
- `packages/gateway/.env.example`：同步改
- `packages/gateway/src/test-config.ts`：删三字段 + 加 webBaseUrl

（Commit 2 会把下游编译打破，Commit 3-8 连续修复）

### Commit 3: `plane.ts` 签名带 slug

- `planeFetch(path, slug, init?)` 把 slug 作为第二个参数
- `getIssue(issueId, slug)` / `createBugIssue(projectId, body, slug)` / `getIssueSummary(projectId, slug)` / `getActiveCycles(projectId, slug)` / `updateIssueState(issueId, stateId, projectId, slug)` 等
- 调用方：
  - `routes/plane-proxy.ts`：`ws.plane_workspace_slug` 传入
  - `workflow.ts`（见 Commit 4）

### Commit 4: `workflow.ts` 工作空间化（核心）

- `TriggerParams` 增加必填 `workspace_id: number`
- `executeWorkflow` 入口 `const ws = getWorkspace(params.workspace_id)`，不存在抛错
- `flowPrdToTech`：
  - 注册 `ws-{id}-docs` 仓库（`registerRepoUrl` + `ensureRepo`）
  - 改用 `readFile("ws-{id}-docs", ...)` / `writeAndPush("ws-{id}-docs", ...)`
  - 传 `planeWorkspaceSlug` / `planeProjectId` / `workspaceSlug` 给 `sendTechReviewCard`
- `flowTechToOpenApi`：同上
- `flowBugAnalysis`：`createBugIssue(planeProjectId, body, planeWorkspaceSlug)`；`targetRepo` 改 `ws-{id}-{repo}`（如 `ws-2-backend`）
- `flowCodeGen`：同上，读 `ws-{id}-docs`、push 到 `ws-{id}-{repo}`
- 所有 `params.project_id` 改为 `ws.plane_project_id`

### Commit 5: `feishu.ts` 卡片链接走 Web

- `sendTechReviewCard` 参数：新增 `workspaceSlug: string`；`planeWorkspaceSlug` / `planeProjectId` 改为必填（去掉 config fallback）
- 文档链接从裸 path 改为：`${config.webBaseUrl}/docs?ws=${slug}&path=${encodeURIComponent(path)}`
- 同步改 `feishu.test.ts`

### Commit 6: `/api/workflow/trigger` 要求 workspace_id

- `TriggerWorkflowRequest` 增 `workspace_id`
- `routes/api.ts` 校验 workspace_id 存在，鉴权（当前用户是否在 workspace 中）
- `routes/api.test.ts` 改 case

### Commit 7: plane webhook 反查 workspace

- `webhook.ts` `/plane`：

  ```ts
  const ws = getWorkspaceByPlaneProject(body.data.project_id);
  if (!ws) return c.json({ error: "workspace not linked" }, 404);
  triggerWorkflow({ workspace_id: ws.id, ... })
  ```

- 移除硬编码 `config.feishuDefaultChatId` 兜底 → 从 workspace 里拿 `feishu_chat_id`（需加字段，见 Commit 7.5）

### Commit 7.5: workspace 表加 feishu_chat_id

- `db/index.ts` migration：`ALTER TABLE workspaces ADD COLUMN feishu_chat_id TEXT`
- `types/index.ts` Workspace 接口加字段
- `db/queries.ts` updateWorkspace 支持该字段

### Commit 8: iBuild webhook 改 appKey → workspace

- 移除 `planeDefaultProjectId` 兜底
- 新增 `ibuildAppWorkspaceMap` env（JSON: appKey → workspace_slug）
- 根据 appKey 查 workspace.id，传入 `triggerWorkflow`

### Commit 9: git.ts 和 routes/docs.ts 去 fallback

- `git.ts` `getRepoUrl` repoMap 移除 "docs" / "arcflow-docs" / "backend" 等硬映射（全靠 `registerRepoUrl` 动态注册）
- `routes/docs.ts` 移除 `getDocsGitRepo: () => getConfig().docsGitRepo` 和 fallback 分支

### Commit 10: Web 端

- `packages/web/src/pages/Docs.vue`：挂载时读 `route.query.ws` + `route.query.path`，切换 workspace store 并 `openFile(path)`
- `packages/web/src/pages/WorkspaceSettings.vue`：检查表单是否已露出 `plane_project_id` / `plane_workspace_slug` / `git_repos.docs` / `feishu_chat_id`，补缺失项
- `packages/web/src/stores/docs.ts`：如果需要，加 `setWorkspace(slug)` 方法

### Commit 11: 部署 + E2E

- 服务器 `.env`：删 3 个 + 加 `WEB_BASE_URL=http://172.29.230.21` + `IBUILD_APP_WORKSPACE_MAP={...}`
- 补 Homture workspace 的 feishu_chat_id = `oc_b492f3b5703e8254748650f4da7a6d2d`
- 补 Homture workspace 的 git_repos.docs URL
- `docker compose build gateway web && docker compose up -d`
- `POST /api/workflow/trigger` 带 `workspace_id: 2` 重跑
- 验证：飞书卡片里的"PRD / 技术文档 / OpenAPI"链接都能点开 Web 页，"前往 Plane 审批"按钮跳对 workspace

---

## 验收

- [ ] `grep -r "planeWorkspaceSlug\|planeDefaultProjectId\|docsGitRepo" packages/gateway/src` 零命中
- [ ] `bun test` 在 `packages/gateway` 全绿
- [ ] `npm test` 在 `packages/web` 全绿
- [ ] 服务器 `/api/workflow/trigger` 带 workspace_id 跑通，飞书卡片所有链接可点
- [ ] PR 合入 main
