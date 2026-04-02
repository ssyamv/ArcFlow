# ArcFlow 团队协作工作流

本文档定义 ArcFlow 项目的 GitHub 协作流程，所有团队成员必须遵守。

---

## 一、分支策略

### 1.1 分支类型

| 分支 | 命名规则 | 用途 | 保护 |
|------|---------|------|------|
| `main` | — | 稳定版本，始终可部署 | 受保护，禁止直接 push |
| `feature/*` | `feature/#{issue号}-{简短描述}` | 新功能开发 | — |
| `fix/*` | `fix/#{issue号}-{简短描述}` | Bug 修复 | — |
| `docs/*` | `docs/#{issue号}-{简短描述}` | 文档更新 | — |
| `infra/*` | `infra/#{issue号}-{简短描述}` | 基础设施搭建 | — |

### 1.2 命名示例

```
feature/#7-gateway-service
fix/#12-webhook-dedup
docs/#3-prd-templates
infra/#1-docs-repo-setup
```

### 1.3 分支生命周期

```
main ──────────────────────────────────────────────
  │                                    ↑
  └── feature/#7-gateway ──── PR ──── merge ──── 删除分支
```

- 从 `main` 创建分支
- 开发完成后提 PR 回 `main`
- PR 合并后自动删除源分支

---

## 二、Issue 工作流

### 2.1 Issue 生命周期

```
创建 Issue → 分配负责人 → 创建分支开发 → 提 PR 关联 Issue → Review → 合并 → Issue 自动关闭
```

### 2.2 Issue 规范

**创建 Issue 时必须包含**：
- 清晰的标题（动词开头，如"搭建""部署""编写""修复"）
- 描述（做什么、为什么）
- 任务清单（checkbox 列表）
- 验收标准
- 参考文档链接（如有）
- Label（至少一个类型标签 + 一个优先级标签）
- Milestone（归属哪个 Phase）

**Label 体系**：

| Label | 颜色 | 说明 |
|-------|------|------|
| `infra` | 绿色 | 基础设施搭建 |
| `docs` | 蓝色 | 文档相关 |
| `config` | 紫色 | 配置工作 |
| `feature` | — | 功能开发（后续 Phase 使用） |
| `bug` | — | Bug 修复（后续 Phase 使用） |
| `P0` | 红色 | 必须完成 |
| `P1` | 黄色 | 应该完成 |

### 2.3 Issue 认领

- 认领 Issue：将自己设为 Assignee
- 同一时间每人最多认领 2 个 P0 Issue
- 开始工作前先在 Issue 下评论说明计划，避免重复劳动

---

## 三、PR（Pull Request）工作流

### 3.1 创建 PR

**何时创建**：
- 功能开发完成，本地测试通过后
- 也可以提前创建 Draft PR，标记为 WIP（Work In Progress），用于讨论方案

**PR 标题格式**：
```
<type>(#<issue号>): <简短描述>

示例：
feat(#7): 实现胶水服务 Webhook 路由
fix(#12): 修复 Webhook 去重逻辑
docs(#3): 添加 PRD 模板文件
infra(#1): 搭建 docs 仓库目录结构
```

**Type 枚举**：
| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `infra` | 基础设施 |
| `refactor` | 重构（不改变功能） |
| `chore` | 杂项（配置、依赖更新等） |

**PR 描述模板**：

```markdown
## 关联 Issue

Closes #<issue号>

## 变更内容

- 变更点 1
- 变更点 2

## 测试情况

- [ ] 本地测试通过
- [ ] 相关文档已更新（如有）

## 截图 / 日志（如有）

```

### 3.2 关联 Issue

PR 描述中使用 `Closes #1` 或 `Fixes #1` 关键字，合并后 Issue 自动关闭。

### 3.3 Code Review

**Review 规则**：
- 每个 PR 至少需要 **1 名** 团队成员 Approve
- 作者不能 Approve 自己的 PR
- Review 应在 PR 创建后 **24 小时内** 完成（工作日）

**Review 关注点**：

| 类型 | 关注点 |
|------|--------|
| 代码 PR | 逻辑正确性、规范一致性、安全性、性能 |
| 文档 PR | 内容准确性、格式规范、与设计文档一致 |
| 配置 PR | 配置正确性、敏感信息是否泄露 |

