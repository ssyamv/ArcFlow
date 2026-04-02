# Phase 1: Wiki.js + docs 仓库 + CLAUDE.md 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 ArcFlow Phase 1 文档基础设施搭建，包括 docs Git 仓库目录结构、PRD 模板、docs CLAUDE.md、Wiki.js 部署配置、各端代码仓库 CLAUDE.md。

**Architecture:** 在本仓库 `setup/` 目录下准备所有产出物（目录结构、模板、配置文件、CLAUDE.md），用户可直接复制到目标仓库或服务器部署。每个 GitHub Issue 对应一个独立 Task，产出物按目标仓库分目录组织。

**Tech Stack:** Markdown、Docker Compose、PostgreSQL、Wiki.js 2.x、Git

**GitHub Milestone:** Phase 1: Wiki.js + docs 仓库 + CLAUDE.md（截止 2026-04-15）

**对应 Issue：** #1, #2, #3, #4, #5, #6

---

## 文件结构总览

```text
setup/
├── docs-repo/                    # Issue #1: docs 仓库完整目录结构
│   ├── README.md                 # docs 仓库说明
│   ├── CLAUDE.md                 # Issue #4: docs 仓库 CLAUDE.md
│   ├── .gitignore
│   ├── prd/
│   │   ├── .gitkeep
│   │   ├── _template-feature.md  # Issue #3: 功能点级 PRD 模板
│   │   └── _template-module.md   # Issue #3: 模块级 PRD 模板
│   ├── tech-design/
│   │   ├── .gitkeep
│   │   └── _template.md          # Issue #3: 技术设计文档模板
│   ├── api/
│   │   └── .gitkeep
│   ├── arch/
│   │   └── .gitkeep
│   ├── ops/
│   │   └── .gitkeep
│   └── market/
│       └── .gitkeep
├── wiki-js/                      # Issue #2: Wiki.js 部署配置
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md                 # 部署步骤说明
└── claude-md/                    # Issue #6: 各端 CLAUDE.md
    ├── backend-CLAUDE.md
    ├── vue3-CLAUDE.md
    ├── flutter-CLAUDE.md
    └── android-CLAUDE.md
```text

---

### Task 1: 搭建 docs Git 仓库目录结构（Issue #1）

**Files:**
- Create: `setup/docs-repo/README.md`
- Create: `setup/docs-repo/.gitignore`
- Create: `setup/docs-repo/prd/.gitkeep`
- Create: `setup/docs-repo/tech-design/.gitkeep`
- Create: `setup/docs-repo/api/.gitkeep`
- Create: `setup/docs-repo/arch/.gitkeep`
- Create: `setup/docs-repo/ops/.gitkeep`
- Create: `setup/docs-repo/market/.gitkeep`

- [ ] **Step 1: 创建 docs-repo 目录结构**

创建 `setup/docs-repo/` 目录及所有子目录的 `.gitkeep` 文件：

```bash
mkdir -p setup/docs-repo/{prd,tech-design,api,arch,ops,market}
touch setup/docs-repo/{prd,tech-design,api,arch,ops,market}/.gitkeep
```text

- [ ] **Step 2: 创建 docs-repo README.md**

创建 `setup/docs-repo/README.md`：

```markdown
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
```text

- [ ] **Step 3: 创建 .gitignore**

创建 `setup/docs-repo/.gitignore`：

```text
# OS
.DS_Store
Thumbs.db

# Editor
*.swp
*.swo
*~
.idea/
.vscode/

# Wiki.js 本地缓存
.wiki/
```text

- [ ] **Step 4: 提交**

```bash
git add setup/docs-repo/
git commit -m "feat(setup): 添加 docs 仓库目录结构 (#1)"
```text

---

### Task 2: 创建 PRD 模板文件（Issue #3）

**Files:**
- Create: `setup/docs-repo/prd/_template-feature.md`
- Create: `setup/docs-repo/prd/_template-module.md`
- Create: `setup/docs-repo/tech-design/_template.md`

