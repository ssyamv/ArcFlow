# ArcFlow — AI 研发运营一体化平台设计规格文档

> 版本：v2.0 · 2026-04-02 · 基于 v1.0 技术架构方案头脑风暴后的修订版

---

## 一、项目背景

### 1.1 目标优先级

1. **流程标准化** — PRD 到技术文档到代码的流程规范化，减少人工传递损耗
2. **研发效率** — AI 自动生成文档和代码，减少中间环节
3. **知识管理** — 文档统一存储，语义检索，降低信息查找成本

### 1.2 团队现状

- 团队规模：10-30 人
- 技术栈：
  - 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
  - Web 前端：Vue3
  - 移动端：Flutter 3.x + GetX
  - 客户端：原生 Android
- 已有 AI 辅助：团队已在使用 Claude Code 辅助编码，但流程串联仍为手工
- CI/CD：Web 与服务端已有，客户端尚不完善
- 网络：可直接访问外网 API，无需代理
- 工具现状：Wiki.js、Plane、Dify 均从零开始引入

### 1.3 核心设计原则

| 原则 | 说明 |
|------|------|
| 文档即代码 | 所有文档以 `.md` 文件存在 Git 仓库，与代码同等管理 |
| AI 优先接口 | 工具选型优先考虑 AI 是否能直接操作 |
| 人工把关节点 | AI 生成，人审批放行；初期严格，后期随信任度提升逐步放松 |
| 统一交互入口 | 团队通过 NanoClaw（飞书/微信）完成大部分 AI 交互 |
| 私有化优先 | 核心组件内网私有化部署 |

---

## 二、整体架构

### 2.1 架构分层

系统分为六层：

| 层次 | 核心组件 | 职责 |
|------|----------|------|
| 交互层 | NanoClaw（飞书 + 微信） | 团队统一 AI 工作台，对话式完成问答、任务管理、工作流触发、文档操作 |
| 通知层 | 飞书（状态推送） | 胶水服务推送各节点状态通知，附审批快捷按钮（通过/打回） |
| 编排层 | Dify | 工作流编排（Prompt 链、RAG 检索、模型调用） |
| 衔接层 | 胶水服务（Node.js + TS） | Webhook 路由、Git 读写、Claude Code 调度、飞书通知推送 |
| 协作层 | Wiki.js + Plane | Wiki.js 管理文档；Plane 管理任务/Issue（原生 MCP） |
| 数据层 | docs Git + 代码仓库 + Weaviate | `.md` 文件存 Git；文档向量化存 Weaviate |

### 2.2 组件清单

| 组件 | 选型 | 角色 |
|------|------|------|
| 文档知识库 | Wiki.js 2.x | 人写文档的界面，底层存 Git `.md` |
| 任务管理 | Plane CE | 任务/Issue 管理，原生 MCP |
| AI 编排引擎 | Dify | 工作流编排，RAG |
| 胶水服务 | Node.js + TypeScript | Webhook 路由、Git 读写、Claude Code 调度、飞书通知 |
| AI 工作台 | NanoClaw | 团队统一 AI 交互入口（飞书 + 微信渠道） |
| 代码生成 | Claude Code（headless 模式） | 读文档生成代码，自动修复 Bug |
| 文档生成 | Claude API | PRD → 技术文档，日志分析 |
| 向量数据库 | Weaviate | 文档向量化，语义检索 |
| 代码仓库 | 内部 Git（Gitea/GitLab CE） | 代码 + docs `.md` 文件存储 |
| 通知 | 飞书（现有） | 状态推送 + NanoClaw 渠道 |

### 2.3 NanoClaw 的角色定位

NanoClaw 作为团队统一 AI 工作台，提供四类能力：

| 能力 | 示例 | 后端调用 |
|------|------|----------|
| 项目问答 | "这个功能的接口定义在哪？" | 本地 CLAUDE.md 记忆 + Dify RAG 检索 |
| 任务管理 | "创建一个用户注册的需求 Issue" | Plane MCP 直接读写 |
| 工作流触发 | "这个 PRD 审批通过，开始生成技术文档" | 胶水服务 → Dify 工作流 |
| 文档操作 | "帮我查一下用户登录的 PRD" | docs Git 读写 + Wiki.js 同步 |

