> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# NanoClaw ArcFlow 接入设计规格文档

> 版本：v1.0 - 2026-04-07

---

## 一、概述

基于开源项目 [NanoClaw](https://github.com/qwibitai/nanoclaw) 搭建 ArcFlow 团队的 AI 工作台，接入飞书渠道，支持项目问答、任务管理、工作流触发和文档操作。

### 关键决策

| 决策 | 选择 | 原因 |
|------|------|------|
| NanoClaw 位置 | 独立仓库 ssyamv/nanoclaw | Fork 后定制，方便从上游同步更新（自带 /update-nanoclaw skill） |
| 飞书接入方式 | add-feishu skill（Webhook 模式） | 已有完整实现，支持讯飞版飞书 |
| REST API 工具 | bash 脚本（arcflow-api） | 接口少（6 个端点），与 NanoClaw feishu-docs 风格一致 |
| Plane 接入方式 | MCP Server | 操作丰富（CRUD Issue、看板、状态流转），MCP 原生支持更合适 |
| ArcFlow 仓库职责 | 仅放部署说明和配置引用 | 代码在独立仓库，ArcFlow 仓库保持简洁 |

---

## 二、仓库结构

### ssyamv/nanoclaw（Fork 自 qwibitai/nanoclaw）

```text
ssyamv/nanoclaw/
├── src/channels/feishu.ts          # add-feishu skill 生成
├── src/channels/index.ts           # 加入 feishu import
├── container/skills/feishu-docs/   # 飞书文档读取工具（add-feishu skill 生成）
├── container/skills/arcflow-api/   # ArcFlow 胶水服务 + Dify RAG + Wiki.js 工具
│   ├── SKILL.md                    # 工具使用说明
│   └── arcflow-api                 # bash 可执行脚本
├── groups/arcflow-main/            # ArcFlow 主 group
│   └── CLAUDE.md                   # ArcFlow 专属上下文
├── .mcp.json                       # 加入 Plane MCP 配置
├── .env.example                    # 加入 ArcFlow 相关环境变量
└── ...（NanoClaw 原有文件）
```

### ArcFlow 仓库（本仓库）

```text
setup/nanoclaw/
└── README.md                       # NanoClaw 部署说明
```

---

## 三、ArcFlow Container Skills

### 3.1 arcflow-api 工具

`container/skills/arcflow-api/SKILL.md` 定义工具的触发场景和命令格式：

| 命令 | 用途 |
|------|------|
| `arcflow-api workflow trigger <type> <issue_id>` | 触发工作流 |
| `arcflow-api workflow status <issue_id>` | 查询执行记录 |
| `arcflow-api rag query "问题"` | 知识库问答 |
| `arcflow-api wiki list` | 查询文档列表 |
| `arcflow-api wiki search "关键词"` | 搜索文档 |
| `arcflow-api wiki read <path>` | 读取文档详情 |

支持的 workflow_type 枚举值（与 Gateway `WorkflowType` 对齐）：

| 值 | 说明 |
|----|------|
| `prd_to_tech` | PRD 生成技术设计文档 |
| `tech_to_openapi` | 技术文档生成 OpenAPI yaml |
| `code_gen` | 代码生成（通过 target_repos 参数区分目标端） |
| `bug_analysis` | CI/CD 失败日志分析 |

**命令行语法糖**：arcflow-api 脚本支持 `code_gen_backend`、`code_gen_vue3`、`code_gen_flutter`、`code_gen_android` 作为 trigger 子命令的快捷方式，内部自动映射为 `{"workflow_type": "code_gen", "params": {"target_repos": ["backend"]}}` 等。这样命令行语义友好，同时与 Gateway API 保持一致。

`container/skills/arcflow-api/arcflow-api` 是 bash 可执行脚本：

- 通过环境变量获取连接信息（`$GATEWAY_URL`、`$DIFY_URL`、`$DIFY_API_KEY`、`$WIKIJS_URL`、`$WIKIJS_API_KEY`）
- 内部使用 curl 调用 REST/GraphQL API
- 解析 JSON 输出为可读格式

---

## 四、ArcFlow Group CLAUDE.md

`groups/arcflow-main/CLAUDE.md` 内容基于 `2026-04-02-nanoclaw-routing-design.md` 中的设计，做以下调整：

### 保留的核心内容

- 角色定义：ArcFlow 团队 AI 工作台助手
- 团队技术栈背景
- 6 类工具的使用指引（Plane MCP、胶水服务、Dify RAG、Wiki.js、Git、飞书文档）
- 意图路由表（用户意图 → 工具映射）
- 操作约束（不直接改代码、不改 PRD、触发前确认）

### 调整项

1. 工具调用方式从 curl 改为 `arcflow-api` 命令 — 更简洁，容器内直接可用
2. 去掉环境变量细节 — arcflow-api 脚本内部处理
3. 补充 Plane MCP 的 workspace/project 默认值

---

## 五、MCP 与环境变量配置

### .mcp.json

在 NanoClaw 原有配置基础上加入 Plane MCP：

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

### .env.example

```env
# Feishu（add-feishu skill 生成）
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_WEBHOOK_PORT=3000

# Plane MCP
PLANE_API_TOKEN=
PLANE_BASE_URL=http://172.29.230.21:80
PLANE_WORKSPACE_SLUG=

# ArcFlow Gateway
GATEWAY_URL=http://172.29.230.21:8080

# Dify RAG
DIFY_URL=http://172.29.230.21:3001
DIFY_API_KEY=

# Wiki.js
WIKIJS_URL=http://172.29.230.21:3000
WIKIJS_API_KEY=

# Git 仓库（容器内只读克隆，按需添加更多仓库）
DOCS_GIT_REPO=
BACKEND_GIT_REPO=
# 后续可扩展：VUE3_GIT_REPO=, FLUTTER_GIT_REPO=, ANDROID_GIT_REPO=
```

> **端口说明**：`FEISHU_WEBHOOK_PORT=3000` 是 NanoClaw 容器/进程内的端口，`WIKIJS_URL` 的 3000 端口是宿主机上 Wiki.js 的端口，两者运行在不同机器上，不冲突。如果 NanoClaw 部署在 Wiki.js 同一台服务器上，需要修改 `FEISHU_WEBHOOK_PORT` 为其他端口（如 3002）。

### container-runner.ts 补丁

除 add-feishu 已有的飞书凭证透传外，还需透传以下环境变量到容器：

- `GATEWAY_URL`
- `DIFY_URL`、`DIFY_API_KEY`
- `WIKIJS_URL`、`WIKIJS_API_KEY`
- `PLANE_API_TOKEN`、`PLANE_BASE_URL`、`PLANE_WORKSPACE_SLUG`

---

## 六、ArcFlow 仓库文档更新

| 文件 | 操作 | 内容 |
|------|------|------|
| `setup/nanoclaw/README.md` | 新增 | 部署说明（clone → install → 配 .env → build → systemd → 飞书 webhook） |
| `CLAUDE.md` | 更新 | 组件清单加入 NanoClaw，仓库结构加入 setup/nanoclaw/ |
| Issue #34 | 更新 | 进展 comment，标记完成的任务项 |

---

## 七、与现有设计文档的关系

本文档是 `2026-04-02-nanoclaw-routing-design.md` 的实施补充：

- 原设计文档定义了 NanoClaw 的意图路由、工具接入方案、CLAUDE.md 内容、权限安全等，仍然有效
- 本文档补充了 Fork 策略、仓库结构、arcflow-api 封装、部署配置等实施细节
- 两份文档互补，原文档侧重"做什么"，本文档侧重"怎么做"
