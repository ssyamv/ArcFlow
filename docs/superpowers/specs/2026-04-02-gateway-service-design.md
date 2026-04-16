> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 胶水服务（Gateway Service）详细设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 定位

胶水服务是 ArcFlow 系统的数据搬运中心，负责系统间的 Webhook 接收、上下文组装、结果写回、Claude Code 调度和飞书通知推送。

### 与 Dify 的分工

- **Dify**：负责 AI 工作流编排（Prompt 链、RAG 检索、模型调用）
- **胶水服务**：负责系统间的数据搬运（Git 读写、Webhook 路由、飞书通知、Claude Code 调度）

---

## 二、技术选型

| 项 | 选择 | 理由 |
|----|------|------|
| 运行时 | Bun | 启动快、内存小、原生 TypeScript、内置 SQLite |
| Web 框架 | Hono | 轻量，对 Bun 原生支持好，比裸写 Bun.serve() 多路由和中间件 |
| 数据库 | bun:sqlite（内置） | 零配置，轻量存储运行时状态 |
| Git 操作 | simple-git | Node.js 生态成熟的 Git 封装库 |
| Claude Code 调度 | Bun.spawn | 异步非阻塞，进程隔离 |
| 飞书通知 | fetch（直接调用飞书 Open API） | 轻量，仅需发消息，无需完整 SDK |
| HTTP 客户端 | fetch（Bun 内置） | 无需额外依赖 |
| 部署 | Docker 容器（oven/bun 镜像） | 单进程，先单体后续按需拆分 |

---

## 三、API 接口设计

### 3.1 Webhook 接收（被动触发）

| 接口 | Method | Path | 来源 | 触发动作 |
|------|--------|------|------|----------|
| Plane 事件 | POST | /webhook/plane | Plane | Approved → 触发文档生成；Code Review → 飞书通知 |
| Git 事件 | POST | /webhook/git | Gitea/GitLab | MR Created → 飞书通知；docs push → 通知 Dify 知识库同步 |
| CI/CD 事件 | POST | /webhook/cicd | CI/CD 系统 | Test Failed → Bug 分析工作流；Build Success → 更新 Plane + 飞书通知 |
| 飞书回调 | POST | /webhook/feishu | 飞书 | URL verification challenge 响应（备用，当前审批通过 Plane 状态驱动） |

### 3.2 内部 API（主动调用）

| 接口 | Method | Path | 调用方 | 说明 |
|------|--------|------|--------|------|
| 触发工作流 | POST | /api/workflow/trigger | NanoClaw | 手动触发指定工作流 |
| 查询执行记录 | GET | /api/workflow/executions | NanoClaw / 管理界面 | 查询工作流执行历史和状态 |
| 健康检查 | GET | /health | Docker / 监控 | 服务存活检测 |

### 3.3 Webhook 验签与去重

**验签**：每个 Webhook 来源使用独立的验签机制：

| 来源 | 验签方式 |
|------|---------|
| Plane | Webhook Secret Token（请求头校验） |
| Gitea/GitLab | Webhook Secret Token（请求头校验） |
| CI/CD | Webhook Secret Token（请求头校验） |
| 飞书 | URL verification challenge 响应（当前仅用于平台验证，审批通过 Plane 驱动） |

验签失败直接返回 401，不处理请求。

**去重**：所有 Webhook 接口通过请求头或 body 中的 event ID 去重，SQLite 记录已处理事件，24 小时后自动清理。

### 3.4 内部 API 请求/响应格式

#### POST /api/workflow/trigger

请求 body：

```json
{
  "workflow_type": "prd_to_tech | tech_to_openapi | bug_analysis | code_gen",
  "plane_issue_id": "ISSUE-123",
  "params": {
    "input_path": "/prd/2026-04/feature-xxx.md",
    "target_repos": ["backend", "vue3"]
  }
}

```

响应：

```json
{
  "execution_id": 42,
  "status": "pending",
  "message": "工作流已触发"
}

```

#### GET /api/workflow/executions

查询参数：`?workflow_type=code_gen&status=running&limit=20`

响应：

```json
{
  "data": [
    {
      "id": 42,
      "workflow_type": "code_gen",
      "plane_issue_id": "ISSUE-123",
      "status": "running",
      "started_at": "2026-04-02T10:00:00",
      "completed_at": null
    }
  ],
  "total": 1
}

```

---

## 四、数据模型（SQLite）

