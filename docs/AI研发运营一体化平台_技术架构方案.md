# AI 研发运营一体化平台 — 技术架构与实现路径

> 版本：v1.0 · 2026 年 4 月 · 供内部技术团队评审讨论

---

## 一、背景与目标

### 1.1 现状问题

当前团队在产品研发和运营过程中面临以下核心痛点：

- **文档分散**：PRD、技术设计文档、运营 SOP 分散在飞书、本地文件夹、代码仓库 Wiki 等多处，查找困难，版本混乱
- **流程断层**：产品文档到研发任务依赖人工传递，标准化程度低，信息在传递过程中容易失真
- **AI 接入困难**：飞书等工具底层使用 block 富文本结构，AI 无法直接读写，需要额外的格式转换层，损耗大
- **重复劳动**：技术设计文档、接口规范、测试用例等有明确规律可循的产出物，仍需人工逐个编写
- **知识孤岛**：团队成员需要大量时间定位历史文档、了解上下文，新人上手成本高

### 1.2 目标

构建一套以 **Markdown 文件 + Git** 为数据底座、**AI 为执行引擎**的研发运营一体化平台，实现：

- **文档标准化**：所有文档统一为 Markdown 格式，存入 Git 仓库，人写 AI 读，双向流通无损耗
- **流程自动化**：产品 PRD 审批通过后，技术设计文档、OpenAPI 规范自动生成，研发直接基于规范开发
- **代码生成**：Claude Code 基于技术文档和规范，自动生成 Spring Boot 后端代码和 Flutter 前端代码
- **质量闭环**：CI/CD 测试失败自动生成 Bug 报告，Claude Code 自动修复，重新进入 Review 流程
- **知识沉淀**：所有文档自动向量化，团队成员通过自然语言提问即可定位任何历史文档

### 1.3 核心设计原则

| 原则 | 说明 | 体现 |
|------|------|------|
| 文档即代码 | 所有文档以 `.md` 文件存在 Git 仓库，与代码同等管理 | 版本追踪、PR Review、分支管理 |
| AI 优先接口 | 工具选型优先考虑 AI 是否能直接操作，而非人的使用便利 | 选 Wiki.js 而非飞书文档 |
| 人工把关节点 | AI 生成，人审批放行，不做全自动无人值守流水线 | MR Review、文档 Review 门禁 |
| 飞书只读通知 | 保留飞书的消息接收习惯，但不让飞书成为数据存储或流程节点 | 飞书只收通知，不发起操作 |
| 私有化优先 | 所有核心组件可内网私有化部署，数据不出内网 | 全部 Docker 自托管 |

---

## 二、整体架构

### 2.1 架构分层

![系统分层架构](images/arch_layers.png)

整套系统分为五层，从上到下职责清晰：

| 层次 | 核心工具 | 职责 |
|------|----------|------|
| 通知层 | 飞书（只读） | 接收各节点状态推送，人工在此确认后跳转对应系统操作 |
| 触发层 | Dify 工作流引擎 | 监听各系统 Webhook 事件，编排 AI 调用链，驱动跨系统数据流转 |
| 执行层 | Claude API + Claude Code | Claude API 负责文档生成和分析；Claude Code 负责代码生成和 Bug 修复 |
| 协作层 | Wiki.js + Plane | Wiki.js 管理所有文档；Plane 管理所有任务和 Issue |
| 数据层 | docs Git 仓库 + 向量库 | `.md` 文件存 Git；文档向量化存 Weaviate，支持语义检索 |

### 2.2 核心数据流

![核心数据流](images/data_flow.png)

**完整数据流路径：**

```
PM 写 PRD (Wiki.js)
  → .md 存入 docs Git
  → Plane Issue 状态改为 Approved
  → Dify 触发工作流一
  → Claude Opus 读取 PRD → 生成技术设计文档
  → 写回 Wiki.js + docs Git
  → Claude Sonnet 生成 OpenAPI yaml
  → 写入 docs Git
  → 飞书通知研发 Review
  → 研发 Approve
  → Claude Code 读 CLAUDE.md + tech-design + openapi.yaml
  → 生成 Spring Boot 后端 + Flutter 前端代码
  → 提 MR → 飞书通知 Review
  → CI/CD 跑测试
  → 失败：Dify 分析日志 → 自动创建 Bug Issue → Claude Code 自动修复 → 重入 Review
  → 通过：交付，产出物归档 docs 仓库
```