渠道接入：
- **微信**：使用腾讯官方 `@tencent-weixin/openclaw-weixin-cli` 插件
- **飞书**：已有完善的接入方案

NanoClaw **不取代** Web UI，而是提供额外的对话式入口。深度操作（看板全貌、Prompt 调试、长文档编辑）仍使用各组件的 Web UI。

### 2.4 胶水服务（Gateway Service）

原方案缺失的关键组件，负责系统间的数据搬运：

| 职责 | 说明 |
|------|------|
| Webhook 接收 | 统一接收 Plane、Git、CI/CD 的 Webhook 事件 |
| 上下文组装 | 从 Git 拉取 PRD/文档内容，组装给 Dify 或 Claude API |
| 结果写回 | 将 AI 生成的文档写入 Git 仓库，调 Wiki.js GraphQL API 即时同步 |
| Claude Code 调度 | 通过 CLI headless 模式调用 Claude Code，传入任务描述 |
| 飞书状态推送 | 在各节点完成后推送飞书消息（含审批快捷按钮） |

胶水服务与 Dify 的分工：
- **Dify**：负责 AI 工作流编排（Prompt 链、RAG 检索、模型调用）
- **胶水服务**：负责系统间的数据搬运（Git 读写、Webhook 路由、飞书通知、Claude Code 调度）

---

## 三、核心数据流

### 3.1 端到端流程：PRD → 代码 → 质量闭环

**阶段一：需求录入**
- PM 在 Wiki.js 编写 PRD → 自动 commit 到 docs Git
- PM 在 Plane 创建 Issue，关联 PRD 文件路径
- PM 将 Issue 状态改为 `Approved`

**阶段二：技术文档生成**
- Plane Webhook → 胶水服务接收事件
- 胶水服务从 docs Git 拉取 PRD 内容
- 胶水服务调用 Dify 工作流一（Claude Opus 生成技术设计文档）
- 胶水服务将文档写入 docs Git + 调 Wiki.js GraphQL API 即时同步
- 链式触发工作流二 → Claude Sonnet 生成 OpenAPI yaml
- 胶水服务 → 飞书推送通知 @研发，附"查看/通过/打回"按钮

**阶段三：人工 Review**
- 研发在 Wiki.js 查看技术文档，在飞书点"通过"或"打回"
- 通过 → 胶水服务更新 Plane Issue 状态
- 打回 → 通知 PM 修改 PRD 或手动调整技术文档后重新提审

**阶段四：代码生成**
- 胶水服务在服务器上以 headless 模式启动 Claude Code
- Claude Code 读取各仓库 CLAUDE.md + 技术设计文档 + OpenAPI yaml
- 按需生成：后端 Spring Boot / 前端 Vue3 / 移动端 Flutter / Android 代码
- 自动创建 MR → 胶水服务 → 飞书通知研发 Review

**阶段五：质量闭环**（全端覆盖，客户端 CI/CD 补齐后接入）
- MR 合并触发 CI/CD 跑测试
- 成功 → 更新 Plane Issue 状态 → 飞书通知 → 交付归档
- 失败 → CI 日志 → 胶水服务 → Dify 工作流三分析 → 自动创建 Bug Issue → Claude Code headless 自动修复 → 重新提 MR → 重入 Review（最多自动修复 2 次，超出转人工处理）

### 3.2 NanoClaw 交互流程

团队成员通过飞书/微信 @NanoClaw 发起请求，NanoClaw 根据意图路由：

```
成员消息 → NanoClaw 意图识别
  → 项目问答：CLAUDE.md 记忆 + Dify RAG API
  → 任务操作：Plane MCP 直接读写
  → 工作流触发：胶水服务 REST API → Dify 工作流
  → 文档操作：docs Git 读写 + Wiki.js GraphQL 同步
  → 响应回传飞书/微信
```

---

## 四、多端技术文档生成策略

一个 PRD 可能同时涉及后端 + Vue3 + Flutter + Android。策略如下：

1. Dify 工作流一先生成一份**统一的技术设计文档**（数据库设计、接口设计、业务逻辑）
2. 然后**按端拆分**生成各自的实现指引（各端的分层结构、命名规范、组件划分）
3. CLAUDE.md 按仓库维度各自维护

### 4.1 CLAUDE.md 分布

