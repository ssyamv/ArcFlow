# arcflow-api Skill 设计（Phase 1–3）

> 日期：2026-04-14
> 分支建议：`feat/arcflow-api-skill`
> 关联 Epic：NanoClaw 作为 ArcFlow 核心入口（#85–#94）
> 前置依赖：`2026-04-14-nanoclaw-auth-passthrough-design.md`（Phase 0）

## 1. 背景与目标

目标：给 NanoClaw 装上"手脚"。当前 NanoClaw fork 只带 31 个通用 skill，无法代表 ArcFlow 执行真实业务。本 spec 规划一个专用 skill 包 `arcflow-api`，分三期交付，最终让 Web AiChat 成为用户的统一入口：

- 查我的 issue / PRD / 近期活动（只读）
- 创建需求草稿、触发 PRD 生成、更新 issue 状态（写入）
- 结果以消息卡片呈现，支持状态追踪与跳转

## 2. Skill 定位

`arcflow-api` 是 NanoClaw skill 包，位于 `packages/nanoclaw-skills/arcflow-api/`（本地开发仓内），编译产物部署到服务器 NanoClaw fork。Skill 本身是纯 TS 模块，通过 HTTP 调 Gateway（胶水服务）完成所有操作，**不直接访问数据库、Git、Plane、Dify**。

所有调用均从 session 读 `token` 透传给 Gateway（Phase 0 约定）。

## 3. Phase 1 — 只读 MVP（~3-5 天）

### 3.1 工具清单

| 工具 | 说明 | 调用 Gateway 端点 |
|---|---|---|
| `list_my_issues` | 列出当前用户在当前 workspace 下的 issue | `GET /api/issues?assignee=self` |
| `read_prd` | 按 ID 或路径读取 PRD 全文 | `GET /api/docs/prd/:id` |
| `search_docs` | 跨 PRD/技术设计/API 规范全文检索 | `GET /api/docs/search?q=` |
| `get_workspace_info` | 当前 workspace 元信息（成员、项目、最近活动计数） | `GET /api/workspaces/:id` |
| `list_recent_activity` | 最近 N 条活动（PR 合并、PRD 更新、Issue 状态变更） | `GET /api/activity?limit=20` |

### 3.2 工具接口约定

每个工具遵循统一签名：

```ts
interface SkillTool<Input, Output> {
  name: string;
  description: string;      // 供 LLM 理解何时调用
  inputSchema: JSONSchema;
  execute(input: Input, ctx: SkillContext): Promise<Output>;
}

interface SkillContext {
  session: NanoClawSession;  // 含 token / userId / workspaceId
  gateway: GatewayClient;    // 已注入 token 透传的 HTTP client
  logger: Logger;
}
```

### 3.3 输出格式

只读工具返回结构化 JSON，NanoClaw Agent SDK 按需格式化为自然语言。关键字段必须包含：

- `items`：数据列表
- `cursor`：分页游标（若适用）
- `links`：跳转链接数组（如 Plane issue URL、ArcFlow 文档路径），供 Phase 3 卡片化使用

### 3.4 验收标准

1. 5 个工具各自单测覆盖成功 / 空结果 / Gateway 错误三种 case。
2. 本地跑通：`mock Gateway` 场景下 skill 输入输出符合 schema。
3. 服务器部署后，Web AiChat 说"看看我最近的 PRD"能返回真实列表。

## 4. Phase 2 — 写能力（~3-5 天）

### 4.1 工具清单

| 工具 | 说明 | 调用 Gateway 端点 |
|---|---|---|
| `create_requirement_draft` | 基于自然语言描述创建需求草稿 | `POST /api/requirements/drafts` |
| `trigger_prd_generation` | 对指定草稿触发 Dify PRD 生成工作流 | `POST /api/prd/generate` |
| `update_issue_status` | 改 issue 状态（Backlog/InProgress/Review/Done） | `PATCH /api/issues/:id` |

### 4.2 安全约束

写操作触发 Stage D 原子写入（docs Git + Plane Issue），必须满足：

1. **幂等键**：每次调用带 `idempotencyKey`（UUID），Gateway 侧去重。
2. **dry-run 预览**：所有写工具支持 `dryRun: true`，返回"将要做什么"不实际执行。LLM 在用户明确确认前默认 `dryRun`。
3. **回显审批链接**：写操作成功后返回 Plane issue URL + 飞书审批卡片状态，供用户立刻核对。
4. **失败不重试**：Gateway 返非 2xx 一律直接抛给用户，不自动重试（避免重复创建）。

