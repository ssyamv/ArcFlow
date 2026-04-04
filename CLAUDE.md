# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ArcFlow 是一个 AI 研发运营一体化平台，以 Markdown + Git 为数据底座、AI 为执行引擎，串联从 PRD 到代码生成的全流程。目前已完成胶水服务核心框架和 Web 管理界面，处于服务联调前阶段。

## 技术栈

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue 3 + Tailwind CSS + Pinia + Vue Router + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin Android（Jetpack Compose + 传统 XML）
- 胶水服务：Bun + Hono + bun:sqlite
- AI 编排：Dify（工作流编排 + RAG）
- 文档知识库：Wiki.js 2.x（底层 Git 同步 .md 文件）
- 任务管理：Plane CE（原生 MCP）
- 向量数据库：Weaviate
- AI 工作台：NanoClaw（飞书渠道已接入，微信待后续）
- 接口规范：RESTful，统一返回 Result<T>

## 架构分层

六层架构，从上到下：

1. **交互层** — NanoClaw（飞书 AI 工作台，基于 Claude Agent SDK）
2. **通知层** — 飞书（状态推送，消息卡片含审批按钮）
3. **编排层** — Dify（Prompt 链、RAG 检索、模型调用）
4. **衔接层** — 胶水服务（Webhook 路由、Git 读写、Claude Code 调度、飞书通知）
5. **协作层** — Wiki.js + Plane
6. **数据层** — docs Git + 代码仓库 + Weaviate

Dify 负责 AI 工作流编排，胶水服务负责系统间数据搬运，两者职责分离。

## 核心数据流

```text
PM 写 PRD (Wiki.js) → docs Git → Plane Issue Approved
→ 胶水服务 → Dify 工作流（Claude Opus 生成技术文档 → Claude Sonnet 生成 OpenAPI）
→ 写回 Git + Wiki.js → 飞书消息卡片通知研发 Review（含通过/打回按钮）
→ 通过后进入两轮代码生成：
  第一轮：后端代码生成 → 研发 Review MR → 合并
  第二轮：设计师出 Figma 设计稿 → Claude Code 通过 Figma MCP 生成 UI 代码 → 研发 Review / 微调
→ CI/CD 测试 → 失败自动分析 + Bug 修复（最多 2 次）→ 通过则交付归档
```

## 仓库结构

当前仓库为 monorepo，包含：

- `packages/gateway/` — 胶水服务（Bun + Hono + SQLite），62 个测试
- `packages/web/` — Web 管理界面（Vue 3 + Tailwind CSS）
- `docs/` — 技术架构方案文档和设计规格文档
- `docs/superpowers/specs/` — 详细设计规格文档（见下方索引）
- `docs/superpowers/plans/` — 实施计划文档
- `setup/` — 第三方服务部署配置（Wiki.js / Plane / Dify）

docs 仓库（规划中）的目录规范：

- `prd/` — PRD 产品需求文档（PM 写，AI 不可修改）
- `tech-design/` — 技术设计文档（AI 生成，研发 Review）
- `api/` — OpenAPI yaml 规范（AI 生成）
- `arch/` — 系统架构文档
- `ops/` — 运营 SOP
- `market/` — 市场材料

## AI 模型分配

| 场景 | 模型 |
|------|------|
| PRD → 技术设计文档 | claude-opus-4-6 |
| 技术文档 → OpenAPI | claude-sonnet-4-6 |
| CI 日志分析 / Bug 报告 | claude-sonnet-4-6 |
| 知识库问答 | claude-sonnet-4-6 |
| 代码生成 / Bug 修复 | Claude Code headless (claude-sonnet-4-6) |
| NanoClaw 对话 | claude-sonnet-4-6 (Agent SDK) |

## 关键设计决策

- 选 Markdown + Git 而非飞书文档：AI 零转换损耗，版本追踪清晰
- 选 Plane 而非 Jira：原生 MCP Server，Claude Code 可直接读写 Issue
- 选 Bun 而非 Node.js 做胶水服务：内置 SQLite、原生 TypeScript、启动快内存小
- 飞书消息卡片含交互按钮（通过/打回），研发可直接在飞书中操作
- 两轮代码生成：后端先行（确认接口），前端跟进（基于 Figma 设计稿 + 已确认的接口）
- Claude Code 通过 Figma MCP Server 读取设计稿生成 UI 代码
- 人工 Review 门禁：AI 生成内容必须人工审批后才能进入下一环节

## 设计规格文档索引

所有详细设计文档位于 `docs/superpowers/specs/`：

| 文档 | 内容 |
|------|------|
| `2026-04-02-ai-devops-platform-design.md` | 整体平台设计规格（v2.0） |
| `2026-04-02-document-templates-design.md` | PRD 模板 + 技术设计文档模板 |
| `2026-04-02-claude-md-specs-design.md` | 各端 CLAUDE.md 规范（5 个仓库） |
| `2026-04-02-dify-workflow-prompts-design.md` | Dify 四条工作流 Prompt 设计 |
| `2026-04-02-gateway-service-design.md` | 胶水服务详细设计（API / 数据模型 / 流程） |
| `2026-04-02-feishu-approval-design.md` | 飞书消息卡片 + 审批回调协议 |
| `2026-04-02-multi-platform-codegen-design.md` | 多端代码生成策略（两轮生成） |
| `2026-04-02-nanoclaw-routing-design.md` | NanoClaw 意图路由 + 工具接入 |