**参考文档:** `docs/superpowers/specs/2026-04-02-document-templates-design.md` 第 2.3、2.4 和第三节

- [ ] **Step 1: 创建功能点级 PRD 模板**

创建 `setup/docs-repo/prd/_template-feature.md`，内容完全按照设计文档 2.3 节：

```markdown
---
title: 
type: feature
status: draft
owner: 
created: 
sprint: 
related_prd: []
---

## 一句话描述

让[谁]能够[做什么]以达到[什么目的]。

## 背景

为什么要做这个功能？解决什么问题？（2-3 句话即可）

## 核心业务规则

1. [规则一：可判定的条件和结果]
2. [规则二]

## 功能说明

描述用户操作流程，包括：

- 入口在哪
- 主流程步骤
- 异常情况怎么处理（如输入错误、网络异常）

## 用户角色与权限（可选）

| 角色 | 可执行操作 |
|------|-----------|
| ... | ... |

（如果功能涉及角色区分或权限控制，务必填写，AI 据此判断是否需要鉴权逻辑）

## 设计稿

- Figma 链接：[待设计师填写]
- 状态：未开始 | 设计中 | 已交付

## 涉及端

- [ ] 后端
- [ ] Vue3 Web
- [ ] Flutter 移动端
- [ ] Android 客户端

## 验收标准

1. Given [前置条件]，When [操作]，Then [预期结果]
2. ...

## 补充说明（可选）

UI 原型链接、参考竞品、与现有功能的关系等。
```text

- [ ] **Step 2: 创建模块级 PRD 模板**

创建 `setup/docs-repo/prd/_template-module.md`，内容完全按照设计文档 2.4 节：

```markdown
---
title: 
type: module
status: draft
owner: 
created: 
sprint: 
related_prd: []
---

## 一句话描述

让[谁]能够[做什么]以达到[什么目的]。

## 背景

### 现状问题
当前存在什么问题？影响了谁？（3-5 句话）

### 目标
本模块要达成的核心目标，按优先级排列：

1. [目标一]
2. [目标二]

## 核心业务规则

1. [规则一]
2. [规则二]

## 功能清单

将模块拆解为具体功能点，标注优先级：

| 功能点 | 优先级 | 说明 |
|--------|--------|------|
| 功能 A | P0 必须 | 简要描述 |
| 功能 B | P1 应该 | 简要描述 |
| 功能 C | P2 可选 | 简要描述 |

> 优先级定义：P0 = 本迭代必须上线；P1 = 本迭代争取完成，可延后；P2 = 本迭代不做，未来排期

## 用户角色与权限

| 角色 | 可执行操作 |
|------|-----------|
| 普通用户 | ... |
| 管理员 | ... |

## 各功能点说明

### 功能 A

**操作流程：**

- 入口在哪
- 主流程步骤
- 异常情况处理

### 功能 B
...

## 设计稿

- Figma 链接：[待设计师填写]
- 状态：未开始 | 设计中 | 已交付

## 涉及端

- [ ] 后端
- [ ] Vue3 Web
- [ ] Flutter 移动端
- [ ] Android 客户端

## 验收标准

1. Given [前置条件]，When [操作]，Then [预期结果]
2. ...

## 非功能需求（可选）

性能要求、并发量预估、数据量级、安全合规等，有明确要求才写。

## 补充说明（可选）

UI 原型链接、参考竞品、与现有模块的关系、数据迁移需求等。
```text

- [ ] **Step 3: 创建技术设计文档模板**

创建 `setup/docs-repo/tech-design/_template.md`，内容按照设计文档第三节：