### 2.3 关键技术决策

**为什么选 Markdown + Git 而非飞书文档**

飞书文档底层是 block 富文本结构（类似 Notion），不是原生 Markdown 文件。AI 读取时需要调用 API 转换，结构有损耗；Claude Code 无法直接操作飞书文档；文档不在 Git 里，无法版本追踪；RAG 的语义分块难以对齐文档真实边界。

Markdown 文件存 Git，对 AI 是天然的工作空间：Claude Code 直接读写 `.md` 文件，Diff 清晰，上下文完整，零转换损耗，RAG 直接 `glob` 扫描目录，质量最高。

**为什么不需要 IM 模块**

本系统的核心用户是 AI Agent，人是审批者和消费者，不是主要操作者。IM 是人与人沟通的工具，与本系统的定位不匹配。团队日常沟通继续用飞书，本系统只通过飞书单向推送通知，不参与沟通。

**为什么选 Plane 而非 Jira 或飞书项目**

Plane 是目前开源项目管理工具中对 AI 接入最友好的选项，原生提供 MCP Server，Claude Code 可以直接通过 MCP 协议读写 Issue，不需要任何中间层。Jira 无原生 MCP 支持且非开源；飞书项目不适合 AI 直接操作。

---

## 三、技术选型

### 3.1 组件清单

| 组件 | 选型 | 版本 | 角色 | 开源协议 |
|------|------|------|------|----------|
| 文档知识库 | Wiki.js | 2.x | 人写文档的界面，底层存 Git `.md` | AGPLv3 |
| 任务管理 | Plane CE | stable | 任务 / Issue 管理，原生 MCP | AGPL-3.0 |
| AI 编排引擎 | Dify | latest | 工作流编排，Webhook 监听，RAG | Apache 2.0 |
| 代码生成 | Claude Code | — | 读文档生成代码，自动修复 Bug | 商业 |
| 文档生成 | Claude API | claude-opus-4-6 | PRD → 技术文档，日志分析 | 商业 |
| 向量数据库 | Weaviate | 1.24.x | 文档向量化存储，语义检索 | BSD-3 |
| 代码仓库 | 内部 Git | Gitea/GitLab CE | 代码 + docs `.md` 文件存储 | 开源 |
| 通知终端 | 飞书（现有） | 私有化版 | 只读，接收状态推送 | 商业 |

### 3.2 AI 模型分配策略

| 使用场景 | 模型 | 选择理由 |
|----------|------|----------|
| PRD → 技术设计文档 | `claude-opus-4-6` | 复杂推理，架构设计需要最强理解能力，质量优先 |
| 技术文档 → OpenAPI yaml | `claude-sonnet-4-6` | 结构化输出，速度和质量平衡 |
| CI 日志分析 / Bug 报告生成 | `claude-sonnet-4-6` | 够用，日均调用频率较高，控制成本 |
| 知识库问答（高频） | `claude-haiku-4-5` | 高频低延迟，成本最低，问答场景足够 |
| 代码生成 / Bug 修复 | Claude Code（`claude-sonnet-4-6`） | CC 默认使用 Sonnet，可在 `CLAUDE.md` 中指定 |

### 3.3 服务器资源评估

基于内网服务器 + 10~30 人团队规模，单机 Docker Compose 部署，无需 K8s：

| 服务组 | 推荐配置 | 说明 |
|--------|----------|------|
| Wiki.js + PostgreSQL | 2C / 4GB | 文档读写，并发低 |
| Plane（含 Worker、Beat、MQ） | 4C / 8GB | 任务管理，有 Celery 后台任务 |
| Dify（含 Worker + Weaviate） | 4C / 8GB | 工作流执行 + 向量检索，内存敏感 |
| 飞书 Bot 服务 | 1C / 1GB | 纯转发，极轻量 |
| **合计建议** | **≥ 8C / 16GB / 200GB SSD** | 单台物理机或云主机均可 |

---

## 四、各模块详细设计

### 4.1 模块一：Wiki.js 文档仓库

