> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

<!-- markdownlint-disable MD040 -->
# NanoClaw ArcFlow 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork NanoClaw 并完成 ArcFlow 定制（飞书 Channel + arcflow-api 工具 + Plane MCP + group 配置），使其可部署到服务器。

**Architecture:** Fork qwibitai/nanoclaw 到 ssyamv/nanoclaw，应用 add-feishu skill 添加飞书 Channel 代码，创建 arcflow-api container skill 封装 Gateway/Dify/Wiki.js REST 调用，配置 Plane MCP，创建 ArcFlow 主 group 的 CLAUDE.md。ArcFlow 仓库只放部署说明。

**Tech Stack:** Node.js + TypeScript, Claude Agent SDK, Express (飞书 Webhook), Bash (container skills), Plane MCP

**Spec:** `docs/superpowers/specs/2026-04-07-nanoclaw-setup-design.md`

---

## 文件清单

### ssyamv/nanoclaw 仓库（Fork 后修改）

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/channels/feishu.ts` | 飞书 Channel（add-feishu skill 生成） |
| 修改 | `src/channels/index.ts` | 注册飞书 Channel import |
| 创建 | `container/skills/feishu-docs/SKILL.md` | 飞书文档读取工具说明 |
| 创建 | `container/skills/feishu-docs/feishu-docs` | 飞书文档读取 bash 脚本 |
| 修改 | `src/container-runner.ts` | 透传飞书 + ArcFlow 环境变量到容器 |
| 创建 | `container/skills/arcflow-api/SKILL.md` | ArcFlow API 工具说明 |
| 创建 | `container/skills/arcflow-api/arcflow-api` | ArcFlow API bash 脚本 |
| 创建 | `groups/arcflow-main/CLAUDE.md` | ArcFlow 主 group 上下文 |
| 修改 | `.mcp.json` | 加入 Plane MCP 配置 |
| 修改 | `.env.example` | 加入 ArcFlow 环境变量 |

### ArcFlow 仓库（本仓库）

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `setup/nanoclaw/README.md` | NanoClaw 部署说明 |
| 修改 | `CLAUDE.md` | 更新组件清单和仓库结构 |

---

## Task 1: Fork NanoClaw 仓库

**Files:**

- 无文件修改，仅 GitHub 操作

- [ ] **Step 1: Fork 仓库**

```bash
gh repo fork qwibitai/nanoclaw --org ssyamv --clone=false
```

- [ ] **Step 2: Clone 到本地**

```bash
cd /Users/chenqi/code
git clone https://github.com/ssyamv/nanoclaw.git
cd nanoclaw
```

- [ ] **Step 3: 安装依赖并验证编译**

```bash
npm install
npm run build
```

Expected: 编译成功，无 TypeScript 错误

- [ ] **Step 4: 运行现有测试**

```bash
npm test
```

Expected: 所有测试通过

---

## Task 2: 应用 add-feishu skill — 创建飞书 Channel

**Files:**

- Create: `src/channels/feishu.ts`
- Modify: `src/channels/index.ts`

- [ ] **Step 1: 创建 `src/channels/feishu.ts`**

完整代码来自 add-feishu skill（`ssyamv/claude-code-skills` 仓库的 `.claude/skills/add-feishu/SKILL.md` Phase 2.1 节）。

注意：`FEISHU_API_BASE` 默认值为 `https://open.xfchat.iflytek.com`（讯飞版飞书）。

关键实现要点：

- 使用 express 启动 HTTP server 监听 webhook
- 支持 v1.0 和 v2.0 事件格式
- 群聊仅 @机器人 时响应
- 消息分块发送（单条最大 4000 字符）
- JID 格式：`feishu:<chat_id 或 open_id>`

- [ ] **Step 2: 修改 `src/channels/index.ts`**

在文件末尾追加：

```typescript
// feishu
import './feishu.js';
```

- [ ] **Step 3: 添加 express 依赖**

```bash
npm install express
npm install -D @types/express
```