### 4.3 验收标准

1. 三个写工具单测覆盖 dryRun / 成功 / 幂等冲突 / Gateway 错误。
2. 端到端：Web AiChat 说"帮我创建个需求草稿：XXX" → 确认 → Plane 出现 issue + docs 仓出现草稿文件。
3. 重复提交同一 idempotencyKey 不产生第二条记录。

## 5. Phase 3 — 交互闭环（~2-3 天）

### 5.1 消息卡片化

NanoClaw 回流 Web 的消息支持富内容类型：

```ts
type RichMessage =
  | { type: 'text'; content: string }
  | { type: 'card'; title: string; fields: KV[]; actions: Action[] }
  | { type: 'status'; stage: string; progress: number; detail?: string };

interface Action {
  label: string;   // "查看 Issue" / "打开 PRD" / "去审批"
  url: string;
  style?: 'primary' | 'default' | 'danger';
}
```

Skill 输出 `links` → NanoClaw 侧按模板映射为 `card.actions`。

### 5.2 流程状态条

长耗时操作（PRD 生成、代码生成）返回 `status` 类型消息：

- 初始态：`stage: 'generating_prd', progress: 0`
- NanoClaw 订阅 Gateway 的进度事件（SSE 或轮询），逐步推送更新
- 终态：`stage: 'done', progress: 100` + 附 `card` 展示产物

### 5.3 Web 渲染

AiChat 组件按消息 `type` 分发：

- `text`：原样渲染
- `card`：用现有 shadcn Card 组件，actions 转按钮
- `status`：进度条 + 当前阶段文字

### 5.4 验收标准

1. Phase 2 的写工具回流全部是 card，用户点 "去审批" 跳 Plane 正确。
2. `trigger_prd_generation` 全程能看到 status 更新（至少 3 个阶段：queued → generating → done）。
3. 禁止使用 `window.prompt/alert/confirm`（见项目内 UI 规约）。

## 6. 目录结构

```text
packages/nanoclaw-skills/arcflow-api/
├── package.json
├── src/
│   ├── index.ts                  # 导出 skill 包
│   ├── context.ts                # SkillContext + GatewayClient
│   ├── tools/
│   │   ├── list-my-issues.ts
│   │   ├── read-prd.ts
│   │   ├── search-docs.ts
│   │   ├── get-workspace-info.ts
│   │   ├── list-recent-activity.ts
│   │   ├── create-requirement-draft.ts
│   │   ├── trigger-prd-generation.ts
│   │   └── update-issue-status.ts
│   └── format/
│       ├── card.ts               # 卡片模板
│       └── status.ts             # 状态条模板
└── __tests__/
    └── ...（每个工具对应一份）
```

## 7. 测试策略

- **单测**：每工具独立 mock `GatewayClient`，覆盖所有 case。
- **契约测**：针对 Gateway 真实 OpenAPI 做 schema 校验，确保 skill 与后端漂移可感知。
- **集成测**：起本地 Gateway + mock NanoClaw runtime，端到端跑 5 个只读工具。
- **手测清单**（部署前）：在 Web AiChat 执行 15 条典型对话，覆盖 3 个 Phase 所有工具。

## 8. 部署

1. 本地 `bun build` 产出 dist。
2. 推到 nanoclaw fork 的 `skills/arcflow-api/` 目录。
3. 服务器 PM2 `arcflow-nanoclaw` 重启。
4. 冷启后 `/data/project/nanoclaw` 应加载到新 skill（日志可见 `loaded skill: arcflow-api`）。

## 9. 非目标（YAGNI）

- 不做代码生成类工具（Claude Code headless 直接调，不经 NanoClaw）。
- 不做审批回调（沿用 Plane Webhook → Gateway 现路径）。
- 不做离线缓存。
- 不做 skill 动态热加载（重启即可）。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Gateway API schema 漂移 | 契约测 + OpenAPI 锁版 |
| 写工具被误触发造成脏数据 | 默认 `dryRun: true`，Prompt 侧强制先确认 |
| NanoClaw fork 与上游冲突 | skill 代码与 fork 主干解耦，`skills/arcflow-api` 单独目录 |
| 讯飞飞书 token 过期高频抖动 | Phase 0 已定义 `AUTH_EXPIRED` 回流机制 |