```markdown
---
title: 
source_prd: /prd/2026-04/feature-xxx.md
status: draft | reviewed | approved
generated_by: claude-opus-4-6    # 由胶水服务自动写入，勿手动修改
generated_at: 2026-04-01T10:00:00  # 由胶水服务自动写入，勿手动修改
reviewer: 
---

## 功能概述

一段话总结：做什么、为谁做、核心价值。
（AI 基于 PRD 的"一句话描述"和"背景"生成，研发用来快速判断 AI 是否理解对了方向）

## 需求理解确认

AI 对 PRD 核心业务规则的理解复述：

1. [AI 理解的规则一]
2. [AI 理解的规则二]

> ⚠️ 如有以下疑问请 PM 确认：
> - [PRD 中未明确的边界情况]
> - [可能存在歧义的描述]

（防止 AI 理解跑偏的关键防线，研发 Review 时优先看这里）

## 数据库设计

### 新增/修改表

（建表 SQL，含字段注释、索引、关联关系）

### ER 关系说明

（表间关系描述）

## 接口设计

### 接口清单

| 接口 | Method | Path | 说明 |
|------|--------|------|------|
| 接口一 | POST | /api/v1/xxx | ... |

### 接口详情

#### 接口一：xxx

- 请求参数
- 响应结构（统一 Result<T>）
- 错误码
- 业务逻辑要点

## 分层实现说明

（本节仅适用于后端 Spring Boot，前端/客户端的实现指引见"多端代码生成策略"设计文档）

按 Controller → Service → ServiceImpl → Mapper → Entity 分层，说明各层职责和关键逻辑。

## 涉及的现有模块改动

列出需要修改的现有代码模块及改动点。（无则写"无"）

## 注意事项

- 安全性考虑
- 性能考虑
- 边界情况处理
- 与现有功能的兼容性
```text

- [ ] **Step 4: 提交**

```bash
git add setup/docs-repo/prd/_template-feature.md setup/docs-repo/prd/_template-module.md setup/docs-repo/tech-design/_template.md
git commit -m "feat(setup): 添加 PRD 模板 + 技术设计文档模板 (#3)"
```text

---

### Task 3: 编写 docs 仓库 CLAUDE.md（Issue #4）

**Files:**
- Create: `setup/docs-repo/CLAUDE.md`

**参考文档:** `docs/superpowers/specs/2026-04-02-claude-md-specs-design.md` 第二节

- [ ] **Step 1: 创建 docs 仓库 CLAUDE.md**

创建 `setup/docs-repo/CLAUDE.md`，内容按照设计文档第二节：

```markdown
# 项目知识库 — Claude 上下文

## 项目概况

ArcFlow AI 研发运营一体化平台的文档仓库。所有文档以 Markdown 存储，与 Wiki.js 双向同步。

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue3 + Element Plus + shadcn-vue + Pinia + Vue Router + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin（支持 Jetpack Compose 和传统 XML）
- 接口规范：RESTful，统一返回 Result<T>

## 文档目录说明

| 目录 | 内容 | 负责方 | AI 权限 |
|------|------|--------|---------|
| /prd | PRD 产品需求文档 | 产品 PM | 只读，不得修改 |
| /tech-design | 技术设计文档 | AI 生成，研发 Review | 可写 |
| /api | OpenAPI yaml 规范 | AI 生成 | 可写 |
| /arch | 系统架构文档 | 研发维护 | 只读 |
| /ops | 运营 SOP | 运营维护 | 只读 |
| /market | 市场材料 | 市场维护 | 只读 |

## AI 操作规范

- 生成技术设计文档时，保存至 `/tech-design/{yyyy-MM}/{功能名}.md`
- 生成 OpenAPI 规范时，保存至 `/api/{yyyy-MM}/{功能名}.yaml`
- 所有生成的文档必须包含 frontmatter（参见 /prd/_template-feature.md 和 /prd/_template-module.md）
- 不得修改 /prd、/arch、/ops、/market 目录下的文件
- 文档内容使用中文

## 文档 Frontmatter 规范

所有 .md 文件必须包含：

- title、status（draft/active/deprecated）、owner、last_updated
- PRD 额外需要：type（module/feature）、created、sprint
- 技术设计文档额外需要：source_prd、generated_by、generated_at、reviewer
```text

- [ ] **Step 2: 提交**

```bash
git add setup/docs-repo/CLAUDE.md
git commit -m "feat(setup): 添加 docs 仓库 CLAUDE.md (#4)"
```text

---