**核心定位**：整套系统的数据底座。所有文档以 `.md` 文件存储在 Git 仓库中，Wiki.js 只是人类友好的编辑界面。

**关键特性**：
- Git 双向同步：人在 Wiki.js 编辑 → 自动 commit 到 docs Git；AI 写入 Git → Wiki.js 实时更新
- 原生 Markdown：底层直接保存 `.md` 文件，无格式转换损耗
- LDAP/OIDC 认证：可对接内网账号体系，统一鉴权
- Webhook 支持：文档变更时触发 Git Hook，同步更新向量知识库

**docs 仓库目录规范**：

```
docs/
├── CLAUDE.md                # 项目总上下文，CC 必读
├── README.md
├── prd/                     # 产品需求文档（PM 写）
│   ├── _template.md
│   └── 2026-04/
│       └── feature-xxx.md
├── tech-design/             # 技术设计文档（Claude API 生成）
├── api/                     # OpenAPI yaml 规范（Claude API 生成）
├── arch/                    # 系统架构文档（研发维护）
├── ops/                     # 运营 SOP
├── market/                  # 市场材料
└── retrospective/           # 复盘、会议记录
```

**CLAUDE.md 核心内容结构**：

```markdown
# 项目知识库 — Claude 上下文

## 项目概况
- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- 前端：Flutter 3.x + GetX
- 代码仓库：http://内网git地址/org/repo

## 文档目录说明
| 目录 | 内容 | 负责方 |
|------|------|--------|
| /prd | PRD 产品需求文档 | 产品 PM |
| /tech-design | 技术设计文档 | CC 生成，研发 Review |
| /api | OpenAPI yaml 规范 | CC 生成 |

## AI 操作规范
- 读取 PRD 后生成技术设计文档，保存至 /tech-design/
- 生成 OpenAPI 规范，保存至 /api/
- 不得直接修改 /prd/ 目录下的文件
```

### 4.2 模块二：Plane 任务管理

**核心定位**：人看任务进度的界面 + AI 操作任务的接口。通过原生 MCP Server，Claude Code 可以直接读写 Issue。

**项目结构设计**：

| Plane 项目 | 状态流转 | 触发方 |
|------------|----------|--------|
| 产品规划 | Backlog → In Review → Approved → Done | PM 手动操作 |
| 研发迭代 | Todo → In Progress → Code Review → Testing → Done | Dify 自动 + 研发手动 |
| Bug 追踪 | New → AI Fix → Review → Closed | CI/CD 自动创建，CC 自动修复 |
| 运营任务 | Todo → In Progress → Done | 运营手动操作 |

**MCP 配置**（`.mcp.json`）：

```json
{
  "mcpServers": {
    "plane": {
      "command": "npx",
      "args": ["@makeplane/mcp-server"],
      "env": {
        "PLANE_API_TOKEN": "your_api_token",
        "PLANE_BASE_URL": "http://你的内网IP",
        "PLANE_WORKSPACE_SLUG": "your-workspace"
      }
    }
  }
}
```

### 4.3 模块三：Dify 编排引擎

**核心定位**：整套系统的神经中枢，负责监听各模块事件，协调 AI 调用，驱动跨系统数据流转。

**四条核心工作流**：

| 工作流 | 触发条件 | 产出物 |
|--------|----------|--------|
| 工作流一：PRD → 技术文档 | Plane Issue 状态变为 Approved | 技术设计文档 `.md` |
| 工作流二：技术文档 → OpenAPI | 工作流一完成后链式触发 | OpenAPI 3.0.3 yaml |
| 工作流三：Bug 分析与修复 | CI/CD 测试失败，推送日志 payload | Bug Issue + 修复 MR |
| 工作流四：知识问答路由 | RAG 助手收到用户问题 | 回答 + 文档来源链接 |

**工作流一 LLM 节点 System Prompt 核心约束**：

```
你是一个资深 Java Spring Boot 后端架构师。
技术栈约束：
- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- 前端：Flutter 3.x + GetX
- 接口规范：RESTful，统一返回 Result<T>
- 分层：Controller → Service → ServiceImpl → Mapper → Entity

输出必须包含：
1. 功能概述（一句话）
2. 数据库设计（建表 SQL）
3. 接口设计（接口列表，含请求/响应字段）
4. 分层实现说明
5. 注意事项 & 边界情况

只输出 Markdown 文档内容，不输出任何解释性文字。
```

