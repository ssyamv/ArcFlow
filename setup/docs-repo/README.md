# ArcFlow 项目知识库

ArcFlow AI 研发运营一体化平台的文档仓库。所有文档以 Markdown 存储，与 Wiki.js 双向同步。

## 目录结构

| 目录 | 内容 | 负责方 |
|------|------|--------|
| /prd | PRD 产品需求文档 | 产品 PM |
| /tech-design | 技术设计文档 | AI 生成，研发 Review |
| /api | OpenAPI yaml 规范 | AI 生成 |
| /arch | 系统架构文档 | 研发维护 |
| /ops | 运营 SOP | 运营维护 |
| /market | 市场材料 | 市场维护 |

## 文件命名规范

- PRD：`/prd/{yyyy-MM}/{功能名}.md`
- 技术设计：`/tech-design/{yyyy-MM}/{功能名}.md`
- OpenAPI：`/api/{yyyy-MM}/{功能名}.yaml`

## 使用方式

PM 通过 Wiki.js 编辑文档，Wiki.js 自动同步到本仓库；也可以直接在 Git 中编辑，Wiki.js 会自动拉取更新。