### Task 4: Wiki.js Docker Compose 部署配置（Issue #2）

**Files:**
- Create: `setup/wiki-js/docker-compose.yml`
- Create: `setup/wiki-js/.env.example`
- Create: `setup/wiki-js/README.md`

- [ ] **Step 1: 创建 docker-compose.yml**

创建 `setup/wiki-js/docker-compose.yml`：

```yaml
version: "3.8"

services:
  wiki:
    image: ghcr.io/requarks/wiki:2
    container_name: arcflow-wiki
    depends_on:
      db:
        condition: service_healthy
    environment:
      DB_TYPE: postgres
      DB_HOST: db
      DB_PORT: 5432
      DB_USER: ${POSTGRES_USER:-wikijs}
      DB_PASS: ${POSTGRES_PASSWORD:?请在 .env 中设置 POSTGRES_PASSWORD}
      DB_NAME: ${POSTGRES_DB:-wikijs}
    ports:
      - "${WIKI_PORT:-3000}:3000"
    restart: unless-stopped
    volumes:
      - wiki-data:/wiki/data

  db:
    image: postgres:15-alpine
    container_name: arcflow-wiki-db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wikijs}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?请在 .env 中设置 POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-wikijs}
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-wikijs}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  wiki-data:
  db-data:
```text

- [ ] **Step 2: 创建 .env.example**

创建 `setup/wiki-js/.env.example`：

```env
# PostgreSQL 配置
POSTGRES_USER=wikijs
POSTGRES_PASSWORD=changeme_use_strong_password
POSTGRES_DB=wikijs

# Wiki.js 端口
WIKI_PORT=3000
```text

- [ ] **Step 3: 创建部署说明 README.md**

创建 `setup/wiki-js/README.md`：

```markdown
# Wiki.js 部署指南

## 前置条件

- Docker + Docker Compose 已安装
- docs Git 仓库已创建（Issue #1）
- 服务器建议配置：2C / 4GB

## 部署步骤

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，设置安全的数据库密码
```text

### 2. 启动服务

```bash
docker compose up -d
```text

### 3. 初始化 Wiki.js

1. 浏览器访问 `http://<服务器IP>:3000`
2. 完成初始化向导（创建管理员账号）

### 4. 配置 Git Storage（双向同步）

1. 进入 Wiki.js 管理面板 → Storage → Git
2. 配置以下参数：

| 参数 | 值 |
|------|-----|
| Authentication Type | ssh 或 basic |
| Repository URI | docs 仓库的 Git 地址 |
| Branch | main |
| Sync Direction | Bi-directional |
| Sync Interval | 5 minutes（建议） |

3. 点击 "Apply" 并等待首次同步完成

### 5. 验证双向同步

**Wiki → Git 方向：**

1. 在 Wiki.js 中创建一个测试页面
2. 等待同步间隔
3. 在 docs Git 仓库中确认出现对应 commit

**Git → Wiki 方向：**

1. 在 docs Git 仓库中 push 一个新的 .md 文件
2. 等待同步间隔
3. 在 Wiki.js 中确认页面已出现

### 6. 配置 Webhook（可选，为 RAG 同步预留）

进入管理面板 → Webhooks，添加：
- URL: 胶水服务的 `/webhook/git` 端点（部署胶水服务后配置）
- Events: Page Created, Page Updated, Page Deleted

## 故障排查

- Wiki.js 日志：`docker compose logs wiki`
- 数据库日志：`docker compose logs db`
- Git 同步状态：管理面板 → Storage → Git → Status
```text

- [ ] **Step 4: 提交**

```bash
git add setup/wiki-js/
git commit -m "feat(setup): 添加 Wiki.js Docker Compose 部署配置 (#2)"
```text

---

### Task 5: 编写各代码仓库 CLAUDE.md（Issue #6）

**Files:**
- Create: `setup/claude-md/backend-CLAUDE.md`
- Create: `setup/claude-md/vue3-CLAUDE.md`
- Create: `setup/claude-md/flutter-CLAUDE.md`
- Create: `setup/claude-md/android-CLAUDE.md`

**参考文档:** `docs/superpowers/specs/2026-04-02-claude-md-specs-design.md` 第三至六节

- [ ] **Step 1: 创建后端仓库 CLAUDE.md**

创建 `setup/claude-md/backend-CLAUDE.md`，内容按照设计文档第三节：

```markdown
# 后端项目 — Claude 上下文

