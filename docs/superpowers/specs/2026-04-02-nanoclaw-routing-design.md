# NanoClaw 意图路由设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 定位

NanoClaw 是基于 Claude Agent SDK 的轻量 AI Agent 平台，Claude Code 运行在容器中作为核心引擎。团队成员通过飞书或微信 @NanoClaw 发起对话，完成项目问答、任务管理、工作流触发和文档操作。

### 意图路由方式

NanoClaw 不需要显式的意图分类器或路由模块。Claude Code 本身具备理解用户意图并选择合适工具的能力。我们只需要通过 CLAUDE.md 告知 Claude Code 可用的工具和处理指引。

### 飞书集成现状

飞书集成已实现，分两部分：
- **FeishuChannel**（`src/channels/feishu.ts`）：处理飞书消息收发，支持私聊和群聊 @触发，API 指向讯飞版飞书（`open.xfchat.iflytek.com`）
- **feishu-docs 技能**（`container/skills/feishu-docs/`）：容器内 Bash 工具，通过飞书 API 读取飞书文档/Wiki/表格/多维表格

> 微信渠道接入（使用腾讯官方 `@tencent-weixin/openclaw-weixin-cli` 插件）待后续单独规划，本文档仅覆盖飞书渠道。

---

## 二、工具接入方案

### 2.1 接入方式总览

| 系统 | 接入方式 | 说明 |
|------|---------|------|
| 飞书消息 | FeishuChannel（已实现） | NanoClaw 内置，消息收发自动处理 |
| 飞书文档 | feishu-docs 技能（已实现） | 容器内 Bash 工具，读取飞书文档/Wiki/表格 |
| Plane | MCP Server | 新增，原生 MCP，任务管理交互最丰富 |
| 胶水服务 | REST API（curl） | 新增，仅 2 个端点，不需要 MCP 封装 |
| Dify RAG | REST API（curl） | 新增，单个接口调用 |
| Wiki.js | REST API / GraphQL（curl） | 新增，查询为主 |
| Git | CLI（git 命令） | 容器内已有，Claude Code 天然支持 |

### 2.2 MCP Server 配置

NanoClaw 容器中的 `.mcp.json`：

```json
{
  "mcpServers": {
    "plane": {
      "command": "npx",
      "args": ["@makeplane/mcp-server"],
      "env": {
        "PLANE_API_TOKEN": "${PLANE_API_TOKEN}",
        "PLANE_BASE_URL": "${PLANE_BASE_URL}",
        "PLANE_WORKSPACE_SLUG": "${PLANE_WORKSPACE_SLUG}"
      }
    }
  }
}
```

### 2.3 REST API 接入说明

胶水服务、Dify、Wiki.js 通过 Claude Code 的 Bash 工具调用 curl：

**胶水服务**：
```bash
# 触发工作流
curl -X POST ${GATEWAY_URL}/api/workflow/trigger \
  -H "Content-Type: application/json" \
  -d '{"workflow_type":"code_gen_backend","plane_issue_id":"ISSUE-123"}'

# 查询执行记录
curl "${GATEWAY_URL}/api/workflow/executions?plane_issue_id=ISSUE-123"
```

**Dify RAG**：
```bash
curl -X POST ${DIFY_URL}/v1/chat-messages \
  -H "Authorization: Bearer ${DIFY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"inputs":{},"query":"用户登录的接口定义在哪？","response_mode":"blocking","user":"nanoclaw"}'
```

**Wiki.js GraphQL**：
```bash
curl -X POST ${WIKIJS_URL}/graphql \
  -H "Authorization: Bearer ${WIKIJS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ pages { list(orderBy:UPDATED) { id title path updatedAt } } }"}'
```

---

## 三、NanoClaw CLAUDE.md

容器中的 CLAUDE.md 内容：

