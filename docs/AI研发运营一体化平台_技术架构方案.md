# AI 研发运营一体化平台 — 当前技术架构方案

> 版本：v2.0
> 日期：2026-04-17
> 说明：本文件描述 ArcFlow 当前真实落地架构与阶段状态，替代早期 `Wiki.js + Dify + Weaviate` 方案作为当前参考。

---

## 一、文档定位

本文件用于回答两个问题：

1. ArcFlow 当前到底是怎么搭起来的
2. 项目现在开发到了哪一步

如果历史设计文档与本文件冲突，以本文件和仓库根目录 [README.md](../README.md) 为准。

---

## 二、当前目标

ArcFlow 当前不是在做“泛化的企业知识平台”，而是在做一条面向研发协作的 AI 主链路：

```text
需求输入
  → PRD 沉淀
  → Plane 审批 / 状态流转
  → 技术设计文档
  → OpenAPI
  → 代码生成 / Bug 分析
  → CI / Review / 交付
```

当前阶段重点是把：

- `ArcFlow Web`
- `Gateway`
- `NanoClaw`
- `Plane`
- `docs Git`
- `飞书`

这几部分收敛成一个可重复运行、可联调、可扩展的闭环。

---

## 三、当前实际架构

### 3.1 分层

当前实际架构分为五层：

| 层 | 当前实现 | 职责 |
|---|---|---|
| 交互层 | ArcFlow Web、NanoClaw（Web / 飞书） | 用户登录、对话、文档管理、工作流查看、AI 会话入口 |
| 编排层 | NanoClaw + Claude API + Claude Code | 负责 skill 执行、模型调用、代码生成、分析与多步动作协调 |
| 业务中枢 | Gateway | 统一承接认证、工作空间隔离、Git 读写、Webhook、dispatch、callback、RAG |
| 协作层 | Plane CE、飞书、Git 仓库、iBuild、GitHub Actions | 任务协作、审批通知、代码与文档存储、构建和 CI 回流 |
| 数据层 | SQLite + sqlite-vec | 保存执行记录、对话、工作空间、dispatch、RAG 索引 |

### 3.2 关键结论

当前主线已经不再依赖：

- `Wiki.js`
- `Dify`
- `Weaviate`

这些组件在项目早期方案里出现过，但现在属于历史架构，不是当前生产和开发主线。

---

## 四、核心组件说明

### 4.1 ArcFlow Web

Web 位于 [`packages/web`](../packages/web)，当前已经是系统的主要人工操作界面，包含：

- 飞书 OAuth 登录
- 多工作空间切换
- Dashboard 与工作流执行记录
- NanoClaw 对话页
- 文档管理页
- 工作空间设置与个人信息

文档管理不是 Wiki 外挂，而是 ArcFlow 自己的 Git-backed 文档界面：前端编辑，Gateway 落 Git，文档仓库作为真实数据源。

### 4.2 Gateway

Gateway 位于 [`packages/gateway`](../packages/gateway)，是当前系统最核心的业务中枢。

它负责：

- 用户认证与 JWT 校验
- 工作空间权限隔离
- docs Git 仓库读写
- Plane / 飞书 / Git / iBuild webhook 接入
- 工作流执行记录与查询
- NanoClaw dispatch / callback
- RAG 索引与检索

目前代码里已经挂载的核心路由包括：

- `/auth`
- `/api/workspaces`
- `/api/conversations`
- `/api/docs`
- `/api/plane`
- `/api/arcflow`
- `/api/rag`
- `/api/workflow/callback`

### 4.3 NanoClaw

NanoClaw 是当前 AI 编排与技能执行层，定位不是“又一个聊天工具”，而是：

- AI 会话入口
- skill 调用与工具编排器
- Claude API / Claude Code 的承载层
- 与 Gateway 的 dispatch / callback 协同执行器

当前方向是把 ArcFlow 专用能力逐步 skill 化，例如：

- requirement / PRD 草稿
- PRD → 技术设计
- 技术设计 → OpenAPI
- Bug 分析
- docs / Plane / workspace 查询与操作

### 4.4 Plane

Plane 当前承担任务协作与状态流转职责：

- 产品 / 研发 issue 管理
- Approved 等状态驱动后续工作流
- ArcFlow Web 中的项目概览与 issue 汇总展示

### 4.5 docs Git

docs 仓库是文档真实底座，不再依赖 Wiki 同步层。

当前原则：

- 文档以 Markdown 存储
- 路径规范化
- Git 作为唯一可信版本源
- ArcFlow Web 作为默认文档编辑界面
- Gateway 负责读取、搜索、写入、重命名、删除与提交

### 4.6 SQLite / sqlite-vec

当前 Gateway 内部已经承担轻量数据底座职责：

- `workflow_execution`
- `users`
- `workspaces`
- `workspace_members`
- `conversations`
- `messages`
- `dispatch`
- `rag_docs`
- `rag_chunk_meta`

这意味着 ArcFlow 现在已经具备：

- 业务状态落库
- 对话持久化
- 工作空间隔离
- 轻量 RAG 检索

---

## 五、当前数据流

### 5.1 已验证主链路