## 技术栈

- Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- 构建工具：Maven
- 首次操作前先阅读 pom.xml 了解依赖版本和模块结构

## 分层架构

Controller → Service（接口） → ServiceImpl → Mapper → Entity

| 层 | 职责 | 命名规则 |
|----|------|----------|
| Controller | 参数校验、调用 Service、统一返回 | XxxController |
| Service | 业务接口定义 | XxxService |
| ServiceImpl | 业务逻辑实现 | XxxServiceImpl |
| Mapper | 数据库操作（MyBatis-Plus BaseMapper） | XxxMapper |
| Entity | 数据库实体，与表一一对应 | Xxx |
| DTO | 请求/响应数据传输对象 | XxxReqDTO / XxxRespDTO |
| VO | 视图对象（如需与 DTO 区分） | XxxVO |

## 包结构约定

```text
com.公司.项目
├── controller/
├── service/
│   └── impl/
├── mapper/
├── entity/
├── dto/
├── vo/
├── config/          # 配置类
├── common/          # 公共工具、常量、枚举
│   ├── result/      # 统一返回 Result<T>
│   ├── exception/   # 全局异常处理
│   └── enums/
└── interceptor/     # 拦截器
```text

## 接口规范

- RESTful 风格，路径以 `/api/v1/` 开头
- 统一返回 `Result<T>`，包含 code、message、data 三个字段
- 成功：code=200，失败：业务错误码从 1000 起
- 分页查询统一使用 MyBatis-Plus 的 IPage<T>
- 请求参数：GET 用 @RequestParam，POST/PUT 用 @RequestBody
- 路径命名：小写中划线，如 `/api/v1/user-roles`

## 数据库规范

- 表名：小写下划线，如 `user_role`
- 字段名：小写下划线，如 `created_at`
- 每张表必须包含：id（主键，BIGINT AUTO_INCREMENT）、created_at、updated_at
- 逻辑删除字段：deleted（TINYINT，0 未删除 / 1 已删除）
- MyBatis-Plus 自动填充 created_at、updated_at

## 代码规范

- 禁止在 Controller 层写业务逻辑，只做参数校验和调用 Service
- Service 之间可以互相调用，但禁止循环依赖
- 所有数据库操作通过 Mapper 层，禁止在 Service 中直接写 SQL
- 异常统一通过全局异常处理器捕获，不在 Controller 中 try-catch
- 参数校验使用 @Valid + JSR 303 注解
- 日志使用 SLF4J，注入方式 `@Slf4j`（Lombok），禁止使用 `System.out.println`

- [ ] **Step 2: 创建 Vue3 前端仓库 CLAUDE.md**

创建 `setup/claude-md/vue3-CLAUDE.md`，内容按照设计文档第四节：

```markdown
# Vue3 前端项目 — Claude 上下文

## 技术栈

- Vue 3 + TypeScript + Vite
- 组件库：Element Plus + shadcn-vue
- 状态管理：Pinia
- 路由：Vue Router
- HTTP 请求：Axios
- 首次操作前先阅读 package.json 了解依赖版本，阅读 src/ 目录结构了解项目组织

## 目录结构约定

```text
src/
├── api/              # 接口请求（按模块拆分文件）
├── assets/           # 静态资源
├── components/       # 全局公共组件
├── composables/      # 组合式函数（useXxx）
├── layouts/          # 布局组件
├── pages/            # 页面组件（按模块分目录）
│   └── user/
│       ├── index.vue
│       └── components/   # 页面级私有组件
├── router/           # 路由配置
├── stores/           # Pinia 状态管理（按模块拆分）
├── styles/           # 全局样式
├── types/            # TypeScript 类型定义
└── utils/            # 工具函数
```text

## 组件规范

- 使用 `<script setup lang="ts">` + Composition API，不使用 Options API
- 组件文件名：PascalCase，如 `UserProfile.vue`
- 全局公共组件放 `src/components/`，页面私有组件放在页面目录下的 `components/`
- Element Plus 用于表单、表格、弹窗等后台管理类组件
- shadcn-vue 用于需要高度定制样式的组件
- 两套组件库的使用边界：Element Plus 优先，shadcn-vue 仅在 Element Plus 无法满足定制需求时使用

## 接口请求规范

- 按模块拆分文件，如 `src/api/user.ts`
- 每个接口函数返回类型明确定义
- 统一使用封装后的 Axios 实例（含 token 注入、错误拦截、Result<T> 解包）
- 接口函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`

