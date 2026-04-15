# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ArcFlow 是一个 AI 研发运营一体化平台，以 Markdown + Git 为数据底座、AI 为执行引擎，串联从 PRD 到代码生成的全流程。当前 Gateway + Web + NanoClaw + Plane 已打通，AI 编排已于 #113 全量切至 NanoClaw + 自建 sqlite-vec RAG，Dify 仅保留 PRD 生成 Chatflow（待迁移后下线）。

## 技术栈

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue 3 + Tailwind CSS + Pinia + Vue Router + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin Android（Jetpack Compose + 传统 XML）
- 胶水服务：Bun + Hono + bun:sqlite
- AI 编排：NanoClaw（Claude Agent SDK，工作流 + 工具调用）+ 自建 sqlite-vec RAG；Dify 仅剩 PRD 生成 Chatflow
- 文档管理：ArcFlow Web 内置（Tiptap 富文本 + Markdown 预览 + 工作空间隔离；Wiki.js 已于 #75/#76 移除）
- 任务管理：Plane CE（原生 MCP + ArcFlow 双向导航）
- 向量数据库：sqlite-vec（Gateway 内置，取代 Weaviate）
- AI 工作台：NanoClaw（飞书渠道 + Web channel 已接入，部署在 172.29.230.21，PM2 托管）
- 接口规范：RESTful，统一返回 Result<T>

## 架构分层

五层架构，从上到下：

1. **交互层** — NanoClaw（飞书 AI 工作台，Claude Agent SDK）+ ArcFlow Web（Vue 3 管理界面）
2. **通知层** — 飞书（状态推送，消息卡片含 Plane 跳转 / 审批链接）
3. **编排层** — NanoClaw（Claude Agent SDK，工具调用 + 工作流）+ Gateway 内置 sqlite-vec RAG；Dify 仅残留 PRD Chatflow
4. **衔接层** — 胶水服务 Gateway（Webhook 路由、Git 读写、Claude Code 调度、NanoClaw dispatch、飞书通知、RAG）
5. **数据层** — docs Git + 代码仓库 + Plane Issue + sqlite-vec

NanoClaw 负责 AI 工作流与工具调用，Gateway 负责系统间数据搬运、统一 API 出入口与 RAG 检索。

## 核心数据流

```text
PM 在 ArcFlow Web / NanoClaw 对话生成 PRD → Gateway Stage D 原子写入 docs Git + Plane Issue
→ PM 在 Plane 标记 Approved → Plane Webhook → Gateway
→ NanoClaw 工作流（Claude Opus 生成技术设计 → Claude Sonnet 生成 OpenAPI）
→ 写回 docs Git → 飞书消息卡片通知研发 Review（卡片含 Plane 跳转 + 审批 token）
→ 通过后进入两轮代码生成：
  第一轮：后端代码生成 → 研发 Review MR → 合并
  第二轮：设计师出 Figma 设计稿 → Claude Code 通过 Figma MCP 生成 UI 代码 → 研发 Review / 微调
→ CI/CD 测试 → 失败自动分析 + Bug 修复（最多 2 次）→ 通过则交付归档
```

## 仓库结构

当前仓库为 monorepo，包含：

- `packages/gateway/` — 胶水服务（Bun + Hono + SQLite），171 个测试
- `packages/web/` — Web 管理界面（Vue 3 + Tailwind CSS）
- `docs/` — 技术架构方案文档和设计规格文档
- `docs/superpowers/specs/` — 详细设计规格文档（见下方索引）
- `docs/superpowers/plans/` — 实施计划文档
- `setup/` — 第三方服务部署配置（Plane / NanoClaw；Dify 逐步退场）

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
| RAG 知识库问答 | claude-sonnet-4-6（Gateway 自建 sqlite-vec）|
| 代码生成 / Bug 修复 | Claude Code headless (claude-sonnet-4-6) |
| NanoClaw 对话 | claude-sonnet-4-6 (Agent SDK) |

## 关键设计决策

- 选 Markdown + Git 而非飞书文档：AI 零转换损耗，版本追踪清晰
- 选 Plane 而非 Jira：原生 MCP Server，Claude Code 可直接读写 Issue
- 选 Bun 而非 Node.js 做胶水服务：内置 SQLite、原生 TypeScript、启动快内存小
- 飞书消息卡片含 Plane 跳转链接，研发在 Plane 中操作 Issue 状态完成审批，Plane Webhook 自动触发后续流程
- 飞书 API 域名可配置（FEISHU_BASE_URL），支持讯飞内部飞书（xfchat.iflytek.com）等私有化部署
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
| `2026-04-07-nanoclaw-setup-design.md` | NanoClaw ArcFlow 接入设计（Fork 策略 / 工具配置 / 部署） |
| `2026-04-08-web-nanoclaw-integration-design.md` | Web 前端接入 NanoClaw WebChannel 设计 |
| `2026-04-10-arcflow-plane-integration-design.md` | ArcFlow + Plane 无缝集成（双向导航 + 统一 OAuth + 页面精简） |
| `2026-04-02-ci-quality-gate-design.md` | CI 质量门设计（lint + 测试 + 覆盖率阈值） |
| `2026-04-03-claude-code-github-workflow-guide-design.md` | Claude Code GitHub 工作流指南 |
| `2026-04-06-ibuild-cicd-bug-backflow-design.md` | iBuild CI/CD Bug 回流端点 |
| `2026-04-08-prd-generation-design.md` | PRD 生成多轮对话流设计 |
| `2026-04-09-web-docs-manager-design.md` | Web 文档管理（Tiptap + Markdown + 文件树） |
| `2026-04-09-web-frontend-redesign-design.md` | Web 前端 Linear 风格重设计 |
| `2026-04-13-requirement-to-prd-redesign.md` | 需求草稿 → PRD 重设计（Stage A–D 原子流程） |
| `2026-04-14-nanoclaw-server-inventory.md` | NanoClaw 服务器现状盘点 + 两项 P0 救火记录 |
