# ArcFlow + Plane 无缝集成设计

## 概述

将 Plane CE 的项目管理能力充分复用到 ArcFlow 平台中，通过双向导航跳转 + 统一飞书 OAuth 认证，实现两个系统间的无缝切换体验，同时大幅减少 ArcFlow Web 端的自研工作量。

## 设计目标

1. **复用 Plane 全部功能** — 看板、Issue、Cycle、Module、Pages、分析等，不在 ArcFlow 中重复造轮子
2. **无缝跳转体验** — 双向导航入口，用户在两个系统间一键切换
3. **统一认证** — 通过讯飞内部飞书 OAuth SSO，登录一次后两边都认
4. **精简 ArcFlow 页面** — 去掉与 Plane 功能重叠的页面，ArcFlow 聚焦 AI + 工作流 + 文档

## 架构约束

### Plane CE 不支持 sub-path 部署

经验证，Plane CE 官方明确不支持 sub-path（如 `/plane/`）部署：

- Next.js 前端没有配置 `basePath`，静态资源路径硬编码为 `/`
- 社区 PR #8589（sub-path 支持）被官方关闭
- API 认证重定向和内部路由均假设根路径部署

因此采用**不同端口独立部署 + 飞书 OAuth 各自对接**的方案。

### 部署拓扑

```text
172.29.230.21:80    → ArcFlow Web（Nginx → 静态文件 + 反向代理 Gateway :3100）
172.29.230.21:8082  → Plane CE（Caddy proxy → 内部各服务）
172.29.230.21:3100  → ArcFlow Gateway（Bun + Hono）
172.29.230.21:3000  → Wiki.js
172.29.230.21:3001  → Dify Web
```

## 详细设计

### 1. 统一飞书 OAuth 认证

#### 1.1 现状

- ArcFlow：已对接讯飞内部飞书 OAuth（`xfchat.iflytek.com`），使用 `arcflow_token` 存储在 localStorage
- Plane CE：使用独立的账号密码登录体系

#### 1.2 方案

在 Plane CE Admin 面板中配置自定义 OAuth Provider，对接同一个讯飞飞书应用：

**飞书 OAuth 应用配置：**

- 在现有飞书应用中新增 Plane 的 OAuth 回调地址：`http://172.29.230.21:8082/api/v1/social-auth/callback/`
- 飞书应用需要的权限范围：`contact:user.email:readonly`（获取用户邮箱，Plane 以邮箱作为用户唯一标识）

**Plane CE Admin 配置（`172.29.230.21:8082/god-mode/`）：**

- Authentication → Custom OAuth
- Client ID：复用 ArcFlow 飞书应用的 App ID
- Client Secret：复用 ArcFlow 飞书应用的 App Secret
- Token URL：`https://xfchat.iflytek.com/open-apis/authen/v1/oidc/access_token`
- User Info URL：`https://xfchat.iflytek.com/open-apis/authen/v1/user_info`
- Authorize URL：`https://xfchat.iflytek.com/open-apis/authen/v1/authorize`
- Scope：`contact:user.email:readonly`

#### 1.3 SSO 体验

用户登录 ArcFlow 后跳转 Plane 时，飞书 OAuth 已有 session，Plane 自动完成授权流程，无需再次输入账号密码。实际体验接近"一次登录，两边通用"。

### 2. ArcFlow 侧栏改造 — 增加 Plane 跳转入口

#### 2.1 侧栏导航结构

```text
┌─────────────────────┐
│ Workspace Switcher   │
├─────────────────────┤
│ Dashboard           │  ← ArcFlow 内部页面
│ AI Chat             │
│ Docs                │
│ Workflows           │
├─────────────────────┤  ← 分隔线 + "项目管理" 小标题
│ 看板    ->          │  ← 跳转 Plane
│ Cycles  ->          │
│ Modules ->          │
│ 分析    ->          │
├─────────────────────┤
│ Settings            │
│ User / Theme        │
└─────────────────────┘
```

#### 2.2 跳转 URL 映射

跳转目标 URL 根据当前 Workspace 绑定的 `plane_project_id` 动态生成：

| 侧栏项 | 目标 URL |
|---------|----------|
| 看板 | `http://172.29.230.21:8082/{workspace_slug}/projects/{project_id}/issues/` |
| Cycles | `http://172.29.230.21:8082/{workspace_slug}/projects/{project_id}/cycles/` |
| Modules | `http://172.29.230.21:8082/{workspace_slug}/projects/{project_id}/modules/` |
| 分析 | `http://172.29.230.21:8082/{workspace_slug}/projects/{project_id}/analytics/` |

其中 `workspace_slug` 和 `project_id` 从 ArcFlow 工作空间配置中获取。

#### 2.3 跳转行为

- 使用 `window.location.href` 在当前标签页跳转（非新标签页），保持"同一个应用"的感觉
- 未绑定 Plane 项目的工作空间，显示"未关联 Plane 项目"提示，引导去 Settings 关联

#### 2.4 Plane Base URL 可配置

