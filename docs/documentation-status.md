# Documentation Status

本页用于说明仓库中哪些文档代表**当前有效架构**，哪些属于**历史设计 / 历史计划 / 历史报告**。

## 当前有效

以下文档应优先阅读：

- [README.md](../README.md)：项目总览、当前架构、当前开发状态
- [AI研发运营一体化平台_技术架构方案.md](AI研发运营一体化平台_技术架构方案.md)：当前真实架构与阶段说明
- [setup/docs-repo/README.md](../setup/docs-repo/README.md)：docs Git 仓库脚手架说明
- [setup/docs-repo/CLAUDE.md](../setup/docs-repo/CLAUDE.md)：docs 仓库 AI 上下文模板
- [setup/nanoclaw/README.md](../setup/nanoclaw/README.md)：NanoClaw 部署说明
- [setup/plane](../setup/plane)：Plane 相关部署与 webhook 配置

## 当前阶段参考

以下设计文档仍与当前主线直接相关，但不应单独作为项目总览使用：

- `docs/superpowers/specs/2026-04-14-nanoclaw-auth-passthrough-design.md`
- `docs/superpowers/specs/2026-04-14-arcflow-api-skill-design.md`
- `docs/superpowers/specs/2026-04-15-dify-to-nanoclaw-migration-design.md`
- `docs/superpowers/specs/2026-04-15-nanoclaw-arcflow-skills-contract.md`
- `docs/superpowers/specs/2026-04-15-nanoclaw-hot-container-pool-design.md`
- `docs/superpowers/specs/2026-04-16-deployment-alignment-and-nanoclaw-stability-design.md`
- `docs/superpowers/specs/2026-04-16-end-to-end-arcflow-nanoclaw-phase1-design.md`
- `docs/superpowers/specs/2026-04-17-ci-bug-backflow-closure-design.md`
- `docs/superpowers/specs/2026-04-17-dispatch-callback-observability-design.md`

补充说明：

- `arcflow-api` 相关文档当前要区分 **ArcFlow 仓内配套实现** 与 **NanoClaw 仓内 skill 包本体** 两部分
- 截至 `2026-04-17`，ArcFlow 仓内 Gateway 契约、Web artifact 渲染、Phase 3.5 闭环、CI bug 回流闭环均已落地

以下验证报告可直接作为当前阶段事实依据：

- `docs/superpowers/reports/2026-04-16-phase-3-5-verification.md`
- `docs/superpowers/reports/2026-04-17-ci-bug-backflow-closure-verification.md`
- `docs/superpowers/reports/2026-04-17-dispatch-callback-observability-verification.md`
- `docs/superpowers/reports/2026-04-17-deployment-alignment-and-nanoclaw-stability-verification.md`

## 历史参考

以下目录主要用于追溯项目演进，不代表当前生产与开发主线：

- `docs/superpowers/specs/` 中早期涉及 `Wiki.js / Dify / Weaviate` 的设计文档
- `docs/superpowers/plans/` 中的实施计划
- `docs/superpowers/reports/` 中基于当时环境写成的联调报告
- `docs/claude-code-github-workflow-guide.md` 中与早期部署流程绑定的内容

阅读这些文档时：

- 若文中提到 `Wiki.js / Dify / Weaviate`，应视为历史架构
- 若文中描述的部署方式与当前运行不一致，以当前 README 和主架构文档为准
- 若历史文档与代码冲突，以当前代码与当前有效文档为准

## 阅读建议

推荐顺序：

1. `README.md`
2. `docs/AI研发运营一体化平台_技术架构方案.md`
3. 与当前任务直接相关的最新 spec / plan / report
4. 需要追溯背景时，再阅读历史文档