### 4.4 模块四：RAG 知识问答助手

**核心定位**：团队成员感知 AI 价值最直接的入口。用自然语言提问，AI 检索 docs 仓库返回答案和文档来源链接。

**知识库配置**：

- 向量模型：`bge-m3`（本地部署，完全内网，中文效果好）
- 分块策略：按 Markdown 标题层级分块，最大 512 token
- 检索模式：混合检索（向量 + 全文），Rerank 重排，TopK=5，Score 阈值 0.4
- 同步机制：docs Git 的 `post-receive` Hook 触发增量同步；每日凌晨 2 点全量重建

**文档 frontmatter 规范**（支持过滤过期文档）：

```markdown
---
title: 用户登录功能 PRD
status: active    # active / deprecated / draft
owner: 产品-张三
last_updated: 2026-04-01
sprint: S12
---
```

**两个访问入口**：
- **Web UI**：Dify 发布的 Chat App，内网 URL，直接浏览器访问，支持多轮对话
- **飞书 Bot**：轻量 FastAPI 服务，监听飞书 @ 事件，转发 Dify API，回传带来源链接的答案

---

## 五、集成接口设计

### 5.1 各系统接口汇总

| 系统 | 接口方向 | 鉴权方式 |
|------|----------|----------|
| Wiki.js | 被调用 | API Token（Header） |
| Plane | 双向 | API Token（Header） |
| 内部 Git | 被调用 | Personal Access Token |
| Dify | 被调用 | API Key（Header） |
| 飞书 | 调用方 | App Secret |
| Claude API | 被调用（Dify 代理） | API Key（内网代理转发） |

### 5.2 Webhook 事件流

| 事件来源 | 事件 | 接收方 | 触发动作 |
|----------|------|--------|----------|
| Plane | Issue status → Approved | Dify | 触发工作流一 |
| Plane | Issue status → Code Review | 飞书 Bot | 推送通知 @研发负责人 |
| 内部 Git | `post-receive`（docs 仓库） | Dify 知识库 | 触发向量库增量同步 |
| 内部 Git | MR Created | 飞书 Bot | 推送通知 @相关研发 |
| CI/CD | Test Failed | Dify | 触发工作流三（Bug 分析） |
| CI/CD | Build Success | Plane + 飞书 | 更新 Issue 状态，推送通知 |

---

## 六、实施路径

### 6.1 分阶段实施计划

![实施阶段时间线](images/phases.png)

| 阶段 | 内容 | 周期 | 关键验收标准 |
|------|------|------|--------------|
| Phase 1 | Wiki.js + docs 仓库 + CLAUDE.md | Week 1–2 | Git 中有规范 `.md` 文件，Wiki.js 可正常编辑同步 |
| Phase 2 | Plane CE + MCP 接入 | Week 3–4 | CC 通过 MCP 创建和更新 Issue 成功 |
| Phase 3 | Dify + 工作流一、二 | Week 5–7 | Approved Issue → 自动生成文档 → Wiki.js 可见 |
| Phase 4 | RAG 知识助手 + 飞书 Bot | Week 8–9 | 提问已有文档内容，回答准确且附来源链接 |
| Phase 5 | CI/CD + Bug 自动回流 | Week 10–12 | P2 级 Bug 自动修复率 ≥ 60% |

**Phase 4 可与 Phase 3 并行推进**（均依赖 Phase 1 完成，不互相依赖）。

### 6.2 团队职责分工

| 角色 | 实施阶段主要职责 | 日常使用方式 |
|------|------------------|--------------|
| 后端研发（1人） | 主导 Phase 1–5 基础设施搭建，维护 CLAUDE.md，编写 Dify Prompt | 通过 Claude Code 生成代码，Review AI 产出的技术文档 |
| 前端/移动研发 | 参与 Phase 2 规范制定，维护 Flutter CLAUDE.md | 通过 Claude Code 生成 Flutter 代码 |
| 产品 PM | 参与 Phase 1 PRD 模板定义 | 用 Wiki.js 写 PRD，在 Plane 创建需求 Issue |
| 运营 / 市场 | 参与 Phase 4 上线后文档迁移 | 用 Wiki.js 写 SOP，用 Web UI 问知识助手 |
| 研发 TL | 把关各阶段验收标准，审批 Phase 1–2 规范 | Review AI 生成的技术设计文档和 MR |