注意：检查 package.json 是否已有 express 依赖，如果已有则跳过。

- [ ] **Step 4: 验证编译**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add src/channels/feishu.ts src/channels/index.ts package.json package-lock.json
git commit -m "feat: add Feishu channel for ArcFlow"
```

---

## Task 3: 应用 add-feishu skill — 创建 feishu-docs 容器技能

**Files:**

- Create: `container/skills/feishu-docs/SKILL.md`
- Create: `container/skills/feishu-docs/feishu-docs`

- [ ] **Step 1: 创建 `container/skills/feishu-docs/SKILL.md`**

完整内容来自 add-feishu skill Phase 2.3 节。定义工具触发场景（feishu.cn / xfchat.iflytek.com 链接）和命令格式（read / read-all / list / list-drive）。

- [ ] **Step 2: 创建 `container/skills/feishu-docs/feishu-docs`**

完整 bash 脚本来自 add-feishu skill Phase 2.4 节。支持：

- docx 文档读取
- wiki 知识库递归读取
- spreadsheet 表格读取
- bitable 多维表格读取
- drive 文件列表

- [ ] **Step 3: 设置可执行权限**

```bash
chmod +x container/skills/feishu-docs/feishu-docs
```

- [ ] **Step 4: Commit**

```bash
git add container/skills/feishu-docs/
git commit -m "feat: add feishu-docs container skill"
```

---

## Task 4: 应用 add-feishu skill — 补丁 container-runner.ts

**Files:**

- Modify: `src/container-runner.ts` (约第 253 行附近，`args.push('-e', \`TZ=...\`)` 之后)

- [ ] **Step 1: 在 `buildContainerArgs` 函数中添加飞书凭证透传**

在 `args.push('-e', \`TZ=${TIMEZONE}\`);` 之后，添加：

```typescript
  // Pass Feishu credentials for feishu-docs tool
  const feishuEnvVars = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  if (feishuEnvVars.FEISHU_APP_ID) {
    args.push('-e', `FEISHU_APP_ID=${feishuEnvVars.FEISHU_APP_ID}`);
  }
  if (feishuEnvVars.FEISHU_APP_SECRET) {
    args.push('-e', `FEISHU_APP_SECRET=${feishuEnvVars.FEISHU_APP_SECRET}`);
  }
```

确认 `readEnvFile` 已导入。如未导入，在文件顶部添加：

```typescript
import { readEnvFile } from './env.js';
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat: pass Feishu credentials to agent containers"
```

---

## Task 5: 创建 arcflow-api 容器技能

**Files:**

- Create: `container/skills/arcflow-api/SKILL.md`
- Create: `container/skills/arcflow-api/arcflow-api`

- [ ] **Step 1: 创建 `container/skills/arcflow-api/SKILL.md`**