**Review 评论规范**：
- `[必须]` — 必须修改才能合并
- `[建议]` — 建议修改，但不阻塞合并
- `[疑问]` — 需要作者解释

### 3.4 合并策略

- 使用 **Squash and Merge**（将所有 commit 压缩为一个）
- 合并后自动删除源分支
- 合并前确保 PR 标题符合规范（因为 squash merge 后标题会成为 commit message）

---

## 四、Commit 规范

### 4.1 Commit Message 格式

```
<type>(#<issue号>): <简短描述>

<可选的详细说明>
```

**示例**：
```
feat(#7): 实现 Plane Webhook 接收和去重

- 添加 POST /webhook/plane 路由
- 实现基于 event_id 的去重逻辑
- 添加 SQLite webhook_event 表
```

### 4.2 规则

- 第一行不超过 72 个字符
- 使用中文或英文，项目内保持一致（推荐中文）
- 每个 commit 应该是一个完整的、可独立理解的变更
- 不要提交包含敏感信息的 commit（API Key、Token 等）

---

## 五、Milestone 管理

### 5.1 Phase 与 Milestone 对应

每个实施阶段对应一个 GitHub Milestone：

| Milestone | 内容 | 周期 |
|-----------|------|------|
| Phase 1 | Wiki.js + docs 仓库 + CLAUDE.md | Week 1-2 |
| Phase 2 | Plane CE + MCP 接入 | Week 3-4 |
| Phase 3 | Dify + 工作流 + 胶水服务 | Week 5-7 |
| Phase 4 | Dify RAG 知识库 | Week 8-9 |
| Phase 5 | NanoClaw + 飞书接入 | Week 10-12 |
| Phase 6 | CI/CD Bug 回流 | Week 13-15 |

### 5.2 流程

1. 每个 Phase 开始前，创建该 Phase 的 Milestone 和所有 Issues
2. Phase 进行中，通过 Milestone 进度条追踪完成情况
3. Phase 验收通过后，关闭 Milestone
4. 然后创建下一个 Phase 的 Milestone 和 Issues

---

## 六、日常协作流程

### 6.1 开发者日常流程

```bash
# 1. 认领 Issue，将自己设为 Assignee

# 2. 从 main 创建分支
git checkout main
git pull origin main
git checkout -b feature/#7-gateway-service

# 3. 开发 + 提交
git add .
git commit -m "feat(#7): 实现 Webhook 路由框架"

# 4. 推送分支
git push -u origin feature/#7-gateway-service

# 5. 在 GitHub 创建 PR，关联 Issue
#    标题：feat(#7): 实现胶水服务 Webhook 路由
#    描述：Closes #7

# 6. 等待 Review，根据反馈修改

# 7. Review 通过后 Squash and Merge

# 8. 本地切回 main 并更新
git checkout main
git pull origin main
```

### 6.2 Review 者流程

1. 收到 Review 请求通知
2. 24 小时内完成 Review
3. 有问题：评论标注 `[必须]` / `[建议]` / `[疑问]`，Request Changes
4. 没问题：Approve
5. 作者修改后重新 Review

### 6.3 冲突处理

```bash
# 如果 PR 提示冲突
git checkout feature/#7-gateway-service
git fetch origin
git rebase origin/main
# 解决冲突
git add .
git rebase --continue
git push --force-with-lease
```

使用 `--force-with-lease` 而非 `--force`，避免覆盖他人的提交。

---

## 七、文件组织约定

### 7.1 敏感信息

- **绝对禁止**提交：API Key、Token、密码、私钥
- 使用 `.env.example` 记录需要的环境变量（不含真实值）
- `.env` 文件必须在 `.gitignore` 中

### 7.2 .gitignore

每个项目根目录必须包含 `.gitignore`，至少排除：
```
.env
.DS_Store
node_modules/
dist/
*.log
```

---

## 八、沟通机制

| 场景 | 渠道 |
|------|------|
| PR Review 讨论 | GitHub PR 评论区 |
| Issue 讨论 | GitHub Issue 评论区 |
| 技术方案讨论 | GitHub Issue 或飞书群 |
| 紧急问题 | 飞书群 @相关人 |
| 日常进度同步 | 每日站会 / 飞书群 |

**原则**：技术讨论尽量在 GitHub 上留痕，方便回溯。