```sql
-- 工作流执行记录
CREATE TABLE workflow_execution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL,            -- 'prd_to_tech' | 'tech_to_openapi' | 'bug_analysis' | 'code_gen'
  trigger_source TEXT NOT NULL,           -- 'plane_webhook' | 'cicd_webhook' | 'manual'
  plane_issue_id TEXT,                    -- 关联的 Plane Issue ID
  input_path TEXT,                        -- 输入文件路径（如 PRD 的 Git 路径）
  output_path TEXT,                       -- 输出文件路径（如生成的技术文档路径）
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'success' | 'failed'
  error_message TEXT,                     -- 失败时的错误信息
  retry_count INTEGER NOT NULL DEFAULT 0, -- Dify API 重试次数
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bug 修复重试计数
CREATE TABLE bug_fix_retry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plane_issue_id TEXT NOT NULL UNIQUE,        -- Bug Issue ID
  retry_count INTEGER NOT NULL DEFAULT 0,     -- 当前重试次数（最多 2 次）
  last_attempt_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'fixing' | 'fixed' | 'escalated'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhook 事件去重
CREATE TABLE webhook_event (
  event_id TEXT PRIMARY KEY,             -- Webhook 事件唯一 ID
  source TEXT NOT NULL,                  -- 'plane' | 'git' | 'cicd' | 'feishu'
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

```

`webhook_event` 表用定时任务每日清理 24 小时前的记录。

---

## 五、核心流程时序

### 5.1 流程 A：PRD Approved → 技术文档 + OpenAPI 生成

```text
Plane Webhook (Issue status → Approved)
  → POST /webhook/plane
  → 去重检查
  → 解析 Issue，提取 PRD 文件路径
  → simple-git: clone/pull docs 仓库，读取 PRD 内容
  → 写入 workflow_execution (status: running)
  → 调用 Dify 工作流一 API（传入 PRD 内容）
  → 接收返回的技术设计文档
  → simple-git: 写入 /tech-design/{yyyy-MM}/{功能名}.md + commit + push
  → 调用 Wiki.js GraphQL API 触发即时同步
  → 链式调用 Dify 工作流二 API（传入技术设计文档）
  → 接收返回的 OpenAPI yaml
  → simple-git: 写入 /api/{yyyy-MM}/{功能名}.yaml + commit + push
  → 更新 workflow_execution (status: success)
  → 飞书推送通知 @研发（消息卡片含"查看/通过/打回"按钮）
  → 失败时: 更新 workflow_execution (status: failed)，飞书通知 @研发 TL

```

### 5.2 流程 B：研发审批（通过 Plane 状态驱动）

```text
飞书通知卡片 → 研发点击"前往 Plane 审批"跳转链接
  → 研发在 Plane 中操作 Issue 状态
  → 通过（状态改为 Done）:
    → Plane Webhook → POST /webhook/plane
    → 触发代码生成流程（流程 C）
  → 打回（状态改为 Cancelled）:
    → Plane Webhook → POST /webhook/plane
    → 飞书通知 PM 修改 PRD

```

### 5.3 流程 C：代码生成

```text
审批通过后触发
  → 写入 workflow_execution (status: running)
  → 确定目标仓库（后端/Vue3/Flutter/Android，根据 PRD "涉及端"字段）
  → 对每个目标仓库:
    → simple-git: clone/pull 目标代码仓库
    → 组装 Claude Code 任务描述（含技术文档路径 + OpenAPI 路径 + Figma 链接）
    → Bun.spawn 调用 Claude Code（完整参数见下方说明）
    → 监听 stdout/stderr，设置超时（10 分钟）
    → 完成后: simple-git 创建分支 + commit + push + 创建 MR
  → 更新 workflow_execution (status: success)
  → 飞书通知 @研发 Review MR
  → 超时或失败: 更新 workflow_execution (status: failed)，飞书通知

```

**Claude Code 调用参数说明**：

```bash
claude -p "任务描述" \
  --output-format json \
  --dangerously-skip-permissions \
  --mcp-config /path/to/.mcp.json    # 包含 Figma MCP Server 配置（仅 UI 代码生成时需要）

```

- 工作目录：Bun.spawn 的 `cwd` 设为目标代码仓库的本地克隆路径
- 任务描述中包含：技术设计文档内容、OpenAPI yaml 路径、Figma 链接（如有）
- `.mcp.json` 由胶水服务在目标仓库目录中动态生成，包含 Figma MCP Server 配置
- `--dangerously-skip-permissions`：headless 模式必须，因为无人交互

**多仓库并发控制**：多端代码生成串行执行（一个仓库完成后再处理下一个），避免同时启动多个 Claude Code 进程导致资源争抢。后续可根据服务器资源调整为并发（最大并发数 2）。

### 5.4 流程 D：CI/CD 失败 → Bug 自动修复