```markdown
---
name: arcflow-api
description: Call ArcFlow Gateway (workflow trigger/status), Dify RAG (knowledge Q&A), and Wiki.js (document query) APIs. Use this for workflow operations, knowledge questions, and document lookups.
allowed-tools: Bash(arcflow-api:*)
---

# ArcFlow API Tool

Interact with ArcFlow platform services from inside the agent container.

## When to Use

- **Trigger workflows** — user asks to generate tech docs, OpenAPI, or code for an Issue
- **Check workflow status** — user asks about progress of a workflow execution
- **Knowledge Q&A** — user asks technical/documentation questions that need RAG search
- **Document operations** — user asks to find, search, or read docs from Wiki.js

## Commands

\`\`\`bash
# Trigger a workflow
arcflow-api workflow trigger <type> <plane_issue_id> [target_repos...]
# type: prd_to_tech | tech_to_openapi | code_gen | bug_analysis
# target_repos (code_gen only): backend vue3 flutter android

# Shorthand for code_gen with specific target
arcflow-api workflow trigger code_gen_backend <plane_issue_id>
arcflow-api workflow trigger code_gen_vue3 <plane_issue_id>
arcflow-api workflow trigger code_gen_flutter <plane_issue_id>
arcflow-api workflow trigger code_gen_android <plane_issue_id>

# Query workflow execution status
arcflow-api workflow status <plane_issue_id>

# Knowledge Q&A via Dify RAG
arcflow-api rag query "your question here"

# Wiki.js document operations
arcflow-api wiki list                    # List recent documents
arcflow-api wiki search "keyword"        # Search documents
arcflow-api wiki read <path>             # Read document content
\`\`\`

## Examples

\`\`\`bash
# Trigger tech doc generation for ISSUE-123
arcflow-api workflow trigger prd_to_tech ISSUE-123

# Trigger backend code generation
arcflow-api workflow trigger code_gen_backend ISSUE-123

# Trigger code gen for multiple targets
arcflow-api workflow trigger code_gen ISSUE-123 backend vue3

# Check status
arcflow-api workflow status ISSUE-123

# Ask a question
arcflow-api rag query "用户登录的接口定义在哪？"

# Find a document
arcflow-api wiki search "用户注册"
\`\`\`

## Notes

- Workflow trigger will show the execution ID on success
- RAG query returns an answer based on indexed documentation
- Wiki operations query the Wiki.js GraphQL API
```

- [ ] **Step 2: 创建 `container/skills/arcflow-api/arcflow-api`**