| 仓库 | CLAUDE.md 内容重点 |
|------|-------------------|
| docs 仓库 | 文档目录规范、AI 操作权限、文档模板 |
| 后端仓库 | Java 17 + Spring Boot 3.x + MyBatis-Plus 分层规范 |
| Vue3 前端仓库 | Vue3 + 组件库 + 路由 + 状态管理规范 |
| Flutter 仓库 | Flutter 3.x + GetX 分层规范 |
| Android 仓库 | 原生 Android 架构规范 |

### 4.2 AI 模型分配

| 场景 | 模型 | 理由 |
|------|------|------|
| PRD → 技术设计文档 | claude-opus-4-6 | 复杂推理，架构设计需最强理解能力 |
| 技术文档 → OpenAPI yaml | claude-sonnet-4-6 | 结构化输出，速度质量平衡 |
| CI 日志分析 / Bug 报告 | claude-sonnet-4-6 | 够用，日均频率较高，控制成本 |
| 知识库问答（NanoClaw → Dify RAG） | claude-haiku-4-5 | 高频低延迟，成本最低 |
| 代码生成 / Bug 修复 | Claude Code headless（claude-sonnet-4-6） | 完整上下文理解和自修正能力 |
| NanoClaw 对话 | claude-sonnet-4-6（via Agent SDK） | 意图路由 + 对话管理 |

---

## 五、Webhook 事件流

| 事件来源 | 事件 | 接收方 | 触发动作 |
|----------|------|--------|----------|
| Plane | Issue status → Approved | 胶水服务 | 触发 Dify 工作流一 |
| Plane | Issue status → Code Review | 胶水服务 | 飞书推送通知 @研发（含审批按钮） |
| 内部 Git | `post-receive`（docs 仓库） | Dify 知识库 | 向量库增量同步 |
| 内部 Git | MR Created | 胶水服务 | 飞书推送通知 @相关研发 |
| CI/CD | Test Failed | 胶水服务 | 触发 Dify 工作流三（Bug 分析） |
| CI/CD | Build Success | 胶水服务 | 更新 Plane Issue 状态 + 飞书通知 |
| 飞书 | 审批按钮点击（通过/打回） | 胶水服务 | 更新 Plane Issue 状态，触发后续流程 |

---

## 六、服务器资源评估

基于内网服务器 + 10-30 人团队规模：

| 服务组 | 推荐配置 | 说明 |
|--------|----------|------|
| Wiki.js + PostgreSQL | 2C / 4GB | 文档读写，并发低 |
| Plane（含 Worker、Beat、MQ） | 4C / 8GB | 任务管理，有 Celery 后台任务 |
| Dify（含 Worker + Weaviate） | 4C / 8GB | 工作流执行 + 向量检索 |
| 胶水服务 | 2C / 2GB | Node.js，Webhook 路由 + 通知 |
| Claude Code 运行环境 | 2C / 4GB | headless 模式，Node 运行时 |
| NanoClaw | 2C / 4GB | Docker 容器隔离运行 |
| **合计建议** | **≥ 16C / 30GB / 200GB SSD** | 单台物理机或云主机 |

---

## 七、实施路径

### 7.1 分阶段实施计划

| 阶段 | 内容 | 周期 | 验收标准 |
|------|------|------|----------|
| Phase 1 | Wiki.js + docs 仓库 + CLAUDE.md（多仓库） | Week 1-2 | Git 中有规范 `.md` 文件，Wiki.js 同步正常，各仓库 CLAUDE.md 就位 |
| Phase 2 | Plane CE + MCP 接入 | Week 3-4 | Claude Code 通过 MCP 读写 Issue 成功 |
| Phase 3 | Dify + 工作流一二 + 胶水服务 | Week 5-7 | Approved Issue → 自动生成文档 → Wiki.js 可见 |
| Phase 4 | Dify RAG 知识库 | Week 8-9 | 文档向量化完成，API 可检索，准确率达标 |
| Phase 5 | NanoClaw 部署 + 飞书/微信接入 | Week 10-12 | 成员在飞书/微信中可问答、管理任务、触发工作流 |
| Phase 6 | CI/CD Bug 回流（全端） | Week 13-15 | 测试失败自动生成 Bug Issue，Claude Code 自动修复 |

**并行关系**：Phase 4 可与 Phase 3 并行推进（均依赖 Phase 1，互不依赖），实际周期约 13 周。

