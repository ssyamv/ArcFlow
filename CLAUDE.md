# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ArcFlow 是一个 AI 研发运营一体化平台，以 Markdown + Git 为数据底座、AI 为执行引擎，串联从 PRD 到代码生成的全流程。目前处于设计阶段，尚无实际代码。

## 技术栈

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue3
- 移动端：Flutter 3.x + GetX
- 客户端：原生 Android
- 胶水服务：Node.js + TypeScript
- AI 编排：Dify（工作流编排 + RAG）
- 文档知识库：Wiki.js 2.x（底层 Git 同步 .md 文件）
- 任务管理：Plane CE（原生 MCP）
- 向量数据库：Weaviate
- AI 工作台：NanoClaw（飞书 + 微信渠道）

## 架构分层

六层架构，从上到下：
1. **交互层** — NanoClaw（飞书/微信统一 AI 工作台）
2. **通知层** — 飞书（状态推送，含审批快捷按钮）
3. **编排层** — Dify（Prompt 链、RAG 检索、模型调用）
4. **衔接层** — 胶水服务（Webhook 路由、Git 读写、Claude Code 调度、飞书通知）
5. **协作层** — Wiki.js + Plane
6. **数据层** — docs Git + 代码仓库 + Weaviate

Dify 负责 AI 工作流编排，胶水服务负责系统间数据搬运，两者职责分离。

## 核心数据流

```
PM 写 PRD (Wiki.js) → docs Git → Plane Issue Approved
→ 胶水服务 → Dify 工作流（Claude Opus 生成技术文档 → Claude Sonnet 生成 OpenAPI）
→ 写回 Git + Wiki.js → 飞书通知研发 Review
→ 通过后 Claude Code headless 生成代码 → 提 MR
→ CI/CD 测试 → 失败自动修复（最多 2 次）→ 通过则交付归档
```

## 仓库结构

当前仓库为项目规划仓库，包含：
- `docs/` — 技术架构方案文档和设计规格文档
- `docs/images/` — 架构图

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
| 知识库问答 | claude-haiku-4-5 |
| 代码生成 / Bug 修复 | Claude Code headless (claude-sonnet-4-6) |
| NanoClaw 对话 | claude-sonnet-4-6 (Agent SDK) |

## 关键设计决策

- 选 Markdown + Git 而非飞书文档：AI 零转换损耗，版本追踪清晰
- 选 Plane 而非 Jira：原生 MCP Server，Claude Code 可直接读写 Issue
- 飞书仅作通知终端，不作数据存储或流程节点
- 人工 Review 门禁：AI 生成内容必须人工审批后才能进入下一环节