```bash
#!/bin/bash
# ArcFlow API Tool
# Wraps Gateway, Dify RAG, and Wiki.js REST/GraphQL calls
set -euo pipefail

check_var() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Error: $name not set" >&2
        exit 1
    fi
}

# --- Workflow commands ---

workflow_trigger() {
    check_var GATEWAY_URL
    local type="$1" issue_id="$2"
    shift 2
    local target_repos=("$@")

    # Handle shorthand: code_gen_backend → code_gen + target_repos=["backend"]
    case "$type" in
        code_gen_backend)  type="code_gen"; target_repos=("backend") ;;
        code_gen_vue3)     type="code_gen"; target_repos=("vue3") ;;
        code_gen_flutter)  type="code_gen"; target_repos=("flutter") ;;
        code_gen_android)  type="code_gen"; target_repos=("android") ;;
    esac

    local params="{}"
    if [[ ${#target_repos[@]} -gt 0 ]]; then
        local repos_json
        repos_json=$(printf '%s\n' "${target_repos[@]}" | jq -R . | jq -s .)
        params=$(jq -n --argjson repos "$repos_json" '{"target_repos": $repos}')
    fi

    local body
    body=$(jq -n \
        --arg wt "$type" \
        --arg pid "$issue_id" \
        --argjson params "$params" \
        '{workflow_type: $wt, plane_issue_id: $pid, params: $params}')

    local resp
    resp=$(curl -sf -X POST "${GATEWAY_URL}/api/workflow/trigger" \
        -H "Content-Type: application/json" \
        -d "$body" 2>&1) || {
        echo "Error: Failed to trigger workflow" >&2
        echo "$resp" >&2
        exit 1
    }
    echo "$resp" | jq .
}

workflow_status() {
    check_var GATEWAY_URL
    local issue_id="$1"
    # Note: Gateway /api/workflow/executions currently only supports
    # workflow_type, status, limit filters — not plane_issue_id.
    # We fetch recent executions and filter client-side.
    local resp
    resp=$(curl -sf "${GATEWAY_URL}/api/workflow/executions?limit=50" 2>&1) || {
        echo "Error: Failed to query workflow status" >&2
        echo "$resp" >&2
        exit 1
    }
    # Filter by plane_issue_id client-side
    echo "$resp" | jq --arg pid "$issue_id" '[.data[] | select(.plane_issue_id == $pid)]'
}

# --- RAG commands ---

rag_query() {
    check_var DIFY_URL
    check_var DIFY_API_KEY
    local question="$1"
    local body
    body=$(jq -n \
        --arg q "$question" \
        '{inputs: {}, query: $q, response_mode: "blocking", user: "nanoclaw"}')

    local resp
    resp=$(curl -sf -X POST "${DIFY_URL}/v1/chat-messages" \
        -H "Authorization: Bearer ${DIFY_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$body" 2>&1) || {
        echo "Error: Dify RAG query failed" >&2
        echo "$resp" >&2
        exit 1
    }
    echo "$resp" | jq -r '.answer // .message // .'
}

# --- Wiki.js commands ---

wiki_graphql() {
    check_var WIKIJS_URL
    check_var WIKIJS_API_KEY
    local query="$1"
    local body
    body=$(jq -n --arg q "$query" '{query: $q}')

    curl -sf -X POST "${WIKIJS_URL}/graphql" \
        -H "Authorization: Bearer ${WIKIJS_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$body" 2>&1 || {
        echo "Error: Wiki.js query failed" >&2
        exit 1
    }
}

wiki_list() {
    local resp
    resp=$(wiki_graphql '{ pages { list(orderBy: UPDATED, limit: 20) { id title path updatedAt } } }')
    echo "$resp" | jq -r '.data.pages.list[] | "\(.updatedAt)\t\(.path)\t\(.title)"'
}

wiki_search() {
    local keyword="$1"
    # Use jq to safely escape the keyword into the GraphQL query
    local query
    query=$(jq -n --arg kw "$keyword" '{ pages: { search: { query: $kw } } }' | 
        jq -r '"{ pages { search(query: \"\(.pages.search.query)\") { results { id title path description } } } }"' |
        sed 's/"/\\"/g; s/^"//; s/"$//')
    # Simpler approach: escape double quotes in input
    local safe_keyword="${keyword//\"/\\\"}"
    query="{ pages { search(query: \"${safe_keyword}\") { results { id title path description } } } }"
    local resp
    resp=$(wiki_graphql "$query")
    echo "$resp" | jq -r '.data.pages.search.results[] | "\(.path)\t\(.title)\t\(.description // "")"'
}

wiki_read() {
    local doc_path="$1"
    local safe_path="${doc_path//\"/\\\"}"
    local query="{ pages { single(path: \"${safe_path}\") { title content } } }"
    local resp
    resp=$(wiki_graphql "$query")
    local title content
    title=$(echo "$resp" | jq -r '.data.pages.single.title // "Unknown"')
    content=$(echo "$resp" | jq -r '.data.pages.single.content // "Not found"')
    echo "# $title"
    echo ""
    echo "$content"
}

# --- Usage ---

usage() {
    cat >&2 <<'EOF'
Usage:
  arcflow-api workflow trigger <type> <issue_id> [target_repos...]
  arcflow-api workflow status <issue_id>
  arcflow-api rag query "question"
  arcflow-api wiki list
  arcflow-api wiki search "keyword"
  arcflow-api wiki read <path>

Workflow types: prd_to_tech, tech_to_openapi, code_gen, bug_analysis
Shorthand: code_gen_backend, code_gen_vue3, code_gen_flutter, code_gen_android
EOF
    exit 1
}

# --- Main ---

[[ $# -lt 1 ]] && usage

case "$1" in
    workflow)
        [[ $# -lt 3 ]] && usage
        case "$2" in
            trigger)
                [[ $# -lt 4 ]] && usage
                workflow_trigger "$3" "$4" "${@:5}"
                ;;
            status)
                workflow_status "$3"
                ;;
            *) usage ;;
        esac
        ;;
    rag)
        [[ $# -lt 3 || "$2" != "query" ]] && usage
        rag_query "$3"
        ;;
    wiki)
        [[ $# -lt 2 ]] && usage
        case "$2" in
            list)    wiki_list ;;
            search)  [[ $# -lt 3 ]] && usage; wiki_search "$3" ;;
            read)    [[ $# -lt 3 ]] && usage; wiki_read "$3" ;;
            *) usage ;;
        esac
        ;;
    *) usage ;;
esac
```

