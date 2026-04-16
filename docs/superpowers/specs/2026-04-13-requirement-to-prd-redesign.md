> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 需求对话化 & PRD Review 流程重设计

- **日期**：2026-04-13
- **版本**：v1.0
- **范围**：Stage 0 需求录入 → Stage 2 PRD 审批，改为对话驱动
- **不涉及**：Stage 3 之后（技术设计之后复用现有链路），代码生成

---

## 1. 动机

当前流程要求 PM 先在 Plane 手动建 Issue，再单独触发 PRD 生成，两个步骤分离且 Plane 操作对 PM 不友好。

目标：**PM 只和 Web AI 对话，系统自动产出 Plane Issue + PRD 草稿**，人工门禁后进入技术设计阶段。

---

## 2. 新流程

```text
┌─────────────────────────────────────────────────────────┐
│  Stage A: 需求对话                                       │
│  PM → Web「AI 需求对话」→ Dify chatflow                  │
│  多轮追问 → 产出 Issue 标题/描述 + PRD 草稿              │
│  └─ 存 Gateway SQLite（草稿态，不 commit）               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Stage B: 草稿通知                                       │
│  Gateway 发飞书卡片「PRD 草稿就绪，请 Review」            │
│  按钮：查看详情（跳 Web） | 快速通过 | 快速驳回          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Stage C: PM Review（Web / 飞书 双通道）                 │
│  Web：左对话区 | 右 Markdown 编辑/预览 tab               │
│    • 继续对话让 AI 改 → 草稿更新                         │
│    • 手动编辑 Markdown → 草稿更新                        │
│    • 点「提交审批」→ 走 Stage D                          │
│  飞书：卡片上「快速通过」→ 走 Stage D                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Stage D: 审批落地（Gateway 原子操作）                   │
│  1. 在 Plane 创建 Issue（标题/描述来自草稿）             │
│  2. 将 PRD commit 到 docs git                            │
│  3. 将 Plane Issue 状态改为 Approved                     │
│  4. Plane Webhook 触发现有 flowPrdToTech（技术设计+OpenAPI）│
│  5. 技术设计完成 → 现有飞书「技术 Review」卡片通知研发    │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 新表 `requirement_drafts`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 草稿 ID |
| workspace_id | TEXT | 所属工作空间 |
| creator_id | TEXT | PM 用户 ID |
| status | TEXT | `drafting` / `review` / `approved` / `rejected` / `abandoned` |
| issue_title | TEXT | AI 生成的 Issue 标题 |
| issue_description | TEXT | AI 生成的 Issue 描述（Markdown，作为 Plane Issue 内容） |
| prd_content | TEXT | PRD 正文（Markdown） |
| prd_slug | TEXT | 文件名 slug，用于 `docs/prd/YYYY-MM/<slug>.md` |
| dify_conversation_id | TEXT | Dify 对话 ID（继续对话用） |
| plane_issue_id | TEXT | approved 后回填 |
| prd_git_path | TEXT | commit 后回填 |
| feishu_chat_id | TEXT | 通知群 |
| feishu_card_id | TEXT | 卡片 ID（便于更新卡片状态） |
| created_at / updated_at / approved_at | TIMESTAMP | |

### 状态机

```text
drafting ──对话/编辑──▶ drafting
drafting ──「完成草稿」──▶ review
review   ──对话/编辑──▶ review   (内容变化但不回退状态)
review   ──「提交审批」──▶ approved （不可逆，触发 Stage D）
review   ──「驳回」──▶ drafting
review   ──「放弃」──▶ abandoned
```

---

## 4. 接口设计

### Web → Gateway

| 接口 | 说明 |
|---|---|
| `POST /api/requirement/draft` | 新建草稿（空），返回 draft_id |
| `POST /api/requirement/:id/chat` | SSE 流：PM 输入 → Dify chatflow → 流式回答 + 结构化产物（Issue + PRD） |
| `GET /api/requirement/:id` | 读草稿（含当前 Issue 标题/描述 + PRD） |
| `PATCH /api/requirement/:id` | 手动编辑（覆盖 issue_title/issue_description/prd_content） |
| `POST /api/requirement/:id/finalize` | drafting → review：AI 对 PRD 做一次收尾整理，发飞书通知 |
| `POST /api/requirement/:id/approve` | review → approved：执行 Stage D 原子操作 |
| `POST /api/requirement/:id/reject` | review → drafting：记录驳回理由 |
| `GET /api/requirement?workspace_id=xxx` | 列表（支持状态过滤） |

### 飞书回调

复用现有 `POST /webhook/feishu`，新增 action：

- `requirement_approve`（卡片上「快速通过」）
- `requirement_reject`（卡片上「快速驳回」）

---

## 5. Dify 工作流改造

### 新 chatflow：「需求对话 → Issue + PRD」

**输入**：

- `user_message`：PM 本轮输入
- `conversation_id`：继续对话用
- `rag_workspace`：RAG 检索范围（当前 workspace 的 PRD 历史）

**多轮策略**（参考 CLAUDE.md 规范）：

1. 首轮：询问需求核心目标 + 用户场景
2. 次轮：追问边界、验收标准、优先级
3. 可选轮：澄清技术约束、依赖

**输出（结构化，前端解析）**：

```json
{
  "reply": "文本回复（展示在对话区）",
  "ready": false,
  "draft": {
    "issue_title": "...",
    "issue_description": "...（Markdown，作为 Plane Issue 内容）",
    "prd_content": "...（Markdown，符合 PRD 模板）",
    "prd_slug": "feature-name"
  }
}
```

AI 判断信息足够时 `ready = true`，前端据此启用「完成草稿」按钮。

---

## 6. Web UI 改动

### 入口

工作空间首页 / 对话历史页新增「新建需求」按钮 → 跳「AI 需求对话」页。

### 需求对话页布局

```text
┌──────────────────────────┬────────────────────────────┐
│  AI 对话区（左 50%）      │  草稿预览区（右 50%）       │
│  ┌────────────────────┐  │  Tab: [PRD] [Issue 预览]    │
│  │ 历史消息            │  │  ┌────────────────────┐    │
│  │ ...                │  │  │ Markdown 编辑/预览  │    │
│  │                    │  │  │ （复用现有组件）     │    │
│  └────────────────────┘  │  └────────────────────┘    │
│  [输入框] [发送]          │  [完成草稿] [手动保存]      │
└──────────────────────────┴────────────────────────────┘
```

### Review 页

同布局，右上角新增：

- `[提交审批]`（主按钮，status=review 时可用）
- `[驳回回草稿]`

进入 approved 后页面锁定只读，显示 Plane Issue 链接 + PRD git 路径 + 技术设计进度。

---

## 7. 飞书卡片

### 新模板：「PRD Review」

```text
📋 需求 PRD 草稿就绪
━━━━━━━━━━━━━━━━━
标题：工作流列表按状态筛选
创建者：张三
摘要：（AI 生成的 1-2 句摘要）

