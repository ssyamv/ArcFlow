# ArcFlow

**AI 研发运营一体化平台**，以 `Markdown + Git` 为文档底座，以 `Gateway + NanoClaw` 为编排中枢，串联需求、文档、任务、AI 对话与后续代码生成流程。

[![CI](https://github.com/ssyamv/ArcFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/ssyamv/ArcFlow/actions/workflows/ci.yml)
[![Security](https://github.com/ssyamv/ArcFlow/actions/workflows/security.yml/badge.svg)](https://github.com/ssyamv/ArcFlow/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 当前有效说明

- 以本文件和 [docs/AI研发运营一体化平台_技术架构方案.md](docs/AI研发运营一体化平台_技术架构方案.md) 作为当前架构与开发状态的权威说明。
- `docs/superpowers/specs/`、`plans/`、`reports/` 中保留了完整演进记录，但其中一部分属于历史方案。请先查看 [docs/documentation-status.md](docs/documentation-status.md) 了解哪些文档是当前参考、哪些仅供历史追溯。
- 当前说明已对齐到 `2026-04-17` 仓库状态：Phase 3.5 本仓闭环与 CI bug 回流闭环均已有对应验证记录。

## 项目目标

| 目标 | 说明 |
|------|------|
| 流程标准化 | PRD → 技术设计 → OpenAPI → 代码生成 / 修复，尽量减少人工传递损耗 |
| AI 驱动研发 | 通过 NanoClaw skill、Claude API、Claude Code 串起文档生成、问答、分析与代码执行 |
| 知识管理 | 所有核心文档统一落在 Git 仓库，ArcFlow Web 提供文档管理，Gateway 提供 sqlite-vec RAG |
| 人机协同 | AI 负责生成与执行，Plane / 飞书负责协作、通知、审批与人工把关 |

## 当前架构

当前生产与开发主线不再依赖 `Wiki.js / Dify / Weaviate`。当前实际架构是：

```text
ArcFlow Web
  ├─ 登录 / 工作空间 / 对话 / 文档 / 工作流视图
  └─ 通过 REST 调 Gateway

Gateway (Bun + Hono + SQLite/sqlite-vec)
  ├─ 认证与工作空间隔离
  ├─ docs Git 读写
  ├─ Plane / 飞书 / iBuild / Git webhook 接入
  ├─ NanoClaw dispatch / callback
  ├─ workflow_execution / conversations / dispatch 等业务状态存储
  └─ RAG 索引与检索

NanoClaw
  ├─ Web / 飞书 AI 会话入口
  ├─ skill 执行与工具编排
  └─ 调用 Claude API / Claude Code，并通过 Gateway 落库或写回业务系统

协作与数据层
  ├─ Plane CE：任务和状态流转
  ├─ 飞书：通知、审批链接、OAuth
  ├─ docs Git + 代码仓库：文档与代码底座
  └─ SQLite / sqlite-vec：执行状态、对话、RAG
```

## 当前主链路

已落地并作为当前主线推进的链路：

1. Web 或 NanoClaw 发起需求对话 / 草稿生成
2. ArcFlow 将内容落为 PRD，并与 Plane Issue 建立关联
3. Plane 审批或状态流转后，Gateway 触发 NanoClaw skill
4. NanoClaw 生成技术设计文档、OpenAPI 或分析结果，并通过 Gateway 回写 docs / Plane / 飞书
5. 后续进入代码生成、Code Review、CI / Bug 回流闭环

其中“需求 → PRD → 技术设计 → OpenAPI”的前半段已完成真实环境联调验证，详见 [docs/superpowers/reports/2026-04-13-e2e-verification-report.md](docs/superpowers/reports/2026-04-13-e2e-verification-report.md)。

## 仓库结构

```text
ArcFlow/
├── packages/
│   ├── gateway/                    # Gateway 胶水服务（Bun + Hono + SQLite/sqlite-vec）
│   └── web/                        # Web 管理界面（Vue 3 + Tailwind CSS 4 + Pinia + Tiptap）
├── docs/
│   ├── AI研发运营一体化平台_技术架构方案.md
│   ├── documentation-status.md
│   └── superpowers/                # 历史设计、实施计划、联调记录
├── setup/
│   ├── docs-repo/                  # docs 仓库脚手架与 CLAUDE.md 模板
│   ├── gateway/                    # Gateway 环境变量示例
│   ├── nanoclaw/                   # NanoClaw 部署说明
│   └── plane/                      # Plane 部署与 webhook 配置
├── docker-compose.yml              # 当前仓库内主服务编排（web + gateway）
└── package.json
```

## 当前开发进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | docs 仓库、CLAUDE.md、基础规格文档 | 已完成 |
| Phase 1.5-2.5 | Gateway 核心框架、Web 管理界面、文档系统、多工作空间、RAG、CI/CD | 已完成 |
| Phase 3.0 | ArcFlow ↔ Plane 集成 | 已完成 |
| Phase 3.1 | 需求草稿 → PRD → 飞书 Review → Plane 原子写入 | 已完成 |
| Phase 3.2 | Web AiChat 切 NanoClaw、鉴权透传、memory snapshot | 已完成 |
| Phase 3.3 | NanoClaw 上线与生产环境对齐 | 已完成 |
| Phase 3.4 | `arcflow-api` 交互链路：ArcFlow 侧 Gateway 契约与 Web artifact 渲染 | 已完成 |
| Phase 3.4b | `arcflow-api` skill 包在 NanoClaw 独立仓内的发布、接线与验收 | 独立仓持续跟进；本仓配套已完成 |
| Phase 3.5 | 端到端全链路联调：PRD → 技术设计 → OpenAPI → 代码生成 → CI | 本仓已闭环，见 `2026-04-16` 验证报告 |
| Phase 3.6 | CI 失败 → `bug_analysis` → `analysis_ready/failed` 回流闭环 | 本仓已闭环，见 `2026-04-17` 验证报告 |
| Phase 4 | 稳定性、可观测性与生产验证 | 进行中 |

## 当前已实现能力

### Web

- 飞书 OAuth 登录
- 多工作空间切换
- Dashboard 与工作流执行视图
- NanoClaw SSE 对话界面
- 文档树、富文本编辑、自动保存、全文搜索

### Gateway

- `auth / workspaces / conversations / docs / plane / arcflow-tools / rag / workflow-callback` 路由
- Plane / Git / 飞书 / iBuild / CI webhook 接入
- SQLite 业务存储与 sqlite-vec RAG
- NanoClaw dispatch 记账与 callback 回写
- `arcflow-tools` 已提供 `issues` 与 `requirements/drafts` 交互端点

### 协作链路

- Plane 项目与状态流转
- docs Git 仓库读写
- 飞书通知与审批链接
- GitHub Actions CI / 安全检查
- CI 失败后的 `bug_analysis` 派生、回写与详情展示
- Workflow Detail 中的 dispatch 状态、回调摘要与下一步动作提示

### 最近里程碑

- `d9b1fd3 feat(arcflow): add gateway tools and chat artifact rendering`
  - ArcFlow 侧 `arcflow-api` 交互配套落地：`/api/arcflow/issues`、`/api/arcflow/requirements/drafts`
  - Web AiChat 支持 `arcflow_card / arcflow_status` 结构化 artifact 渲染
- `1cc3cee feat: close phase 3.5 codegen and ci workflow loop (#120) (#124)`
  - `code_gen` 列表摘要、详情页 subtasks / links、`/webhook/cicd` 与 `/webhook/ibuild` 统一回写已闭环
- `ce543ef feat: close ci bug analysis backflow loop`
  - `ci_failed` 派生 `bug_analysis`、回调 `analysis_ready / analysis_failed` 与前端摘要展示已闭环

## 运行方式

### 本仓库服务

```bash
bun install
docker compose up -d
```

默认包含：

- `web`
- `gateway`

### 外部依赖

当前项目依赖但不由根 `docker-compose.yml` 统一托管的服务：

- `Plane CE`
- `NanoClaw`（当前通过 PM2 在独立仓库运行）
- 代码仓库 / docs 仓库
- 飞书应用配置

对应说明见：

- [setup/plane](setup/plane)
- [setup/nanoclaw/README.md](setup/nanoclaw/README.md)
- [setup/docs-repo/README.md](setup/docs-repo/README.md)

关键验证记录：

- [docs/superpowers/reports/2026-04-16-phase-3-5-verification.md](docs/superpowers/reports/2026-04-16-phase-3-5-verification.md)
- [docs/superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md](docs/superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md)
- [docs/superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md](docs/superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md)
- [docs/superpowers/reports/2026-04-17-deployment-alignment-and-nanoclaw-stability-verification.md](docs/superpowers/reports/2026-04-17-deployment-alignment-and-nanoclaw-stability-verification.md)

## 历史说明

- `Wiki.js / Dify / Weaviate` 相关方案和计划已转为历史资料，不再代表当前主线。
- 历史文档仍然保留，用于追溯架构演进、排查历史决策和联调背景。
- 阅读历史文档前，建议先看 [docs/documentation-status.md](docs/documentation-status.md)。
