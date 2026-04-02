# Claude Code + GitHub 实战工作流指南 — 设计规格

## 概述

编写一份实战级 Markdown 文档，教开发者如何使用 Claude Code 结合 GitHub gh CLI 进行项目管理和开发。

## 文档元信息

- **文件路径**：`docs/claude-code-github-workflow-guide.md`
- **标题**：《Claude Code + GitHub 实战工作流指南》
- **语言**：中文
- **目标读者**：已有基本开发经验，想了解如何用 Claude Code 结合 gh CLI 进行项目管理的开发者
- **前提条件**：简要列出需要安装的工具（Claude Code、gh CLI），不展开安装教程，给出官方链接

## 文档结构

采用**场景驱动**结构，共 5 个核心场景。

每个场景的固定格式：

1. **场景说明** — 一两句话说清楚什么时候用
2. **你对 Claude Code 说** — 实际对话提示词（可直接复制使用）
3. **Claude Code 会做什么** — 它调用的 gh 命令和执行的操作
4. **效果** — 预期结果是什么
5. **小贴士** — 该场景下的注意事项或进阶用法（可选）

## 五个核心场景

### 场景一：项目规划

- 让 Claude Code 根据设计文档自动创建 Milestones 和 Issues
- 批量设置 Labels、优先级、分配到 Milestone
- 查看项目整体进度概览

### 场景二：功能开发闭环

- 从 Issue 出发：让 Claude Code 看某个 Issue 的需求并开始开发
- 自动创建 feature 分支、编码、提交
- 开发完成后创建 PR 并关联 Issue

### 场景三：代码审查

- 让 Claude Code 审查指定 PR
- 查看 PR 的 diff、CI 状态、评论
- 提交 review 意见或直接合并

### 场景四：进度追踪

- 查看当前 Milestone 下的 Issue 完成情况
- 按 Label/状态筛选 Issues
- 批量关闭或更新 Issue 状态

### 场景五：发布管理

- 基于已合并 PR 生成 Changelog
- 创建 GitHub Release 并打 Tag

## 写作原则

- 实用、简洁，不说废话
- 每个场景 200-400 字
- 重点是可直接复用的对话提示词和命令
- 不包含 Claude Code / gh 的安装教程和基础概念解释