**依赖关系**：
- Phase 5 依赖 Phase 2（Plane MCP）+ Phase 4（RAG 能力）
- Phase 6 依赖 Phase 3（胶水服务）；与 Phase 5 无硬依赖（飞书通知由胶水服务提供，NanoClaw 非必须）

### 7.2 团队职责分工

| 角色 | 实施阶段主要职责 | 日常使用方式 |
|------|------------------|--------------|
| 后端研发（1人） | 主导 Phase 1-6 基础设施搭建，维护 CLAUDE.md，编写 Dify Prompt | 通过 Claude Code 生成代码，Review AI 产出 |
| 前端/移动研发 | 参与 Phase 2 规范制定，维护各端 CLAUDE.md | 通过 Claude Code 生成代码 |
| 产品 PM | 参与 Phase 1 PRD 模板定义 | 用 Wiki.js 写 PRD，在 Plane/NanoClaw 创建 Issue |
| 运营/市场 | 参与 Phase 5 上线后文档迁移 | 用 Wiki.js 写 SOP，用 NanoClaw 问知识助手 |
| 研发 TL | 把关各阶段验收标准 | Review AI 生成的技术文档和 MR |

---

## 八、风险评估与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| 投入产出比不达预期 | 高 | Phase 3 完成后做 ROI 评估（人工 vs AI 生成文档的时间对比），不达标则暂停后续 Phase |
| 团队使用习惯迁移 | 高 | 飞书文档与 Wiki.js 并行过渡期 2-4 周；NanoClaw 降低工具切换成本；优先让团队感受到"PRD 自动出技术文档"的价值 |
| 组件维护负担 | 中 | 指定 1 名研发负责基础设施运维；各组件配置 Docker 健康检查和自动重启 |
| AI 生成文档质量 | 中 | 前期建立详细 Prompt 模板和评审标准；人工 Review 必须通过门禁 |
| NanoClaw 飞书/微信渠道稳定性 | 中 | 飞书已有完善方案；微信使用腾讯官方插件；渠道故障时 Web UI 作为降级方案 |
| 客户端 CI/CD 不完善 | 低 | Phase 6 先覆盖 Web + 服务端，客户端 CI/CD 补齐后再接入 |
| 向量库知识过期 | 低 | 文档 frontmatter 加 status 字段；每月全量重建向量索引 |

---

## 九、成本估算

### 9.1 基础设施

| 项目 | 费用 |
|------|------|
| Wiki.js / Plane CE / Dify / Weaviate / NanoClaw | ¥0（开源自托管） |
| 服务器 | 利用现有内网资源（≥ 16C / 30GB / 200GB SSD） |

### 9.2 Claude API 月度费用估算

基于 10-30 人团队，每月约 20-30 个功能迭代：

| 场景 | 模型 | 月费用估算 |
|------|------|------------|
| PRD → 技术设计文档（~25 次/月） | claude-opus-4-6 | ≈ $75 |
| 技术文档 → OpenAPI（~25 次/月） | claude-sonnet-4-6 | ≈ $9 |
| Bug 分析（~50 次/月） | claude-sonnet-4-6 | ≈ $6 |
| 知识问答（~500 次/月） | claude-haiku-4-5 | ≈ $1.25 |
| Claude Code 代码生成（~100 次/月） | claude-sonnet-4-6 | ≈ $60 |
| NanoClaw 对话（~1000 次/月） | claude-sonnet-4-6（via Agent SDK） | ≈ $30 |
| **合计** | | **≈ $180/月** |

建议设置月度 Token 用量告警（$250），超出后审核是否需优化 Prompt 或调整模型选型。

---

## 十、待团队讨论的议题

| 议题 | 需要决策的内容 |
|------|----------------|
| API Key 管理 | 多个组件共用一个 Key 还是各自独立？月度预算上限？ |
| 文档迁移策略 | 哪些文档优先迁移？是否迁移历史文档？ |
| 服务器资源分配 | 现有内网服务器是否满足 16C/30GB？ |
| CLAUDE.md 编写 | 各端由对应研发主导定义技术规范 |
| Phase 1 启动 | 计划何时启动？是否能分出 1 名研发专职推进？ |
| AI 文档质量标准 | 达到什么水平算"通过"？ |
| NanoClaw 权限控制 | 哪些操作允许通过对话触发，哪些必须在 Web UI 操作？ |