- [ ] **Step 3: 设置可执行权限**

```bash
chmod +x container/skills/arcflow-api/arcflow-api
```

- [ ] **Step 4: Commit**

```bash
git add container/skills/arcflow-api/
git commit -m "feat: add arcflow-api container skill for Gateway/Dify/Wiki.js"
```

---

## Task 6: 创建 ArcFlow 主 Group CLAUDE.md

**Files:**

- Create: `groups/arcflow-main/CLAUDE.md`

- [ ] **Step 1: 创建 `groups/arcflow-main/CLAUDE.md`**

```markdown
# NanoClaw AI 工作台 — ArcFlow 团队

## 你的角色

你是 ArcFlow 团队的 AI 工作台助手，团队成员通过飞书与你对话。
你可以帮助他们完成项目问答、任务管理、工作流触发和文档操作。
回复使用中文，简洁直接。

## 团队背景

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue3 + Element Plus / shadcn-vue + Pinia + Vue Router + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin Android（Jetpack Compose + 传统 XML）
- 接口规范：RESTful，统一返回 Result<T>

## 可用工具

### 1. Plane MCP — 任务管理

- 创建、查询、更新 Issue
- 查看看板状态、变更 Issue 状态
- Workspace 和 Project 已预配置，直接操作即可

### 2. arcflow-api — 工作流与知识库

```bash
# 触发工作流
arcflow-api workflow trigger prd_to_tech ISSUE-123
arcflow-api workflow trigger code_gen_backend ISSUE-123

# 查询执行状态
arcflow-api workflow status ISSUE-123

# 知识库问答（基于文档的 RAG 检索）
arcflow-api rag query "用户登录的接口定义在哪？"

# 文档操作
arcflow-api wiki list
arcflow-api wiki search "用户注册"
arcflow-api wiki read prd/user-registration
```

### 3. Git CLI — 仓库查询

- 查看 MR 状态、最近提交、分支列表
- 读取仓库中的文件内容
- 仅做查询，不执行写操作

### 4. 飞书文档 — 已内置

- 通过 feishu-docs 技能读取飞书文档、Wiki、表格、多维表格
- 消息收发由 NanoClaw FeishuChannel 自动处理

## 意图路由指引

| 用户意图 | 优先使用的工具 | 示例 |
|----------|--------------|------|
| 问项目/技术/文档相关问题 | arcflow-api rag query | "用户登录的接口定义在哪？" |
| 创建/查询/更新任务 | Plane MCP | "创建一个用户注册的 Issue" |
| 触发代码生成或文档生成 | arcflow-api workflow trigger | "ISSUE-123 审批通过了，开始生成技术文档" |
| 查询工作流执行状态 | arcflow-api workflow status | "ISSUE-123 的代码生成到哪一步了？" |
| 查找 docs 仓库中的文档 | arcflow-api wiki | "帮我查一下用户登录的 PRD" |
| 查看飞书上的文档/表格 | feishu-docs | "看一下飞书上的项目周报" |
| 查看 MR 或代码 | Git CLI | "后端仓库最近的 MR 有哪些？" |

## 操作约束

- 不直接修改代码仓库中的文件，代码修改通过工作流触发 Claude Code headless 完成
- 不直接修改 /prd 目录下的文件
- 触发工作流前先向用户确认（"确认要为 ISSUE-123 触发代码生成吗？"）
- 如果用户的问题超出工具能力范围，告知用户去对应的 Web UI 操作

```

- [ ] **Step 2: Commit**

```bash
git add groups/arcflow-main/
git commit -m "feat: add ArcFlow main group CLAUDE.md"
```

---

## Task 7: 配置 Plane MCP 和环境变量

**Files:**

- Modify: `.mcp.json`
- Modify: `.env.example`

- [ ] **Step 1: 修改 `.mcp.json`**

读取现有 `.mcp.json`，在 `mcpServers` 对象中添加 `plane` 配置：

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

注意：保留 `.mcp.json` 中已有的其他 MCP server 配置。