## 状态管理规范

- 一个模块一个 store 文件，如 `src/stores/user.ts`
- 使用 `defineStore` + Setup Store 风格（组合式写法）
- 只有跨组件共享的状态才放 store，组件内部状态用 `ref` / `reactive`

## 样式规范

- 组件样式使用 `<style scoped>`，避免全局污染
- 全局样式变量定义在 `src/styles/` 中
- 如果 package.json 中包含 tailwindcss 依赖，则优先使用 Tailwind CSS 工具类；否则使用 scoped CSS

## 代码规范

- 所有变量和函数使用 TypeScript 类型标注
- 组合式函数命名以 `use` 开头，如 `useUserList`
- 页面组件负责组装和布局，业务逻辑抽到 composables 中
- 路由使用懒加载：`() => import('@/pages/xxx/index.vue')`

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 UI 代码
- Figma 组件优先映射到 Element Plus 组件，Element Plus 无法满足时映射到 shadcn-vue
- 从 Figma 提取的颜色和间距应映射到项目已有的 CSS 变量 / Tailwind token，不使用硬编码值
- 生成的代码必须遵守本文档中的组件规范和样式规范
```text

- [ ] **Step 3: 创建 Flutter 移动端仓库 CLAUDE.md**

创建 `setup/claude-md/flutter-CLAUDE.md`，内容按照设计文档第五节：

```markdown
# Flutter 移动端项目 — Claude 上下文

## 技术栈

- Flutter 3.x + Dart
- 状态管理 + 路由 + 依赖注入：GetX
- 网络请求：Dio
- 本地存储：shared_preferences（轻量）/ hive（结构化）
- 首次操作前先阅读 pubspec.yaml 了解依赖版本，阅读 lib/ 目录结构了解项目组织

## 目录结构约定

```text
lib/
├── main.dart
├── app/
│   ├── routes/          # GetX 路由定义
│   ├── bindings/        # GetX 依赖绑定
│   └── theme/           # 主题配置
├── modules/             # 按业务模块划分
│   └── user/
│       ├── views/       # 页面 Widget
│       ├── controllers/ # GetX Controller
│       ├── models/      # 数据模型
│       ├── widgets/     # 模块私有组件
│       └── bindings.dart
├── api/                 # 接口请求（按模块拆分）
├── models/              # 全局共享数据模型
├── widgets/             # 全局公共组件
├── utils/               # 工具函数
└── constants/           # 常量定义
```text

## 分层规范

View → Controller → API / Repository

| 层 | 职责 | 命名规则 |
|----|------|----------|
| View | UI 渲染，监听 Controller 状态 | XxxPage / XxxView |
| Controller | 业务逻辑、状态管理 | XxxController（extends GetxController） |
| API | 网络请求封装 | XxxApi |
| Model | 数据模型，含 fromJson / toJson | XxxModel |
| Binding | 依赖注入声明 | XxxBinding |

## GetX 使用规范

- 状态管理使用 `.obs` + `Obx()` 响应式方式
- 路由使用 GetX 命名路由，统一在 `app/routes/` 中定义
- 依赖注入使用 Binding 模式，不在页面内直接 `Get.put()`
- Controller 生命周期：`onInit()` 初始化数据，`onClose()` 释放资源
- 页面间传参通过 `Get.arguments` 或 `Get.parameters`

