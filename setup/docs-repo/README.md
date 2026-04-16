# ArcFlow docs 仓库脚手架

这是 ArcFlow 文档仓库的目录脚手架示例，用于初始化团队的 `docs Git` 仓库。

## 当前定位

- 文档真实底座是 `Markdown + Git`
- ArcFlow Web 是当前默认文档管理界面
- Gateway 负责文档树、读取、写入、搜索、重命名、删除和提交
- 本目录不再假设 `Wiki.js` 参与双向同步

## 目录结构

| 目录 | 内容 | 负责方 |
|------|------|--------|
| `/prd` | PRD 产品需求文档 | 产品 PM |
| `/tech-design` | 技术设计文档 | AI 生成，研发 Review |
| `/api` | OpenAPI YAML 规范 | AI 生成 |
| `/arch` | 系统架构与工程约定 | 研发维护 |
| `/ops` | 运营 SOP | 运营维护 |
| `/market` | 市场与售前材料 | 市场维护 |

## 文件命名规范

- PRD：`/prd/{yyyy-MM}/{feature-name}.md`
- 技术设计：`/tech-design/{yyyy-MM}/{feature-name}.md`
- OpenAPI：`/api/{yyyy-MM}/{feature-name}.yaml`

## 使用方式

1. 初始化一个独立的 docs Git 仓库
2. 将本目录内容复制到仓库根目录
3. 在 ArcFlow 工作空间中配置该 docs 仓库 URL
4. 通过 ArcFlow Web 文档页进行日常编辑与维护

## 注意事项

- `/prd` 目录原则上由产品维护，AI 不直接修改原始 PRD
- `/tech-design` 和 `/api` 可由 AI 流程生成，但仍需研发 Review
- 如需附加团队规范，请优先更新仓库根目录 `CLAUDE.md`