- [ ] **Step 2: 修改 `.env.example`**

在文件末尾追加 ArcFlow 相关环境变量：

```env
# --- ArcFlow ---

# Feishu (飞书)
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_WEBHOOK_PORT=3000

# Plane MCP
PLANE_API_TOKEN=
PLANE_BASE_URL=
PLANE_WORKSPACE_SLUG=

# ArcFlow Gateway
GATEWAY_URL=

# Dify RAG
DIFY_URL=
DIFY_API_KEY=

# Wiki.js
WIKIJS_URL=
WIKIJS_API_KEY=

# Git 仓库（容器内只读克隆，按需添加）
DOCS_GIT_REPO=
BACKEND_GIT_REPO=
```

- [ ] **Step 3: Commit**

```bash
git add .mcp.json .env.example
git commit -m "feat: add Plane MCP config and ArcFlow env vars"
```

---

## Task 8: 补丁 container-runner.ts — 透传 ArcFlow 环境变量

**Files:**

- Modify: `src/container-runner.ts`

- [ ] **Step 1: 在 Task 4 已添加的飞书凭证透传代码之后，继续添加 ArcFlow 环境变量透传**

```typescript
  // Pass ArcFlow service credentials
  const arcflowEnvVars = readEnvFile([
    'GATEWAY_URL',
    'DIFY_URL', 'DIFY_API_KEY',
    'WIKIJS_URL', 'WIKIJS_API_KEY',
  ]);
  for (const [key, value] of Object.entries(arcflowEnvVars)) {
    args.push('-e', `${key}=${value}`);
  }
```

注意：Plane MCP 凭证（`PLANE_API_TOKEN` 等）是否需要透传取决于 NanoClaw 容器机制是否自动注入 `.mcp.json` 中的 `${...}` 变量。在 Task 1 验证阶段检查 `container-runner.ts` 和 `container/agent-runner` 中的环境变量处理逻辑。如果容器不自动继承宿主环境，则需要在此处额外透传 `PLANE_API_TOKEN`、`PLANE_BASE_URL`、`PLANE_WORKSPACE_SLUG`。

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 3: 运行测试**

```bash
npm test
```

Expected: 所有测试通过（container-runner 的测试应该 mock 了文件读取）

- [ ] **Step 4: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat: pass ArcFlow service credentials to agent containers"
```

---

## Task 9: ArcFlow 仓库 — 创建分支 + 部署说明文档

**Files:**

- Create: `/Users/chenqi/code/ArcFlow/setup/nanoclaw/README.md`

回到 ArcFlow 仓库操作。按照项目规范（所有改动走分支 + PR），先创建分支。

- [ ] **Step 1: 创建功能分支**

```bash
cd /Users/chenqi/code/ArcFlow
git checkout -b feat/nanoclaw-setup-docs
```

- [ ] **Step 2: 创建 `setup/nanoclaw/README.md`**

```markdown
# NanoClaw 部署说明