当前已经在本仓和联调环境中完成验证的链路是：

```text
Web 对话 / 需求草稿
  → finalize
  → 飞书 Review
  → Plane Issue + PRD Git 原子写入
  → Plane webhook
  → 技术设计文档
  → OpenAPI
  → code_gen
  → CI webhook 回写
```

对应验证与收口记录：

- [superpowers/reports/2026-04-13-e2e-verification-report.md](superpowers/reports/2026-04-13-e2e-verification-report.md)
- [superpowers/reports/2026-04-16-phase-3-5-verification.md](superpowers/reports/2026-04-16-phase-3-5-verification.md)

### 5.2 新近闭环能力

`2026-04-17` 前后补齐的闭环包括：

```text
CI 失败
  → bug_analysis dispatch
  → Gateway callback 持久化 analysis_ready / analysis_failed
  → Workflow Detail 显示 bug_report_summary 与下一步动作
```

对应验证记录：

- [superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md](superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md)
- [superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md](superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md)

当前成熟度可以概括为：

- 前半段文档与任务链路已经成型并完成真实环境联调
- `tech_to_openapi -> code_gen -> CI -> bug_analysis` 的仓内闭环已经跑通
- 当前重点已转向生产环境稳定性、部署对齐和跨仓库协作收口

---

## 六、当前开发状态

### 6.1 已完成

截至 `2026-04-17`，当前已完成的核心建设包括：

- docs 仓库与 CLAUDE.md 规范
- Gateway 核心框架与测试基础
- Web 管理界面
- 飞书 OAuth 登录
- 多工作空间模型
- 文档管理页面
- Plane 集成
- requirement draft / PRD 流程重构
- Web AiChat 切换到 NanoClaw
- 鉴权透传与 memory snapshot
- RAG 基础设施迁移到 Gateway sqlite-vec
- 生产环境与部署拓扑梳理
- Phase 3.5 代码生成与 CI 回写闭环
- CI bug analysis 回流闭环
- Workflow callback / dispatch 可观测性补强

### 6.2 进行中

当前重点任务：

- NanoClaw 独立仓内 `arcflow-api` skill 包发布与接线确认
- NanoClaw 与 Gateway 的跨仓契约维护
- 生产环境稳定性修复、部署对齐与运维口径统一
- 团队使用流程与操作规范沉淀

### 6.3 待完成

后续阶段重点：

- 自动修复链路进一步稳定化
- 更多生产场景重复验证
- 团队推广与操作规范沉淀

### 6.4 今日进展补充

最近对当前主线判断影响最大的进展是：

- Gateway 新增 `/api/arcflow/issues`
- Gateway 新增 `/api/arcflow/requirements/drafts`
- Web AiChat 新增结构化 artifact 卡片渲染
- `code_gen` 摘要、详情页 subtasks / links、CI webhook 回写完成闭环
- `bug_analysis` 派生、回调摘要和前端展示完成闭环

因此更准确的状态是：

- **ArcFlow 仓内主链路已完成到 CI / bug_analysis 回流这一层**
- **NanoClaw 独立仓内 skill 包发布与生产编排仍需按独立仓状态跟进**
- **NanoClaw 仓内 skill 包本体是否已同步发布，需要结合外部仓库继续确认**

---

## 七、技术选型

| 模块 | 当前技术 |
|---|---|
| Web | Vue 3 + Vite + Pinia + Tailwind CSS 4 + Tiptap |
| Gateway | Bun + Hono + bun:sqlite |
| RAG | sqlite-vec + embedding 客户端 |
| AI 编排 | NanoClaw |
| 模型 | Claude Opus / Sonnet + Claude Code |
| 文档底座 | Markdown + Git |
| 协作 | Plane CE + 飞书 |
| CI / 构建 | GitHub Actions + iBuild |

---

## 八、部署现状

当前部署拓扑以实际运行为准：

- 本仓库主要部署 `web + gateway`
- `Plane` 为独立服务栈
- `NanoClaw` 在独立仓库运行，并通过 PM2 管理
- docs / 代码仓库独立托管

因此，ArcFlow 当前并不是“一套大而全 Docker Compose 把所有组件都拉起来”的结构，而是：

- ArcFlow 仓库负责自身主服务
- 其他外部协作系统按各自部署方式维护
- Gateway 作为统一接入层连接这些外部系统

---

## 九、历史架构说明

项目在早期阶段存在过以下方案：

- `Wiki.js` 作为文档 UI
- `Dify` 作为工作流编排
- `Weaviate` 作为向量数据库

这些方案对理解项目演进仍然有价值，但已经不代表当前实际架构。

阅读历史设计前，请先查看：

- [documentation-status.md](documentation-status.md)

---

## 十、结论

ArcFlow 当前已经完成了“平台骨架 + 前半段业务闭环”的建设：

- 已有可用的 Web 管理界面
- 已有工作空间、文档、对话、任务和执行记录模型
- 已经打通需求到文档的真实链路
- 已经完成从早期 Dify / Wiki.js 方案向 NanoClaw + Gateway 主线的收口

接下来的核心工作，不是再发散新系统，而是把当前主链路做深、做稳、做成可重复执行的工程能力。