## 网络请求规范

- 统一 Dio 实例封装（含 BaseUrl、Token 拦截器、错误处理、Result<T> 解包）
- 按模块拆分 API 文件，如 `api/user_api.dart`
- 接口函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`
- Model 类必须实现 `fromJson` 工厂构造函数和 `toJson` 方法

## 代码规范

- 文件名：小写下划线，如 `user_controller.dart`
- 类名：PascalCase，如 `UserController`
- Widget 拆分原则：超过 80 行的 build 方法必须拆分子 Widget
- 页面级 Widget 放 `views/`，可复用组件放 `widgets/`
- 常量统一定义在 `constants/` 中，禁止硬编码字符串和数字

## 错误处理规范

- 网络异常统一在 Dio 拦截器中转换为业务错误对象
- Controller 中使用 try-catch 捕获异常，更新错误状态（如 `isError.value = true`）
- 用户提示统一使用 `Get.snackbar()` 展示错误信息
- loading 状态在 Controller 中通过 `isLoading.obs` 管理，View 层 `Obx()` 响应

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 Flutter UI 代码
- Figma 组件映射到 Flutter 原生 Widget 或项目 `widgets/` 中的自定义组件
- 从 Figma 提取的颜色和间距应映射到 `app/theme/` 中定义的主题变量，不使用硬编码值
- 生成的代码必须遵守本文档中的分层规范和代码规范
```text

- [ ] **Step 4: 创建 Android 客户端仓库 CLAUDE.md**

创建 `setup/claude-md/android-CLAUDE.md`，内容按照设计文档第六节：

```markdown
# Android 客户端项目 — Claude 上下文

## 技术栈

- Kotlin + Android SDK
- UI：支持 Jetpack Compose 和传统 XML 两种方式（新页面优先 Compose，维护旧页面保持 XML）
- 架构：MVVM
- 网络请求：Retrofit + OkHttp + Kotlin Coroutines
- 依赖注入：Hilt
- 图片加载：Coil
- 本地存储：DataStore（轻量）/ Room（结构化）
- 首次操作前先阅读 build.gradle.kts 了解依赖版本，阅读模块和包结构了解项目组织

## 目录结构约定

```text
app/src/main/java/com/公司/项目/
├── ui/                   # UI 层
│   └── user/
│       ├── UserActivity.kt 或 UserScreen.kt（Compose）
│       ├── UserViewModel.kt
│       └── components/   # 页面级私有组件
├── data/                 # 数据层
│   ├── api/              # Retrofit 接口定义（按模块拆分）
│   ├── model/            # 数据模型（DTO / Entity）
│   ├── repository/       # 数据仓库（协调远程和本地）
│   └── local/            # 本地数据源（Room DAO、DataStore）
├── di/                   # Hilt 依赖注入模块
├── common/               # 公共工具、扩展函数、常量
│   ├── base/             # 基类（BaseActivity、BaseViewModel）
│   ├── ext/              # Kotlin 扩展函数
│   └── constants/
└── widget/               # 全局公共 UI 组件
```text

## 分层规范

View（Activity/Fragment/Compose Screen） → ViewModel → Repository → API / Local

| 层 | 职责 | 命名规则 |
|----|------|----------|
| View | UI 渲染，观察 ViewModel 状态 | XxxActivity / XxxFragment / XxxScreen（Compose） |
| ViewModel | 业务逻辑、UI 状态管理 | XxxViewModel（@HiltViewModel） |
| Repository | 协调远程和本地数据源 | XxxRepository |
| API | Retrofit 接口定义 | XxxApi（interface） |
| Model | 数据模型 | XxxDTO（网络）/ XxxEntity（本地）/ XxxUiState（UI） |

## MVVM + Compose 规范

- UI 状态使用 `StateFlow`，ViewModel 中暴露为 `val uiState: StateFlow<XxxUiState>`
- Compose 页面通过 `collectAsStateWithLifecycle()` 收集状态
- 事件从 View → ViewModel 通过函数调用，不用 Event Channel（简单场景）
- 一次性事件（Toast、导航）使用 `SharedFlow` 或 `Channel`
- Compose 组件拆分原则：单个 Composable 函数不超过 60 行

## MVVM + XML 规范（维护旧页面）

- UI 状态使用 `LiveData` 或 `StateFlow` + `lifecycleScope.launch { flow.collect {} }`
- ViewBinding 替代 findViewById，禁止使用 kotlin-android-extensions
- 布局文件命名：`activity_xxx.xml` / `fragment_xxx.xml` / `item_xxx.xml`

## 网络请求规范

- Retrofit 接口按模块拆分，如 `data/api/UserApi.kt`
- 统一 OkHttp 拦截器处理 Token 注入、日志、错误转换
- 接口返回统一包装类 `Result<T>`（与后端 code/message/data 对应）
- 所有网络请求在 Repository 层通过 Coroutines 调用，ViewModel 中使用 `viewModelScope.launch`
- Retrofit BaseUrl 配置读取自 BuildConfig，所有接口路径遵循 `/api/v1/` 前缀 + 小写中划线约定

## 代码规范

- 文件名与类名一致：PascalCase
- 函数名 / 变量名：camelCase
- 常量：UPPER_SNAKE_CASE，定义在 `companion object` 或 `constants/` 中
- Hilt 注入：Repository 和 API 通过 `@Module` + `@Provides` 或 `@Binds` 提供
- 禁止在 View 层直接调用 API，必须通过 ViewModel → Repository

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 Android UI 代码
- Figma 组件优先映射到 Material 3 Compose 组件，其次映射到项目 `widget/` 中的自定义组件
- 从 Figma 提取的颜色和间距应映射到 MaterialTheme 主题变量，不使用硬编码值
- 生成的代码必须遵守本文档中的 MVVM + Compose 规范
```text