在 ArcFlow 环境变量中增加 `VITE_PLANE_BASE_URL`，默认值 `http://172.29.230.21:8082`。跳转 URL 使用此变量拼接，方便后续迁移域名。

### 3. Plane 侧栏改造 — 增加 ArcFlow 返回入口

#### 3.1 方案：Fork Plane CE + 最小化改动

Fork `makeplane/plane` 仓库，在 Plane 前端侧栏底部增加一个"ArcFlow"跳转按钮。

**改动范围：**

- Plane Web 前端（Next.js）侧栏组件，增加一个固定的外部链接按钮
- 通过环境变量 `ARCFLOW_WEB_URL` 控制跳转目标（默认 `http://172.29.230.21`）
- 按钮样式与 Plane 侧栏风格一致，位于侧栏底部

**维护策略：**

- Fork 保持最小改动（仅侧栏一个按钮），便于跟进上游更新
- 改动集中在一个文件，merge upstream 时冲突概率极低
- 使用自建 Docker 镜像替代官方镜像部署

#### 3.2 备选方案：不修改 Plane 代码

如果不想维护 Fork：

- 通过浏览器 Tampermonkey 脚本注入返回按钮（适合个人使用）
- 或在 Plane 的 "Pages" 中创建一个固定的 ArcFlow 链接页面

### 4. ArcFlow 页面精简

#### 4.1 删除 Workflow Trigger 页面

**原因：** 手动填写 Plane Issue ID 触发工作流的操作是冗余的。正确流程应该是：

1. PM 在 Plane 中创建 Issue → 写 PRD
2. Issue 状态变更为 "Approved"
3. Plane Webhook 自动触发 ArcFlow Gateway
4. Gateway 启动对应的 Dify 工作流

**改动：**

- 删除 `packages/web/src/pages/WorkflowTrigger.vue`
- 从路由配置中移除 `/trigger` 路由
- 从侧栏导航中移除 "Trigger Workflow" 入口

#### 4.2 Workflows 页面增强

在工作流执行列表中，将 `plane_issue_id` 从纯文本改为可点击链接：

```text
点击 → 跳转到 http://{PLANE_BASE_URL}/{workspace_slug}/projects/{project_id}/issues/{issue_id}/
```

#### 4.3 Dashboard 增加 Plane 项目概览

在 Dashboard KPI 卡片区域新增一行来自 Plane 的数据：

| 指标 | 数据来源 |
|------|----------|
| 活跃 Issue 数 | Plane API: `GET /api/v1/workspaces/{slug}/projects/{id}/issues/?state_group=started` |
| 待审批 Issue | Plane API: 按 state 筛选 |
| 当前 Cycle 进度 | Plane API: `GET /api/v1/workspaces/{slug}/projects/{id}/cycles/` 取活跃 Cycle |

数据通过 ArcFlow Gateway 代理获取（避免前端直接调 Plane API 的跨域问题），Gateway 用已有的 `PLANE_API_KEY` 调用。

### 5. Workspace Settings 改造

#### 5.1 Plane 关联配置增强

当前 Workspace Settings 中 `plane_project_id` 是只读显示。改造为：

- 增加"关联 Plane 项目"按钮
- 下拉选择 Plane 中的项目列表（通过 Gateway 调 Plane API 获取）
- 关联后自动启用侧栏的 Plane 跳转入口

#### 5.2 新增配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `plane_workspace_slug` | Plane Workspace Slug | 从 Gateway 配置继承 |
| `plane_project_id` | 已有字段，改为可选择 | null |

### 6. Gateway API 新增

为支持前端展示 Plane 数据，Gateway 需新增以下代理 API：

| API | 方法 | 说明 |
|-----|------|------|
| `/api/plane/projects` | GET | 获取 Plane 项目列表（供 Settings 选择） |
| `/api/plane/issues/summary` | GET | 获取当前项目 Issue 统计（供 Dashboard 展示） |
| `/api/plane/cycles/active` | GET | 获取当前活跃 Cycle 信息 |

这些 API 通过 Gateway 已有的 `PLANE_API_KEY` 调 Plane REST API，前端不直接访问 Plane API。

## 实施顺序

1. **飞书 OAuth 对接 Plane** — 在 Plane Admin 配置 Custom OAuth，验证 SSO 登录
2. **ArcFlow 侧栏加 Plane 跳转** — 改造 AppLayout.vue，增加导航入口
3. **环境变量 + Settings 改造** — `VITE_PLANE_BASE_URL`、Plane 项目关联交互
4. **删除 Trigger 页面 + Workflows 链接增强** — 精简冗余页面
5. **Gateway Plane 代理 API** — 新增 3 个代理接口
6. **Dashboard Plane 数据展示** — 接入 Plane 统计数据
7. **Fork Plane + 返回入口** — 最后做，因为需要自建镜像流程

## 不在本次范围

- Plane 页面的深度定制（主题色、Logo 替换等）
- ArcFlow 内嵌 Plane iframe（Plane 不支持，且不推荐）
- 数据双向同步（如 Plane Issue 变更实时推送到 ArcFlow 前端）— 当前通过 Webhook + 刷新页面满足
