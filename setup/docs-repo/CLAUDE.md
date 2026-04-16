# 项目知识库 — Claude 上下文

## 项目概况

这是 ArcFlow 的 docs Git 仓库。所有核心文档以 Markdown 形式存储，由 ArcFlow Web 与 Gateway 进行管理和读写。

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web：Vue 3 + Tailwind CSS 4 + Pinia + Vue Router + Tiptap + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin Android
- 协作：Plane CE + 飞书
- AI 编排：NanoClaw + Gateway + Claude API / Claude Code

## 文档目录说明

| 目录 | 内容 | 负责方 | AI 权限 |
|------|------|--------|---------|
| `/prd` | PRD 产品需求文档 | 产品 PM | 只读，不得直接覆盖 |
| `/tech-design` | 技术设计文档 | AI 生成，研发 Review | 可写 |
| `/api` | OpenAPI YAML 规范 | AI 生成 | 可写 |
| `/arch` | 系统架构与工程约定 | 研发维护 | 只读 |
| `/ops` | 运营 SOP | 运营维护 | 只读 |
| `/market` | 市场材料 | 市场维护 | 只读 |

## AI 操作规范

- 生成技术设计文档时，保存至 `/tech-design/{yyyy-MM}/{feature-name}.md`
- 生成 OpenAPI 时，保存至 `/api/{yyyy-MM}/{feature-name}.yaml`
- 不直接覆盖 `/prd` 中产品已确认的内容
- 输出以中文为主，路径和文件名保持稳定、可追踪
- 如流程需要回写文档，优先通过 ArcFlow / Gateway 既有约定完成

## Frontmatter 约定

Markdown 文档建议包含以下信息：

- `title`
- `status`
- `owner`
- `last_updated`

其中：

- PRD 推荐额外包含 `type`、`created`、`sprint`
- 技术设计文档推荐额外包含 `source_prd`、`generated_by`、`generated_at`、`reviewer`

## 约束

- 不发明新的顶层目录，优先复用既有结构
- 不将运行态数据、日志、临时产物写入 docs 仓库
- 如遇架构冲突，以仓库根目录 `README.md` 和主架构文档为准