[ 📖 查看详情 ]  ← 跳 Web Review 页
[ ✅ 快速通过 ]  [ ❌ 驳回 ]
```

复用现有「技术 Review」卡片模板框架，只改文案和回调 action。

---

## 8. Stage D：审批原子操作

顺序执行（任一步失败回滚已做操作 + 通知 PM）：

1. **Plane 建 Issue**（`planeService.createIssue`）
   - 标题/描述来自草稿
   - 初始状态：`Backlog`
2. **Git commit PRD**（`git.writeAndPush`）
   - 路径 `docs/prd/YYYY-MM/<slug>.md`
3. **回填草稿**：`plane_issue_id` + `prd_git_path` + `status=approved`
4. **Plane 改状态**为 `Approved`（`planeService.updateIssueState`）
5. 依赖现有 Webhook：Plane → Gateway → `flowPrdToTech`（**零改动**）
6. 更新飞书卡片显示「✅ 已通过，技术设计生成中…」

---

## 9. 改动清单

| 模块 | 文件 | 改动类型 |
|---|---|---|
| Gateway | `src/db/schema.ts` | 新增 `requirement_drafts` 表迁移 |
| Gateway | `src/db/queries.ts` | 新增 draft CRUD |
| Gateway | `src/services/requirement.ts` | 新文件：草稿管理 + finalize + approve |
| Gateway | `src/services/dify.ts` | 新增 `streamRequirementChatflow` |
| Gateway | `src/services/plane.ts` | 确保 `createIssue` + `updateIssueState` 可用 |
| Gateway | `src/services/feishu.ts` | 新增 PRD Review 卡片模板 |
| Gateway | `src/routes/api.ts` | 新增 `/api/requirement/*` 路由组 |
| Gateway | `src/routes/webhook.ts` | 飞书回调支持 requirement_approve/reject |
| Gateway | `src/types/index.ts` | 新增 RequirementDraft 类型 |
| Web | `src/views/RequirementChat.vue` | 新页面：对话 + 预览布局 |
| Web | `src/views/RequirementReview.vue` | 或合并到上页按状态切换 |
| Web | `src/stores/requirement.ts` | Pinia store |
| Web | `src/api/requirement.ts` | API client |
| Web | 路由 + 菜单 | 新增入口 |
| Dify | 需求对话 chatflow | 在 Dify 控制台建，填 `DIFY_REQUIREMENT_CHAT_API_KEY` |
| 配置 | `.env` | 新增 `DIFY_REQUIREMENT_CHAT_API_KEY`、确保 `PLANE_APPROVED_STATE_ID` 非空 |

**现有 `POST /api/prd/chat` 的归宿**：保留但标记 deprecated，留作兼容；新流程全走 `/api/requirement/*`。

---

## 10. 分期实施（建议拆 PR）

| Phase | 内容 | 可独立交付 |
|---|---|---|
| P1 | Gateway 数据模型 + 草稿 CRUD + Dify chatflow 接入 | ✅ 后端测试可跑 |
| P2 | Web 对话页（左对话右预览）+ 手动编辑 | ✅ 功能可用 |
| P3 | finalize + 飞书 PRD Review 卡片 | ✅ 通知链路打通 |
| P4 | approve 原子操作（建 Issue + commit + 改状态） | ✅ 触发技术设计 |
| P5 | 端到端联调 + 验证报告 | ✅ 全链路打通 |

---

## 11. 验收标准

- [ ] PM 在 Web 全程不进 Plane 也能完成需求录入
- [ ] 对话 → 草稿 → Review → 通过，四个阶段飞书通知都能收到
- [ ] 通过后 `docs/prd/` 有新 commit + Plane 有新 Issue（状态 Approved）
- [ ] 现有 Webhook → 技术设计自动触发（不回归）
- [ ] 草稿期中断（关浏览器）能恢复
- [ ] 飞书卡片「快速通过」等价 Web「提交审批」

---

## 12. 非目标 / 延后

- ❌ 代码生成（Stage 5+）
- ❌ 多 PM 协同编辑同一草稿（单用户独占）
- ❌ 历史版本比对（只留最终版）
- ❌ 语音/图片输入（只支持文本）

---

## 13. 开放问题

- 需求对话的 RAG 知识范围：只搜本 workspace 的 PRD，还是跨 workspace？→ **默认本 workspace，可配置**
- 草稿过期策略：>30 天未操作自动归档为 abandoned？→ **P5 再定**
- Plane Issue 的 Project 如何选定：Workspace 级配置 `default_plane_project_id`
