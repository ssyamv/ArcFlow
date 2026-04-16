> 文档状态：历史参考。本文用于保留早期团队工作流实践，其中个别步骤已不再匹配当前 ArcFlow 部署与工具链。涉及当前项目架构时，请以 `README.md` 和 `docs/AI研发运营一体化平台_技术架构方案.md` 为准。

# Claude Code + GitHub 实战工作流指南

> 版本：v1.0 · 2026-04-03

本指南面向已有基本开发经验的开发者，展示如何使用 **Claude Code** 结合 **GitHub gh CLI** 进行项目管理和开发。重点不是教你这两个工具怎么装，而是教你怎么把它们组合起来用。

## 前提条件

| 工具 | 安装 |
|------|------|
| Claude Code | <https://docs.anthropic.com/en/docs/claude-code/overview> |
| GitHub CLI (gh) | <https://cli.github.com/> |

确保 `gh auth login` 已完成认证。

---

## 场景一：项目规划 — 用 AI 批量创建 Milestones 和 Issues

**场景说明：** 项目启动或新阶段开始时，需要根据设计文档把工作拆解成可追踪的 Issue。

**你对 Claude Code 说：**

创建 Milestone + 批量 Issue：

> 阅读 docs/ 下的设计文档，为项目创建 GitHub Milestones（按阶段划分），然后为每个阶段创建对应的 Issues，设置合适的 Labels 和优先级。

查看当前规划概览：

> 列出仓库所有 Milestones 和每个 Milestone 下的 open Issues，给我一个进度概览。

补充 Labels：

> 给仓库添加以下 Labels：`feature`（功能开发，绿色）、`infra`（基础设施，蓝色）、`P0`（必须完成，红色）、`P1`（应该完成，黄色）。

**Claude Code 执行的操作：**

```bash
# 创建 Milestone
gh milestone create "Phase 1: 基础设施" --repo owner/repo --due-date 2026-04-15

# 创建 Issue 并关联 Milestone
gh issue create --title "搭建 docs Git 仓库" --body "..." \
  --label "infra,P0" --milestone "Phase 1: 基础设施"

# 查看 Milestone 进度
gh milestone list --repo owner/repo
gh issue list --milestone "Phase 1: 基础设施"

# 创建 Label
gh label create "feature" --color 0e8a16 --description "功能开发"
```

**预期效果：** GitHub 上自动出现结构化的 Milestones 和 Issues，每个 Issue 有正确的 Label 和优先级，团队可以直接在 Issue 中领取任务。

**小贴士：**

- 让 Claude Code 先读你的设计文档再创建 Issues，它会根据文档内容自动拆解任务，比手动拆更全面
- 如果 Milestone 或 Label 已存在，gh 会报错，Claude Code 会自动跳过或处理
- 可以用 `gh issue list --json number,title,state,labels` 获取结构化数据做进一步分析

---

## 场景二：功能开发闭环 — 从 Issue 到 PR 的完整流程

**场景说明：** 准备开始某个 Issue 的开发工作时。

**你对 Claude Code 说：**

开始开发：

> 看一下 #3 的需求，创建一个 feature 分支，然后开始实现。

开发完成，提交 PR：

> 代码写完了，帮我创建一个 PR，关联 #3，描述写清楚改了什么。

一步到位（适合小任务）：

> 看 #7 的需求，创建分支，实现功能，写测试，然后直接提 PR。

**Claude Code 执行的操作：**

```bash
# 1. 读取 Issue 内容理解需求
gh issue view 3 --repo owner/repo

# 2. 创建分支并切换
git checkout -b feat/create-prd-template

# 3. 编码...（Claude Code 写代码）

# 4. 提交代码
git add <files>
git commit -m "feat: 创建 PRD 模板文件

Closes #3"

# 5. 推送并创建 PR
git push -u origin feat/create-prd-template
gh pr create --title "feat: 创建 PRD 模板文件" \
  --body "## Summary\n- 新增 feature 和 module 两种 PRD 模板\n\nCloses #3"
```

**预期效果：** 从理解需求到提交 PR 一气呵成。PR 自动关联 Issue，合并后 Issue 自动关闭。

**小贴士：**

- commit message 或 PR body 中写 `Closes #N` 可以在 PR 合并时自动关闭对应 Issue
- 复杂功能建议分步走：先让 Claude Code 读需求并说明实现方案，确认后再编码
- Claude Code 会自动遵循项目的 CLAUDE.md 规范（代码风格、分层架构等）

---

## 场景三：代码审查 — 用 AI 辅助 Review PR

**场景说明：** 有新的 PR 需要审查，或者你想在合并前做一次 AI 辅助检查。

**你对 Claude Code 说：**

审查 PR：

> 帮我 review PR #18，重点看有没有 bug、安全问题和代码规范问题。

查看 PR 状态：

> PR #18 的 CI 过了吗？有什么评论？