ArcFlow 的 AI 工作台，基于 [NanoClaw](https://github.com/qwibitai/nanoclaw) 定制。

## 仓库

- 源码：https://github.com/ssyamv/nanoclaw
- 上游：https://github.com/qwibitai/nanoclaw

## 部署步骤

### 1. 克隆并安装

```bash
ssh arcflow-server
cd /data/project
git clone https://github.com/ssyamv/nanoclaw.git
cd nanoclaw
npm install
npm run build
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入以下配置：
# - FEISHU_APP_ID / FEISHU_APP_SECRET（飞书开放平台获取）
# - FEISHU_WEBHOOK_PORT（默认 3000，如与 Wiki.js 同机部署需改为 3002）
# - PLANE_API_TOKEN / PLANE_BASE_URL / PLANE_WORKSPACE_SLUG
# - GATEWAY_URL（胶水服务地址，如 http://172.29.230.21:8080）
# - DIFY_URL / DIFY_API_KEY
# - WIKIJS_URL / WIKIJS_API_KEY
```

### 3. 构建容器镜像

```bash
./container/build.sh
```

### 4. 启动服务

```bash
# Linux (systemd)
# 创建 service 文件或使用 pm2
npm run start

# 或使用 systemd
# sudo cp nanoclaw.service /etc/systemd/system/
# sudo systemctl enable nanoclaw
# sudo systemctl start nanoclaw
```

### 5. 配置飞书 Webhook

1. 进入飞书开放平台 → 应用 → 事件订阅
2. 设置请求 URL：`http://<服务器IP>:<FEISHU_WEBHOOK_PORT>/webhook/event`
3. 订阅事件：`im.message.receive_v1`

### 6. 注册飞书群组

查看 NanoClaw 日志获取 chat_jid，然后注册：

```bash
# 主群（所有消息都响应）
npx tsx setup/index.ts --step register -- \
  --jid "feishu:<chat-id>" \
  --name "ArcFlow-Main" \
  --folder "arcflow-main" \
  --trigger "@Andy" \
  --channel feishu \
  --no-trigger-required \
  --is-main
```

### 7. 验证

在飞书中发送消息给机器人，检查是否收到回复。

## 更新

从上游同步更新：

```bash
claude
# 在 Claude Code 中执行 /update-nanoclaw
```

## 相关文档

- 设计规格：`docs/superpowers/specs/2026-04-07-nanoclaw-setup-design.md`
- 意图路由设计：`docs/superpowers/specs/2026-04-02-nanoclaw-routing-design.md`

```

- [ ] **Step 2: Commit**

```bash
cd /Users/chenqi/code/ArcFlow
git add setup/nanoclaw/README.md
git commit -m "docs: add NanoClaw deployment guide"
```

---

## Task 10: ArcFlow 仓库 — 更新 CLAUDE.md 和提交 PR

**Files:**

- Modify: `/Users/chenqi/code/ArcFlow/CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md 组件清单**

在"组件清单"相关表格中，找到 `AI 工作台` 行（如没有则在合适位置添加），确认包含：

```text
| AI 工作台 | NanoClaw（ssyamv/nanoclaw，独立仓库） |
```

- [ ] **Step 2: 更新仓库结构**

在仓库结构说明中，`setup/` 目录描述更新为：

```text
- `setup/` — 第三方服务部署配置（Wiki.js / Plane / Dify / NanoClaw）
```

- [ ] **Step 3: 更新设计规格文档索引表**

在设计规格文档索引表中添加新文档：

```text
| `2026-04-07-nanoclaw-setup-design.md` | NanoClaw ArcFlow 接入设计（Fork 策略 / 工具配置 / 部署） |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-07-nanoclaw-setup-design.md docs/superpowers/plans/2026-04-07-nanoclaw-setup.md
git commit -m "docs: update CLAUDE.md with NanoClaw component and spec index"
```

- [ ] **Step 5: 推送分支并提交 PR**

```bash
git push -u origin feat/nanoclaw-setup-docs
gh pr create --title "docs: NanoClaw ArcFlow 接入设计 + 部署说明" --body "..."
```

---

## Task 11: 更新 GitHub Issue #34

- [ ] **Step 1: 添加进展 comment**

```bash
gh issue comment 34 --repo ssyamv/ArcFlow --body "..."
```

内容包括：

- 已完成：NanoClaw Fork + 飞书 Channel + arcflow-api 工具 + Plane MCP + group 配置 + 部署说明
- 待完成（需公司网络）：配置 .env → 部署到服务器 → 配置飞书 Webhook → 注册群组 → 端到端测试

- [ ] **Step 2: 更新 Issue body 中的 checklist**

勾选已完成的任务项：

- [x] NanoClaw 基础框架（Claude Agent SDK）
- [x] 飞书机器人接入
- [x] 意图路由（查询进度/触发工作流/知识库问答）
- [x] 工具集成（Plane MCP / Gateway REST / Dify RAG）