---

## 七、风险评估与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| Claude API 访问稳定性（内网代理出口） | 高 | 多 Key 轮换代理，配置重试机制；关键节点设置超时降级，AI 失败时飞书通知人工接管 |
| AI 生成文档质量不达标 | 中 | 前期建立详细 Prompt 模板和评审标准；设置人工 Review 必须通过门禁，不强制 Auto Merge |
| 团队使用习惯迁移成本 | 中 | 飞书文档和 Wiki.js 并行过渡期（2–4 周）；优先让产品感受到"写完 PRD 自动出技术文档"的价值 |
| docs 仓库权限管理复杂 | 低 | 在 CLAUDE.md 明确 AI 操作权限白名单；Git 仓库 CODEOWNERS 设置关键目录 Review 要求 |
| 向量库知识过期 | 低 | 文档 frontmatter 加 status 字段；废弃文档及时改 deprecated；每月全量重建向量索引 |

---

## 八、成本估算

### 8.1 基础设施成本

| 项目 | 费用 | 说明 |
|------|------|------|
| Wiki.js | ¥0 | AGPLv3，自用免费 |
| Plane CE | ¥0 | AGPL-3.0，社区版免费 |
| Dify | ¥0 | Apache 2.0，私有化免费 |
| Weaviate | ¥0 | BSD-3，自托管免费 |
| 服务器 | 利用现有内网资源 | ≥ 8C / 16GB / 200GB SSD |

### 8.2 Claude API 月度费用估算

基于 10~30 人团队，每月约 20~30 个功能迭代：

| 场景 | 模型 | 月费用估算 |
|------|------|------------|
| PRD → 技术设计文档（~25 次/月） | claude-opus-4-6 | ≈ $75 |
| 技术文档 → OpenAPI（~25 次/月） | claude-sonnet-4-6 | ≈ $9 |
| Bug 分析（~50 次/月） | claude-sonnet-4-6 | ≈ $6 |
| 知识问答（~500 次/月） | claude-haiku-4-5 | ≈ $1.25 |
| Claude Code 代码生成（~100 次/月） | claude-sonnet-4-6 | ≈ $60 |
| **合计** | | **≈ $150 / 月** |

> 建议初期设置月度 Token 用量告警（如 $200），超出后人工审核是否需要优化 Prompt 或调整模型选型。

---

## 九、建议团队讨论的议题

| 议题 | 需要决策的内容 |
|------|----------------|
| Claude API 访问方案 | 是否已有稳定的 API 代理节点？Key 管理策略？月度预算上限？ |
| 文档迁移策略 | 哪些文档优先迁移？是否迁移历史文档，还是只对新文档使用新系统？ |
| 服务器资源分配 | 是否有现成的内网服务器可用？还是需要申请资源？ |
| CLAUDE.md 内容定义 | 谁来主导编写？需要哪些研发参与定义技术规范和命名约定？ |
| Phase 1 启动时间 | 计划何时启动？是否能分出 1 名研发专职推进前两周？ |
| 验收标准 | AI 生成的技术文档质量达到什么水平算"通过"？Bug 自动修复率目标是多少？ |

---

## 附录：系统内网部署地址规划

| 组件 | 内网地址（示例） | 依赖 |
|------|-----------------|------|
| Wiki.js | `http://内网IP:3000` | PostgreSQL |
| Plane | `http://内网IP:80` | PostgreSQL + Redis + RabbitMQ |
| Dify | `http://内网IP:3001` | PostgreSQL + Redis + Weaviate |
| docs Git | `git@内网IP:docs.git` | — |
| 飞书 Bot | `http://内网IP:8080` | Dify API |
| Claude API 代理 | `http://代理IP:7860` | 外网 Anthropic |

---

*文档结束。如有疑问或需要进一步细化某个模块的技术方案，可基于此文档展开讨论。*