合并 PR：

> PR #18 review 都通过了，帮我 squash merge。

**Claude Code 执行的操作：**

```bash
# 查看 PR 详情和 diff
gh pr view 18
gh pr diff 18

# 查看 CI 检查状态
gh pr checks 18

# 查看已有评论
gh pr view 18 --comments

# 提交 review 意见
gh pr review 18 --comment --body "LGTM，有一个小建议：..."

# 合并（需要有权限且 CI 通过）
gh pr merge 18 --squash --delete-branch
```

**预期效果：** Claude Code 阅读完整 diff 后给出结构化的 review 意见，比人工逐行看更快发现潜在问题。

**小贴士：**

- Claude Code 可以读取整个 PR 的改动上下文，包括跨文件的影响
- 合并操作受仓库的 Branch Protection Rules 约束，如果要求 required reviews，Claude Code 无法绕过
- 建议先让 Claude Code review，再由人做最终审批决策，AI 辅助而非替代人工判断

---

## 场景四：进度追踪 — 快速掌握项目状态

**场景说明：** 站会前、周报时、或者随时想了解项目进展。

**你对 Claude Code 说：**

整体进度：

> 给我看一下当前所有 Milestones 的完成进度。

特定阶段：

> Phase 1 还有哪些 Issue 没完成？按优先级排序。

按标签筛选：

> 列出所有标记为 P0 的 open Issues。

最近活动：

> 过去一周有哪些 PR 被合并了？

**Claude Code 执行的操作：**

```bash
# Milestone 进度
gh milestone list --repo owner/repo

# 特定 Milestone 的 open Issues
gh issue list --milestone "Phase 1: 基础设施" --state open

# 按 Label 筛选
gh issue list --label "P0" --state open

# 最近合并的 PR
gh pr list --state merged --search "merged:>2026-03-27"

# 结构化输出用于分析
gh issue list --json number,title,state,labels,milestone --limit 100
```

**预期效果：** 不用打开浏览器，在终端里就能得到项目状态的完整概览，Claude Code 还会帮你做汇总分析。

**小贴士：**

- 加 `--json` 参数可以获取结构化数据，Claude Code 能基于这些数据做统计分析
- 可以让 Claude Code 直接生成周报格式的进度总结
- 批量操作示例：`让 Claude Code 把 Phase 1 所有已完成的 Issue 关掉`

---

## 场景五：发布管理 — 自动化 Release 流程

**场景说明：** 一个阶段的开发完成，准备打 Tag 和发布时。

**你对 Claude Code 说：**

生成 Changelog：

> 基于上次 Release 之后合并的所有 PR，帮我生成一份 Changelog。

创建 Release：

> 创建 v0.1.0 Release，基于 main 分支，Changelog 用刚才生成的内容。

一步到位：

> 从上次 tag 到现在的所有合并 PR 生成 Changelog，然后创建 v0.2.0 Release。

**Claude Code 执行的操作：**

```bash
# 查看上次 Release
gh release list --limit 1

# 获取上次 Release 之后合并的 PR
gh pr list --state merged --search "merged:>2026-03-20" \
  --json number,title,labels,mergedAt

# 创建 Release（Claude Code 会组织 Changelog 内容）
gh release create v0.1.0 --title "v0.1.0 — Phase 1 基础设施" \
  --notes "## What's Changed
- #1 搭建 docs Git 仓库
- #2 部署 Wiki.js
- #3 创建 PRD 模板
..."

# 也可以自动生成 Release Notes
gh release create v0.1.0 --generate-notes
```

**预期效果：** 自动汇总改动历史，生成结构化的 Release Notes，一条命令发布。

**小贴士：**

- `--generate-notes` 可以让 GitHub 自动基于 PR 标题生成 Release Notes，适合快速发布
- 如果需要更精细的 Changelog 分类（feature / bugfix / infra），让 Claude Code 按 Label 分组整理
- Release 创建后会自动打 Git Tag

---

## 端到端示例：一个完整的开发周期

把以上场景串起来，一个典型的开发迭代是这样的：

```text
1. 规划阶段
   你：阅读设计文档，创建 Phase 1 的 Milestone 和 Issues
   → GitHub 上出现结构化的任务列表

2. 开发阶段
   你：看一下 #1 的需求，创建分支开始实现
   → 代码写完，PR 已创建并关联 Issue

3. 审查阶段
   你：review 一下 PR #19
   → Claude Code 给出 review 意见，你确认后合并

4. 追踪阶段
   你：Phase 1 进度怎么样了？
   → 得到完成率和剩余任务列表

5. 发布阶段
   你：所有 Issue 都完成了，创建 v0.1.0 Release
   → Release 发布，Changelog 自动生成
```

整个过程中你不需要离开终端，不需要在浏览器和 IDE 之间来回切换。Claude Code 是你的项目管理助手，gh CLI 是它的执行工具。