- [ ] **Step 5: 提交**

```bash
git add setup/claude-md/
git commit -m "feat(setup): 添加各代码仓库 CLAUDE.md 后端/Vue3/Flutter/Android (#6)"
```text

---

### Task 6: 更新 GitHub Issue 状态 + 收尾

- [ ] **Step 1: 为每个完成的 Issue 添加评论说明产出物位置**

对 Issue #1, #2, #3, #4, #6 添加评论，说明文件已准备就绪，路径在 `setup/` 目录下。

- [ ] **Step 2: 创建 PR 将所有变更合并到 main**

```bash
git push origin HEAD
gh pr create --title "feat: Phase 1 文档基础设施产出物" --body "..."
```text

- [ ] **Step 3: 更新项目 CLAUDE.md 设计文档索引**

在 `CLAUDE.md` 的设计规格文档索引中添加本计划文档的引用。

---

## Issue #5（PM 试写 PRD）说明

Issue #5 "PM 试写一份 PRD 验证全流程" 是一个人工验证任务，依赖 #1（docs 仓库已创建）、#2（Wiki.js 已部署且同步配置完成）、#3（PRD 模板已就位）、#4（CLAUDE.md 已就位）。本任务须在 Task 6 的 PR 合并至 main 且服务器部署完成后方可执行。

**前置步骤（需人工操作）：**
1. 在内部 Git 服务器上创建 `docs` 仓库
2. 将 `setup/docs-repo/` 中的内容推送到新建的 docs 仓库
3. 将 `setup/wiki-js/` 中的 Docker Compose 部署到阿里云服务器
4. 在 Wiki.js 中配置 Git Storage 连接 docs 仓库

**验证步骤（PM 执行）：**
1. PM 在 Wiki.js 中基于 `_template-feature.md` 创建一份 PRD
2. 确认 PRD 自动同步到 docs Git 仓库
3. 确认 frontmatter 格式正确
4. 确认文件路径符合 `/prd/{yyyy-MM}/{功能名}.md` 规范
5. 在 docs 仓库中用 Claude Code 读取该 PRD，确认能正确理解内容