```text
CI/CD Webhook (Test Failed)
  → POST /webhook/cicd
  → 去重检查
  → 提取失败日志 + 关联 Issue ID + 仓库信息
  → 调用 Dify 工作流三 API（传入日志 + 上下文）
  → 接收 Bug 分析报告
  → Plane API: 创建 Bug Issue（内容为分析报告）
  → Bug Issue 创建成功后，写入 bug_fix_retry 表（创建失败则记录日志 + 飞书通知，不进入自动修复）
  → 查询 bug_fix_retry 表
    → retry_count < 2:
      → retry_count++
      → Bun.spawn: Claude Code headless 自动修复
      → 修复完成 → 创建 MR → 飞书通知
      → 修复失败 → 飞书通知研发手动处理
    → retry_count >= 2:
      → 更新 status: escalated
      → 飞书通知 @研发 TL 人工介入

```

---

## 六、错误处理与容错

| 场景 | 处理策略 |
|------|---------|
| Dify API 调用失败 | 重试 2 次（间隔 5s、15s），仍失败则标记 execution failed + 飞书通知 |
| Claude Code 执行超时 | 10 分钟超时，kill 进程，标记 failed + 飞书通知 |
| Git push 冲突 | pull --rebase 后重试 1 次，仍失败则标记 failed + 飞书通知 |
| Wiki.js GraphQL 同步失败 | 非阻塞，记录日志，不影响主流程（Wiki.js Git 定时同步兜底） |
| 飞书通知发送失败 | 非阻塞，记录日志，不影响主流程 |
| Webhook 重复投递 | event_id 去重，已处理的直接返回 200 |
| Plane API 调用失败 | 重试 2 次，仍失败则记录日志 + 飞书通知 |

**核心原则**：主流程（文档生成、代码生成）失败必须通知人；辅助流程（通知、同步）失败静默降级，不阻塞。

---

## 七、项目结构

```text
gateway-service/
├── src/
│   ├── index.ts              # 入口，Hono 应用初始化
│   ├── routes/
│   │   ├── webhook.ts        # Webhook 路由（plane/git/cicd/feishu）
│   │   ├── api.ts            # 内部 API 路由（workflow/trigger、executions）
│   │   └── health.ts         # 健康检查
│   ├── services/
│   │   ├── workflow.ts       # 工作流编排（调用 Dify、串联流程）
│   │   ├── git.ts            # Git 操作（clone/pull/commit/push/MR）
│   │   ├── claude-code.ts    # Claude Code 调度（Bun.spawn）
│   │   ├── dify.ts           # Dify API 客户端
│   │   ├── plane.ts          # Plane API 客户端
│   │   ├── feishu.ts         # 飞书消息推送 + 消息卡片
│   │   └── wikijs.ts         # Wiki.js GraphQL 客户端
│   ├── db/
│   │   ├── index.ts          # SQLite 初始化（bun:sqlite）
│   │   ├── schema.sql        # 建表语句
│   │   └── queries.ts        # 查询函数封装
│   ├── middleware/
│   │   ├── dedup.ts          # Webhook 去重中间件
│   │   ├── verify.ts         # Webhook 验签中间件
│   │   └── logger.ts         # 请求日志
│   ├── scheduler.ts          # 定时任务（webhook_event 清理等）
│   ├── types/
│   │   └── index.ts          # TypeScript 类型定义
│   └── config.ts             # 环境变量配置
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example              # 环境变量模板

```

---

## 八、环境变量

```env
# 服务
PORT=8080

# Dify
DIFY_BASE_URL=http://内网IP:3001
DIFY_API_KEY=

# Plane
PLANE_BASE_URL=http://内网IP:80
PLANE_API_TOKEN=
PLANE_WORKSPACE_SLUG=

# Git
DOCS_GIT_REPO=git@内网IP:docs.git
BACKEND_GIT_REPO=git@内网IP:backend.git
VUE3_GIT_REPO=git@内网IP:vue3.git
FLUTTER_GIT_REPO=git@内网IP:flutter.git
ANDROID_GIT_REPO=git@内网IP:android.git
GIT_WORK_DIR=/tmp/gateway-git

# Webhook 验签
PLANE_WEBHOOK_SECRET=
GIT_WEBHOOK_SECRET=
CICD_WEBHOOK_SECRET=

# 飞书（私有化部署改为内部域名）
FEISHU_BASE_URL=https://open.feishu.cn
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=
FEISHU_DEFAULT_CHAT_ID=

# Wiki.js
WIKIJS_BASE_URL=http://内网IP:3000
WIKIJS_API_KEY=

# Claude Code
CLAUDE_CODE_TIMEOUT=600000

```