```markdown
# NanoClaw AI 工作台 — Claude 上下文

## 你的角色

你是 ArcFlow 团队的 AI 工作台助手，团队成员通过飞书与你对话（微信渠道待后续接入）。
你可以帮助他们完成项目问答、任务管理、工作流触发和文档操作。
回复使用中文，简洁直接。

## 团队背景

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue3 + Element Plus / shadcn-vue
- 移动端：Flutter 3.x + GetX
- 客户端：Kotlin Android
- 接口规范：RESTful，统一返回 Result<T>

## 可用工具

### 1. Plane MCP — 任务管理
- 创建、查询、更新 Issue
- 查看看板状态、变更 Issue 状态
- 使用前先确认 workspace 和 project

### 2. 胶水服务 API — 工作流操作
- 具体 URL 通过环境变量获取，Bash 中使用 `$GATEWAY_URL`
- POST $GATEWAY_URL/api/workflow/trigger — 触发工作流
- GET $GATEWAY_URL/api/workflow/executions — 查询执行记录
- 触发工作流时必须提供 workflow_type 和 plane_issue_id
- 支持的 workflow_type 枚举值：
  - `prd_to_tech` — PRD 生成技术设计文档
  - `tech_to_openapi` — 技术文档生成 OpenAPI yaml
  - `code_gen_backend` — 后端代码生成
  - `code_gen_vue3` — Vue3 前端代码生成
  - `code_gen_flutter` — Flutter 移动端代码生成
  - `code_gen_android` — Android 客户端代码生成
  - `bug_analysis` — CI/CD 失败日志分析

### 3. Dify RAG API — 知识问答
- 具体 URL 通过环境变量获取，Bash 中使用 `$DIFY_URL`
- POST $DIFY_URL/v1/chat-messages — 发送问题，获取基于文档的回答
- 适用于文档类问题（"某功能的接口是什么""某 PRD 说了什么"）

### 4. Wiki.js GraphQL API — 文档操作
- 具体 URL 通过环境变量获取，Bash 中使用 `$WIKIJS_URL`
- 查询文档列表、搜索文档内容、读取文档详情
- 适用于"帮我查一下 XX 文档""最近更新了哪些 PRD"

### 5. Git CLI — 仓库查询
- 查看 MR 状态、最近提交、分支列表
- 读取仓库中的文件内容
- 仅做查询，不执行写操作（代码修改由胶水服务调度的独立 Claude Code 实例完成）
- 容器内 git 配置限制只读：通过 git hook 拒绝 push/commit 操作

### 6. 飞书文档 — 已内置
- 通过 feishu-docs 技能读取飞书文档、Wiki、表格、多维表格
- 飞书消息收发由 NanoClaw FeishuChannel 自动处理，无需额外调用

## 意图路由指引

根据用户消息语义自然理解意图，参考以下指引选择工具：

| 用户意图 | 优先使用的工具 | 示例 |
|----------|--------------|------|
| 问项目/技术/文档相关问题 | Dify RAG API | "用户登录的接口定义在哪？" |
| 创建/查询/更新任务 | Plane MCP | "创建一个用户注册的 Issue" |
| 触发代码生成或文档生成 | 胶水服务 API | "ISSUE-123 审批通过了，开始生成技术文档" |
| 查询工作流执行状态 | 胶水服务 API | "ISSUE-123 的代码生成到哪一步了？" |
| 查找 docs 仓库中的文档 | Wiki.js GraphQL | "帮我查一下用户登录的 PRD" |
| 查看飞书上的文档/表格 | feishu-docs 技能 | "看一下飞书上的项目周报" |
| 查看 MR 或代码 | Git CLI | "后端仓库最近的 MR 有哪些？" |

## 操作约束

- 不直接修改代码仓库中的文件，代码修改通过胶水服务触发 Claude Code headless 完成
- 不直接修改 /prd 目录下的文件
- 触发工作流前先向用户确认（"确认要为 ISSUE-123 触发代码生成吗？"）
- 如果用户的问题超出你的工具能力范围，告知用户去对应的 Web UI 操作
```

---

## 四、环境变量

NanoClaw 容器中需要配置的环境变量：

```env
# 飞书（已有）
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_WEBHOOK_PORT=3000

# Plane MCP
PLANE_API_TOKEN=
PLANE_BASE_URL=http://内网IP:80
PLANE_WORKSPACE_SLUG=

# 胶水服务
GATEWAY_URL=http://内网IP:8080

# Dify RAG
DIFY_URL=http://内网IP:3001
DIFY_API_KEY=

# Wiki.js（注意：端口不要与 FEISHU_WEBHOOK_PORT 冲突，Wiki.js 和飞书 Webhook 分别在不同 IP 或不同端口）
WIKIJS_URL=http://内网IP:3000
WIKIJS_API_KEY=

# Git 仓库（克隆到容器内供查询）
DOCS_GIT_REPO=git@内网IP:docs.git
BACKEND_GIT_REPO=git@内网IP:backend.git
VUE3_GIT_REPO=git@内网IP:vue3.git
FLUTTER_GIT_REPO=git@内网IP:flutter.git
ANDROID_GIT_REPO=git@内网IP:android.git
```

---

## 五、权限与安全

| 规则 | 说明 |
|------|------|
| 群聊触发 | 仅 @NanoClaw 时响应，不对群内所有消息响应 |
| 私聊触发 | 直接响应，无需 @ |
| 操作确认 | 触发工作流、变更 Issue 状态等写操作前，先向用户确认 |
| 代码仓库 | 只读查询，容器内 git hook 拒绝 push/commit 操作 |
| 飞书文档 | 通过飞书 API 读取，受飞书应用权限控制 |
| 敏感操作 | 不支持删除 Issue、删除文档等破坏性操作 |

---

## 六、与胶水服务的职责边界

| 职责 | NanoClaw | 胶水服务 |
|------|---------|---------|
| 消息交互 | 接收和回复飞书/微信消息 | 不处理消息交互 |
| 工作流触发 | 通过 REST API 调用胶水服务 | 执行实际的工作流编排 |
| 状态推送 | 不主动推送 | 在各节点完成后推送飞书消息卡片 |
| 代码生成 | 不执行 | 调度 Claude Code headless |
| 任务管理 | 通过 Plane MCP 读写 | 通过 Plane API 更新状态 |
| 知识问答 | 调用 Dify RAG API | 不处理 |

NanoClaw 是**用户交互入口**，胶水服务是**系统间数据搬运**。两者通过胶水服务的 REST API 衔接。
